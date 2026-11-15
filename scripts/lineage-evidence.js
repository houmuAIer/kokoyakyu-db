// 校名が複数ある学校・名寄せした学校について、学校記事の沿革から「統合・改称」などの記述を抜き出す（判定の根拠用）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
const p = (rel) => new URL(`../${rel}`, import.meta.url);
const UA = { headers: { 'User-Agent': 'koshien-db/0.1 (personal non-commercial project)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function raw(title) {
  const f = p(`raw/schools/${title.replace(/[\/#]/g, '_')}.wiki`);
  if (existsSync(f)) return readFileSync(f, 'utf8');
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`, UA);
    if (res.status === 429) { await sleep(10000 * 2 ** i); continue; }
    const body = res.ok ? await res.text() : '';
    writeFileSync(f, body); await sleep(1200); return body;
  }
  return '';
}
const ent = parseCsv(readFileSync(p('data/entries.csv'), 'utf8'));
const by = new Map();
for (const e of ent) { if (!by.has(e.school_id)) by.set(e.school_id, new Map()); const m = by.get(e.school_id); m.set(e.name_at_time, [...(m.get(e.name_at_time) ?? []), Number(e.tournament_id.slice(0, 4))]); }
const targets = [...by].filter(([, m]) => m.size > 1);
const out = {};
for (const [sid, names] of targets) {
  const body = await raw(sid.replace(/#.*/, ''));
  const lines = body.split('\n').filter((l) => /(統合|併合|分離|分校|独立|開校|改称|校名を|校名変更|移管|再編|廃止|閉校)/.test(l) && /(18|19|20)\d\d|明治|大正|昭和|平成|令和/.test(l))
    .map((l) => l.replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^>]*\/>/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').trim().slice(0, 160));
  out[sid] = { names: Object.fromEntries([...names].map(([n, ys]) => [n, `${Math.min(...ys)}-${Math.max(...ys)}`])), evidence: lines.slice(0, 14) };
}
writeFileSync(p('raw/lineage-evidence.json'), JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, '校の根拠を保存');
