// センバツの選考に関わる情報を Wikipedia から読む。
// 1. 選抜の記事の「選出校」節：一般選考／21世紀枠／希望枠の区分
// 2. 秋季地区大会の記事の「大会結果」表：年ごとの優勝・準優勝（記事によってはベスト4）
import { parseSelections } from './wiki-parse.js';

const section = (text, heading) => {
  const m = text.match(new RegExp(`^(=+)\\s*${heading}\\s*\\1\\s*$`, 'm'));
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(new RegExp(`^={1,${m[1].length}}[^=]`, 'm'));
  return next < 0 ? rest : rest.slice(0, next);
};

const CATEGORY = [[/21世紀枠/, '21世紀枠'], [/希望枠/, '希望枠'], [/一般選考/, '一般']];

/** 選抜の記事 → [{ article, label, category }]（category は 一般 / 21世紀枠 / 希望枠） */
export function parseSelectionCategories(text) {
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  const sec = section(text, '選出校') ?? section(text, '出場校');
  if (!sec) return [];
  // 区分の見出し（=== 21世紀枠 === や 表の見出し行 !colspan="4"|21世紀枠）で区切る
  const segments = [{ category: '一般', lines: [] }];
  for (const line of sec.split('\n')) {
    const isMarker = /^(=+).*\1\s*$/.test(line.trim()) || (line.startsWith('!') && !/!!/.test(line));
    const hit = isMarker && CATEGORY.find(([re]) => re.test(line));
    if (hit) { segments.push({ category: hit[1], lines: [] }); continue; }
    segments.at(-1).lines.push(line);
  }
  return segments.filter(({ lines }) => lines.some((l) => /^[|*]/.test(l) && /\[\[/.test(l))).flatMap(({ category, lines }) => parseSelections(`== 選出校 ==\n${lines.join('\n')}`).map((r) => ({ ...r, category })));
}

// ---------- 秋季地区大会 ----------
const strip = (s) => s
  .replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  .replace(/\{\{[Bb]y\|([^}|]+)\}\}/g, '$1')
  .replace(/\{\{[^{}]*\}\}/g, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')
  .replace(/'''?/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim();
const cellBody = (c) => c.replace(/^\s*(?:(?:rowspan|colspan|style|align|bgcolor|class)\s*=\s*(?:"[^"]*"|[^|\s]*)\s*)+\|(?!\|)/, '').trim();
/** 表の校名（「広島商（広島）」「★横浜(26)」など）を照合用の形にする */
export const schoolKey = (s) => strip(s)
  .replace(/[★☆*＊]/g, '').replace(/[（(][^）)]*[）)]/g, '')
  .replace(/\s+/g, '').replace(/高等学校$|高校$|高$/, '')
  .replace(/工業$/, '工').replace(/商業$/, '商').replace(/農業$/, '農').replace(/実業$/, '実')
  .replace(/慶應義塾|慶応義塾|慶應/g, '慶応').replace(/^専修大/, '専大').replace(/大学附属|大学付属|大附属|大付属|大附/g, '大付')
  .replace(/第([一二三])/g, '$1').replace(/辯/g, '弁').replace(/ヶ/g, 'ケ').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const SCORE = /^\d+x?\s*[-－–]\s*\d+x?/;

/**
 * 地区大会の記事 → [{ year, region, champion, runnerUp, semis: [] }]（year は秋の大会の年）
 * 表は「大会（年）・優勝校・決勝スコア・準優勝校（・ベスト4×2）」の形。春秋が同じ表にある記事は秋季の行だけ読む。
 * 関東の記事だけは県別の出場校表で、優勝校が赤文字になっている（準優勝は載っていない）。
 */
export function parseRegionalPage(text, region) {
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  let inTable = false, hasSemis = false, tableRegion = region, year = null, kantoStyle = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('{|')) { inTable = true; hasSemis = false; kantoStyle = false; year = null; tableRegion = region; continue; }
    if (line.startsWith('|}')) { inTable = false; continue; }
    if (!inTable || line.startsWith('|-') || line.startsWith('|+')) continue;
    if (line.startsWith('!')) {
      if (/ベスト4/.test(line)) hasSemis = true;
      if (/秋季中部地区/.test(line)) tableRegion = '中部';
      if (/秋季東海地区/.test(line)) tableRegion = '東海';
      if (/!回!!年度!!茨城/.test(line.replace(/\s/g, ''))) kantoStyle = true;
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.slice(1).split('||').map(cellBody);
    const yCell = cells.map((c) => strip(c).match(/(19[4-9]\d|20\d\d)/)).find(Boolean);
    if (yCell) year = Number(yCell[1]);
    if (!year) continue;
    if (kantoStyle) {
      const champ = line.match(/<span[^>]*color:\s*red[^>]*>(.*?)<\/span>/);
      if (champ) out.push({ year, region: tableRegion, champion: schoolKey(champ[1]), runnerUp: null, semis: [] });
      continue;
    }
    if (cells.some((c) => /春季/.test(c))) continue;
    const i = cells.findIndex((c) => SCORE.test(strip(c).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))));
    if (i < 1 || i + 1 >= cells.length) continue;
    const semis = hasSemis ? cells.slice(i + 2, i + 4).map(schoolKey).filter(Boolean) : [];
    out.push({ year, region: tableRegion, champion: schoolKey(cells[i - 1]), runnerUp: schoolKey(cells[i + 1]), semis });
  }
  return out;
}
