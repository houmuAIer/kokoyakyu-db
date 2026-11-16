// config/sources.json の大会をまとめて取り込み、data/*.csv を作り直す。
// 使い方: node scripts/import-wikipedia.js
// wikitext は raw/<大会ID>.wiki に保存し、既にあれば再取得しない（転送ページはたどる）。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseSummerArticle, parseSpringArticle, prefectureOfSlot } from '../src/wiki-parse.js';
import { resolveTitles, canonical } from './redirects.js';

const p = (rel) => new URL(`../${rel}`, import.meta.url);
const { tournaments: sources } = JSON.parse(readFileSync(p('config/sources.json'), 'utf8'));
const overrides = JSON.parse(readFileSync(p('config/overrides.json'), 'utf8')).tournaments;
const prefCachePath = p('config/school-prefectures.json');
const prefCache = existsSync(prefCachePath) ? JSON.parse(readFileSync(prefCachePath, 'utf8')) : {};
mkdirSync(p('raw'), { recursive: true });
mkdirSync(p('data'), { recursive: true });
const UA = { headers: { 'User-Agent': 'koshien-db/0.1 (personal non-commercial project)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRaw(title, depth = 0) {
  const res = await fetch(`https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`, UA);
  if (!res.ok) return null;
  const body = await res.text();
  const r = body.match(/^#(?:REDIRECT|転送)\s*\[\[([^\]#]+)/i);
  if (r && depth < 3) return fetchRaw(r[1], depth + 1);
  return body;
}
async function wikitext(src) {
  const path = p(`raw/${src.id}.wiki`);
  if (!existsSync(path) && src.oldid) {
    // 荒らし・誤記のある版を避けるため、版を固定している大会（config/sources.json の oldid）
    const res = await fetch(`https://ja.wikipedia.org/w/index.php?oldid=${src.oldid}&action=raw`, UA);
    if (res.ok) writeFileSync(path, await res.text());
    await sleep(800);
  }
  if (!existsSync(path)) {
    for (const t of [src.title, ...(src.altTitles ?? [])]) {
      const body = await fetchRaw(t);
      await sleep(800);
      if (body && body.length > 200) { writeFileSync(path, body); break; }
    }
    if (!existsSync(path)) throw new Error(`記事が見つからない: ${src.title}`);
  }
  return readFileSync(path, 'utf8');
}

/** 学校記事の基本情報欄（所在地・都道府県）から都道府県を読む */
async function prefectureFromSchoolArticle(article) {
  const body = await fetchRaw(article.replace(/#.*/, ''));
  await sleep(800);
  if (!body) return null;
  const box = body.slice(0, 6000);
  const line = box.split('\n').find((l) => /^\|\s*(都道府県|所在地)\s*=/.test(l)) ?? '';
  const m = line.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').match(/(北海道|東京都|京都府|大阪府|.{2,3}?県)/);
  if (!m) return null;
  return prefectureOfSlot(m[1].replace(/[都府県]$/, '')) ?? (m[1] === '北海道' ? '北海道' : null);
}

const problems = [];
// ---- 1段目：全大会を読む ----
const parsed = [];
for (const src of sources) {
  const ov = overrides[src.id] ?? {};
  const parse = src.season === 'spring' ? parseSpringArticle : parseSummerArticle;
  const { reps, games } = parse(await wikitext(src), src.year);
  for (const g of ov.addGames ?? []) games.push({ ...g, replay: !!g.replay });
  for (const fix of ov.patchGames ?? []) {
    const hit = games.find((g) => g.round === fix.round && g.type !== 'draw' && [g.a, g.b].sort().join('|') === [fix.a, fix.b].sort().join('|'));
    if (!hit) problems.push(`${src.id}: 補正対象の試合がない ${fix.a}-${fix.b}`);
    else Object.assign(hit, { date: fix.date ?? hit.date, gameNo: fix.gameNo ?? hit.gameNo });
  }
  for (const r of reps) if (ov.schoolPrefectures?.[r.article]) r.prefecture = ov.schoolPrefectures[r.article];
  parsed.push({ src, ov, reps, games });
}

// ---- 1.5段目：学校の記事名を転送先の正式な記事名にそろえる（年によって別名の記事にリンクされていることがある）----
await resolveTitles(parsed.flatMap(({ reps }) => reps.map((r) => r.article.replace(/#.*/, ''))));
// 改称は1校に一本化、統合は別の学校（config/school-lineage.json）
const lineage = JSON.parse(readFileSync(p('config/school-lineage.json'), 'utf8'));
const splitHits = new Map(lineage.splits.map((x, i) => [i, 0]));
for (const { src, reps, ov } of parsed) for (const r of reps) {
  r.article = ov.schoolIdByLabel?.[r.label] ?? canonical(r.article);
  r.article = lineage.renames[r.article]?.to ?? r.article;
  const i = lineage.splits.findIndex((x) => x.successor === r.article && x.labels.includes(r.label) && src.year < x.before);
  if (i >= 0) { r.article = lineage.splits[i].id; splitHits.set(i, splitHits.get(i) + 1); }
  if (ov.schoolPrefectures?.[r.article]) r.prefecture = ov.schoolPrefectures[r.article];
}
for (const [i, n] of splitHits) if (!n) problems.push(`school-lineage.json の統合ルールが1件も当たらない: ${lineage.splits[i].labels.join('・')} → ${lineage.splits[i].id}`);

// ---- 2段目：都道府県が分からない学校（1977年以前の複数県の代表枠）を埋める ----
const known = new Map();
for (const { reps } of parsed) for (const r of reps) if (r.prefecture) known.set(r.article, r.prefecture);
for (const { src, reps } of parsed) {
  for (const r of reps) {
    if (r.prefecture) continue;
    if (known.has(r.article)) { r.prefecture = known.get(r.article); continue; }
    if (!prefCache[r.article]) {
      const pref = await prefectureFromSchoolArticle(r.article);
      prefCache[r.article] = pref ? { prefecture: pref, source: `Wikipedia「${r.article.replace(/#.*/, '')}」の基本情報欄` } : { prefecture: null, source: '判定できず' };
    }
    r.prefecture = prefCache[r.article].prefecture;
    if (r.prefecture) known.set(r.article, r.prefecture);
    else problems.push(`${src.id}: 都道府県を判定できない ${r.label}（${r.article}、代表枠 ${r.slot}）`);
  }
}
writeFileSync(prefCachePath, JSON.stringify(Object.fromEntries(Object.entries(prefCache).sort()), null, 2) + '\n');

// ---- 3段目：CSV の行を作る ----
const rows = { tournaments: [], schools: new Map(), entries: [], games: [] };
for (const { src, ov, reps, games } of parsed) {
  const alias = ov.nameAliases ?? {};
  const byLabel = new Map(reps.map((r) => [r.label, r]));
  const sid = (label0) => {
    const label = alias[label0] ?? label0;
    let r = byLabel.get(label);
    if (!r) { // 「海星（三重）」「徳島海南」のように県名で区別された同名校
      const m = label.match(/^(.+)[（(](.+)[）)]$/);
      if (m) r = reps.find((x) => x.label === m[1] && x.prefecture === prefectureOfSlot(m[2]));
      if (!r) r = reps.find((x) => x.prefecture && label === x.prefecture + x.label);
      if (!r) r = byLabel.get(label.replace(/[（(][^）)]*[）)]$/, '')); // 「帯広農（4アウトの誤審）」のような注記
    }
    if (!r) { problems.push(`${src.id}: 代表校表にない校名「${label0}」`); return `?${label0}`; }
    return r.article;
  };
  rows.tournaments.push({ tournament_id: src.id, year: src.year, season: src.season, edition: src.edition, num_teams: reps.length });
  for (const r of reps) {
    // 学校の都道府県は最新の大会のもの。出場ごとの都道府県は当時のもの（慶應義塾は東京→神奈川など移転がある）
    rows.schools.set(r.article, { school_id: r.article, name: r.label, prefecture: r.prefecture ?? '' });
    rows.entries.push({ tournament_id: src.id, school_id: r.article, name_at_time: r.label, prefecture: r.prefecture ?? '', slot: r.slot === r.prefecture ? '' : r.slot });
  }
  const id = (i) => `${src.id}-${String(i + 1).padStart(3, '0')}`;
  const pairOf = (g) => `${g.round}|${[sid(g.a), sid(g.b)].sort().join('|')}`;
  const drawIds = new Map(games.map((g, i) => [g, id(i)]).filter(([g]) => g.type === 'draw').map(([g, gid]) => [pairOf(g), gid]));
  games.forEach((g, i) => {
    const pair = pairOf(g);
    let replayOf = '';
    if (g.type !== 'draw' && drawIds.has(pair)) replayOf = drawIds.get(pair);
    else if (g.replay && g.type !== 'draw') problems.push(`${src.id}: 再試合 ${g.a}-${g.b} の元の引き分け試合がない（overrides で補う）`);
    rows.games.push({
      game_id: id(i), tournament_id: src.id, round: g.round, date: g.date, game_no: g.gameNo ?? '',
      school_a: sid(g.a), score_a: g.scoreA ?? '', school_b: sid(g.b), score_b: g.scoreB ?? '',
      winner: g.winner ? sid(g.winner) : '', type: g.type, replay_of: replayOf,
    });
  });
}

const save = (name, header, list) => {
  const cols = header.split(',');
  writeFileSync(p(`data/${name}.csv`), [header, ...list.map((r) => cols.map((c) => String(r[c] ?? '').replace(/,/g, '、')).join(','))].join('\n') + '\n');
};
save('tournaments', 'tournament_id,year,season,edition,num_teams', rows.tournaments);
save('schools', 'school_id,name,prefecture', [...rows.schools.values()].sort((x, y) => x.school_id.localeCompare(y.school_id, 'ja')));
save('entries', 'tournament_id,school_id,name_at_time,prefecture,slot', rows.entries);
save('games', 'game_id,tournament_id,round,date,game_no,school_a,score_a,school_b,score_b,winner,type,replay_of', rows.games);
console.log(`大会${rows.tournaments.length} 学校${rows.schools.size} 出場${rows.entries.length} 試合${rows.games.length}`);
if (problems.length) { console.log(`\n要確認 ${problems.length}件:\n` + [...new Set(problems)].map((x) => `  - ${x}`).join('\n')); process.exitCode = 2; }
