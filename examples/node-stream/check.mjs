// Headless check of the streaming example: starts server.mjs, opens viewer.html in Chromium, clicks 話させる, and
// counts frames received / drawn and audio chunks. node examples/node-stream/check.mjs [port]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? 8090);
const server = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { server.stdout.on('data', (d) => { if (String(d).includes('http://')) resolve(); }); server.on('exit', reject); });
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await b.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => /つながりました/.test(document.getElementById('out').textContent), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({ ...window.__stats }));
  await page.click('#speak');
  await page.waitForTimeout(10500);
  await page.click('#angry');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ ...window.__stats }));
  await page.locator('canvas').screenshot({ path: 'node-stream-check.png' });
  await b.close();
  const got = { idleBefore: before, after, framesIn12s: after.frames - before.frames, errs };
  console.log(JSON.stringify(got));
  const ok = got.framesIn12s > 12 * 25 * 0.9 && after.drawn > 0 && after.audio > 0 && errs.length === 0;
  console.log(ok ? 'CHECK OK' : 'CHECK FAIL');
  process.exitCode = ok ? 0 : 1;
} finally { server.kill(); }
