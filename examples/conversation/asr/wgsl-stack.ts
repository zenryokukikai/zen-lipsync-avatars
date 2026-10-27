import { modelFetch } from './fetch.js';
// One zipformer2 encoder stack of the recognizer in hand-written WGSL: the int8 weights of the upstream ONNX model
// (reazonspeech-k2-v2, converted to <base>/stack<i>.wgq) dequantized in the shader (w * scale), float32 activations.
// Every GPU buffer is created once for up to maxT frames.

/* eslint-disable @typescript-eslint/no-explicit-any */
type GpuDevice = any;
type GpuBuffer = any;
type GpuBindGroup = any;
type GpuPipeline = any;

const STORAGE = 0x80;
const UNIFORM = 0x40;
const COPY_DST = 0x08;
const COPY_SRC = 0x04;
const MAP_READ = 0x01;
const WG = 64;
/** Rows of x one linear thread multiplies with the same 4 weight columns. */
const ROWS = 8;
const QUERY_HEAD_DIM = 32;
const POS_HEAD_DIM = 4;
const POS_DIM = 48;

export const SWOOSH = `
fn logaddexp0(z: f32) -> f32 { return max(z, 0.0) + log(1.0 + exp(-abs(z))); }
fn swooshL(v: f32) -> f32 { return logaddexp0(v - 4.0) - 0.08 * v - 0.035; }
fn swooshR(v: f32) -> f32 { return logaddexp0(v - 1.0) - 0.08 * v - 0.313261687; }`;

const INDEX = `let n = g.x + g.y * 65535u * ${WG}u;`;

/**
 * y[t, o] (+)= act(scale * sum_i x[t, i] w[i, o] + bias[o]); w int8 [I, O] read as u32 = 4 consecutive outputs.
 * One workgroup = 4 outputs x ROWS rows; its 64 threads split i and add their sums in workgroup memory.
 */
export const LINEAR = `${SWOOSH}
struct P { T: u32, I: u32, O4: u32, act: u32, res: u32, scale: f32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<u32>;
@group(0) @binding(3) var<storage, read> bias: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> y: array<vec4<f32>>;
var<workgroup> part: array<array<vec4<f32>, ${ROWS}>, ${WG}>;
@compute @workgroup_size(${WG}) fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let n = wg.x + wg.y * 65535u;
  let o4 = n % p.O4;
  let t0 = (n / p.O4) * ${ROWS}u;
  let valid = t0 < p.T;
  let rows = select(0u, min(${ROWS}u, p.T - t0), valid);
  var acc: array<vec4<f32>, ${ROWS}>;
  for (var i = li; i < p.I; i += ${WG}u) {
    let u = bitcast<i32>(w[i * p.O4 + o4]);
    let wv = vec4<f32>(f32((u << 24u) >> 24u), f32((u << 16u) >> 24u), f32((u << 8u) >> 24u), f32(u >> 24u));
    for (var r = 0u; r < rows; r++) { acc[r] += x[(t0 + r) * p.I + i] * wv; }
  }
  part[li] = acc;
  workgroupBarrier();
  for (var k = ${WG / 2}u; k > 0u; k >>= 1u) {
    if (li < k) { for (var r = 0u; r < ${ROWS}u; r++) { part[li][r] += part[li + k][r]; } }
    workgroupBarrier();
  }
  if (li >= rows) { return; }
  var v = part[0][li] * p.scale + bias[o4];
  if (p.act == 1u) { v = vec4<f32>(swooshL(v.x), swooshL(v.y), swooshL(v.z), swooshL(v.w)); }
  let k = (t0 + li) * p.O4 + o4;
  if (p.res == 1u) { y[k] += v; } else { y[k] = v; }
}`;

/** s[h, i, j] = q_i . k_j + p_i . pe[T-1-i+j] (qkp: [T, H*32 | H*32 | H*4], pe: [2T-1, H*4]) */
const SCORES = `
struct P { T: u32, H: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> qkp: array<f32>;
@group(0) @binding(2) var<storage, read> pe: array<f32>;
@group(0) @binding(3) var<storage, read_write> s: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  if (n >= p.H * p.T * p.T) { return; }
  let h = n / (p.T * p.T);
  let i = (n / p.T) % p.T;
  let j = n % p.T;
  let O = p.H * ${2 * QUERY_HEAD_DIM + POS_HEAD_DIM}u;
  var acc = 0.0;
  for (var c = 0u; c < ${QUERY_HEAD_DIM}u; c++) {
    acc += qkp[i * O + h * ${QUERY_HEAD_DIM}u + c] * qkp[j * O + (p.H + h) * ${QUERY_HEAD_DIM}u + c];
  }
  let r = p.T - 1u - i + j;
  for (var c = 0u; c < ${POS_HEAD_DIM}u; c++) {
    acc += qkp[i * O + p.H * ${2 * QUERY_HEAD_DIM}u + h * ${POS_HEAD_DIM}u + c] * pe[(r * p.H + h) * ${POS_HEAD_DIM}u + c];
  }
  s[n] = acc;
}`;

const SOFTMAX = `
struct P { T: u32, H: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> s: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  if (n >= p.H * p.T) { return; }
  let b = n * p.T;
  var m = s[b];
  for (var j = 1u; j < p.T; j++) { m = max(m, s[b + j]); }
  var sum = 0.0;
  for (var j = 0u; j < p.T; j++) { let e = exp(s[b + j] - m); s[b + j] = e; sum += e; }
  for (var j = 0u; j < p.T; j++) { s[b + j] /= sum; }
}`;

/** o[i, h*DV + c] = sum_j s[h, i, j] v[j, h*DV + c] */
const APPLY = `
struct P { T: u32, H: u32, DV: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> s: array<f32>;
@group(0) @binding(2) var<storage, read> v: array<f32>;
@group(0) @binding(3) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  let W = p.H * p.DV;
  if (n >= p.T * W) { return; }
  let i = n / W;
  let c = n % W;
  let h = c / p.DV;
  var acc = 0.0;
  for (var j = 0u; j < p.T; j++) { acc += s[(h * p.T + i) * p.T + j] * v[j * W + c]; }
  o[n] = acc;
}`;

/** NonlinAttention middle: y = [s | v | g] [T, 3*HID]; z[i, c] = g[i, c] * sum_j s0[i, j] v[j, c] tanh(s[j, c]) */
const NONLIN = `
struct P { T: u32, HID: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> s0: array<f32>;
@group(0) @binding(2) var<storage, read> y: array<f32>;
@group(0) @binding(3) var<storage, read_write> z: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  if (n >= p.T * p.HID) { return; }
  let i = n / p.HID;
  let c = n % p.HID;
  let W = 3u * p.HID;
  var acc = 0.0;
  // Metal's tanh can overflow for |x| > 44; saturation is already exact to f32 here.
  for (var j = 0u; j < p.T; j++) { acc += s0[i * p.T + j] * y[j * W + p.HID + c] * tanh(clamp(y[j * W + c], -10.0, 10.0)); }
  z[n] = acc * y[i * W + 2u * p.HID + c];
}`;

/** ConvolutionModule middle: y = [a | s] [T, 2D]; z[t, c] = swooshR(b[c] + sum_k w[c, k] (a * sigmoid(s))[t + k - K/2, c]) */
const CONV = `${SWOOSH}
struct P { T: u32, D: u32, K: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> y: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f32>;
@group(0) @binding(3) var<storage, read> b: array<f32>;
@group(0) @binding(4) var<storage, read_write> z: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  if (n >= p.T * p.D) { return; }
  let t = i32(n / p.D);
  let c = n % p.D;
  var acc = b[c];
  for (var k = 0u; k < p.K; k++) {
    let tt = t + i32(k) - i32(p.K / 2u);
    if (tt < 0 || tt >= i32(p.T)) { continue; }
    let r = u32(tt) * 2u * p.D;
    acc += w[c * p.K + k] * y[r + c] / (1.0 + exp(-y[r + p.D + c]));
  }
  z[n] = swooshR(acc);
}`;

const COPY = `
struct P { N: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  if (n < p.N) { y[n] = x[n]; }
}`;

/** x = orig + (x - orig) * scale[c] */
const BYPASS = `
struct P { T: u32, D: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> orig: array<f32>;
@group(0) @binding(2) var<storage, read> scale: array<f32>;
@group(0) @binding(3) var<storage, read_write> x: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  if (n >= p.T * p.D) { return; }
  x[n] = orig[n] + (x[n] - orig[n]) * scale[n % p.D];
}`;

/** The layer's end, one thread per row: x = orig + (BiasNorm(x) - orig) * scale[c] */
const NORM_BYPASS = `
struct P { T: u32, D: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> orig: array<f32>;
@group(0) @binding(2) var<storage, read> scale: array<f32>;
@group(0) @binding(3) var<storage, read> nb: array<f32>;
@group(0) @binding(4) var<storage, read> ls: array<f32>;
@group(0) @binding(5) var<storage, read_write> x: array<f32>;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  ${INDEX}
  if (n >= p.T) { return; }
  let r = n * p.D;
  var m = 0.0;
  for (var c = 0u; c < p.D; c++) { let d = x[r + c] - nb[c]; m += d * d; }
  let f = inverseSqrt(m / f32(p.D)) * exp(ls[0]);
  for (var c = 0u; c < p.D; c++) { x[r + c] = orig[r + c] + (x[r + c] * f - orig[r + c]) * scale[c]; }
}`;

// DynamicQuantizeLinear is over the entire input tensor, not individual rows.
export const QUANT_RANGE = `
struct P { N: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> q: array<f32>;
var<workgroup> lows: array<f32, 64>;
var<workgroup> highs: array<f32, 64>;
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) li: u32) {
  var lo = 0.0; var hi = 0.0;
  for (var i = li; i < p.N; i += 64u) { lo = min(lo, x[i]); hi = max(hi, x[i]); }
  lows[li] = lo; highs[li] = hi;
  workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) {
    if (li < k) { lows[li] = min(lows[li], lows[li+k]); highs[li] = max(highs[li], highs[li+k]); }
    workgroupBarrier();
  }
  if (li == 0u) {
    let scale = (highs[0] - lows[0]) / 255.0;
    q[0] = scale;
    q[1] = select(0.0, clamp(round(-lows[0] / scale), 0.0, 255.0), scale != 0.0);
  }
}`;

export const QUANT_LINEAR = LINEAR
  .replace('@group(0) @binding(4) var<storage, read_write> y: array<vec4<f32>>;',
    '@group(0) @binding(4) var<storage, read_write> y: array<vec4<f32>>;\n@group(0) @binding(5) var<storage, read> quant: array<f32>;')
  .replace('array<array<vec4<f32>,', 'array<array<vec4<i32>,')
  .replace('var acc: array<vec4<f32>,', 'var acc: array<vec4<i32>,')
  .replace('let wv = vec4<f32>(f32((u << 24u) >> 24u), f32((u << 16u) >> 24u), f32((u << 8u) >> 24u), f32(u >> 24u));',
    'let wv = vec4<i32>((u << 24u) >> 24u, (u << 16u) >> 24u, (u << 8u) >> 24u, u >> 24u);')
  .replace('acc[r] += x[(t0 + r) * p.I + i] * wv;',
    'let value = x[(t0 + r) * p.I + i]; let qx = select(0.0, clamp(round(value / quant[0]) + quant[1], 0.0, 255.0), quant[0] != 0.0); acc[r] += i32(qx - quant[1]) * wv;')
  .replace('part[0][li] * p.scale', 'vec4<f32>(part[0][li]) * (p.scale * quant[0])');

export interface Tensor { data: ArrayBuffer; offset: number; bytes: number; shape: number[]; scale?: number }

/** stack<i>.wgq: uint32 header length, JSON {"tensors": {name: {offset (bytes), shape, dtype, scale}}}, data. */
export async function loadStackWeights(url: string): Promise<{ tensors: Record<string, Tensor>; bytes: number }> {
  const res = await modelFetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const hl = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))) as
    { tensors: Record<string, { offset: number; shape: number[]; dtype: 'i8' | 'f32'; scale?: number }> };
  const tensors: Record<string, Tensor> = {};
  for (const [name, t] of Object.entries(head.tensors)) {
    const n = t.shape.reduce((a, b) => a * b, 1) * (t.dtype === 'i8' ? 1 : 4);
    tensors[name] = { data: buf, offset: 4 + hl + t.offset, bytes: n, shape: t.shape, ...(t.scale !== undefined ? { scale: t.scale } : {}) };
  }
  return { tensors, bytes: buf.byteLength };
}

/** CompactRelPositionalEncoding rows for offsets -(T-1) .. T-1, [2T-1, 48]. */
export function relPosEmb(T: number): Float32Array {
  const pe = new Float32Array((2 * T - 1) * POS_DIM);
  const cl = Math.sqrt(POS_DIM);
  for (let r = 0; r < 2 * T - 1; r++) {
    const x = r - (T - 1);
    const xc = cl * Math.sign(x) * (Math.log(Math.abs(x) + cl) - Math.log(cl));
    const xa = Math.atan(xc / (POS_DIM / (2 * Math.PI)));
    for (let f = 0; f < POS_DIM / 2; f++) {
      pe[r * POS_DIM + 2 * f] = Math.cos(xa * (f + 1));
      pe[r * POS_DIM + 2 * f + 1] = Math.sin(xa * (f + 1));
    }
    pe[r * POS_DIM + POS_DIM - 1] = 1;
  }
  return pe;
}

interface Step { pipeline: GpuPipeline; bind: GpuBindGroup; uniform: GpuBuffer; params: () => ArrayBuffer; threads: () => number }

export function uniformData(fields: (number | { f: number })[]): ArrayBuffer {
  const n = Math.ceil(fields.length / 4) * 4;
  const b = new ArrayBuffer(n * 4);
  const u = new Uint32Array(b);
  const f = new Float32Array(b);
  fields.forEach((v, i) => { if (typeof v === 'number') u[i] = v; else f[i] = v.f; });
  return b;
}

/** The layers of one encoder stack (input already downsampled to this stack's frame rate). */
export class WgslEncoderStack {
  private readonly pipelines: Record<string, GpuPipeline> = {};
  private readonly weights = new Map<string, GpuBuffer>();
  private readonly scales = new Map<string, number>();
  private readonly shapes = new Map<string, number[]>();
  private steps: Step[] = [];
  private T = 0;
  private x!: GpuBuffer;
  private pos!: GpuBuffer;
  private read!: GpuBuffer;
  /** Bytes of every buffer created here. */
  bytes = 0;
  private readonly allocated: GpuBuffer[] = [];

  private constructor(readonly device: GpuDevice, readonly dim: number, readonly heads: number, readonly layers: number,
    readonly kernel: number, readonly maxT: number, readonly quantized = false) {}

  static async create(device: GpuDevice, url: string, s: { dim: number; heads: number; layers: number; kernel: number; maxT: number; quantized?: boolean }): Promise<{ stack: WgslEncoderStack; fileBytes: number }> {
    const m = new WgslEncoderStack(device, s.dim, s.heads, s.layers, s.kernel, s.maxT, s.quantized);
    const { tensors, bytes } = await loadStackWeights(url);
    const codes = { quantRange: QUANT_RANGE, linear: m.quantized ? QUANT_LINEAR : LINEAR, scores: SCORES, softmax: SOFTMAX, apply: APPLY, nonlin: NONLIN, conv: CONV, copy: COPY, bypass: BYPASS, normBypass: NORM_BYPASS };
    for (const [name, code] of Object.entries(codes)) {
      m.pipelines[name] = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
    }
    for (const [name, t] of Object.entries(tensors)) {
      m.weights.set(name, m.upload(new Uint8Array(t.data, t.offset, t.bytes)));
      m.shapes.set(name, t.shape);
      if (t.scale !== undefined) m.scales.set(name, t.scale);
    }
    m.build();
    return { stack: m, fileBytes: bytes };
  }

  private buffer(size: number, usage: number): GpuBuffer {
    const s = Math.ceil(size / 16) * 16;
    this.bytes += s;
    const b = this.device.createBuffer({ size: s, usage });
    this.allocated.push(b);
    return b;
  }

  private upload(data: Uint8Array): GpuBuffer {
    const b = this.buffer(data.byteLength, STORAGE | COPY_DST);
    const padded = data.byteLength % 4 === 0 ? data : (() => { const c = new Uint8Array(Math.ceil(data.byteLength / 4) * 4); c.set(data); return c; })();
    this.device.queue.writeBuffer(b, 0, padded.buffer, padded.byteOffset, padded.byteLength);
    return b;
  }

  private step(name: string, buffers: GpuBuffer[], params: () => ArrayBuffer, threads: () => number): Step {
    const pipeline = this.pipelines[name];
    const uniform = this.buffer(64, UNIFORM | COPY_DST);
    const bind = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [uniform, ...buffers].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    return { pipeline, bind, uniform, params, threads };
  }

  private w(name: string): GpuBuffer {
    const b = this.weights.get(name);
    if (!b) throw new Error(`asr weight ${name} missing`);
    return b;
  }

  private build(): void {
    const D = this.dim;
    const H = this.heads;
    const maxT = this.maxT;
    const T = (): number => this.T;
    let widest = 0;
    for (const [name] of this.weights) if (name.endsWith('.w') && this.scales.has(name)) widest = Math.max(widest, this.outDim(name));
    this.x = this.buffer(maxT * D * 4, STORAGE | COPY_DST | COPY_SRC);
    this.pos = this.buffer((2 * maxT - 1) * POS_DIM * 4, STORAGE | COPY_DST);
    this.read = this.buffer(maxT * D * 4, MAP_READ | COPY_DST);
    const orig = this.buffer(maxT * D * 4, STORAGE);
    const A = this.buffer(maxT * widest * 4, STORAGE);
    const Z = this.buffer(maxT * Math.max(D, widest) * 4, STORAGE);
    const qkp = this.buffer(maxT * H * (2 * QUERY_HEAD_DIM + POS_HEAD_DIM) * 4, STORAGE);
    const pe = this.buffer((2 * maxT - 1) * H * POS_HEAD_DIM * 4, STORAGE);
    const S = this.buffer(H * maxT * maxT * 4, STORAGE);
    const quant = this.buffer(16, STORAGE);
    const linear = (x: GpuBuffer, name: string, y: GpuBuffer, act: number, res: number, rows: () => number = T): Step[] => {
      const I = this.inDim(`${name}.w`);
      const O = this.outDim(`${name}.w`);
      const scale = this.scales.get(`${name}.w`)!;
      const buffers = [x, this.w(`${name}.w`), this.w(`${name}.b`), y];
      const steps: Step[] = [];
      if (this.quantized) {
        steps.push(this.step('quantRange', [x, quant], () => uniformData([rows() * I]), () => WG));
        buffers.push(quant);
      }
      steps.push(this.step('linear', buffers,
        () => uniformData([rows(), I, O / 4, act, res, { f: scale }]), () => (O / 4) * Math.ceil(rows() / ROWS) * WG));
      return steps;
    };
    const s: Step[] = [];
    for (let l = 0; l < this.layers; l++) {
      const L = `${l}.`;
      const ff = (k: string): void => { s.push(...linear(this.x, `${L}${k}/in_proj`, A, 1, 0), ...linear(A, `${L}${k}/out_proj`, this.x, 0, 1)); };
      const sa = (k: string): void => {
        const dv = this.outDim(`${L}${k}/in_proj.w`) / H;
        s.push(...linear(this.x, `${L}${k}/in_proj`, A, 0, 0),
          this.step('apply', [S, A, Z], () => uniformData([T(), H, dv]), () => T() * H * dv),
          ...linear(Z, `${L}${k}/out_proj`, this.x, 0, 1));
      };
      const conv = (k: string): void => {
        s.push(...linear(this.x, `${L}${k}/in_proj`, A, 0, 0),
          this.step('conv', [A, this.w(`${L}${k}.dw.w`), this.w(`${L}${k}.dw.b`), Z], () => uniformData([T(), D, this.kernel]), () => T() * D),
          ...linear(Z, `${L}${k}/out_proj`, this.x, 0, 1));
      };
      s.push(this.step('copy', [this.x, orig], () => uniformData([T() * D]), () => T() * D));
      s.push(...linear(this.x, `${L}self_attn_weights/in_proj`, qkp, 0, 0));
      s.push(...linear(this.pos, `${L}self_attn_weights/linear_pos`, pe, 0, 0, () => 2 * T() - 1));
      s.push(this.step('scores', [qkp, pe, S], () => uniformData([T(), H]), () => H * T() * T()));
      s.push(this.step('softmax', [S], () => uniformData([T(), H]), () => H * T()));
      ff('feed_forward1');
      const hid = this.outDim(`${L}nonlin_attention/in_proj.w`) / 3;
      s.push(...linear(this.x, `${L}nonlin_attention/in_proj`, A, 0, 0),
        this.step('nonlin', [S, A, Z], () => uniformData([T(), hid]), () => T() * hid),
        ...linear(Z, `${L}nonlin_attention/out_proj`, this.x, 0, 1));
      sa('self_attn1');
      conv('conv_module1');
      ff('feed_forward2');
      s.push(this.step('bypass', [orig, this.w(`${L}bypass_mid`), this.x], () => uniformData([T(), D]), () => T() * D));
      sa('self_attn2');
      conv('conv_module2');
      ff('feed_forward3');
      s.push(this.step('normBypass', [orig, this.w(`${L}bypass`), this.w(`${L}norm.bias`), this.w(`${L}norm.log_scale`), this.x],
        () => uniformData([T(), D]), () => T()));
    }
    this.steps = s;
  }

  private inDim(name: string): number { return this.shapeOf(name)[0]!; }
  private outDim(name: string): number { return this.shapeOf(name)[1]!; }
  private shapeOf(name: string): number[] {
    const s = this.shapes.get(name);
    if (!s) throw new Error(`asr weight shape ${name} missing`);
    return s;
  }

  /** GPU input/output avoids intermediate readbacks in the full encoder. */
  runBuffer(input: GpuBuffer, T: number): GpuBuffer {
    if (T < 1 || T > this.maxT) throw new Error(`asr stack T ${T} outside 1..${this.maxT}`);
    this.T = T;
    const copy = this.device.createCommandEncoder();
    copy.copyBufferToBuffer(input, 0, this.x, 0, T * this.dim * 4);
    this.device.queue.submit([copy.finish()]);
    const pos = relPosEmb(T);
    this.device.queue.writeBuffer(this.pos, 0, pos.buffer, 0, pos.byteLength);
    for (const st of this.steps) this.device.queue.writeBuffer(st.uniform, 0, st.params());
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    for (const st of this.steps) {
      const groups = Math.ceil(st.threads() / WG);
      pass.setPipeline(st.pipeline);
      pass.setBindGroup(0, st.bind);
      pass.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
    }
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return this.x;
  }

  destroy(): void { for (const b of this.allocated) b.destroy(); }

  /** x [T, dim] (this stack's input) -> the stack's layers' output [T, dim]. */
  async run(x: Float32Array, T: number): Promise<Float32Array> {
    if (x.length !== T * this.dim || T < 1 || T > this.maxT) throw new Error('Invalid ASR stack input shape');
    const input = this.device.createBuffer({ size: x.byteLength, usage: STORAGE | COPY_DST | COPY_SRC });
    this.device.queue.writeBuffer(input, 0, x.buffer, x.byteOffset, x.byteLength);
    this.runBuffer(input, T);
    const enc = this.device.createCommandEncoder();
    const bytes = T * this.dim * 4;
    enc.copyBufferToBuffer(this.x, 0, this.read, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    input.destroy();
    await this.read.mapAsync(1, 0, bytes);
    const r = new Float32Array(this.read.getMappedRange(0, bytes).slice(0));
    this.read.unmap();
    return r;
  }
}
