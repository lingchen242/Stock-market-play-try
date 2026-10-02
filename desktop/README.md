# desktop/ —— 桌面打包

这一层只做一件事：**把 `web/股市模拟.html` 这个单文件游戏套一个原生窗口，打包成能拷给别人的 exe。**

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

### 生成物（已在 `.gitignore` 中，随时可删可重建）

| 路径 | 由谁产生 | 体积 | 用途 |
| --- | --- | --- | --- |
| `bin/` | `npx neu update` | 约 22 MB | Neutralino 各平台运行时 |
| `resources/` | `npm run neutralino:prepare` | 约 260 KB | 同步出来的网页资源（`index.html` + `vendor/`） |
| `dist/` | `npm run neutralino:build` | 约 2.7 MB | 最终产物 `StockSim-win_x64.exe` |

这三个目录全部可以直接删掉，跑一次对应命令就会重新长出来。

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

`neutralino:run` 和 `neutralino:build` 都会自己先跑一遍资源同步，所以**不需要手动 prepare**。

打完包之后，`npm test` 里有一条端到端用例会把 exe 真的拉起来、用 HTTP 取回首页做断言。

---

## 改动这里时要注意的三件事

这三条都是"写错了不报错、只是静默失效"的坑，改配置或改资源同步脚本前请先看一眼：

1. **`documentRoot` 必须是 `/resources/`。** 写成 `"/"` 会让所有资源 404，窗口里只显示"找不到 127.0.0.1 页面"，而进程活着、窗口标题也对，从 exe 上完全看不出异常。
2. **`port` 必须固定（当前 `41888`）。** 设成 `0` 表示随机端口，WebView2 的 origin 每次都变，而 localStorage 按 origin 隔离——结果是每次打开游戏存档都被清空。
3. **图表库必须落在游戏期望的相对路径上。** 游戏加载链的第一级是 `vendor/lightweight-charts.js`，同步脚本必须把它放到 `resources/vendor/lightweight-charts.js`。放错了不会报错，只会静默退回内置的 Canvas 简易图。

`tests/neutralino.test.mjs` 里各有一条用例守着这三点，改动后跑 `npm test` 即可确认没有踩回去。
