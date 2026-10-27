// For scripts/check-tts.mjs: zen-lipsync/tts speakText with ZEN-TTS (WebGPU) in the page, timed.
import { create } from '@zenryokukikai/zen-lipsync';
import { speakText } from '@zenryokukikai/zen-lipsync/tts';
import { ZenTts } from 'zen-tts';

const q = new URLSearchParams(location.search);
const w = window as unknown as Record<string, unknown>;
w['__ttsCheck'] = async (text: string) => {
  const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<{ requestDevice(): Promise<unknown> }> } }).gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const [avatar, tts] = await Promise.all([
    create({ container: document.getElementById('box')!, assetsBaseUrl: q.get('assets') ?? new URL('../', location.href).href, avatar: 'avatars/marine/avatar.json' }),
    ZenTts.load({ modelsUrl: q.get('ttsmodels') ?? new URL('../examples/conversation/tts-models', location.href).href, backend: 'webgpu', device }),
  ]);
  // warm both (the first synthesis compiles the GPU pipelines); a first short speak() also starts the page's audio
  // clock, so the timing below is the speech itself (a browser starts the audio device up to ~2 s after resume())
  const warm = await tts.speak('こんにちは。');
  const tw = performance.now();
  await avatar.speak({ pcm: warm.audio, sampleRate: warm.sampleRate });
  const warmSpeakMs = performance.now() - tw;
  (window as unknown as { __starts: unknown[] }).__starts = [];
  const sentences: { index: number; synthMs: number; seconds: number; atMs: number }[] = [];
  let firstSoundMs = -1, endMs = -1;
  const t0 = performance.now();
  const offS = avatar.on('speechstart', () => { if (firstSoundMs < 0) firstSoundMs = performance.now() - t0; });
  const offE = avatar.on('speechend', () => { endMs = performance.now() - t0; });
  w['__ttsT0'] = t0;
  await speakText(avatar, tts, text, { onSentence: (s) => sentences.push({ index: s.index, synthMs: s.synthMs, seconds: s.seconds, atMs: performance.now() - t0 }) });
  offS(); offE();
  const totalSec = sentences.reduce((a, s) => a + s.seconds, 0);
  const r = { firstSoundMs, endMs, sentences, totalSec, warmSpeakMs, warmSeconds: warm.audio.length / warm.sampleRate, frameTiming: avatar.frameTiming() };
  avatar.destroy(); tts.destroy();
  return r;
};
