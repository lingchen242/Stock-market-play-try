/**
 * Neutralino 打包配置的一致性测试。
 *
 * 这套配置里有三处"改一处忘另一处就会静默失效"的地方，正是这里要守住的：
 *   1. documentRoot。写成包根的话所有资源都 404，窗口里只显示找不到 127.0.0.1。
 *   2. 端口。若设成 0（随机端口），WebView2 的 origin 每次都变，
 *      游戏的 localStorage 存档就会每次启动都丢失 —— 必须固定端口。
 *   3. 图表库的相对路径。游戏里加载链的第一级是相对路径，
 *      资源同步脚本必须把它放在同一个相对位置，否则桌面版离线时会丢掉 K 线图。
 *
 * 运行：node --test
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const config = JSON.parse(read('desktop/neutralino.config.json'));
const prepare = read('desktop/neutralino/prepare-resources.mjs');
const html = read('web/股市模拟.html');

test('配置：必填字段齐备，且 documentRoot 指向包内的 resources/', () => {
  // applicationId / url / defaultMode 是 schema 里的必填项
  assert.ok(config.applicationId, '缺少 applicationId');
  assert.ok(config.url, '缺少 url');
  assert.equal(config.defaultMode, 'window', '应以窗口模式启动');

  // 这是实际踩过的坑：Neutralino 打包时会保留 resources/ 这层目录名，
  // documentRoot 必须指向它。写成 "/" 的话，服务器会在包根找 index.html，
  // 于是所有资源都返回 404，WebView 里只显示"找不到 127.0.0.1 页面"。
  assert.equal(config.documentRoot, '/resources/', 'documentRoot 必须是 /resources/，否则资源全部 404');
  assert.equal(config.url, '/', 'url 应为文档根下的 /');
  assert.equal(config.cli.resourcesPath, '/resources/', 'resourcesPath 应指向源码目录 resources/');
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
  // 取出游戏里加载链的第一条本地源，它决定了资源必须放哪
  const block = html.match(/const CHART_SOURCES = \[([\s\S]*?)\];/);
  assert.ok(block, '未能从 HTML 中解析出 CHART_SOURCES');

  const local = [...block[1].matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .find((s) => !/^https?:/.test(s));
  assert.ok(local, 'CHART_SOURCES 里找不到本地图表库路径');
  assert.ok(!/node_modules/.test(local), '本地源不应再依赖 npm 的 node_modules 目录结构');

  for (const segment of local.split('/')) {
    assert.ok(
      prepare.includes(`'${segment}'`),
      `资源同步脚本缺少路径段 ${segment}，桌面版离线时将退回内置简易图`,
    );
  }
});

test('资源同步：入口改名为 ASCII 的 index.html，避免非 ASCII 路径风险', () => {
  assert.match(prepare, /copyFileSync\(GAME_SOURCE, join\(RESOURCES, 'index\.html'\)\)/);
  assert.ok(existsSync(join(ROOT, 'web', '股市模拟.html')), '游戏本体不存在');
});

test('package.json：Neutralino 三个脚本齐备', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['neutralino:prepare', 'neutralino:build', 'neutralino:run']) {
    assert.ok(pkg.scripts[name], `缺少脚本 ${name}`);
  }
  assert.ok(pkg.devDependencies['@neutralinojs/neu'], '缺少 @neutralinojs/neu 开发依赖');
  assert.match(pkg.scripts['neutralino:build'], /--embed-resources/, '应把资源嵌进二进制，产出单文件 exe');
});

test('打包产物：desktop/dist 里只保留 Windows 版 exe（若已构建）', () => {
  const dist = join(ROOT, 'desktop', 'dist');
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
  // 只允许残留运行时日志；出现别的平台的二进制或分发包才算异常
  const stray = files.filter((f) => /\.(exe|zip|dmg|appimage)$/i.test(f) && !/win_x64\.exe$/i.test(f));
  assert.deepEqual(stray, [], `dist/ 里残留了非 Windows 产物：${stray.join('、')}`);
});

/**
 * 端到端：把打包好的 exe 真的启动起来，用 HTTP 把首页内容取回来。
 *
 * 这条用例是补上来的教训。最初我只验证了「进程活着 + 窗口标题正确 + WebView2 在跑」，
 * 但这三项在 WebView 显示 404 错误页时**同样成立**，于是漏掉了"资源全部 404、
 * 页面显示找不到 127.0.0.1"的真实故障。只有把页面内容真正取回来，才算验证过。
 *
 * 仅在 dist/ 里已有 exe 时运行（即构建过之后），未构建则跳过。
 * 注意：运行时会短暂弹出一个应用窗口，几秒后自动关闭。
 */
test('端到端：打包后的 exe 必须真的能通过 HTTP 提供游戏页面', async () => {
  const exe = join(ROOT, 'desktop', 'dist', 'StockSim', 'StockSim-win_x64.exe');
  if (process.platform !== 'win32' || !existsSync(exe)) return;

  // 先确认端口上没有残留实例。否则这条用例可能对着旧进程"假通过"，
  // 表面上绿了，实际上新打包的 exe 根本没被验证。
  let alreadyRunning = false;
  try {
    const probe = await fetch(`http://127.0.0.1:${config.port}/`);
    alreadyRunning = probe.ok;
  } catch {
    alreadyRunning = false;
  }
  assert.equal(
    alreadyRunning, false,
    `端口 ${config.port} 上已有服务在响应，请先关闭残留的 StockSim 实例再跑测试，否则验证结果不可信`,
  );

  const child = spawn(exe, { cwd: dirname(exe), stdio: 'ignore' });

  const fetchHome = async () => {
    const deadline = Date.now() + 20000;
    let last = '尚未开始';
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${config.port}/`);
        if (res.ok) return res.text();
        last = `HTTP ${res.status}`;
      } catch (error) {
        last = error.message;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`20 秒内没能取到页面（最后一次结果：${last}）`);
  };

  try {
    const body = await fetchHome();
    assert.match(body, /game-core/, '首页应包含游戏内核脚本');
    assert.match(body, /股市模拟/, '首页应是游戏页面，而不是错误页');
    assert.match(body, /CHART_SOURCES/, '首页应包含图表加载逻辑');
  } finally {
    child.kill();
  }
});
