// Node check of zen-lipsync/tts/node with zen-tts/node (CPU), with `pnpm fetch-tts-models` done and ffmpeg on PATH.
// usage: node scripts/check-node-tts.mjs [out.json]
//  1. renderText: a 3-sentence text -> MP4; the video and audio durations (ffprobe) must equal the speech (+ idle after),
//     and the audio of the file must start with the voice (A/V: the voice sits at frame 0, no offset);
//  2. speakTextFrames: the frames carry the speech without a gap (no silent frame between sentences);
//  3. streamText realtime (jpeg): the time to the first frame and to the first speaking frame, frames late;
//  4. RTF: all work (TTS + lip-sync, not encoding) / speech length, on this process (pin it with taskset for 1 core).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { create } from '@zenryokukikai/zen-lipsync/node';
import { renderText, speakTextFrames, streamText } from '@zenryokukikai/zen-lipsync/tts/node';
import { ZenTtsNode } from 'zen-tts/node';

const out = process.argv[2] ?? 'check-node-tts.json';
const text = '今日は朝から晴れています。駅の前に新しい店ができたので、帰りに寄ってみようと思います。午後から雨が降るようです。';
const assetsPath = fileURLToPath(new URL('../', import.meta.url));
const modelsPath = fileURLToPath(new URL('../examples/conversation/tts-models/', import.meta.url));
const result = { text };
let ok = true;
const note = (k, pass, d) => { result[k] = { ok: pass, ...d }; if (!pass) ok = false; console.log(pass ? 'OK  ' : 'FAIL', k, JSON.stringify(d)); };

const t0 = performance.now();
const [avatar, tts] = await Promise.all([create({ avatar: 'marine', assetsPath }), ZenTtsNode.load({ modelsPath })]);
result.load = { ms: Math.round(performance.now() - t0), lipKernel: avatar.kernel, ttsKernel: tts.kernel };
console.log('loaded', result.load);
await tts.speak('こんにちは。'); // warm-up

// the reference speech length: the sentences synthesised alone
let speechSec = 0;
for await (const c of tts.speakStream(text)) speechSec += c.pcm.length / c.sampleRate;

// 2 + 4. frames: no silent frame inside the speech; all work time
{
  const sentences = [];
  const t = performance.now();
  let frames = 0, speaking = 0, firstSpeak = -1, lastSpeak = -1, silentInside = 0;
  const energy = [];
  for await (const f of speakTextFrames(avatar, tts, text, { tts: { onSentence: (s) => sentences.push(s) } })) {
    let e = 0; for (const v of f.audio) e += v * v;
    energy.push(Math.sqrt(e / Math.max(1, f.audio.length)));
    if (f.speaking) { speaking++; if (firstSpeak < 0) firstSpeak = f.index; lastSpeak = f.index; }
    frames++;
  }
  const workMs = performance.now() - t;
  for (let i = firstSpeak; i <= lastSpeak; i++) if (!(energy[i] > 0)) silentInside++;
  // frames inside the speech marked not speaking (a gap in the lip-sync)
  note('frames', firstSpeak === 0 && silentInside === 0 && Math.abs(frames / 25 - speechSec) <= 0.08,
    { frames, speakingFrames: speaking, speechSec: +speechSec.toFixed(3), framesSec: frames / 25, firstSpeakingFrame: firstSpeak, zeroAudioFramesInsideSpeech: silentInside,
      sentences: sentences.map((s) => ({ seconds: +s.seconds.toFixed(3), synthMs: Math.round(s.synthMs) })) });
  result.rtf = { workMs: Math.round(workMs), rtf: +(workMs / 1000 / speechSec).toFixed(3), synthMs: Math.round(sentences.reduce((a, s) => a + s.synthMs, 0)) };
  console.log('RTF (TTS + lip-sync, no encoding):', result.rtf);
}

// 1. renderText -> MP4: durations and A/V
{
  const file = '/tmp/check-node-tts.mp4';
  const t = performance.now();
  const r = await renderText(avatar, tts, text, { out: file, idleAfterMs: 400 });
  const ms = performance.now() - t;
  const probe = (sel) => Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'stream=duration', '-of', 'csv=p=0', file]).toString().trim());
  const v = probe('v:0'), a = probe('a:0');
  // A/V: decode the file's audio and find where the voice starts (the speech starts at frame 0)
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const s = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
  let onset = -1; for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > 0.02) { onset = i / 16000; break; }
  const want = speechSec + 0.4;
  note('render', Math.abs(v - want) <= 0.08 && Math.abs(a - v) <= 0.05 && onset >= 0 && onset < 0.25,
    { file, frames: r.frames, videoSec: v, audioSec: a, expectSec: +want.toFixed(3), avDiffMs: Math.round((a - v) * 1000), voiceOnsetSec: +onset.toFixed(3), renderMs: Math.round(ms) });
}

// 3. streamText realtime jpeg: first frame / first speaking frame latency, lateness
{
  const t = performance.now();
  const st = streamText(avatar, tts, text, { format: 'jpeg', realtime: true, width: 640 });
  // realtime output: frame k is due at start + k * 40 ms (start = startDelayMs, default 600 ms, after the first ask);
  // lateness = arrival - due. The first frame whose audio has the voice tells the latency to the first spoken frame.
  let firstVideo = -1, firstVoice = -1, voiceTimeMs = -1, frames = 0;
  const arrivals = [];
  let pendingVoice = false;
  for await (const m of st) {
    const now = performance.now() - t;
    if (m.type === 'audio') {
      let e = 0; for (const v of m.pcm) e = Math.max(e, Math.abs(v));
      if (e > 0.02 && voiceTimeMs < 0) { pendingVoice = true; voiceTimeMs = m.timeMs; }
    } else {
      if (firstVideo < 0) firstVideo = now;
      if (pendingVoice && firstVoice < 0) { firstVoice = now; pendingVoice = false; }
      arrivals.push([m.timeMs, now]);
      frames++;
    }
  }
  // the clock's start: the earliest (arrival - timeMs) is when frame 0 was due at the latest
  const start = Math.min(...arrivals.map(([tm, now]) => now - tm));
  const lateness = arrivals.map(([tm, now]) => now - start - tm).sort((p, q) => p - q);
  const spanMs = arrivals.length ? arrivals[arrivals.length - 1][1] - arrivals[0][1] : 0;
  note('stream', frames > 0 && firstVideo > 0 && firstVoice > 0, {
    firstFrameMs: Math.round(firstVideo), firstSpokenFrameMs: Math.round(firstVoice), firstSpokenFrameTimeMs: voiceTimeMs, frames,
    framesPerSecond: +((frames - 1) / (spanMs / 1000)).toFixed(2), lateP50Ms: Math.round(lateness[Math.floor(lateness.length / 2)] ?? 0),
    lateP95Ms: Math.round(lateness[Math.floor(lateness.length * 0.95)] ?? 0), lateMaxMs: Math.round(lateness[lateness.length - 1] ?? 0),
  });
}
avatar.destroy(); tts.destroy();
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
