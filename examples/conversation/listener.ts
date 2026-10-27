// Microphone → 16 kHz frames → voice activity (Silero VAD) → one utterance (Float32Array, 16 kHz) at a time.
// Simple turn taking: the listener is paused while the avatar speaks (frames are dropped), so its own voice is not heard.
import { CpuVad } from './asr/vad.js';

export const SR = 16000;
const FRAME = 512; // 32 ms
/** Speech starts after this many frames above START, ends after END_MS below STOP; kept from START_PAD before the start. */
const START = 0.5;
const STOP = 0.35;
const START_FRAMES = 3;
const END_MS = 700;
const START_PAD_FRAMES = 10;
/** An utterance is cut here and recognised (the recognizer takes about 15 s at most). */
const MAX_SECONDS = 14;
const MIN_SECONDS = 0.3;

export interface ListenerEvents {
  /** Voice probability of the newest frame (0..1) and whether speech is going on. */
  level(p: number, speaking: boolean): void;
  speechStart(): void;
  /** One finished utterance, 16 kHz mono. */
  utterance(pcm: Float32Array): void;
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0]?.[0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor('zen-convo-tap', Tap);`;

export class Listener {
  paused = true;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private resampled: number[] = [];
  private pos = 0;
  private ratio = 1;
  private speech: Float32Array[] | null = null;
  private above = 0;
  private belowMs = 0;

  private constructor(private readonly vad: CpuVad, private readonly ev: ListenerEvents) {}

  static async create(vadUrl: string, ev: ListenerEvents): Promise<Listener> {
    return new Listener(await CpuVad.load(vadUrl), ev);
  }

  /** Asks for the microphone (needs a user gesture) and starts reading it; frames are dropped while paused. */
  async start(stream?: MediaStream): Promise<void> {
    this.stream = stream ?? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'zen-convo-tap');
    this.ratio = this.ctx.sampleRate / SR;
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data);
    src.connect(this.node);
    // the worklet only needs to run; it outputs silence
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  /** Listening on / off. Turning it on starts a fresh utterance (nothing heard while paused is kept). */
  setPaused(p: boolean): void {
    this.paused = p;
    this.resampled = []; this.pos = 0; this.pending = []; this.history = []; this.speech = null; this.above = 0; this.belowMs = 0;
    this.vad.reset();
  }

  stop(): void {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.node = null; this.stream = null; this.ctx = null;
  }

  /** Linear resampling to 16 kHz, then 512-sample frames. */
  private push(x: Float32Array): void {
    if (this.paused) return;
    for (let i = 0; i < x.length; i++) this.resampled.push(x[i]!);
    const out: number[] = [];
    while (this.pos + 1 < this.resampled.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      out.push(this.resampled[i]! * (1 - f) + this.resampled[i + 1]! * f);
      this.pos += this.ratio;
    }
    const drop = Math.floor(this.pos);
    this.resampled = this.resampled.slice(drop); this.pos -= drop;
    this.pending.push(...out);
    while (this.pending.length >= FRAME) this.frame(Float32Array.from(this.pending.splice(0, FRAME)));
  }

  private pending: number[] = [];
  private history: Float32Array[] = [];

  private frame(f: Float32Array): void {
    const p = this.vad.prob(f);
    const frameMs = (FRAME / SR) * 1000;
    if (!this.speech) {
      this.history.push(f);
      if (this.history.length > START_PAD_FRAMES) this.history.shift();
      this.above = p >= START ? this.above + 1 : 0;
      if (this.above >= START_FRAMES) {
        this.speech = [...this.history];
        this.history = [];
        this.belowMs = 0;
        this.ev.speechStart();
      }
    } else {
      this.speech.push(f);
      this.belowMs = p < STOP ? this.belowMs + frameMs : 0;
      const seconds = (this.speech.length * FRAME) / SR;
      if (this.belowMs >= END_MS || seconds >= MAX_SECONDS) this.finish();
    }
    this.ev.level(p, this.speech !== null);
  }

  private finish(): void {
    const parts = this.speech!;
    this.speech = null; this.above = 0; this.belowMs = 0;
    const pcm = new Float32Array(parts.length * FRAME);
    parts.forEach((p, i) => pcm.set(p, i * FRAME));
    if (pcm.length / SR >= MIN_SECONDS) this.ev.utterance(pcm);
  }
}
