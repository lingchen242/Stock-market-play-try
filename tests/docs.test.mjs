/**
 * 文档一致性测试。
 *
 * README 是仓库的门面，最容易出现的问题是引用的文件被改名或删掉之后没人发现。
 * 这里把 README 里的本地链接逐个落实，并检查启动说明没有丢关键步骤。
 *
 * 运行：node --test
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

test('README：有标题与一句话说明', () => {
  assert.match(readme, /^# 股市模拟$/m, 'README 应以「股市模拟」为一级标题');
  assert.match(readme, /双击就能玩/, '开头应有一句话说明这个游戏怎么用');
});

test('README：引用的本地文件都必须真实存在', () => {
  const links = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  const local = links.filter((l) => !/^https?:\/\//i.test(l) && !l.startsWith('#'));

  assert.ok(local.length >= 3, `README 应至少引用设计文档与两张截图，实际 ${local.length} 个本地链接`);

  const missing = local.filter((l) => !existsSync(resolve(ROOT, decodeURIComponent(l))));
  assert.deepEqual(missing, [], `README 引用了不存在的文件：${missing.join('、')}`);
});

test('README：启动说明覆盖三种方式与测试命令', () => {
  for (const needle of ['双击', 'npm install', 'npm run serve', 'npm test', 'node_modules', 'PORT']) {
    assert.ok(readme.includes(needle), `README 缺少关键说明：${needle}`);
  }
});

test('README：写明免责声明与虚拟标的', () => {
  assert.match(readme, /不构成任何投资建议/, '公开仓库应写明不构成投资建议');
  assert.match(readme, /虚构|杜撰/, '应说明股票名称与代码均为虚构');
});
