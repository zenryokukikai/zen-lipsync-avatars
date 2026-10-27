// Browser check of examples/conversation (headless Chromium, WebGPU), with `pnpm build`, `pnpm fetch-asr`,
// `pnpm fetch-tts-models` done and the repository served (pnpm serve).
// usage: node scripts/check-conversation.mjs [baseUrl] [speech.wav] [out.json]
// A fake microphone plays speech.wav (16 kHz mono speech, then silence) into the page (window.__convoMic). In the
// built-in echo mode it checks, for 2 turns:
//  - the speech is recognised (a user bubble with text appears);
//  - the echo reply is spoken by ZEN-TTS with ZEN-LipSync (an avatar bubble, speechstart / speechend, lip patches drawn);
//  - the microphone is not listened to while the avatar speaks (no utterance is cut during speaking);
//  - the credit footer with the link to https://zenryokukikai.com is visible (desktop and 390 px);
//  - no request leaves the page's origin (echo mode).
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const wav = process.argv[3] ?? 'avatars/marine/normal/sample.wav';
const out = process.argv[4] ?? 'check-conversation.json';
const origin = new URL(base).origin;
const gpuArgs = ['--enable-unsafe-webgpu', '--mute-audio', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
  ...(process.platform === 'linux' ? ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-vulkan=native', '--disable-vulkan-surface'] : [])];
const result = { base, wav };
let failed = false;
const note = (name, ok, data) => { result[name] = { ok, ...data }; if (!ok) failed = true; console.log(ok ? 'OK  ' : 'FAIL', name, JSON.stringify(data).slice(0, 500)); };

const browser = await chromium.launch({ args: gpuArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const foreign = []; const errors = []; const logs = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
  const wavB64 = fs.readFileSync(wav).toString('base64');
  // fake microphone: the WAV, played twice with silence in between, as a MediaStream
  await page.addInitScript((b64) => {
    window.__convoMic = async () => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(bytes.buffer);
      const dest = ctx.createMediaStreamDestination();
      window.__micPlays = [];
      const play = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.connect(dest); s.start(); window.__micPlays.push(performance.now()); };
      window.__playMic = play;
      setTimeout(play, 1500);
      return dest.stream;
    };
  }, wavB64);
  const t0 = Date.now();
  await page.goto(`${base}/examples/conversation/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#state')?.dataset.state === 'ready' || document.querySelector('#state')?.dataset.state === 'error', null, { timeout: 300_000 });
  const loaded = await page.evaluate(() => ({ state: document.querySelector('#state').dataset.state, text: document.querySelector('#stateJa').textContent, convo: window.__convo }));
  note('load', loaded.state === 'ready', { ms: Date.now() - t0, ...loaded });
  if (loaded.state !== 'ready') throw new Error('not ready');

  // count frames with a lip patch while the avatar speaks, and any utterance cut while it speaks
  await page.evaluate(() => {
    const s = window.__watch = { speakingFrames: 0, patched: 0, cutWhileSpeaking: 0, states: [] };
    const canvas = document.querySelector('#stage canvas');
    const c2 = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    c2.canvas.width = 64; c2.canvas.height = 36;
    let last = '';
    const tick = () => {
      const st = document.querySelector('#state').dataset.state;
      if (st !== last) { s.states.push(st); last = st; }
      if (st === 'speaking' && canvas) {
        s.speakingFrames++;
        c2.clearRect(0, 0, 64, 36); c2.drawImage(canvas, 0, 0, 64, 36);
        const px = c2.getImageData(0, 0, 64, 36).data;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) { s.patched++; break; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.click('#start');
  // turn 1: the WAV plays at 1.5 s
  await page.waitForFunction(() => document.querySelectorAll('.bubble.avatar').length >= 1, null, { timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('#state').dataset.state === 'listening' && window.__convo.timings.length >= 1, null, { timeout: 120_000 });
  // turn 2: play the clip again once listening resumed
  await page.evaluate(() => window.__playMic());
  await page.waitForFunction(() => document.querySelectorAll('.bubble.avatar').length >= 2 && window.__convo.timings.length >= 2, null, { timeout: 120_000 });
  // mic during speaking: play the WAV while the avatar speaks turn 3; it must not produce a user bubble
  await page.waitForFunction(() => document.querySelector('#state').dataset.state === 'listening', null, { timeout: 120_000 });
  const before = await page.evaluate(() => document.querySelectorAll('.bubble.user').length);
  await page.evaluate(() => window.__playMic());
  await page.waitForFunction(() => document.querySelector('#state').dataset.state === 'speaking', null, { timeout: 120_000 });
  await page.evaluate(() => window.__playMic()); // played while speaking: must be ignored
  await page.waitForFunction(() => document.querySelector('#state').dataset.state === 'listening' && window.__convo.timings.length >= 3, null, { timeout: 120_000 });
  await page.waitForTimeout(12_000); // the ignored clip would have ended by now
  const turns = await page.evaluate(() => ({
    user: [...document.querySelectorAll('.bubble.user p')].map((e) => e.textContent),
    avatar: [...document.querySelectorAll('.bubble.avatar p')].map((e) => e.textContent),
    timings: window.__convo.timings, watch: window.__watch, state: document.querySelector('#state').dataset.state,
  }));
  const userAfter = turns.user.length;
  note('turns', turns.user.length >= 2 && turns.user.every((t) => t && t.length > 2) && turns.avatar.length >= 2, { user: turns.user, avatar: turns.avatar, timings: turns.timings });
  note('lipsync', turns.watch.speakingFrames > 30 && turns.watch.patched / turns.watch.speakingFrames > 0.8, { speakingFrames: turns.watch.speakingFrames, patched: turns.watch.patched });
  // the clip played while the avatar spoke: its start (heard during speaking) must be dropped; a tail that is still
  // playing after listening resumes may be heard (correct: the microphone is listened to again)
  const head = turns.user[0].replace(/^あ/, '').slice(0, 6);
  const later = turns.user.slice(before + 1);
  note('mic ignored while speaking', later.every((t) => !t.includes(head)), { head, userBefore: before, userAfter, later, states: turns.watch.states.slice(-12) });

  const credit = async () => page.evaluate(() => {
    const f = document.querySelector('footer.credit'); const a = f?.querySelector('a[href="https://zenryokukikai.com"]');
    const r = f?.getBoundingClientRect();
    return { text: f?.textContent?.trim(), link: !!a, visible: !!r && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1, top: r?.top, h: r?.height, vh: innerHeight };
  });
  const cDesk = await credit();
  await page.evaluate(() => window.scrollTo(0, 0));
  note('credit desktop', cDesk.link && cDesk.visible && cDesk.text.includes('音声合成：ZEN-TTS') && cDesk.text.includes('リップシンク：ZEN-LipSync'), cDesk);
  await page.screenshot({ path: out.replace(/\.json$/, '-1280.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const cMob = await credit();
  note('credit 390', cMob.link && cMob.visible, cMob);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  note('390 no horizontal overflow', !overflow, {});
  // the avatar box (the SDK's): the video's aspect ratio, video and canvas on the same rectangle (no black band, the lip-sync on the face)
  const lay = await page.evaluate(() => {
    const box = document.querySelector('[data-zen-lipsync]'); const v = box?.querySelector('video'); const c = box?.querySelector('canvas');
    if (!box || !v || !c) return null;
    const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; };
    return { box: r(box), video: r(v), canvas: r(c), vw: v.videoWidth, vh: v.videoHeight, cw: c.width, ch: c.height, fitV: getComputedStyle(v).objectFit, fitC: getComputedStyle(c).objectFit };
  });
  const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 0.6);
  note('390 avatar layout', !!lay && same(lay.box, lay.video) && same(lay.box, lay.canvas) && Math.abs(lay.box[2] / lay.box[3] - lay.vw / lay.vh) < 0.01 && lay.cw === lay.vw && lay.ch === lay.vh && lay.fitV === lay.fitC, lay ?? {});
  await page.screenshot({ path: out.replace(/\.json$/, '-390.png'), fullPage: false });
  note('no external requests (echo mode)', foreign.length === 0, { foreign: foreign.slice(0, 5) });
  note('no page errors', errors.length === 0, { errors: errors.slice(0, 5) });
  result.logs = logs.filter((l) => l.startsWith('[convo]'));
} catch (e) {
  note('run', false, { error: String(e) });
} finally {
  await browser.close();
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  console.log(failed ? 'FAILED' : 'ALL OK', '→', out);
  process.exitCode = failed ? 1 : 0;
}
