import { modelFetch } from './fetch.js';
// Offline Japanese speech recognizer (ReazonSpeech k2-v2 zipformer transducer, Apache-2.0) on WebGPU.
// Model inference is WGSL only; CPU work is fbank, scheduling and greedy token control.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { WgslEncoderStack, loadStackWeights, QUANT_LINEAR, QUANT_RANGE, SWOOSH, uniformData, type Tensor } from './wgsl-stack.js';
import { asrFbank } from './fbank.js';

type Buffer = any;
type Device = any;
interface Mat { b: Buffer; T: number; D: number }
interface Meta { dims: number[]; downsample: number[]; layers: number[]; heads: number[]; kernels: number[]; tokens: Record<string, string>; blank: number; context: number }
const STORAGE = 128, COPY_DST = 8, COPY_SRC = 4, UNIFORM = 64, MAP_READ = 1;
const INDEX = 'let n = g.x + g.y * 65535u * 64u;';
const shaders: Record<string, string> = {
  linear: QUANT_LINEAR,
  quant: QUANT_RANGE,
  conv2d: `${SWOOSH}
struct P { C:u32,H:u32,W:u32,O:u32,KH:u32,KW:u32,SH:u32,SW:u32,PH:u32,PW:u32,G:u32,OH:u32,OW:u32,ACT:u32 }
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read> w:array<f32>;
@group(0) @binding(3) var<storage,read> b:array<f32>;
@group(0) @binding(4) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>) {
  ${INDEX} if(n>=p.O*p.OH*p.OW){return;}
  let o=n/(p.OH*p.OW); let h=(n/p.OW)%p.OH; let col=n%p.OW;
  let cg=p.C/p.G; let group=o/(p.O/p.G); var sum=b[o];
  for(var c=0u;c<cg;c++){for(var kh=0u;kh<p.KH;kh++){for(var kw=0u;kw<p.KW;kw++){
    let ih=i32(h*p.SH+kh)-i32(p.PH); let iw=i32(col*p.SW+kw)-i32(p.PW);
    if(ih>=0 && ih<i32(p.H) && iw>=0 && iw<i32(p.W)){
      sum+=x[((group*cg+c)*p.H+u32(ih))*p.W+u32(iw)]*w[((o*cg+c)*p.KH+kh)*p.KW+kw];
    }
  }}}
  if(p.ACT==1u){sum=swooshR(sum);} if(p.ACT==2u){sum=swooshL(sum);} y[n]=sum;
}`,
  add: `struct P{N:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> a:array<f32>;
@group(0) @binding(2) var<storage,read> b:array<f32>;
@group(0) @binding(3) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX} if(n<p.N){y[n]=a[n]+b[n];}}`,
  flatten: `struct P{C:u32,T:u32,F:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX}
if(n<p.C*p.T*p.F){let t=n/(p.C*p.F); let c=(n/p.F)%p.C; let f=n%p.F; y[n]=x[(c*p.T+t)*p.F+f];}}`,
  norm: `struct P{T:u32,D:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read> b:array<f32>;
@group(0) @binding(3) var<storage,read> s:array<f32>;
@group(0) @binding(4) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX} if(n>=p.T){return;}
var sum=0.0;for(var c=0u;c<p.D;c++){let v=x[n*p.D+c]-b[c];sum+=v*v;}
let scale=inverseSqrt(sum/f32(p.D))*exp(s[0]);for(var c=0u;c<p.D;c++){y[n*p.D+c]=x[n*p.D+c]*scale;}}`,
  resize: `struct P{T:u32,I:u32,O:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX}
if(n<p.T*p.O){let c=n%p.O;var v=0.0;if(c<p.I){v=x[(n/p.O)*p.I+c];}y[n]=v;}}`,
  down: `struct P{T:u32,D:u32,S:u32,N:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read> w:array<f32>;
@group(0) @binding(3) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX} if(n>=p.N*p.D){return;}
let t=n/p.D;let c=n%p.D;var sum=0.0;for(var k=0u;k<p.S;k++){sum+=x[min(t*p.S+k,p.T-1u)*p.D+c]*w[k];}y[n]=sum;}`,
  up: `struct P{T:u32,D:u32,S:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> orig:array<f32>;
@group(0) @binding(2) var<storage,read> x:array<f32>;
@group(0) @binding(3) var<storage,read> scale:array<f32>;
@group(0) @binding(4) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX}
if(n<p.T*p.D){y[n]=orig[n]+(x[((n/p.D)/p.S)*p.D+n%p.D]-orig[n])*scale[n%p.D];}}`,
  gather: `struct P{T:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> last:array<f32>;
@group(0) @binding(2) var<storage,read> mid:array<f32>;
@group(0) @binding(3) var<storage,read> wide:array<f32>;
@group(0) @binding(4) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX} if(n>=p.T*768u){return;}
let t=n/768u;let c=n%768u;var v=0.0;
if(c<256u){v=last[t*256u+c];}else if(c<512u){v=mid[t*512u+c];}else{v=wide[t*768u+c];}y[n]=v;}`,
  decoder: `struct P{A:i32,B:i32,S:f32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> emb:array<u32>;
@group(0) @binding(2) var<storage,read> w:array<f32>;
@group(0) @binding(3) var<storage,read_write> y:array<f32>;
fn embedding(index:u32)->f32 { let u=bitcast<i32>(emb[index/4u]); return f32((u << ((3u-index%4u)*8u)) >> 24u)*p.S; }
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX} if(n>=512u){return;}
let group=n/4u;var sum=0.0;for(var i=0u;i<4u;i++){
 if(p.A>=0){sum+=embedding(u32(p.A)*512u+group*4u+i)*w[(n*4u+i)*2u];}
 if(p.B>=0){sum+=embedding(u32(p.B)*512u+group*4u+i)*w[(n*4u+i)*2u+1u];}
}y[n]=max(sum,0.0);}`,
  join: `struct P{T:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> enc:array<f32>;
@group(0) @binding(2) var<storage,read> dec:array<f32>;
@group(0) @binding(3) var<storage,read_write> y:array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3<u32>){${INDEX} if(n<512u){y[n]=tanh(clamp(enc[p.T*512u+n]+dec[n],-10.0,10.0));}}`,
  argmax: `struct P{N:u32}
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage,read> x:array<f32>;
@group(0) @binding(2) var<storage,read_write> y:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) li:u32){if(li!=0u){return;}
var best=0u;for(var i=1u;i<p.N;i++){if(x[i]>x[best]){best=i;}}y[0]=best;}`,
};

export interface AsrTrace { name: string; data: Float32Array; T: number; D: number }
export interface AsrResult { text: string; ids: number[]; fbankMs: number; encoderMs: number; decodeMs: number; totalMs: number; audioSeconds: number; gpuBytes: number }

export class WgslOfflineRecognizer {
  private readonly pipelines: Record<string, any> = {};
  private tensors: Record<string, Tensor> = {};
  private weights: Record<string, Buffer> = {};
  private stacks: WgslEncoderStack[] = [];
  private persistent: Buffer[] = [];
  private temporary: Buffer[] = [];
  private persistentBytes = 0;
  private temporaryBytes = 0;
  private busy = false;
  peakBytes = 0;
  downloadBytes = 0;
  private constructor(readonly device: Device, readonly meta: Meta, readonly maxFrames: number) {}

  static async create(device: Device, base: string, maxFrames = 780, progress?: (files: number, bytes: number) => void): Promise<WgslOfflineRecognizer> {
    const res = await modelFetch(`${base}/model.json`);
    if (!res.ok) throw new Error(`ASR metadata: HTTP ${res.status}`);
    const metadata = await res.arrayBuffer();
    const meta = JSON.parse(new TextDecoder().decode(metadata)) as Meta;
    const m = new WgslOfflineRecognizer(device, meta, maxFrames);
    m.downloadBytes = metadata.byteLength;
    progress?.(1, m.downloadBytes);
    try {
      for (const [name, code] of Object.entries(shaders)) {
        m.pipelines[name] = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
      }
      const loaded = await loadStackWeights(`${base}/model.wgq`);
      m.tensors = loaded.tensors;
      m.downloadBytes += loaded.bytes;
      progress?.(2, m.downloadBytes);
      for (const [name, t] of Object.entries(loaded.tensors)) {
        m.weights[name] = m.buffer(t.bytes, true);
        const data = new Uint8Array(t.data, t.offset, t.bytes);
        device.queue.writeBuffer(m.weights[name], 0, data);
      }
      // Release the downloaded backing buffers after upload; keep shapes/scales only.
      for (const t of Object.values(m.tensors)) t.data = new ArrayBuffer(0);
      for (let i = 0; i < 6; i++) {
        const { stack, fileBytes } = await WgslEncoderStack.create(device, `${base}/stack${i}.wgq`, {
          dim: meta.dims[i]!, heads: meta.heads[i]!, layers: meta.layers[i]!, kernel: meta.kernels[i]!,
          maxT: Math.ceil(Math.floor((maxFrames - 7) / 2) / meta.downsample[i]!), quantized: true,
        });
        m.stacks.push(stack); m.downloadBytes += fileBytes; m.persistentBytes += stack.bytes;
        progress?.(i + 3, m.downloadBytes);
      }
      return m;
    } catch (e) { m.destroy(); throw e; }
  }

  private buffer(bytes: number, persistent = false, usage = STORAGE | COPY_SRC | COPY_DST): Buffer {
    const size = Math.max(16, Math.ceil(bytes / 16) * 16);
    const b = this.device.createBuffer({ size, usage });
    if (persistent) { this.persistent.push(b); this.persistentBytes += size; }
    else { this.temporary.push(b); this.temporaryBytes += size; }
    this.peakBytes = Math.max(this.peakBytes, this.persistentBytes + this.temporaryBytes);
    return b;
  }

  private op(name: string, buffers: Buffer[], fields: (number | { f: number })[], threads: number): void {
    const uniform = this.buffer(64, false, UNIFORM | COPY_DST);
    this.device.queue.writeBuffer(uniform, 0, uniformData(fields));
    const pipeline = this.pipelines[name];
    const bind = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [uniform, ...buffers].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const enc = this.device.createCommandEncoder(); const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
    const groups = Math.ceil(threads / 64);
    pass.dispatchWorkgroups(Math.min(groups, 65535), Math.ceil(groups / 65535));
    pass.end(); this.device.queue.submit([enc.finish()]);
  }

  private upload(x: Float32Array): Buffer {
    const b = this.buffer(x.byteLength);
    this.device.queue.writeBuffer(b, 0, x.buffer, x.byteOffset, x.byteLength);
    return b;
  }

  private linear(x: Mat, name: string): Mat {
    const t = this.tensors[`${name}.w`];
    if (!t || t.shape[0] !== x.D) throw new Error(`ASR linear shape: ${name}`);
    const D = t.shape[1]!;
    const b = this.buffer(x.T * D * 4), q = this.buffer(16);
    this.op('quant', [x.b, q], [x.T * x.D], 64);
    this.op('linear', [x.b, this.weights[`${name}.w`], this.weights[`${name}.b`], b, q],
      [x.T, x.D, D / 4, 0, 0, { f: t.scale! }], (D / 4) * Math.ceil(x.T / 8) * 64);
    return { b, T: x.T, D };
  }

  private down(x: Mat, name: string): Mat {
    const S = this.tensors[name]!.shape[0]!, T = Math.ceil(x.T / S);
    const b = this.buffer(T * x.D * 4);
    this.op('down', [x.b, this.weights[name], b], [x.T, x.D, S, T], T * x.D);
    return { b, T, D: x.D };
  }

  private async read(b: Buffer, count: number): Promise<Float32Array> {
    const dst = this.buffer(count * 4, false, MAP_READ | COPY_DST);
    const enc = this.device.createCommandEncoder(); enc.copyBufferToBuffer(b, 0, dst, 0, count * 4);
    this.device.queue.submit([enc.finish()]); await dst.mapAsync(1, 0, count * 4);
    const data = new Float32Array(dst.getMappedRange(0, count * 4).slice(0)); dst.unmap();
    return data;
  }

  private embed(feats: Float32Array, frames: number): Mat {
    let x = this.upload(feats), C = 1, H = frames, W = 80;
    const conv = (key: string, sh = 1, sw = 1, ph = 0, pw = 0, groups = 1, act = 0): void => {
      const name = `embed.${key}`, shape = this.tensors[`${name}.weight`]!.shape;
      const [O, , KH, KW] = shape as [number, number, number, number];
      const OH = Math.floor((H + 2 * ph - KH) / sh) + 1, OW = Math.floor((W + 2 * pw - KW) / sw) + 1;
      const b = this.buffer(O * OH * OW * 4);
      this.op('conv2d', [x, this.weights[`${name}.weight`], this.weights[`${name}.bias`], b],
        [C, H, W, O, KH, KW, sh, sw, ph, pw, groups, OH, OW, act], O * OH * OW);
      x = b; C = O; H = OH; W = OW;
    };
    conv('conv.0', 1, 1, 0, 1, 1, 1);
    conv('conv.4', 2, 2, 0, 0, 1, 1);
    conv('conv.7', 1, 2, 0, 0, 1, 1);
    const bypass = x;
    conv('convnext.depthwise_conv', 1, 1, 3, 3, C);
    conv('convnext.pointwise_conv1', 1, 1, 0, 0, 1, 2);
    conv('convnext.pointwise_conv2');
    const sum = this.buffer(C * H * W * 4);
    this.op('add', [x, bypass, sum], [C * H * W], C * H * W);
    const flat = this.buffer(C * H * W * 4);
    this.op('flatten', [sum, flat], [C, H, W], C * H * W);
    const out = this.linear({ b: flat, T: H, D: C * W }, 'embed.out');
    const norm = this.buffer(out.T * out.D * 4);
    this.op('norm', [out.b, this.weights['embed.out_norm.bias'], this.weights['embed.out_norm.log_scale'], norm], [out.T, out.D], out.T);
    return { ...out, b: norm };
  }

  private decoder(ctx: number[]): Mat {
    const b = this.buffer(512 * 4);
    this.op('decoder', [this.weights['decoder.embedding'], this.weights['decoder.conv'], b],
      [...ctx.map(x => x >>> 0), { f: this.tensors['decoder.embedding']!.scale! }], 512);
    return this.linear({ b, T: 1, D: 512 }, 'decoder.proj');
  }

  /** trace adds readbacks for parity, and is intentionally excluded from timing runs. */
  async recognize(samples: Float32Array, options: { lead?: number; tail?: number; trace?: (x: AsrTrace) => void } = {}): Promise<AsrResult> {
    if (this.busy) throw new Error('ASR recognizer is already running');
    this.busy = true;
    try {
      const start = performance.now();
      const lead = options.lead ?? 0.9, tail = options.tail ?? 0.9;
      if (!Number.isFinite(lead) || !Number.isFinite(tail) || lead < 0 || tail < 0) throw new Error('Invalid ASR padding');
      const padded = new Float32Array(Math.round(lead * 16000) + samples.length + Math.round(tail * 16000));
      padded.set(samples, Math.round(lead * 16000));
      const feats = asrFbank(padded);
      if (feats.frames > this.maxFrames) throw new Error(`ASR input exceeds offline limit ${this.maxFrames} frames`);
      const fbankMs = performance.now() - start;
      const trace = async (name: string, x: Mat): Promise<void> => {
        if (options.trace) options.trace({ name, data: await this.read(x.b, x.T * x.D), T: x.T, D: x.D });
      };
      if (options.trace) options.trace({ name: 'fbank', data: feats.data, T: feats.frames, D: 80 });
      let x = this.embed(feats.data, feats.frames);
      await trace('embed', x);
      const outputs: Mat[] = [];
      for (let i = 0; i < 6; i++) {
        const D = this.meta.dims[i]!;
        if (D !== x.D) {
          const b = this.buffer(x.T * D * 4);
          this.op('resize', [x.b, b], [x.T, x.D, D], x.T * D);
          x = { b, T: x.T, D };
        }
        const orig = x, ds = this.meta.downsample[i]!;
        if (ds > 1) x = this.down(x, `stack${i}.down`);
        await trace(`stack${i}.input`, x);
        x = { ...x, b: this.stacks[i]!.runBuffer(x.b, x.T) };
        await trace(`stack${i}.layers`, x);
        if (ds > 1) {
          const b = this.buffer(orig.T * D * 4);
          this.op('up', [orig.b, x.b, this.weights[`stack${i}.combiner`], b], [orig.T, D, ds], orig.T * D);
          x = { b, T: orig.T, D };
        }
        outputs.push(x);
        await trace(`stack${i}`, x);
      }
      const gathered = this.buffer(x.T * 768 * 4);
      this.op('gather', [outputs[5]!.b, outputs[4]!.b, outputs[3]!.b, gathered], [x.T], x.T * 768);
      x = this.linear(this.down({ b: gathered, T: x.T, D: 768 }, 'encoder.out_down'), 'encoder.proj');
      await trace('encoder', x);
      await this.device.queue.onSubmittedWorkDone();
      const encoderMs = performance.now() - start - fbankMs;
      const decodeStart = performance.now();
      const hyp = [-1, this.meta.blank], ids: number[] = [];
      const unk = Object.entries(this.meta.tokens).find(([, text]) => text === '<unk>')?.[0];
      let dec = this.decoder(hyp);
      for (let t = 0; t < x.T; t++) {
        const joined = this.buffer(512 * 4);
        this.op('join', [x.b, dec.b, joined], [t], 512);
        const logits = this.linear({ b: joined, T: 1, D: 512 }, 'joiner.out');
        const arg = this.buffer(4);
        this.op('argmax', [logits.b, arg], [logits.D], 64);
        const raw = await this.read(arg, 1);
        const id = new Uint32Array(raw.buffer)[0]!;
        if (id !== this.meta.blank && id !== Number(unk ?? -1)) {
          hyp.push(id); ids.push(id); dec = this.decoder(hyp.slice(-2));
        }
      }
      const decodeMs = performance.now() - decodeStart;
      return { text: ids.map(i => this.meta.tokens[String(i)]!).join('').trim(), ids, fbankMs, encoderMs, decodeMs,
        totalMs: performance.now() - start, audioSeconds: samples.length / 16000, gpuBytes: this.peakBytes };
    } finally {
      await this.device.queue.onSubmittedWorkDone();
      for (const b of this.temporary) b.destroy();
      this.temporary = []; this.temporaryBytes = 0; this.busy = false;
    }
  }

  destroy(): void {
    for (const s of this.stacks) s.destroy();
    for (const b of [...this.persistent, ...this.temporary]) b.destroy();
  }
}
