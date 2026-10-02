/**
 * 真实 DOM 冒烟测试。
 *
 * 静态检查能拦住语法错误与缺失的元素 id，但拦不住运行时报错。
 * 这里用 jsdom 真正把页面跑起来，验证：
 *   1. 启动流程不抛异常，并且首屏渲染出了内容；
 *   2. 一次完整的"选股 → 下单 → 收盘结算"交互链路能走通；
 *   3. 存档确实写进了 localStorage。
 *
 * 运行：node --test
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'web', '股市模拟.html'), 'utf8');

/** jsdom 不带 canvas 实现，这里给一个只吞调用的 2D 上下文桩。 */
function fakeContext2D() {
  return new Proxy({}, {
    get: (target, prop) => (prop in target ? target[prop] : () => {}),
    set: () => true,
  });
}

/**
 * 启动页面。
 * jsdom 默认不会真正加载外部脚本，因此这里让三级加载链立刻失败，
 * 从而走到内置 Canvas 兜底路径 —— 也顺带验证了离线可用性。
 */
async function bootDom() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:8080/',
    beforeParse(window) {
      // beforeParse 阶段文档尚未解析，document.head 还是 null，
      // 因此在 Element.prototype 这一层拦下外部脚本的插入。
      const originalAppend = window.Element.prototype.appendChild;
      window.Element.prototype.appendChild = function (node) {
        if (node && node.tagName === 'SCRIPT' && node.src) {
          window.setTimeout(() => node.onerror?.(new window.Event('error')), 0);
          return node;
        }
        return originalAppend.call(this, node);
      };
      window.HTMLCanvasElement.prototype.getContext = () => fakeContext2D();
    },
  });
  // 等 boot() 内部的 await 链走完
  await new Promise((resolve) => setTimeout(resolve, 150));
  return dom;
}

test('冒烟：页面能启动并渲染出首屏', async () => {
  const dom = await bootDom();
  const { document } = dom.window;

  const ticker = document.getElementById('ticker').textContent;
  assert.match(ticker, /交易日/, '顶栏应显示交易日进度');
  assert.match(ticker, /1\/45/, '未开盘时应显示第 1 个交易日');
  assert.match(ticker, /华夏综指/, '顶栏应显示基准指数');

  assert.equal(document.querySelectorAll('#market-list tbody tr').length, 30, '行情列表应列出全部 30 只标的');

  assert.notEqual(document.getElementById('emotion-label').textContent, '—', '情绪面板应完成渲染');
  assert.match(document.getElementById('chart-notice').textContent, /开盘前/, '第 1 日应提示尚无历史行情');

  assert.ok(document.querySelector('.modal'), '首次进入应弹出开局说明');
  dom.window.close();
});

test('冒烟：下单 → 收盘结算 的交互链路可走通，并写入存档', async () => {
  const dom = await bootDom();
  const { document, localStorage } = dom.window;

  // 开局
  const start = [...document.querySelectorAll('.modal-foot button')]
    .find((b) => b.textContent.includes('开始新的'));
  assert.ok(start, '开局弹层应有"开始"按钮');
  start.click();
  assert.equal(document.querySelector('.modal'), null, '点击开始后弹层应关闭');

  // 下第一笔市价买单
  document.getElementById('trade-qty').value = '100';
  document.getElementById('btn-buy').click();
  assert.ok(document.querySelector('#orders tbody tr'), '下单后应出现待成交委托');

  // 收盘结算
  document.getElementById('btn-next').click();
  assert.match(document.getElementById('ticker').textContent, /2\/45/, '结算后应推进到第 2 个交易日');
  assert.equal(document.querySelector('#orders tbody tr'), null, '市价单当日结算后不应继续挂着');

  // 存档
  const raw = localStorage.getItem('stock-sim:save:v1');
  assert.ok(raw, '应写入 localStorage 存档');
  const save = JSON.parse(raw);
  assert.equal(save.version, 1);
  assert.equal(save.day, 1, '存档应记录已推进到第 1 天（0 基）');

  dom.window.close();
});

test('冒烟：限价单会继续挂着，撤单后消失', async () => {
  const dom = await bootDom();
  const { document } = dom.window;

  [...document.querySelectorAll('.modal-foot button')]
    .find((b) => b.textContent.includes('开始新的')).click();

  // 切换到限价单，挂一个不可能成交的极低买价
  [...document.querySelectorAll('#order-type button')]
    .find((b) => b.dataset.type === 'limit').click();
  document.getElementById('trade-limit').value = '0.01';
  document.getElementById('trade-validity').value = '3';
  document.getElementById('trade-qty').value = '100';
  document.getElementById('btn-buy').click();
  assert.ok(document.querySelector('#orders tbody tr'), '限价单应挂在委托列表里');

  document.getElementById('btn-next').click();
  assert.ok(document.querySelector('#orders tbody tr'), '3 日有效的限价单未触发时应继续挂着');

  // 撤单
  document.querySelector('button[data-cancel]').click();
  assert.equal(document.querySelector('#orders tbody tr'), null, '撤单后委托应消失');

  dom.window.close();
});

/* ------------------------------------------------------------------ 新增逻辑
 *
 * 下面三条都用了固定种子 1。这个种子的可复现已核对过：
 *   股票 0「云岭酿」第 1 日收盘 68.22 < 涨停 74.80，市价买单必然成交；
 *   消息条数第 1 / 2 日分别为 2 / 1 条。
 * 用固定种子是为了让断言能写死具体数字，而不是只看"有没有内容"。
 */

/**
 * 以固定种子开局，并关掉开局弹层。
 *
 * 顺带守一个曾经踩过的坑：弹层的按钮回调是「先 closeModal() 再 onClick()」，
 * 而 closeModal 会清空 modal-root。种子值必须在弹层关闭前就取到手，
 * 否则玩家填的种子会被静默丢掉、退回随机种子。存档里的 last-seed 就是证据。
 */
function startWithSeed(dom, seed) {
  const { document, localStorage } = dom.window;
  document.getElementById('seed-input').value = String(seed);
  [...document.querySelectorAll('.modal-foot button')]
    .find((b) => b.textContent.includes('开始新的')).click();
  assert.equal(localStorage.getItem('stock-sim:last-seed'), String(seed),
    '弹层里填的随机种子必须真的生效（曾因 closeModal 先清空弹层而静默失效）');
}

/** 读取账户面板里某一格的显示值；没有这一格时返回 null。 */
function acctCell(document, label) {
  const cells = [...document.querySelectorAll('#account-grid .acct-cell')];
  const cell = cells.find((c) => c.querySelector('.acct-label')?.textContent === label);
  return cell ? cell.querySelector('.acct-value').textContent : null;
}

test('冒烟：消息面保留上一天的消息，并做视觉降级', async () => {
  const dom = await bootDom();
  const { document } = dom.window;
  startWithSeed(dom, 1);

  // 第 1 个交易日：只有当天消息，还不该出现「昨日」分隔
  assert.equal(document.querySelectorAll('#news .news-item').length, 2, '第 1 日应有 2 条当日消息');
  assert.equal(document.querySelector('#news .news-sep'), null, '第 1 日没有上一天，不该有分隔');

  // 结算 → 进入第 2 个交易日的决策
  document.getElementById('btn-next').click();

  const sep = document.querySelector('#news .news-sep');
  assert.ok(sep, '第 2 日应出现「昨日」分隔');
  assert.match(sep.textContent, /昨日/, '分隔上应标明是昨日');

  // 第 2 日：当日 1 条 + 昨日 2 条 = 3 条
  assert.equal(document.querySelectorAll('#news .news-item').length, 3,
    '应同时显示第 2 日的 1 条与第 1 日保留的 2 条');
  assert.equal(document.querySelectorAll('#news .news-item.is-past').length, 2,
    '上一天的 2 条应降级显示（is-past）');
  assert.match(document.getElementById('news-count').textContent, /3 条/);

  // 再推进一天，保留的应该变成第 2 日的那一条，而不是越积越多
  document.getElementById('btn-next').click();
  assert.equal(document.querySelectorAll('#news .news-item.is-past').length, 1,
    '只保留上一天，不应累积所有历史消息');

  dom.window.close();
});

test('冒烟：买入挂单后可用现金立即减少，并出现「挂单冻结」', async () => {
  const dom = await bootDom();
  const { document } = dom.window;
  startWithSeed(dom, 1);

  const before = acctCell(document, '可用现金');
  assert.ok(before, '账户面板应显示可用现金');
  assert.equal(acctCell(document, '挂单冻结'), null, '没有挂单时不该显示冻结格');

  document.getElementById('trade-qty').value = '200';
  document.getElementById('btn-buy').click();

  // 关键：此刻还没有结算，价格也没成交，但可用现金已经变了
  assert.notEqual(acctCell(document, '可用现金'), before, '下单后可用现金应立即变化');
  assert.ok(acctCell(document, '挂单冻结'), '下单后应出现「挂单冻结」一格');

  // 撤单后应当完全恢复
  document.querySelector('button[data-cancel]').click();
  assert.equal(acctCell(document, '可用现金'), before, '撤单后可用现金应完全恢复');
  assert.equal(acctCell(document, '挂单冻结'), null, '撤单后不应再有冻结格');

  dom.window.close();
});

test('冒烟：有持仓时快捷数量按持仓算，可以一键卖出', async () => {
  const dom = await bootDom();
  const { document } = dom.window;
  startWithSeed(dom, 1);

  const preset = (label) => [...document.querySelectorAll('#qty-presets button')]
    .find((b) => b.textContent === label);
  const qtyValue = () => document.getElementById('trade-qty').value;

  // 无持仓：全仓按可用现金算（10 万本金对 68 元的股票，远不止 200 股）
  preset('全仓').click();
  assert.ok(Number(qtyValue()) > 1000, `无持仓时「全仓」应按可用现金算，实际得到 ${qtyValue()}`);
  assert.match(document.getElementById('qty-estimate').textContent, /按可用现金算/);

  // 买入 200 股并结算，拿到可卖持仓（T+1）
  document.getElementById('trade-qty').value = '200';
  document.getElementById('btn-buy').click();
  document.getElementById('btn-next').click();

  // 有持仓：全仓 = 全部可卖，半仓 = 可卖的一半
  preset('全仓').click();
  assert.equal(qtyValue(), '200', '有持仓时「全仓」应等于全部可卖持仓');
  assert.match(document.getElementById('qty-estimate').textContent, /按持仓算/);

  preset('半仓').click();
  assert.equal(qtyValue(), '100', '「半仓」应为可卖持仓的一半');

  // 而且这笔卖单真的能挂出去
  preset('全仓').click();
  document.getElementById('btn-sell').click();
  assert.ok(document.querySelector('#orders tbody tr'), '卖单应挂上委托列表');

  dom.window.close();
});
