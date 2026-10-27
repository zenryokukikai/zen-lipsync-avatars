// Kaldi-native-fbank parameters (as in the upstream recognizer): 16kHz, 80 bins, 25/10ms,
// snip_edges=false, no dither, DC removal, 0.97 preemphasis, Povey window.
const FFT = 512;
const LENGTH = 400;
const SHIFT = 160;
const BINS = 80;
const f32 = Math.fround;
const PREEMPH = f32(0.97);
const window = Float32Array.from({ length: LENGTH }, (_, i) => (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (LENGTH - 1))) ** 0.85);
const mel = (f: number): number => 1127 * Math.log(1 + f / 700);
const lo = mel(20);
const delta = (mel(7600) - lo) / (BINS + 1);
const banks = Array.from({ length: BINS }, (_, b) => Float32Array.from({ length: FFT / 2 + 1 }, (_, k) => {
  if (k === FFT / 2) return 0;
  const m = mel(k * 16000 / FFT);
  return Math.max(0, Math.min((m - lo - b * delta) / delta, (lo + (b + 2) * delta - m) / delta));
}));

function fftPower(input: Float32Array): Float32Array {
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) {
    let j = 0;
    for (let b = i, k = 0; k < 9; k++, b >>= 1) j = (j << 1) | (b & 1);
    re[j] = input[i] ?? 0;
  }
  for (let n = 2; n <= FFT; n *= 2) {
    for (let base = 0; base < FFT; base += n) {
      for (let k = 0; k < n / 2; k++) {
        const c = Math.cos(-2 * Math.PI * k / n);
        const s = Math.sin(-2 * Math.PI * k / n);
        const a = base + k;
        const b = a + n / 2;
        const r = re[b]! * c - im[b]! * s;
        const v = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - r; im[b] = im[a]! - v;
        re[a] = re[a]! + r; im[a] = im[a]! + v;
      }
    }
  }
  return Float32Array.from({ length: FFT / 2 + 1 }, (_, i) => re[i]! ** 2 + im[i]! ** 2);
}

export function asrFbank(samples: Float32Array): { data: Float32Array; frames: number } {
  if (samples.length < LENGTH) throw new Error('ASR requires at least 25ms of 16kHz mono PCM');
  const frames = Math.floor((samples.length + SHIFT / 2) / SHIFT);
  const data = new Float32Array(frames * BINS);
  const frame = new Float32Array(LENGTH);
  for (let t = 0; t < frames; t++) {
    let mean = 0;
    for (let j = 0; j < LENGTH; j++) {
      let i = t * SHIFT + SHIFT / 2 - LENGTH / 2 + j;
      if (i < 0) i = -i - 1;
      if (i >= samples.length) i = 2 * samples.length - 1 - i;
      frame[j] = samples[i]!;
      mean += frame[j]!;
    }
    mean = f32(mean / LENGTH);
    for (let j = 0; j < LENGTH; j++) frame[j] = f32(frame[j]! - mean);
    for (let j = LENGTH - 1; j > 0; j--) frame[j] = f32(frame[j]! - f32(PREEMPH * frame[j - 1]!));
    frame[0] = f32(frame[0]! - f32(PREEMPH * frame[0]!));
    for (let j = 0; j < LENGTH; j++) frame[j] = f32(frame[j]! * window[j]!);
    const power = fftPower(frame);
    for (let b = 0; b < BINS; b++) {
      let sum = 0;
      for (let k = 0; k <= FFT / 2; k++) sum += power[k]! * banks[b]![k]!;
      data[t * BINS + b] = Math.log(Math.max(f32(sum), 2 ** -23));
    }
  }
  return { data, frames };
}

/** Strict PCM16 WAV reader: benchmarks never play audio or silently resample it. */
export function asrReadWav(buffer: ArrayBuffer): Float32Array {
  const v = new DataView(buffer);
  const tag = (at: number): string => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Expected PCM16 WAV');
  let valid = false;
  let pcm: Float32Array | undefined;
  for (let off = 12; off + 8 <= buffer.byteLength;) {
    const size = v.getUint32(off + 4, true);
    const data = off + 8;
    if (data + size > buffer.byteLength) throw new Error('Truncated WAV');
    if (tag(off) === 'fmt ') {
      valid = size >= 16 && v.getUint16(data, true) === 1 && v.getUint16(data + 2, true) === 1 &&
        v.getUint32(data + 4, true) === 16000 && v.getUint16(data + 14, true) === 16;
    }
    if (tag(off) === 'data') {
      if (size % 2) throw new Error('Invalid PCM16 data');
      pcm = Float32Array.from({ length: size / 2 }, (_, i) => v.getInt16(data + i * 2, true) / 32768);
    }
    off = data + size + size % 2;
  }
  if (!valid || !pcm) throw new Error('Expected 16kHz mono PCM16 WAV');
  return pcm;
}
