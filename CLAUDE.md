# MarsCity 项目说明（给 Claude Code）

## 交流

- 和用户交流一律用中文：回复、解释、提问、总结、计划都用中文。代码、命令、路径、报错原文和专有名词保持原样，不翻译。

## 项目

- 用 Three.js 复刻地球化后的火星：12 个省域、G01 潮堤、G02 水阶。镜头可以从轨道连续缩放到建筑室内，建筑 ID 稳定，镜头卡做成书签。
- 种子固定为 351165。
- 艺术设定和验收标准见 `prompt.md`（§5 镜头卡、§6 验收），模块契约见 `ARCHITECTURE.md`，全貌和验收现状见 `README.md`。
- 技术栈：Vite 8、three r187；用 playwright-core 驱动系统 Chrome 无头拍摄。

## 必须遵守

- **同一时刻只允许 1 个无头 Chrome，拍完立刻关掉。**
  - 凡是会启动 Chrome 的命令都套上 `node scripts/slot.mjs -- <命令>`。`scripts/converge-batch.mjs` 已经自动套了。
  - 长时间常驻的验证（如 `scripts/memory-soak.mjs`）不要和拍摄同时跑，只能串行。
- **拍摄固定用 4 个世界 Worker + 2 个城市 Worker**（`&workers=4`）。Worker 再多，Chrome 单个标签页的 JS 内存上限会被撑爆，密集城区页面会崩溃；这和机器内存多少无关，见 `notes/final-capture.md`。
- **世界生成必须确定。** 改 `src/world/**`（地形、水系、城市）会改变画面，甚至改变建筑 ID。除非用户要求，不要动；如果要动，先用 Node 比对改动前后的建筑 ID 和坐标（参考 `notes/final-capture.md` 的 S04 一节），再重拍受影响的书签。
- **提交前先征得用户同意。**

## 当前状态（2026-11-17）

- 共 44 个书签，`shots/final/` 里有 43 张定格，每张的状态记录在 `shots/final/report.json`。
  - 17 张已完全收敛，并且与当前代码一致。
  - S04 和 S04b 拍在冰崖修正之前，在报告里标为 `stale`，要重拍。
  - 24 张是时限内截图，没有完全收敛。
  - S06b 还没拍过。
- 待拍的 27 个书签和分组在 `scripts/converge-remaining.json`，要在这台 Windows 笔记本上拍：拯救者 Y9000P IRX9，i9-14900HX，16 GB 内存，RTX 4060 Laptop 8 GB。

## 接手补拍

1. 读 `notes/windows-capture.md`，按第一节确认笔记本已设置好：
   - 显卡切到独显直连；
   - 插电并开性能模式；
   - 不睡眠；
   - 暂停 Windows 更新。
2. 安装、构建、自检：`npm ci`、`npm run build`、`node scripts/check-env.mjs`。自检必须显示 NVIDIA 显卡，否则不要开拍。
3. 开拍：`node scripts/converge-batch.mjs --serve --groups scripts/converge-remaining.json --passes 2 --gpu NVIDIA`。
   - 要跑 6.5–11 小时，放在后台运行；
   - 进度看 `shots/final-capture-converge.log` 里的 `[group]` 和 `[group-exit]` 行；
   - 停下：在 `shots/final/` 里新建 `STOP` 文件，当前这组拍完就停；
   - 继续：重新运行同一条命令，已收敛的会自动跳过。
4. 第一组 S04 拍完后，看一眼 `shots/final/S04.png`：冰崖下部（1920×1080 画面约 x 850–1450、y 460–600）应该不再有竖向的条形码状细条纹。
5. 全部拍完后：
   - `node scripts/converge-batch.mjs --groups scripts/converge-remaining.json --dry-run` 应显示 `0 bookmark(s) to shoot`；
   - 更新 `README.md`「验收」一节和 `notes/final-capture.md` 的数字，征得同意后提交；
   - 用户可能会把 `shots/final` 拷回 Mac。报告里的路径统一用 `/`，两边通用。

## 常见情况

- **内存紧张：** 16 GB 内存余量不大，拍摄时不要跑其他重任务。
- **显存不够：** S06 / S06b 最接近 8 GB 显存上限。如果任务管理器里「专用 GPU 内存」长时间贴满，同时「共享 GPU 内存」持续上涨，最后一招是只给这一组加 `--query "&detailMB=1800"` 重拍。这会让远处的精细建筑变少，画面会和其他定格略有不同。
- **组失败：** 某组报 FAILED，先看日志里的报错；`--passes 2` 会自动再拍一轮。
- **WebGL 上下文丢失：** 这是 GPU 重置，脚本会判这一张失败而不是记成收敛，重跑即可。
