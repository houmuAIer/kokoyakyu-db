// ドラフト記事・選手記事の読み取り
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDraftArticle, parsePlayerArticle, classYearOf, isHighSchool, statusOf } from '../src/draft-parse.js';
import { parseCsv } from '../src/csv.js';

test('DBの学校ID（記事名）はすべて高校と判定される', () => {
  const ids = parseCsv(readFileSync(new URL('../data/schools.csv', import.meta.url), 'utf8')).map((s) => s.school_id.replace(/#.*/, ''));
  assert.deepEqual(ids.filter((id) => !isHighSchool(id)), []);
  assert.equal(isHighSchool('明治大学硬式野球部'), false);
  assert.equal(isHighSchool('東海大学'), false);
});

test('高校3年の年は4月2日〜翌4月1日生まれで区切る', () => {
  assert.equal(classYearOf([1994, 7, 5]), 2012);
  assert.equal(classYearOf([2003, 2, 27]), 2020);
  assert.equal(classYearOf([1968, 4, 1]), 1985);
  assert.equal(classYearOf([1968, 4, 2]), 1986);
});

test('球団別の表：順位・育成・リンク省略・所属列のない表を読む', () => {
  const text = `== 球団別指名選手一覧 ==
=== A球団 ===
{| class="wikitable"
! colspan="5" |新人選手選択会議
|-
!順位!!選手名!!守備!!所属!!結果
|-
!1位
|[[甲]]||投手||[[X高等学校|X高]]||入団
|-
|2位||style="background-color: #EE82EE"|[[乙]]||内野手||X高||拒否・Y大学進学||style="text-align:center;"| -
|-
! colspan="5" |育成選手選択会議
|-
!1位
|{{仮リンク|丙|ko|x}}||投手||[[Z大学硬式野球部|Z大学]]||
|}
{| class="wikitable"
!選手名!!守備!!指名球団
|-
|[[甲]]||投手||A、B
|}`;
  const rows = parseDraftArticle(text);
  assert.deepEqual(rows.map((r) => [r.kind, r.round, r.player, r.affiliationLinks[0], statusOf(r.result)]), [
    ['regular', 1, '甲', 'X高等学校', 'signed'],
    ['regular', 2, '乙', 'X高等学校', 'declined'],
    ['development', 1, '丙', 'Z大学硬式野球部', 'unknown'],
  ]);
});

test('選手記事：経歴の最後の高校と生年月日', () => {
  const head = `{{Infobox baseball player
| 生年月日 = {{生年月日と年齢|2003|2|27}}
| 経歴 =
* [[A中学校]]
* [[B高等学校|B高校]]
* [[C高等学校|C高校]]
* [[D大学硬式野球部|D大学]]
| 経歴補足 =
* [[E高等学校]]
}}`;
  assert.deepEqual(parsePlayerArticle(head, isHighSchool), { school: 'C高等学校', schoolLabel: 'C高校', birth: [2003, 2, 27] });
});
