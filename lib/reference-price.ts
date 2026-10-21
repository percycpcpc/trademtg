type Entry = { value: string | null; at: number };
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
let last = 0;
let chain: Promise<unknown> = Promise.resolve();
const ttl = 15 * 60 * 1000;
export function getReferencePrice(id: string, signal?: AbortSignal): Promise<Entry> {
  const cached = memory.get(id) ?? read(id);
  if (cached && Date.now() - cached.at < ttl) return Promise.resolve(cached);
  const existing = pending.get(id); if (existing) return existing;
  const job: Promise<Entry> = chain.catch(() => undefined).then(async () => {
    const wait = Math.max(0, 110 - (Date.now() - last)); if (wait) await new Promise(r => setTimeout(r, wait));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); last = Date.now();
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) { response = await fetch(`https://api.scryfall.com/cards/${id}`, { signal }); if (response.status !== 429) break; const delay = (Number(response.headers.get("retry-after")) || 2 ** attempt) * 1000; await new Promise(r => setTimeout(r, delay + Math.random() * 150)); }
    if (!response?.ok) throw new Error("Reference unavailable"); const usd = (await response.json()).prices?.usd;
    const entry: Entry = { value: typeof usd === "string" && /^\d+(\.\d+)?$/.test(usd) ? Number(usd).toFixed(2) : null, at: Date.now() }; memory.set(id, entry);
    try { sessionStorage.setItem(`price:${id}`, JSON.stringify(entry)); new BroadcastChannel("trademtg-prices").postMessage({ id, entry }); } catch {}
    return entry;
  }); chain = job; pending.set(id, job); void job.finally(() => pending.delete(id)); return job;
}
function read(id: string) { try { const entry = JSON.parse(sessionStorage.getItem(`price:${id}`) ?? "null") as Entry | null; if (entry) memory.set(id, entry); return entry ?? undefined; } catch { return undefined; } }
