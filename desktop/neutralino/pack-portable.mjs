/**
 * 打一个能直接发给别人的便携包 ZIP。
 *
 * 产出 desktop/release/股市模拟-<版本>-便携版.zip，里面是一个自包含的文件夹：
 *
 *   股市模拟.exe       ← 桌面版，借用系统 WebView2 渲染，双击即玩
 *   股市模拟.html      ← 兜底：拖进任何浏览器也能玩，不需要 WebView2
 *   使用说明.txt       ← 告诉对方怎么开始，以及两处可能劝退的提示怎么过
 *
 * 为什么要同时放 exe 和 HTML：
 *   exe 依赖系统自带的 WebView2 运行时。Win11 和装过 Edge 的 Win10 都有，
 *   但从没装过 Edge 的老 Win10 可能没有，那时 exe 起不来。HTML 是零依赖的
 *   最后退路 —— 代价只是断网时图表降级成内置 Canvas 简易图，玩法完全一样。
 *   带上它，收包的人不管电脑什么状态都有路可走。
 *
 * 为什么不用第三方打包库：
 *   这个项目坚持零依赖（预览服务器用 node:http 手写、测试用 node:test）。
 *   ZIP 的容器格式是稳定的老东西，用 node:zlib 压数据 + 手写中央目录即可，
 *   下面那几十行就够，不值得为此引一个包。
 *
 * 结构说明：
 *   真正的逻辑都导出成函数，直接运行时才走 CLI 分支。这样测试可以直接
 *   import 进来调用，不必 spawn 子进程 —— 顺带让 ZIP 写入器变成可单元测试的。
 *
 * 用法：npm run portable:pack（在仓库根目录执行；需先构建过 exe）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));   // desktop/neutralino
const DESKTOP = join(HERE, '..');                        // desktop
const ROOT = join(DESKTOP, '..');                        // 仓库根

const DEFAULT_EXE = join(DESKTOP, 'dist', 'StockSim', 'StockSim-win_x64.exe');
const DEFAULT_HTML = join(ROOT, 'web', '股市模拟.html');
const DEFAULT_OUT = join(DESKTOP, 'release');

// ---------------------------------------------------------------- 使用说明

/**
 * 使用说明文本。
 *
 * 按 CRLF 输出：收包的人大概率用记事本打开，LF 在旧版记事本里会挤成一行。
 */
export function buildNotice() {
  return `《股市模拟》—— 45 个交易日的 A 股投资模拟游戏
${'='.repeat(52)}

【怎么开始】

  双击  股市模拟.exe  ，就这么简单。

  不需要安装，不需要联网，不需要 Node 或任何运行环境。
  它是个绿色的单文件程序，不往系统里写任何东西，删掉就卸载干净了。


【如果双击没反应，或者提示缺少 WebView2】← 最可能遇到的情况

  这个程序借用 Windows 自带的 WebView2 内核来显示画面。
  Windows 11 和装过 Edge 的 Windows 10 都已经自带，一般不用管。

  万一提示缺失，两个办法，任选其一：

  1) 装一次 WebView2 运行时（微软官方、免费、约 2 MB、需要联网）
     下载地址：https://go.microsoft.com/fwlink/p/?LinkId=2124703
     装完再双击  股市模拟.exe  即可。只用装这一次。

  2) 不想装任何东西 → 用下面的【兜底方案】。


【如果 Windows 弹出「已保护你的电脑」】

  这是 SmartScreen 对「来自网络、没有数字签名」的程序的一贯提示，
  不代表程序有问题（作者买不起也懒得买代码签名证书）。
  点「更多信息」→ 再点「仍要运行」，就能正常打开。


【兜底方案：用浏览器打开】

  这个文件夹里还有一个  股市模拟.html  。

  把它拖进任何浏览器（Chrome / Edge / Firefox / Safari）就能玩，
  连 WebView2 都不需要，是零依赖的。

  唯一的差别：如果断网，K 线图会退化成简版线条图。
  游戏本身完全一样 —— 下单、结算、评分、存档，一样都不少。


【关于这个游戏】

  你是一名普通股民。10 万元本金，45 个交易日，30 只虚构股票。
  每个交易日先看当天的消息面，再决定买卖，点「收盘结算」进入下一天。

  45 天后按相对大盘的超额收益评级：
    高于 +20%      股神
    +10% ~ +20%    老手
    +3% ~ +10%     跑赢大盘
    -3% ~ +3%      与大盘同步
    -10% ~ -3%     交学费的韭菜
    低于 -10%      韭菜之王

  规则尽量贴近真实 A 股：T+1、涨跌停按板块（主板 ±10%，创业板科创板
  ±20%，ST ±5%）、涨停买不进、跌停时想割肉也可能割不掉、碎单会被
  最低佣金惩罚、空仓的现金按年化 1.5% 计息。

  存档自动保存在本地，关掉再打开会接着上局继续。想重开点顶栏的「重开」。


【免责声明】

  所有股票名称与代码（虚构的 88xxxx 号段）均为杜撰，不对应任何真实
  上市公司；行情由随机模型生成，与真实市场无关。

  这是一个用来理解交易机制的玩具，不构成任何投资建议。
`.split('\n').join('\r\n');
}

// ---------------------------------------------------------------- ZIP 写入

/**
 * 最小 ZIP 写入器。
 *
 * 只实现「打包」需要的部分：本地文件头 + 数据 + 中央目录 + EOCD。
 * 每个条目独立决定要不要压（压不小就直接存原始数据），
 * 文件名统一带 UTF-8 标志位，免得中文名在别的解压软件里变乱码。
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** ZIP 用的是 1980 纪元的 DOS 日期时间格式，各占 2 字节。 */
function dosStamp(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** entries: [{ name, data }]，返回完整的 ZIP 字节。 */
export function makeZip(entries) {
  const stamp = dosStamp(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;   // 压不小就别压
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(data);

    // 本地文件头：30 字节定长 + 文件名 + 数据
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // 签名
    local.writeUInt16LE(20, 4);           // 解压所需版本 2.0
    local.writeUInt16LE(0x0800, 6);       // 标志位 11：文件名是 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18); // 压缩后大小
    local.writeUInt32LE(data.length, 22); // 原始大小
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // 无 extra 字段

    parts.push(local, nameBuf, body);

    // 中央目录条目：46 字节定长 + 文件名
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);             // 生成程序版本
    dir.writeUInt16LE(20, 6);             // 解压所需版本
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.date, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);             // extra 长度
    dir.writeUInt16LE(0, 32);             // 注释长度
    dir.writeUInt16LE(0, 34);             // 起始磁盘号
    dir.writeUInt16LE(0, 36);             // 内部属性
    dir.writeUInt32LE(0, 38);             // 外部属性
    dir.writeUInt32LE(offset, 42);        // 本地头偏移

    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);

  // 中央目录结束记录：22 字节，解压软件从这里开始找目录
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);                // 本磁盘号
  end.writeUInt16LE(0, 6);                // 目录所在磁盘号
  end.writeUInt16LE(entries.length, 8);   // 本磁盘条目数
  end.writeUInt16LE(entries.length, 10);  // 总条目数
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);          // 中央目录偏移
  end.writeUInt16LE(0, 20);               // 无注释

  return Buffer.concat([...parts, centralBuf, end]);
}

// ---------------------------------------------------------------- 打包

/**
 * 组装并写出便携包。
 *
 * 抛错而不是 process.exit，方便调用方（含测试）自己决定怎么处理。
 */
export function packPortable({
  exePath = DEFAULT_EXE,
  htmlPath = DEFAULT_HTML,
  outputDir = DEFAULT_OUT,
  version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
} = {}) {
  if (!existsSync(exePath)) {
    throw new Error(`找不到桌面版 exe：${exePath}\n  先运行 npm run neutralino:build 构建一次。`);
  }
  if (!existsSync(htmlPath)) {
    throw new Error(`找不到游戏本体：${htmlPath}`);
  }

  const folder = `股市模拟-${version}`;
  const output = join(outputDir, `${folder}-便携版.zip`);

  const entries = [
    { name: `${folder}/股市模拟.exe`, data: readFileSync(exePath) },
    { name: `${folder}/股市模拟.html`, data: readFileSync(htmlPath) },
    { name: `${folder}/使用说明.txt`, data: Buffer.from(buildNotice(), 'utf8') },
  ];

  const zip = makeZip(entries);

  // 每次全量重建：先清掉上一次的产物，避免旧版本 ZIP 留在目录里被误发
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(output, zip);

  return {
    output,
    folder,
    entries,
    totalBytes: entries.reduce((sum, e) => sum + e.data.length, 0),
    zipBytes: zip.length,
  };
}

// ---------------------------------------------------------------- CLI

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const { output, entries, totalBytes, zipBytes, folder } = packPortable();
    const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

    console.log('便携包已生成：');
    console.log(`  ${output.replace(ROOT + '\\', '')}`);
    console.log('');
    console.log('包含：');
    for (const entry of entries) {
      // 文件名含中文，按字节数补空格会算错列宽，直接「名字 → 大小」更稳
      console.log(`  ${entry.name.replace(`${folder}/`, '')}  →  ${kb(entry.data.length)}`);
    }
    console.log('');
    console.log(`打包前 ${mb(totalBytes)} → 打包后 ${mb(zipBytes)}（压掉 ${(100 - (zipBytes / totalBytes) * 100).toFixed(0)}%）`);
    console.log('');
    console.log('发之前请留意：exe 没有数字签名，对方可能会看到 SmartScreen 提示；');
    console.log('若对方电脑缺 WebView2，用兜底方案（浏览器打开 HTML）或装一次运行时。');
    console.log('两种情况的使用说明.txt 里都写了。');
  } catch (error) {
    console.error(`× ${error.message}`);
    process.exit(1);
  }
}
