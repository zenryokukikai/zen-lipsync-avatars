// Lip-sync only, on the CPU (no speech synthesis). Measures one avatar pack against one WAV file: how long the frames
// take, per frame and per second of speech, and how long the first frame takes.
//   node scripts/bench-lipsync.mjs [wav] [--avatar marine] [--backend auto|cpu-native|cpu-wasm] [--chunk 1.0] [--out file.json]
// Two passes: the whole file at once (one chunk), and as 1-second chunks, the way streamed speech arrives. The second
// pass is what a conversation sees: the first frame comes after one short chunk, not after the whole utterance.
// Default WAV: the avatar pack's own sample.wav. Pin one core:  taskset -c 0 node scripts/bench-lipsync.mjs
// Output (console + JSON): kernel, audioSec, frames, workMs, msPerFrame, framesPerSec, rtf, firstFrameMs, and the same
// under chunked (firstFrameMs there is the one a conversation sees).
// rtf = work time / audio length: below 1 is faster than real time. frames are 25 per second of speech.
// One warm-up pass runs first (0.5 s of the audio) so that the first-frame number is the steady state, not the first load.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from '@zenryokukikai/zen-lipsync/node';

const FPS = 25;

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV`);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4), body = off + 8;
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    else if (id === 'data') data = b.subarray(body, body + size);
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${file}: no fmt/data chunk`);
  const { format, channels, sampleRate, bits } = fmt;
  const n = Math.floor(data.length / (channels * (bits / 8)));
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * (bits / 8);
      sum += format === 3 && bits === 32 ? data.readFloatLE(o) : bits === 16 ? data.readInt16LE(o) / 32768 : bits === 24 ? data.readIntLE(o, 3) / 8388608 : data[o] / 128 - 1;
    }
    pcm[i] = sum / channels;
  }
  return { pcm, sampleRate };
}

const args = process.argv.slice(2);
const opt = { avatar: 'marine', backend: 'auto', chunk: 1.0, out: 'bench-lipsync.json' };
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--avatar') opt.avatar = args[++i];
  else if (a === '--backend') opt.backend = args[++i];
  else if (a === '--chunk') opt.chunk = Number(args[++i]);
  else if (a === '--out') opt.out = args[++i];
  else positional.push(a);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const wavFile = positional[0] ?? path.join(root, 'avatars', opt.avatar, 'normal', 'sample.wav');
const audio = readWav(wavFile);
const audioSec = audio.pcm.length / audio.sampleRate;

const t0 = performance.now();
const avatar = await create({ avatar: opt.avatar, assetsPath: root, backend: opt.backend });
const loadMs = performance.now() - t0;

// warm-up: a short slice, so the reported numbers are the steady state
{
  const slice = { pcm: audio.pcm.subarray(0, Math.min(audio.pcm.length, Math.round(audio.sampleRate * 0.5))), sampleRate: audio.sampleRate };
  for await (const _ of avatar.frames(slice)) void _;
}

let frames = 0, firstFrameMs = 0;
const t = performance.now();
for await (const f of avatar.frames(audio)) {
  if (frames === 0) firstFrameMs = performance.now() - t;
  frames++;
}
const workMs = performance.now() - t;

// the same audio as chunks, the way streamed speech arrives
const chunkSamples = Math.max(1, Math.round(audio.sampleRate * opt.chunk));
function* chunks() {
  for (let o = 0; o < audio.pcm.length; o += chunkSamples) yield { pcm: audio.pcm.subarray(o, Math.min(audio.pcm.length, o + chunkSamples)), sampleRate: audio.sampleRate };
}
let cFrames = 0, cFirstMs = 0;
const ct = performance.now();
for await (const f of avatar.frames(chunks())) {
  if (cFrames === 0) cFirstMs = performance.now() - ct;
  cFrames++;
}
const cWorkMs = performance.now() - ct;

const r = {
  wav: wavFile,
  kernel: avatar.kernel,
  audioSec: +audioSec.toFixed(3),
  frames,
  workMs: Math.round(workMs),
  firstFrameMs: Math.round(firstFrameMs),
  msPerFrame: +(workMs / Math.max(1, frames)).toFixed(2),
  restMsPerFrame: +(frames > 1 ? (workMs - firstFrameMs) / (frames - 1) : 0).toFixed(2),
  framesPerSec: +(frames / (workMs / 1000)).toFixed(1),
  rtf: +(workMs / 1000 / audioSec).toFixed(3),
  loadMs: Math.round(loadMs),
  chunkSec: opt.chunk,
  chunked: {
    frames: cFrames,
    workMs: Math.round(cWorkMs),
    firstFrameMs: Math.round(cFirstMs),
    msPerFrame: +(cWorkMs / Math.max(1, cFrames)).toFixed(2),
    framesPerSec: +(cFrames / (cWorkMs / 1000)).toFixed(1),
    rtf: +(cWorkMs / 1000 / audioSec).toFixed(3),
  },
};
fs.writeFileSync(opt.out, JSON.stringify(r, null, 1) + '\n');
console.log(JSON.stringify(r));
avatar.destroy();
