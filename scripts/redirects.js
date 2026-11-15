// Wikipedia の転送ページを正式な記事名にそろえる（結果は config/school-redirects.json にキャッシュ）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../config/school-redirects.json', import.meta.url);
const cache = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
const UA = { headers: { 'User-Agent': 'koshien-db/0.1 (personal non-commercial project)' } };

export async function resolveTitles(titles) {
  const todo = [...new Set(titles)].filter((t) => !(t in cache));
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const url = `https://ja.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(batch.join('|'))}`;
    let res;
    for (let attempt = 0; attempt < 6; attempt++) { // 429（アクセス過多）のときは待って再試行
      res = await fetch(url, UA);
      if (res.status !== 429) break;
      const wait = (Number(res.headers.get('retry-after')) || 10 * 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
    if (!res.ok) { save(); throw new Error(`転送先の取得に失敗 ${res.status}`); }
    const q = (await res.json()).query ?? {};
    const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
    const redir = new Map((q.redirects ?? []).map((r) => [r.from, r.to]));
    for (const t of batch) { const n = norm.get(t) ?? t; cache[t] = redir.get(n) ?? n; }
    save();
    await new Promise((r) => setTimeout(r, 2500));
  }
  save();
}
function save() { writeFileSync(path, JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 2) + '\n'); }
/** 記事名（#以下の区別用の印は残す）を正式な記事名にする */
export const canonical = (id) => { const [base, tag] = id.split('#'); const c = cache[base] ?? base; return tag ? `${c}#${tag}` : c; };
