# desktop/ —— 桌面打包

这一层只做两件事：**把 `web/股市模拟.html` 这个单文件游戏套一个原生窗口打包成 exe，再打成一个可以直接发给别人的便携包。**

游戏本体不在这里，在 [`web/`](../web/)。这里的代码**从不修改游戏内容**，只做拷贝与打包——所以不存在"改了一份忘了另一份"。

打包方案用的是 **Neutralino**，产物是单个自包含 exe（2.62 MB），双击即玩，目标机器不需要装任何东西。完整的打包说明、体积构成与踩过的坑见 [打包桌面版说明](../docs/打包桌面版说明.md)。

---

## 目录里有什么

### 源码（纳入版本控制）

| 路径 | 作用 |
| --- | --- |
| `README.md` | 就是你正在看的这份，说明本目录的分工 |
| `neutralino.config.json` | Neutralino 配置：窗口尺寸与标题、端口、运行时版本 |
| `neutralino/prepare-resources.mjs` | 把 `web/` 同步成 `resources/`（游戏 HTML 改名为 `index.html`） |
| `neutralino/prune-dist.mjs` | 打包后清理，让 `dist/` 里只剩 Windows 版 exe |
| `neutralino/pack-portable.mjs` | 打成可发给别人的便携包 ZIP（含使用说明，逻辑导出成函数便于测试） |

### 生成物（已在 `.gitignore` 中，随时可删可重建）

| 路径 | 由谁产生 | 体积 | 用途 |
| --- | --- | --- | --- |
| `bin/` | `npx neu update` | 约 22 MB | Neutralino 各平台运行时 |
| `resources/` | `npm run neutralino:prepare` | 约 260 KB | 同步出来的网页资源（`index.html` + `vendor/`） |
| `dist/` | `npm run neutralino:build` | 约 2.7 MB | 最终产物 `StockSim-win_x64.exe` |
| `release/` | `npm run portable:pack` | 约 1.25 MB | 可发给别人的便携包 ZIP |

这四个目录全部可以直接删掉，跑一次对应命令就会重新长出来。

> `bin/` 里有 7 个平台的运行时，但本项目只发 Windows，实际只用到 `neutralino-win_x64.exe`（2.4 MB），其余 6 个（约 20 MB）是用不上的——`neu update` 会一次拉全。介意体积的话可以删掉非 Windows 的那几个，不影响 Windows 打包。

---

## 常用命令

全部在**仓库根目录**执行（不是在这个目录里）：

| 命令 | 作用 | 频率 |
| --- | --- | --- |
| `npx neu update` | 下载 Neutralino 运行时到 `bin/` | 一次性 |
| `npm run neutralino:prepare` | 只同步资源，不打包 | 按需 |
| `npm run neutralino:run` | 同步资源并以窗口模式试跑 | 改完游戏想先看看 |
| `npm run neutralino:build` | 同步资源 → 打包 → 清理，产出 exe | 发布 |
| `npm run portable:pack` | 只打包便携包（需先构建过 exe） | 按需 |
| `npm run portable` | 构建 + 打包便携包一条龙 | 发人 |

`neutralino:run` 和 `neutralino:build` 都会自己先跑一遍资源同步，所以**不需要手动 prepare**。

打完包之后，`npm test` 里有一条端到端用例会把 exe 真的拉起来、用 HTTP 取回首页做断言。

---

## 把游戏发给别人

```bash
npm run portable      # 等价于 neutralino:build + portable:pack
```

产出 `release/股市模拟-<版本>-便携版.zip`，解开是一个文件夹：

| 文件 | 作用 |
| --- | --- |
| `股市模拟.exe` | 桌面版，双击即玩。中文文件名是**验过的**——Neutralino 按自身路径定位资源，改名不影响运行 |
| `股市模拟.html` | 兜底：拖进任何浏览器也能玩，不需要 WebView2 |
| `使用说明.txt` | 怎么开始，以及 WebView2 缺失、SmartScreen 提示怎么过 |

**为什么包里一定要带那个 HTML：** exe 依赖系统自带的 WebView2 运行时。Win11 和装过 Edge 的 Win10 都有，但**从没装过 Edge 的老 Win10 可能没有**，那时 exe 起不来。HTML 是零依赖的最后退路，代价只是断网时图表降级成内置 Canvas 简易图，玩法完全一样。带上它，收包的人不管电脑什么状态都有路可走。

**包里故意没放的东西：** `neutralinojs.log`（运行时日志，对收包的人没用）。另外 exe 没有数字签名，对方可能看到 SmartScreen 提示——说明里写了怎么过。

---

## 改动这里时要注意的三件事

这三条都是"写错了不报错、只是静默失效"的坑，改配置或改资源同步脚本前请先看一眼：

1. **`documentRoot` 必须是 `/resources/`。** 写成 `"/"` 会让所有资源 404，窗口里只显示"找不到 127.0.0.1 页面"，而进程活着、窗口标题也对，从 exe 上完全看不出异常。
2. **`port` 必须固定（当前 `41888`）。** 设成 `0` 表示随机端口，WebView2 的 origin 每次都变，而 localStorage 按 origin 隔离——结果是每次打开游戏存档都被清空。
3. **图表库必须落在游戏期望的相对路径上。** 游戏加载链的第一级是 `vendor/lightweight-charts.js`，同步脚本必须把它放到 `resources/vendor/lightweight-charts.js`。放错了不会报错，只会静默退回内置的 Canvas 简易图。

`tests/neutralino.test.mjs` 里各有一条用例守着这三点，改动后跑 `npm test` 即可确认没有踩回去。
