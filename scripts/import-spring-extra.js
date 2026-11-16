// センバツの出場ごとに「選考区分（一般／21世紀枠／希望枠）」と「前年秋の地区大会の成績」を付け、data/spring-extra.csv を作り直す。
// 使い方: node scripts/import-spring-extra.js
// - 選抜の記事は raw/<大会ID>.wiki、地区大会の記事は raw/regional-<記事名>.wiki を使う（なければ取得）。
// - 地区大会の記事から分かるのは優勝・準優勝（東海・近畿・四国はベスト4も、関東は優勝のみ）。
//   ベスト4・ベスト8などそれ以外は config/spring-regional.json に出典つきで足す。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseSelectionCategories, parseRegionalPage, schoolKey } from '../src/spring-parse.js';
import { parseCsv } from '../src/csv.js';

const p = (rel) => new URL(`../${rel}`, import.meta.url);
const UA = { headers: { 'User-Agent': 'koshien-db/0.1 (personal non-commercial project)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(p('raw'), { recursive: true });

async function fetchRaw(title, depth = 0) {
  const res = await fetch(`https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`, UA);
  if (!res.ok) return null;
  const body = await res.text();
  const r = body.match(/^#(?:REDIRECT|転送)\s*\[\[([^\]#]+)/i);
  if (r && depth < 3) return fetchRaw(r[1], depth + 1);
  return body;
}
async function cached(file, titles) {
  const path = p(`raw/${file}`);
  if (!existsSync(path)) {
    for (const t of titles) { const b = await fetchRaw(t); await sleep(800); if (b && b.length > 200 && !b.includes('Wikimedia Error')) { writeFileSync(path, b); break; } }
  }
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// 地区大会の記事（記事名 → 地区名）
const REGIONAL = {
  秋季北海道高等学校野球大会: '北海道', 秋季東北地区高等学校野球大会: '東北', 秋季関東地区高等学校野球大会: '関東',
  秋季東京都高等学校野球大会: '東京', 北信越地区高等学校野球大会: '北信越', 秋季東海地区高等学校野球大会: '東海',
  秋季近畿地区高等学校野球大会: '近畿', 中国地区高等学校野球大会: '中国', 秋季四国地区高等学校野球大会: '四国', 九州地区高等学校野球大会: '九州',
};
const problems = [];
const regional = [];
for (const [title, region] of Object.entries(REGIONAL)) {
  const text = await cached(`regional-${title}.wiki`, [title]);
  if (!text) { problems.push(`地区大会の記事が取れない: ${title}`); continue; }
  regional.push(...parseRegionalPage(text, region));
}
// Wikipedia にない地区大会の結果（config/spring-regional.json の regional）。同じ年・地区の行に足す
const extraRegional = JSON.parse(readFileSync(p('config/spring-regional.json'), 'utf8')).regional ?? [];
for (const r of extraRegional) {
  regional.push({ year: r.year, region: r.region, champion: r.champion ? schoolKey(r.champion) : null, runnerUp: r.runnerUp ? schoolKey(r.runnerUp) : null,
    semis: (r.semis ?? []).map(schoolKey), quarters: (r.quarters ?? []).map(schoolKey), source: r.source });
}

const { tournaments } = JSON.parse(readFileSync(p('config/sources.json'), 'utf8'));
const districts = JSON.parse(readFileSync(p('config/districts.json'), 'utf8'));
const extra = JSON.parse(readFileSync(p('config/spring-regional.json'), 'utf8'));
const entries = parseCsv(readFileSync(p('data/entries.csv'), 'utf8'));
const currentName = new Map(parseCsv(readFileSync(p('data/schools.csv'), 'utf8')).map((s) => [s.school_id, s.name]));
// 球歴.com の秋季地区大会の試合結果（config/kyureki-regional.json）。校名は球歴.com の表記なので一部を読み替える
const KY_ALIAS = { 市立呉: '呉', 四学大香川西: '香川西', '春江工・坂井': '春江工', エナジックスポーツ高等学院: 'エナジックスポーツ' };
const kyName = (n) => schoolKey(KY_ALIAS[n] ?? n);
const loadExtra = (file, name) => (existsSync(p(file)) ? JSON.parse(readFileSync(p(file), 'utf8')).regional : []).map((r) => ({
  ...r, champion: r.champion && name(r.champion), runnerUp: r.runnerUp && name(r.runnerUp),
  semis: r.semis.map(name), quarters: r.quarters.map(name), entrants: r.entrants.map(name),
}));
const kyureki = loadExtra('config/kyureki-regional.json', kyName);
// 個人サイト「高校野球 秋の地区大会成績」の全試合スコア（主に2001年秋以前）
const xrea = loadExtra('config/xrea-regional.json', schoolKey);
const LEVEL = { 優勝: 5, 準優勝: 4, '4強': 3, '8強': 2, 出場: 1, 不出場: 0 };
// 学校ごとの出典つきの成績（spring は春の大会ID、name は当時の校名か略称。pref は秋の都道府県大会の成績）
const bySchool = new Map();
for (const x of extra.schools ?? []) {
  if (x.result && !(x.result in LEVEL)) problems.push(`spring-regional.json: 成績不正 ${x.spring} ${x.name} ${x.result}`);
  bySchool.set(`${x.spring}|${schoolKey(x.name)}`, { ...x, used: false });
}

const rows = [];
const stat = { categories: {}, results: {} };
const unknownSince2002 = [];
for (const t of tournaments.filter((x) => x.season === 'spring')) {
  if (t.oldid && !existsSync(p(`raw/${t.id}.wiki`))) {
    const res = await fetch(`https://ja.wikipedia.org/w/index.php?oldid=${t.oldid}&action=raw`, UA);
    if (res.ok) writeFileSync(p(`raw/${t.id}.wiki`), await res.text());
  }
  const text = await cached(`${t.id}.wiki`, [t.title, ...(t.altTitles ?? [])]);
  const sel = text ? parseSelectionCategories(text) : [];
  const byLabel = new Map(sel.map((s) => [s.label, s.category]));
  const autumn = regional.filter((r) => r.year === t.year - 1);
  for (const e of entries.filter((x) => x.tournament_id === t.id)) {
    const category = byLabel.get(e.name_at_time) ?? '一般';
    if (sel.length && !byLabel.has(e.name_at_time)) problems.push(`${t.id}: 選出校表に ${e.name_at_time} がない（一般として扱う）`);
    // 前年秋の地区大会：同名校が複数の地区にあれば、出場当時の都道府県の地区を優先
    const key = schoolKey(e.name_at_time);
    const keys = new Set([key, schoolKey(currentName.get(e.school_id) ?? '')].filter(Boolean));
    const home = districts[e.prefecture];
    // 地区の食い違い（奈良の広陵と広島の広陵など同名の別の学校）を避けるため、出場当時の都道府県の地区と合うものだけ採る
    const fits = (region) => region === home || (region === '中部' && ['東海', '北信越'].includes(home)) || (region === '関東' && home === '東京');
    const lookup = (list) => {
      const hs = [];
      for (const r of list) {
        const has = (k) => keys.has(k);
        const result = has(r.champion) ? '優勝' : has(r.runnerUp) ? '準優勝' : r.semis.some(has) ? '4強' : (r.quarters ?? []).some(has) ? '8強' : (r.entrants ?? []).some(has) ? '出場' : null;
        if (result) hs.push({ region: r.region, result, source: r.source });
      }
      return hs.sort((a, b) => LEVEL[b.result] - LEVEL[a.result]);
    };
    // Wikipedia と出典つきの地区大会データを先に見て、なければ球歴.com、さらになければ個人サイトの試合結果
    const hits = lookup(autumn);
    let hit = hits.find((h) => fits(h.region));
    if (!hit) hit = lookup(kyureki.filter((r) => r.year === t.year - 1)).find((h) => fits(h.region));
    if (!hit) hit = lookup(xrea.filter((r) => r.year === t.year - 1)).find((h) => fits(h.region));
    for (const h of hits) if (!fits(h.region)) problems.push(`${t.id}: ${e.name_at_time}（${e.prefecture}）が別地区の${h.region}大会の${h.result}と同名（採らない）`);
    const ov = extra.entries?.[t.id]?.[e.name_at_time] ?? bySchool.get(`${t.id}|${key}`);
    if (ov) ov.used = true;
    let source = hit ? (hit.source ?? 'Wikipedia（地区大会の記事）') : '';
    if (ov?.result && (!hit || LEVEL[ov.result] > LEVEL[hit.result])) { hit = { region: ov.region ?? home, result: ov.result }; source = ov.source; }
    else if (ov?.result && hit && LEVEL[ov.result] < LEVEL[hit.result] && !(ov.result === '出場' && hit.result === '8強')) problems.push(`${t.id}: ${e.name_at_time} 出典の食い違い（地区記事 ${hit.result} / ${ov.source} ${ov.result}）`);
    const pref = ov?.pref ?? '';
    stat.categories[category] = (stat.categories[category] ?? 0) + 1;
    stat.results[hit?.result ?? '不明'] = (stat.results[hit?.result ?? '不明'] ?? 0) + 1;
    if (!hit && t.year >= 2002) unknownSince2002.push(`${t.id} ${e.name_at_time}（${e.prefecture}・${category}）`);
    rows.push({ tournament_id: t.id, school_id: e.school_id, selection: category, region: hit?.region ?? '', result: hit?.result ?? '', pref, source: pref && !source ? ov.source : source });
  }
}
for (const [k, x] of bySchool) if (!x.used) problems.push(`spring-regional.json: 出場校に当たらない ${k}（${x.name}）`);
const cols = ['tournament_id', 'school_id', 'selection', 'region', 'result', 'pref_result', 'source'];
writeFileSync(p('data/spring-extra.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => String(r[c] ?? '').replace(/,/g, '、')).join(','))].join('\n') + '\n');
console.log(`センバツの出場 ${rows.length}件  区分:`, stat.categories, ' 地区大会:', stat.results);
console.log(`2002年以降で地区大会の成績が不明: ${unknownSince2002.length}件`);
writeFileSync(p('raw/spring-unknown.txt'), unknownSince2002.join('\n') + '\n');
if (problems.length) { console.log(`\n要確認 ${problems.length}件:\n` + problems.slice(0, 80).map((s) => `  - ${s}`).join('\n')); }
