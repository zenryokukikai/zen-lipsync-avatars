// Text -> an MP4 of 「全力 マリン」 speaking it, all on the CPU (Node 20+, ffmpeg on PATH): ZEN-TTS (zen-tts/node) makes the
// voice sentence by sentence, ZEN-LipSync (zen-lipsync/node) lip-syncs each sentence while the next one is synthesised.
//   pnpm fetch-tts-models          (once: the ZEN-TTS models into examples/conversation/tts-models/)
//   node examples/node-tts/main.mjs ["text"] [out.mp4] [--emotion happy]
import { create } from '@zenryokukikai/zen-lipsync/node';
import { renderText } from '@zenryokukikai/zen-lipsync/tts/node';
import { ZenTtsNode } from 'zen-tts/node';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const emotionName = flag('--emotion');
const text = args[0] || 'こんにちは、全力マリンです。今日は、音声合成とリップシンクを、どちらもこのコンピューターの中だけで動かしています。最後まで見てくださって、ありがとうございます。';
const out = args[1] || 'marine-tts.mp4';

const assetsPath = fileURLToPath(new URL('../../', import.meta.url)); // this repository (avatars/marine/...)
const modelsPath = fileURLToPath(new URL('../conversation/tts-models/', import.meta.url));

const [avatar, tts] = await Promise.all([create({ avatar: 'marine', assetsPath }), ZenTtsNode.load({ modelsPath })]);
console.log(`loaded (lip-sync frame model: ${avatar.kernel}, ZEN-TTS kernels: ${tts.kernel})`);
const t0 = performance.now();
const r = await renderText(avatar, tts, text, {
  out,
  idleAfterMs: 400,
  tts: {
    ...(emotionName ? { emotion: { [emotionName]: 1 } } : {}),
    onSentence: (s) => console.log(`  sentence ${s.index + 1}: ${s.seconds.toFixed(2)} s of speech in ${s.synthMs.toFixed(0)} ms — ${s.text}`),
  },
});
console.log(`${r.file}: ${r.frames} frames (${(r.durationMs / 1000).toFixed(2)} s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log('Credit (required): 音声合成：ZEN-TTS ／ リップシンク：ZEN-LipSync ／ 全力機械 https://zenryokukikai.com');
avatar.destroy();
tts.destroy();
