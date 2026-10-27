import { modelFetch } from './fetch.js';
// Silero VAD (MIT, https://github.com/snakers4/silero-vad; 512-sample frames at 16 kHz) in plain TypeScript on the CPU,
// without onnxruntime. Weights: silero_vad.wgw (the upstream silero_vad.onnx weights in a flat file).
// Buffers are made once and reused for every frame.

/** Frame: 512 samples, reflect-padded by 96 on each side for the STFT conv (kernel 256, stride 64): 8 steps. */
const N = 512;
const PAD = 96;
const STEPS = 8;
const BINS = 129;
const HID = 64;

type Weights = Record<string, Float32Array>;

async function loadWeights(url: string): Promise<{ w: Weights; bytes: number }> {
  const res = await modelFetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const hl = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))) as { tensors: Record<string, { offset: number; shape: number[] }> };
  const data = new Float32Array(buf, 4 + hl);
  const w: Weights = {};
  for (const [name, t] of Object.entries(head.tensors)) w[name] = data.subarray(t.offset, t.offset + t.shape.reduce((a, b) => a * b, 1));
  return { w, bytes: buf.byteLength };
}

/**
 * 1-D conv of x [C][T] into y [O][Tout]; w [O][C/groups][K], b [O] or none; zero padding pad on both sides.
 */
function conv(x: Float32Array, C: number, T: number, w: Float32Array, b: Float32Array | undefined, O: number, K: number, stride: number, pad: number, groups: number, y: Float32Array): number {
  const Tout = Math.floor((T + 2 * pad - K) / stride) + 1;
  const cg = C / groups;
  const og = O / groups;
  for (let o = 0; o < O; o++) {
    const c0 = Math.floor(o / og) * cg;
    for (let t = 0; t < Tout; t++) {
      let acc = b ? b[o]! : 0;
      for (let c = 0; c < cg; c++) {
        const wb = (o * cg + c) * K;
        const xb = (c0 + c) * T;
        for (let k = 0; k < K; k++) {
          const i = t * stride + k - pad;
          if (i >= 0 && i < T) acc += w[wb + k]! * x[xb + i]!;
        }
      }
      y[o * Tout + t] = acc;
    }
  }
  return Tout;
}

function relu(x: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) if (x[i]! < 0) x[i] = 0;
}

const sigmoid = (v: number): number => 1 / (1 + Math.exp(-v));

export class CpuVad {
  private h = new Float32Array(2 * HID);
  private c = new Float32Array(2 * HID);
  private readonly xp = new Float32Array(N + 2 * PAD);
  private readonly stft = new Float32Array(2 * BINS * STEPS);
  private readonly feat = new Float32Array(2 * BINS * STEPS);
  private readonly a = new Float32Array(2 * BINS * STEPS);
  private readonly b = new Float32Array(2 * BINS * STEPS);
  private readonly r = new Float32Array(2 * BINS * STEPS);
  private readonly z = new Float32Array(4 * HID);
  private readonly mp = new Float32Array(STEPS + 6);
  private readonly sm = new Float32Array(STEPS);

  private constructor(private readonly w: Weights, readonly bytes: number) {}

  static async load(url: string): Promise<CpuVad> {
    const { w, bytes } = await loadWeights(url);
    return new CpuVad(w, bytes);
  }

  reset(): void { this.h.fill(0); this.c.fill(0); }

  private W(name: string): Float32Array {
    const t = this.w[name];
    if (!t) throw new Error(`silero_vad.wgw: ${name} がありません`);
    return t;
  }

  /** Residual block: relu(pw(relu(dw(x))) + (proj ? proj(x) : x)), x [C][T] in this.a, result [O][T] in this.a. */
  private block(C: number, T: number, O: number, dw: string, pw: string, proj: string | null): void {
    conv(this.a, C, T, this.W(`${dw}.w`), this.W(`${dw}.b`), C, 5, 1, 2, C, this.b);
    relu(this.b, C * T);
    if (proj) conv(this.a, C, T, this.W(`${proj}.w`), this.W(`${proj}.b`), O, 1, 1, 0, 1, this.r);
    else this.r.set(this.a.subarray(0, C * T));
    conv(this.b, C, T, this.W(`${pw}.w`), this.W(`${pw}.b`), O, 1, 1, 0, 1, this.a);
    for (let i = 0; i < O * T; i++) { const v = this.a[i]! + this.r[i]!; this.a[i] = v > 0 ? v : 0; }
  }

  /** Strided 1x1 conv + relu on this.a [C][T] (result back in this.a); returns the new T. */
  private down(name: string, C: number, T: number, O: number, stride: number): number {
    const Tout = conv(this.a, C, T, this.W(`${name}.w`), this.W(`${name}.b`), O, 1, stride, 0, 1, this.b);
    this.a.set(this.b.subarray(0, O * Tout));
    relu(this.a, O * Tout);
    return Tout;
  }

  private lstm(layer: number, x: Float32Array): void {
    const W = this.W(`lstm${layer}.W`), R = this.W(`lstm${layer}.R`), B = this.W(`lstm${layer}.B`);
    const h = this.h.subarray(layer * HID, (layer + 1) * HID);
    const c = this.c.subarray(layer * HID, (layer + 1) * HID);
    const z = this.z;
    for (let g = 0; g < 4 * HID; g++) {
      let acc = B[g]! + B[4 * HID + g]!;
      for (let k = 0; k < HID; k++) acc += W[g * HID + k]! * x[k]! + R[g * HID + k]! * h[k]!;
      z[g] = acc;
    }
    // ONNX gate order: i, o, f, c
    for (let k = 0; k < HID; k++) {
      const cn = sigmoid(z[2 * HID + k]!) * c[k]! + sigmoid(z[k]!) * Math.tanh(z[3 * HID + k]!);
      c[k] = cn;
      h[k] = sigmoid(z[HID + k]!) * Math.tanh(cn);
    }
  }

  /** Speech probability of one 512-sample frame; the LSTM state carries to the next frame. */
  prob(x: Float32Array): number {
    const xp = this.xp;
    xp.set(x, PAD);
    for (let i = 1; i <= PAD; i++) { xp[PAD - i] = x[i]!; xp[PAD + N - 1 + i] = x[N - 1 - i]!; }
    conv(xp, 1, xp.length, this.W('feature_extractor.w'), undefined, 2 * BINS, 256, 64, 0, 1, this.stft);
    // magnitude [129][8] in feat[0..], log(1 + 2^20 * mag) in a, its mean over bins in sm
    const f = this.feat;
    const lg = this.a;
    const m = this.sm.fill(0);
    for (let k = 0; k < BINS; k++) {
      for (let t = 0; t < STEPS; t++) {
        const re = this.stft[k * STEPS + t]!, im = this.stft[(BINS + k) * STEPS + t]!;
        const mag = Math.sqrt(re * re + im * im);
        f[k * STEPS + t] = mag;
        const l = Math.log(1 + mag * 1048576);
        lg[k * STEPS + t] = l;
        m[t] = m[t]! + l / BINS;
      }
    }
    // mean of the 7-tap smoothing over the reflect-padded means
    const mp = this.mp;
    for (let t = 0; t < STEPS; t++) mp[3 + t] = m[t]!;
    for (let i = 1; i <= 3; i++) { mp[3 - i] = m[i]!; mp[3 + STEPS - 1 + i] = m[STEPS - 1 - i]!; }
    const w7 = this.W('adaptive_normalization.w');
    let smooth = 0;
    for (let t = 0; t < STEPS; t++) for (let k = 0; k < 7; k++) smooth += w7[k]! * mp[t + k]!;
    smooth /= STEPS;
    for (let i = 0; i < BINS * STEPS; i++) f[BINS * STEPS + i] = lg[i]! - smooth;
    this.a.set(f);
    let T = STEPS;
    this.block(2 * BINS, T, 16, 'dw_conv/dw_conv.0', 'pw_conv/pw_conv.0', 'proj');
    T = this.down('encoder.0', 16, T, 16, 2);
    this.block(16, T, 32, 'dw_conv/dw_conv.0_1', 'pw_conv/pw_conv.0_1', 'proj_1');
    T = this.down('encoder.4', 32, T, 32, 2);
    this.block(32, T, 32, 'dw_conv/dw_conv.0_2', 'pw_conv/pw_conv.0_2', null);
    T = this.down('encoder.8', 32, T, 32, 2);
    this.block(32, T, 64, 'dw_conv/dw_conv.0_3', 'pw_conv/pw_conv.0_3', 'proj_2');
    T = this.down('encoder.12', 64, T, 64, 1);
    if (T !== 1) throw new Error(`VAD: encoder length ${T}`);
    this.lstm(0, this.a);
    this.lstm(1, this.h.subarray(0, HID));
    const dw = this.W('decoder/decoder/decoder.1.w'), db = this.W('decoder/decoder/decoder.1.b');
    let acc = db[0]!;
    for (let k = 0; k < HID; k++) { const v = this.h[HID + k]!; acc += dw[k]! * (v > 0 ? v : 0); }
    return sigmoid(acc);
  }
}
