// Live delivery over a WebSocket: the server turns speech into 「全力 マリン」's video on the CPU and sends it as JPEG
// frames and PCM audio; viewer.html plays them. Node 20+, ffmpeg on PATH, and the "ws" package.
//   node examples/node-stream/server.mjs [port]   then open http://localhost:8090/
// Each click on "話させる" in the page sends the sample WAV in 1 s chunks (as streamed speech synthesis would) and the
// server streams the frames as they are made, at real time; between speeches the idle loop keeps playing.
import { create } from '@zenryokukikai/zen-lipsync/node';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readWav } from './wav.mjs';

const port = Number(process.argv[2] ?? 8090);
const assetsPath = fileURLToPath(new URL('../../', import.meta.url));
const sample = readWav(`${assetsPath}avatars/marine/normal/sample.wav`);
const viewer = readFileSync(new URL('./viewer.html', import.meta.url));

const http = createServer((req, res) => {
  if (req.url === '/' || req.url === '/viewer.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(viewer); }
  else { res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ server: http });

wss.on('connection', async (ws) => {
  // one avatar per connection (the models are shared in the process; each avatar holds its idle loops' state)
  const avatar = await create({ avatar: 'marine', assetsPath });
  let queue = [];
  let wake = null;
  // the speech of this connection: chunks pushed by "speak" messages, read by the stream below
  const speech = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length === 0) await new Promise((r) => { wake = r; });
        const c = queue.shift();
        if (c === null) return;
        yield c;
      }
    },
  };
  const push = (c) => { queue.push(c); wake?.(); wake = null; };
  ws.on('message', (m) => {
    const msg = JSON.parse(String(m));
    if (msg.type === 'speak') {
      const n = sample.sampleRate; // 1 s chunks
      for (let i = 0; i < sample.pcm.length; i += n) push({ pcm: sample.pcm.subarray(i, i + n), sampleRate: sample.sampleRate });
    }
    if (msg.type === 'idle') void avatar.setIdle(msg.name);
  });
  ws.on('close', () => { push(null); avatar.destroy(); });
  ws.send(JSON.stringify({ type: 'hello', width: avatar.width, height: avatar.height, fps: 25, kernel: avatar.kernel }));
  // realtime: 25 frames per second by the clock; idle frames while no speech is ready
  const stream = avatar.stream(speech, { format: 'jpeg', realtime: true, width: 640, audioSampleRate: 24000 });
  for await (const item of stream) {
    if (ws.readyState !== ws.OPEN) break;
    if (item.type === 'video') ws.send(Buffer.concat([Buffer.from([1]), Buffer.from(new Float64Array([item.timeMs]).buffer), item.jpeg]));
    else ws.send(Buffer.concat([Buffer.from([2]), Buffer.from(new Float64Array([item.timeMs]).buffer), Buffer.from(item.pcm.buffer, item.pcm.byteOffset, item.pcm.byteLength)]));
  }
});

http.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
