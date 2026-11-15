// 全校の記事の基本情報欄から設立年を読み、「設立より前の年の出場」がある学校を拾う（統合前の学校が後継校にリンクされている疑い）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
const p = (rel) => new URL(`../${rel}`, import.meta.url);
const UA = { headers: { 'User-Agent': 'koshien-db/0.1 (personal non-commercial project)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + Number(process.argv[2] ?? 500) * 1000;
async function raw(title) {
  const f = p(`raw/schools/${title.replace(/[\/#]/g, '_')}.wiki`);
  if (existsSync(f)) return readFileSync(f, 'utf8');
  if (Date.now() > deadline) return null;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`, UA);
    if (res.status === 429) { await sleep(10000 * 2 ** i); continue; }
    let body = res.ok ? await res.text() : '';
    const r = body.match(/^#(?:REDIRECT|転送)\s*\[\[([^\]#]+)/i);
    if (r) { await sleep(1000); const r2 = await fetch(`https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(r[1])}&action=raw`, UA); body = r2.ok ? await r2.text() : ''; }
    writeFileSync(f, body); await sleep(1100); return body;
  }
  return '';
}
const ent = parseCsv(readFileSync(p('data/entries.csv'), 'utf8'));
const years = new Map();
for (const e of ent) { const y = Number(e.tournament_id.slice(0, 4)); if (!years.has(e.school_id)) years.set(e.school_id, []); years.get(e.school_id).push([y, e.name_at_time]); }
let pending = 0; const flagged = [];
for (const [sid, ys] of years) {
  if (sid.includes('#')) continue;
  const body = await raw(sid);
  if (body === null) { pending++; continue; }
  const line = body.slice(0, 8000).split('\n').find((l) => /^\|\s*(設立年月日|創立年月日|設立|開校年月日)\s*=/.test(l)) ?? '';
  const all = [...line.matchAll(/(18|19|20)\d\d/g)].map((m) => Number(m[0]));
  const founded = all.length ? Math.max(...all) : null; // 「旧校1937年・統合2008年」のように複数あるときは最後の年
  const early = ys.filter(([y]) => founded && founded >= 1954 && y < founded);
  if (early.length) flagged.push(`${sid}（設立 ${founded}）: ${[...new Set(early.map(([y, n]) => `${y}${n}`))].join(' ')}`);
}
console.log(pending ? `未取得 ${pending}校（もう一度実行してください）` : '全校取得済み');
console.log(flagged.join('\n'));
