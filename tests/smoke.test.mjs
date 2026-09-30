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
const html = readFileSync(join(here, '..', '股市模拟.html'), 'utf8');

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
