/**
 * 《股市模拟》内核测试。
 *
 * 交付物是单文件 HTML，因此测试从 HTML 中抽取 <script id="game-core"> 的源码，
 * 用 node:vm 在沙箱里执行后断言。这样既保持"单文件双击可运行"的交付形态，
 * 又让纯逻辑可被自动化验证。核心逻辑不触碰 DOM 与 localStorage。
 *
 * 运行：node --test tests/
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(here, '..', 'web', '股市模拟.html');
const html = readFileSync(HTML_PATH, 'utf8');

const scriptMatch = html.match(/<script id="game-core">([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, '未能从 HTML 中抽取 game-core 脚本');

/** 每个测试使用独立的沙箱，避免用例之间互相污染。 */
function loadCore() {
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox, { filename: 'game-core.js' });
  return sandbox.window.GameCore;
}

const Core = loadCore();
const CONFIG = Core.CONFIG;
const LOT = CONFIG.rules.lotSize;

/**
 * 沙箱里的对象来自另一个 realm，原型与测试 realm 不同，
 * deepStrictEqual 会因此误判。比较前统一做一次结构化克隆。
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 构造一段可控的合成行情，用于精确验证撮合规则。 */
function syntheticMarket(bars, options = {}) {
  const limit = options.limit ?? 0.10;
  const days = bars.map((b, i) => {
    const prevClose = i === 0 ? (b.prevClose ?? b.open) : bars[i - 1].close;
    return {
      day: i, date: `2026-01-${String(i + 1).padStart(2, '0')}`, label: `${i + 1}日`,
      prevClose,
      open: b.open, high: b.high, low: b.low, close: b.close,
      limitUp: Core.utils.round2(prevClose * (1 + limit)),
      limitDown: Core.utils.round2(prevClose * (1 - limit)),
      volume: 1e7, amount: 1e9, st: false, forced: false,
    };
  });
  return {
    meta: { totalDays: days.length },
    index: days.map((d, i) => ({ day: i, date: d.date, close: d.close, open: d.open, high: d.high, low: d.low, prevClose: d.prevClose })),
    stocks: [{
      index: 0, code: '880101', name: '测试股', board: 'main', limit,
      price0: days[0].prevClose, idioVol: 0.3, beta: 1, alpha: 0, industryIdx: 0, st: false,
      days,
    }],
    world: { dividends: options.dividends ?? [] },
    emotion: days.map(() => 50),
    news: days.map(() => []),
  };
}

function newBroker(market, cash = CONFIG.rules.initialCash) {
  const portfolio = Core.createPortfolio(cash);
  const broker = Core.createBroker(portfolio, market, CONFIG);
  return { portfolio, broker };
}

/* ------------------------------------------------------------------ 随机数 */

test('RNG：同种子完全一致，不同种子必须不同', () => {
  const seq = (seed, n) => {
    const rng = Core.createRng(seed);
    return Array.from({ length: n }, () => rng.next());
  };
  assert.deepEqual(seq(20260101, 30), seq(20260101, 30));
  assert.notDeepEqual(seq(20260101, 30), seq(20260102, 30));
});

test('RNG：next() 落在 [0,1)，weightedIndex 只返回合法下标', () => {
  const rng = Core.createRng(7);
  for (let i = 0; i < 500; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `next() 越界：${v}`);
  }
  const weights = [1, 4, 0];
  for (let i = 0; i < 200; i++) {
    const idx = rng.weightedIndex(weights);
    assert.ok(idx >= 0 && idx < weights.length);
    assert.notEqual(idx, 2, '权重为 0 的项不应被选中');
  }
});

/* ------------------------------------------------------------------ 日历 */

test('交易日历：恰好 45 天，跳过周末与春节，并延伸到 3 月', () => {
  const cal = Core.buildCalendar(CONFIG);
  assert.equal(cal.length, CONFIG.time.tradingDays);

  const seen = new Set();
  for (const d of cal) {
    assert.ok(!seen.has(d.iso), `日期重复：${d.iso}`);
    seen.add(d.iso);
    const dow = new Date(`${d.iso}T00:00:00`).getDay();
    assert.ok(dow !== 0 && dow !== 6, `${d.iso} 落在周末`);
    assert.ok(!CONFIG.time.holidays.includes(d.iso), `${d.iso} 落在春节假期内`);
  }
  assert.equal(cal[0].iso, '2026-01-05', '起始日应为 2026-01-05（周一）');
  assert.ok(cal.some((d) => d.iso.startsWith('2026-03')), '45 个交易日应延伸到 3 月');
});

/* -------------------------------------------------------------- 世界生成 */

test('世界生成：30 只标的、10 个行业、板块数量与设计一致', () => {
  const world = Core.generateWorld(1234);
  assert.equal(world.stocks.length, 30);
  assert.equal(world.calendar.length, 45);

  const byBoard = world.stocks.reduce((acc, s) => {
    acc[s.board] = (acc[s.board] ?? 0) + 1;
    return acc;
  }, {});
  assert.equal(byBoard.main, 18, '主板应 18 只（±10%）');
  assert.equal(byBoard.growth, 9, '创业板应 9 只（±20%）');
  assert.equal(byBoard.star, 3, '科创板应 3 只（±20%）');

  // 代码全部落在虚构的 88xxxx 号段，且互不重复
  const codes = new Set(world.stocks.map((s) => s.code));
  assert.equal(codes.size, 30, '股票代码必须唯一');
  for (const s of world.stocks) {
    assert.match(s.code, /^88\d{4}$/, `代码 ${s.code} 不在虚构 88xxxx 号段`);
    assert.ok(s.limit === 0.10 || s.limit === 0.20, `涨跌停幅度异常：${s.limit}`);
  }
});

test('世界生成：同种子完全可复现，不同种子产生不同市场', () => {
  const a = Core.generateWorld(999);
  const b = Core.generateWorld(999);
  const c = Core.generateWorld(1000);
  assert.deepEqual(a.stocks.map((s) => [s.code, s.beta, s.idioVol, s.alpha]),
    b.stocks.map((s) => [s.code, s.beta, s.idioVol, s.alpha]));
  assert.notDeepEqual(a.stocks.map((s) => s.beta), c.stocks.map((s) => s.beta));
});

test('随机跳动：最多 10 次、日期不重复、幅度不超过 6%', () => {
  for (const seed of [1, 2, 3, 42, 777, 20260101, 88888, 31337]) {
    const world = Core.generateWorld(seed);
    const plan = world.jumpPlan;
    assert.ok(plan.length <= CONFIG.jumps.maxCount, `seed=${seed} 跳动次数 ${plan.length} 超过 10`);

    const days = plan.map((j) => j.day);
    assert.equal(new Set(days).size, days.length, `seed=${seed} 出现了同一天多次跳动`);
    for (const day of days) assert.ok(day >= 0 && day < CONFIG.time.tradingDays);

    const maxMag = Math.max(CONFIG.jumps.stockMagnitude[1], CONFIG.jumps.marketMagnitude[1]);
    for (const j of plan) {
      assert.ok(Math.abs(j.magnitude) <= maxMag, `跳动幅度 ${j.magnitude} 超过上限`);
      assert.ok(j.scope === 'market' || j.scope === 'stock');
      if (j.scope === 'stock') assert.ok(Number.isInteger(j.key) && j.key >= 0 && j.key < 30);
    }
  }
});

/* -------------------------------------------------------------- 行情模拟 */

const sampleWorld = Core.generateWorld(20260101);
const sampleMarket = Core.simulate(sampleWorld);

test('行情模拟：可复现，且天数与标的数正确', () => {
  const again = Core.simulate(Core.generateWorld(20260101));
  assert.equal(sampleMarket.index.length, 45);
  assert.equal(sampleMarket.stocks.length, 30);
  for (const s of sampleMarket.stocks) assert.equal(s.days.length, 45);
  assert.deepEqual(
    sampleMarket.stocks.map((s) => s.days[44].close),
    again.stocks.map((s) => s.days[44].close),
    '同种子必须得到完全相同的收盘价序列',
  );
});

test('行情模拟：OHLC 不变量与价格下界', () => {
  for (const s of sampleMarket.stocks) {
    for (const bar of s.days) {
      assert.ok(bar.low <= bar.open + 1e-9 && bar.low <= bar.close + 1e-9, `${s.code} 第${bar.day}日 low 高于 open/close`);
      assert.ok(bar.high >= bar.open - 1e-9 && bar.high >= bar.close - 1e-9, `${s.code} 第${bar.day}日 high 低于 open/close`);
      assert.ok(bar.low >= 0.5, `${s.code} 第${bar.day}日 价格跌破 0.5 元下限`);
      assert.ok(bar.close > 0 && Number.isFinite(bar.close));
      assert.ok(bar.volume > 0 && bar.amount > 0);
    }
  }
  for (const bar of sampleMarket.index) {
    assert.ok(bar.low <= bar.close && bar.high >= bar.close);
    assert.ok(bar.close > 0);
  }
});

test('涨跌停：非一字板受板块幅度约束，一字板只能来自事件驱动', () => {
  for (const s of sampleMarket.stocks) {
    for (const bar of s.days) {
      const limit = bar.st ? CONFIG.boards.st : s.limit;
      const up = Core.utils.round2(bar.prevClose * (1 + limit));
      const down = Core.utils.round2(bar.prevClose * (1 - limit));
      assert.ok(bar.close <= up + 1e-6, `${s.code} 第${bar.day}日 涨幅突破涨停 ${bar.close} > ${up}`);
      assert.ok(bar.close >= down - 1e-6, `${s.code} 第${bar.day}日 跌幅突破跌停 ${bar.close} < ${down}`);
      if (bar.forced) {
        assert.equal(bar.open, bar.close, '一字板开盘应等于收盘');
        assert.equal(bar.high, bar.low, '一字板最高应等于最低');
      }
    }
  }
});

test('股民情绪：始终落在 [0,100]', () => {
  for (const v of sampleMarket.emotion) {
    assert.ok(v >= 0 && v <= 100, `情绪值越界：${v}`);
  }
});

/* ------------------------------------------------------------------ 撮合 */

test('T+1：当日买入的股票，当日不可卖出', () => {
  const market = syntheticMarket([
    { open: 10, high: 10.2, low: 9.9, close: 10 },
    { open: 10, high: 10.3, low: 9.8, close: 10.2 },
  ]);
  const { portfolio, broker } = newBroker(market);

  // 第 0 日决策：先买入，再试图卖出同一批股票
  assert.equal(broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT }).ok, true);
  const sellSameDay = broker.placeOrder({ stockIdx: 0, side: 'sell', type: 'market', qty: LOT });
  assert.equal(sellSameDay.ok, false, '当日买入的股票当日不可卖');
  assert.match(sellSameDay.reason, /可卖数量不足/);

  // 结算第 0 日：买入成交
  const settled = broker.settleDay();
  assert.equal(settled.filled.filter((f) => f.status === 'filled').length, 1);
  assert.equal(Core.positionOf(portfolio, 0).qty, LOT);

  // 第 1 日决策：同一批股票已经可以卖出
  const sellNextDay = broker.placeOrder({ stockIdx: 0, side: 'sell', type: 'market', qty: LOT });
  assert.equal(sellNextDay.ok, true, 'T+1 之后应可卖出');
});

test('费用：佣金按万分之 2.5 计算，且不低于 5 元最低收费', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
  ]);
  const { portfolio, broker } = newBroker(market);

  // 100 股 × 10 元 = 1000 元，万分之 2.5 = 0.25 元 → 触发 5 元最低佣金
  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  const res = broker.settleDay();
  const fill = res.filled.find((f) => f.status === 'filled');
  const value = fill.value;
  const expected = 5 + value * CONFIG.cost.transferFee;   // 最低佣金 + 过户费
  assert.ok(Math.abs(fill.fees - expected) < 1e-9, `费用应为 ${expected}，实际 ${fill.fees}`);
  assert.ok(fill.fees >= 5, '费用不得低于 5 元最低佣金');
});

test('涨停买不进：收盘价等于涨停价时市价买单被拒绝', () => {
  // 第 1 日相对前收 10 元涨停（+10% → 11 元）
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 11, high: 11, low: 11, close: 11 },
  ]);
  const { portfolio, broker } = newBroker(market);
  broker.settleDay();                                    // 推进到第 1 日
  assert.equal(broker.state.day, 1);

  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  const res = broker.settleDay();
  const entry = res.filled[0];
  assert.equal(entry.status, 'rejected');
  assert.match(entry.reason, /涨停/);
  assert.equal(Core.positionOf(portfolio, 0).qty, 0, '涨停不应成交任何买入');
});

test('跌停卖不出：卖单被拒绝后冻结股数必须释放（否则持仓被永久锁死）', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },   // 第 1 日买入
    { open: 9, high: 9, low: 9, close: 9 },       // 第 2 日跌停（-10%）
    { open: 9, high: 9.2, low: 8.9, close: 9.1 },
  ]);
  const { portfolio, broker } = newBroker(market);

  broker.settleDay();                                    // 第 0 日：空仓过
  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  broker.settleDay();                                    // 第 1 日：买入成交
  assert.equal(Core.positionOf(portfolio, 0).qty, LOT);

  const sell = broker.placeOrder({ stockIdx: 0, side: 'sell', type: 'market', qty: LOT });
  assert.equal(sell.ok, true);
  assert.equal(Core.positionOf(portfolio, 0).frozen, LOT, '挂卖单应冻结股数');

  const res = broker.settleDay();                        // 第 2 日：跌停，卖不出
  assert.match(res.filled[0].reason, /跌停/);
  assert.equal(Core.positionOf(portfolio, 0).frozen, 0, '卖单被拒后必须释放冻结');
  assert.equal(Core.positionOf(portfolio, 0).qty, LOT, '跌停卖不出，持仓应保持不变');

  // 关键：下一日必须还能正常卖出，而不是被永久锁死
  assert.equal(broker.placeOrder({ stockIdx: 0, side: 'sell', type: 'market', qty: LOT }).ok, true);
});

test('限价单：当日有效未触发即失效，3 日有效则继续挂单', () => {
  const market = syntheticMarket([
    { open: 10, high: 10.5, low: 9.5, close: 10 },
    { open: 10.2, high: 10.8, low: 10.1, close: 10.6 },
    { open: 10.6, high: 11.0, low: 10.4, close: 10.8 },
  ]);
  const { portfolio, broker } = newBroker(market);

  // 当日有效、限价 8.0：当日最低 9.5 未触及 → 收盘即失效
  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'limit', qty: LOT, limitPrice: 8.0, validity: 1 });
  const res = broker.settleDay();
  assert.equal(res.filled.length, 1);
  assert.equal(res.filled[0].status, 'expired', '限价 8.0 不可能触发，当日有效应失效');
  assert.equal(broker.state.orders.length, 0, '失效后不应继续挂单');
  assert.equal(Core.positionOf(portfolio, 0).qty, 0);

  // 3 日有效、限价 1.0：连续两日都不该触发，委托应继续挂着
  const placed = broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'limit', qty: LOT, limitPrice: 1.0, validity: 3 });
  assert.equal(placed.ok, true);
  broker.settleDay();
  assert.equal(broker.state.orders.length, 1, '3 日有效的限价单未触发时应继续挂着');
  broker.settleDay();
  assert.equal(broker.state.orders.length, 1, '第 2 日仍应继续挂着');
});

test('限价单：触发时成交价不劣于限价，且不高于开盘价', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 9.0, high: 9.5, low: 8.2, close: 9.2 },   // 最低 8.2 ≤ 限价 8.5 → 触发
  ]);
  const { portfolio, broker } = newBroker(market);
  broker.settleDay();                                  // 推进到第 1 日

  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'limit', qty: LOT, limitPrice: 8.5, validity: 1 });
  const res = broker.settleDay();
  const fill = res.filled.find((f) => f.status === 'filled');
  assert.ok(fill, '限价 8.5 应被触发');
  assert.ok(fill.price <= 8.5 + 1e-9, `成交价 ${fill.price} 不应高于限价 8.5`);
  assert.equal(Core.positionOf(portfolio, 0).qty, LOT);
});

test('撤单：卖单撤销后冻结股数立即释放', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
  ]);
  const { portfolio, broker } = newBroker(market);

  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  broker.settleDay();                                     // 持有 100 股

  const sell = broker.placeOrder({ stockIdx: 0, side: 'sell', type: 'limit', qty: LOT, limitPrice: 99, validity: 3 });
  assert.equal(sell.ok, true);
  assert.equal(Core.positionOf(portfolio, 0).frozen, LOT);

  assert.equal(broker.cancelOrder(sell.order.id).ok, true);
  assert.equal(Core.positionOf(portfolio, 0).frozen, 0, '撤单后冻结必须释放');
  assert.equal(Core.positionOf(portfolio, 0).qty, LOT, '撤单不应改变持仓数量');
});

/* ---------------------------------------------------------------- 资金冻结 */

test('资金冻结：买单挂上后可用现金立即减少，撤单后全额恢复', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
  ]);
  const { portfolio, broker } = newBroker(market);

  const before = broker.availableCash();
  assert.equal(before, portfolio.cash, '没有挂单时可用现金等于账面现金');
  assert.equal(broker.frozenCash(), 0, '没有挂单时不应有冻结');

  const res = broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  assert.equal(res.ok, true);
  const frozen = broker.frozenCash();
  assert.ok(frozen > 0, '买单挂上后应产生冻结');

  // 账面现金不动（钱还是玩家的），但可用现金立刻变小 —— 这就是"下单即更新"
  assert.equal(portfolio.cash, before, '冻结不应改变账面现金');
  assert.ok(broker.availableCash() < before, '可用现金应立刻减少');
  assert.ok(Math.abs(broker.availableCash() - (before - frozen)) < 1e-9, '可用现金 = 现金 − 冻结');

  assert.equal(broker.cancelOrder(res.order.id).ok, true);
  assert.equal(broker.frozenCash(), 0, '撤单后冻结应归零');
  assert.equal(broker.availableCash(), before, '撤单后可用现金应完全恢复');
});

test('资金冻结：挡掉超额挂单，而不是等到结算才失败', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
  ]);
  // 1200 元刚好够买 100 股（含缓冲），一笔就把额度占满
  const { broker } = newBroker(market, 1200);
  const all = LOT;

  assert.equal(broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: all }).ok, true);

  // 第二笔必须当场被拒。否则玩家能连挂多笔"全仓"，结算时只有一笔有钱成交，
  // 剩下的变成"资金不足"，看起来就像 bug。
  const second = broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: all });
  assert.equal(second.ok, false, '冻结后不足以支付的买单应被直接拒绝');
  assert.match(second.reason, /可用资金不足/);
});

test('资金冻结：买单成交后冻结归零，实际扣款不超过预估值', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
  ]);
  const { portfolio, broker } = newBroker(market);

  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  const frozenBefore = broker.frozenCash();
  assert.ok(frozenBefore > 0);

  const res = broker.settleDay();
  const fill = res.filled.find((f) => f.status === 'filled');
  assert.ok(fill, '买单应成交');
  assert.equal(broker.frozenCash(), 0, '成交后不应再有冻结');
  // 预算是按"滑点上限 + 1% 缓冲"估的，实际扣款必然不超过它
  assert.ok(fill.value + fill.fees <= frozenBefore + 1e-6,
    `实际扣款 ${fill.value + fill.fees} 不应超过预估值 ${frozenBefore}`);
  assert.equal(broker.availableCash(), portfolio.cash, '冻结归零后可用现金回到账面现金');
});

test('资金冻结：限价失效与涨停拒单都不得永久占住资金', () => {
  // 限价 1 元不可能触发 → 当日有效，结算即失效，冻结必须退回
  const expired = newBroker(syntheticMarket([
    { open: 10, high: 10.5, low: 9.5, close: 10 },
    { open: 10, high: 10.2, low: 9.8, close: 10 },
  ]));
  expired.broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'limit', qty: LOT, limitPrice: 1, validity: 1 });
  assert.ok(expired.broker.frozenCash() > 0, '挂单期间应有冻结');
  expired.broker.settleDay();
  assert.equal(expired.broker.frozenCash(), 0, '限价失效后冻结必须释放');
  assert.equal(expired.broker.availableCash(), expired.portfolio.cash, '可用现金应完全恢复');

  // 涨停买不进：被拒后同样要释放
  const limited = newBroker(syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 11, high: 11, low: 11, close: 11 },   // 第 1 日一字涨停
  ]));
  limited.broker.settleDay();
  limited.broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  assert.ok(limited.broker.frozenCash() > 0);
  limited.broker.settleDay();
  assert.equal(limited.broker.frozenCash(), 0, '涨停拒单后冻结必须释放');

  // 3 日有效的限价单一直没触发：冻结要一直占着，不能提前放掉
  const pending = newBroker(syntheticMarket([
    { open: 10, high: 10.5, low: 9.5, close: 10 },
    { open: 10, high: 10.5, low: 9.5, close: 10 },
    { open: 10, high: 10.5, low: 9.5, close: 10 },
  ]));
  pending.broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'limit', qty: LOT, limitPrice: 1, validity: 3 });
  const held = pending.broker.frozenCash();
  pending.broker.settleDay();
  assert.equal(pending.broker.frozenCash(), held, '委托还挂着，冻结就应保持');
});

/* ------------------------------------------------------- 分红 / 存档 / 评分 */

test('现金分红：除息日按持股数派现，且价格相应下调', () => {
  const bars = [
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 9.7, high: 9.8, low: 9.6, close: 9.7 },     // 除息日
  ];
  const market = syntheticMarket(bars, { dividends: [{ day: 2, stockIdx: 0, yield: 0.03 }] });
  const { portfolio, broker } = newBroker(market);

  broker.settleDay();
  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  const before = broker.settleDay().equity;              // 第 1 日买入后权益

  const res = broker.settleDay();                        // 第 2 日除息派现
  assert.ok(res.notices.some((n) => n.text.includes('现金红利')), '应产生分红到账提示');
  assert.ok(portfolio.cash > 0);
  // 分红是"左口袋到右口袋"：除息本身不应凭空创造巨额收益
  assert.ok(Math.abs(res.equity - before) / before < 0.05, '除息后权益不应发生剧烈跳变');
});

test('存档：序列化与反序列化往返一致，版本不符则拒绝', () => {
  const market = syntheticMarket([
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 10, high: 10, low: 10, close: 10 },
  ]);
  const { portfolio, broker } = newBroker(market);
  broker.placeOrder({ stockIdx: 0, side: 'buy', type: 'market', qty: LOT });
  broker.settleDay();

  const save = Core.serialize(20260101, broker, portfolio);
  assert.equal(save.version, Core.SAVE_VERSION);
  const restored = Core.deserialize(plain(save));
  assert.ok(restored, '合法存档应能读回');
  assert.equal(restored.cash, save.cash);
  assert.equal(restored.day, save.day);
  assert.deepEqual(plain(restored.positions), plain(save.positions));
  assert.equal(Core.deserialize({ version: 999 }), null, '版本不符必须拒绝');
  assert.equal(Core.deserialize(null), null);
});

test('评分：无交易时收益等于现金利息，评级字段完整', () => {
  const market = sampleMarket;
  const portfolio = Core.createPortfolio(CONFIG.rules.initialCash);
  const broker = Core.createBroker(portfolio, market, CONFIG);
  for (let i = 0; i < CONFIG.time.tradingDays; i++) broker.settleDay();

  const score = Core.computeScore(portfolio, market, CONFIG);
  assert.ok(Number.isFinite(score.finalEquity) && score.finalEquity > 0);
  assert.ok(score.totalReturn > 0, '空仓也应有货币基金利息收益');
  assert.ok(score.totalReturn < 0.01, '空仓 45 天的利息不应超过 1%');
  assert.equal(score.tradeCount, 0);
  assert.equal(score.feeTotal, 0);
  assert.equal(typeof score.title, 'string');
  assert.ok(score.maxDrawdown <= 0);
  assert.ok(Math.abs(score.excess - (score.totalReturn - score.indexReturn)) < 1e-12);
});

test('评分：评级阈值按"相对基准超额"分档', () => {
  const titles = plain(CONFIG.rating.map((r) => r.title));
  assert.deepEqual(titles, ['股神', '老手', '跑赢大盘', '与大盘同步', '交学费的韭菜', '韭菜之王']);
  for (let i = 1; i < CONFIG.rating.length; i++) {
    assert.ok(CONFIG.rating[i - 1].min > CONFIG.rating[i].min, '评级阈值必须严格递减');
  }
});

/* ------------------------------------------------------------- 端到端冒烟 */

test('端到端：45 天随机交易不产生 NaN、负现金或持仓错乱', () => {
  const world = Core.generateWorld(555);
  const market = Core.simulate(world);
  const portfolio = Core.createPortfolio(CONFIG.rules.initialCash);
  const broker = Core.createBroker(portfolio, market, CONFIG);
  const rng = Core.createRng(2468);

  for (let day = 0; day < CONFIG.time.tradingDays; day++) {
    // 随机下一两笔单，再结算
    for (let k = 0; k < 2; k++) {
      const stockIdx = rng.int(0, market.stocks.length - 1);
      const side = rng.next() < 0.5 ? 'buy' : 'sell';
      const qty = rng.int(1, 20) * LOT;
      if (rng.next() < 0.5) {
        broker.placeOrder({ stockIdx, side, type: 'market', qty });
      } else {
        const ref = market.stocks[stockIdx].days[Math.max(0, day - 1)].close;
        broker.placeOrder({ stockIdx, side, type: 'limit', qty, limitPrice: Core.utils.round2(ref * rng.range(0.9, 1.1)), validity: 3 });
      }
    }
    const res = broker.settleDay();
    assert.ok(res.ok);
    assert.ok(Number.isFinite(portfolio.cash), `第 ${day} 日现金出现 NaN`);
    assert.ok(portfolio.cash >= -1e-6, `第 ${day} 日现金为负：${portfolio.cash}`);
    for (const pos of Object.values(portfolio.positions)) {
      assert.ok(pos.qty >= 0, '持仓数量为负');
      assert.ok(pos.frozen >= 0, '冻结数量为负');
      assert.ok(pos.frozen <= pos.qty + 1e-9, '冻结数量超过持仓');
    }
    const equity = broker.currentEquity(day);
    assert.ok(Number.isFinite(equity) && equity >= 0, `第 ${day} 日权益异常：${equity}`);
  }

  const score = Core.computeScore(portfolio, market, CONFIG);
  assert.ok(Number.isFinite(score.totalReturn));
  assert.ok(score.feeTotal > 0, '有交易就应该产生费用');
  assert.ok(score.tradeCount > 0);
  assert.ok(score.winRate === null || (score.winRate >= 0 && score.winRate <= 1));
});
