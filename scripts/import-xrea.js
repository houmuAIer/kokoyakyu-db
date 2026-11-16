// 「高校野球 秋の地区大会成績」（koushien.s100.xrea.com、個人サイト）の地区大会の年度別ページから、各校の最終成績を起こして
// config/xrea-regional.json を作る。センバツの「前年秋の地区大会の成績」の補完（主に2001年秋以前）に使う。
// 使い方: node scripts/import-xrea.js   （raw/xrea/aki<地区番号>-<年>.html にキャッシュ。なければ取得）
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const p = (rel) => new URL(`../${rel}`, import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(p('raw/xrea'), { recursive: true });
// サイトの地区番号 → 地区名（6 は「中部」のページ。年代により東海・北信越を含む）
const REGIONS = { 1: '北海道', 2: '東北', 3: '関東', 4: '東京', 5: '北信越', 6: '東海', 7: '近畿', 8: '中国', 9: '四国', 10: '九州' };
const FROM = 1947, TO = 2001;
const z2h = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

const out = [];
// 北信越大会がない年は、地区番号6のページは北信越を含む「中部」大会
const hasFinal = (no, y) => {
  const path = p(`raw/xrea/aki${no}-${y}.html`);
  return existsSync(path) && /決勝/.test(new TextDecoder('shift_jis').decode(readFileSync(path)));
};
for (const [no, region] of Object.entries(REGIONS)) {
  for (let y = FROM; y <= TO; y++) {
    const path = p(`raw/xrea/aki${no}-${y}.html`);
    const url = `http://koushien.s100.xrea.com/aki${no}/${String(y % 100).padStart(2, '0')}.htm`;
    if (!existsSync(path)) {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
      writeFileSync(path, res?.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0));
      await sleep(700);
    }
    const buf = readFileSync(path);
    if (!buf.length) continue;
    const html = new TextDecoder('shift_jis').decode(buf);
    // 回戦の見出しと、試合ごとの2行（校名と赤字の合計得点）を順に読む
    const rounds = []; // [{ name, games: [[a, sa, b, sb]] }]
    const re = /<td[^>]*bgcolor[^>]*>\s*<font[^>]*>\s*<big>([^<]+)<|<th>\s*<big>([^<]+)<\/big>\s*<\/th>([\s\S]*?)<font color="red">([^<]*)<\/font>/g;
    let pending = null;
    for (const m of html.matchAll(re)) {
      if (m[1]) { rounds.push({ name: m[1].trim(), games: [] }); pending = null; continue; }
      if (!rounds.length) continue;
      const team = m[2].trim().replace(/\s+/g, ''), score = Number.parseInt(z2h(m[4]).replace(/\D/g, ''), 10);
      if (!pending) pending = [team, score];
      else { rounds.at(-1).games.push([pending[0], pending[1], team, score]); pending = null; }
    }
    const games = rounds.flatMap((r) => r.games.map((g) => ({ round: r.name, g })));
    if (!games.some((x) => /^決勝/.test(x.round))) continue; // 決勝まで載っていない年は使わない
    const order = rounds.map((r) => r.name);
    if (!order.some((n) => /^準決勝/.test(n))) continue; // 準決勝のない方式（リーグ戦など）の年は勝ち上がりを決められないので使わない
    const semiAt = order.findIndex((n) => /^準決勝/.test(n));
    const best = {};
    order.forEach((name, i) => {
      for (const [a, sa, b, sb] of rounds[i].games) {
        if (!Number.isFinite(sa) || !Number.isFinite(sb) || sa === sb) continue; // 引き分け（再試合）・不明
        const [w, l] = sa > sb ? [a, b] : [b, a];
        if (/^決勝/.test(name)) { best[w] = '優勝'; best[l] = '準優勝'; }
        else if (/^準決勝/.test(name)) best[l] ??= '4強';
        else if (i === semiAt - 1) best[l] ??= '8強';
        else best[l] ??= '出場';
      }
    });
    const of = (r) => Object.keys(best).filter((k) => best[k] === r).sort();
    out.push({
      year: y, region: no === '6' && !hasFinal(5, y) ? '中部' : region, champion: of('優勝')[0] ?? null, runnerUp: of('準優勝')[0] ?? null,
      semis: of('4強'), quarters: of('8強'), entrants: of('出場'), rounds: order.length,
      source: `${url}（高校野球 秋の地区大会成績 ${region}${y}年）`,
    });
  }
}
writeFileSync(p('config/xrea-regional.json'), JSON.stringify({
  note: '個人サイト「高校野球 秋の地区大会成績」（koushien.s100.xrea.com）の地区大会の年度別ページ（全試合のスコア）から、学校ごとの最終成績を起こしたもの。地区番号6のページは「中部」で、ここでは東海として扱う（年代により北信越の学校を含む）。準決勝の直前の回戦の敗者を8強、それより前の敗者を出場とした。Wikipedia や他の出典で分からないときだけ使う。',
  regional: out,
}, null, 0));
console.log(`${out.length}大会`);
