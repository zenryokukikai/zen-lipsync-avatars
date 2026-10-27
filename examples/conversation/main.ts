// Real-time conversation in the browser: microphone → voice activity → speech recognition (k2-v2, WebGPU)
// → a reply (built-in echo, or an OpenAI-compatible endpoint) → ZEN-TTS (WebGPU) → ZEN-LipSync with 「全力 マリン」.
// Simple turn taking: listen → the user finishes → recognise → reply → the avatar speaks to the end → listen again.
// The microphone is not listened to while the avatar speaks.
import { create, WebGPUUnavailableError, type AvatarHandle } from '@zenryokukikai/zen-lipsync';
import { speakText } from '@zenryokukikai/zen-lipsync/tts';
import { ZenTts, type EmotionAmounts } from 'zen-tts';
import { WgslOfflineRecognizer } from './asr/recognizer.js';
import { Listener, SR } from './listener.js';
import { defaultSettings, loadSettings, reply, saveSettings, type ChatMessage, type LlmSettings } from './llm.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
/** Where things are served (overridable for a CDN): the avatars repo root, ZEN-TTS's models, the recognizer files. */
const ASSETS = params.get('assets') ?? new URL('../../', location.href).href;
const TTS_MODELS = params.get('ttsmodels') ?? new URL('./tts-models', location.href).href;
const ASR_MODEL = params.get('asrmodel') ?? new URL('./asr/model', location.href).href;
const VAD_URL = new URL('./asr/silero_vad.wgw', location.href).href;
/** The recognizer takes up to 15 s of speech plus its 0.9 s / 0.5 s padding. */
const ASR_MAX_FRAMES = Math.ceil((15 + 0.9 + 0.5) * 100);

type State = 'loading' | 'ready' | 'listening' | 'recognizing' | 'thinking' | 'speaking' | 'error';
const stateText: Record<State, [string, string]> = {
  loading: ['準備しています', 'Loading'],
  ready: ['「会話を始める」を押してください', 'Ready'],
  listening: ['聞いています。話しかけてください', 'Listening'],
  recognizing: ['聞き取っています', 'Recognizing'],
  thinking: ['考えています', 'Thinking'],
  speaking: ['話しています（この間はマイクを聞きません）', 'Speaking'],
  error: ['エラー', 'Error'],
};

let avatar: AvatarHandle | null = null;
let tts: ZenTts | null = null;
let asr: WgslOfflineRecognizer | null = null;
let listener: Listener | null = null;
let running = false;
let turn = 0;
const history: ChatMessage[] = [];
let llm: LlmSettings = loadSettings();
const timings: Record<string, number>[] = [];

function setState(s: State, detail = ''): void {
  const [ja, en] = stateText[s];
  $('state').dataset['state'] = s;
  $('stateJa').textContent = detail ? `${ja}：${detail}` : ja;
  $('stateEn').textContent = en;
}

function bubble(who: 'user' | 'avatar', text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `bubble ${who}`;
  const name = document.createElement('small');
  name.textContent = who === 'user' ? 'あなた / You' : 'マリン / Marine';
  const p = document.createElement('p'); p.textContent = text;
  el.append(name, p);
  $('log').append(el);
  $('log').scrollTop = $('log').scrollHeight;
  return el;
}

/** Loading progress of one model: name, MB loaded / total. */
function progress(id: string, loadedBytes: number, totalBytes: number, done = false): void {
  const row = $(id);
  const mb = (b: number): string => (b / 1e6).toFixed(1);
  row.querySelector('.mb')!.textContent = `${mb(loadedBytes)} / ${mb(totalBytes)} MB`;
  (row.querySelector('progress') as HTMLProgressElement).value = Math.min(1, loadedBytes / totalBytes);
  row.classList.toggle('done', done);
}

async function gpuDevice(): Promise<GPUDevice> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new WebGPUUnavailableError('no-navigator-gpu');
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new WebGPUUnavailableError('no-adapter');
  return adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize } });
}

async function load(): Promise<void> {
  setState('loading');
  const t0 = performance.now();
  try {
    // the three models load side by side; ZEN-TTS and the recognizer share one GPU device
    const device = await gpuDevice();
    const avatarP = create({
      container: $('stage'), assetsBaseUrl: ASSETS, avatar: 'avatars/marine/avatar.json',
      onProgress: (p) => progress('pAvatar', p.loadedBytes, 44e6),
    }).then((a) => { avatar = a; progress('pAvatar', 44e6, 44e6, true); });
    const ttsP = ZenTts.load({ modelsUrl: TTS_MODELS, backend: 'webgpu', device })
      .then((t) => { tts = t; progress('pTts', 31e6, 31e6, true); });
    const asrP = WgslOfflineRecognizer.create(device, ASR_MODEL, ASR_MAX_FRAMES, (_files, bytes) => progress('pAsr', bytes, 155.1e6))
      .then((r) => { asr = r; progress('pAsr', r.downloadBytes, r.downloadBytes, true); });
    const vadP = Listener.create(VAD_URL, {
      level: (p, speaking) => { $('level').style.width = `${Math.round(p * 100)}%`; $('level').classList.toggle('on', speaking); },
      speechStart: () => { if (running) setState('listening', '話し声を検出'); },
      utterance: (pcm) => void onUtterance(pcm),
    }).then((l) => { listener = l; progress('pVad', 0.63e6, 0.63e6, true); });
    await Promise.all([avatarP, ttsP, asrP, vadP]);
    console.log('[convo] loaded', Math.round(performance.now() - t0), 'ms');
    (window as unknown as { __convo: unknown }).__convo = { loadMs: performance.now() - t0, asrBytes: asr!.downloadBytes, timings };
    setState('ready');
    $<HTMLButtonElement>('start').disabled = false;
  } catch (e) {
    console.error(e);
    setState('error', e instanceof WebGPUUnavailableError ? 'このブラウザでは WebGPU が使えません（Chrome / Edge / Safari 26 以降でお試しください）' : String(e));
    if (String(e).includes('asr/model')) $('asrHelp').hidden = false;
  }
}

/** One turn: the user's utterance → text → reply → the avatar speaks it to the end → listen again. */
async function onUtterance(pcm: Float32Array): Promise<void> {
  if (!running || !asr || !tts || !avatar || !listener) return;
  listener.setPaused(true);
  const t: Record<string, number> = { audioSec: pcm.length / SR };
  const tEnd = performance.now();
  try {
    setState('recognizing');
    const r = await asr.recognize(pcm, { lead: 0.9, tail: 0.5 });
    t['asrMs'] = performance.now() - tEnd;
    const text = r.text.trim();
    if (!text) { listen(); return; }
    bubble('user', text);
    history.push({ role: 'user', content: text });

    setState('thinking');
    const answer = await reply(llm, history, turn++);
    t['replyMs'] = performance.now() - tEnd;
    history.push({ role: 'assistant', content: answer });
    bubble('avatar', answer);

    setState('speaking');
    const emotion = emotionOf($<HTMLSelectElement>('emotion').value);
    // speakText (zen-lipsync/tts): each sentence is synthesised and handed to the avatar as soon as it is ready,
    // and spoken while the next one is made
    const off = avatar.on('speechstart', () => { if (t['firstSoundMs'] === undefined) t['firstSoundMs'] = performance.now() - tEnd; });
    await speakText(avatar, tts!, answer, {
      emotion,
      onSentence: (s) => { if (s.index === 0) t['firstVoiceMs'] = performance.now() - tEnd; },
    });
    off();
    t['doneMs'] = performance.now() - tEnd;
  } catch (e) {
    console.error(e);
    bubble('avatar', `（エラー：${String(e)}）`);
  } finally {
    timings.push(t);
    console.log('[convo] turn', JSON.stringify(t));
    listen();
  }
}

function emotionOf(v: string): EmotionAmounts {
  return v === 'neutral' ? { neutral: 1 } : { [v]: 0.7, neutral: 0.3 } as EmotionAmounts;
}

function listen(): void {
  if (!running || !listener) return;
  listener.setPaused(false);
  setState('listening');
}

$<HTMLButtonElement>('start').addEventListener('click', async () => {
  if (running) {
    running = false;
    listener?.setPaused(true);
    listener?.stop();
    avatar?.stop();
    $('start').querySelector('span')!.textContent = '会話を始める';
    $('startEn').textContent = 'Start';
    setState('ready');
    return;
  }
  try {
    // the fake microphone of the browser check (window.__convoMic) or the real one
    const test = (window as unknown as { __convoMic?: () => Promise<MediaStream> }).__convoMic;
    await listener!.start(test ? await test() : undefined);
  } catch (e) {
    setState('error', `マイクが使えません（${String(e)}）`);
    return;
  }
  running = true;
  $('start').querySelector('span')!.textContent = '会話を終える';
  $('startEn').textContent = 'Stop';
  listen();
});

// settings: the reply maker
function showSettings(): void {
  $<HTMLSelectElement>('llmKind').value = llm.kind;
  $<HTMLInputElement>('llmBase').value = llm.baseUrl;
  $<HTMLInputElement>('llmKey').value = llm.apiKey;
  $<HTMLInputElement>('llmModel').value = llm.model;
  $<HTMLSelectElement>('llmReasoning').value = llm.reasoning;
  $<HTMLTextAreaElement>('llmSystem').value = llm.system;
  $('llmFields').hidden = llm.kind !== 'openai';
}
$('llmKind').addEventListener('change', () => { llm = { ...llm, kind: $<HTMLSelectElement>('llmKind').value as LlmSettings['kind'] }; showSettings(); });
$('save').addEventListener('click', () => {
  llm = { ...llm, kind: $<HTMLSelectElement>('llmKind').value as LlmSettings['kind'], baseUrl: $<HTMLInputElement>('llmBase').value.trim(),
    apiKey: $<HTMLInputElement>('llmKey').value.trim(), model: $<HTMLInputElement>('llmModel').value.trim(),
    reasoning: $<HTMLSelectElement>('llmReasoning').value as LlmSettings['reasoning'],
    system: $<HTMLTextAreaElement>('llmSystem').value.trim() || defaultSettings.system };
  saveSettings(llm);
  $('saved').textContent = '保存しました（このブラウザの中だけ）';
});
$('resetSystem').addEventListener('click', () => { $<HTMLTextAreaElement>('llmSystem').value = defaultSettings.system; });
showSettings();
void load();
