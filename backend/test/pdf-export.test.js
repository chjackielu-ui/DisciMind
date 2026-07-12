const test=require('node:test');const assert=require('node:assert/strict');const pdf=require('../src/modules/file-generator/pdf-export.service');
test('PDF HTML is CSP-isolated and has Chinese font fallbacks',()=>{const html=pdf.safeHtml('<article>中文讲义</article>','讲义');assert.match(html,/default-src 'none'/);assert.match(html,/Microsoft YaHei/);assert.match(html,/Noto Sans CJK SC/);assert.match(html,/SimSun/);assert.match(html,/中文讲义/);});
test('a bundled Chromium executable is discoverable',async()=>{assert.match(await pdf.browserPath(),/(chrome|msedge)\.exe$/i)});
