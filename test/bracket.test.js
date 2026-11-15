// トーナメント整合性チェックが転記ミスを検出できるか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDb } from '../src/build.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const base = {
  tournamentsCsv: read('test/fixtures/tournaments.csv'), schoolsCsv: read('test/fixtures/schools.csv'),
  entriesCsv: read('test/fixtures/entries.csv'), gamesCsv: read('test/fixtures/games.csv'),
  districts: JSON.parse(read('config/districts.json')), eras: JSON.parse(read('config/eras.json')),
};
const withGames = (fn) => buildDb({ ...base, gamesCsv: fn(base.gamesCsv) }).errors;

test('勝者を取り違えると検出する', () => {
  // 準々決勝 G09 の勝者を逆にする（得点も合わせて入れ替え）
  const errs = withGames((s) => s.replace('G09,2025N,QF,2025-08-18,1,S01,3,S04,2,S01', 'G09,2025N,QF,2025-08-18,1,S01,2,S04,3,S04'));
  assert.ok(errs.some((e) => e.includes('負けた後に')), errs.join('\n'));
});

test('試合が1つ抜けると検出する', () => {
  const errs = withGames((s) => s.split('\n').filter((l) => !l.startsWith('H02,')).join('\n'));
  assert.ok(errs.some((e) => e.includes('試合数')), errs.join('\n'));
});

test('得点と勝者の矛盾を検出する', () => {
  const errs = withGames((s) => s.replace('G15,2025N,F,2025-08-22,1,S02,3,S06,2,S02', 'G15,2025N,F,2025-08-22,1,S02,3,S06,2,S06'));
  assert.ok(errs.some((e) => e.includes('矛盾')), errs.join('\n'));
});
