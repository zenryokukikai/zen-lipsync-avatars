// A WAV file -> an MP4 of 「全力 マリン」 speaking it, on the CPU (Node 20+, ffmpeg on PATH).
//   node examples/node-mp4/main.mjs [in.wav] [out.mp4]
import { create } from '@zenryokukikai/zen-lipsync/node';
import { fileURLToPath } from 'node:url';
import { readWav } from './wav.mjs';

const assetsPath = fileURLToPath(new URL('../../', import.meta.url)); // this repository (avatars/marine/...)
const input = process.argv[2] || `${assetsPath}avatars/marine/normal/sample.wav`;
const out = process.argv[3] || 'marine.mp4';

const avatar = await create({ avatar: 'marine', assetsPath });
console.log(`loaded (frame model: ${avatar.kernel})`);
const t0 = performance.now();
const r = await avatar.render(readWav(input), { out, idleAfterMs: 400 });
console.log(`${r.file}: ${r.frames} frames (${(r.durationMs / 1000).toFixed(2)} s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
avatar.destroy();
