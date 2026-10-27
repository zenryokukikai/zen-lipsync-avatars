// Model file fetch for the conversation sample: the browser HTTP cache only (no extra storage).
export async function modelFetch(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}
