// 球歴.com（www.kyureki.com）の秋季地区大会の試合結果から、各校の最終成績（優勝〜出場）を起こして
// config/kyureki-regional.json を作り直す。センバツの「前年秋の地区大会の成績」の補完に使う。
// 使い方: node scripts/import-kyureki.js
// - 大会ID一覧は raw/kyureki/ids.json、試合一覧は raw/kyureki/games-<地区>-<年>.json にキャッシュ（なければ取得）。
// - 校名が空の試合は、チームIDからチームページの題名を引いて補う（raw/kyureki/team-names.json にキャッシュ）。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const p = (rel) => new URL(`../${rel}`, import.meta.url);
const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (kokoyakyu-db personal research)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(p('raw/kyureki'), { recursive: true });
const FROM = 1947, TO = 2025;

// 地区 → 球歴.com の大会種別と、その種別の任意の年の大会ID（年ごとのIDの一覧はこのページから取る）
const TYPES = { 四国: ['t123', 894], 九州: ['t124', 663], 中国: ['t125', 637], 近畿: ['t126', 1895], 北信越: ['t127', 778], 東海: ['t128', 1551], 関東: ['t129', 1956], 東北: ['t130', 1524] };

const idsPath = p('raw/kyureki/ids.json');
let ids = existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, 'utf8')) : {};
for (const [region, [type, any]] of Object.entries(TYPES)) {
  if (ids[region]) continue;
  const html = await (await fetch(`https://www.kyureki.com/koko/game/${type}/${any}/`, UA)).text();
  const years = {};
  for (const m of html.matchAll(new RegExp(`href="https://www.kyureki.com/koko/game/${type}/(\\d+)/">(\\d{4})年<`, 'g'))) years[m[2]] = Number(m[1]);
  ids[region] = { type, years };
  await sleep(1000);
}
writeFileSync(idsPath, JSON.stringify(ids));

const games = {};
for (const [region, { years }] of Object.entries(ids)) {
  for (const [y, tid] of Object.entries(years)) {
    if (y < FROM || y > TO) continue;
    const path = p(`raw/kyureki/games-${region}-${y}.json`);
    if (!existsSync(path)) {
      const q = new URLSearchParams({ mode: 'json', type: 'game_list', taikai_id: tid, server_name: 'www.kyureki.com' });
      const res = await fetch(`https://www.kyureki.com/game_tmp/ajax.php?${q}`, UA);
      if (res.ok) writeFileSync(path, await res.text());
      await sleep(1000);
    }
    if (existsSync(path)) games[`${region}|${y}`] = JSON.parse(readFileSync(path, 'utf8'));
  }
}

// 校名が空のチームIDを補う（同じIDに名前がついている試合があればそれ、なければチームページの題名）
const namesPath = p('raw/kyureki/team-names.json');
const teamNames = existsSync(namesPath) ? JSON.parse(readFileSync(namesPath, 'utf8')) : {};
const seen = {};
for (const list of Object.values(games)) for (const g of list) for (const t of ['1', '2']) {
  const name = (g[`team${t}`] ?? '').trim();
  if (name) seen[g[`team${t}_id`]] ??= name;
}
for (const list of Object.values(games)) for (const g of list) for (const t of ['1', '2']) {
  const id = g[`team${t}_id`];
  if ((g[`team${t}`] ?? '').trim() || seen[id] || id in teamNames) continue;
  const res = await fetch(`https://www.kyureki.com/koko/1/${id}/`, UA); // 正しいURLへ転送される
  const title = res.ok ? ((await res.text()).match(/<title>([^<]+?)高校野球部/) ?? [])[1] : null;
  teamNames[id] = title ?? null;
  await sleep(1000);
}
writeFileSync(namesPath, JSON.stringify(teamNames));
const nameOf = (g, t) => (g[`team${t}`] ?? '').trim() || seen[g[`team${t}_id`]] || teamNames[g[`team${t}_id`]] || '';

const out = [];
for (const [key, list] of Object.entries(games)) {
  const [region, y] = key.split('|');
  const best = {};
  for (const g of list) {
    const a = Number.parseInt(g.team1_ten, 10), b = Number.parseInt(g.team2_ten, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue; // 引き分け（再試合あり）・未入力
    const [w, l] = a > b ? [nameOf(g, '1'), nameOf(g, '2')] : [nameOf(g, '2'), nameOf(g, '1')];
    if (g.status === '決勝') { best[w] = '優勝'; best[l] = '準優勝'; }
    else if (g.status === '準決勝') best[l] ??= '4強';
    else if (g.status === '準々決勝') best[l] ??= '8強';
    else best[l] ??= '出場';
  }
  delete best[''];
  if (!Object.keys(best).length) continue;
  const of = (r) => Object.keys(best).filter((k) => best[k] === r).sort();
  const { type, years } = ids[region];
  out.push({
    year: Number(y), region, champion: of('優勝')[0] ?? null, runnerUp: of('準優勝')[0] ?? null,
    semis: of('4強'), quarters: of('8強'), entrants: of('出場'), games: list.length,
    source: `https://www.kyureki.com/koko/game/${type}/${years[y]}/（球歴.com 高校野球${region}大会秋季${y}年の試合結果）`,
  });
}
out.sort((a, b) => a.region.localeCompare(b.region) || a.year - b.year);
const cfgPath = p('config/kyureki-regional.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.regional = out;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 0));
console.log(`${out.length}大会（${FROM}〜${TO}年秋）`);
