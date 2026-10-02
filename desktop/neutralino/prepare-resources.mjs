/**
 * 把网页项目同步成 Neutralino 的资源目录 desktop/resources/。
 *
 * 真源永远是 web/ 目录：
 *   web/股市模拟.html                   → resources/index.html（仅改名，不改内容）
 *   web/vendor/lightweight-charts.js    → resources/vendor/lightweight-charts.js
 *
 * 两个关键点：
 *
 * 1. HTML 在包内改名为 index.html。
 *    Neutralino 内置服务器对非 ASCII 路径的支持没有把握，用 ASCII 名可彻底避开。
 *
 * 2. 图表库必须落在游戏期望的相对路径上。
 *    游戏加载链的第一级就是相对路径 vendor/lightweight-charts.js，
 *    放对了桌面版离线时才有完整 K 线图；放错了**不会报错**，
 *    只会静默退回内置的 Canvas 简易图。
 */
import { mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // desktop/neutralino
const DESKTOP = join(HERE, '..');                        // desktop
const ROOT = join(DESKTOP, '..');                        // 仓库根
const WEB = join(ROOT, 'web');

const RESOURCES = join(DESKTOP, 'resources');
const GAME_SOURCE = join(WEB, '股市模拟.html');
const CHART_SOURCE = join(WEB, 'vendor', 'lightweight-charts.js');
const CHART_RELATIVE = join('vendor', 'lightweight-charts.js');

for (const [label, file] of [['游戏本体', GAME_SOURCE], ['图表库', CHART_SOURCE]]) {
  if (!existsSync(file)) {
    console.error(`× 找不到${label}：${file}`);
    if (label === '图表库') console.error('  先运行 npm run web:prepare（或 npm install）同步图表库。');
    process.exit(1);
  }
}

// 每次全量重建，避免上一次的残留文件混进包里
rmSync(RESOURCES, { recursive: true, force: true });
mkdirSync(join(RESOURCES, dirname(CHART_RELATIVE)), { recursive: true });

copyFileSync(GAME_SOURCE, join(RESOURCES, 'index.html'));
copyFileSync(CHART_SOURCE, join(RESOURCES, CHART_RELATIVE));

console.log('desktop/resources/ 已就绪：');
console.log('  index.html                        ← web/股市模拟.html（不改内容，仅改名）');
console.log(`  ${CHART_RELATIVE.split('\\').join('/')}      ← web/vendor/lightweight-charts.js`);
