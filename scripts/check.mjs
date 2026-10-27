// Browser check of the SDK with the avatar (headless Chromium, WebGPU), with `pnpm build` done and the repository
// served (pnpm serve). usage: node scripts/check.mjs [baseUrl] [out.json]
//  1. demo: Marine speaks the sample (speak) and lip patches are drawn on > 90% of the video frames of the clip
//  2. demo: the sample in 2 s chunks (speakStream), drawn the same way
//  3. demo: setIdle normal -> angry -> normal
//  4. create / destroy x3 on one page: no errors, the elements are removed
//  5. with WebGPU disabled: create() rejects with WebGPUUnavailableError
//  6. examples/vanilla and examples/react load and speak
// Steps 4 and 5 use check/sdk.html, a page with the SDK on window.ZenLipSync (built by pnpm build).
// Every request must go to the page's own origin.
// The layout (video and lip-sync locked together, no black band, the patch on the face) is checked by scripts/check-geometry.mjs.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const out = process.argv[3] ?? 'check.json';
const origin = new URL(base).origin;
const gpuArgs = ['--enable-unsafe-webgpu', '--mute-audio', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
  ...(process.platform === 'linux' ? ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-vulkan=native', '--disable-vulkan-surface'] : [])];
const result = { base, steps: {} };
let failed = false;
const note = (name, ok, data) => { result.steps[name] = { ok, ...data }; if (!ok) failed = true; console.log(ok ? 'OK  ' : 'FAIL', name, JSON.stringify(data).slice(0, 400)); };

async function newPage(browser) {
  const page = await browser.newPage();
  const foreign = []; const errors = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { page, foreign, errors };
}

/** Counts presented video frames while a clip's sound plays, and how many of them had a lip patch drawn. */
const COUNT = () => {
  const s = window.__count = { frames: 0, patched: 0, gaps: [] };
  const canvas = document.querySelector('#stage canvas');
  const ctx2 = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ctx2.canvas.width = 64; ctx2.canvas.height = 36;
  const tick = () => {
    if (!window.__count) return;
    // only while a clip's sound plays (internal player state: the clip and its planned sound start on the AudioContext clock)
    const pl = window.zenDemo()?.player;
    const c = pl?.clip;
    if (c && pl.ctx.currentTime >= c.soundAt) {
      if (s.lastClip !== c) { if (s.lastEnd !== undefined) s.gaps.push(Math.round((c.soundAt - s.lastEnd) * 1000)); s.lastClip = c; }
      s.lastEnd = c.soundAt + c.source.buffer.duration;
      s.frames++;
      ctx2.clearRect(0, 0, 64, 36); ctx2.drawImage(canvas, 0, 0, 64, 36);
      const px = ctx2.getImageData(0, 0, 64, 36).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) { s.patched++; break; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const browser = await chromium.launch({ args: gpuArgs });
try {
  // 1-3: the demo
  {
    const { page, foreign, errors } = await newPage(browser);
    const t0 = Date.now();
    await page.goto(`${base}/demo/index.html`);
    await page.waitForFunction(() => !document.getElementById('sample').disabled || /読み込めません|動かせません|エラー/.test(document.getElementById('status').textContent), null, { timeout: 90_000 });
    const ready = await page.textContent('#status');
    const backend = await page.evaluate(() => window.zenDemo()?.backend);
    note('demo-load', !!backend && backend === 'webgpu', { ready, backend, loadMs: Date.now() - t0 });

    for (const [name, btn] of [['speak-sample', '#sample'], ['speakStream-chunks', '#stream']]) {
      await page.evaluate(() => { document.getElementById('status').textContent = ''; });
      await page.evaluate(COUNT);
      await page.click(btn);
      await page.waitForFunction(() => window.zenDemo().speaking, null, { timeout: 30_000 });
      await page.waitForFunction(() => /話し終わりました|エラー/.test(document.getElementById('status').textContent), null, { timeout: 120_000 });
      const done = await page.textContent('#status');
      const c = await page.evaluate(() => { const c = window.__count; window.__count = null; return { frames: c.frames, patched: c.patched, gapsMs: c.gaps }; });
      const timing = await page.evaluate(() => window.zenDemo().frameTiming());
      note(name, /話し終わりました/.test(done) && c.frames > 50 && c.patched / c.frames > 0.9, { done, ...c, timing });
    }

    const idle = await page.evaluate(async () => {
      const a = window.zenDemo(); const seen = []; a.on('idlechange', (e) => seen.push(e));
      const out = [];
      for (const to of ['angry', 'normal']) { const t0 = performance.now(); const ok = await a.setIdle(to); out.push({ to, ok, shown: a.idle, ms: Math.round(performance.now() - t0) }); }
      return { out, events: seen, loops: a.idleLoops };
    });
    note('setIdle', idle.out.every((x) => x.ok && x.shown === x.to) && idle.events.length === 2, idle);
    await page.locator('#stage').screenshot({ path: 'check-demo.png' });
    note('demo-requests-errors', foreign.length === 0 && errors.length === 0, { foreign, errors });
    await page.close();
  }

  // 4: create / destroy x3 on one page (check/sdk.html: the SDK on window.ZenLipSync)
  {
    const { page, foreign, errors } = await newPage(browser);
    await page.goto(`${base}/check/sdk.html`);
    const r = await page.evaluate(async () => {
      const { create } = window.ZenLipSync;
      const out = [];
      for (let i = 0; i < 3; i++) {
        const box = document.getElementById('box');
        const t0 = performance.now();
        const a = await create({ container: box, assetsBaseUrl: new URL('../', location.href).href, avatar: 'avatars/marine/avatar.json' });
        const added = box.querySelectorAll('video,canvas').length;
        a.destroy();
        let threw = false; try { await a.speak({ pcm: new Float32Array(160), sampleRate: 16000 }); } catch { threw = true; }
        out.push({ i, loadMs: Math.round(performance.now() - t0), added, left: box.children.length, speakAfterDestroyThrows: threw });
      }
      return out;
    });
    note('create-destroy-x3', r.every((x) => x.added >= 2 && x.left === 0 && x.speakAfterDestroyThrows) && errors.length === 0 && foreign.length === 0, { runs: r, errors, foreign });
    await page.close();
  }

  // 6: examples
  for (const [name, path, click] of [['example-vanilla', 'examples/vanilla/index.html', '#start'], ['example-react', 'examples/react/index.html', null]]) {
    const { page, foreign, errors } = await newPage(browser);
    await page.goto(`${base}/${path}`);
    if (click) {
      await page.click(click);
      await page.waitForFunction(() => /話し終わりました|WebGPU|Error/.test(document.getElementById('out').textContent), null, { timeout: 120_000 });
    } else {
      await page.waitForFunction(() => /準備ができました|WebGPU|Error/.test(document.getElementById('out')?.textContent ?? ''), null, { timeout: 90_000 });
      await page.click('text=話させる');
      await page.waitForFunction(() => /話し終わりました/.test(document.getElementById('out').textContent), null, { timeout: 120_000 });
    }
    const text = await page.textContent('#out');
    note(name, /話し終わりました/.test(text) && foreign.length === 0 && errors.length === 0, { text, foreign, errors });
    await page.close();
  }
} finally {
  await browser.close();
}

// 5: WebGPU disabled
{
  const b = await chromium.launch({ args: ['--mute-audio', '--disable-webgpu', '--disable-gpu'] });
  try {
    const { page, foreign } = await newPage(b);
    await page.goto(`${base}/check/sdk.html`);
    const r = await page.evaluate(async () => {
      try {
        await window.ZenLipSync.create({ container: document.getElementById('box'), assetsBaseUrl: new URL('../', location.href).href, avatar: 'avatars/marine/avatar.json' });
        return { rejected: false };
      } catch (e) { return { rejected: true, name: e.name, isClass: e instanceof window.ZenLipSync.WebGPUUnavailableError, reason: e.reason, hasGpu: 'gpu' in navigator }; }
    });
    note('webgpu-unavailable', r.rejected && r.isClass && r.name === 'WebGPUUnavailableError' && foreign.length === 0, { ...r, foreign });
  } finally { await b.close(); }
}

fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(failed ? 'CHECK FAILED' : 'CHECK OK', out);
process.exit(failed ? 1 : 0);
