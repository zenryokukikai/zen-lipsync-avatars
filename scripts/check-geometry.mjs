// Geometry check of the SDK's browser layout (headless Chromium, WebGPU), with `pnpm build` done and the repository
// served (pnpm serve). usage: node scripts/check-geometry.mjs [baseUrl] [outDir]
// For each case (viewport, device pixel ratio, fit, a fixed container height or none, then a resize):
//  - layers locked: the idle <video> and the lip-sync <canvas> map every frame pixel to the same screen point
//    (each element's own box, object-fit / object-position and intrinsic size; corners within 0.5 CSS px);
//  - no black band: with no container height, the SDK's box has the video's aspect ratio and the video fills it;
//  - the patch on screen: while the avatar speaks, the video is paused with a patch drawn, the page is shot with and
//    without the canvas, and the changed pixels must lie inside the patch rectangle of that frame (from the avatar
//    pack, mapped through the video's fit) within 2 CSS px, covering a real part of it.
// Screenshots: <outDir>/geometry-<case>.png. Every request must go to the page's own origin.
import { chromium } from 'playwright';
import fs from 'node:fs';
import zlib from 'node:zlib';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const outDir = process.argv[3] ?? '.';
const origin = new URL(base).origin;
const gpuArgs = ['--enable-unsafe-webgpu', '--mute-audio', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
  ...(process.platform === 'linux' ? ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-vulkan=native', '--disable-vulkan-surface'] : [])];
const TOL = 2;
const result = { base, cases: {} };
let failed = false;
const note = (name, ok, data) => { result.cases[name] = { ok, ...data }; if (!ok) failed = true; console.log(ok ? 'OK  ' : 'FAIL', name, JSON.stringify(data).slice(0, 600)); };

const CASES = [
  { name: '390-dpr3-contain', vp: [390, 844], dpr: 3, shot: true, resize: [844, 390] },
  { name: '390-dpr1-contain', vp: [390, 844], dpr: 1 },
  { name: '390-dpr3-cover-h500', vp: [390, 844], dpr: 3, fit: 'cover', h: '500px' },
  { name: '1280-dpr1-contain', vp: [1280, 900], dpr: 1, shot: true, resize: [700, 900] },
  { name: '1280-dpr3-contain', vp: [1280, 900], dpr: 3 },
  { name: '1280-dpr1-contain-h400', vp: [1280, 900], dpr: 1, h: '400px' },
  { name: '1280-dpr1-cover-h400', vp: [1280, 900], dpr: 1, fit: 'cover', h: '400px' },
];

/** In the page: where each layer puts frame pixels on screen, and the SDK box. */
const MEASURE = () => {
  const box = document.querySelector('[data-zen-lipsync]');
  const video = [...box.querySelectorAll('video')].find((v) => getComputedStyle(v).opacity !== '0') ?? box.querySelector('video');
  const canvas = box.querySelector('canvas');
  const map = (el, W, H) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const s = cs.objectFit === 'cover' ? Math.max(r.width / W, r.height / H) : cs.objectFit === 'contain' ? Math.min(r.width / W, r.height / H) : null;
    const [px, py] = cs.objectPosition.split(' ').map((v) => parseFloat(v) / 100);
    if (s === null) return { fit: cs.objectFit, sx: r.width / W, sy: r.height / H, ox: r.left, oy: r.top, W, H };
    return { fit: cs.objectFit, sx: s, sy: s, ox: r.left + (r.width - W * s) * px, oy: r.top + (r.height - H * s) * py, W, H };
  };
  const vm = map(video, video.videoWidth, video.videoHeight);
  const cm = map(canvas, canvas.width, canvas.height);
  const b = box.getBoundingClientRect(); const c = box.parentElement.getBoundingClientRect();
  const corners = [[0, 0], [vm.W, 0], [0, vm.H], [vm.W, vm.H]];
  const diff = Math.max(...corners.map(([x, y]) => Math.max(Math.abs(vm.ox + x * vm.sx - (cm.ox + x * cm.sx)), Math.abs(vm.oy + y * vm.sy - (cm.oy + y * cm.sy)))));
  const videos = [...box.querySelectorAll('video')].map((v) => { const r = v.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 10) / 10); });
  return { vm, cm, cornerDiff: diff, box: [b.left, b.top, b.width, b.height], container: [c.left, c.top, c.width, c.height], videos,
    canvasIntrinsic: [canvas.width, canvas.height], videoIntrinsic: [video.videoWidth, video.videoHeight] };
};

/** Decodes an 8-bit RGBA / RGB PNG (Playwright screenshots) into { w, h, px (RGBA) }. */
function png(buf) {
  let o = 8; let w = 0; let h = 0; let ct = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3; const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * bpp;
  const px = new Uint8Array(w * h * 4); const prev = new Uint8Array(stride); const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) px[(y * w + x) * 4 + k] = k < bpp ? cur[x * bpp + k] : 255;
    prev.set(cur);
  }
  return { w, h, px };
}

async function measurePatch(page, c, label) {
  // speak the sample until a patch is drawn, then pause (the patch stays: no new video frame clears it)
  const got = await page.evaluate(async () => {
    const a = window.geo.avatar; const pl = a.player;
    const buf = await (await fetch(new URL('avatars/marine/normal/sample.wav', new URL('../', location.href)))).arrayBuffer();
    const ab = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buf);
    void a.speak({ pcm: ab.getChannelData(0), sampleRate: ab.sampleRate }).catch(() => undefined);
    const t0 = performance.now();
    while (performance.now() - t0 < 20000) {
      await new Promise((r) => requestAnimationFrame(r));
      // a patch drawn and the sound well into the clip (not the very first frame)
      if (pl.shown && pl.clip && pl.ctx.currentTime > pl.clip.soundAt + 1.0) { a.pause(); await new Promise((r) => setTimeout(r, 300)); return { shown: pl.shown }; }
    }
    return null;
  });
  if (!got?.shown) return { error: 'no patch drawn within 20 s' };
  const m = await page.evaluate(MEASURE);
  const canvasSel = '[data-zen-lipsync] canvas';
  const withP = png(await page.screenshot({ fullPage: false }));
  if (c.shot) fs.writeFileSync(`${outDir}/geometry-${label}.png`, await page.screenshot({ fullPage: false }));
  await page.$eval(canvasSel, (el) => { el.style.visibility = 'hidden'; });
  const without = png(await page.screenshot({ fullPage: false }));
  await page.$eval(canvasSel, (el) => { el.style.visibility = ''; });
  // changed pixels (device px) -> CSS px bounding box
  let x0 = 1e9; let y0 = 1e9; let x1 = -1; let y1 = -1; let n = 0;
  for (let y = 0; y < withP.h; y++) for (let x = 0; x < withP.w; x++) {
    const i = (y * withP.w + x) * 4;
    if (Math.abs(withP.px[i] - without.px[i]) + Math.abs(withP.px[i + 1] - without.px[i + 1]) + Math.abs(withP.px[i + 2] - without.px[i + 2]) > 12) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  const dpr = withP.w / c.vpNow[0];
  const seen = n ? [x0 / dpr, y0 / dpr, (x1 + 1) / dpr, (y1 + 1) / dpr] : null;
  const s = got.shown; const vm = m.vm;
  const expected = [vm.ox + s.x * vm.sx, vm.oy + s.y * vm.sy, vm.ox + (s.x + s.w) * vm.sx, vm.oy + (s.y + s.h) * vm.sy];
  // the visible area: the drawn picture clipped by the SDK box (cover crops)
  const [bl, bt, bw, bh] = m.box;
  const clip = [Math.max(expected[0], bl), Math.max(expected[1], bt), Math.min(expected[2], bl + bw), Math.min(expected[3], bt + bh)];
  const inside = !!seen && seen[0] >= clip[0] - TOL && seen[1] >= clip[1] - TOL && seen[2] <= clip[2] + TOL && seen[3] <= clip[3] + TOL;
  const area = seen ? ((seen[2] - seen[0]) * (seen[3] - seen[1])) / Math.max(1, (clip[2] - clip[0]) * (clip[3] - clip[1])) : 0;
  const r1 = (v) => Math.round(v * 10) / 10;
  await page.evaluate(() => { window.geo.avatar.stop(); window.geo.avatar.resume(); });
  return { m, shown: s, expected: expected.map(r1), visible: clip.map(r1), seen: seen?.map(r1) ?? null, changedPx: n, inside, coverage: Math.round(area * 100) / 100, dpr };
}

const browser = await chromium.launch({ args: gpuArgs });
try {
  // GEO_ONLY=<case name substring>: run only matching cases
  for (const c of CASES.filter((x) => !process.env.GEO_ONLY || x.name.includes(process.env.GEO_ONLY))) {
    const ctx = await browser.newContext({ viewport: { width: c.vp[0], height: c.vp[1] }, deviceScaleFactor: c.dpr });
    const page = await ctx.newPage();
    const foreign = []; const errors = [];
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u); });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const qs = new URLSearchParams({ ...(c.fit ? { fit: c.fit } : {}), ...(c.h ? { h: c.h } : {}) });
    try {
      await page.goto(`${base}/check/geometry.html?${qs}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.geo?.ready || window.geo?.error, null, { timeout: 60000 });
      const err = await page.evaluate(() => window.geo.error);
      if (err) { note(c.name, false, { error: err }); await ctx.close(); continue; }
      await page.waitForFunction(() => { const v = document.querySelector('#box video'); return v && v.videoWidth > 0; }, null, { timeout: 20000 });
      // the SDK's box (older SDKs: the container's first child)
      await page.evaluate(() => { const b = document.querySelector('#box > div'); if (b && !b.hasAttribute('data-zen-lipsync')) b.setAttribute('data-zen-lipsync', ''); });
      const steps = [{ label: c.name, vp: c.vp }, ...(c.resize ? [{ label: `${c.name}-resized-${c.resize[0]}x${c.resize[1]}`, vp: c.resize }] : [])];
      for (const st of steps) {
        if (st.vp !== c.vp) { await page.setViewportSize({ width: st.vp[0], height: st.vp[1] }); await page.waitForTimeout(400); }
        const r = await measurePatch(page, { ...c, vpNow: st.vp }, st.label);
        if (r.error) { note(st.label, false, r); continue; }
        const [bl, bt, bw, bh] = r.m.box;
        const aspectBox = bw / bh; const aspectVideo = r.m.videoIntrinsic[0] / r.m.videoIntrinsic[1];
        const noBand = c.h ? true : Math.abs(aspectBox - aspectVideo) < 0.01 && Math.abs(r.m.vm.ox - bl) < 0.6 && Math.abs(r.m.vm.oy - bt) < 0.6;
        const stacked = r.m.videos.every((v) => Math.abs(v[0] - bl) < 0.6 && Math.abs(v[1] - bt) < 0.6 && Math.abs(v[2] - bw) < 0.6 && Math.abs(v[3] - bh) < 0.6);
        const ok = r.m.cornerDiff <= 0.5 && noBand && stacked && r.inside && r.coverage > 0.2 && r.m.canvasIntrinsic[0] === r.m.videoIntrinsic[0] && r.m.canvasIntrinsic[1] === r.m.videoIntrinsic[1];
        note(st.label, ok, { cornerDiff: Math.round(r.m.cornerDiff * 100) / 100, noBlackBand: noBand, layersStacked: stacked, box: r.m.box.map((v) => Math.round(v * 10) / 10), container: r.m.container.map((v) => Math.round(v * 10) / 10),
          fit: r.m.vm.fit, patchFrame: r.shown, patchExpectedOnScreen: r.expected, patchVisible: r.visible, patchSeenOnScreen: r.seen, coverage: r.coverage, dpr: r.dpr });
      }
      note(`${c.name} requests/errors`, foreign.length === 0 && errors.length === 0, { foreign: foreign.slice(0, 3), errors: errors.slice(0, 3) });
    } catch (e) { note(c.name, false, { error: String(e) }); }
    await ctx.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(`${outDir}/check-geometry.json`, JSON.stringify(result, null, 1));
}
console.log(failed ? 'FAILED' : 'ALL OK');
process.exit(failed ? 1 : 0);
