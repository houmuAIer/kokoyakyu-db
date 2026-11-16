# 高校野球 戦績DB

公開サイト：https://kokoyakyu-db.pages.dev

戦後（夏1946年・春1947年）以降の春夏の全国大会の勝敗戦績を集計する静的Webアプリ。サーバ不要（集計はすべてブラウザ側）。

## コマンド

- `npm run import` … `config/sources.json` の大会を Wikipedia から取り込み、`data/*.csv` を作り直す（取得した記事は `raw/` に保存し再利用）
- `npm run import:drafts` … 1965年以降のドラフト会議の記事から、甲子園出場校の高校生の指名（育成・入団拒否を含む）を取り込み `data/drafts.csv` を作り直す（`npm run import` の後に実行。補正は `config/draft-overrides.json`）
- `node scripts/crosscheck-champions.js` … 歴代優勝校の一覧と決勝・出場校数を照合
- `node scripts/lineage-evidence.js` / `node scripts/founding-scan.js` … 学校の統合・改称を見分けるための根拠の洗い出し
- `node scripts/crosscheck-hb.js <大会ID> <HTML>` … 別出典（高校野球ドットコムの大会ページ）との全試合照合。検証専用
- `npm test` … 集計ロジックのテスト（サンプルデータで手計算値と照合）
- `npm run build` … `data/*.csv` を検証して `dist/` に公開用ファイル一式を出力
- `npm run preview` … 上記に加え、単一ファイルの `dist/preview.html` も作る（ダブルクリックで開ける）

## Cloudflare Pages の設定

- ビルドコマンド：`npm run build`
- 出力ディレクトリ：`dist`

## 構成

- `data/` … 戦績データ（CSV）。スキーマは `SCHEMA.md`
- `config/` … 地区割り（選抜準拠）、元号の境目、取り込み対象（sources.json）、補正（overrides.json）、学校の名寄せ（school-redirects.json・school-lineage.json）、都道府県の判定記録（school-prefectures.json）
- 検証の記録は `VERIFICATION.md`
- `src/aggregate.js` … 集計ロジック（ブラウザ・Node共通）
- `src/build.js` … CSVの読み込みと整合性チェック
- `web/` … 画面（HTML/CSS/JS）

## データの出典

試合結果は Wikipedia 日本語版の各大会の記事、ドラフト指名は各年の「新人選手選択会議 (日本プロ野球)」の記事をもとに作成しています（取り込み元の記事の原文はリポジトリに含めていません。`npm run import` で再取得できます）。検証の内容は `VERIFICATION.md` を参照してください。

個人が運営する非公式のデータベースで、大会主催者・関係団体とは関係ありません。
