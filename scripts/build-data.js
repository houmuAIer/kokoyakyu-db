// data/*.csv を検証して public/data.json に書き出す。エラーがあれば終了コード1
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildDb } from '../src/build.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const { db, errors } = buildDb({
  tournamentsCsv: read('data/tournaments.csv'),
  schoolsCsv: read('data/schools.csv'),
  entriesCsv: read('data/entries.csv'),
  gamesCsv: read('data/games.csv'),
  draftsCsv: read('data/drafts.csv'),
  springExtraCsv: read('data/spring-extra.csv'),
  districts: JSON.parse(read('config/districts.json')),
  eras: JSON.parse(read('config/eras.json')),
});
if (errors.length) {
  console.error(`データエラー ${errors.length}件:\n` + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
// 公開用 JSON では学校IDを短い記号に置き換えて小さくする（記事名は article に残す）
const short = new Map(db.schools.map((sc, i) => [sc.id, `s${i.toString(36)}`]));
const S = (id) => (id ? short.get(id) : id);
db.schools = db.schools.map((sc) => ({ ...sc, article: sc.id, id: S(sc.id) }));
db.entries = db.entries.map((e) => ({ ...e, schoolId: S(e.schoolId), selection: e.selection === '一般' ? undefined : e.selection }));
db.games = db.games.map((g) => ({ ...g, a: S(g.a), b: S(g.b), winner: S(g.winner) }));
// ドラフトは球団名を番号にして小さくする（teams に一覧）
db.draftTeams = [...new Set(db.drafts.map((d) => d.team))];
const teamNo = new Map(db.draftTeams.map((t, i) => [t, i]));
// 既定値（本指名・入団）は省き、画面側で補う
db.drafts = db.drafts.map((d) => {
  const later = d.route === 'later';
  return { ...d, schoolId: S(d.schoolId), team: teamNo.get(d.team), kind: d.kind === 'regular' ? undefined : d.kind, status: d.status === 'signed' ? undefined : d.status,
    route: later ? 'later' : undefined, affiliation: later ? d.affiliation : undefined, classYear: later ? d.classYear : undefined };
});
mkdirSync(new URL('../public', import.meta.url), { recursive: true });
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '' && v !== undefined));
writeFileSync(new URL('../public/data.json', import.meta.url), JSON.stringify({ ...db, entries: db.entries.map(drop), games: db.games.map(drop), drafts: db.drafts.map(drop) }));
console.log(`OK: 大会${db.tournaments.length} 学校${db.schools.length} 出場${db.entries.length} 試合${db.games.length} ドラフト${db.drafts.length}`);
