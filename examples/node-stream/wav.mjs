// Reads a WAV file (PCM 16-bit or float 32-bit, mono or stereo) as { pcm: Float32Array (mono), sampleRate }.
import { readFileSync } from 'node:fs';

export function readWav(file) {
  const b = readFileSync(file);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV file`);
  let p = 12, fmt = 0, ch = 0, rate = 0, bits = 0, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), n = dv.getUint32(p + 4, true);
    if (id === 'fmt ') { fmt = dv.getUint16(p + 8, true); ch = dv.getUint16(p + 10, true); rate = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); }
    if (id === 'data') data = { off: p + 8, n: Math.min(n, b.length - p - 8) };
    p += 8 + n + (n & 1);
  }
  if (!data || !((fmt === 1 && bits === 16) || (fmt === 3 && bits === 32) || fmt === 0xfffe)) throw new Error(`${file}: only 16-bit PCM or 32-bit float WAV`);
  const bytes = bits / 8, frames = Math.floor(data.n / bytes / ch);
  const pcm = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) { const o = data.off + (i * ch + c) * bytes; s += bits === 16 ? dv.getInt16(o, true) / 32768 : dv.getFloat32(o, true); }
    pcm[i] = s / ch;
  }
  return { pcm, sampleRate: rate };
}
