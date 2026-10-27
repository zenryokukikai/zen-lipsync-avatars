// Downloads the ZEN-TTS models used by examples/conversation (the default voice, about 31 MB) from the ZEN-TTS
// repository at the same version as package.json's zen-tts (v1.0.0), into examples/conversation/tts-models/,
// and checks each file's SHA-256. The zen-tts package itself holds the code only.
// usage: node scripts/fetch-tts-models.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REF = 'v1.0.0';
const dir = new URL('../examples/conversation/tts-models/', import.meta.url).pathname;
const files = {
  'tts/own.json': '70d7914d76a40ea2d21d2a85431c672614289ae74e3e41c614ce8b7309b5c674',
  'tts/own.bin': '17be4d9b9a1689bd102fc04fb47b12b63c72a8cdcf0a680e37944bf5aca38040',
  'decoder/nsf.json': '20ee3618c8f2adca88350456a3865a2168434fcc980ee7260dae247615624e2f',
  'decoder/nsf.bin': 'f29a067c941b6707e498dacb01204742f062e1b8056f7a62b649537b2a9babd3',
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** One file of the repository at REF: the public raw URL, else (no access without login) through the gh CLI. */
async function get(name) {
  const res = await fetch(`https://raw.githubusercontent.com/zenryokukikai/zen-tts/${REF}/models/${name}`);
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  return execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/zenryokukikai/zen-tts/contents/models/${name}?ref=${REF}`], { maxBuffer: 64 << 20 });
}
let total = 0;
for (const [name, want] of Object.entries(files)) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p) && sha(fs.readFileSync(p)) === want) { total += fs.statSync(p).size; console.log('ok (cached)', name); continue; }
  const buf = await get(name);
  if (sha(buf) !== want) throw new Error(`${name}: SHA-256 mismatch`);
  fs.writeFileSync(p, buf);
  total += buf.length;
  console.log('ok', name, (buf.length / 1e6).toFixed(1), 'MB');
}
console.log(`ZEN-TTS models ready: ${(total / 1e6).toFixed(1)} MB in ${dir}`);
