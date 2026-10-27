// Downloads the speech recognizer used by examples/conversation (reazonspeech-k2-v2, Apache-2.0, converted for WebGPU;
// about 155 MB) into examples/conversation/asr/model/ and checks each file's SHA-256. The files are not in this repository:
// they are the assets of the GitHub release asr-k2v2-webgpu-1 (with the Apache-2.0 text and the modification notice).
// usage: node scripts/fetch-asr.mjs [base URL]   (default: the release assets)
// While this repository is private, set GITHUB_TOKEN (or GH_TOKEN) to a token that can read it: the files then come
// through the GitHub API (release asset download). Without a token the public download URLs are used.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO = 'zenryokukikai/zen-lipsync-avatars';
const TAG = 'asr-k2v2-webgpu-1';
const base = (process.argv[2] ?? `https://github.com/${REPO}/releases/download/${TAG}`).replace(/\/$/, '');
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
/** name -> API URL of the release asset (only with a token and the default base). */
let apiAssets = null;
if (token && !process.argv[2]) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`release ${TAG}: HTTP ${r.status}`);
  apiAssets = Object.fromEntries((await r.json()).assets.map((a) => [a.name, a.url]));
}
const get = (name) => apiAssets
  ? fetch(apiAssets[name] ?? `missing:${name}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/octet-stream' } })
  : fetch(`${base}/${name}`);
const dir = new URL('../examples/conversation/asr/model/', import.meta.url).pathname;
const files = {
  'model.json': '496d1b7efaecbec8db2fd42a39dcf6e84f3cc6cc0d3e5c0daae12ffac23a93af',
  'model.wgq': '2808ac223779b8ead6eb72ab2fc607a0adf326e369acc7627aacf8bcb5bd92a3',
  'stack0.wgq': '596a8e34ee9ff3541a82a59ff7473d21ea38408346f01dbd873e99039f71e1af',
  'stack1.wgq': '258f761bec29b3b78f96f527a0b5c3656031cac47948ea87db37f5284e27527d',
  'stack2.wgq': 'b3aa4da79ca17b0ffbb854d189d985a5c71caa137485b3a88475cc0f9c95517e',
  'stack3.wgq': '4d28fa23deb1e604c14fcfb13687547d13a399103dac3ab42e6ff341a71084d5',
  'stack4.wgq': 'a152a8b5ae8cd9e9d672af082bfebcd87bf1f0cbea451e18fa3037ffff1ad8f5',
  'stack5.wgq': '84cab7e8e64be304525fafe4835e2d6b5e47fd757cd4386c48238a271a885605',
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(dir, { recursive: true });
let total = 0;
for (const [name, want] of Object.entries(files)) {
  const p = path.join(dir, name);
  if (fs.existsSync(p) && sha(fs.readFileSync(p)) === want) { total += fs.statSync(p).size; console.log('ok (cached)', name); continue; }
  const res = await get(name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}${token ? '' : ' (private repository: set GITHUB_TOKEN)'}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== want) throw new Error(`${name}: SHA-256 mismatch`);
  fs.writeFileSync(p, buf);
  total += buf.length;
  console.log('ok', name, (buf.length / 1e6).toFixed(1), 'MB');
}
console.log(`speech recognizer ready: ${(total / 1e6).toFixed(1)} MB in ${dir}`);
