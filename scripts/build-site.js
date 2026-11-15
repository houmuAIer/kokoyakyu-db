// dist/ に公開用ファイル一式を組み立てる（Cloudflare Pagesの出力先）
// --preview を付けると、データとJSを埋め込んだ単一ファイル dist/preview.html も作る
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const p = (rel) => new URL(rel, root);
rmSync(p('dist'), { recursive: true, force: true });
mkdirSync(p('dist'), { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js']) cpSync(p(`web/${f}`), p(`dist/${f}`));
cpSync(p('src/aggregate.js'), p('dist/aggregate.js'));
cpSync(p('public/data.json'), p('dist/data.json'));

if (process.argv.includes('--preview')) {
  const strip = (js) => js.replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const html = readFileSync(p('web/index.html'), 'utf8')
    .replace('<link rel="stylesheet" href="./style.css">', `<style>\n${readFileSync(p('web/style.css'), 'utf8')}</style>`)
    .replace('<script type="module" src="./app.js"></script>',
      `<script>window.__DATA__ = ${readFileSync(p('public/data.json'), 'utf8').replace(/</g, '\\u003c')};</script>\n<script type="module">\n${strip(readFileSync(p('src/aggregate.js'), 'utf8'))}\n${strip(readFileSync(p('web/app.js'), 'utf8'))}\n</script>`);
  writeFileSync(p('dist/preview.html'), html);
}
console.log('dist/ を作成しました');
