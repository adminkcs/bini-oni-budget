// 정적 웹 빌드: Mobile.html + Common.html → docs/index.html (GitHub Pages가 docs/를 서비스)
// Apps Script 템플릿 태그를 정적 값으로 바꾸고, 정적 웹 어댑터를 붙인다.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const common = read('Common.html');
let html = read('Mobile.html');

const replaceOnce = (from, to) => {
  if (!html.includes(from)) throw new Error('빌드 실패: 템플릿 태그를 찾지 못함 → ' + from);
  html = html.replace(from, () => to);
};
replaceOnce('<?!= getBootstrapJson() ?>', 'null');
replaceOnce("<?!= include('Common'); ?>", common);
replaceOnce('<?!= getServerPerfJson() ?>', 'null');
if (html.includes('<?')) throw new Error('빌드 실패: 처리하지 않은 템플릿 태그가 남아 있음');

const head = [
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<link rel="icon" href="icon-192.png">',
  '<meta name="robots" content="noindex">',
  '<style>',
  '  #web-status { position: fixed; left: 8px; right: 8px; bottom: 8px; z-index: 8000; display: flex; gap: 8px;',
  '    align-items: center; justify-content: space-between; background: #1A1A1A; color: #fff; font-size: 13px;',
  '    padding: 10px 12px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,.2); }',  '  #web-status button { flex: none; background: #0046FF; color: #fff; border: none; border-radius: 8px;',
  '    padding: 7px 12px; font-weight: 700; font-size: 13px; }',
  '</style>'
].join('\n  ');
html = html.replace('<meta charset="UTF-8">', () => '<meta charset="UTF-8">\n  ' + head);
html = html.replace('<title>비니네 오니네 가계부 (Mobile)</title>', () => '<title>비니네 오니네 가계부</title>');
html = html.replace('</body>', () => '  <script src="sheets-data.js"></script>\n  <script src="sheets-write.js"></script>\n' +
  '  <script src="static-adapter.js"></script>\n</body>');

mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', html);
copyFileSync('web/sheets-data.js', 'docs/sheets-data.js');
copyFileSync('web/sheets-write.js', 'docs/sheets-write.js');
copyFileSync('web/static-adapter.js', 'docs/static-adapter.js');
copyFileSync('web/privacy.html', 'docs/privacy.html');
copyFileSync('assets/icon-192.png', 'docs/icon-192.png');
writeFileSync('docs/.nojekyll', '');
console.log('docs/ 빌드 완료 (' + Math.round(html.length / 1024) + 'KB)');
