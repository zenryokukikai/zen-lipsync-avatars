// Demo: the avatar 「全力 マリン」 with the SDK (@zenryokukikai/zen-lipsync). The assets are loaded from ASSETS
// (?assets=<base URL>, default: this repository served at the site root) through create({ assetsBaseUrl }).
// Speech from the sample, a file or the microphone; streamed speech (the sample in chunks); idle switch.
import { create, WebGPUUnavailableError, type AvatarHandle, type SpeechAudio } from '@zenryokukikai/zen-lipsync';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = new URLSearchParams(location.search);
const ASSETS = q.get('assets') ?? new URL('../', location.href).href;
const AVATAR = 'avatars/marine/avatar.json';
const IDLE_LABEL: Record<string, string> = { normal: '待機：ふつう', angry: '待機：怒り' };

const status = (t: string): void => { $('status').textContent = t; };
let avatar: AvatarHandle | null = null;
let busy = false;
(window as unknown as { zenDemo: () => AvatarHandle | null }).zenDemo = () => avatar;

async function load(): Promise<void> {
  status('アバターとモデルを読み込んでいます…');
  try {
    avatar = await create({
      container: $('stage'), assetsBaseUrl: ASSETS, avatar: AVATAR,
      onProgress: ({ loadedBytes }) => status(`アバターとモデルを読み込んでいます…（${(loadedBytes / 1e6).toFixed(1)} MB）`),
    });
  } catch (e) {
    if (e instanceof WebGPUUnavailableError) { status('このブラウザでは WebGPU が使えないため、動かせません。Chrome / Edge 113 以降、Safari 26 以降などで開いてください。'); return; }
    status(`読み込めませんでした：${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const a = avatar;
  a.on('ready', ({ loadMs }) => status(`準備ができました（${(loadMs / 1000).toFixed(1)} 秒、WebGPU）。試し用の音声・音声ファイル・録音のどれかで話させてください。`));
  a.on('error', ({ error }) => status(`エラー：${error.message}`));
  const loops = $('loops');
  if (a.idleLoops.length > 1) {
    loops.hidden = false;
    for (const name of a.idleLoops) {
      const b = Object.assign(document.createElement('button'), { textContent: IDLE_LABEL[name] ?? name, disabled: name === a.idle });
      b.dataset['loop'] = name;
      b.addEventListener('click', async () => {
        if (busy) return;
        loops.querySelectorAll('button').forEach((x) => { (x as HTMLButtonElement).disabled = true; });
        await a.setIdle(name);
        loops.querySelectorAll('button').forEach((x) => { (x as HTMLButtonElement).disabled = (x as HTMLButtonElement).dataset['loop'] === a.idle; });
      });
      loops.append(b);
    }
  }
  for (const id of ['file', 'rec', 'sample', 'stream', 'stop']) $<HTMLButtonElement | HTMLInputElement>(id).disabled = false;
}

async function run(what: string, f: (a: AvatarHandle) => Promise<void>): Promise<void> {
  if (!avatar || busy) return;
  avatar.resume();
  busy = true;
  status(`${what}…`);
  try {
    await f(avatar);
    const t = avatar.frameTiming();
    status(`話し終わりました。リップシンクの推論：1 フレーム平均 ${t.inferMsPerFrame.toFixed(2)} ms（${t.frames} フレーム、WebGPU）`);
  } catch (e) {
    status(`エラー：${e instanceof Error ? e.message : String(e)}`);
  } finally { busy = false; }
}

/** Mono samples of an audio file (any format the browser decodes). */
async function decode(buf: ArrayBuffer): Promise<SpeechAudio> {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const ab = await ctx.decodeAudioData(buf);
  const pcm = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) pcm[i]! += d[i]! / ab.numberOfChannels; }
  return { pcm, sampleRate: ab.sampleRate };
}

const sample = async (): Promise<SpeechAudio> => decode(await (await fetch(new URL('avatars/marine/normal/sample.wav', ASSETS))).arrayBuffer());

/** The sample cut into chunks (about 2 s each, at sentence-like gaps is not needed for the demo), delivered with a delay: a stand-in for streamed speech synthesis. */
async function* chunks(audio: SpeechAudio, seconds = 2): AsyncGenerator<SpeechAudio> {
  const n = Math.round(audio.sampleRate * seconds);
  for (let i = 0; i < audio.pcm.length; i += n) {
    await new Promise((r) => setTimeout(r, 150));
    yield { pcm: audio.pcm.slice(i, i + n), sampleRate: audio.sampleRate };
  }
}

$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) { const a = await decode(await f.arrayBuffer()); await run('話しています', (av) => av.speak(a)); }
});
$<HTMLButtonElement>('sample').addEventListener('click', async () => { const a = await sample(); await run('話しています', (av) => av.speak(a)); });
$<HTMLButtonElement>('stream').addEventListener('click', async () => { const a = await sample(); await run('少しずつ届く音声で話しています', (av) => av.speakStream(chunks(a))); });
$<HTMLButtonElement>('stop').addEventListener('click', () => avatar?.stop());

let rec: { stop: () => Promise<SpeechAudio> } | null = null;
$<HTMLButtonElement>('rec').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('rec');
  if (rec) {
    const r = rec; rec = null; btn.textContent = '● 録音';
    const a = await r.stop();
    await run('話しています', (av) => av.speak(a));
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
  const mr = new MediaRecorder(stream);
  const parts: Blob[] = [];
  mr.ondataavailable = (ev) => parts.push(ev.data);
  mr.start();
  btn.textContent = '■ 止めて話させる';
  status('録音しています…');
  rec = {
    stop: () => new Promise((resolve) => {
      mr.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); resolve(await decode(await new Blob(parts).arrayBuffer())); };
      mr.stop();
    }),
  };
});

void load();
