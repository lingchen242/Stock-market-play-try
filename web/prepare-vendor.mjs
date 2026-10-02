/**
 * 把图表库从 node_modules 同步到 web/vendor/。
 *
 * 游戏是一个可以单独拷走的 HTML 交付物，它不该知道 npm 的目录结构，
 * 所以加载链的第一级指向同目录下的 vendor/lightweight-charts.js，由这个脚本填充。
 * 挂在 npm 的 postinstall 上，`npm install` 之后即可离线双击运行。
 */
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(WEB_DIR, '..');

const SOURCE = join(ROOT, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js');
const TARGET_DIR = join(WEB_DIR, 'vendor');
const TARGET = join(TARGET_DIR, 'lightweight-charts.js');

if (!existsSync(SOURCE)) {
  console.error('× 找不到图表库，请先运行 npm install');
  process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });
copyFileSync(SOURCE, TARGET);

const kb = (statSync(TARGET).size / 1024).toFixed(0);
console.log(`web/vendor/lightweight-charts.js 已就绪（${kb} KB）`);
