/**
 * 界面层静态一致性测试。
 *
 * 浏览器里跑不动自动化测试（也不该为此引入重型依赖），
 * 但界面层最常见的两类错误可以在 Node 里提前发现：
 *   1. 脚本存在语法错误 → 整页白屏；
 *   2. 脚本引用了并不存在的元素 id → 运行到那一步才崩。
 * 这两类问题在这里被拦下，剩下的交给人眼验收。
 *
 * 运行：node --test
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'web', '股市模拟.html'), 'utf8');

const coreMatch = html.match(/<script id="game-core">([\s\S]*?)<\/script>/);
const uiMatch = html.match(/<script id="game-ui">([\s\S]*?)<\/script>/);

test('页面结构：核心脚本与界面脚本都存在，且核心在前', () => {
  assert.ok(coreMatch, '缺少 <script id="game-core">');
  assert.ok(uiMatch, '缺少 <script id="game-ui">');
  assert.ok(html.indexOf('id="game-core"') < html.indexOf('id="game-ui"'), '内核必须先于界面加载');
  assert.match(html, /<meta name="viewport"/, '必须声明 viewport 以适配手机');
  assert.match(html, /<html lang="zh-CN">/);
});

test('脚本语法：内核与界面脚本都能被解析', () => {
  assert.doesNotThrow(() => new vm.Script(coreMatch[1], { filename: 'game-core.js' }), '内核脚本存在语法错误');
  assert.doesNotThrow(() => new vm.Script(uiMatch[1], { filename: 'game-ui.js' }), '界面脚本存在语法错误');
});

test('界面脚本引用的元素 id 必须都存在于 HTML 中', () => {
  const referenced = new Set();
  for (const m of uiMatch[1].matchAll(/\bel\('([^']+)'\)/g)) referenced.add(m[1]);
  // getElementById 也会用到，一并检查（动态生成的元素除外）
  for (const m of uiMatch[1].matchAll(/getElementById\('([^']+)'\)/g)) referenced.add(m[1]);

  const declared = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) declared.add(m[1]);

  // 弹层里动态创建的元素，不在静态 HTML 中
  const dynamic = new Set(['seed-input']);

  const missing = [...referenced].filter((id) => !declared.has(id) && !dynamic.has(id));
  assert.deepEqual(missing, [], `界面脚本引用了不存在的元素 id：${missing.join(', ')}`);
  assert.ok(referenced.size >= 15, '界面脚本引用的元素过少，抽取逻辑可能失效');
});

test('交付形态：单文件、无本地图片、图表库有三级加载链', () => {
  assert.ok(!/<img\s/i.test(html), '不应依赖本地图片，图标请用 Emoji 或 CSS');
  assert.ok(!/url\(\s*['"]?(?!data:)[^)]*\.(png|jpg|jpeg|gif|webp|svg)/i.test(html), 'CSS 中不应引用图片文件');

  // 本地 vendor 优先，公网 CDN 兜底，最后是内置 Canvas 绘制
  assert.match(html, /'vendor\/lightweight-charts\.js'/,
    '应优先加载同目录 vendor 下的图表库（由 npm run web:prepare 同步）');
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/lightweight-charts@4\.2\.3/, '应有 jsDelivr 兜底源');
  assert.match(html, /unpkg\.com\/lightweight-charts@4\.2\.3/, '应有 unpkg 兜底源');
  assert.match(html, /drawCandles/, '离线时必须能退回内置 Canvas 绘图');
});

test('样式：只使用内联 CSS，并声明了响应式断点与减弱动效', () => {
  assert.ok(!/<link[^>]+stylesheet/i.test(html), '不应引入外部样式表');
  assert.match(html, /<style>/, '缺少内联样式');
  assert.match(html, /@media \(max-width: 1080px\)/, '缺少移动端断点');
  assert.match(html, /prefers-reduced-motion/, '应尊重系统的"减弱动效"设置');
});

test('存档：使用版本化的 localStorage 键，并在离开页面前兜底保存', () => {
  assert.match(html, /stock-sim:save:v1/, '存档键应带版本号');
  assert.match(html, /visibilitychange/);
  assert.match(html, /pagehide/);
});
