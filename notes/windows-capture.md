# 在 Windows 笔记本上补拍

从 2026-11-17 起，Mac 另有用途，剩下的收敛补拍改到 Windows 笔记本上完成。本文说明怎么准备笔记本、怎么开拍、拍完怎么收尾，以及为迁移做过哪些检查和修正。

## 机器和预期

- 笔记本：联想拯救者 Y9000P IRX9，i9-14900HX（8 个性能核 + 16 个能效核），16 GB 内存，RTX 4060 Laptop 8 GB，核显 + 独显混合，有 MUX 开关。
- 要拍：27 个书签，清单在 `scripts/converge-remaining.json`。
  - 24 张此前在时限内没有收敛；
  - S04、S04b：冰崖条纹修正后要重拍；
  - S06b：从没拍过。
- 预计 6.5–11 小时，单机连续跑。
  - 速度与 Mac 大致持平：i9-14900HX 的单核约是 M5 的 0.7 倍，但 8 个性能核能同时放下 4 + 2 个 Worker、主线程和 GPU 进程，不用像 M5 那样挤 4 个性能核。
  - 显卡快 2.5–3 倍，但等待期间每 8 帧才渲染一帧，瓶颈在生成地形和城市的 Worker 上。
- 风险：
  - **内存：** 最密的视角估计要 10–13 GB，拍的时候不要开别的程序。
  - **显存：** S06 / S06b 估计 7–7.5 GB，接近 8 GB 上限，所以放在最后拍。
  - **Worker 数：** 全程用 4 个世界 Worker + 2 个城市 Worker。Worker 再多，Chrome 单个标签页的 JS 内存上限就会被撑爆，和机器内存多少无关。

## 一、准备笔记本（只做一次）

1. **独显：** 在 Legion Vantage（或 BIOS）里把显卡工作模式切到「独显直连」。不切也可以，那就在「设置 → 系统 → 屏幕 → 显示卡」里添加 `C:\Program Files\Google\Chrome\Application\chrome.exe`，选「高性能」。
2. **电源：**
   - 插上电源，按 Fn+Q 切到野兽模式（性能模式）；
   - Windows 电源模式选「最佳性能」；
   - NVIDIA 控制面板 → 管理 3D 设置 → 电源管理模式选「最高性能优先」。
3. **不要睡眠：**
   - 「设置 → 系统 → 电源」里，接通电源时的睡眠和休眠都设为「从不」，屏幕可以关；
   - 合盖操作设为「不采取任何操作」，或者干脆不合盖。
4. **更新：** 在 Windows 更新里暂停 1 周，避免夜里自动重启。
5. **虚拟内存：** 页面文件保持「系统管理大小」，放在 SSD 上。
6. **病毒扫描（可选）：** 在 Windows 安全中心 → 病毒和威胁防护 → 排除项里，添加项目文件夹，免得实时扫描拖慢截图写盘。
7. **安装软件：**
   - Node.js 24 LTS：nodejs.org 的 Windows Installer；
   - Google Chrome：最新版。

## 二、拷贝项目

1. 把 Mac 上的 `marscity-windows.zip` 拷到笔记本，解压到一个只含英文、不含空格的路径，例如 `C:\MarsCity`。解压后是 `C:\MarsCity\web\...`。
2. 包里包含：
   - 代码和 `public/data`，即世界数据（git 已提交的全部文件）；
   - `shots/final`，即已拍的 43 张定格和 `report.json`。
3. 包里不含 `node_modules`。Mac 上的依赖带有 macOS 专用的原生组件，在 Windows 上不能用，下一步会在笔记本上重新安装。

## 三、安装、构建、自检

在「终端」（PowerShell）或 cmd 里依次运行：

```
cd C:\MarsCity\web
npm ci
npm run build
node scripts/check-env.mjs
```

自检全部 OK 才能开拍。关键一行是：

```
OK   WebGL renderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU ... Direct3D11 ...)
```

如果这里出现 Intel 或 SwiftShader，说明 Chrome 没用上独显。回到第一节第 1 步改好，再运行一次自检。

## 四、开拍

```
node scripts/converge-batch.mjs --serve --groups scripts/converge-remaining.json --passes 2 --gpu NVIDIA
```

也可以直接双击 `scripts\windows-capture.cmd`。它会依次安装依赖（首次）、构建、自检，然后开拍。

- **只开一个浏览器：** 批处理自带预览服务（`--serve`），一次只开一个无头 Chrome。分组按清单顺序依次拍：
  1. 先拍 S04（顺便检验冰崖修正）；
  2. 再拍几组短的密集城区；
  3. 最大的 S06 放在最后。
- **独显校验：** `--gpu NVIDIA` 要求每个页面都跑在 RTX 4060 上，否则直接判失败，不会在核显上拍出一张图。
- **自动补拍：** `--passes 2` 在第一轮结束后，把没收敛或失败的组再拍一轮。已收敛的书签每次都自动跳过，所以随时可以重新运行同一条命令接着拍。
- **看进度：** 打开 `shots\final-capture-converge.log`。每组开始和结束各有一行：
  - `[group] ...` 表示这一组开始；
  - `[group-exit] ...` 后面会列出每张的结果：converged / NOT-idle / FAILED。
- **看显存：** 任务管理器 → 性能 → GPU。如果「专用 GPU 内存」长时间贴着 8 GB，同时「共享 GPU 内存」持续上涨超过 1 GB，说明显存不够、在借用内存，拍摄会明显变慢。
  - 先让它跑完；
  - 最后一招：只给这一组加 `--query "&detailMB=1800"` 重拍。它会让最远一圈精细建筑退回远景立面，画面会和其他定格略有不同。
- **中途停下：**
  - 在 `shots\final` 里新建一个名为 `STOP` 的空文件，当前这组拍完就停；
  - 也可以直接关掉窗口，当前这组作废，已经拍好的不受影响；
  - 之后重新运行同一条命令就能继续。
- **先看看会拍什么：** 加 `--dry-run` 只列清单，不开浏览器。

## 五、拍完以后

1. 运行 `node scripts/converge-batch.mjs --groups scripts/converge-remaining.json --dry-run`，应显示 `0 bookmark(s) to shoot`。
2. 把整个 `shots\final` 文件夹拷回 Mac 的 `web/shots/final`，覆盖即可。报告里的路径统一用 `/`，两边都认。
3. 更新 README「验收」一节的数字。可以在 Mac 或笔记本上打开 Claude Code，在 `web` 文件夹里让它按本文和 `shots/final/report.json` 收尾。

## 为迁移做的检查和修正

2026-11-17 用多代理审查了构建、拍摄流程和全部着色器（约 1 万行），每条结论都经过独立复核。复核确认的问题都已修正：

| 问题 | 后果 | 修正 |
|---|---|---|
| `npm run build` 写成 `MARS_PROD=1 vite build` | cmd.exe 下直接失败 | 改为 `vite build`，由 `vite.config.js` 根据 npm 设置的 `npm_lifecycle_event` 判断正式构建 |
| 批处理先写日志、从不建目录 | 全新副本上一启动就报错 | 启动时建好 `shots/` 和输出目录 |
| `report.json` 的路径在 Windows 上是反斜杠 | 拷回 Mac 后成片被判为缺失、整批重拍 | 报告统一存 `/` 路径，读取时兼容旧格式 |
| 报告直接覆盖写入；读到损坏文件时当成空表 | 进程中途被杀时可能丢掉全部已有记录 | 先写临时文件再改名；首次写入前备份为 `report.json.bak`；读到损坏的报告就停下，不覆盖 |
| GPU 重置（Windows TDR）后检测不到 WebGL 上下文丢失 | 可能把空白画面记成已收敛 | `waitIdle` 和截图前都检查上下文是否丢失，丢失就判失败；`stats()` 也输出这一项 |
| 渲染器只打印一次，不校验 | 混合显卡上可能在核显上照常拍 | 每个页面都记录渲染器并写进报告行；`--gpu` 不匹配就判失败 |
| 批处理默认端口和 `npm run preview` 不一致；PowerShell 会拆开不加引号的逗号分组 | 不传参数时整组打不开；书签被拆成单独的组 | `--serve` 自带服务；分组改从 JSON 文件读 |
| 建筑幕墙反射循环里有 `continue`（`src/buildings/materials.js`） | ANGLE D3D11 会把这类循环里的 `fwidth` 当成 0，塔楼轮廓和窗格失去抗锯齿 | 改用 if 块，Metal 上计算结果不变 |
| 几个诊断脚本用绝对路径 `import()`、写文件前不建目录、用 `/` 正则取目录名，开发工具写死 Mac 的 Chrome | 在 Windows 上启动即报错 | 改用 `pathToFileURL`、`path.dirname`、`scripts/chrome.mjs` |

复核驳回的有：
- Ctrl+C 会留下孤儿 Chrome：Playwright 用管道连接，父进程一退出 Chrome 就跟着退出；
- PID 复用导致浏览器槽位卡死：属于推测；
- 墙钟时间驱动的动画相位：和平台无关；
- 7 条着色器问题：ANGLE 对这些写法都有正确的处理，画面不受影响。

已知但不影响补拍的：
- `diag-memory` 和 `memory-soak` 靠 macOS 的 `ps` / `footprint` 取内存，在 Windows 上只会显示空值；
- `analyze*.mjs` 读的是仓库外的参考图；
- `preview-urban-montage` 依赖 shell 展开通配符。

完整的审查记录在 Mac 上的 `.build/audit/`（不随项目分发）。
