/**
 * Electron 打包配置的一致性测试。
 *
 * 打包配置最容易出的问题是"配了但没生效"或"改了主进程忘了改配置"，
 * 而这些问题通常要等到真跑一次 250 MB 的构建才暴露。这里用静态检查提前拦住。
 *
 * 注意：main.cjs 只做语法解析，不执行 —— 它 require('electron')，
 * 而本测试运行时 electron 未必已安装。
 *
 * 运行：node --test
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const mainSrc = read('desktop/electron/main.cjs');
const builderYml = read('desktop/electron-builder.yml');
const pkg = JSON.parse(read('package.json'));

test('主进程：语法可解析，并且关闭了 Node 集成', () => {
  assert.doesNotThrow(() => new vm.Script(mainSrc, { filename: 'main.cjs' }), 'main.cjs 存在语法错误');
  assert.match(mainSrc, /nodeIntegration:\s*false/, '必须关闭 nodeIntegration');
  assert.match(mainSrc, /contextIsolation:\s*true/, '必须开启 contextIsolation');
  assert.match(mainSrc, /sandbox:\s*true/, '必须开启 sandbox');
});

test('主进程：加载的就是交付物 HTML，且文件真实存在', () => {
  assert.match(mainSrc, /'股市模拟\.html'/, '主进程应加载 股市模拟.html');
  assert.ok(existsSync(join(ROOT, 'web', '股市模拟.html')), '游戏文件不存在');
});

test('打包配置：游戏本体与图表库都必须进包', () => {
  assert.match(builderYml, /web\/股市模拟\.html/, 'files 里缺少游戏本体');
  assert.match(
    builderYml,
    /web\/vendor\/lightweight-charts\.js/,
    'files 里缺少图表库，桌面版离线时会失去 K 线图',
  );
  assert.match(builderYml, /desktop\/dist-electron/, '输出目录应为 desktop/dist-electron');
  assert.match(builderYml, /portable/, '应产出免安装便携版');
  assert.match(builderYml, /nsis/, '应产出安装版');
});

test('打包配置：不把开发文件带进安装包', () => {
  const filesBlock = builderYml.split('files:')[1].split('asar:')[0];
  assert.ok(!/tests\//.test(filesBlock), 'tests 不应被打包');
  assert.ok(!/server\.mjs/.test(filesBlock), 'server.mjs 不应被打包');
  assert.ok(!/docs\//.test(filesBlock), 'docs 不应被打包');
});

test('package.json：Electron 入口与三个脚本齐备，且脚本指向真实文件', () => {
  assert.equal(pkg.main, 'desktop/electron/main.cjs', 'main 必须指向主进程');
  for (const name of ['electron:setup', 'electron:dev', 'electron:build']) {
    assert.ok(pkg.scripts[name], `缺少脚本 ${name}`);
  }
  assert.ok(existsSync(join(ROOT, 'desktop/electron/setup.ps1')), 'desktop/electron/setup.ps1 不存在');
  assert.ok(existsSync(join(ROOT, 'desktop/electron/build.ps1')), 'desktop/electron/build.ps1 不存在');
});

test('打包脚本：必须写死国内镜像，否则本机下不动 Electron 二进制', () => {
  const mirror = /ELECTRON_MIRROR\s*=\s*'https:\/\/registry\.npmmirror\.com\/-\/binary\/electron\/'/;
  const builderMirror = /ELECTRON_BUILDER_BINARIES_MIRROR\s*=\s*'https:\/\/registry\.npmmirror\.com\/-\/binary\/electron-builder-binaries\/'/;
  for (const file of ['desktop/electron/setup.ps1', 'desktop/electron/build.ps1']) {
    const src = read(file);
    assert.match(src, mirror, `${file} 缺少 ELECTRON_MIRROR`);
    assert.match(src, builderMirror, `${file} 缺少 ELECTRON_BUILDER_BINARIES_MIRROR`);
  }
});

test('打包说明文档：引用的本地文件都存在', () => {
  const doc = read('docs/打包桌面版说明.md');
  const links = [...doc.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((l) => !/^https?:/i.test(l) && !l.startsWith('#'));

  assert.ok(links.length >= 2, '打包说明应至少引用主进程与打包配置两份文件');

  const missing = links.filter((l) => !existsSync(resolve(ROOT, 'docs', decodeURIComponent(l))));
  assert.deepEqual(missing, [], `打包说明引用了不存在的文件：${missing.join('、')}`);
});

test('打包产物目录已加入 .gitignore', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /dist-electron\//, 'dist-electron 不应进入版本控制');
});
