// サンプルデータ（架空）に対し、手計算した期待値と照合する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDb } from '../src/build.js';
import { aggregate, rank, opponents, headToHead, debutOrder, debutStats, lastDebuts, fromYearForRecent, selectTournaments, schoolHistory, draftGeneration, schoolDrafts, generationYears, draftRanking, generationRanking } from '../src/aggregate.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const { db, errors } = buildDb({
  tournamentsCsv: read('test/fixtures/tournaments.csv'), schoolsCsv: read('test/fixtures/schools.csv'),
  entriesCsv: read('test/fixtures/entries.csv'), gamesCsv: read('test/fixtures/games.csv'), draftsCsv: read('test/fixtures/drafts.csv'),
  districts: JSON.parse(read('config/districts.json')), eras: JSON.parse(read('config/eras.json')),
});
const by = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));
const pick = (r, ...ks) => Object.fromEntries(ks.map((k) => [k, r[k]]));

test('サンプルデータに検証エラーがない', () => assert.deepEqual(errors, []));

test('学校別の勝敗：引き分け・不戦勝・交流試合を除外', () => {
  const r = by(aggregate(db, { level: 'school' }));
  const wl = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.wins, v.losses]]));
  assert.deepEqual(wl, {
    S01: [1, 2], S02: [3, 1], S03: [1, 2], S04: [1, 1], S05: [0, 2], S06: [5, 1],
    S07: [2, 1], S08: [2, 2], S09: [0, 1], S10: [0, 1], S11: [0, 1],
  });
});

test('学校別の到達ラウンド・出場数', () => {
  const r = by(aggregate(db, { level: 'school' }));
  assert.deepEqual(pick(r.S06, 'appearances', 'best8', 'best4', 'runnerUp', 'champion'), { appearances: 2, best8: 2, best4: 2, runnerUp: 1, champion: 1 });
  assert.deepEqual(pick(r.S07, 'best8', 'best4', 'runnerUp', 'champion'), { best8: 2, best4: 2, runnerUp: 0, champion: 0 }); // 2024春は不戦敗でもベスト4
  assert.deepEqual(pick(r.S10, 'appearances', 'best8'), { appearances: 1, best8: 0 });
  assert.equal(r.S05.appearances, 2); // 交流試合の出場は数えない
});

test('県別：東西東京・南北北海道をまとめて集計、県内対決は勝ち負け両方に入る', () => {
  const r = by(aggregate(db, { level: 'prefecture' }));
  assert.deepEqual(pick(r['北海道'], 'appearances', 'wins', 'losses', 'best4', 'champion'), { appearances: 4, wins: 4, losses: 3, best4: 2, champion: 1 });
  assert.deepEqual(pick(r['東京'], 'appearances', 'wins', 'losses'), { appearances: 3, wins: 2, losses: 3 });
  assert.deepEqual(pick(r['大阪'], 'wins', 'losses', 'best4', 'runnerUp', 'champion'), { wins: 5, losses: 2, best4: 2, runnerUp: 1, champion: 1 });
});

test('代表枠別：北北海道・南北海道・東東京・西東京を分ける', () => {
  const r = by(aggregate(db, { level: 'slot' }));
  assert.deepEqual([r['北北海道'].wins, r['北北海道'].losses], [1, 1]);
  assert.deepEqual([r['南北海道'].wins, r['南北海道'].losses], [3, 0]);
  assert.deepEqual([r['北海道'].wins, r['北海道'].losses], [0, 2]); // 春は北海道で1枠
  assert.deepEqual([r['東東京'].wins, r['東東京'].losses], [0, 1]);
  assert.deepEqual([r['西東京'].wins, r['西東京'].losses], [1, 1]);
});

test('地区別（選抜の地区割り）', () => {
  const r = by(aggregate(db, { level: 'district' }));
  assert.deepEqual([r['近畿'].wins, r['近畿'].losses], [7, 3]);
  assert.deepEqual([r['関東'].wins, r['関東'].losses], [0, 1]); // 山梨は関東
  assert.deepEqual([r['東京'].wins, r['東京'].losses], [2, 3]);
});

test('勝ち星合計＝負け合計＝通常試合数', () => {
  const rows = aggregate(db, { level: 'school' });
  const w = rows.reduce((s, r) => s + r.wins, 0), l = rows.reduce((s, r) => s + r.losses, 0);
  const n = db.games.filter((g) => g.type === 'normal').length;
  assert.deepEqual([w, l], [n, n]);
  assert.equal(n, 15);
});

test('直近n年・春夏の絞り込み', () => {
  const from = fromYearForRecent(db, 1);
  assert.equal(from, 2025);
  const r1 = by(aggregate(db, { level: 'school', fromYear: from }));
  assert.deepEqual([r1.S06.wins, r1.S06.losses], [2, 1]);
  const sp = by(aggregate(db, { level: 'school', seasons: ['spring'] }));
  assert.deepEqual([sp.S06.wins, sp.S06.losses], [3, 0]);
});

test('ランキング：勝率は最低試合数で足切り', () => {
  const top = rank(aggregate(db, { level: 'school' }), 'winRate', { minGames: 3 });
  assert.deepEqual(top.slice(0, 3).map((r) => r.key), ['S06', 'S02', 'S07']);
  assert.ok(top.every((r) => r.wins + r.losses >= 3));
});

test('対戦校別戦績（学校）', () => {
  const o = by(opponents(db, { level: 'school', key: 'S06' }));
  assert.deepEqual(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [v.wins, v.losses]])),
    { S01: [1, 0], S03: [1, 0], S08: [1, 0], S05: [1, 0], S07: [1, 0], S02: [0, 1] });
});

test('県対県（例：北海道 vs 東京、宮城 vs 兵庫は引き分けを表示のみ）', () => {
  const h = headToHead(db, { level: 'prefecture', a: '北海道', b: '東京' });
  assert.deepEqual([h.wins, h.losses, h.games.length], [2, 0, 2]);
  const m = headToHead(db, { level: 'prefecture', a: '宮城', b: '兵庫' });
  assert.deepEqual([m.wins, m.losses, m.games.length], [0, 1, 2]);
  const same = headToHead(db, { level: 'prefecture', a: '北海道', b: '北海道' });
  assert.deepEqual([same.wins, same.losses, same.games.length], [1, 1, 1]);
  const list = Object.fromEntries(opponents(db, { level: 'prefecture', key: '北海道' }).map((o) => [o.key, [o.wins, o.losses, o.games.length]]));
  assert.deepEqual(list['北海道'], [1, 1, 1]);
});

test('夏の登場順：同じ試合で初登場する2校は同じ番号、最後の1校は出場校数と同じ番号', () => {
  const d = Object.fromEntries(debutOrder(db).map((r) => [r.schoolId, r.order]));
  assert.deepEqual(d, { S04: 2, S10: 2, S08: 4, S11: 4, S01: 5, S02: 7, S03: 7, S05: 9, S06: 9, S07: 10 });
  const last = lastDebuts(db);
  assert.deepEqual(last.map((r) => [r.tournament.id, r.schoolId, r.order, r.result, r.stage]), [['2025N', 'S07', 10, '勝', 'ベスト4']]);
  const st = Object.fromEntries(debutStats(db).map((r) => [r.order, [r.wins, r.losses]]));
  assert.deepEqual(st, { 2: [1, 1], 4: [1, 1], 5: [1, 0], 7: [1, 1], 9: [1, 1], 10: [1, 0] });
  assert.equal(debutOrder(db, { seasons: ['spring'] }).length, 10); // 春を指定しても夏だけを数える
});

test('登場順：初戦が不戦勝・不戦敗の学校は数えない（2021年夏の辞退のようなケース）', () => {
  const g = (id, round, date, no, a, b, winner, type = 'normal') => ({ id, tournamentId: 'T', round, date, gameNo: no, a, b, scoreA: 1, scoreB: 0, winner, type });
  const mini = {
    eras: db.eras, tournaments: [{ id: 'T', year: 2021, season: 'summer', numTeams: 5 }],
    games: [g('1', 'R1', '2021-08-10', 1, 'A', 'B', 'A'), g('2', 'R2', '', null, 'C', 'D', 'C', 'forfeit'), g('3', 'R2', '2021-08-12', 1, 'E', 'A', 'E'), g('4', 'SF', '2021-08-20', 1, 'C', 'E', 'C')],
  };
  const d = Object.fromEntries(debutOrder(mini).map((r) => [r.schoolId, r.order]));
  assert.deepEqual(d, { A: 2, B: 2, E: 3 }); // C（不戦勝）・D（辞退）は対象外。C の準決勝を「初戦」と誤認しない
  assert.equal(lastDebuts(mini)[0].schoolId, 'E');
});

test('都道府県は出場当時のもの（移転した学校は年によって県が変わる）', () => {
  const moved = { ...db, entries: db.entries.map((e) => (e.tournamentId === '2024S' && e.schoolId === 'S09' ? { ...e, prefecture: '東京' } : e)) };
  const r = by(aggregate(moved, { level: 'prefecture' }));
  assert.equal(r['山梨'], undefined); // S09 の唯一の出場（2024年春）は東京として数える
  assert.deepEqual([r['東京'].appearances, r['東京'].losses], [4, 4]);
});

test('学校の出場履歴', () => {
  const h = schoolHistory(db, { schoolId: 'S07' });
  assert.deepEqual(h.map((r) => [r.tournament.id, r.result, r.wins, r.losses]), [['2025N', 'ベスト4', 1, 1], ['2024S', 'ベスト4', 1, 0]]);
  const s05 = schoolHistory(db, { schoolId: 'S05' });
  assert.deepEqual(s05.map((r) => r.nameAtTime), ['青葉商（架空）', '仙台青葉商（架空・旧校名）']);
  assert.deepEqual(schoolHistory(db, { schoolId: 'S06' }).map((r) => r.result), ['準優勝', '優勝']);
  assert.deepEqual(schoolHistory(db, { schoolId: 'S10' }).map((r) => r.result), ['1回戦']);
});

test('元号：令和は2019年夏から（2019年春は平成）', () => {
  const t = (id, year, season) => ({ id, year, season });
  const mini = { eras: db.eras, tournaments: [t('2018N', 2018, 'summer'), t('2019S', 2019, 'spring'), t('2019N', 2019, 'summer'), t('2020S', 2020, 'spring'), t('1989S', 1989, 'spring'), t('1988N', 1988, 'summer')] };
  assert.deepEqual([...selectTournaments(mini, { era: '令和' })], ['2019N', '2020S']);
  assert.deepEqual([...selectTournaments(mini, { era: '平成' })], ['2018N', '2019S', '1989S']);
  assert.deepEqual([...selectTournaments(mini, { era: '昭和' })], ['1988N']);
});

test('世代の指名年：夏は大会年〜2年後、春は大会年〜1年後', () => {
  assert.deepEqual(generationYears({ year: 2025, season: 'summer' }), [2025, 2026, 2027]);
  assert.deepEqual(generationYears({ year: 2024, season: 'spring' }), [2024, 2025]);
});

test('大会時点で在籍していたドラフト指名選手（育成・拒否を含む、学年つき）', () => {
  // 2024春の浪速学院：2024指名(3年)・2025指名(2年)。2023指名は卒業済み、2026指名は入学前
  const s = draftGeneration(db, '2024S', 'S06');
  assert.equal(s.count, 2);
  assert.deepEqual(s.picks.map((d) => [d.player, d.grade]), [['山田一郎', 3], ['鈴木二郎', 2]]);
  assert.equal(s.partial, false);
  // 2025夏：2025(3年)・2026(2年)・2027(1年)。データの最新は2027なので確定
  const n = draftGeneration(db, '2025N', 'S06');
  assert.deepEqual(n.picks.map((d) => d.player), ['鈴木二郎', '佐藤三郎', '田中四郎']);
  assert.equal(draftGeneration(db, '2025N', 'S11').count, 1);
  assert.equal(draftGeneration(db, '2025N', 'S01').count, 0);
});

test('ドラフトのデータより前の世代は null、先の世代は partial', () => {
  const old = { ...db, drafts: db.drafts.filter((d) => d.year >= 2025) };
  assert.equal(draftGeneration(old, '2024S', 'S06'), null); // 3年生の指名年2024がデータ前
  const cut = { ...db, drafts: db.drafts.filter((d) => d.year <= 2026) };
  assert.equal(draftGeneration(cut, '2025N', 'S06').partial, true); // 1年生の指名年2027がデータ後
});

test('大社経由は高校3年の年で世代に入り、高卒とは別に数える', () => {
  const g = draftGeneration(db, '2025N', 'S06');
  assert.deepEqual(g.laterPicks.map((d) => [d.player, d.grade]), [['中村七郎', 3]]); // 2025年に高3、2029年に大学から指名
  assert.equal(g.count, 3);
  assert.equal(g.laterPartial, true); // 1年生（2027年高3）の大学経由は2031年なので、データ（〜2029年）ではまだ出そろわない
  assert.deepEqual(draftGeneration(db, '2024S', 'S06').laterPicks.map((d) => d.grade), [2]); // 2024春は新2年
});

test('指名数ランキングは期間（大会の年の範囲）に行われたドラフトを数える', () => {
  const r = by(draftRanking(db, { level: 'school' })); // 春夏の大会は2024〜2025年
  assert.deepEqual(pick(r.S06, 'total', 'hs', 'later', 'first', 'development'), { total: 2, hs: 2, later: 0, first: 1, development: 1 });
  assert.equal(r.S11.total, 1);
  assert.equal(by(draftRanking(db, { level: 'prefecture' }))['大阪'].total, 2);
  assert.deepEqual(by(draftRanking(db, { level: 'school', fromYear: 2025 })).S06.hs, 1);
  assert.deepEqual(schoolDrafts(db, { schoolId: 'S06', fromYear: 2025 }).map((d) => d.player), ['鈴木二郎']);
});

test('同一世代ランキング：出場ごとに在籍していた指名選手（入団は拒否を除く）', () => {
  const rows = generationRanking(db);
  const r = rows.find((x) => x.tournament.id === '2025N' && x.schoolId === 'S06');
  assert.deepEqual(pick(r, 'total', 'hs', 'later', 'signed'), { total: 4, hs: 3, later: 1, signed: 3 }); // 鈴木二郎は拒否
  assert.equal(r.result, schoolHistory(db, { schoolId: 'S06' }).find((h) => h.tournament.id === '2025N').result);
  assert.equal(rows.find((x) => x.tournament.id === '2024S' && x.schoolId === 'S06').total, 3);
  assert.ok(!rows.some((x) => x.tournament.season === 'exchange'));
});
