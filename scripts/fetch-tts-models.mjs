// Downloads the ZEN-TTS models used by examples/conversation, examples/node-tts and the checks (about 41 MB) into
// examples/conversation/tts-models/, at the same version as package.json's zen-tts (v1.2.0), and checks each SHA-256:
//   marine.ztm      the voice (one file, .ztm) from the ZEN-TTS CDN
//   g2p/g2p.json, g2p/g2p.bin   the reading model (shared by every voice) from the zen-tts repository
// The zen-tts package itself holds the code; the browser reads the G2P from <modelsUrl>/g2p/ and the voice from model.
// usage: node scripts/fetch-tts-models.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REF = 'v1.2.0';
const dir = new URL('../examples/conversation/tts-models/', import.meta.url).pathname;
const files = {
  'marine.ztm': [`https://tts-models.zenryoku.work/${REF}/marine.ztm`, 'c5f5ff04d43c3a742790856f4639f6d801e5c9a951a4f11ae800775fa0ed11d5'],
  'g2p/g2p.json': [`https://raw.githubusercontent.com/zenryokukikai/zen-tts/${REF}/models/g2p/g2p.json`, '9354f73eaf3cd7161035a057a60294eb3c4bf03cab0c7532db3cdd3a6c3da454'],
  'g2p/g2p.bin': [`https://raw.githubusercontent.com/zenryokukikai/zen-tts/${REF}/models/g2p/g2p.bin`, '33182b3f988e03b37b5553f1fd25f6992d57d0e7c1777a868c2755e42168a15e'],
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let total = 0;
for (const [name, [url, want]] of Object.entries(files)) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p) && sha(fs.readFileSync(p)) === want) { total += fs.statSync(p).size; console.log('ok (cached)', name); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== want) throw new Error(`${name}: SHA-256 mismatch`);
  fs.writeFileSync(p, buf);
  total += buf.length;
  console.log('ok', name, (buf.length / 1e6).toFixed(1), 'MB');
}
console.log(`ZEN-TTS models ready: ${(total / 1e6).toFixed(1)} MB in ${dir}`);
