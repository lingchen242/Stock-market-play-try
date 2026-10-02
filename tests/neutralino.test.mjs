/**
 * Neutralino 打包配置的一致性测试。
 *
 * 这套配置里有两处"改一处忘另一处就会静默失效"的地方，正是这里要守住的：
 *   1. 端口。若设成 0（随机端口），WebView2 的 origin 每次都变，
 *      游戏的 localStorage 存档就会每次启动都丢失 —— 必须固定端口。
 *   2. 图表库的相对路径。游戏里加载链的第一级是相对路径，
 *      资源同步脚本必须把它放在同一个相对位置，否则桌面版离线时会丢掉 K 线图。
 *
 * 运行：node --test
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const config = JSON.parse(read('neutralino.config.json'));
const prepare = read('neutralino/prepare-resources.mjs');
const html = read('股市模拟.html');

test('配置：必填字段齐备，且入口指向 index.html', () => {
  // applicationId / url / defaultMode 是 schema 里的必填项
  assert.ok(config.applicationId, '缺少 applicationId');
  assert.ok(config.url, '缺少 url');
  assert.equal(config.defaultMode, 'window', '应以窗口模式启动');
  assert.equal(config.url, '/index.html', 'url 应指向同步脚本生成的那个 ASCII 入口');
});

test('配置：端口必须固定，否则每次启动都会丢存档', () => {
  assert.equal(typeof config.port, 'number', 'port 必须是数字');
  assert.notEqual(config.port, 0, 'port 为 0 表示随机端口，localStorage 的 origin 每次都会变，存档必然丢失');
  assert.ok(config.port > 1024 && config.port < 65536, `端口 ${config.port} 不在合理范围`);
});

test('配置：窗口标题为中文「股市模拟」，尺寸与游戏适配一致', () => {
  const win = config.modes.window;
  assert.equal(win.title, '股市模拟');
  assert.equal(win.minWidth, 360, '游戏适配到 360px 宽，窗口最小宽度应一致');
  assert.ok(win.width >= 1200, '默认宽度应给足三栏布局');
  assert.equal(win.exitProcessOnClose, true, '关窗应结束进程');
});

test('配置：不开启 native API（游戏是纯网页，不需要）', () => {
  assert.equal(config.enableNativeAPI, false, '游戏不需要任何原生能力，保持关闭');
});

test('资源同步：图表库必须落在游戏期望的相对路径上', () => {
  // 取出游戏里加载链的第一条源，它决定了资源必须放哪
  const source = html.match(/const CHART_SOURCES = \[\s*'([^']+)'/);
  assert.ok(source, '未能从 HTML 中解析出 CHART_SOURCES');

  for (const segment of source[1].split('/')) {
    assert.ok(
      prepare.includes(`'${segment}'`),
      `资源同步脚本缺少路径段 ${segment}，桌面版离线时将退回内置简易图`,
    );
  }
});

test('资源同步：入口改名为 ASCII 的 index.html，避免非 ASCII 路径风险', () => {
  assert.match(prepare, /copyFileSync\(GAME_SOURCE, join\(RESOURCES, 'index\.html'\)\)/);
  assert.ok(existsSync(join(ROOT, '股市模拟.html')), '游戏本体不存在');
});

test('package.json：Neutralino 三个脚本齐备', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['neutralino:prepare', 'neutralino:build', 'neutralino:run']) {
    assert.ok(pkg.scripts[name], `缺少脚本 ${name}`);
  }
  assert.ok(pkg.devDependencies['@neutralinojs/neu'], '缺少 @neutralinojs/neu 开发依赖');
  assert.match(pkg.scripts['neutralino:build'], /--embed-resources/, '应把资源嵌进二进制，产出单文件 exe');
});

test('打包产物：dist/ 里只保留 Windows 版 exe（若已构建）', () => {
  const dist = join(ROOT, 'dist');
  if (!existsSync(dist)) {
    // 还没构建过，跳过；这不是配置错误
    return;
  }
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(name);
    }
  };
  walk(dist);
  const stray = files.filter((f) => !/win_x64\.exe$/i.test(f));
  assert.deepEqual(stray, [], `dist/ 里残留了非 Windows 产物：${stray.join('、')}`);
});
