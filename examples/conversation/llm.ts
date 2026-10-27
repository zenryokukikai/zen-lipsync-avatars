// The reply maker of the conversation sample. Two kinds:
//  - 'echo': built in, no network. Repeats what was heard in a short scripted reply (works without any key).
//  - 'openai': any OpenAI-compatible Chat Completions endpoint (base URL, API key, model). The key is kept only in this
//    browser (localStorage) and is sent from the browser straight to that endpoint.

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface LlmSettings {
  kind: 'echo' | 'openai';
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Chat Completions reasoning_effort; '' = not sent (servers that don't know the field). */
  reasoning: '' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  system: string;
}

const STORE = 'zen-convo-llm-v1';

export const defaultSettings: LlmSettings = {
  kind: 'echo',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  // OpenAI's cost-efficient model for high-volume work (developers.openai.com/api/docs/models, 2026-10).
  model: 'gpt-6-luna',
  // off = the fastest spoken reply; raise it for more careful answers (slower).
  reasoning: 'none',
  system: 'あなたは「全力 マリン」という名前の、明るく丁寧な日本語の会話相手です。返事は話し言葉で、1〜2文の短い日本語にしてください。記号や絵文字、箇条書きは使わないでください。',
};

export function loadSettings(): LlmSettings {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<LlmSettings> | null;
    return { ...defaultSettings, ...(s ?? {}) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: LlmSettings): void {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode: this page only */ }
}

/** The built-in reply: no network, so the sample runs without any key. */
function echoReply(text: string, turn: number): string {
  const t = text.replace(/[。．.！!？?\s]+$/u, '');
  if (!t) return 'すみません、うまく聞き取れませんでした。もう一度お願いします。';
  const lines = [
    `「${t}」と聞こえました。`,
    `なるほど、「${t}」ですね。`,
    `「${t}」ですね。ほかにも話してみてください。`,
  ];
  return lines[turn % lines.length]!;
}

function isOpenAi(baseUrl: string): boolean {
  try { return new URL(baseUrl).hostname === 'api.openai.com'; } catch { return false; }
}

/** One reply for the conversation so far (history ends with the user's turn). */
export async function reply(s: LlmSettings, history: readonly ChatMessage[], turn: number, signal?: AbortSignal): Promise<string> {
  const last = history[history.length - 1]?.content ?? '';
  if (s.kind === 'echo') return echoReply(last, turn);
  if (!s.apiKey) throw new Error('API キーが入っていません（設定から入れてください）');
  const res = await fetch(`${s.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({
      model: s.model, messages: [{ role: 'system', content: s.system }, ...history],
      // max_tokens is deprecated in Chat Completions (OpenAI); with reasoning on, the reasoning tokens count toward the
      // limit, so it is raised. Other OpenAI-compatible servers keep max_tokens; reasoning_effort only when chosen.
      ...(isOpenAi(s.baseUrl) ? { max_completion_tokens: s.reasoning && s.reasoning !== 'none' ? 4000 : 200 } : { max_tokens: 200 }),
      ...(s.reasoning ? { reasoning_effort: s.reasoning } : {}),
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`返事の作成に失敗しました（HTTP ${res.status}）`);
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('返事が空でした');
  return text;
}
