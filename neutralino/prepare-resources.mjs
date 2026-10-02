/**
 * 把游戏资源同步到 Neutralino 的 resources/ 目录。
 *
 * 真源永远是仓库根目录的「股市模拟.html」，这里只做拷贝、不改内容，
 * 免得出现"改了一份忘了另一份"的情况。
 *
 * 两个关键点：
 *
 * 1. HTML 在 resources 里改名为 index.html。
 *    Neutralino 内置服务器对非 ASCII 路径的支持没有把握，用 ASCII 文件名可彻底避开。
 *
 * 2. 图表库必须放在与 HTML 相同的相对路径下：
 *      resources/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js
 *    因为游戏里那条加载链的第一级就是相对路径 node_modules/...
 *    放对了，桌面版离线时才有完整 K 线图；放错了就只能退回内置的 Canvas 简易图。
 */
import { mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESOURCES = join(ROOT, 'resources');

const GAME_SOURCE = join(ROOT, '股市模拟.html');
const CHART_SOURCE = join(
  ROOT, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js',
);
const CHART_RELATIVE = join('node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js');

for (const [label, file] of [['游戏本体', GAME_SOURCE], ['图表库', CHART_SOURCE]]) {
  if (!existsSync(file)) {
    console.error(`× 找不到${label}：${file}`);
    if (label === '图表库') console.error('  先运行 npm install 装依赖。');
    process.exit(1);
  }
}

// 每次全量重建，避免上一次的残留文件混进包里
rmSync(RESOURCES, { recursive: true, force: true });
mkdirSync(join(RESOURCES, dirname(CHART_RELATIVE)), { recursive: true });

copyFileSync(GAME_SOURCE, join(RESOURCES, 'index.html'));
copyFileSync(CHART_SOURCE, join(RESOURCES, CHART_RELATIVE));

console.log('resources/ 已就绪：');
console.log('  index.html                        ← 股市模拟.html（不改内容，仅改名）');
console.log(`  ${CHART_RELATIVE.split('\\').join('/')}`);
