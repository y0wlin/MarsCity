# Final acceptance QA (build e11e9f4, after fix round 2) — defect texts

Testers: #1 qa2-spot (QA2P-*), #2 qa2-quality (QQ2-*), #3 qa2-zoom-repro (QZ2-*), #4 qa2-shots (QS2-*).
Lead observation: a single page running a ~44 min zoom ladder grew the Chrome GPU process to 8.1 GB + renderer 7.3 GB (killed); qa2-quality QQ2-02: renderer crash after ~35 min with monotonically growing texture/geometry counts.
Evidence paths are under web/shots/qa2-*/.

## ADDENDUM (qa2-zoom-repro #3, arrived after fix round 3 started) — owners, include these:
- memory: QZ2-01 renderer crashes (2 of 9 sessions) after long sessions on big zoom-ins / fly-back by id.
- urban: QZ2-02 ZR2 river corridor still has roads + a house below the water (−0.2…−3.4 m), pedestrians wading; QZ2-07 40 m arterial
  straight up a 24 % slope on range-zr1w's west flank (follow contours / switchbacks).
- terrain-fn: QZ2-03 range-zr1w peaks are concave "wizard-hat" needle cones at 200 m and 5 km.
- terrain-render: QZ2-04 bare-rock slopes (ROCK_RED, strata 0.88) at eye level read as smooth sand with polygon cracks — need strata
  sections, outcrops, scree; QZ2-05 30 km night (converged): the whole city carpeted by uniformly lit Voronoi district outlines and a
  street grid, empty land too — no dark hierarchy; Z-05 ZR2 canyon invisible at the full disc.
- city: QZ2-06 cold start 200 m above the canyon: at 38 s far mass blocks float in clusters above the coarse terrain.
- props: QZ2-08 Canvas2D getImageData warning on every page; QZ2-09 riverside plaza benches lie on the slope, one end sunk.


######## QA2 #1
## SUMMARY
qa2-spot（§6 抽查 1–5）验收结论：未通过，而且只完成了一部分。被测构建为 e11e9f4，地址 http://127.0.0.1:4300，证据都在 shots/qa2-spot/。

【环境说明（影响范围大）】本机并不空闲：同时有 qa2-shots、qa2-quality、qa2-zoom-repro 等代理在跑浏览器，负载均值 70–270。约 17:00 起 scripts/slot.mjs 的默认 MARS_SLOT_CAP 被改回 1；slot0 从 16:55 起一直被 qa2-zoom-repro 的长链占用（到 17:49 仍在第 3 个任务）。我的浏览器链在 17:05–17:49 排队，始终没拿到槽位，已撤销，没有留下后台进程。实际只跑成第一批 capture：S01 在 214 s 进入 idle，S02 在 270 s，TE0/TE90 到 300 s 仍未 idle（TE0 有 2 个任务待处理，TE90 待处理 0 但仍有系统报忙），TE180/TW90 没拍到。
所以抽查 2、3、4 的浏览器流程（轨道→街面→背面→屋顶→二层步行→存书签→重载→回访）、抽查 5 的近景，以及 QP-02/03/04/06/08 和 QA-ID-02/05 的浏览器复测都没有执行。脚本已备好，可直接重跑：node scripts/slot.mjs -- zsh shots/qa2-spot/chain.sh（含 tt.mjs、visit.mjs、region.mjs）。

【已拿到的结论】
- 抽查1：S01 仍不达标，只有 ZR5 一个夜侧都市亮核。根因是 subsolarLat 12° 让晨昏线倾斜：它在 22–30°N 处于 101–103°E（书签注记按赤道 108°E 估算），整个 ZR1 都在日侧，左上的夜灯其实是 OX1 聚落。S02 的三个夜间城网和 TE90 的两个亮核清楚，QP-05 的散点底噪已消失。
- 富氧水网在全盘仍读不出（QP-07 未修复）。
- 抽查4（Node 层）：随机选到的 4 栋（ZR3 商住楼、ZR5 住宅、OX4 维护楼、OX3 宿舍）ID 可重生成；walk-buildings 房间全部可达；9 个门洞在碰撞体中全开；层表与清单一致；二层窗外 32–34 m 处有邻楼。但其中 3 栋的 street 原始锚点落在对街楼占地内，要靠运行时 QP-03 滑移修正，这一点未在浏览器验证。
- 宿舍回归 49/50 可走通，剩 1 栋完全进不去。
- 清单 ↔ 资产：57 栋 / 8 类 0 不符，QA-ID-03/04 已修复。QA-ID-02 在 Node 层已修复（187/187）。
- 云时钟代码与 QP-08 的根因完全相同；地形 objectId 调试模式仍为 0（QP-06）。这两项只做了代码层判断，没有在浏览器复现。
## CHECKS
- [fail] 抽查1 全盘识读（S01/S02/TE0/TE90 缩到 320 px；TE180/TW90 未拍到）: 用 capture-shots 拍 1600×900，加 &workers=6，idle 上限 300 s：S01 214 s idle，S02 270 s idle，TE0/TE90 到 300 s 仍未 idle。之后按线性光缩到 320 px（shots/qa2-spot/S01-320x3.png，四图并排 m320-row1x2.png）。
S01 日侧：ZR1 星状银灰城带清楚；ZR4 群岛城清楚，银灰岛块之间有蓝色水道，南侧压着一团云（S01-crop-zr4.png）；第三片 ZR5 东翼几乎全被云条遮住，320 px 下与云不可分（S01-crop-br.png）。
S01 夜侧：只有 ZR5 核心一个亮核。左上的稀疏灯点，用 pix2ll 换算 (640,300) 得 14.16N 98.27E，属 province 1 = OX1，density 0.18，是富氧聚落，不是注记说的「ZR1 西翼」。ZR1 西翼 30N 105E 投影在 (698,205)，那里没有亮核（S01-crop-left.png）。
暗水与赤岩间断清楚。
S02：ZR1、ZR4、ZR5 三个夜间城网围住大块暗水，没有散点底噪。TE0：ZR3 星状城与赤岩清楚。TE90：ZR1、ZR5 两个夜核清楚。
结论：主视图 S01 不满足 §5 01 / §6.1 要求的「三片日侧城区 + 至少两个夜核」。
- [partial] 抽查2 旋转与换时（四经度 × 两个时刻 + objectId 层）: 未执行：浏览器槽位一直被占（见 summary）。脚本 shots/qa2-spot/tt.mjs 已备好，内容是四经度 × time 15/3 的 clean 帧、E0 的 15→3→15 云复原、E0/E90 的 objectId 层与 E90 的 province 层，并记录 cloudTime 和忙碌系统。
现有证据只有书签时刻 time=15 的 TE0、TE90 两帧。
代码层：src/render/terrain/material.js:17 仍是 DEBUG_MODES.objectId = 0，所以 objectId 下地形照常受光，不是平涂 ID 色；src/render/clouds/index.js:195 的 d=((d%24)+36)%24-12 未改。两者都未经浏览器复现，不作为本轮新缺陷上报。
- [partial] 抽查3 区域识别（OX1 水网 / OX4 极地站 / ZR1 沿岸城群 / ZR2 峡谷城并排）: 未执行：没有浏览器槽位。shots/qa2-spot/region.mjs 已备好，拍 S03、S04、S05、S06 的 clean 帧后并排比较。全盘尺度上只能确认 ZR4 群岛城和 ZR3 星状城的轮廓可辨，区域尺度没有证据。
- [partial] 抽查4 任意落点：Node 层（种子 20261116 随机抽省 → ZR3、ZR5、OX4、OX3）: 选楼：ZR3-4.3.aw.18r-n2.n5-17（shop_row 5F）、ZR5-3.3.1is.aq-10.n1-1（residential 12F）、OX3-1.3.7a.13o-11.1-4（dorm 4F）。OX4 用随机采样找不到 ≥2 层的普通楼，改从 iceFootSystem 出口的 53 个城块里按种子 20261117 选出 OX4-2.3.ze.ku-2.2-0（maintenance 2F）。清单见 shots/qa2-spot/picks4.json。
- ID 与层表：buildingSpecById 可重生成。层表 ZR3 为 4.8+4×3.1；ZR5 为 3.6+11×3.1；OX3 为 3.4+3×3.1；OX4 为 5+4.5（清单 fh 5，屋面 10.85 对清单 10，在 ±3 m 内）。见 bdata.json。
- 内部通路（walk-buildings --id）：ZR3 36/36，ZR5 108/108，OX4 2/2（厂房加二层办公），OX3 63/63。四栋门厅、楼梯、二层起居都可达。OX3 的 backDoorOutside=false，疑为坡地误报：后侧地面低 1.26 m，工具把室外当作平地。见 walk/walk.log。
- 门洞：9 个入口在 1.0 m 高处碰撞体全开；后勤门门头 2.1–2.3 m，对照 1.7 m 人高合理。见 window.jsonl。
- 窗外邻居：二层起居视线 ±30° 内，ZR3 在 34 m 处看到 6F 商住楼，ZR5 在 34 m 处看到 10F 住宅，OX3 在 32 m 处看到 3F 宿舍，OX4 在 173 m 处看到温室排。
- 视点净空：街对面原始锚点落进对街楼占地的有 ZR3（n2.n4-1）、ZR5（n2.n2-7）、OX3（11.1 对面的 10.1-0）三栋（camclash.jsonl），需要 controls._clearGroundView 运行时滑移，未验证。
- 浏览器流程（轨道→街面→背面→屋顶→二层步行→UI 存视点 / 存当前视角 / 存书签→重载→回访，含冷启动早帧）未执行：没有槽位。脚本为 shots/qa2-spot/visit.mjs。
- [partial] 抽查5 尺度与锐度: 轨道层：S01/TE0 的城市肌理、群岛水道和峡谷走向在 1600 px 下可读。区域、街面、特写三级未拍（region.mjs 含 S07 车站 platform 视点看轨距与人、S08c 栏杆、S07b 门），没有槽位。
代码 / 数据核对：
- 轨距：内距 1.435 m，钢轨中心 ±(1.435+0.07)/2（src/render/city/streetBuild.js:990）。
- 车轮：中心在 ±0.72 m（src/props/models.js:633），比钢轨中心 ±0.7525 偏内 3 cm，肉眼不可见。
- 栏杆：阳台栏杆顶 1.1 m（kit/balconies.js:328）；铁路桥护墙 1.1 m（render/city/bridgeBuild.js:237）；巨构栏杆 1.1 m（megastructures/parts.js:157）；楼梯扶手 0.92 m（kit/stairs.js:165）。
- 门高：玻璃双开门 2.3 m（kit/doors.js:161），楼梯间门 2.1 m。
- 人高：1.28–1.90 m。
- 地形 LOD：5 处楼址 heightAt 粗细对比，mw 320 m 以内偏差 ≤ 1.95 m，mw 640 m 时 ≤ 7.4 m。round 1 的 OX3 点当时差 23 m，现在为 0.04–2.8 m（hgt.mjs）。
- [partial] 宿舍内部通路回归（walk-buildings --around … --family dorm）: OX3 一带 29/30、OX5 一带 20/20，合计 49/50 栋完全可走。round 1 的样例 OX3-1.3.a.1ar-28.n13-0 现在 46/46，lobby 和 living2F 都可达。
失败 1 栋：OX3-1.3.9.1as-31.0-0，0/29 间，见缺陷 QA2P-03。日志：walk/dorm-regress.log。
- [pass] 清单层数/高度 ↔ 资产层表（QA-ID-03/04 扩大抽样）: hsweep.mjs 抽 57 栋，覆盖 office、residential_tower、maintenance、service_depot、insulated_station、meltwater_pump、dorm、pumphouse 8 类。anchors.floors 层数与 spec.floors 不符的 0 栋；|roof.y − meta.height| > 3 m 的 0 栋。证据：shots/qa2-spot/hsweep.json、idcheck.json。
- [partial] 测试环境 / 收敛: 负载均值 70–270，同机至少 3 个 QA 代理在跑浏览器。约 17:00 起 slot.mjs 默认上限改为 1，slot0 被 qa2-zoom-repro 的 chain.sh 从 16:55 一直占到 17:49 以后，我的链排队 44 分钟未能启动，已撤销。
收敛情况：S01、S02 idle；TE0、TE90 到 300 s 未 idle（report.json：TE0 pending 2；TE90 pending 0 但 isIdle 仍为 false）。
需要在空闲机器上用 chain.sh 补跑抽查 2–5。
## RETEST
- QP-01: partly — S01 改了构图：ZR5 核心落在夜侧且很亮，ZR1、ZR4 在日侧清楚。但夜侧仍只有 1 个都市亮核，第三片日侧城区（ZR5 东翼）被云遮住。
根因：subsolarLat 12° 下晨昏线在 22–30°N 处于 101–103°E，不是注记说的 108°E，所以 ZR1 全在日侧，左上的夜灯是 OX1。
证据：shots/qa2-spot/cap/S01.png、S01-320x3.png、S01-crop-left.png、S01-crop-br.png。详见 QA2P-01。
- QP-02: not-checked — 浏览器没有槽位，未复测。代码有改进：App.applyBookmark 对非访客打断最多重试 2 次，失败后用 resolveBuildingView 按资产锚点算位姿兜底。但 ui/selection.js saveAllViews 仍把通用的三分之四外景或入口位姿存为 fallback，round 1 的建议未采纳。
- QP-03: not-checked — 浏览器未复测。代码层新增 controls._clearGroundView（src/controls/index.js:1546），按已流入邻楼的占地做滑移与视线检查。原始锚点仍会撞楼：本轮 4 栋中 3 栋的 street 锚点落在对街楼占地内，round 1 的 ZR1、OX3 两例也仍在（shots/qa2-spot/camclash.jsonl），所以必须靠运行时修正生效。
- QP-04: not-checked — 浏览器未复测，没有冷启动回访早帧。数据层有明显改善：楼址处粗 LOD（mw ≤ 320 m）与全细节地形只差 ≤ 2 m；round 1 的 OX3 点当时差 23 m，现在 ≤ 2.8 m（hgt.mjs）。另有 terrain displayShift 与相机优先细化，但未见画面证据。
- QP-05: fixed — S02 和 TE90 的夜面没有均匀散点：高地背坡、OX1 内陆连续漆黑，灯光都沿城网分布（shots/qa2-spot/S02-crop-w.png、TE90-crop-nw.png）。dotcheck-S02.json 中 85% 的亮像素落在 urbanSample 4 km 网格有灯或有覆盖处，其余多是城网边缘泛光和球缘。
- QP-06: not-checked — 没有在浏览器复现，所以不判定。代码仍是 src/render/terrain/material.js:17 DEBUG_MODES.objectId = 0，地形在 objectId 下照常受光并带夜灯，高度怀疑未修复。tt.mjs 已备好 time 15/3 的 objectId 对拍。
- QP-07: not-fixed — TE0 全盘：OX5 区域（像素 (560,480) 对应 −4.3°、−36.3°，province 5，farm 1.00）只是灰橄榄色 Voronoi 斑块，看不到蓝色树枝状渠网和沿渠深浅耕地，320 px 下更不可辨。证据：shots/qa2-spot/TE0-crop-sw.png、cap/TE0.png。详见 QA2P-02。
- QP-08: not-fixed — 代码层判断，未做浏览器对拍。src/render/clouds/index.js:195 的 d=((d%24)+36)%24-12 与 round 1 的根因完全相同：+12 h 和 −12 h 都被映射成 −12，所以 15→3→15 后 cloudTime 变成 −9，云场不复原。tt.mjs 中的 E0-t15 对 E0-t15-again 可出画面证据。
- QA-ID-01: partly — 49/50 栋宿舍可完全走通，round 1 的样例 OX3-1.3.a.1ar-28.n13-0 现在 46/46。仍有 OX3-1.3.9.1as-31.0-0 进深仅 9.9 m 的浅平面，0/29 间可达，见 QA2P-03。
- QA-ID-02: fixed — Node 层：towns.townSpecById 对 4 个工作镇 187/187 栋返回规格，与 workTown 生成的一致；workers/handlers/lookup.js:9 的 'buildingSpec' 先查 townSpecById，再查 buildingSpecById。urban.buildingSpecById 仍返回 null，这是设计如此。浏览器内从轨道 selectBuilding('OX5-G02-T1-0') 未执行，region.mjs 已备好。
- QA-ID-03: fixed — round 1 点名的三栋：ZR1-0.3.1dd.199-13.n3-0 清单 meta.height 135.9 / 屋面 137.65；ZR3-4.3.it.15i-n17.n9-0 为 83.9 / 85.65；ZR4-5.3.kf.ze-n21.n11-0 为 167.6 / 169.35。扩大抽样 0 不符（idcheck.json、hsweep.json）。
- QA-ID-04: fixed — OX4-2.3.12z.ir-n4.9-0 资产为 3 层，层高 7/6/6，与清单一致；OX6-3.3.me.at-7.n2-0 为 4/3.6，与清单一致。OX4 的 n5.9-3 meltwater_pump 为 1 层 5 m，一致。扩大抽样 0 不符。
- QA-ID-05: not-checked — 浏览器未复测，region.mjs 中的 WEBGL_lose_context 测试已备好。代码层已实现：src/render/pipeline.js:207–225 在 contextlost 时 setAnimationLoop(null) 并显示提示，restored 后按当前位姿和时间重载，10 分钟内最多 2 次。
## DEFECTS (3)
- QA2P-01 [blocker] <lead> S01 主视图缩到 320 px 仍只有 1 个夜侧都市亮核（ZR5），第三片日侧城区被云吞掉；倾斜的晨昏线把整个 ZR1 留在日侧（QP-01 未解决）
    repro: 1) cd web && node scripts/slot.mjs -- node scripts/capture-shots.mjs --base http://127.0.0.1:4300 --only S01 --out shots/qa2-spot/cap --width 1600 --height 900 --query "&workers=6" --idle 300000（214 s idle）。
2) node shots/qa2-spot/img.mjs down shots/qa2-spot/cap/S01.png S01-320.png 320，不看说明直接指认。
3) 用 shots/qa2-spot/pix2ll.mjs 换算左上夜灯 (640,300)，得 14.16N 98.27E，sampleFields 为 province 1（OX1），density 0.18。用 ll2pix.mjs 换算 ZR1 西翼 (30N,105E)，得 (698,205)，该处没有灯核。
4) 晨昏线西缘 = (12−solTime)·15 − acos(−tanφ·tan12°)：solTime 22.8 时在 30N 为 101.0°E、22N 为 103.1°E、赤道 108°E、46S 为 120.7°E。ZR1 的密集格在 22–30N 的 108–132°E，因此全在日侧。
    evidence: shots/qa2-spot/cap/S01.png；shots/qa2-spot/S01-320x3.png；shots/qa2-spot/m320-row1x2.png（S01、S02、TE0、TE90 各 320 px）；shots/qa2-spot/S01-crop-left.png（夜侧左上只有 OX1 稀疏灯点）；shots/qa2-spot/S01-crop-br.png（ZR5 东翼与云条混在一起）；shots/qa2-spot/S01-crop-zr4.png
    expected: §5 01 与 §6 抽查1：主视图缩到 320 px 后，仍能凭轮廓指出三片日侧城区、至少两个夜侧都市亮核，以及一处赤岩或暗水间断。书签注记写的是「夜侧 ZR5 核心与 ZR1 西翼两处亮核」。
    actual: 日侧：ZR1、ZR4 清楚；ZR5 东翼只剩与云同色的白条。夜侧：只有 ZR5 核心。左上的点状灯是 OX1 富氧聚落，不是都市亮核；ZR1 西翼在 subsolarLat 12° 下处于日侧。暗水和赤岩间断清楚。
    suggestion: 按倾斜后的晨昏线重排时刻（未在浏览器验证）。
建议 subsolarLat 取 0（或接近 0），solTime 约 22.0，让晨昏线在各纬度都落在约 120°E：ZR1 核心（111–120°E，22–26°N）和 ZR5 核心（96–117°E，46°S）同在夜侧；ZR1 东臂（120–135°E）、ZR4（165°E）、ZR5 东翼（120–147°E，46–52°S）留在日侧。
若保留 subsolarLat 12，solTime 约 21.7 可让 22°N 处的晨昏线到 119.6°E，但 46°S 处会到 137°E，ZR5 东翼会变暗。
同时减少 ZR5 东翼上空的云量，并改正注记。
- QA2P-02 [major] <terrain-render> 富氧水网在全盘仍读不出「蓝色树枝」，O 区只是随机橄榄色斑块（QP-07 未修复）
    repro: capture-shots --only TE0（1600×900，workers=6，300 s 未 idle，待处理 2 个任务）。
node shots/qa2-spot/img.mjs crop shots/qa2-spot/cap/TE0.png TE0-crop-sw.png 440 380 400 380 2。
用 pix2ll(560,480,0,0) 换算得 −4.31°、−36.30°，province 5（OX5），farm 1.00；(680,640) 得 −27.8°、−19.3°，farm 0.54。
    evidence: shots/qa2-spot/TE0-crop-sw.png；shots/qa2-spot/cap/TE0.png；shots/qa2-spot/m320-row1x2.png（第三幅）
    expected: §1「构建日侧地表」：富氧水网呈蓝色树枝，沿枝条两侧长出颜色深浅不同的耕地，过了灌溉末端露出粗糙赤土，三种人工轮廓在低分辨率预览里也能分开。
    actual: farm=1 的 OX5 农区在全盘上只是灰橄榄色 Voronoi 斑块，与水系走向无关，看不到任何蓝色渠线。320 px 下 O 区与裸岩几乎不可分。fix round 2 的 surface.js 只改了港口灯、港池色和城区肌理，没有渠网的轨道层表达。
    suggestion: 轨道层地表色沿 hydro 主干和支渠画出比像素宽、按角尺寸展宽且能量守恒的蓝色带。耕地色沿渠两侧随距离由深到浅衰减，过了灌溉末端露出赤土。需要时请 terrain-fn 提供 C0 节点表（canalnodes.bin）的主渠折线供轨道纹理使用。
- QA2P-03 [major] <buildings-o> 浅进深宿舍 OX3-1.3.9.1as-31.0-0 整栋进不去：从街门到不了门厅和楼梯，0/29 间可达，平面缺门厅和起居（QA-ID-01 残留）
    repro: cd web && node scripts/walk-buildings.mjs --id OX3-1.3.9.1as-31.0-0 --verbose --png shots/qa2-spot/walk/OX3-1.3.9.1as-31.0-0.png → lobby:false，stairFoot:false，floorsReachedPct [5,0,0,0]，roomsReached 0/29，planUnreachable 24。
回归：node scripts/walk-buildings.mjs --around OX3-1.3.a.1ar-28.n13-0 --family dorm --n 30 --quiet → 29/30，唯一失败即此栋。
平面数据：node shots/qa2-spot/bdata.mjs OX3-1.3.9.1as-31.0-0。
    evidence: shots/qa2-spot/walk/OX3-1.3.9.1as-31.0-0.png（整层红色，表示不可达）；shots/qa2-spot/walk/dorm-regress.log；生成器自身输出 data.meta.unreachableRooms = 24
    expected: §1「住宅的街门接门厅、信报区与交通核，上楼可从走廊进户」，§6 抽查4「内部通路」，每栋都有可复访的内部空间。生成器在报告 unreachableRooms > 0 时应修复，或退回可连通的平面。
    actual: 4F 宿舍，入口 z=±4.97，即进深 9.94 m。每层只有 stair、lift、bath×2、kitchen×2、bedroom×2，没有 hall 和 living；首层 lobby 也到不了。37 间中 24 间被生成器自己标为不可达，步行工具从街门进去 0 间可达。其余 49 栋宿舍正常。
    suggestion: 检查 dorm.js 在进深 ≤ 10 m 时的户型退化：户门和门厅被挤掉。浅地块应改为外廊式或单侧走廊平面。对 meta.unreachableRooms > 0 的结果自动回退到可连通平面，并把 walk-buildings --family dorm 加入回归。
## BOOKMARK CORRECTIONS
- S01: pose lat -8, lon 122～126（视构图可略东移，保证 ZR4 不贴边）, alt 1.79e7, heading 0, pitch -90, lens 50 time 建议 subsolarLat 0、solTime ≈ 22.0（晨昏线约 120°E，ZR1 核心与 ZR5 核心同在夜侧，ZR1 东臂、ZR4、ZR5 东翼在日侧）；或保留 subsolarLat 12、solTime ≈ 21.7（代价是 ZR5 东翼变暗）。同时改正注记。 — 注记假设晨昏线在东经约 108°，但 subsolarLat 12° 让它在 22–30°N 处于 101–103°E，所以 ZR1 全在日侧，夜侧只有 ZR5 一个都市亮核，左上灯点是 OX1。修正建议未在浏览器验证。

######## QA2 #2
## SUMMARY
qa2-quality 终验结论：未通过。本轮新发现 2 个 major、4 个 minor 缺陷，没有 blocker。我负责复测的上一轮 27 条缺陷中，14 条已修复、5 条部分修复、8 条未能复测。

【测试条件】
- 被测：e11e9f4 生产构建 @ http://127.0.0.1:4300，1600×900，参数 clean=1&workers=6，ultra 画质。
- 机器并不空闲：其他 QA 的浏览器同时在跑，load 180–250。worker 队列只增不减：20 分钟提交 778 个任务、完成 475 个，待处理从 157 涨到 261。
- 所有街面帧在 waitIdle(300 s) 内都没有 idle，pipeline.converged 也一直是 false（GPU 每帧 1.4–2.2 s，城区 0.5–1.3 亿三角面）。截图时都没有收敛。
- 2× 定格用的是 capture({scale:2}) 自带的每块 48 次累积，抗锯齿是收敛的，但远处流式细化可能没做完。

【批次 A】
在同一页面依次拍了 C03、C03 关 AO、C04、C06（含 3 次 5 cm 微移）、C05，其中 C03/C04/C06/C05 各做了一张 2× 定格。
页面开启约 35 分钟后，在 S07 建筑视点落地时渲染进程崩溃（Target crashed），S07/S07b/S07c/S07d 都没拍成。崩溃前纹理数从 3075 一路涨到 7389，几何数从 949 涨到 2099（新缺陷 QQ2-02）。

【批次 B 没有执行】
17:04 有人把 scripts/slot.mjs 的全机浏览器上限改成了 1。唯一的槽位从 16:55 起被 qa2-zoom-repro 的 chain.sh 连续占用，估计 19:30 以后才会释放。
我的批次 B 排队了约 25 分钟，最后我主动取消，以免它在无人值守时独占唯一槽位。批次 B 原本要拍：S07d/S07/S07c、S06 蓝调、S08、S09、ZR5 街坊航拍与人眼绕楼、OX1 堤镇与温室（含室内）、诊所、学校、仓库、QA-ASSETS-01 冷启动、S04、S03。
因此 S06 蓝调、S08 阴影与崖壁、ZR5 街坊、O 区城镇，以及除 Z 站以外的风格建筑，本轮都没有浏览器实证。能用 Node 数据检查替代的已经替代。

【已确认通过（有截图或 Node 证据）】
- C04 夜景：人工光主导，广场有光池（20 盏 SpotLight），站厅有灯具和照度渐变，灯箱有内容，夜空暗、只在地平附近有暖色光晕。
- C03 广场：石板铺装有分缝和色差。
- C03 人物：有体型、发型、衣服、包和鞋；绿色行道树有分枝和叶簇。
- C06：女儿墙在 5 cm 微移下无 z-fighting；阳台绿植深绿有叶片；窗洞有进深，室内各不相同。
- C06：阴影里的沥青读作中性深灰，线性 B/R 从约 6 降到 2.06。
- C03：AO 黑斑已消失。
- ZR5 浅进深板楼平面可达（420/420）。
- 数据层：OX4 冰崖已改为 ICE 材质；S03 一带出现了堤镇；温室泵房落在真实的渠上。

【主要新问题】
1. 窄地块/浅进深的多层住宅（短边 < 8 m、≥ 4 层）大量不可用：ZR1 有 143 栋，只有 54 栋完全可达，房间可达 61%；ZR5 有 56 栋，只有 29 栋完全可达。有的上层全部走不到，有的连街门到门厅都不通。上一轮 QY-03 的小办公楼地块现在正是这种住宅。
2. 一个页面里按顺序看几组书签后，渲染进程崩溃；资源计数在崩溃前单调增长。
3. 另有四个小问题：粉花树的树冠由边缘生硬的扁圆卡片拼成；车站筒壳在 2× 下是平板灰面，没有板缝；车站首层候车厅在 21:30 全黑；主塔正面幕墙仍只反射均匀天色。

控制台在崩溃前是 0 error、0 pageError。证据统一放在 shots/qa2-quality/ 下。
## CHECKS
- [partial] 白色外壳保留亮部纹理: C06 中受光的屋面和女儿墙压顶亮度 p50 202、最大 227，没有剪切；2× 下能看到卷材纹理和压顶高光（A/mont-C06z-roof.png）。C03 背阴面的车站筒壳在 2× 下是均匀灰面（p5–p95 97.8–108.1），没有板缝和纹理（A/crop-C03x2-shell.png，记为 QQ2-04）。C06 住宅正立面上午处于阴影里，无法评判亮部纹理。
- [pass] 窗内进深与室内多样性: C06 2×（A/crop-C06x2-windows.png）：窗框退进墙面，窗内是带床、沙发、门和木地板的真实室内，相邻窗户布置各不相同。C03/C04：站房玻璃后能看到大厅的楼板、吊灯和楼梯。
- [pass] 无 z-fighting（5 cm 微移）: C06 三帧，每帧相机移动 5 cm（lat +5e-7），每次等收敛 60 s。diff meanAbs 3.3，超过 16 级的像素占 4.9%，全部是视差边缘和随风摆动的树叶。女儿墙和屋面上没有随微移整体换位的块纹（A/mont-C06z-roof.png，A/diff-C06z-01.png；上一轮是 meanAbs 16.6，超过 16 级占 39%）。补充：kit 自带的审计 walk-buildings --zfight 仍列出共面重叠面，例如诊所屋顶 aluminium|solar_panel 19.8 m²，S07 住宅 full 室内 wood|wood 23.8 m²、plaster|tile_wall 12.5 m²。这些没有拍到渲染证据，未单列缺陷。
- [partial] 阴影：无痤疮、无级联直线、接触阴影: 街面 C03/C06 中长椅、灯杆、自行车架、行人的接触阴影都贴合，没有看到漂浮或痤疮。远级联（S08）因浏览器槽位被占没有复现，QQ-01 未复测。
- [pass] 夜景：人工光主导、暗隙与光池: C04（当地 21:30）EV 1.00，白天 C03 为 -0.12；emissiveScale 0.212；SpotLight 20 盏，半径 38 m。前景广场亮度 p50 21.6，光池 108–168；夜空顶部 p50 4.8，有星星；站厅拱顶 p50 84。路灯、地灯和雨棚筒灯在广场和台阶上形成光池，四周留有暗部（A/A-C04.png，A/crop-C04x2-entry.png）。例外：车站首层候车厅玻璃后亮度 p50 只有 3–5，记为 QQ2-05。
- [partial] 蓝调时刻天空（蓝紫→粉橙）: 没有复现：S06 在批次 B 中，因全机唯一槽位被占而取消。只确认了夜空部分：C04 天顶接近黑色有星，暖色光晕只在地平附近，不再是上一轮那种平板褐色。
- [partial] 人物与树木达到游戏级: 人物（C03 2×，A/crop-C03x2-people.png）：有成形的身体、发型、裙子、斜挎包、背包、鞋，步态自然，不再是胶囊人偶。绿色阔叶树（A/crop-C03x2-trees.png）：有分枝骨架和叶簇，树皮清晰不糊块，侧面看不到被拉长的叶卡。粉花树的树冠是一片片边缘生硬的扁圆卡片，记为 QQ2-03。S07d 树皮特写没有复现（页面崩溃）。
- [pass] 阳台和屋顶绿植深绿有叶片: C06 2×（A/crop-C06x2-plants.png）：花池和垂吊植物是深绿色，叶簇有明暗和自阴影，不再是苍白的青色团块。
- [pass] 沥青中性: C06 中处于建筑阴影的车行道 sRGB 约 (35,40,52)，线性 B/R 2.06、G/R 1.23（上一轮 B/R 约 6）。读作略偏冷的深灰，符合天光下阴影的物理预期。S07 路面因崩溃没有复测。
- [pass] 广场铺装有纹理: C03 2×（A/crop-C03x2-plaza.png）：石板约 1.2×0.6 m，有抗锯齿的分缝，每块色调略有差异，压在上面的投影自然。
- [partial] 崖壁三向投影无拉伸: S08 没有复现。仅有的参考是 qa2-shots 同一构建的 S04 冷启动帧（../qa2-shots/cap/S04.png，未 idle）：冰崖立面是白蓝冰体，带竖向裂隙和尘带，没有帘状拉伸。这一帧不是我复现的，只作辅助参考。
- [partial] 风格与功能：Z 站、诊所、学校、仓库、温室、闸/泵站、后街服务: Z 站（C03/C04）可以认出：三连筒壳、玻璃站厅、带列车图标的灯箱、LED 发车牌、宽大台阶和雨棚光池。其余类型的渲染随批次 B 一起取消。Node 侧：诊所 exterior 有 light_cyan 和 light_red 灯箱、ambulance 入口、courtyard 采光井、waiting 房间；温室行首泵房 OX1-0.3.11t.x5-5.3-0 带 meta.water（21.8 m 宽渠，距 23.9 m）；S07 周边 25 个瓦片内已没有短边 < 12 m 的办公楼。
- [partial] ZR5 住宅街坊 150–300 m 鸟瞰与人眼绕楼一周: 浏览器部分没有执行。原计划：鸟瞰位姿 -42.8042287,105.7028601,149.11,342.92,-28.21,35，time=3.453；ZR5-0.3.12d.p-5.n8-5 的 street/back 视点和侧面眼高位姿。Node 侧：该楼及同组 4 栋全部可达（420/420）；但 ZR5 的窄住宅只有 29/56 栋完全可达（QQ2-01）。
- [partial] O 区城镇: 只做了 Node 检查。S03 视域 ±4.9 km 内有 dorm 6、farm_station 3、maintenance 4、cold_storage 2；例如堤镇 OX1-0.2.ix.gl-1.1-1…5，位于 7.255N 104.884E。原计划的航拍位姿 7.2596069,104.8823382,242.14,142.94,-26.37,35 和眼高视角没有执行。
- [fail] 建筑可用房间（§6 游戏级资产）: 普通板楼没问题：S07 周边 40 栋 40/40，共 5514 个房间；house 家族 40/40；ZR5 的 QA 样楼 4/4。窄或浅的多层住宅大量不可达：ZR1 54/143 栋（房间 1503/2461），ZR5 29/56 栋（房间 565/876）。见 QQ2-01。
- [fail] 稳定性与收敛: 单页面会话约 35 分钟后渲染进程崩溃（QQ2-02）。所有帧在 300 s 内都没有 idle、没有收敛；worker 队列在其他 QA 的负载下持续增长。2× 定格每张耗时 96–134 s。
- [pass] 控制台: 批次 A 崩溃前 0 个 console error、0 个 warning、0 个 pageError（A/reportA.json）。
## RETEST
- QQ-01: not-checked — S08 没有复现（批次 B 因槽位被占取消）。atmosphere 的 notes 认为条纹和直线边界属于地形本身，与 CSM 无关，请 terrain-fn 改，这一点本轮没有核实。
- QQ-02: fixed — C06 三帧 5 cm 微移，屋顶女儿墙内侧和压顶都干净，diff 只剩视差边缘（A/mont-C06z-roof.png，A/diff-C06z-01.png，A/A-C06z-0..2.png）。
- QQ-03: fixed — C06 2×：阳台花池和垂吊植物是深绿色叶簇（A/crop-C06x2-plants.png）。
- QQ-04: fixed — C06 阴影里的车行道 sRGB (35,40,52)，线性 B/R 2.06（上一轮约 6），读作中性偏冷的深灰（A/A-C06.png 的 x20–540、y800–880）。S07 视角因崩溃没有复测。
- QQ-05: fixed — C04 EV 1.00；广场和立面处于暗部，窗光、路灯和站厅成为主光，前景 p50 21.6（A/A-C04.png）。
- QQ-06: fixed — C04 中灯杆、地灯和入口雨棚在广场和台阶上形成光池，SpotLight 20 盏、半径 38 m（A/crop-C04x2-entry.png）。
- QQ-07: not-checked — S06 蓝调没有复现。C04 的夜空部分已改善：天顶接近黑色有星，暖色光晕只在地平附近（A/A-C04.png 的 y0–120：均值 8,5.5,4.6）。
- QQ-08: fixed — C03 2×：人物有体型、发型、衣服、包、鞋和步态（A/crop-C03x2-people.png）。没有拍到面部特写。
- QQ-09: fixed — C03 2×：树干树皮清晰不糊块，叶簇挂在分枝上，没有被拉长的侧向叶卡（A/crop-C03x2-trees.png）。S07d 特写因崩溃没有复测。粉花树的圆片树冠另记为 QQ2-03。
- QQ-10: fixed — C03 2×：铺装有石板缝和逐块色差（A/crop-C03x2-plaza.png）。
- QQ-11: not-checked — S08 没有复现。qa2-shots 的 S04 帧（同一构建、未 idle）中冰崖没有帘状拉伸，仅作参考。
- QQ-12: fixed — 开关 AO 对比：竖梃顶端的模糊黑斑消失，只剩很淡的小接触暗点（A/mont-C03-ao.png，A/diff-C03-ao.png）。
- QQ-13: fixed — C04 2×：拱顶有亮度渐变和灯线，吊灯盘可见，灯箱有字形和列车图标，LED 发车牌可见（A/crop-C04x2-hall.png）。首层仍是暗的，另记为 QQ2-05。
- QQ-14: partly — 依据 qa2-shots 同一构建、已 idle 的 S01 帧（../qa2-shots/cap/S01.png），不是我复现的：日面陆地亮度 p50 142（上一轮约 119），银白城带 p50 166，最大 212，没有剪切。比上一轮亮，但城带离 200–230 的目标还有距离。
- QQ-15: partly — C05 2×：主塔正面玻璃仍是均匀天蓝加轻微渐变；只有部分侧面玻璃反射出程序化的邻楼窗格；看不到街树和街景（A/crop-C05x2-glass.png，A/crop-C05x2-left.png）。见 QQ2-06。
- QY-01: not-checked — 诊所渲染随批次 B 取消。Node 侧诊所 ZR1-0.3.1a5.17w-n9.n6-0 exterior 有：light_cyan / light_red 灯箱、ambulance 入口、courtyard、waiting×5、clinic 房间 85 间，屋顶有 solar_panel 和 plant。外观可辨性没有核实。
- QY-02: partly — full LOD 已修：src/buildings/interior/index.js 第 218–231 行按 HOUSING_USES 门控 mailboxWall。未修的部分：src/buildings/materials.js 的 bkInterior 中 lobby 分支（约第 463–474 行、543–544 行）对所有 lobby 窗户都画电梯厅和信报箱墙，不区分用途或占用档案，所以 exterior LOD 下公共建筑门厅（站厅等）仍会出现住宅信报箱。buildings-z 提给 kit 的门控请求没有落实。本轮只有代码证据，没有渲染图。
- QY-03: partly — S07 周边 25 个瓦片内已没有短边 < 12 m 的办公楼（smallscan：只有 4 所 14 m 进深的学校和 1 栋 10.5 m 的研究楼）。但原来的小地块，例如 ZR1-0.3.1a5.17w-n10.n9-2（7.1×8.3 m）、ZR1-0.3.1a4.17v-2.n10-0、ZR1-0.3.1a5.17w-6.n8-10，现在是 5–6 层住宅，walk-buildings 结果分别为房间 1/6、1/5、1/5，上层全部走不到。见 QQ2-01。
- QY-04: fixed — Node：sampleTerrain(73.630, 53.339) 得到 mat ICE、ice 1.0、crevasse 0.42（上一轮是 FARM）；剖面 439–733 m 全部为 ICE。渲染参考 qa2-shots 同一构建的 S04 帧：白蓝冰崖带裂隙和尘带。我自己的 S04 帧随批次 B 取消。
- QY-05: not-checked — S03 已改拍汇水盆地，渲染没有复现。数据图（farmmap-s03-outlet.png，6×6 km，20 m 像元）：赤土里没有孤立的单块田，km 尺度的包络平滑；但与赤土的边界仍是按田块的直角锯齿，农田也没有沿渠呈树枝状展开。
- QY-06: fixed — 数据层已修：S03 视域 225 个 L13 瓦片内有 dorm 6、farm_station 3、maintenance 4、cold_storage 2（上一轮宿舍、农产站、冷库都是 0），例如 OX1-0.2.ix.gl-1.1-*。渲染没有核实。
- QY-07: fixed — 原来的 OX1-0.3.11s.x7-n1.2-0 已不存在（S03 重新规划）。S03 区唯一的温室配水泵房 OX1-0.3.11t.x5-5.3-0 带 meta.water {level 113.34, width 21.8, dist 23.9}（ghpump-s03.txt）。渲染没有核实。
- QY-08: not-checked — 温室室内视点（buildingView OX1-0.3.11t.x5-5.3-3 living）随批次 B 取消。
- QA-ASSETS-01: not-checked — 冷启动街面落地测试（ZR1 位姿 22.0014739,118.0106569,561.25,223.39,12,20, mode=walk，45 s 后截图）随批次 B 取消。批次 A 里 C03/C04/C06 是先从轨道跳到街面，5 分钟以上后才截图：相机离地 1.4 m，与画面地面一致，但这不能证明落地早期没有错位。
- QA-ASSETS-02: fixed — walk-buildings 对 4 栋 ZR5 楼的结果：87/87、118/118、143/143、72/72，共 420/420。注意窄地块住宅另有失败，见 QQ2-01。
- QA-ASSETS-03: partly — 城市端已修：streetBuild.js:992 把钢轨中心放在 ±(1.435+0.07)/2 = ±0.7525 m，内侧轨距 1.435 m。props 列车轮对仍在 ±0.72 m（props/models.js:633），比钢轨中心偏内 3.25 cm，city 的同步请求没有落实。只有代码证据。
- QA-ASSETS-04: not-checked — S07c 起居室因页面崩溃没拍成，批次 B 的复拍也取消了。C06 中窗内的室内映射有多种布局变体，但那不是 full LOD 的家具。
## DEFECTS (6)
- QQ2-01 [major] <building-kit> 窄地块/浅进深多层住宅的 full 室内大量不可达：上层走不到，部分连街门到门厅都不通
    repro: 在 web/ 下：node shots/qa2-quality/narrow.mjs 21.8692 117.9986 2 8 4 > shots/qa2-quality/narrow-ids.txt。这一步列出 S07 周边 25 个 L13 瓦片中短边 < 8 m、≥ 4 层的住宅，共 143 栋。然后 node scripts/walk-buildings.mjs --ids-file shots/qa2-quality/narrow-ids.txt --quiet。ZR5 同样处理：narrow.mjs -42.8007 105.7014 2 8 4。单栋：node scripts/walk-buildings.mjs --id ZR1-0.3.1a5.17w-n10.n9-2 --png <out> --floor 1 --scale 16。
    evidence: shots/qa2-quality/walk-narrow-n10n9-2-f0.png（首层可达，楼梯在中间）; shots/qa2-quality/walk-narrow-n10n9-2-f1.png（二层整层红色，不可达）; shots/qa2-quality/walk-narrow-6.0-13-f0.png（ZR1-0.3.1a5.17w-6.0-13 首层整层红色，街门进不去）; shots/qa2-quality/narrow-walk-full.txt（SUMMARY 54/143，rooms 1503/2461）; shots/qa2-quality/narrow-walk-zr5.txt（SUMMARY 29/56，rooms 565/876）
    expected: §1/§6：每栋楼都可使用。街门接门厅和交通核，上楼后能从走廊进户，各层房间都能进入。普通板楼已经做到：S07 周边 40/40 栋、5514 个房间；house 家族 40/40。
    actual: ZR1 的 143 栋窄住宅只有 54 栋完全可达：24 栋 lobby✗ stair✗（街门到门厅或楼梯不通），37 栋 living✗（上层不可达），28 栋 19/20。例如 ZR1-0.3.1a5.17w-n10.n9-2（7.1×8.3 m，6 层，就是上一轮 QY-03 的办公楼地块，现在是住宅），房间 1/6，floorsReachedPct [80,0,0,0,0,0]；ZR1-0.3.1a5.17w-6.0-13（11.2×6.7 m，5 层），房间 2/25，首层整层进不去。ZR5 同类楼只有 29/56 栋完全可达。
    suggestion: 对短边 < 8 m 的平面（窄面宽和浅进深两种）复查楼梯间的上层落脚和开洞、街门门槛与台基高差（corner/courtyard 地块），以及 repairDoors 的根节点；把窄地块抽样加进 walk-buildings 回归测试，例如 --ids-file 用 narrow.mjs 生成。
- QQ2-02 [major] <lead> 单页面会话约 35 分钟后渲染进程崩溃（Target crashed），崩溃前纹理和几何计数单调增长
    repro: node scripts/slot.mjs -- node shots/qa2-quality/probe2.mjs --steps shots/qa2-quality/stepsA.json --out shots/qa2-quality/A --report reportA.json。整个过程在同一页面：打开 /?clean=1&workers=6，然后依次 goto('C03')、等 300 s、capture({scale:2})；关 AO 再开 AO；goto('C04')、等 300 s、2× 定格；goto('C06')、等 300 s、2× 定格，再做 3 次 5 cm 微移；goto('C05')、等 300 s、2× 定格；最后 goto('S07')。在 S07 建筑视点落地约 118 s 时页面崩溃。
    evidence: shots/qa2-quality/A/reportA.json（pageErrors ['PAGE CRASHED']，S07/S07b/S07c/S07d 都是 'Target crashed'；各步 renderer.info：textures 3075→3267→4241→5890→7389，geometries 949→1041→1493→1741→2099，C05 时 129M 三角面）; shots/qa2-quality/A.log; 旁证：shots/qa2-zoom-repro/logs/b.log（B6-200m 同样 Target crashed）
    expected: §6 网页可复现：访客可以连续看书签、进楼、回访一小时以上而页面不崩。超出单次资源能力时，应分块分批，并回收不在视域内的瓦片、纹理和建筑资源。
    actual: 浏览器标签页被杀，不是可自动恢复的 WebGL context loss，后续步骤全部失败。崩溃时本机还有其他 QA 浏览器在跑（pageouts 25 万），内存压力可能起了加速作用；但同一区域往返的过程中资源计数只增不减，提示缓存没有上限。
    suggestion: 给城市瓦片和建筑批次、地形纹理、props 资源设 LRU 上限并按距离回收；把 renderer.info.memory 和 performance.memory 加到 stats()；用同一序列做 1 小时的长会话回归。
- QQ2-03 [minor] <props> 粉花行道树的树冠由大片扁圆卡片拼成，2× 下读成一摞“圆片”
    repro: __MARS__.goto('C03')，再 capture({scale:2})，在 2× 图上裁 x300–1300、y900–1500。
    evidence: shots/qa2-quality/A/crop-C03x2-pinktree.png; shots/qa2-quality/A/crop-C03x2-trees.png; shots/qa2-quality/A/A-C03-x2.png
    expected: 游戏级行道树：花冠由不规则的花簇和叶簇组成，轮廓柔碎，与旁边的绿色阔叶树同等质量。
    actual: 在 15–25 m 处，花冠由约 20 片大的扁圆卡片构成，每片边缘是生硬的正圆、内部是均匀的花色，读作叠放的圆片或硬币；旁边的绿色阔叶树是正常的。
    suggestion: 把花卡拆成更小、带不规则 alpha 剪影的花簇，增加层数，并沿用 PROPS_LEAFFACE 的侧向淡出。
- QQ2-04 [minor] <buildings-z> 车站三连筒壳外表面在 2× 定格下是均匀平板灰面，没有板缝和纹理
    repro: __MARS__.goto('C03')，再 capture({scale:2})，裁 x1300–1900、y20–260（2× 坐标）。用 ana.mjs hist 统计 x1000–2200、y40–240。
    evidence: shots/qa2-quality/A/crop-C03x2-shell.png（在 1200×200 px 范围内，luma p5–p95 为 97.8–108.1，23.7 万像素落在同一个 16 级区间）; shots/qa2-quality/A/A-C03-x2.png
    expected: §1 白陶瓷保住板缝阴影，§6 游戏级资产：约 60 m 处的旗舰站壳应能读出分板缝、肋或压条，以及粗糙度变化（参照 Z03）。
    actual: 背阴面的筒壳只有平滑的亮度渐变，没有任何分缝和表面细节，像未贴材质的灰模面。
    suggestion: 给 z_hall 筒壳加上分板缝的法线或 AO 和细分纹理（陶瓷板格），远处用 mip 平滑。
- QQ2-05 [minor] <buildings-z> 夜间 21:30 主站首层候车厅玻璃后全黑，只有拱顶和入口雨棚发亮
    repro: __MARS__.goto('C04')，截图。用 ana.mjs stats 分别统计首层玻璃带 x150–700、y440–550 和 x900–1450、y440–550，以及拱顶 x560–1040、y160–300。
    evidence: shots/qa2-quality/A/A-C04.png（首层玻璃带 luma p50 3.0 / 4.9，拱顶 p50 84）; shots/qa2-quality/A/crop-C04x2-hall.png
    expected: §1：城市核心和换乘站形成较宽的光斑，站房夜间的检票厅和候车面应该是亮的（buildings-z 修复说明里提到 full 站厅地面有光池）。
    actual: 首层候车层读作关门的暗厅，只有 LED 发车牌和几扇小窗亮着；整座站的亮度只来自上层拱顶。
    suggestion: 首层大厅玻璃的室内映射和 full 室内都使用站厅照明档案（吊灯光池、墙面洗光），夜间常亮。
- QQ2-06 [minor] <building-kit> QQ-15 遗留：塔楼幕墙正面仍只反射均匀天色，看不到邻楼剪影和街树
    repro: __MARS__.goto('C05')，再 capture({scale:2})，裁 x1250–2050、y500–1250（主塔正面）和 x400–1100、y900–1700（左侧塔）。
    evidence: shots/qa2-quality/A/crop-C05x2-glass.png; shots/qa2-quality/A/crop-C05x2-left.png; shots/qa2-quality/A/A-C05.png
    expected: §3：玻璃同时保留街树和邻楼的反射，以及窗内进深；广场四周都是塔楼，仰视时应能反射出对面塔身。
    actual: 主塔正面玻璃是一致的蓝色加轻微渐变；只有部分侧面玻璃出现程序化的窗格（K6 的邻楼反射），没有可辨认的塔楼剪影，也没有树和街景。
    suggestion: 把 BK_CURTAIN 的邻楼反射扩展到仰视的反射方向（更高的邻楼高度范围、按方位的城市剪影）；或者在近景加屏幕空间反射。
## BOOKMARK CORRECTIONS

######## QA2 #3
## SUMMARY
qa2-zoom-repro（§6 连续缩放与真实地形 + 网页可复现）终验结论：不通过。

【上轮问题】我负责的 Z-01…Z-04 已按指标修复。跳到街面后，从渲染出的第一帧起，相机在显示地面上方 1.54–1.72 m，从未钻到地形下面。这期间粗瓦片误差最大 768 m，靠 datum 平移补偿。步行脚底与解析地面相差 −3…0 mm，不会被抬上粗瓦片。Node 端：共享边 0.0000 m，跨级缝合 ≤0.0001 m。梳齿陡坎已经消失。人眼高度看水线是连续直线。
【复现】干净 clone e11e9f4 上，npm ci、prep:data、build 全部通过。重新生成的数据和 dist 都与 4300 构建逐字节一致：24 个文件，只有 index.html，没有 dev 测试台。克隆构建上 40/40 个书签都出了定格，0 个 error。6 个随机落点的位姿都逐位保持。昼夜切换可逆。

【不通过的原因】
1. 渲染进程崩溃 2 次（Target crashed，9 个页面会话里出现 2 次），都发生在长会话后大跨度推近时。其中一次就在按 ID 回访的飞回途中。
2. ZR2 河道里有道路和一栋住宅，路面低于水面最多 3.4 m，行人在河里涉水。
3. range-zr1w 的山峰是凹坡尖顶的“巫师帽”锥，在 200 m 和 5 km 两级的天际线上都很明显。
4. 人眼高度看裸岩坡（ROCK_RED）只有光滑沙地，看不到岩层或碎石。
5. 30 km 夜景已收敛，但整片城区被均匀点亮的 Voronoi 描边和网格铺满，没有暗部层次。
6. 冷启动落到峡谷上方 200 m 后，38 s 时远处的体块仍成团悬浮在粗地形上。
7. Z-05 只部分修复：全盘看不出 ZR2 峡谷。
另有 3 个 minor：24% 坡度的 40 m 干道、每页一条 Canvas2D 警告、长椅一端陷进坡面。

【测试环境】机器并不空闲：load average 在 40–212 之间，swap 用掉 2.0/3.0 GB，2 个浏览器槽位由多位测试员共用。阶梯截图期间每张截图要 15–25 s。阶梯和落点帧在等待上限内一帧都没有收敛（待处理 worker 任务 66–998 个），所以视觉缺陷只报几何、Node 能证实的问题或已收敛帧上看到的问题。
18:48 时槽位上限被改回 1，又被 qa2-shots 的长任务链占住，以下几项没能补跑：峡谷对岸人眼、梯田坡 200 m/人眼、QR-01 原位姿复现、第二次进楼回访。总用时约 2.3 h，超出 1.5 h 时间盒。
收尾：4391 上的服务已停，clone（145 MB）已删除，4300 未动。证据目录：shots/qa2-zoom-repro/
## CHECKS
- [partial] 测试环境与收敛: load average 40–212（17:08 峰值 212），swap 2.0/3.0 GB，workers=6，视口 1600×900，ANGLE Metal / Apple M5。阶梯每张截图要 15–25 s，等待上限 45–300 s 内没有一帧 idle（待处理 66–998 个任务）。只有克隆构建上的默认落地页和昼夜切换里的 night、day2 两帧进入了 idle。所以凡是没收敛的观感都只写进备注，缺陷只报几何、Node 能证实的问题或已收敛帧上看到的问题。
- [partial] 阶梯 A：range-zr1w 23.615N 111.926E（轨道→1000 km→100 km→20 km→飞行 20→1 km→5 km→1 km→200 m→人眼，在 5 km/1 km/200 m 各侧移一次）: 1000 km 起，岩脊、山口城市走廊和城带边缘都清楚（a-ridge/L1-1000km.png）。100 km 和 20 km 的城区边缘呈蜂窝锯齿或块状，但帧没收敛，所以不判（L2-100km.png、L3-20km.png）。5 km 到 200 m 没有梳齿，也没有裂缝。新发现：峰顶呈尖锥（QZ2-03）。人眼高度裸岩坡看不到岩石（QZ2-04）。证据：shots/qa2-zoom-repro/a-ridge/
- [partial] 阶梯 B：ZR2 峡谷河 34.8685N −105.2131E: 全盘看不出峡谷（Z-05）。1000 km 时是清楚的树枝状暗线（b-canyon/B1-1000km.png）。20 km 和 5 km 能读出多级台阶崖坎和河道，1 km 的河岸干净。从 1 km 推到 200 m 时页面崩溃（QZ2-01），这一页后面 11 步全部失败。河岸人眼一项改用冷启动新页面 w1 补拍（w1-cold-walk-bank/）。对岸人眼没能补跑：槽位上限 1，被其他测试员占用。
- [partial] 阶梯 C：有人居住的坡地: 只做了两项。一是 range-zr1w 西坡住宅区：从 1000 km 跳到街面，人眼位于 24% 坡的干道上（a-ridge/J1-jump-street*.png，见 QZ2-07）。二是克隆构建上冷启动 C11（cap-clone/C11.png，见 QZ2-06）。ZR2 梯田坡的 200 m 和人眼两级没做（b2 任务因槽位没跑成）。w1 帧里能从对岸看到梯田住宅坡。
- [pass] 相邻地形块露底裂缝 / 错位: Node（shots/qa2-zoom-repro/edges.mjs）：3 处地点、5 组瓦片（L12–L16）里，同级共享边高度和水位差都是 0.0000 m。跨级时，细瓦片边缘按 morph 目标缝合后，与粗邻块的偶数和奇数顶点最大差 ≤0.0001 m（未缝合时 0.04–4.47 m），裙边 1–33 m。约 60 帧画面里都没见到透出天空的缝。
- [pass] 水线对位 / 锯齿: 在 w1 的 ZR2 南岸人眼帧里，近岸和对岸水线都是连续直边（w1-cold-walk-bank/crop-waterline.png），上一轮 25 cm 三角锯齿已经消失。B5 1 km 帧两岸也干净。不过水下有路面，还有人在水里走（QZ2-02）。
- [partial] LOD 跳变（侧移快帧对比收敛帧、20→1 km 飞行）: 侧移后快帧与最终帧的差异：5 km meanAbs 3.1–4.1（2.5–4.4% 像素差超过 24 级），1 km 1.7–2.7，200 m 0.5–3.9，峡谷 1 km 3.5–8.0（2.8–10.2%）。差异热图（a-ridge/diff-L5lat-*.png、diff-L6lat-*.png）显示变化来自建筑体块和细模切换、街道流式加载，地形轮廓不变。20→1 km 飞行的 7 帧里没有裂缝或跳变，但负载下飞行只能逐帧推进。街面帧里远处山脊有圆齿，同一方向的解析天际线却是平滑的，属于粗级未收敛，只记作观察。
- [partial] 梳齿 / 尖刺陡坎: 梳齿已修复。上一轮的 Z-03 剖面（23.47N 111.976E，方位 73°）在 minW 2/20/80 下相差不到 5 m，3 km 剖面最大坡度 1.32/1.35/1.28/0.60，0 个折点。5 km、1 km、200 m 和人眼帧都没有三角齿。但出现了尖锥峰（QZ2-03）。
- [pass] 侧面视差 / 阴影 / 碰撞与可见地形一致: 人眼位置向下射线打到显示出的 L20 瓦片，距离 1.6500 m（w1 步行前后，evalAfter）。L7 眼高比显示地面高 1.644–1.647 m，步行脚底与解析地面相差 ±3 mm。阴影方向一致，侧移帧对的视差正常。
- [pass] 跳到街面后地面对齐所需时间，相机不得在地下: 热跳转 J1（1000 km→23.6147N 111.9280E 街面步行，50 ms 采样）：第一帧渲染（约 0.4 s）起显示地面就对齐了，datum −9.02 m，离地 1.72 m。粗瓦片自身误差 |Δ| 降到 0.3 m 以下用了 28.3 s（L15），到 L17 用了 37.4 s。冷启动 w2（岩坡）：datum 从 +752 到 −279 m，1269 个采样点离地都在 1.54–1.65 m，15.9 s 时 L14 对齐，20.7 s 到 L17。冷启动 w1（河岸）：datum 最大 768 m，15.4 s 对齐。另有两个 −10.5 m 采样点：相机已移到新位置但还没渲染新帧，读到的是上一帧的 chainInfo，属于采样假象。
- [pass] 步行不会被抬到粗瓦片上: w1、w2 冷启动 URL 位姿 + mode=walk，加上 W/A/D 走动：脚底减解析地面始终在 −0.003…0.000 m，而同期粗瓦片偏差最大 768 m（w*/report.json）。热跳转 J1 是步行保持，脚高 1297.92（路面）。
- [pass] 干净克隆复现构建（clone → npm ci → prep:data → build）: /private/tmp/claude-501/qa2-repro-nauqdh/web（e11e9f4，337 个文件）。npm ci rc 0，103 s，20 个包；npm 12 的 allowScripts 拦下了 fsevents 的安装脚本，不影响构建。prep:data rc 0，65 s，从仓库内的 data-src 生成，产物与提交版 sha256 一致，git status 干净。build rc 0，46 s，有 __dirname configLoader 警告和 7 条 INEFFECTIVE_DYNAMIC_IMPORT。dist 共 24 个文件 30 MB，与 4300 构建逐文件 sha256 一致。日志：shots/qa2-zoom-repro/logs/repro.log、build.log、dist-diff.txt
- [pass] dist 不含 dev 测试台: dist 里只有 index.html。/dev/terrain.html 和 /src/core/geo.js 返回 SPA 回退页（HTML 200）。
- [partial] 资产请求 / 着色器 / 控制台（克隆构建 4391）: 默认落地：29 个请求（1 document、19 script、1 css、8 fetch），全部来自 127.0.0.1，0 个失败，0 个 ≥400，15 个 worker。18 个 WebGL program 全部 LINK_STATUS 成功，没有丢 context。0 error，0 pageerror。但每一页都有 1 条 warning，即 Canvas2D getImageData 警告（QZ2-08）。repro/report-run1.json
- [pass] 6 个随机落点（seed 写在 jobs/landings.json）: 共 6 处：orbit 53.9N 60.3E；regional 57.38N 127.75E 30 km；±180° 接缝附近海面 6.67N 179.43E 30 m；极地 86.8N；富氧农田 −41.9 75.5 300 m；街面 ZR2-1.3.y2.w9-6.n1-5 门前。全部加载完成，位姿与请求逐位一致（dAlt 0），0 error，0 着色器失败；50 s 内都没 idle。repro/montage-landings.png、02-landing-street.png。regional 夜景还能看到发光的 Voronoi 路网（并入 QZ2-05）。
- [partial] 昼夜切换: 固定位姿 21.6,118.4,30 km，setTime 依次设为 2.607、14.607、2.607，solTime 都准确。两张日景帧差 meanAbs 4.85（1.0% 像素差超过 24 级），切换可逆。URL 打开的夜景与同页 setTime 夜景差 5.74（3%），结果一致。但收敛后的夜景本身观感不合格（QZ2-05）。
- [fail] 进楼与按 ID 回访: ?select=ZR2-1.3.y2.w9-6.n1-5 成功聚焦；buildingView 的 lobby、living、roof 都返回 arrived，处于步行模式，标高 273.16/276.46/285.76 m（入口 271.06 m）。回到 3000 km 轨道后，selectBuilding(id,{fly}) 飞回途中页面崩溃（QZ2-01）。Node：buildingSpecById 与 L13 瓦片里的同 ID 条目 hash 一致（c88c5fc6…），ID 稳定。新页面 ?select 回访和第二次重跑没做：槽位上限 1，被占。repro/run1/montage-building.png
- [pass] 全部书签加载（clone 上跑 capture-shots）: 40/40 都有定格：S01–S09c、S07O*、TE0–TW90、C01–C13。0 个 console error，0 次失败，0 次崩溃，每个 27–95 s。idle 上限设为 20 s，属于加载测试而非收敛测试，所以全部 NOT-IDLE。镜头构图都正确：cap-clone/montage-1.png、montage-2.png。
- [pass] 收尾: 4391 上的 vite preview 已停（端口关闭），clone 目录（145 MB）已删除，4300 未动（200）。所有浏览器都经 scripts/slot.mjs 启动，同一时间只开 1 个。
## RETEST
- Z-01: fixed — 热跳转和冷启动都做了：从第一帧渲染起，相机就在显示地面上方（离地 1.54–1.72 m），粗瓦片偏差最大 768 m 由 datum 补偿。负载 40–200 时，15.4–28.3 s 对齐，L17 用 20.7–37.4 s（a-ridge/report.json J1，w1、w2 的 report.json）。残留的过渡期现象：远处城区体块悬浮，另报为 QZ2-06；J1 第一张快帧里近处楼体埋进倾斜的粗面（a-ridge/montage-J1.png），不到 30 s。
- Z-02: fixed — 冷启动 URL 位姿 + walk，再按 W/A/D 走动：脚底减解析地面在 −0.003…0 m，粗瓦片同期最大偏离 768 m。收敛后人眼向下射线到 L20 瓦片 1.6500 m（w1-cold-walk-bank/report.json evalAfter）。
- Z-03: fixed — Node：上一轮剖面已平滑，minW 2/20/80 一致；坡度剖面 0 个折点。5 km、1 km、200 m、人眼帧都没有梳齿或三角齿。另有一个新的山峰形态问题，见 QZ2-03。
- Z-04: fixed — ZR2 河岸人眼顺河帧里两岸水线是连续直边（w1-cold-walk-bank/crop-waterline.png），1 km 帧两岸干净。上一轮对岸横看的原机位（34.86995,−105.21364）这次没补拍，原因是槽位。
- Z-05: partly — range-zr1w 在全盘上只是城区西缘一条淡淡的皱纹带（a-ridge/crop-L0-center.png）。ZR2 峡谷在白色星形城区里完全看不到（b-canyon/crop-B0-center.png）。到 1000 km 时两者都清楚。这些帧都没 idle（L1–L3）。见缺陷 Z-05。
- QR-01: not-checked — 原位姿的冷启动复现任务（jobs/q1a.json）因槽位上限改成 1 而没跑。间接证据：w1 河岸人眼帧里平面反射处于激活状态，另有 J1 街面、随机街面落点和克隆构建上 S05、S05b、S09、S09b、S09c、C13 等低空临水帧，共 11 处，都没见到城市倒挂。但 reflection.js 仍是在水面网格 onBeforeRender 里嵌套 render，设计没变。
- QR-02: fixed — capture-shots 的截图超时改成 180 s，失败截图 60 s；克隆构建上 40/40 都有定格，包括 C01、C02。次要建议没做：report.json 仍只记 error 和 pageerror，不记 warning 和失败请求；第一个书签之前的页面加载阶段错误仍会被 errors.length = 0 清掉。
- QR-03: fixed — 控制图已放进仓库的 data-src/03-control。纯净 clone 里 npm run prep:data 退出码 0，生成的 *.bin、manifest 和 canalnodes.bin 与提交版逐字节一致（logs/data-diff.txt 为空）。
- QR-04: fixed — 不带参数打开时套用 S01：−8° 122°，17,900 km，solTime 22.8，是日侧大陆，晨昏线在左（repro/01-default-landing.png）。
- QR-05: fixed — npm run build 只打包 index.html，dev/*.html 走回退页。构建日志里仍有 vite.config.js __dirname（configLoader native）警告和 7 条 INEFFECTIVE_DYNAMIC_IMPORT，只作诊断。
## DEFECTS (10)
- QZ2-01 [blocker] <lead> 渲染进程崩溃（Target crashed）：长会话后大跨度推近或按 ID 飞回时页面崩溃，9 个页面会话里出现 2 次
    repro: (1) 在 4300 上开新页面 /?clean=1&workers=6&pose=34.8685,-105.2131,17900957,0,-90,50&time=21.214，用 __MARS__.goto 依次走：1000 km (34.8685,-105.2131,1000957,0,-90,50) → 20 km (34.998034,-104.69144,21713,253,-38,35) → 5 km (34.926553,-104.980621,6728,253,-26,35) → 侧移 (34.894223,-104.968571,6728,253,-26,35) → 1 km (34.883696,-105.152451,1960,253,-18,35) → 侧移 (34.886605,-105.153535,1960,253,-18,35) → 200 m (34.874738,-105.188219,1160,253,-9,35)。每步等 waitIdle 30–166 s（不 idle），第 7 步开始约 13 s 后页面崩溃。(2) 在克隆构建（与 4300 dist 字节一致）上开 /?workers=6&select=ZR2-1.3.y2.w9-6.n1-5，再调 controls.buildingView 的 lobby、living、roof（都 arrived），然后 goto(6,-81,3e6)，最后 app.selectBuilding(id,{fly:true}) 飞回，途中页面崩溃。
    evidence: shots/qa2-zoom-repro/b-canyon/report.json（B6-200m："PAGE CRASHED"；前一步 B5-1km-lat 的状态：textures 8943、geometries 3166、每帧 61.9 M 三角形、3981 个 draw call、998 个待处理 worker 任务）
shots/qa2-zoom-repro/repro/report-run1.json（fatal "page.waitForTimeout: Page crashed"）及 logs/repro-run.log
资源增长：a-ridge 在 40 min 内 textures 386→7931、geometries 167→3316；跳回 1000 km 后仍有 7200 个 texture（a-ridge/report.json 各步 info.stats）。
当时机器有内存压力：swap 2.0/3.0 GB，另有 1–2 个浏览器在跑。
    expected: 长时间推近、侧移，以及进楼后回轨道再按 ID 回访，页面都不应崩溃；纹理和几何数量应受缓存预算约束，稳定在某个上限。
    actual: 渲染进程直接退出（不是 WebGL context loss，现有的按原位姿自动重载救不回来）。b 阶梯后面 11 步和回访验证因此全部失败。
    suggestion: 在空闲机器上跑同样的长会话，每分钟记录 performance.memory、renderer.info.memory、terrain.debugStats().gpuMB，以及 city、props 缓存和 worker 待处理结果数，看哪一项不受 cacheBytes 约束地持续增长。重点查：已有 1.8 GB 预算时纹理数为何仍一路增长；998 个待处理任务带回的 transferable 结果是否堆积在主线程；城市 batch 是否释放。给峰值内存设硬上限。
- QZ2-02 [major] <urban> ZR2 峡谷河道里有道路和住宅：路面、入口比水面低 0.2–3.4 m，行人在河里涉水
    repro: 开新页面 /?clean=1&workers=6&pose=34.86780,-105.21372,962.15,85,-2,28&mode=walk&time=21.214（南岸人眼，顺河向东），等约 90 s，看画面左侧河面。Node：node shots/qa2-zoom-repro/wetroads.mjs 34.8685,-105.2131 34.8685,-105.2051 34.8685,-105.2211 34.8685,-105.1971 34.8685,-105.2291 34.8640,-105.1891 34.872,-105.2371；node shots/qa2-zoom-repro/bspec.mjs ZR2-1.3.iu.1f3-0.n7-0
    evidence: shots/qa2-zoom-repro/w1-cold-walk-bank/W0-cold.png
shots/qa2-zoom-repro/w1-cold-walk-bank/crop-person-in-water.png（行人上半身露出水面，腿在水下，踩着一条没入水中的路缘线行走）
shots/qa2-zoom-repro/logs/wetroads-zr2.txt：6 个 L13 瓦片里，107 条路中有 21 条、共 40 个顶点落在 waterAt type 2 河道内且低于水位，最深 3.38 m。例：collector 1.3.iu.1f3:u1:-788，12 个顶点里 5 个在 957.1–959.2 m，水位 959.9 m；local v-9:245 在 34.86825,−105.21375 处 y=957.98 m，水位 959.99 m。住宅 ZR2-1.3.iu.1f3-0.n7-0（2 层，18.4×12.6 m，34.86910N −105.20994E）入口 958.09 m，水位 959.92 m，4 个角里 3 个在河道内。
    expected: ARCHITECTURE urban fix round 2 规定：河道半宽 + 15 m 内不放建筑。道路过河应改成桥（decision DB 的短跨板桥），或在岸边截断。props 的行人路线不应进入水面以下。
    actual: 道路折线直接下到河床高程，穿过河道，或顺着河道走一段。一栋住宅大半落在河里。行人生成在没入水中的人行道上，在河里行走。
    suggestion: urban：道路和地块按 hydro.waterAt(type≥2) 加安全距离裁剪，凡穿越河道的段落都标记为 bridge；同时检查 river half-width + 15 m 的建筑排除规则在这个区（1.3.iu.1f3）是否失效。props：生成行人路线时，若该处 waterAt.level 高于路面 y，就拒绝这条路线。
- QZ2-03 [major] <terrain-fn> range-zr1w 的山峰是凹坡尖顶的尖锥（像巫师帽），200 m 和 5 km 两级的天际线上都是一排针锥
    repro: 开 /?clean=1&workers=6&pose=23.630,111.921,1281,120,0,35&time=2.138（离地 200 m，朝东南偏东看山脊）；再看 /?clean=1&workers=6&pose=23.764075,111.876198,5800,163,-26,35&time=2.138 左上方的远峰。Node：node shots/qa2-zoom-repro/prof.mjs 23.5546 112.1349 110 500 50 0
    evidence: shots/qa2-zoom-repro/a-ridge/L6-200m.png
shots/qa2-zoom-repro/a-ridge/crop-L6-needles.png
shots/qa2-zoom-repro/a-ridge/crop-L4-topleft.png
shots/qa2-zoom-repro/logs/peaks-arterial.txt：峰顶 4107–4130 m（23.5546N 112.1349E），坡度离峰 2 km 处约 0.3，250 m 内升到 1.0–2.2，最后 100 m 达到 2.8（约 70°），剖面下凹、顶尖。从机位算出的解析天际线仰角 12.7°，与画面量得的约 13° 吻合，说明渲染忠实于 heightAt，问题出在地形函数本身。
    expected: 火星侵蚀后的山体：峰顶圆钝或成台、带岩屑坡；山脊改变天际线，但不出现规则的尖刺。
    actual: 多座山峰是 ridged 噪声形成的尖点：凹坡一路收成尖顶，远看像一排巫师帽，程序感很强。
    suggestion: 对大尺度 ridged 八度在接近脊顶时做凸化或圆顶处理（例如 soft-max 脊、对 1−|n| 在脊线附近平滑），或加一遍侵蚀和岩屑坡；保留本轮 gully 的频带限制修复。
- QZ2-04 [major] <terrain-render> 人眼高度看裸岩坡（ROCK_RED，strata 0.88），只见光滑沙地加多边形裂纹，看不到岩层截面、露岩和碎石
    repro: 开 /?clean=1&workers=6&pose=23.615,111.98,1500.52,270,-4,28&mode=walk&time=2.138（range-zr1w 西坡裸岩，脚下瓦片 nadir 已到 L20），等 3 min，再按 W 走几米。
    evidence: shots/qa2-zoom-repro/a-ridge/L7-eye-rock.png
shots/qa2-zoom-repro/a-ridge/L7-eye-rock-walked.png
shots/qa2-zoom-repro/w2-cold-walk-rock/W0-cold.png
sampleTerrain(23.615,111.98)：mat 3（ROCK_RED），rock 0.55，strata 0.88（shots/qa2-zoom-repro/h.mjs）。帧未 idle，还有 368 个待处理任务，但脚下瓦片已是 L20，纹理细节已经出来了。
    expected: §1：街面层要有裸露岩层、碎石和坡脚。§6：地面能看到岩壁截面、岸坎和脚下起伏。
    actual: 整片是均匀的沙色地面，带 Voronoi 裂纹和月牙形小坑，看不到岩体、岩层或碎石，与“裸岩坡”的材质判定对不上。
    suggestion: 按 rock 和 strata 权重在近地（<50 m）加岩层台阶的微几何或视差，按坡度露出岩体，并撒岩块和碎石 props；岩块尺度的高度请 terrain-fn 配合确认 heightAt 是否已经提供。
- QZ2-05 [major] <terrain-render> 30 km 夜景（已收敛）：整片城区被均匀点亮的 Voronoi 区块描边和街格网线铺满，没有暗部层次；空旷地区也是一张发光的路网格
    repro: 在与 4300 字节一致的克隆构建上开 /?clean=1&workers=6&pose=21.6,118.4,30000,330,-45,35&time=14.607（当地 22:30），waitIdle 成功；同页 setTime 依次设为 2.607、14.607、2.607，结果一致。再看随机落点 /?clean=1&workers=6&pose=57.3844675,127.7462892,30656,277,-45,35&time=12.651（ZR1 北部空旷区，当地 21:12）。
    evidence: shots/qa2-zoom-repro/repro/03-night.png（idle true，平均亮度 104/255）
shots/qa2-zoom-repro/repro/03-night-url.png（新页面结果相同）
shots/qa2-zoom-repro/repro/03-day2.png（同机位日景对照）
shots/qa2-zoom-repro/repro/02-landing-regional.png（橙色 Voronoi 路网穿过无人荒地，聚落在格子中央，不与路网相连）
    expected: §1、§5 要求亮度逐级衰减：港口冷白，车站和市民中心是亮核，住宅是细密暖光，郊外是断续的节点灯；大片暗区要留出来，单个亮核的泛光要受限，暗部保持层次。
    actual: 所有区块的描边都发亮，内部街格均匀亮成网线，整幅像一张发光的地图或调试线框，几乎没有暗部；夜景平均亮度只比日景（147）低约三成。
    suggestion: 街灯发光按道路等级、占用率和交通量加权；区块边界路和穿过荒地的走廊路要大幅压暗或断续；城市核心之外留出暗带。另请 atmosphere 复核 30 km 高度的夜间曝光提升。
- QZ2-06 [major] <city> 冷启动落到峡谷上方 200 m：38 s 时远处台地上的城区体块成团悬浮在粗地形之上，河道只是一条模糊色带
    repro: 在克隆构建上跑 capture-shots 的 C11（冷启动 /?clean=1&workers=6，goto C11，即 34.874738,-105.188219,1159.98,253,-9,35，idle 上限 20 s，38 s 时截图）；或在 4300 上开 /?clean=1&workers=6&bookmark=C11，在 20–60 s 之间观察。
    evidence: shots/qa2-zoom-repro/cap-clone/C11.png（左上方台地前，一团团体块悬在空中）
shots/qa2-zoom-repro/b-canyon/B5-1km.png（1 km 机位，datum 平移 14.5 m 仍在生效：前景红色岩鳍切进楼体）
    expected: §4 要求变焦途中建筑位置、地形轮廓和邻接关系保持连续：地形细化完成之前，体块应跟着画出来的地形走。
    actual: datum 平移只覆盖 nadir 周围 2.5 个叶块尺寸，范围外的远处地形仍是粗级；体块却按解析高程摆放，于是成团悬空，持续数十秒。
    suggestion: 所在瓦片的地形还粗于约 L12 时，体块每帧按 terrain.groundHeightAt（即画出来的地形）落座；或者基座误差超过若干米的体块先隐藏或淡出，等地形就位后再显示。
- Z-05 [major] <terrain-render> （上一轮遗留，部分修复）全盘仍看不出 ZR2 峡谷，range-zr1w 只是城区西缘一条淡皱纹带
    repro: /?clean=1&workers=6&pose=34.8685,-105.2131,17900957,0,-90,50&time=21.214；/?clean=1&workers=6&pose=23.615,111.926,17901289,0,-90,50&time=2.138
    evidence: shots/qa2-zoom-repro/b-canyon/crop-B0-center.png（白色星形城区中心看不到峡谷暗线）
shots/qa2-zoom-repro/a-ridge/crop-L0-center.png
1000 km 对照（两者都清楚）：a-ridge/L1-1000km.png、b-canyon/B1-1000km.png。全盘帧都没 idle，地形只到 L2–L3。
    expected: §6 要求全盘读得到走向；§1 要求干燥高地露出连续的赭红岩骨，山脊让建设带中断。
    actual: 全盘尺度下岩脊的明度和色相与周围几乎一样；峡谷宽度不到 1 px，被白色城区完全吞掉。
    suggestion: 把轨道级的峡谷暗线和岩脊色调对比写进 L2–L3 的纹理，按覆盖率而不是点采样，并在收敛后的全盘帧上复核。
- QZ2-07 [minor] <urban> range-zr1w 西坡住宅区一条 40 m 宽的干道沿最大坡度方向直上直下，纵坡约 24%（约 14°），行人在陡坡人行道上走
    repro: /?clean=1&workers=6&pose=23.6147093,111.9280098,1299.57,99,3,28&mode=walk&time=2.138
    evidence: shots/qa2-zoom-repro/a-ridge/J1-jump-street.png
shots/qa2-zoom-repro/logs/peaks-arterial.txt（arterial A9cjem.9ckzi.0，宽 40 m，从 23.6060N 的 1423.7 m 降到 23.6151N 的 1291.5 m，水平约 550 m）
    expected: §1 要求用同一高程生成道路纵坡、路堑和挡墙：干道纵坡应在 6–8% 以内，靠回头弯、路堑或台地化处理。
    actual: 道路完全贴着地形走，纵坡达到 24%。
    suggestion: 按道路等级限制最大纵坡，超出时改走等高线，或在路线规划阶段生成挖填方和挡墙。
- QZ2-08 [minor] <props> 生产构建每打开一页，控制台都有一条 Canvas2D getImageData 警告
    repro: 开 http://127.0.0.1:4300/?workers=6（任意页面），看控制台。
    evidence: shots/qa2-zoom-repro/repro/report-run1.json（landing 和 6 个随机落点的 log.console 里各有 1 条："Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true"）。来源：src/props/materials.js:27、262，src/props/humans.js:246、260。
    expected: §6 要求检查控制台：生产页面应 0 error、0 warning（上一轮是 0 warning）。
    actual: 每页 1 条 warning。
    suggestion: 对这几块 canvas 用 getContext('2d', {willReadFrequently: true})。
- QZ2-09 [minor] <props> 河岸广场的长椅平放在坡面上，一端陷进地面
    repro: /?clean=1&workers=6&pose=34.86780,-105.21372,962.15,85,-2,28&mode=walk&time=21.214，等 90 s，看前景两张长椅。
    evidence: shots/qa2-zoom-repro/w1-cold-walk-bank/W0-cold.png（前排长椅右侧椅腿约有一半埋进地面）
    expected: 街具贴合脚下坡面，或在坡地上加基座找平。
    actual: 长椅按单点高程水平放置，坡面上一端陷进地里。
    suggestion: 街具在落位时按四个脚点取地面高程，倾斜或垫高；坡度过大时不在该处放置。

######## QA2 #4
## SUMMARY
qa2-shots 终验（构建 e11e9f4，http://127.0.0.1:4300，1600×900，workers=6）。结论：未通过。§5 书签里只有 S08b、S09c、S07Ob、S07Oc 达标，另有 C04、C06 两个验收视点达标。S03、S04、S06、S09b、C07、C09、C10 不通过，其余部分通过。下文相对路径都以 shots/qa2-shots/ 为根。

【采集条件，必须先说明】
- 机器并不空闲。几个 QA 进程在抢浏览器槽，load avg 30–180。
- 17:05 左右 scripts/slot.mjs 的全机上限被改成 1。我从 16:56 排队到 18:47 才拿到槽，大部分书签只能单槽串行拍。
- 大多数帧在 240–300 s 内没有 idle（pending 160–990），这些帧都标了“未收敛”。已收敛的只有 S01（47 s）、S02（292 s）、S08c（291 s）。
- S09b 冷启动 30 分钟都没跑完 waitIdle，只拿到诊断帧。
- 同一会话依次打开 S07→S07b→S07s 时，页面在 S07s 处崩溃（Target crashed）。
- 时间不够，C01/C02/C03/C05/C07/C08/C09、S07s、S07c、S05b 没有自己的收敛帧。这几项只引用了 qa2-zoom-repro 的 clone 冷启动帧（20 s 未收敛，汇总在 zr/montA.png、zr/montB.png），只用来判断构图，结论里都写明了。

【第一轮问题的修复情况】
- 已修复：QS-01（盆地/台地/多汊湖已存在）、QS-03（书签依次到位）、QS-05/06（BG01、BZ5 斜拉桥带塔岛和拉索）、QS-11（航口无接缝）、QS-13、QS-14。
- 已修复：QQ-04/05/06/07/13、QP-04/05。
- 部分修复：QS-02、04、07、08、10、12，QP-01、QP-03，QQ-01、03、11。
- 未修复：QS-09、QQ-14。

【主要新问题】
- 构图问题（全部归 lead）：S04、S03、S06 的镜头主体不在画面里。S07 定格一的站台在机位身后。C10 只拍到屋面地砖，C07/C09 被邻楼遮挡。
- 世界层问题：G01 港池一圈都是 40–100 m 高的陡岸，渡站建在 47–67 m 的崖顶，S05 远岸读成一道红土墙。
- 稳定性：一次页面崩溃（S07s），一次页面卡死（S09b）。
- 画面：远景城市都是无窗、无材质的灰方盒；S07Oe 设备院里两棵树悬空；S07O 看不到闸孔出流；S08c 水幕没有撕散泡沫；S04 冰崖和浮冰不达游戏级。

【连续性】
- S08–S08c 闸孔状态完全一致：G02-D3 为 关关关开开开关。
- S09–S09c 是同一组船：渡轮 G01big106 距离依次 2917 / 313 / 544 m。
- S07O 五个视点在同一会话全部到位，拾取都是同一栋楼。
- S07/S07b 拾取为同一栋楼，门、雨棚、坡道一致。

【机位修正】
- 只有 S04 渲染验证过：heading 9、pitch +1.5、55 mm。
- 其余修正都是 Node 几何推算（未渲染），已在 bookmarkCorrections 中注明。

使用的脚本：qa.mjs（同会话序列）、proj.mjs、img.mjs、node/*.mjs。
## CHECKS
- [partial] S01 轨道主视觉: 证据：cap/S01.png（idle 47 s，已收敛）。
符合：
- 整盘入画，上下留白 9.8% / 9.4%；主内海正对镜头。
- 晨昏线偏左，夜色约占盘宽 34%。
- 细蓝青边和稀疏星空都在；散云有向左下偏移的柔和阴影（crop-S01-cloud.png）。
- ZR5 夜侧亮核内部有明暗差。
不符合：
① 银白建设带只在北岸（ZR1 分叉城带）和东岸（ZR4）成片，南岸只有零星灰斑，没有“围住”内海。
② 城区不是银白：ZR1 城区 sRGB≈126/122/121（luma 123），比周围赤岩（luma 139）还暗；3× 放大是平涂灰斑，没有街巷纹理（crop-S01-zr1.png）。
③ 赤色裂谷表现为两条笔直平行的刻槽。
④ G01 港湾在像素 (858,389)，看不出分段潮堤造成的岸线弧（crop-S01-g01.png）。
⑤ 日侧看不出齿状泊位；同一海岸进入夜侧后没有短排冷白工作灯，ZR5 岸线全是暖橙点（crop-S01-zr5.png）。
⑥ 缩到 320 px（S01-320.png）：日侧只有 ZR1 清楚，ZR4 和云混在一起，第三片几乎认不出；夜侧只有 ZR5 一个清楚亮核，ZR1 西翼只是稀疏散点。
⑦ OX1 富氧水网正好落在晨昏带里（crop-S01-ox1.png），主视觉里读不到 §1 要求的蓝色树枝。
上述问题出在世界和渲染，不是相机问题。
- [partial] S02 夜半球: 证据：cap/S02.png（idle 292 s）。
符合：
- 整盘基本是夜面；ZR1（上）、ZR4（右）、ZR5（下）三个城网围住中央大块暗水，北岸和东岸由灯点勾出。
- 亮核内部有明暗差；站间长暗段、高地背坡与深水的连续暗面都成立。
- 均匀散点底噪已经消失。
不符合：
① “日出只照亮一段球缘”只表现为一条细蓝橙边线，没有被晨光照到的地形月牙（crop-S02-limb.png；A02 左侧有明显受光的地形）。
② 夜侧地形不是“低亮可辨”：陆地 luma 均值 5.0、中位数 3.6，提亮 6 倍才看得出起伏（crop-S02-terrain-gain.png）。
③ 冷白泊位点列：只有 ZR4 海岸是偏白的色调（crop-S02-right.png），不是“短而直的冷白点列”；主港 G01（像素 928,412）只有一串很暗的暖白点（crop-S02-g01-gain.png）。
④ 球缘外右上方有一个约 14 px 的太阳白盘，会抢视线。
- [fail] S03 富氧水网: 证据：cap/S03.png（300 s 未收敛，pending 352）。
世界层：OX1 汇水盆地、带崖壁和孤丘的马蹄形赤岩台地、多汊湖都已存在，QS-01 已修复。
构图（Node 几何，与收敛无关）：
- 离地 3000 m、35 mm、俯仰 −16° 时，画面里最近的地面在 4.8 km 外。
- 出口干渠三座岩槛闸分别在 1.55 / 3.36 / 5.16 km，只有最远一座落在画面下缘。
- 近处的闸站 OX1-0.2.ix.gl-1.1-0 及堤上聚落（宿舍、维护房、农产站、冷库）都在画面以下；画面内 0 栋建筑（node/inframe.mjs）。
因此“近处的闸”“沿堤路排开白色维护房、工务塔和低层聚落”“闸孔白沫、消能区”都不在画面里，渠田只占画面下缘约 10%。
未收敛帧的观感：
- 地形是光滑的塑料感赤土。
- 湖形左右对称，像函数画出的树枝。
- 水面有一层规则斜纹（crop-S03-water.png）。
- 田区边界是一条直线硬切（crop-S03-bottom.png）。
卡片后半段（下游普通温室 → 进水阀和湿格栅，“保存最后一个机位”）没有对应书签。
- [fail] S04 冰缘省域: 证据：cap/S04.png（300 s 未收敛，pending 423）。55 mm、当地 08:00 正确。
构图：
- 书签备注的泵房 OX4-2.3.10t.m5-3.0-0 在当前世界不存在（buildingSpecById 返回 null）。
- MO-45 前池的融水泵房现在是 OX4-2.3.10t.m5-2.n1-0（73.624546, 53.327831），旁边是温室 n1-1…n1-7。它们在机位方位 6°，相机却朝 36.5°，偏出 55 mm 画幅约 12°。
- 6 km 内画面里只有左缘被裁掉一半的控制塔（node/inframe.mjs、node/ox4.mjs）。
画面：
- 冰崖占满上半幅，像抹平的石膏墙，有竖向流痕，但没有裂隙和霜面的冷暖。
- 岩脚没有接受暖色边光的玄武岩。
- 浮冰是无厚度的白色平行四边形；水边有一堆巨大的灰色平面三角块（crop-S04-right.png）；前池上有一条直线硬边的半透明面片（crop-S04-floes.png）。
修正机位已渲染验证：extra/S04-cand-h9.png（heading 9、pitch +1.5）里泵站、7 栋温室、前池、冰崖同框，近景是背风温室排，见 bookmarkCorrections。
- [partial] S05 宜居城群: 证据：cap/S05.png（300 s 未收敛，pending 350）。
符合：
- 45 mm、离水 20 m、当地 15:30。
- BG01 斜拉桥在约 2 km 处横贯中景，两座 A 形塔都立在桥岛上，扇形拉索清楚。
不符合：
① 前景没有横行渡船，只有中景一艘集装箱货船；船体是方盒，尾迹是一块扁平白色椭圆（crop-S05-ship.png）。
② 桥后没有“一层蓝色水面 → 渡站、遮阳步廊、低层公共建筑”：远岸是一道连贯的橙红土墙。Node：视线 2.8 km 处地面在 100 m 内从 0 升到 42 m；港池一圈都是 40–100 m 陡岸。
③ 天际线是一整排高度相近、无窗无材质的浅灰方盒（crop-S05-shore.png），读不出“至少三个高度和间距不同的城市中心”和中间的低层住区；铁红台地只在最左侧露出一角。
④ 远岸倒影像镜面一样清晰，没有“逐渐合并”。
- [partial] S05b 宜居城群备选（ZR5 BZ5）: 本人没有收敛帧。参考 qa2-zoom-repro 的 clone 冷启动帧（20 s 未收敛，zr/S05b-800.png）。
Node 几何：BZ5 西塔投影在 x=−55，出画，只能看到一座 H 形塔和从左缘伸进来的拉索，不满足“两处桥塔都有可见的基础或桥岛”。
前景没有渡船。机位修正见 bookmarkCorrections（未渲染验证）。
- [fail] S06 峡谷晚班: 证据：cap2/S06.png（300 s 未收敛，pending 766）。
- 相机离地 19.4 m，悬在屋顶高度（Node：脚下地面 1115.6 m）。近景是屋顶、路灯和树冠，不是站在公共露台上。
- 画面里没有近处的上层步道；河道被楼群挡住，看不到“两桥之间的河道”。
- Node（node/feat.mjs）：视场 0–6 km 内没有任何轨道和站房，只有 7 段普通街桥。
- 通勤线是本镜头的主体，站房升降核、进站列车和明暗变化全部缺失。车站 Sg1b4vvq.2（34.89003, −105.25041）在机位正东，位于相机身后。
- 远方岩壁没有错叠收口。对坡是光滑圆鼓的绛红台阶带，上面是一串串小方盒（crop-S06-cliff.png）；谷底是同一种小方盒铺满的体量模型。
符合：蓝调天空（天顶 sRGB 130/140/173，地平 179/170/146）；住宅窗光有空缺；路灯已亮。
- [partial] S07 定格一 街对面: 证据：seq/s07-S07.png（同会话第 1 个，goto true，240 s 未收敛，pending 292）。
- 眼高约 1.65 m、32 mm、当地 10:30 都正确。
- 5 个拾取点都是 ZR1-0.3.1a5.17w-n8.n6-7（20–27 m）。
- 门口雨棚、双扇玻璃门、坡道、台阶、行道树都清楚；行人已有五官和衣着；阳台植物为深绿；路面是中性深灰（sRGB 31/35/45）。
不符合：
- 站台 S9ruz39h.4 在机位方位约 310°，相机朝 114°，站台在身后。
- 立面占满全幅，没有天空和街道纵深，也看不到通往背面后勤入口的侧巷。
- Node 几何：从街对面任一点看，住宅门口与站台的夹角都 ≥80°，28–35 mm 放不下。
机位和书签与第一轮完全相同。
- [partial] S07b 定格二 入口与门厅: 证据：seq/s07-S07b.png（同会话第 2 个，goto true，2.0 s 到位）。
- 挑檐下的竖向门把、开启的双扇玻璃门、台阶和坡道在同一地坪上。
- 透过门左侧能看到信报箱墙，右侧玻璃里能看到电梯门（交通核），比第一轮好。
- 拾取 5/5 都是同一栋楼（5.5–12.4 m）。
仍然没有“双层门”（门斗第二道门）；挑檐阴影偏弱。
- [partial] S07s 楼梯: 同会话 S07→S07b→S07s：goto 返回 true（2.3 s），随后在 waitIdle 中页面崩溃（Target crashed，seq/s07.jsonl），本人没有取到画面。
另一测试员的 clone 帧（zr/montA.png 左上，未收敛）：梯段、扶手、平台窗外的邻楼都清楚，构图可用。
- [partial] S07c 定格三 二层起居室回望站台: 本人未取到画面：首个会话在 S07s 处崩溃，之后的补拍时间不够。
另一测试员的 clone 帧（zr/montA.png 右上，未收敛）：二层起居室透过推拉门能看到站房筒壳屋顶、站台和列车，低处被花池和窗框遮挡，构图符合卡片；花池植物像揉皱的纸片。
补拍会话 extra/S07d-after-S07c 中 goto('S07c') 返回 true。
- [partial] S07d 定格四 后院: 证据：extra/S07d-after-S07c.png（同会话 S07c→S07d，都返回 true；idle 上限 120 s，未收敛，pending 203）。
- 背立面能看到小窗、百叶检修口、后门雨棚、台阶扶手、自行车架，右侧低矮围合疑为垃圾收运点；窗位与楼层对齐。
- 但一棵行道树的树干正好挡在后门正前方，画面主体被遮住（行道树仍不参与视点净空检查）。
- [partial] S07O 富氧区版 定格一 检修道: 证据：seq/s07o-S07O.png（冷启动，goto true，240 s 未收敛，pending 552）。
- 控制台信息：“[controls] buildingView: building OX1-0.2.iy.gk-n7.n1-0 has no 'walkway' view”，书签走了资产锚点回退路径，最终位姿与锚点一致。
- 闸墩桥面、黄色栏杆、闸叶门架、右侧下方消力池和爬梯都清楚，上游闸池在闸叶后可见。
- 但没有开孔出流、射流和白沫，读不出 10 m 水位差和流向，无法与观察窗比对（未收敛帧）。
- [pass] S07O 富氧区版 定格二 值守入口: 证据：seq/s07o-S07Ob.png（同会话，goto true，0.7 s）。
- 值守门（玻璃门、竖把手）、雨棚筒灯、壁灯、窗内的黄色楼梯栏杆都清楚，门已在画面中（QS-04 此项已修复）。
- 拾取 5/5 都是本楼。
小问题：门旁标牌和红框告示板没有内容。
- [pass] S07O 富氧区版 楼梯: 证据：seq/s07o-S07Oc.png。
- 梯段 → 镀锌格栅休息平台 → 梯段 → 顶部门，构图清楚，水平无滚转，栏杆和踏步构造可读。
- 墙面为平涂灰色。左缘窗框处有一块破碎的条纹。
- [partial] S07O 富氧区版 定格三 控制室观察窗: 证据：seq/s07o-S07Od.png（拾取为本楼，距离 2.2 m）。
符合：控制台后方透过玻璃幕和竖梃能看到闸门线（黄色门机、启闭机、检修道）和左侧上游闸池水面。
不符合：
- 下游侧被检修道挡住，读不出水流方向。
- 三块显示器是纯青色空屏。
- 窗外正中有一根树干挡住视线。
- 前景是大片无纹理的米色铺地。
- [partial] S07O 富氧区版 定格四 背侧设备院: 证据：seq/s07o-S07Oe.png。
符合：变压器柜、卧式储罐、悬挑控制室、外挂钢梯和格栅栈桥、卷帘门、防撞柱都在，设备院可读（QS-04 此项已修复）。
不符合：两棵树的树干根部悬在设备院地面以上约 3–4 m（crop-S07Oe-trees.png），右侧沥青坡道又陡又突兀。
- [partial] S08 南台地水阶 高处斜俯: 证据：cap2/S08.png（g02-valley，2500 m、30 mm、−15°；300 s 未收敛，pending 495）。
符合：
- 六级库面逐段缩入远方，坝墙随岩肩错开，能分出上游静水、白色坝体和下游泄槽。
- 库岸有浅色旧水位带；右侧平台上有一个工作镇（crop-S08-town.png）。
不符合：
- 回头弯检修路看不到。
- 灌区只表现为左岸一排排褐色锯齿波纹和暗色块，没有绿色作物。
- 坝 6 下游陡坎是大块平面三角面，明暗分界是直线，暗部里有规则横条纹（crop-S08-ll.png）。
- [pass] S08b 50 mm 中段坝墩与起吊轨: 证据：cap2/S08b.png（300 s 未收敛，pending 344）。
- 50 mm 对准 G02-D3，7 孔之间的实体坝墩、坝顶黄色门机（起吊轨）、检修通道、路灯和升起的闸叶都清楚。
- 1–3 孔关、4–6 孔泄流、7 孔关，与 gateStates 一致。
- 泄槽水流有掺气白水。
- [partial] S08c 85 mm 闸侧格栅: 证据：cap2/S08c.png（idle 291 s，已收敛）。
符合：85 mm；格栅、边框、螺栓、螺栓下方的竖向积尘条纹、坝面气孔都清楚，底部有湿区。
不符合：左侧泄流是一片平滑的玻璃绿水幕，看不到“泡沫在流向下侧撕散”（与第一轮相同）。
- [partial] S09 东海分段潮堤 黄昏外海接近: 证据：cap2/S09.png（g01-5km，320 m、40 mm，当地 18:05；300 s 未收敛，pending 590）。
符合：
- 黄昏光色；分段堤线随浅滩转折；主航口两侧堤头有红、绿灯塔和港务塔。
- 航口和港内有渡轮、货船及尾迹；航口水面连续，没有色带接缝（crop-S09-mouth.png）。
- 堤后可见大片城区（QS-02 的城区已补上）。
不符合：
- 外海长浪不明显，侧风读不出。
- 远岸都市是灰色平涂城区纹理，前排是方盒，没有天际线；岸线是一道 40 m 红土陡坎；右侧有一大块平涂青绿色多边形（crop-S09-shore.png）。
- [fail] S09b 跟船穿过航口: cap2/report.json：冷启动 1803 s 后仍失败（timeout after 390000 ms: waitIdle S09b），页面主线程实际卡死，只拿到诊断帧 cap2/S09b.FAILED.png。
诊断帧：离水 7 m，处在红绿灯塔之间，前方是渡轮，港内远处有 BG01 桥面和崖顶城区，构图基本正确。
诊断帧的问题：
- 近景水面有大片被拖成横条的白色尾迹纹，疑为时间累积残影。
- 水面在 y≈460 处有一条横向浅色断线。
- 左侧倒影错位成硬边暗带。
- 外侧水线的冲刷、附着物和内侧靠船磨痕都无法核对；没有回望帧，“堤身遮住外海”无法验证。
同时刻数据会话里 goto('S09b') 返回 true。
- [pass] S09c 港务工作间窗外的航口: 证据：cap2/S09c.png（300 s 未收敛）。
- 控制台屏幕有实际内容（波形、海图、雷达、AIS 列表），另有纸质海图、望远镜、平行尺、台灯和座椅。
- 透过弧形玻璃能看到同一航口的对岸堤头和绿灯塔，一艘进港渡轮正驶来，灯塔已不在窗景中央（QS-13 已修复）。
- [partial] C01 区级 ZR1 公共塔: 本人未取到画面。另一测试员的 clone 帧（zr/montA.png 中左，未收敛）：公共塔簇的幕墙、白色层间带和空中花园可见。
但备注要求的“主站筒壳屋顶”不在画面里（Node：画面中心为 civic_tower ZR1-0.3.1a3.186-n1.n2-0，1 km）。
- [partial] C02 区级 S07 地面站 1 km: 本人未取到画面。clone 帧（zr/montA.png 中右，未收敛）：站房筒壳、站台、街道和住宅街区同框，构图正确。
Node：站房在 (800,436)，S07 住宅在 (541,430)。远处地形是低细节的浅色平面。
- [partial] C03 街级站前人眼（白天）: 本人未取到画面。clone 帧（zr/montA.png 左下，未收敛）：站房三筒壳、站前广场、长椅、矮柱灯、行道树和行人，构图正确。
广场铺装是否有纹理（QQ-10）在未收敛帧上无法判断。
- [pass] C04 街级站前人眼（21:30）: 证据：cap3b/C04.png（idle 上限 120 s，未收敛，pending 168）。
- 夜面真正暗下来，人工光为主：筒壳内顶有照度梯度，有吊灯、肋线灯带、LED 屏和带字形的灯箱。
- 广场上灯杆下和矮柱灯周围有可见光池。
- QQ-05/06/13 已修复。
小问题：站厅首层入口一带偏暗。
- [partial] C05 街级公共塔前广场仰望: 本人未取到画面。clone 帧（zr/montA.png 右下，未收敛）：塔身居中可见，只在左上角有一点树枝，第一轮“树冠遮住上半幅”已不存在。
眼高约 1.17 m（Node：地面 444.43 m），偏低。
- [pass] C06 建筑四面 S07 住宅正立面: 证据：cap3b/C06.png（未收敛，pending 194）。
- S07 住宅 8 层正立面、屋顶楼梯间和设备、水箱、入口雨棚都在画面中。
- 与左右邻楼靠屋面高差和各自的入口雨棚分栋。
- 阳台垂吊植物为深绿色。
小问题：三栋楼几乎是同一模块，窗内家具重复。
- [fail] C07 建筑四面 S07 住宅侧立面（北）: 本人未取到画面。
- clone 帧（zr/montB.png 左上，未收敛）：画面主体是另一栋楼的近景屋顶（空调机组、天线），看不到 S07 北侧立面。
- Node 投影：即使不被遮挡，近侧墙脚也落在 y≈899，被画面下缘裁掉。
- [partial] C08 建筑四面 S07 住宅背立面: 本人未取到画面。
- clone 帧（zr/montB.png 右上，未收敛）：背立面、玻璃楼梯井和后院可见。
- 画面下缘有一段前景屋顶的女儿墙，说明相机站在邻楼屋顶边。
- [fail] C09 建筑四面 S07 住宅侧立面（南）: 本人未取到画面。
- clone 帧（zr/montB.png 左下，未收敛）：画面主体是近处一栋楼的屋面、楼梯间和空调机组，按 Node 投影大小判断不是 S07 屋顶；南侧立面不在画面中。
- Node 投影：S07 近侧墙脚落在 y≈899，被画面下缘裁掉。
- [fail] C10 建筑屋顶 S07 住宅: 证据：cap3b/C10.png（未收敛，pending 162）。clone 帧（zr/montB.png 右下）相同。
- 画面只有屋面地砖：building view 'roof' 让人站在屋面上、俯角约 −38°，视野只覆盖脚前 1–5 m。
- 屋顶设备、楼梯间、女儿墙收边都不在画面里。
- [partial] 连续性 S07–S07d（同一建筑、门窗一致、同会话顺序访问）: 会话 1（seq/s07.jsonl）：S07 true（冷启动 19.7 s）→ S07b true（2.0 s）→ S07s true（2.3 s）→ 页面崩溃，序列中断。
会话 2（extra/S07d-after-S07c，日志 SEQ）：S07c true → S07d true。
- 拾取 S07 / S07b 都是 ZR1-0.3.1a5.17w-n8.n6-7；S07 与 S07b 的门、雨棚、坡道位置一致。
- 书签依次到位已修复（QS-03），但 S07s 处崩溃（QS2-06）。
- [pass] 连续性 S07O–S07Oe（同会话顺序访问）: seq/s07.jsonl：S07O → S07Ob → S07Oc → S07Od → S07Oe 在同一会话全部返回 true（61 s / 0.7 / 1.4 / 0.7 / 0.8 s），25 个拾取点全部是 OX1-0.2.iy.gk-n7.n1-0。
S07O 走的是回退路径（controls 不认识 'walkway'）。
- [pass] 连续性 S08–S08c 闸孔启闭: seq/data0809.jsonl：三帧的 mega.gateStates() 完全相同；G02-D3 = 关、关、关、开、开、开、关，与 S08b 画面一致。
- [pass] 连续性 S09–S09c 航口与船只: seq/data0809.jsonl：三帧是同一组船。
- 渡轮 G01big106 依次 2917 / 313 / 544 m。
- 货船 G01big107 依次 2415 / 1562 / 2259 m。
- S09c 窗外能看到进港渡轮。
- [partial] 采集与收敛条件: - 浏览器槽：16:56 起排队，18:47 才拿到；slot.mjs 全机上限期间被改成 1，其他测试员的整条链长期占槽。
- 只有 S01（47 s）、S02（292 s）、S08c（291 s）在 300 s 内 idle，其余帧 pending 160–990。
- S07O 一带 worker 队列持续增长（552 → 911 → 993）。
- S09b 页面卡死 30 min。
- 时间不够，cap3 冷启动整批 C01–C10 被我中止，只补拍了 C04 / C06 / C10（idle 上限 120 s）。
## RETEST
- QS-01: fixed — OX1 汇水盆地、马蹄形赤岩台地（崖壁和孤丘）、多汊湖都已存在（cap/S03.png）。S03 的构图问题另报 QS2-02。
- QS-02: partly — Node：G01 北岸 7×7 个 L13 块内 5629 栋建筑（354 栋 ≥20 层），有 2 座渡站；S09 堤后能看到城区。但港池一圈是 40–100 m 陡岸，渡站在 47–67 m 崖顶，S05 远岸读成一道红土墙（QS2-05）。
- QS-03: fixed — 同会话 S07→S07b→S07s 都返回 true（约 2 s），S07O→…→S07Oe 五个都返回 true，S07c→S07d 返回 true。新问题：S07s 处页面崩溃（QS2-06）。
- QS-04: partly — 入口门可见（S07Ob）；楼梯梯段·平台·梯段且水平（S07Oc）；控制室窗框和闸门线可见（S07Od）；设备院可读（S07Oe）。
检修道帧仍看不到开孔出流和水位差（QS2-15）；控制台空屏；设备院树悬空（QS2-08）。
- QS-05: fixed — BG01（G01 港内）和 BZ5（ZR5）两座斜拉长桥存在（node/bridges.mjs）。
- QS-06: fixed — S05 画面中 BG01 两座 A 形塔立在桥岛上，扇形拉索、桥面和桥墩都有。
- QS-07: partly — G01 有渡站（在崖顶），S09/S09b/S09c 有渡轮；S05 画面里仍然没有渡船，ZR5 未复测。
- QS-08: partly — Node：G02 周边 1980 个采样点中 95 个 farm>0.3（第一轮为 0）。S08 画面里灌区只是褐色锯齿条带，没有绿色作物（未收敛帧）。
- QS-09: not-fixed — S01 中 G01 位于 (858,389)，潮堤和港湾弧不可辨（crop-S01-g01.png）；轨道线带宽约 1 px，按设计也读不出来。
- QS-10: partly — S02 只有 ZR4 海岸呈偏白色调；S01 和 S02 都没有短而直的冷白泊位点列，G01 主港很暗（crop-S02-g01-gain.png、crop-S01-zr5.png）。
- QS-11: fixed — S09 航口水面连续，没有色带接缝（crop-S09-mouth.png）。
- QS-12: partly — 行人已有五官、衣着和姿态，行道树有枝干和叶簇（s07-S07.png、S07d）。新问题：S07Oe 树木悬空（QS2-08）；花池灌木是揉皱纸片状低模（QS2-23）。
- QS-13: fixed — S09c 屏幕有实际内容，补了海图、望远镜和座椅，灯塔已移出窗景中央。
- QS-14: fixed — S07O* 各有独立的回退位姿，并与 find-shots view 输出的锚点一致。
- QP-01: partly — S01 缩到 320 px：日侧 ZR1 清楚，ZR4 与云混淆，第三片很淡；夜侧只有 ZR5 一个清楚亮核，ZR1 西翼是散点。
- QP-02: not-checked — UI“存视点”重载回访不在本次书签范围内，未测。
- QP-03: partly — S07 街对面、S07Ob 和 S07Oe 的人眼视点都站在空地上，中心拾取是目标楼。S07d 被行道树干挡住后门（树仍不参与净空检查）；C07/C09 被邻楼遮挡（另报 QS2-12）。
- QP-04: fixed — 冷启动 S07、S07O：hold 为 bookmark、lifted 0，画面没有出现地下视角。
- QP-05: fixed — S01 和 S02 夜面没有均匀散点底噪，暗面连续（S02 陆地 luma 中位数 3.6）。
- QP-07: not-checked — S01 中 OX1 水网落在晨昏带里（crop-S01-ox1.png）；转台不在本次范围内。
- QQ-01: partly — S08 坝 6 下游仍有大块平面明暗和直线分界，暗部里有规则横纹（crop-S08-ll.png，未收敛帧），无法排除级联阴影的问题。
- QQ-03: partly — 阳台垂吊植物已是深绿（s07-S07.png、C06）；花池灌木仍是苍白揉皱的纸片状（extra/S06-cand-east.png、S07c 的 clone 帧）。
- QQ-04: fixed — S07 路面 sRGB 31/35/45，线性 B/R 约 2.2（第一轮约 6），在立面阴影下基本中性。
- QQ-05: fixed — C04 夜面暗，以人工光为主，不再是蓝色的“日拍夜”。
- QQ-06: fixed — C04 灯杆下和矮柱灯周围有可见光池。
- QQ-07: fixed — S06 天空：天顶 130/140/173，地平 179/170/146，呈蓝调渐变。
- QQ-10: not-checked — C03 只有 clone 未收敛帧，铺装质感无法判断。S07b 门前铺装有分缝。
- QQ-11: partly — S08 / S08b 崖面有竖向层理，看不到第一轮的“帘子三角面”；但坝 6 下游陡坎是平面大三角，S04 候选帧冰崖有竖向梳齿条纹。
- QQ-13: fixed — C04 站厅内顶有照度梯度和灯具，灯箱有字形内容。
- QQ-14: not-fixed — S01 中 ZR1 城区 luma 约 123，比赤岩（139）还暗；云顶 214，城带远低于 200–230（实测 122–169）。
- C05（第一轮书签修正）: fixed — clone 帧中只有左上角一点树枝，塔身可见；需在收敛帧上复核。
## DEFECTS (22)
- QS2-01 [major] <lead> S04 构图丢失主体：融水泵房和温室排在画面外，备注引用不存在的建筑 ID
    repro: 1) node scripts/slot.mjs -- node scripts/capture-shots.mjs --base http://127.0.0.1:4300 --only S04 --out shots/qa2-shots/cap --width 1600 --height 900 --query "&workers=6" --idle 300000
2) node shots/qa2-shots/node/inframe.mjs "73.61413,53.32391,445,36.5,4,55" 4 6000
3) node shots/qa2-shots/node/spec.mjs OX4-2.3.10t.m5-3.0-0
4) node shots/qa2-shots/node/ox4.mjs 73.625031 53.339335 600
    evidence: shots/qa2-shots/cap/S04.png; shots/qa2-shots/extra/S04-cand-h9.png
    expected: §5 04：从对岸低台地用 55 mm 看冰崖与融水站，泵站在岩脚，进水池接冰崖脚，成排温室沿背风侧延伸。
    actual: - 相机朝 36.5°，泵房 OX4-2.3.10t.m5-2.n1-0 和温室 n1-1…7 在方位约 6°，偏出 55 mm 画幅；6 km 内画面里只有左缘被裁的控制塔。
- 备注的 OX4-2.3.10t.m5-3.0-0 在当前世界不存在（返回 null）。
    suggestion: 改为 heading 9、pitch +1.5（位置、55 mm、solTime 4.445 不变），已渲染验证；备注改为 OX4-2.3.10t.m5-2.n1-0。
- QS2-02 [major] <lead> S03 构图：近处的闸和堤上聚落在画面下缘之外，画面内 0 栋建筑；卡片后半段没有书签
    repro: 1) 打开 /?bookmark=S03&clean=1&workers=6。
2) node shots/qa2-shots/node/basin.mjs（出口闸距机位 1.55 / 3.36 / 5.16 km）。
3) CENTER=7.28890,104.90804 node shots/qa2-shots/node/inframe.mjs "7.23351,104.86894,3118,35,-16,35" 5 30000（画面内 0 栋）。
    evidence: shots/qa2-shots/cap/S03.png; shots/qa2-shots/crop-S03-bottom.png
    expected: §5 03：远处赤岩台地、支谷入水口、近处的闸和下游田渠前后搭接，沿堤路有白色维护房、工务塔和低层聚落；随后下游温室到进水阀，并保存最后一个机位。
    actual: - 离地 3000 m、俯仰 −16°、35 mm 时，最近可见地面在 4.8 km 外。闸站 OX1-0.2.ix.gl-1.1-0 及聚落在 1.55 km，处在画面以下；画面里只有盆地和远处的田。
- 没有温室 / 进水阀子帧。
    suggestion: 后退 4 km：7.17812, 104.82985, 3110 m ASL，heading 35、pitch −16、35 mm，solTime 3.011（当地 10:00）。Node 投影：聚落 + 最低闸 (806,790)，中闸 (804,615)，岩槛闸 (793,504)，湖心 (821,336)（未渲染验证）。另补温室近景书签。
- QS2-03 [major] <lead> S06 相机悬在屋顶上方 19 m，画面里没有通勤线、站房、河道和两座桥
    repro: 1) 打开 /?bookmark=S06&clean=1&workers=6。
2) node shots/qa2-shots/node/ground.mjs 34.8905,-105.286,1135（离地 19.4 m）。
3) node shots/qa2-shots/node/feat.mjs "34.8905,-105.286,1135,245,-4,40" 3（视场 0–6 km 内无轨道、无站房）。
    evidence: shots/qa2-shots/cap2/S06.png; shots/qa2-shots/extra/S06-cand-east.png
    expected: §5 06：站在谷坡中层的公共露台，40 mm 沿谷轴取景；近处上层步道遮住一小部分谷底，下方河道出现在两桥之间；站房升降核把上层社区接到桥面，进站列车经过时有明暗变化。
    actual: - 近景是屋顶、路灯和树冠，谷底铺满体量小方盒，看不到河道、桥、轨道和站房。
- 最近的高架站 Sg1b4vvq.2（34.89003, −105.25041）在机位正东的身后。
- 我试的东向候选机位（34.88712, −105.2700, 1110.95, heading 98）落在楼前花池旁，被墙挡住。
    suggestion: 在第一级台阶边上另选真正的公共露台或广场（建议以 34.8871, −105.270 附近为起点），朝 85–100°：Node 显示 Sg1b4vvq.2 和高架线会同框，右侧是谷底河道。需要渲染验证。
- QS2-04 [major] <lead> S07 定格一：站台在机位身后，立面占满全幅，看不到后勤入口方向（与第一轮相同）
    repro: 1) 打开 /?clean=1&workers=6，执行 await __MARS__.goto('S07')。
2) node scripts/find-shots.mjs s07 --lat 21.8695 --lon 117.9985（站台 S9ruz39h.4 位于 21.87046, 117.99711）。
    evidence: shots/qa2-shots/seq/s07-S07.png
    expected: §5 07 定格一：从街对面取景，站台、行道树、住宅门口和独立后勤入口的方向都可辨认。
    actual: 站台在机位方位约 310°，相机朝 114°；32 mm 下立面占满全幅，没有天空和街道纵深。几何上，从街对面任一点看，门口与站台的夹角都 ≥80°。
    suggestion: 换一栋正对站台、距站台 50–80 m 的普通住宅重做 S07 系列；或者在画面里放入指向站台的导向牌，并后退、改用广角以露出侧巷。
- QS2-05 [major] <terrain-fn> G01 港池一圈都是 40–100 m 陡岸，滨水程序建在崖顶，S05 远岸读成一道红土墙
    repro: 1) node shots/qa2-shots/node/shore.mjs 0.53 129.95（各方位岸后 0 / 100 / 200 / 400 m 高程，多为 40–100 m）。
2) node shots/qa2-shots/node/ray.mjs 0.53127 129.95260 12.7 1800 4200 100。
3) node shots/qa2-shots/node/spec.mjs ZR1-0.3.1hp.sx-n1.2-0 ZR1-0.3.1ho.sw-n1.n5-0（渡站地面 47 m / 47–67 m）。
4) 打开 /?bookmark=S05&clean=1。
    evidence: shots/qa2-shots/cap/S05.png; shots/qa2-shots/crop-S05-shore.png; shots/qa2-shots/crop-S09-shore.png
    expected: §5 05 / §2 ZR1：远岸依次是渡站、遮阳步廊、低层公共建筑，临水餐廊下可见轮渡靠泊；渡站应贴近水面。
    actual: 港池北、东、西岸在 100 m 内从水面升到 40–50 m；渡站、步廊、公共前排都在崖顶，画面里是连续的橙红土墙。
    suggestion: terrain-fn 把港城岸段改为码头标高的护岸，或做台阶式下沉滨水带；urban 让渡站和码头落在水面标高。
- QS2-06 [major] <lead> 同一会话依次访问 S07→S07b→S07s，S07s 到位后页面崩溃（Target crashed）
    repro: node scripts/slot.mjs -- node shots/qa2-shots/qa.mjs shots/qa2-shots/seq/jobs-s07.json out.jsonl（第 1 个 job：/?clean=1&workers=6；每个书签 goto 后 waitIdle 240 s）。
    evidence: shots/qa2-shots/seq/s07.jsonl
    expected: §1 / §6：书签随时可接管、顺序复访；S07 系列是同一访客的连续定格。
    actual: S07 true（pending 292）→ S07b true（pending 321）→ S07s true，之后 page.evaluate 报 Target crashed，渲染进程退出。该次运行约 11 min，只复现了一次。
    suggestion: 排查长会话近景 full LOD 和室内的显存 / 内存增长，检查楼梯视点切换时是否重复建资源；用同一序列复测并记录 renderer.info.memory。
- QS2-07 [major] <lead> S09b 冷启动时页面卡死：30 min 内 waitIdle 无法完成
    repro: node scripts/slot.mjs -- node scripts/capture-shots.mjs --base http://127.0.0.1:4300 --only S09b --out <dir> --width 1600 --height 900 --query "&workers=6" --idle 300000
    evidence: shots/qa2-shots/cap2/S09b.FAILED.png; shots/qa2-shots/cap2/report.json
    expected: 书签冷启动后能在合理时间内细化并取帧。
    actual: report 记录 1803 s 后报 “timeout after 390000 ms: waitIdle S09b”，rAF 几乎不推进。诊断帧里近景水面有横向拖影状的白色尾迹纹，y≈460 处有横向断线。
    suggestion: water / props 排查离水 7 m 时平面反射、尾迹和累积的单帧耗时；先抓一份 profile 确认原因。
- QS2-08 [major] <props> S07Oe 设备院里两棵树悬空，树干根部离地 3–4 m
    repro: 打开 /?clean=1&workers=6，执行 await __MARS__.goto('S07O')，再依次 goto 到 'S07Oe'；或直接 /?bookmark=S07Oe&clean=1。
    evidence: shots/qa2-shots/seq/s07o-S07Oe.png; shots/qa2-shots/crop-S07Oe-trees.png
    expected: 树根落在实际地面（设备院或场坪）上。
    actual: 两棵树的根部（带根颈膨大）悬在墙前半空，下面什么都没有。疑为树按自然地形高程放置，而设备院是 meta.pad 下挖的场坪。
    suggestion: 树的落地高程用最终地面（含 pad / 场坪 / 碰撞体），落在建筑场坪范围内的树剔除或下移。
- QS2-09 [major] <city> 远景城市体量是无窗无材质的浅灰方盒（S05 天际线、S06 谷底、S09 远岸）
    repro: 打开 /?bookmark=S05&clean=1、/?bookmark=S06&clean=1、/?bookmark=S09&clean=1。
    evidence: shots/qa2-shots/crop-S05-shore.png; shots/qa2-shots/cap2/S06.png; shots/qa2-shots/crop-S09-shore.png
    expected: §6：全场景游戏级资产；远景城群仍可读体量、色彩和立面（§5 05 的陶瓷暖边、玻璃反射天空和水面）。
    actual: 2–5 km 的塔群是同色浅灰挤出体，没有窗格、幕墙和陶瓷质感，读成一排等高方盒；10 km 以外只剩平涂的城区纹理。帧未收敛，但这个距离本来就由体量模型负责。
    suggestion: 体量 LOD 加立面窗格 / 幕墙图集、楼冠和屋顶色差，并保持与近景同材质的亮度和颜色。
- QS2-10 [major] <lead> C10 屋顶视点只拍到脚下的屋面地砖
    repro: 打开 /?bookmark=C10&clean=1&workers=6。
    evidence: shots/qa2-shots/cap3b/C10.png
    expected: C10 备注：屋顶设备、楼梯间与屋面收边。
    actual: building view 'roof' 让相机站在屋面上、俯角约 −38°，28 mm 视野只覆盖脚前 1–5 m 的地砖。
    suggestion: C10 去掉 view:'roof'，改用现有回退位姿 21.86915, 117.99925, 590, 283.67, −60, 28（未渲染验证）；或保留视点并设 viewPitch −10、viewLens 24。building-kit 可同时检查 anchors.cameras.roof 的俯角。
- QS2-11 [major] <lead> C07 / C09 侧立面被邻楼屋顶遮挡，墙脚落在画面下缘之外
    repro: 1) 打开 /?bookmark=C07&clean=1 与 /?bookmark=C09&clean=1。
2) node shots/qa2-shots/proj.mjs "21.869821,117.9993328,580.86,193.67,-30,28" 1600 900 21.8692811,117.9990700,540（墙脚 y≈899）。
    evidence: shots/qa2-shots/zr/montB.png（qa2-zoom-repro 的 clone 未收敛帧，左上 C07、左下 C09）
    expected: 整面侧立面，从墙脚到屋面收边。
    actual: 画面主体是近处另一栋楼的屋面（空调机组、天线、楼梯间），S07 侧立面不可见；即使不被遮挡，墙脚也会被画面下缘裁掉。
    suggestion: 按 controls 的人眼视点净空逻辑重新放置（避开邻楼占地，抬到约 60 m 离地，俯角约 −35°），并在收敛帧上复核。
- QS2-12 [major] <water> S07O 检修道帧看不到开孔出流和白沫，读不出 10 m 水位差和流向
    repro: 打开 /?clean=1&workers=6，执行 await __MARS__.goto('S07O')，等待 240 s。
    evidence: shots/qa2-shots/seq/s07o-S07O.png
    expected: §5 07 富氧区版：检修道上看见水位和水流方向，与观察窗所见吻合（卡片备注：右侧约 11 m 下的消力池与开孔出流）。
    actual: 消力池是一片平静的灰绿水面带蓝色条纹，没有射流、水跃和白沫（帧未收敛，pending 552，sluicejet 可能没有加载）。
    suggestion: 确认 sluicejet 对该站开孔闸的射流和尾水泡沫在冷启动后一定会生成，并纳入 isIdle。
- QS2-13 [major] <megastructures> S08c 泄槽水幕平滑，看不到泡沫在流向下侧撕散（与第一轮相同）
    repro: 打开 /?bookmark=S08c&clean=1&workers=6，等待 idle（约 290 s）。
    evidence: shots/qa2-shots/cap2/S08c.png
    expected: §5 08：泡沫在流向下侧撕散，水珠只附着在溅水面。
    actual: 左侧水幕是均匀的玻璃绿平面，只有轻微模糊，没有撕裂的白沫条带。
    suggestion: mega_water 在 85 mm 近距下增加掺气撕裂带、飞沫和贴壁水膜细节。
- QS2-14 [major] <terrain-render> S08 坝 6 下游陡坎是大块平面三角面，明暗为直线分界；灌区读不出绿色作物
    repro: 打开 /?bookmark=S08&clean=1&workers=6，等待 300 s，看画面左下。
    evidence: shots/qa2-shots/crop-S08-ll.png; shots/qa2-shots/cap2/S08.png
    expected: §5 08 / G02：坝下崖坡有岩层和体积感，沿途灌区落在台肩上，读得出耕地。
    actual: 坝下是几块平整的大斜面，暗区边界是尺子般的直线，暗部有规则横纹；左岸台地是一排排锯齿波纹；灌区只是褐色暗块（帧未收敛，pending 495）。
    suggestion: terrain-render 检查这一机位的地形细分和远级联阴影；terrain-fn 和 terrain-render 让灌区在区域尺度呈现作物色和田块。
- QS2-15 [major] <terrain-render> S04 冰崖像抹平的石膏墙，浮冰是平面白片，水边有巨大的灰色三角块
    repro: 打开 /?bookmark=S04&clean=1&workers=6，或打开 /?pose=73.61413,53.32391,445,9,1.5,55&time=4.445&clean=1。
    evidence: shots/qa2-shots/cap/S04.png; shots/qa2-shots/crop-S04-right.png; shots/qa2-shots/crop-S04-floes.png; shots/qa2-shots/extra/S04-cand-h9.png
    expected: §5 04 / O03：冰层裂隙和霜面偏冷，岸边细碎浮冰给出尺度，冰、水、玻璃各自保留高光宽度。
    actual: - 冰崖是光滑的白色曲面，有竖向梳齿条纹和一条横向裂缝线。
- 浮冰是无厚度的白色平行四边形（water）。
- 右侧水边有一堆平涂的巨大三角面。
- 前池上有直线硬边的半透明面片。
两帧都未收敛。
    suggestion: 冰崖材质加入裂隙、层理和霜面冷暖变化；浮冰改成有厚度的碎冰网格；排查三角块和面片属于哪个系统（建议开 debug=objectId）。
- QS2-16 [minor] <lead> 缺少卡片要求保存的子帧书签
    repro: 查看 src/app/bookmarks.js 的 SHOTS。
    evidence: src/app/bookmarks.js
    expected: §5 03“保存最后一个机位”；04 走近服务入口；06 相机降到站台；09 回望时堤身遮住外海。
    actual: S03、S04、S06 只有开场帧；S09 没有回望帧（mega 已有 g01-ship-in 视点，但没有挂书签）。
    suggestion: 补 S03b 温室进水阀、S04b 服务入口、S06b 站台、S09b2 回望（g01-ship-in）等书签。
- QS2-17 [minor] <controls> S07O 的 'walkway' 视点 controls 不认识，书签走资产锚点回退路径
    repro: 打开 /?clean=1&workers=6，执行 await __MARS__.goto('S07O')，看控制台。
    evidence: shots/qa2-shots/seq/s07.jsonl（infos：[controls] buildingView: building OX1-0.2.iy.gk-n7.n1-0 has no 'walkway' view）
    expected: buildingView 支持 buildings-o 新增的视点名（walkway / control / gate）。
    actual: 回退到 resolveBuildingView 后最终位姿正确，但不走 controls 的落位和遮挡检查流程。
    suggestion: buildingView / buildingViews 读取资产 anchors.cameras 的全部键，不只认标准 7 个。
- QS2-18 [minor] <buildings-o> S07Od 控制台显示器是纯青空屏；S07Ob 标牌和告示板没有内容
    repro: 打开 /?bookmark=S07Od&clean=1 与 /?bookmark=S07Ob&clean=1。
    evidence: shots/qa2-shots/seq/s07o-S07Od.png; shots/qa2-shots/seq/s07o-S07Ob.png
    expected: 控制室屏幕有闸位和水位画面（参照 S09c 的 mega_screen）；标牌有站名。
    actual: 三块屏是均匀的青色平面；门旁铭牌是空白灰板，红框告示板是空白反光面。
    suggestion: 复用 megastructures/screens.js 的屏幕图集，或 z_common 的 signContent。
- QS2-19 [minor] <props> S05 前景没有渡船；货船是方盒，尾迹是扁平白色椭圆
    repro: 打开 /?bookmark=S05&clean=1&workers=6。
    evidence: shots/qa2-shots/crop-S05-ship.png
    expected: §5 05：前景一艘横行渡船，尾迹逐渐展宽。
    actual: 当地 15:30 机位前景无船；中景货船是平板船身加方块集装箱，尾迹是一块白色椭圆贴片。
    suggestion: props 提升货船和渡船资产并改用 water.addWake 尾迹；lead 按渡轮时刻表选择有渡船横穿前景的时间。
- QS2-20 [minor] <atmosphere> S02 夜侧地形几乎全黑，晨光球缘只有一条细线
    repro: 打开 /?bookmark=S02&clean=1&workers=6，然后执行 node shots/qa2-shots/img.mjs stats shots/qa2-shots/cap/S02.png 480 160 150 140。
    evidence: shots/qa2-shots/crop-S02-terrain-gain.png; shots/qa2-shots/crop-S02-limb.png
    expected: §5 02：夜侧地形低亮但可辨，少量斜射晨光先抓住高台边缘；日出只照亮一段球缘。
    actual: 陆地 luma 均值 5.0、中位数 3.6；东缘只有大气细线，没有受光的地形月牙。
    suggestion: atmosphere 提高夜侧地形的可辨亮度；lead 可把 S02 的 solTime 改为约 18.0，让晨昏线落到东缘以内约 7°（计算值，未渲染验证）。
- QS2-21 [minor] <water> S03 湖面整片规则斜纹
    repro: 打开 /?bookmark=S03&clean=1&workers=6，放大湖面。
    evidence: shots/qa2-shots/crop-S03-water.png
    expected: 湖面在 3 km 高处应是自然的风浪和反射，没有规律条纹。
    actual: 整个湖面覆盖等间距的斜向细条纹（帧未收敛，pending 352）。
    suggestion: 检查 3 km 高处的波浪法线 mip / 抗混叠；在收敛帧上复核。
- QS2-22 [minor] <building-kit> 花池里的灌木是苍白揉皱的纸片状低模
    repro: 打开 /?pose=34.88712,-105.2700,1110.95,98,-3,40&time=1.989&clean=1；或打开 S07c。
    evidence: shots/qa2-shots/extra/S06-cand-east.png; shots/qa2-shots/zr/montA.png（右上 S07c 的 clone 帧）
    expected: 花池植物与行道树同等级，有叶片和深绿色调。
    actual: 花池灌木是灰绿色的折纸状大面片，像揉皱的纸团（阳台垂吊植物已正常）。
    suggestion: 花池灌木改用 props 的叶簇材质或叶片植株。
## BOOKMARK CORRECTIONS
- S04: pose 73.61413, 53.32391, 445 m ASL（离地约 12 m）, heading 9, pitch +1.5, 55 mm time solTime 4.445（当地 08:00，不变） — 已渲染验证（extra/S04-cand-h9.png）：泵房 OX4-2.3.10t.m5-2.n1-0、7 栋温室、MP-45 前池和冰崖同框，近景是背风温室排。原机位朝 36.5°，主体全部在画幅外。备注同步改为 OX4-2.3.10t.m5-2.n1-0。
- S03: pose 7.17812, 104.82985, 3110 m ASL（离地约 3000 m）, heading 35, pitch −16, 35 mm time solTime 3.011（当地 10:00） — 沿 215° 方向后退 4 km。Node 投影：闸站和堤上聚落 (806,790)，中闸 (804,615)，岩槛闸 (793,504)，湖心 (821,336)，台地在上部，使卡片“近处的闸 + 下游田渠 + 远处台地”前后搭接。未渲染验证（浏览器槽时间不足）。
- S05b: pose -38.3725, 103.18, 24 m ASL, heading 352, pitch 0.5, 50 mm time 不变 — 原 heading 0 时 BZ5 西塔投影在 x=−55，出画。改为 352° 后两座 H 形塔约在 x 265 / 1335。Node 计算，未渲染验证。
- S02: pose 不变 time solTime 约 18.0 — 按太阳几何，solTime 17.0 时晨昏线在可见东缘之外约 8°，只剩大气细线；18.0 时晨昏线约在 180°E，东缘以内约 7° 会出现受光的地形月牙，符合“日出只照亮一段球缘”。未渲染验证。
- S06: pose 待定：第一级台阶边（约 34.8871, −105.270，地面约 1109 m）附近的真正公共露台 / 广场，heading 85–100, pitch −2…−3, 40 mm time solTime 1.989（当地 18:58，不变） — 原机位离地 19 m 悬在屋顶上方，画面里没有轨道和站房。Node：朝东时高架站 Sg1b4vvq.2 和高架线同框，谷底河道在右侧。我试的 34.88712, −105.2700, 1110.95, heading 98 落在楼前花池旁被墙挡住（extra/S06-cand-east.png），需在附近找空旷的露台再验证。
- S07: pose 相机无法修正：需要换楼 time  — 站台在机位身后，从街对面任一点看，门口与站台的夹角都 ≥80°。建议换一栋正对站台、距离 50–80 m 的普通住宅，并同步重导 S07b–S07d、C06–C10。
- C10: pose 21.86915, 117.99925, 590 m ASL, heading 283.67, pitch −60, 28 mm（去掉 buildingId / view，用现有回退位姿） time 不变 — 当前 view 'roof' 让人站在屋面上俯拍脚下地砖（cap3b/C10.png）。回退位姿在屋面以上约 25 m 俯视，楼梯间、设备和女儿墙都会入画。未渲染验证；也可以保留视点并设 viewPitch −10。
- C07: pose 同 lat/lon，抬到约 600 m ASL（离地约 60 m），pitch −35，或沿视线反向后退 20 m time 不变 — clone 帧显示画面被邻楼屋顶占据；Node 投影显示近侧墙脚落在 y≈899，被画面下缘裁掉。未渲染验证。
- C09: pose 同 C07：抬高到约 60 m 离地，pitch −35，并避开南侧邻楼占地 time 不变 — clone 帧中画面主体是南侧邻楼的屋面，S07 南立面不可见。未渲染验证。
