// Browser check of zen-lipsync/tts speakText with ZEN-TTS on WebGPU (headless Chromium), with `pnpm build` and
// `pnpm fetch-tts-models` done and the repository served (pnpm serve).
// usage: node scripts/check-tts.mjs [baseUrl] [out.json]
// Speaks a 3-sentence text and reports: time to the first sound and to the first lip-synced frame (a mouth patch on the
// canvas), per sentence synthesis time, and gaps: every AudioBufferSourceNode start time is recorded (the player
// schedules each sentence at the previous one's end), so the gap between sentences = start(i) - (start(i-1) + duration).
// The mouth patch is also sampled every animation frame while speaking (frames without a patch inside the speech).
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const out = process.argv[3] ?? 'check-tts.json';
const text = '今日は朝から晴れています。駅の前に新しい店ができたので、帰りに寄ってみようと思います。午後から雨が降るようです。';
const gpuArgs = ['--enable-unsafe-webgpu', '--mute-audio', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
  ...(process.platform === 'linux' ? ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-vulkan=native', '--disable-vulkan-surface'] : [])];
const browser = await chromium.launch({ args: gpuArgs });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    // record when each buffer source is scheduled (on the audio clock) and its duration
    window.__starts = [];
    const orig = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
      const now = this.context.currentTime;
      // the sound's start on the page clock: performance.now() + (when - currentTime)
      window.__starts.push({ when: when || now, dur: this.buffer ? this.buffer.duration : 0, now, t: performance.now(), atMs: (window.__ttsT0 ? performance.now() - window.__ttsT0 : -1) + ((when || now) - now) * 1000 });
      return orig.call(this, when, ...rest);
    };
    // sample the mouth patch canvas every animation frame
    window.__patch = { first: -1, frames: [] };
    const c2 = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    c2.canvas.width = 64; c2.canvas.height = 36;
    const tick = () => {
      const cv = document.querySelector('#box canvas');
      if (cv && window.__ttsT0) {
        c2.clearRect(0, 0, 64, 36); c2.drawImage(cv, 0, 0, 64, 36);
        const px = c2.getImageData(0, 0, 64, 36).data;
        let on = false;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) { on = true; break; }
        const t = performance.now() - window.__ttsT0;
        window.__patch.frames.push([t, on ? 1 : 0]);
        if (on && window.__patch.first < 0) window.__patch.first = t;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`${base}/check/tts.html`);
  await page.waitForFunction(() => typeof window.__ttsCheck === 'function', null, { timeout: 60_000 });
  const r = await page.evaluate((t) => window.__ttsCheck(t), text);
  const starts = await page.evaluate(() => window.__starts);
  const patch = await page.evaluate(() => window.__patch);
  // the speech's buffer sources: the last N starts with a duration (N = sentences); the warm-up speaks no audio
  const speech = starts.filter((s) => s.dur > 0.3).slice(-r.sentences.length);
  const gaps = speech.slice(1).map((s, i) => +((s.when - (speech[i].when + speech[i].dur)) * 1000).toFixed(2));
  // the first sound on the page clock (speechstart fires when speaking starts, before the first sentence is made)
  const firstSoundMs = speech[0]?.atMs ?? -1;
  // patch frames inside the speech (from the first sound + 0.2 s to its end - 0.2 s)
  const inside = patch.frames.filter(([t]) => t > firstSoundMs + 200 && t < firstSoundMs + r.totalSec * 1000 - 200);
  const covered = inside.length ? inside.filter(([, on]) => on).length / inside.length : 0;
  const result = { text, ...r, speechStartEventMs: r.firstSoundMs, firstSoundMs, firstPatchMs: patch.first, scheduled: speech.map((s) => ({ when: +s.when.toFixed(4), dur: +s.dur.toFixed(4) })), gapsMs: gaps, patchCoverage: +covered.toFixed(3), sampledFrames: inside.length, errors };
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  ok = r.sentences.length === 3 && gaps.every((g) => Math.abs(g) < 1) && covered > 0.9 && patch.first > 0 && errors.length === 0;
  console.log(JSON.stringify({ firstSoundMs: +firstSoundMs.toFixed(0), firstPatchMs: +patch.first.toFixed(0), synthMs: r.sentences.map((s) => +s.synthMs.toFixed(0)), seconds: r.sentences.map((s) => +s.seconds.toFixed(2)), gapsMs: gaps, patchCoverage: result.patchCoverage, errors: errors.length }));
} finally {
  await browser.close();
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
