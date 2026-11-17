# Acceptance QA round 1 (build 13cc425) — full defect texts

Testers: #1 qa-quality (QQ-*), #2 qa-shots (QS-*), #3 qa-identity (QA-ID-*), #4 qa-style (QY-*), #5 qa-zoom (Z-*), #6 qa-assets (QA-ASSETS-*), #7 qa-spot (QP-*), #8 qa-repro (QR-*).
Evidence paths are under web/shots/qa-*/. NOTE: the "invisible mid-range mass" known issue was later proven NOT a renderer bug (urban green belt) — see notes/city.md "Fix round 1b".


## ADDENDUM (qa-spot #7, arrived after fix round 2 started) — owners, include these:
- controls: QP-02 saved building views (roof / 2F living) revisit to wrong places after reload; QP-03 eye-level views (street/back)
  placed at fixed offsets without occlusion checks (camera inside the neighbour across the street / behind, or behind a tree);
  QP-04 cold-start revisit: coarse terrain + buildings 20–30 m above the held camera for ≥ 45–65 s (with terrain-render R1).
- terrain-render: QP-05 orbit night "suburb dots" not tied to any parcel (DN); QP-06 objectId/province debug layers at orbit are lit
  and exposed (must be flat unlit ID colours, cities/parcels with ID colours); QP-07 O-zone blue dendritic canal networks unreadable
  at the full disc / 320 px (O zone reads as random olive patches) — canal trees + farmland shades must read at orbit.
- atmosphere: QP-08 switching time by ±12 h drifts the cloud field one way (15 → 3 → 15 does not restore the clouds): the cloud field
  must be a deterministic function of sol time.
- lead: QP-01 S01 recomposition (three day-side city areas + two night cores at 320 px).
- water: QR-01 (qa-repro, major) — during street-level landing the city and street trees intermittently hang UPSIDE DOWN above
  the camera (1 of 2 loads): suspected planar-reflection mirror camera / matrices leaking into the main pass → isolate the
  reflection pass state completely (camera, projection, clipping planes, shared uniforms, layers) and restore it every frame.
- atmosphere (city-mass request): shadowed upward surfaces get only sky SH irradiance → asphalt/paving in building shadow read
  deep blue (16,31,57); add a city bounce fill (sunlit façades + pavement reflecting into shadowed ground/streets).
- urban (city-mass request): green belts keep a full local street grid (5.9 km of road per tile) → reads like "buildings not
  loaded"; make belts contiguous green (parks, pitches, woods) with natural edges and only a few paths/collectors.
- city (city-mass, done): street faces were culled (wound downward) — fixed in 2d1…; streets now draw within ~1.3 km.
- lead (done in f666ec8): QR-02 screenshot timeouts, QR-03 prep:data in a clean clone, QR-04 default landing, QR-05 dev benches.

######## QA #1
## SUMMARY
qa-quality（§6 最佳画质 + 抽查 5 最终显示变换）验收结论：未通过，有 11 个 major、4 个 minor 缺陷，没有 blocker。测试对象为 4300 端口上的生产构建，默认 ultra 画质，视口 1600×900。共做了 6 次 capture({scale:2})，输出 3200×1800：C03、C04、C06、S07d、C05、S06 蓝调，以及 S01 的 2× 定格。两次运行共拍 30 余张截图，并复用了 qa-shots 和 qa-spot 的书签截图。环境说明：测试期间本机 load avg 约 140–345，同时有 4 个浏览器在跑，所以所有视角都没有达到 waitIdle，worker 一直有 74–285 个待处理任务。截图延迟 23–41 s，因此“相隔 0.5 s”的两帧做不到真正的 0.5 s。

通过的项：
- 两次运行控制台 0 error、0 pageError。
- 白天所有画面没有剪切，亮度最大 205–227；阳光下的白陶瓷在 2× 下保留板缝和细微纹理。
- 天空和雾的渐变有抖动，没有色带。
- 2× 定格拼块无接缝。
- S08 在 0.01° 微移后，山脊稳定。

主要问题：
- 远级联阴影：S08 出现阴影痤疮（acne）条纹，阴影边界是尺子般的直线。
- 女儿墙共面 z-fighting：5 cm 微移后条纹整体换位。
- 建筑自带的绿植（材质 plant，albedo 约 0.5）呈苍白青色团块。
- 沥青路面呈饱和藏蓝。
- 夜间：曝光锁在 EV +3.09，蓝色环境光把城市照成“日拍夜”；路灯在 C04 不照亮地面；蓝调时刻和夜空是泥褐色。
- 近景资产：行人是低模人偶，树皮像素化，广场铺装是无纹理平板，S08 崖壁贴图纵向拉伸。

诊断数据：三角面 1.5M（轨道和 S08）到 132M（城区），draw calls 211–2626，GPU 每帧 77–1811 ms，2× capture 每张 32–95 s。

关于已知问题：S06 日景远坡呈苍白空地，只有零散方块，可能就是已知的 mass 不显示问题，因此没有单独报。C02 1 km 视角的远处体块是显示的。
## CHECKS
- [pass] 白色外壳保留亮部纹理（无剪切平白）: 白天所有画面都没有剪切：C03 亮度最大 210，C06 205，S07d 212.6，C02 17:30 227，clipAny 约 0%。A-S07d-x2 中阳光下的白陶瓷立面在 2× 下可见板缝和细微纹理（cropS07dx2-a.png）；C06 屋面在 2× 下有防水卷材纹理和设备（cropC06x2-roof.png）。例外：C03 广场铺装是无纹理平板，单列为 QQ-10；C04 的灯箱是均匀 195 的白块，单列为 QQ-13。
- [partial] 窗内有进深: 正立面窗内是真实室内，有家具、窗帘、顶灯，2× 下楼板对位（cropC06x2-roof.png，A-S07.png）。不过 C06 几乎每扇窗里都是同样的书桌和显示器布局。背面厨房窗内是模糊的方块（cropS07dx2-a.png）。C05 的幕墙塔只反射均匀天色，看不到邻楼和街树（cropC05x2-a.png，QQ-15）。
- [partial] 山脊不闪烁（两帧微移比较）: S08 在 0.01° 航向微移前后两帧（B-S08-A/B）比较：diff meanAbs 1.1，p99 10，只有 0.37% 的像素差异超过 16 级，山脊轮廓稳定（diff-S08-AB.png）。但受机器负载影响，第二帧在移动后约 23 s 才截下（不是 0.5 s），连续平移序列也因截图超时没有拍成，所以运动中的爬行闪烁没能真正验证。S06 的同类测试被流式细化干扰：同一位姿下画面在几分钟内大幅变化（mont-S06-ABCD.png），无法用于判断闪烁，详见 S06 稳定性一项。
- [partial] 远岸与薄雾层次分明: S08：远处平原逐级淡入地平雾，六级库面前后层次可读。S09（qa-shots 截图）黄昏时堤线和远岸城带分得开。S06 日景远坡在约 1.5–2.5 km 处呈低反差浅灰（p5–p95 为 144–169），几乎没有地形和色彩信息，疑与已知的 mass 不显示问题有关，未单独报。S05（qa-shots 截图）近岸山体是粗 LOD 大面片，该帧不确定是否已细化完成。
- [partial] 夜光保留亮核边界与内部反差: S02 轨道视角（qa-spot 截图）：光网有白色亮核和暗水面，边界清楚。街面 C04：玻璃竖梃边缘清晰，但站厅内部是均匀自发光面（QQ-13），广场被蓝色环境光整体照亮、没有灯光光池（QQ-05、QQ-06）。C02 0:00 时窗光点在蓝色楼体上反差不足（QQ-05）。
- [pass] 天空/雾无色带: 逐列取样：S06 蓝调天空每 10 px 变化 1–2 级且平滑；C04 夜空、qa-shots 的 S06/S09 黄昏、C03 白天天空都没有可见台阶，输出端有三角抖动。问题在色彩而不在色带（蓝调时刻呈泥褐色，QQ-07）。
- [fail] 无 z-fighting / 闪烁: C06：相机每次平移 5 cm，S07 住宅屋顶女儿墙内侧和前景低屋面边上的深色块状横纹都会整体换位（mont-ztC06.png，mont-zbC06.png；diff meanAbs 16.6，39% 像素差异超过 16 级），见 QQ-02。地形、水面与道路在测到的画面里没有闪烁。
- [fail] 无阴影痤疮 / peter-panning: 街面：行人、护栏柱、长椅的接触阴影是贴合的，C03、S07d 没有看到漂浮。S08 坝下谷底的阴影里有规则水平条纹，阴影边界是不随地形的直线，太阳在相机后方，判断为 CSM 级联边界（QQ-01）。
- [partial] 无纹理游移: C06 平移 5 cm、S08 转动 0.01° 前后，立面、地形纹理和图案都是随几何整体移动的，没有看到滑动（z-fighting 区域除外）。连续平移序列因截图超时没拍成，长距离平移下是否游移未验证。
- [partial] 色调映射/曝光：黎明/正午/黄昏/夜: 各时段曝光读数（EV）：C02 正午 -0.80，17:30 +1.04，18:20 +2.76，19:00 +3.09，0:00 +3.09；S07 06:50 +1.86；C03 -0.24；C04 +3.09。黎明（S07）与 17:30、18:20 读感正常，暖色日落、蓝色阴影都合理。正午 C02 偏平偏灰（城市像素中位数 90）。轨道日面偏暗（QQ-14）。夜间曝光锁死在 +3.09，与白天只差约 3.9 EV，造成蓝色“日拍夜”（QQ-05）。蓝调和夜空呈褐色（QQ-07）。C02 06:50 一帧截图超时，没有拍到。
- [pass] 高分辨率定格 capture({scale:2}): 6 张 3200×1800 定格全部成功，每张 32–95 s：A-C03-x2、A-C04-x2、A-C06-x2、A-S07d-x2、A-C05-x2、B-S06blue-x2，另有 B-S01-x2。S01-x2 在 x=1599/1600 和 y=899/900 两条拼缝处，相邻像素梯度与旁边的列、行相同（约 10 和 4），没有接缝。2× 下屋面设备、板缝、栏杆都能分辨，色调与屏幕显示一致。
- [partial] 抽查 5 尺度与锐度（最终显示变换下）: 轨道：城市纹理偏软偏灰（S01、B-S01-x2）。区域：S08 的坝、闸孔、检修路可读；崖壁贴图拉伸（QQ-11）。街面：台阶、护栏、柱墩、门窗构造清楚，门高、栏杆等比例合理；但行人是低模人偶（QQ-08）。特写：树皮像素化、叶片卡拉伸（QQ-09），广场铺装无材质（QQ-10）。低反差薄雾、窗内层次只在白天达标，夜间被蓝色环境光压平。
- [partial] S06 书签画面稳定性（观察，待分诊）: 同一位姿（34.893,-105.24,1175,253,-5,40）在 15:00 落地后的画面（B-S06day-A）中，相机像是在近楼旁约 40 m 高处。几分钟后（B-S06day-C/D，航向只变了 0.01–0.046°）却变成在屋顶上方很高处俯看整片城区和远处拱站。qa-shots 冷启动截的 S06 则像是站在屋顶露台上。Node 端 heightAt 显示相机正下方地面 1120.6 m，相机离地 54 m，这与 D 帧一致。远坡地形也从平滑浅色逐步细化成深红条纹台地。原因未能定位，可能是流式细化加上机器负载导致的，请 controls/city/lead 分诊；证据为 mont-S06-ABCD.png。
- [pass] 诊断数据（stats，仅记录）: 三角面：城区 39M–132M，S08 1.5–2.4M，S01 1.3M。draw calls 211–2626，GPU 每帧 77 ms（S01）到 1811 ms（C02 黄昏）。所有视角都没有 idle，worker 一直有 74–285 个待处理任务，原因是本机 load avg 约 330、同时有 4 个浏览器。两次运行控制台 0 error / 0 pageError。原始数据在 shots/qa-quality/reportA.json 和 reportB.json。
## DEFECTS (15)
- QQ-01 [major] <atmosphere> S08 地形远级联阴影：痤疮（acne）条纹 + 不随地形的直线阴影边界
    repro: 打开 http://127.0.0.1:4300/?clean=1&workers=3，执行 __MARS__.goto('S08')，等 4–6 min（本机未 idle）后截图，看画面左下最低一级坝下的谷底；A、B、C 三帧都存在。
    evidence: shots/qa-quality/B-S08-C.png; shots/qa-quality/cropS08C-ll.png (x0–800,y450–900 放大 2×); shots/qa-quality/cropS08C-acne.png (x60–420,y700–900，色阶拉伸 40–140); shots/qa-quality/B-S08-A.png
    expected: 阴影随遮挡地形起伏，阴影区内无规则条纹。当地 16:30 太阳在相机身后（相机朝向 68°），投影应指向画面深处。
    actual: 坝下左侧的大块阴影里有 4–6 px 间距的规则水平暗纹（acne）。阴影边界是从两侧坝肩伸向相机的尺子般直线，左侧一条斜线、右侧另一条直线，把亮橙和暗紫一刀切开，不随地形变化，判断为 CSM 级联或光锥覆盖范围的边界。
    suggestion: 远级联加 slope-scaled 或 normal-offset bias；级联之间做混合，最后一级在覆盖范围外逐渐淡出；相机离地数公里时，远处改用地形自阴影，或扩大最后一级的覆盖范围。
- QQ-02 [major] <building-kit> 屋顶女儿墙内侧/屋面边共面 z-fighting（5 cm 微移即整体换位）
    repro: 执行 __MARS__.goto('C06')，idle 后截图。然后执行两次 const p=__MARS__.pose(); __MARS__.app.rig.setPose({...p, lat:p.lat+5e-7})（每次约 5 cm），每次等 800 ms 后截图。
    evidence: shots/qa-quality/mont-ztC06.png (S07 住宅屋顶女儿墙 x480–1140,y128–168，A/B/C 三帧); shots/qa-quality/mont-zbC06.png (前景低屋面 x600–1000,y835–885，A/B/C 三帧); shots/qa-quality/cropC06x2-parapet.png; shots/qa-quality/cropC06x2-parapet2.png; shots/qa-quality/B-C06-A.png
    expected: 相机静止或微移时表面稳定，泛水、压顶与墙面之间有实际厚度差。
    actual: 女儿墙内侧和屋面泛水上出现深灰块状横纹。相机平移 5 cm，条纹位置整体改变：前景屋面区域 diff meanAbs 16.6，39% 的像素差异超过 16 级，属于典型的共面 z-fighting。前景低屋面（C06 相机正下方那栋建筑，疑为站房）也有同样现象。
    suggestion: 去掉重复的共面面片，或让泛水、压顶偏移 ≥2–3 cm，或加 polygonOffset。前景那栋建筑用 debug=objectId 确认归属；如果是 buildings-z 自己生成的屋面，需要同步修。
- QQ-03 [major] <building-kit> 阳台吊篮/花池/屋顶花园植物（材质 plant）呈苍白青黄半透明团块
    repro: 执行 __MARS__.goto('C06') 看立面阳台；屋顶树可在 S06 用 setTime(22.016) 后看画面右上。
    evidence: shots/qa-quality/cropC06x2-bal.png; shots/qa-quality/cropC06x2-roof.png; shots/qa-quality/A-C06.png; shots/qa-quality/B-S06day-A.png
    expected: 绿植为深绿色（albedo 约 0.05–0.15），有叶片明暗和自阴影，与 props 的行道树一致。
    actual: 阳台和屋顶的绿植呈苍白的青蓝、黄绿色柔边团块，亮度接近立面本身，像鬼影或污渍；屋顶树像灰青色的棉球。对应 src/buildings/materials.js 中 plant: c 0xb8c8a8（albedo 约 0.5）。
    suggestion: 把 plant 底色降到 0x3d5a2a 左右，并加叶片法线和 AO；或者直接复用 props 的树叶图集和材质。
- QQ-04 [major] <city> 沥青路面在白天阴影中呈饱和藏蓝色
    repro: 执行 __MARS__.goto('S07')（当地 10:30），看前景路面；C06 画面左下同样可见。
    evidence: shots/qa-quality/A-S07.png (y760–850 路面 sRGB 约 32,52,85，路缘 12,35,48); shots/qa-shots/cap7/S07.png; shots/qa-quality/A-C06.png
    expected: 中性深灰：材质设定 c=0.092,0.09,0.087，roughness 0.95。同一场景天光下立面为 115,123,138，线性 B/R 约 1.5。
    actual: 路面线性 B/R 约 6，看上去像刷了蓝漆的路；06:50 时同一路面又是灰蓝色。只靠天空光解释不了这种偏色，疑为高光、环境反射过强，或 bump 让法线朝向天空。atmosphere 在 fix1 中已提过同样的请求，仍未解决。
    suggestion: 核查街道材质实际的 roughness、envMapIntensity 和 specular，限制掠射角的菲涅尔；改完在 S07 实测，路面应接近中性。
- QQ-05 [major] <atmosphere> 夜间曝光 +3.09 EV 加夜空环境光，城市成蓝色“日拍夜”，暗部失去层次
    repro: 执行 __MARS__.goto('C02')，再 __MARS__.setTime(16.133)（当地 0:00），等待后截图；或打开 C04（21:30）。
    evidence: shots/qa-quality/A-C02-0000.png; shots/qa-quality/mont-C02-night.png; shots/qa-quality/A-C02-1900.png; shots/qa-quality/A-C04.png
    expected: 深夜由窗光、路灯和站厅亮核主导，楼体多数处在暗部，保留暗隙和层次（§1“让同一片大陆入夜”，§5 02“暗部保持层次”）。
    actual: 夜间曝光锁在 EV 3.09（正午 -0.80，两者只差约 3.9 EV）。蓝紫色的夜空环境光把所有立面和广场都照亮：C04 广场是均匀的 36,49,84，C02 0:00 整片楼体像月光下一样清晰可读，窗光点缺少反差。
    suggestion: 地面层夜间降低 NIGHT_AMBIENT，或把夜间曝光提升上限控制在 +1.5–2 EV，让人工光源成为主光；夜间不要用 local exposure 提亮大面积暗部。与 QQ-06 一起调整平衡。
- QQ-06 [major] <props> C04 夜景路灯与地灯不照亮地面（无可见光池）
    repro: 执行 __MARS__.goto('C04')（21:30），看站前广场和台阶。
    evidence: shots/qa-quality/A-C04.png; shots/qa-quality/cropC04x2-a.png; shots/qa-quality/cropC04x2-b.png
    expected: 灯杆、地灯、檐下筒灯在广场和台阶上形成可见的光池和明暗过渡。
    actual: 灯头和地灯帽本身是亮的，但周围地面没有任何光池，广场和台阶完全靠均匀的蓝色环境光。C02 夜景的大道上能看到光池，说明站前广场和近距离没有生效，或者强度过低（tiles.js 中光池强度为 0.42 window units）。
    suggestion: 提高近景光池的强度和半径，广场、台阶、檐下也要布置；配合 QQ-05 降低环境光。
- QQ-07 [major] <atmosphere> 蓝调时刻和夜空呈均匀泥褐/赭黄色，S06“蓝调时刻”不成立
    repro: 执行 __MARS__.goto('S06')（书签时间，当地 19:09），看天空；对照 C04 和 C02 setTime(11.133)。
    evidence: shots/qa-quality/B-S06blue.png (天顶 95,75,73，地平 135,101,75); shots/qa-quality/A-C02-1900.png; shots/qa-quality/A-C04.png (夜空 43,30,15); .refs/Z04-canyon.jpg
    expected: S06 蓝调时刻应是天顶深蓝紫、地平粉橙的渐变（Z04）；深夜城市上空只在地平附近有光晕。
    actual: 天空从天顶到地平都是泥褐到赭黄，完全没有蓝色分量，城市天光主导了整片天空；夜间 C04 仰角约 30° 处仍是平板褐色。
    suggestion: 降低 city sky glow 在高仰角的贡献，保留暮光散射的蓝色分量，在 S06 书签时刻对照 Z04 校色。
- QQ-08 [major] <props> 行人为无贴图的低模人偶（抽查 5 街面看构造与人）
    repro: 执行 __MARS__.goto('C03') 或 'S07'，看前景行人；或用 capture({scale:2}) 截图后放大。
    evidence: shots/qa-quality/cropC03x2-a.png; shots/qa-quality/A-S07.png; shots/qa-quality/A-C03.png
    expected: 游戏级人物，有面部、手、衣褶、鞋，能作为 1.7 m 的比例参照。
    actual: 人物由胶囊和方块拼成，脸是没有五官的肤色球，脚是黑色方块，全身纯色、无纹理；在 C03 和 S07 前景非常显眼。
    suggestion: 换成带贴图的中模人物，至少给面部、手、衣服加上纹理、法线和几种体型变化。
- QQ-09 [major] <props> 行道树近景：树皮贴图方块像素化，侧视叶片卡拉成长条
    repro: 执行 __MARS__.goto('S07d')，用 capture({scale:2}) 截图；S07 和 C05 同样可见。
    evidence: shots/qa-quality/cropS07dx2-b.png (树干); shots/qa-quality/A-S07d.png (x380–450,y450–650 与 x1230–1330,y100–200); shots/qa-quality/A-C05.png
    expected: 人眼高度下树皮有可分辨的材质纹理，叶簇看不出卡片边缘。
    actual: 树干纹理放大后是明显的方块，像低分辨率贴图或最近邻采样；侧视的叶片卡被拉成长条带。C05 的树冠遮住上半幅画面，叶片是平涂的卡通片。
    suggestion: 提高树皮纹理分辨率，使用线性 mip 和各向异性过滤；侧视的叶卡做按视角淡出，或用更多交叉面片。
- QQ-10 [major] <city> C03 站前广场铺装是无纹理的浅灰平板
    repro: 执行 __MARS__.goto('C03')，再用 capture({scale:2}) 截图。
    evidence: shots/qa-quality/A-C03.png (y720–900 的 28.8 万像素中有 25.0 万落在同一个 16 级区间); shots/qa-quality/cropC03x2-a.png
    expected: 近景铺装有板缝、色差和磨损（§3 材质样板，§6 亮部保留纹理）。
    actual: 广场约占画面四成，在 2× 定格下仍是均匀浅灰平面（亮度中位数约 182），没有接缝和颗粒，只有阴影形成明暗差。
    suggestion: plaza 材质加入石材或地砖的板缝纹理、法线和粗糙度变化，并按距离做细节层级。
- QQ-11 [major] <terrain-render> S08 峭壁贴图纵向拉伸成“帘子”，三角面片可见
    repro: 执行 __MARS__.goto('S08')，看最低一级坝右侧的崖壁。
    evidence: shots/qa-quality/cropS08C-ll.png (x1100–1560,y430–600); shots/qa-quality/B-S08-C.png
    expected: 崖面有岩层截面纹理和三向投影材质，绕到侧面能看出立面厚度（§1）。
    actual: 竖直崖面上的纹理沿坡向拉成竖条梳齿，单个三角面片清晰可见，看上去像挂着的帘子。
    suggestion: 陡坡改用 triplanar 采样加岩层带，并在这个距离提高几何细分。
- QQ-12 [minor] <atmosphere> GTAO 在细竖梃与远背景交界处产生模糊黑斑
    repro: 执行 __MARS__.goto('C03')，idle 后截图，再执行 __MARS__.set('ao', false) 后截图对比。
    evidence: shots/qa-quality/mont-ao.png (上：AO 开，下：AO 关；x700–1100,y150–290); shots/qa-quality/cropC03x2-b.png
    expected: 接触处只有轻微的环境遮蔽，不出现脏污斑块。
    actual: 站房幕墙竖梃顶端与壳顶交界处出现明显的模糊黑斑，关掉 AO 后消失。
    suggestion: GTAO 加厚度启发式和深度差衰减，减弱细物体对远处背景的遮蔽晕圈。
- QQ-13 [minor] <buildings-z> 站房夜间室内是均匀自发光平面，灯箱是平板白块
    repro: 执行 __MARS__.goto('C04')，再用 capture({scale:2}) 截图。
    evidence: shots/qa-quality/cropC04x2-a.png; shots/qa-quality/cropC04x2-b.png; shots/qa-quality/A-C04.png (灯箱 x620–980,y420–444 均匀为 195)
    expected: 站厅亮核有灯具、照度衰减和明暗层次。
    actual: 站厅内墙是均匀的米黄发光面，看不到灯具，照度也没有变化；灯箱是没有内容的平板白块。
    suggestion: 室内改用灯具发光加照度衰减，或让 interior mapping 带照度梯度；灯箱加上文字或纹理。
- QQ-14 [minor] <atmosphere> 轨道日面曝光偏暗、反差偏低（锁定基线约有 1 EV 未用）
    repro: 执行 __MARS__.goto('S01')，截图并用 capture({scale:2})。
    evidence: shots/qa-spot/cap/S01.png; shots/qa-quality/B-S01.png; shots/qa-quality/B-S01-x2.png
    expected: 银白城带接近亮部（sRGB 约 200–230）且不剪切，盘面有 A01 那样的反差和饱和度。
    actual: 日面陆地亮度中位数约 119，城带约 160–170，云最高约 210；锁定曝光 EV -0.76，盘面发灰发闷。
    suggestion: 轨道基线曝光提高 0.5–0.8 EV，或在 AgX look 中提高中间调对比；改后用 S01 和转台复核云顶不剪切。
- QQ-15 [minor] <atmosphere> 幕墙玻璃只反射均匀天色，看不到邻楼和街树
    repro: 执行 __MARS__.goto('C05')，再用 capture({scale:2}) 截图。
    evidence: shots/qa-quality/cropC05x2-a.png; shots/qa-quality/A-C05.png
    expected: 玻璃同时保留街树和邻楼的反射，以及窗内进深（§3）。
    actual: 塔楼幕墙是一致的蓝色，只有天空环境反射，没有局部反射，像哑光蓝漆。
    suggestion: 近景加入屏幕空间反射，或使用局部探针、平面反射；至少让环境图包含城市剪影。
## BOOKMARK CORRECTIONS
- C05: pose  time  — “塔底广场仰望公共塔”这个视角里，前景行道树的树冠遮住了上半幅画面，公共塔被挡住一半，无法作为验收视角。建议把相机移出树冠下方几米，或调整航向，并重新确认构图。

######## QA #2
## SUMMARY
qa-shots 验收了 commit 13cc425 生产构建（127.0.0.1:4300）上 §5 镜头卡 01–09 的全部 23 个书签。方法：capture-shots 冷启动每书签一页；自写 playwright 复拍并做拾取 / gateStates / boatsNear；Node 世界采样。下文相对路径都以 shots/qa-shots/ 为根。

采集条件：机器严重过载（load avg 300–380，3 个浏览器槽位被约 8 个 QA 进程轮流占用）。所有书签在 190–330 s 内都没有达到 waitIdle（pending 35–234）。S07d 两次截图超时，未取到画面。凡受此影响的结论都在备注里写明；S04、S07Oc/Od/Oe、S08b/S08c、S09 系列做了第二轮复拍或数据核对。

结论：23 个书签没有一个能完整满足卡片。S07s、S07c、S08b 基本通过；S07b、S07O、S08、S08c、S09、S09b、S09c 部分通过；S01–S06b、S07、S07d、S07Ob–S07Oe 不通过。

阻断项：
- S03 需要的“汇水盆地＋赤岩台地”在 OX1 不存在（terrain-fn）。
- 东海港北岸 10 km 内没有城市，S05 远岸为空，S09 堤后只有一条细带（urban）。
- 全星没有长桥 / 细索桥（urban 规则，city 结构）。
- S06/S06b 拍不到峡谷。
- 富氧区版 S07O 的视点锚点不可用（buildings-o）。
- 同一会话里连续打开第二个建筑视点书签时返回 false，相机停在面墙的回退位姿（controls）。
- S04 机位落在温室群中被挡住。
- S01 里看不出 G01 潮堤；S01/S02 夜侧没有冷白港灯。

连续性：
- S08–S08c 同一座坝 G02-D3，三帧闸孔状态一致（通过）。
- S09–S09c 是同一航口、同一组船，渡轮 G01big106 距离依次为 2917 / 313 / 544 m（通过）。
- S07、S07c 拾取到的都是 ZR1-0.3.1a5.17w-n8.n6-7；S07d 未取到画面。

按已知问题要求，未报告 ZR1 体量模型在 300 m–3 km 不可见一项。r/S06-cand.png 未收敛，城块只剩树，与该问题症状相同，没有作为证据使用。
## CHECKS
- [fail] S01 轨道主视觉｜晨昏线上的城市大陆: cap/S01.png（190 s 未 idle）。符合：整盘入画，上下留白约 9.8% / 9.4%；东内海正对镜头；晨昏线偏左，约 31% 盘宽入夜；细青边与稀疏星空。
不符合：
① 银白建设带没有“围住”钴蓝内海。南岸、西岸是赤土和沙色，北岸 G01 一带无城（crop-S01-g01.png），银灰只在东北 ZR1 和东缘成斑块。
② 分段潮堤造成的港湾弧度不可辨，G01 只占 1–2 px（QS-09）。
③ “赤色裂谷切开建筑密集区”只表现为两条细暗线。
④ 同一海岸进入夜侧后只有稀疏暖橙点，没有短排冷白工作灯；外围暖色团块很暗（crop-S01-night.png，QS-10）。
⑤ 缩到 320 px（S01-320.png）只能认出 1 片日侧城区，两个夜间亮核认不出来，抽查 1 不过。
相机与时间本身正确，不需要修改。
- [fail] S02 夜半球｜从灯光辨认地形和城市功能: cap/S02.png（200 s 未 idle）。符合：日出只照亮东侧一段球缘，保留大部分夜面；西内海暗水居中，有岸线灯点勾边；ZR2 星芒城网亮核内部有明暗。
不符合：
① 没有“主港”。全部灯光是暖橙，看不到工作泊位的短直冷白点列，西内海沿岸也没有港城（crop-S02-a.png）。
② 整块陆地均匀撒满细小暖点，富氧区“两站之间很长一段黑暗”和高地背坡“连续暗面”都不成立。
③ 夜侧地形几乎全黑，不是“低亮但可辨”。
已试候选：东内海夜面 r/S02-candEast.png，把 ZR1、ZR4、ZR5 三个城网放在大块暗水周围，更符合卡片，见 bookmarkCorrections。冷白港灯在候选里仍然缺失（QS-10）。
- [fail] S03 富氧水网｜从流域落到田埂: cap/S03.png（234 s 未 idle）：整幅是极模糊的地表色块加几个白点，没有天空。
构图：35 mm、俯仰 −24° 时画面上缘在水平线下约 8°，远景不可能入画。
世界内容（Node）：
- 视线 0–6 km 为农田，之后是 40–190 m 的平地，一直到 24 km。
- 没有湖或盆地水面；mesa = cliff = 0。
- 视线楔形内有闸：2.2–2.9 km 处 Lr3 支渠 8 级阶梯闸，3.3–6 km 处 120 m 宽干渠 4 座闸。
汇水盆地、自然岸线、远处赤岩台地、支谷入水口都无法入画，见 QS-01。
- [fail] S04 冰缘省域｜工务设施如何适应高纬: 首帧 cap/S04.png（229 s 未 idle）：冰崖还是平滑斜坡，路灯和工务车悬在天上（站在解析地形的冰崖顶，显示地形仍是粗网格）。第二轮 r/S04-long.png 里不再出现，判为加载期瞬态，未单列缺陷。
第二轮 r/S04-long.png（300 s）：建筑加载后，机位前 34–96 m 的温室排（OX4-2.3.10u.m5-n7.0-*，方位 30–96°）挡住约 2/3 画面。
- 书签备注的泵房 OX4-2.3.10t.m5-3.0-0 在 810 m 外的前池对岸，被温室挡住；机位身后 53 m 还有另一座 meltwater_pump。
- 冰崖呈粉白色“石膏墙”，没有裂隙和霜面冷色，顶部有一个深色矩形缺口（未收敛，仅记录）。
- 书签 alt 426.5 低于地面 432.6 m，被抬到 433.6 m，离地约 1 m。
“从对岸低台地看冰崖与泵站、温室沿背风侧、远处无人冰缘衬托人工池岸”均未达到。修正见 bookmarkCorrections。
- [fail] S05 宜居城群｜从水上看见多座城市连成岸带: cap/S05.png：前景有渡船与尾迹（尾迹是一条细直白线，展宽不明显）。
不符合：
① 没有细索桥，也没有桥塔或桥岛（QS-05 / QS-06）。
② 远岸是 G01 港湾北岸的光秃赤色陡坡（约 1 km 处 cliff = 0.99），没有渡站、遮阳步廊、低层公共建筑（QS-02）。
③ 只有一个塔簇，在山坡后 10 km 外，不是“沿岸至少三个高度和间距不同的城市中心”。
④ 赤红台地在城市前面，而不是“背后仍见”。
⑤ 远岸地形模糊，带大片斜向暗纹和棋盘纹；倒影是硬边镜像（crop-S05-shore.png，未 idle）。
已试候选 r/S05-candA.png（ZR5）：远岸 2.5 km 起连续建成，有三处塔簇，红丘在后；但仍无桥、无渡船，岸线是港棚和仓库（QS-07）。
- [fail] S06 峡谷晚班｜一条通勤线在蓝调时刻亮起: cap/S06.png：机位离地 54 m，悬在屋顶露台上方。前景是屋顶设备、广场和行道树冠，视线被完全挡住。
看不到：谷轴、两桥之间的河道、远方岩壁、1 km 外的 Sg1b4vvq.2 高架站（34.89003, −105.25041）、轨道和列车。
符合：蓝调光色和住宅有空缺的窗光基本对。
Node：此处谷底宽 2 km 以上（960–975 m），北侧为 110–150 m 的台阶陡坎；河宽 83 m，在视线 3.5 km 处；河上有多座 250–830 m 的普通街桥。修正见 bookmarkCorrections。
- [fail] S06b 峡谷晚班｜台阶边缘露台俯看谷底河道: cap/S06b.png：离地 151.6 m，正下方是 968 m 的谷底，不是“高出台面约 15 m 的露台”，画面是航拍式的密集低层街区俯视。
说明里的“河从左下斜穿到画面中央”不存在：视线 10 km 内不经过河道；河在右侧约 12°、8.7 km 处，被楼群遮挡。
无桥，无“远方岩壁错叠收口”，无列车。
- [fail] S07 普通建筑｜定格一 街对面: cap7/S07.png（未 idle）。中心与门口拾取都是 ZR1-0.3.1a5.17w-n8.n6-7（住宅，22 m）。眼高约 1.65 m、32 mm、当地 10:30 都正确；门口雨棚、坡道、行道树清楚。
不符合：
- 站台 S9ruz39h.4（21.87046, 117.99711）在机位西北 208 m，机位朝 114°，站台在身后。
- 立面占满全幅，没有天空和街道纵深。
- 后勤入口在背面（spec back，offset −2.43），画面里没有通往后院的侧巷。
“站台与独立后勤入口的方向”都无法辨认。
人物是方块人偶，树冠是粗糙卡片（QS-12）。
- [partial] S07b 普通建筑｜定格二 入口与门厅: cap7/S07b.png。符合：挑檐阴影、竖向门把、开启的双扇玻璃门、台阶侧面和坡道栏杆在同一地坪；透过门能看到信报箱。门、雨棚、坡道位置与 S07 立面一致。
缺：透过门看不到交通核（只见门厅尽头一扇门）；“双层门”（门斗两道门）只有一道。
同一会话里先打开 S07 再打开 S07b 时，goto 返回 false，相机没有到入口（QS-03）。
- [pass] S07s 普通建筑｜楼梯（定格二→三之间）: cap7/S07s.png：已建楼梯间、扶手、休息平台窗外的邻楼都清楚，层高与踏步比例合理。
- [pass] S07c 普通建筑｜定格三 二层起居室回望站台: cap7/S07c.png：二层起居室（沙发、茶几、地毯、电视柜）朝 WNW 窗外，能看到车站拱形屋顶和站台雨棚顶；较低处被阳台花池和树冠遮挡，符合卡片。拾取 3 点都是同一栋 n6-7（4 m）。
小问题：阳台和室内盆栽像揉皱的纸片；窗外正对一盏路灯灯头。
- [fail] S07d 普通建筑｜定格四 后院: 未取到画面。capture-shots 冷启动 279 s 后 page.screenshot 超时；复跑时 goto 返回 false，214 s 未 idle 后截图再次超时（runC.log）。
厨房小窗、垃圾收运道、检修口与楼层平面对齐都无法核对。机器过载可能是原因，不能定论为代码问题。
- [partial] S07O 富氧区版｜定格一 检修道: cap7/S07O.png：检修道、黄色栏杆、闸门框、闸墩和水位藻带清楚，构造接近 O02 套件。
问题：闸孔里的水是一块平滑灰蓝面，看不出 11.1 m 的上下游水位差（164.98 / 153.87）和北向水流，开孔下方也没有白沫。“检修道上所见水位与流向”无法建立，也就无法与观察窗比对。
- [fail] S07Ob 富氧区版｜定格二 值守入口: cap7/S07Ob.png：锚点已解析（alt 164.24、hdg 250.8），但画面只是一面开了两扇窗的空墙，值守入口门不在画面里（QS-04）。
- [fail] S07Oc 富氧区版｜楼梯: 第一轮截图超时。复拍 r/S07Oc.png（同页第一个 goto 成功，拾取到 OX1-0.3.11t.x8-n1.1-0，8 m）：仰拍墙面、梯段底面和黄色栏杆，窗框在画面里倾斜约 30°，读不出梯段与平台（QS-04）。
- [fail] S07Od 富氧区版｜定格三 控制室观察窗看闸池: 冷启动 cap7/S07Od.png（锚点解析为 alt 168.3、hdg 269、pitch −9.5）：没有观察窗窗框，画面是一块深色三角形雨棚和一条伸向远处的白色渠堤，看不到闸池水面，无法与检修道所见水位、流向比对（QS-04）。
复拍 r/S07Od.png（同页第 2 个书签）：goto 返回 false，相机停在 5 个 S07O* 共用的回退位姿，正对一面墙（QS-03 / QS-14）。
- [fail] S07Oe 富氧区版｜定格四 背侧设备院: 冷启动 cap7/S07Oe.png（alt 162.3、hdg 148）：画面是近在咫尺的混凝土斜面和一根深色梁，读不出设备院（QS-04）。
复拍 r/S07Oe.png：goto 返回 false，相机同样停在回退位姿面墙。
- [partial] S08 南台地水阶｜六级库面逐段缩入远方: cap/S08.png（g02-valley，30 mm，离地 2014 m，未 idle）。符合：六级库面沿谷逐级缩入远方；坝体随岩肩错开；第一、二级库岸有浅色旧水位带；右侧台肩上有一个小工作镇。
缺：
① 沿途没有任何灌区：G02 周围 78×110 km 内农田采样为 0（QS-08）。
② 回头弯检修路表现为浮在坡面上的白色细折线（crop-S08-a.png，地形未细化，可能是瞬态）。
③ 各级之间的下游出水白沫在此距离几乎看不见。
④ 谷壁像模糊的沙丘，没有赤岩台地层理（未收敛，仅记录）。
- [pass] S08b 南台地水阶｜50 mm 中段坝墩与起吊轨: cap/S08b.png：50 mm，G02-D3 七孔；闸墩、坝顶黄色门机、检修通道、路灯清楚。1–3 孔关闭、4–6 孔泄流、7 孔关闭，与 gateStates 一致。
泄槽水流偏平，像贴图。另：45 s 复拍 r/S08b-b.png 的库面和山体还没加载（瞬态），未用作证据。
- [partial] S08c 南台地水阶｜90 mm 闸侧格栅: cap/S08c.png（85 mm，拾取为“G02-D3 闸侧格栅”）。符合：格栅、螺栓、竖向积尘条纹、溅水面湿斑可见。
缺：左侧泄流是一片平滑的浅绿白水幕，看不到“泡沫在流向下侧撕散”。
- [partial] S09 东海分段潮堤｜黄昏从外海接近主航口: cap/S09.png。符合：黄昏；分段堤线随浅滩转折；宽航口里有渡轮和货船；堤段上有闸房和灯塔。
不符合：
① 航口水面有一条笔直色界：堤外是蓝色浪面，堤内是紫褐镜面，沿堤线延长线硬切（crop-S09-seam.png，QS-11）。
② 远岸都市只是地平线上一条细白带：港湾北岸在 9 km，上岸后 6 km 无建筑，城区在 15–22 km，看不出工程保护的港区范围（QS-02）。
③ 外海长浪不明显。
- [partial] S09b 东海分段潮堤｜跟船穿过航口: cap/S09b.png（离水 7 m，35 mm）。符合：位于红、绿两座航口灯塔之间，前方 313 m 的渡轮 G01big106 正在进港；灯塔有倒影。
未达到：远岸左侧是光秃赤色山体，右侧城区低平；堤外水线的冲刷与附着物在此距离读不到；没有回望帧，无法验证“堤身遮住外海”。
- [partial] S09c 东海分段潮堤｜港务工作间窗外的航口: cap/S09c.png（拾取为“G01-S5 港务塔·港务工作间”）。符合：窗外能看到航口、绿色灯塔和驶来的渡轮。
小问题：红白灯塔正挡在窗景中央；4 台显示器是斜条纹占位贴图，室内空荡（QS-13）。
- [partial] 连续性 S07–S07d 同一建筑与门窗: 拾取结果：S07 中心与门口、S07c 三点都是 ZR1-0.3.1a5.17w-n8.n6-7；S07c 的窗朝 WNW，与正立面朝向 283.67° 一致。
S07b 的门、雨棚、坡道位置与 S07 一致。S07d 未取到画面，后院一侧无法核对。
- [pass] 连续性 S08–S08c 闸孔启闭: S08、S08b、S08c 三帧的 mega.gateStates() 完全相同。S08b 与 S08c 都对准 G02-D3：拾取分别为“G02-D3 4号溢流孔（泄流）”和“G02-D3 闸侧格栅”。D3 状态为关、关、关、开、开、开、关，与 S08b 画面一致。
- [pass] 连续性 S09–S09c 航口与船只: 三帧同一时刻，props.boatsNear() 是同一组船：渡轮 G01big106 在 S09 距 2917 m，S09b 距 313 m（正前方），S09c 距 544 m；货船 G01big107 依次 2415 / 1562 / 2260 m。S09b 与 S09c 看到的是同一航口和同一对红绿灯塔。
- [partial] 采集与收敛条件: 23 个书签首轮都在 190–280 s 内未 idle（pending 35–234），复拍到 300 s 仍未 idle；S07d、S07Oc 首轮截图超时。原因是 load avg 300+、多 agent 争用 3 个浏览器槽位。
模糊地形、悬浮道具和路线这类可能属于瞬态的现象，只写在备注里，没有单列缺陷。
## DEFECTS (14)
- QS-01 [blocker] <terrain-fn> OX1 没有汇水盆地和赤岩台地，S03 镜头卡在世界里无法成立
    repro: 1) 打开 /?bookmark=S03&clean=1&workers=3。
2) 在 web/ 下运行：node shots/qa-shots/node/regionmap.mjs 4.5 9.5 102 108.5 0.02 out.png 800（统计 mesa=0、cliff=0）。
3) node shots/qa-shots/node/mesascan.mjs -20 22 70 150 0.1 1 out.png。
4) node shots/qa-shots/node/ray.mjs 7.215 104.86 35 25 1000 100。
    evidence: shots/qa-shots/cap/S03.png ; shots/qa-shots/node/ox1-mid.png ; shots/qa-shots/node/ox1-mesa.png
    expected: §5 03：约 3 km 高、32–40 mm 斜看汇水盆地，远处赤岩台地、支谷入水口、近处闸和下游田渠前后搭接，自然岸线随地势弯曲。§2 OX1：台地泄水进入蓝色多汊湖。
    actual: - OX1 腹地（4.5–9.5N、102–108.5E）mesa=0、cliff=0，是 0–390 m 的平缓低地。
- 开阔水面只有 1–11 m 深的海相潟湖和指状河口（如 6.3–6.9N、105.55–105.95E），没有多汊湖或盆地。
- 赤岩台地只在 OX1 西北（72–100E、8–21N），距这些水面 500 km 以上；水面与台地相距 30 km 以内的组合只出现在南纬 15–17° 的海岛上。
- S03 视线 0–6 km 为农田，之后是 40–190 m 平地，延伸到 24 km。
- 闸是有的：Lr3 支渠 8 级阶梯闸，120 m 宽干渠 4 座闸。
    suggestion: 在 OX1 闸站网附近（例如 6–8N、104–106E）生成有天然弯曲岸线和支谷入水口的多汊湖或汇水盆地。同时让 O 区赤岩台地在盆地边缘保留：目前台地权重在 OX1 低地被 oBasin 整体压掉（relief.js tab = zoneO·(1−oBasin)，field.js 中 ob 含 +0.6·wOX1）。改完后由 lead 重定 S03 机位。
- QS-02 [blocker] <urban> 东海港（G01 港池）北岸 10 km 内没有建成区，S05、S09 的远岸都市缺失
    repro: 1) 打开 /?bookmark=S05&clean=1 与 /?bookmark=S09&clean=1。
2) Node：node shots/qa-shots/node/ray.mjs 0.56 129.92 15 25 1000 100。
3) node shots/qa-shots/node/ray.mjs 0.445302 129.894483 62.49 30 1000 120。
4) node shots/qa-shots/node/bridges.mjs 0.62 129.97 3（7×7 个 L13 块里 0 栋建筑、0 个码头）。
    evidence: shots/qa-shots/cap/S05.png ; shots/qa-shots/crop-S05-shore.png ; shots/qa-shots/cap/S09.png
    expected: §5 05：远岸依次出现渡站、遮阳步廊、低层公共建筑和退入腹地的塔群，沿岸至少三个城市中心。§5 09：把远岸都市放在堤后，能直接看出工程保护的港区范围。§2 ZR1：多个核心沿岸相连。
    actual: - S05 视线约 1 km 处是 38 m 高的陡岸（cliff 0.99），往内 10 km 覆盖率为 0；第一批建筑在 10 km 外，是 10–23 m 的低层。
- S09 视线上，港湾北岸在 9 km，上岸后 9–15 km 无建筑，城区在 15–22 km（平均高 21–25 m），画面里只是地平线上一条细白带。
- G01 港内只有 props 的渡轮浮码头。
    suggestion: 让 ZR1 城市带延伸到 G01 港池岸线：前排是港务和码头区、渡站与滨水步廊，向腹地依次升高到几个有间距的塔簇。
- QS-04 [blocker] <buildings-o> 富氧区版 S07O 的建筑视点锚点不可用：值守入口不见门，控制室看不到闸池，设备院对着斜面，楼梯画面倾斜
    repro: node scripts/slot.mjs --slots 4 -- node scripts/capture-shots.mjs --base http://127.0.0.1:4300 --only S07O,S07Ob,S07Od,S07Oe --out <dir> --width 1600 --height 900（每书签新页面）。S07Oc 用 shots/qa-shots/qa.mjs shots/qa-shots/jobsC.json 复拍。建筑为 OX1-0.3.11t.x8-n1.1-0（sluice_station）。
    evidence: shots/qa-shots/cap7/S07Ob.png ; shots/qa-shots/cap7/S07Od.png ; shots/qa-shots/cap7/S07Oe.png ; shots/qa-shots/r/S07Oc.png ; shots/qa-shots/cap7/S07O.png
    expected: §5 07 富氧区版：依次是检修道、值守入口、楼梯、控制室观察窗、背侧设备院；观察窗看到的闸池边缘，要与检修道上看见的水位和水流方向吻合。
    actual: 以下锚点都已解析（最终位姿与回退位姿不同），但帧未 idle：
- entrance（alt 164.24、hdg 250.8）：只拍到一面开了两扇窗的空墙，门不在画面。
- control（alt 168.3、hdg 269、pitch −9.5）：没有观察窗窗框，画面是深色三角雨棚和一条伸向远处的白色渠堤，看不到闸池水面。
- back（alt 162.3、hdg 148）：画面是近在咫尺的混凝土斜面。
- stair：拾取到本楼（8 m），但画面倾斜约 30°，读不出梯段。
- walkway：闸孔水面是平滑灰蓝面，看不出 meta.sluice 的 164.98/153.87 水位差和北向水流。
    suggestion: 按 sluice_station 的入口表（control / main 在前，equipment 在右，maintenance 在后）和 meta.water（poolSide back）重新生成锚点：entrance 对准值守门，control 站在控制室内朝闸池窗，back 站在设备院中央朝设备，stair 站在梯段上且不滚转。同时确认窗外渠内水面能渲染出来。
- QS-03 [major] <controls> 同一会话里第二个建筑视点书签的 goto 返回 false，相机停在书签回退位姿
    repro: 1) 打开 /?clean=1&workers=3。
2) 执行 await __MARS__.goto('S07',{instant:true})，等待后执行 await __MARS__.goto('S07b',{instant:true})（S07c、S07d 同样）。
3) 另开一页：goto('S07Oc')，再 goto('S07Od')、goto('S07Oe')。
脚本：node scripts/slot.mjs --slots 4 -- node shots/qa-shots/qa.mjs shots/qa-shots/jobsC.json。
    evidence: shots/qa-shots/r/S07Od.png ; shots/qa-shots/r/S07Oe.png ; shots/qa-shots/runC.log
    expected: 书签可以在同一会话里随时复访（§1 所有书签允许随时接管；§6 书签回到原楼或原街角）。S07→S07b→S07c→S07d 是定格序列，访客会在同一会话里按顺序打开。
    actual: - 两个会话里，第一个建筑视点书签都成功（S07、S07Oc）。
- 之后 5 次 goto（S07b、S07c、S07d、S07Od、S07Oe）全部 resolve 为 false。
- S07Od、S07Oe 的最终位姿都等于共享回退位姿 7.3179982,104.8320842,163.5,262.9,2，两张画面是同一面混凝土墙。
- S07b 之后中心拾取打到 331 km 外的地面，相机不在入口。
- 每书签新页面时这些视点都能解析。
    suggestion: 排查 buildingView 返回 interrupted（被 supersede）的来源，可能与上一次 buildingView 留下的 hold 或 walk 状态有关。被打断时应重试，或给出明确原因，不要让 applyBookmark 静默返回 false。
- QS-05 [major] <urban> 宽水面不架桥：超过 1.4 km 的水面跨越一律截断，全星没有长桥，S05 的细索桥无从出现
    repro: 1) node shots/qa-shots/node/bridges2.mjs 34.8757 -105.309 3：只有 250–834 m 的普通街桥。
2) /?bookmark=S05&clean=1 与 ZR5 候选机位画面里都没有桥。
3) 规则见 src/world/urban/citytile.js：水上路段短于 1.4 km 且两岸有地才成桥，否则道路截断。
    evidence: shots/qa-shots/cap/S05.png ; shots/qa-shots/r/S05-candA.png
    expected: §5 05：细索桥横过中景，两处桥塔都有可见的基础或桥岛。§2 ZR1：低岛、桥、渡站分担往来。§1：两地共用的桥要有双方可达的桥头。
    actual: 港湾和海峡没有任何跨越；G01 港内与 ZR5 港湾的取景里都没有桥。
    suggestion: 增加跨港湾、跨海峡的长桥规则：桥头社区、桥岛或桥塔基础、通航净空，与渡站一起规划，并把桥型写入道路记录供 city 渲染。
- QS-06 [major] <city> 桥梁几何只有板梁、栏杆加桥墩一种，没有斜拉、悬索或拱桥（桥塔、拉索、桥岛）
    repro: 阅读 src/render/city/streetBuild.js 的 bridge()：头注释写明只生成 deck slab、fascia beams、railings with posts、piers down to the bed。S05 镜头需要的细索桥没有对应结构类型。
    evidence: shots/qa-shots/cap/S05.png
    expected: §5 05 细索桥两处桥塔有可见基础或桥岛；ZR2 “桥横跨峡谷通勤”，Z04 参考图里有高拱桥。
    actual: 只有一种板梁桥；即使 urban 给出长桥，也渲染不出桥塔和拉索。
    suggestion: 按跨度和桥型（斜拉 / 悬索 / 拱）生成桥塔、拉索或拱肋、桥岛基础和夜间轮廓灯，接收 urban 的桥型字段。
- QS-07 [major] <urban> 稠密祝融市岸线没有渡站、滨水步廊等滨水公共建筑，除 G01 外的水面镜头也没有渡船
    repro: 1) node shots/qa-shots/node/bridges.mjs -35.2392 105.3637 4：docks 为 {pier:30}，uses 里没有 ferry_terminal。
2) 渲染 ZR5 候选：pose -35.2603,105.3189,20,60,1,50，time 8.4787。
    evidence: shots/qa-shots/r/S05-candA.png
    expected: §5 05：渡站、遮阳步廊、低层公共建筑。§2 ZR1：临水餐廊下见到轮渡靠泊。ZR5：住宅、水上市集及滨水公园沿侧湾生长。
    actual: ZR5 港区 9×9 个 L13 块内有 30 个货运码头、20 座港棚、118 座仓库，渡站和客运码头为 0。候选画面的岸线全是港棚和仓库，水上没有渡船（props 只沿 ferry 码头和 G01 航线放渡轮）。
    suggestion: 在 Z 区密集岸线按间距布置渡站（ferry 码头、站房、遮阳步廊、滨水公园），并把居住侧湾和货运岸分开，props 的渡轮航线随之出现。
- QS-08 [major] <terrain-fn> G02 南台地水阶周边没有任何灌区农田
    repro: Node 采样范围 −28.3…−27.6、−45.6…−44.5，0.02° 网格共 1980 点：sampleTerrain.mat=FARM、urbanSample.farm>0.3、landUse=FARM 都是 0 次；在 −27.95,−44.95 处 fields.farm=0。另打开 /?bookmark=S08&clean=1。
    evidence: shots/qa-shots/cap/S08.png
    expected: §5 08：沿途出现少量工作镇和灌区，落在可通车的台肩上。§2 OX5：六级水阶构成干原至耕地的过渡。G02 参考图下游有大片田块。
    actual: 画面里只有红土和六级库面，外加一个工作镇，看不到田块。
    suggestion: 在 G02 坝下、泄洪道沿线和缓坡台肩生成灌区（farm 场加田渠），与 spillChannels 连通，让水阶读成“干原到耕地的过渡”。
- QS-09 [major] <megastructures> S01 全盘画面里看不出 G01 分段潮堤和它造成的港湾弧度
    repro: 打开 /?bookmark=S01&clean=1（1600×900），G01 约在像素 (955,403)，放大该区域。
    evidence: shots/qa-shots/cap/S01.png ; shots/qa-shots/crop-S01-g01.png
    expected: §5 01：一个主要港湾可辨认出分段潮堤造成的岸线弧度。§1：从全盘读出巨构对岸线和流域造成的形状变化。
    actual: SITES.tidalBarrier 弧长 11 063 m、半径 16 km。S01 机位下约 9.3 km/像素，港湾和堤线只占 1–2 像素，岸线上没有可读的弧形。
    suggestion: 放大港湾或堤线的尺度（数十到上百公里级的港湾弧），或在轨道层用浅滩色和岸线把潮堤围出的静水港区画出来。
- QS-10 [major] <urban> 轨道尺度聚合把港区冷白灯平均掉，S01 夜侧和 S02 没有冷白泊位点列
    repro: 1) Node：urbanSample 在 ZR5 码头（−35.245, 105.355）：texel 2000 m 时 light 0.031、lightTemp 0.86；texel 9000 m 时 light 0.001、lightTemp 0.20。
2) 打开 /?bookmark=S02&clean=1，以及东内海夜面 pose -5,112,17900000,0,-90,50、time 17.0。
    evidence: shots/qa-shots/crop-S02-a.png ; shots/qa-shots/crop-S01-night.png ; shots/qa-shots/r/S02-candEast.png
    expected: §5 02：主港工作泊位是短而直的冷白点列，站前城区是较宽的暖色亮核。§5 01：跨进夜侧后转为短排冷白工作灯。§2 ZR1：港区冷白。
    actual: S01、S02 和东海候选三幅夜景里，灯点全部是暖橙色，没有一处冷白点列。另外整块陆地均匀撒满细小暖点，富氧区站间长暗段、高地连续暗面都不成立。
    suggestion: 轨道尺度聚合时单独保留港区、码头的点状冷光（独立点光层或取最大值聚合），同时压低乡野背景散点，让暗面连续。
- QS-11 [major] <water> S09 航口水面有一条笔直色带接缝：堤外蓝色浪面与堤内紫褐镜面硬切
    repro: 打开 /?bookmark=S09&clean=1（g01-5km 视角，当地 18:05）。
    evidence: shots/qa-shots/cap/S09.png ; shots/qa-shots/crop-S09-seam.png
    expected: 堤内港池较平静，但水面连续，没有可见接缝（§5 09，§6 没有可见缺陷）。
    actual: 从西侧堤头到东侧堤头，横跨 560 m 航口有一条直线色界：两侧颜色、粗糙度和反射完全不同，像两块不同材质拼在一起；堤内整片看起来像泥滩而不是水面。
    suggestion: 港内消浪区和外海之间按离堤、离航口的距离平滑过渡波高、粗糙度和反射，航口内不要硬切。
- QS-12 [major] <props> 人物和行道树达不到游戏级：方块人偶、锯齿卡片树冠
    repro: 打开 /?bookmark=S07&clean=1、/?bookmark=S07b&clean=1、/?bookmark=S06&clean=1。
    evidence: shots/qa-shots/cap7/S07.png ; shots/qa-shots/cap7/S07b.png ; shots/qa-shots/cap/S06.png
    expected: §6：全场景游戏级三维资产；人物用作比例参照（§3、§6 抽查 5）。
    actual: 行人是没有面部、方块四肢、纯色的低模人偶；行道树冠是锯齿状大卡片；S06 树冠是暗色团块。
    suggestion: 换成有比例、服装和姿态细节的人物模型，以及多层叶片、有枝干结构的树木 LOD。
- QS-13 [minor] <megastructures> S09c 港务工作间：显示器是占位条纹贴图，房间空荡，灯塔挡在航口窗景中央
    repro: 打开 /?bookmark=S09&clean=1 后切到 S09c，或直接 /?bookmark=S09c&clean=1（g01-office）。
    evidence: shots/qa-shots/cap/S09c.png
    expected: §5 09：港务工作间是可信的工作室内，透过窗看见同一个航口和下一艘进港渡船。
    actual: 桌上 4 台显示器是斜条纹占位贴图，室内只有一张长桌；红白灯塔正好挡在窗景中央的航口上。
    suggestion: 补控制台、座椅、海图和设备，换真实屏幕内容；调整 office.look，或把灯塔让出窗景中线。
- QS-14 [minor] <lead> 5 个 S07O* 书签共用同一个回退位姿，而且正对一面墙
    repro: 查看 src/app/bookmarks.js：S07O、S07Ob、S07Oc、S07Od、S07Oe 的 pose 都是 7.3179982,104.8320842,163.5,262.9,2。视点解析失败时（见 QS-03）就会落到这里。
    evidence: shots/qa-shots/r/S07Od.png ; shots/qa-shots/r/S07Oe.png
    expected: 回退位姿应分别对应检修道、值守入口、楼梯、控制室和设备院，失败时也能给出接近卡片的画面。
    actual: S07Od 与 S07Oe 两张画面完全相同，都是一面带窗的混凝土墙。
    suggestion: 在 buildings-o 修好锚点后，从 find-shots.mjs view 导出各自的位姿，写回每个书签。
## BOOKMARK CORRECTIONS
- S02: pose -5,112,17900000,0,-90,50 time solTime 17.0（东内海中心当地约 0:28；若想多一点晨光球缘可取 16.6） — 现书签的西内海沿岸没有港城，“主港 / 内陆城团 / 城市群之间的大块暗水”不成立。改看东内海夜面后，ZR1、ZR4、ZR5 三个城网围着大块暗水，岸线由灯点勾出（已渲染 r/S02-candEast.png）。冷白泊位灯仍然缺失，见 QS-10。
- S03: pose 7.215,104.86,3043,35,-11,35 time 当地 10:00 不变（solTime 3.009） — 35 mm、俯仰 −24° 时画面上缘在水平线下约 8°，远景不可能入画；抬到 −11° 后地平线与远景才能进入上半幅。这只是最小修正：此处世界里没有盆地和赤岩台地，S03 必须等 QS-01 补地貌后重新选点。
- S04: pose 73.61413,53.32391,445,36.5,4,55 time 当地 8:00 不变（solTime 4.445） — 机位落在温室群中，34–96 m 内有 8 栋 greenhouse；加载后温室挡住约 2/3 画面（r/S04-long.png）。原 alt 426.5 低于地面 432.6 m。改为离地约 12 m、俯仰 +4° 后（Node 几何计算）：5 m 高温室顶在 −11.6° 以下出画，前池（约 250 m，−3.7°）、对岸泵房 OX4-2.3.10t.m5-3.0-0（810 m，−1.6°）和冰崖顶（约 1.6 km，+10.7°）同框。机器过载，此机位未能渲染验证；也可以改到前池南岸温室前沿另选低台地。
- S05: pose -35.2603,105.3189,20,60,1,50 time solTime 8.479（当地 15:30） — G01 港湾北岸是空的（QS-02）。ZR5 这里远岸 2.5 km 起连续建成，有三处高度不同的塔簇，红丘在后（已渲染 r/S05-candA.png），比现机位更接近卡片。细索桥（QS-05/06）和渡船、渡站（QS-07）靠换机位解决不了；如果坚持用 G01，需要先补港城。
- S06: pose 34.8905,-105.286,1135,245,-4,40 time solTime 2.169（当地 19:15） — 现机位离地 54 m，被屋顶和树冠挡住。北侧第一级台阶边缘（地面约 1116 m）高出谷底约 150 m。heading 245 时，河道（2.4–4 km）和 4 座过河街桥（0.95–2.25 km，方位 220–249°）都在 40 mm ±24° 视场内（Node 几何验证）。渲染时机器过载，r/S06-cand.png 没有收敛，地形和城块未加载，不能作为通过依据，需要复验。
- S06b: pose  time  — 离地 151.6 m，正下方是 968 m 的谷底，不是“高出台面约 15 m 的露台”。说明里“河从左下斜穿到画面中央”不存在：视线 10 km 内不经过河道，河在右侧约 8.7 km 处被楼群遮挡。建议删除，或改成 S06 修正机位降到台阶露台眼高后的近景版。
- S07: pose  time  — 站台 S9ruz39h.4 在机位西北 208 m（方位约 310°），机位朝 114°，站台在身后；32 mm 下立面占满全幅，也看不到通往后院后勤入口（back）的侧巷。站台与住宅门口在机位处夹角约 120°，同一个 28–35 mm 画幅放不下。需要另选街对面一点：画面一侧看到站台雨棚或通往站台的人行道方向，另一侧是住宅门口和通往后院的侧巷，并保留行道树和天空。未能在过载机器上渲染验证。

######## QA #3
## SUMMARY
qa-identity（§6「每栋建筑可定位」+ 抽查 4）验收结论：数据层的身份链路很扎实，但宿舍内部通路和两类 ID 不可再访的问题未通过，浏览器内的访客流程没能实测。

【做完的】
- Node 全量核对：48 个 L13 瓦片，覆盖 12 省、11,119 栋。
  - 无重复 ID，无缺失字段。
  - 省域、辖区与控制图逐栋一致。
  - 锚点都落在本瓦片内，占地都在地块内。
  - 10,923 条邻接关系全部可解析且双向互指。
- 深度抽检 336 栋（每省 28 栋，19 种用途）：
  - buildingSpecById 往返在热缓存下 336/336 一致，冷缓存下 72/72 一致。
  - 瓦片重算 48/48 确定，buildingsOnly 生成 48/48 完全相同。
  - mass、exterior、full 三级网格：0 报错、0 回退 generic、0 NaN、0 空几何，网格可复现。
- 浏览器内拾取（ZR5 区级，离地约 1.2 km）：抽 8 个 ID，city.getBuilding、focusInfo、worker 重新生成的 buildingSpec 三者完全一致，三级资产都能加载。

【不通过的】
- 宿舍（农工宿舍）内部通路断开：抽样 31 栋中 25 栋，2–3 层的全部不通。从楼梯间进不了任何一户，选择面板的「二层起居室」视点落在一个封闭户内，走不出去。
- G02 工作镇共 187 栋，buildingSpecById 全部返回 null：只要所在瓦片未加载，按 ID 再访（?select=、搜索）就失败。
- 清单上的层数/高度和生成的资产不一致：
  - 裙楼住宅塔，清单高度比实际高 25–30 m。
  - OX4/OX6 的部分工务建筑（保温站、泵房、融水泵房），层数或层高与清单不符。
- 一次实测中 WebGL 上下文丢失后程序没有恢复，刷出 4,291 条报错。

【没做成的】
- 浏览器内 4 栋访客流程（轨道→街面→背面→屋顶→二层→回轨道→按 ID 再访）没跑。
- 1 km 和街面两级的拾取、重载同屏对比、真实鼠标点击都没跑。
- 原因：scripts/slot.mjs 在 09:50 被改为全机最多 3 个浏览器，我的任务从 10:35 排到 11:28 一直没拿到槽位，已取消。
- 脚本都已写好，可直接重跑：shots/qa-identity/visitor.mjs、door-test.mjs、g02-test.mjs、pick-test.mjs 加 scenes2.json，入口 run-inner.sh。

已知问题（ZR1 远处体块不可见）没有报告；我测的 ZR5 区级画面不受它影响。
## CHECKS
- [partial] (1) 拾取 ↔ 清单/规格一致：区级轨道视角（ZR5 核心，/?pose=-47.67251,105.3791,2874,0,-32,35&time=3.475&workers=3）: 40 个网格点拾到 28 个不同 ID。前 8 个 ID 中，city.getBuilding().spec、city.focusInfo().spec 与 worker 'buildingSpec' 新生成的规格，按稳定 JSON 比对 8/8 完全一致。字段齐全：province/provinceCode、plot.id 与多边形、district/block、lat/lon、use、heading、entrances、floors。经 worker 'building' 生成 mass/exterior/full：三角形 288–2,850 / 9.6 万–98 万 / 29 万–419 万，无 error、无 generic、无 NaN。1 km（C02）与街面（C03）两级拾取未在浏览器执行（槽位排队）。真实鼠标点击这次落在 HUD 上（我的测试坐标问题），不计入结论。证据：shots/qa-identity/pick/pick-report-zr5.json、shots/qa-identity/pick/zr5-district-run1.png
- [pass] (2) Node 深度抽检：336 栋 / 12 省 / 19 种用途（每省 4 个 L13 瓦片，按聚落 townsNear 加密度随机取点）: buildingSpecById(id) 与瓦片内规格按稳定 JSON 比对：热缓存 336/336、clearUrbanCaches 冷缓存 72/72 一致；同一 ID 连续生成两次一致。generateBuilding 三级 LOD：0 抛错、0 stats.error、0 回退 generic、0 NaN、0 空几何、0 越界索引，bounds 合理。exterior 网格重复生成哈希一致 336/336。exterior/full 都带 street/entrance/back/roof 相机锚点；full 都有 colliders 和 rooms。证据：shots/qa-identity/sweep.json，脚本 shots/qa-identity/node-sweep.mjs
- [pass] (2) 全清单完整性：48 个瓦片共 11,119 栋: 无重复 ID。ID 格式、省码与 ID 前缀一致。province/zone 与 provinceAt/zoneAt 逐栋一致，锚点都在本瓦片，占地都在地块内。瓦片重算 48/48 确定；generateCityTile 与 {buildingsOnly:true} 生成的建筑 48/48 完全相同。10,923 条 neighbors 全部可解析（其中 323 条跨瓦片）且双向互指，没有 sharedWalls 为真却无邻居的情况。供风格组参考：O 区 otown 内有 3,065 栋使用 Z 类用途（residential/shop_row/school/community），合同允许 USES.Z ∪ USES.O，故不计缺陷。另：ID 省码前缀写错也能解析到同一栋（如 OX1-0.3.1a5.17w-n8.n6-7 → ZR1-…-7），属宽容别名，不计缺陷。证据：sweep.json、shots/qa-identity/nbr.mjs、bonly.mjs
- [fail] (2) 清单层数/高度 ↔ 生成资产层表: 抽检 336 栋，比对 meta.height/floors 与 anchors.floors/roof。不一致的有：裙楼 residential_tower 4/5 栋清单高度偏高 25–30 m（D3）；OX4/OX6 的 insulated_station、pumphouse、meltwater_pump 层数或层高与清单不符（D4）；ZR3 warehouse 3/3 栋清单 1 层，资产 anchors 为 2 层（疑为夹层办公，buildings-z 可顺查）。城市远景体块就是 generateBuilding(spec,'mass')，与 exterior 顶高一致，没有 LOD 跳变。顺带发现：OX5-4.3.2q.6m-13.3-1（2 层宿舍）落在横向高差 22 m 的坡上（ground.min 1135.77 / max 1158.1），屋面在入口上方 18.5 m。证据：shots/qa-identity/lodcons.json
- [fail] (3) 抽查4 内部通路：项目自带 scripts/walk-buildings.mjs（与步行模式同一胶囊和 'full' 碰撞体），另用室内起点泛洪 flood.mjs 复核: 4 栋访客楼：ZR5-3.3.1ik.ju-12.n6-8 门厅、楼梯、二层起居、后门全部可达，房间 142/142；ZR3-4.3.i9.16e-7.n3-2 房间 95/95；OX1-0.3.z2.xa-n27.n6-3 房间 67/67，但后门外侧不可达；OX3-1.3.a.1ar-28.n13-0 只到 3/44 间，门厅和二层起居不可达（D1）。宿舍共测 31 栋，25 栋断开。对照组正常：O 区普通住宅 5/5、ZR3 住宅每层 13/14。疑似问题，未深挖、不单列缺陷：shop_row OX1-0.3.13m.ua-n1.n9-1 上层只到 3/8；maintenance 3 栋中 2 栋上层房间不可达；farm_station OX2-1.3.kz.l1-20.1-0 一间都到不了；35 层办公塔 ZR1-0.3.1dd.199-14.n4-0 的 full LOD 只有门厅 1 间、没有楼梯锚点（碰撞体 3,757 三角形），请 buildings-z 复核办公类能否「进二层」。walk-buildings 把室外地面当作平面，坡地和裙楼可能误报，所以缺陷只报室内起点复核过的。证据：shots/qa-identity/walk-semantic.log、dorm-flood.txt、walk-ox3-dorm-f0.png、walk-ox3-dorm-f1.png
- [partial] (3) 抽查4 浏览器内访客流程：4 栋普通建筑（Z：ZR5-3.3.1ik.ju-12.n6-8、ZR3-4.3.i9.16e-7.n3-2；O：OX1-0.3.z2.xa-n27.n6-3、OX3-1.3.a.1ar-28.n13-0）: 4 栋由固定种子从 ZR5/ZR3 城市瓦片和 OX1/OX3 otown 瓦片随机选出（shots/qa-identity/pick4.json）。Node 端已确认：规格完整，相机锚点 street/entrance/lobby/stair/living/back/roof 齐全，门洞在碰撞体中是开的（doorprobe：主入口向内射线 9–13 m 无遮挡），楼层表与 floorHeight 一致（如 ZR5 为 0.45/5.25/8.35…，首层 4.8 m，标准层 3.1 m）。浏览器内的完整流程（轨道定位→街面→进门→背面→屋顶→楼梯→二层窗外邻楼→回同经纬度轨道→UI 搜索再访→?select= 两次重载）没跑，原因是全机浏览器槽位上限 3，从 10:35 排到 11:28 没拿到。脚本：shots/qa-identity/visitor.mjs（入口 run-inner.sh）
- [pass] (4) 身份漂移：确定性（Node）: 冷/热缓存同一 ID 规格一致，同一瓦片重算一致，buildingsOnly 一致，网格哈希一致，书签引用的 ID 都能解析：S07 ZR1-0.3.1a5.17w-n8.n6-7（8 层住宅）、O07 OX1-0.3.11t.x8-n1.1-0（sluice_station）、S04 注记 OX4-2.3.10t.m5-3.0-0（meltwater_pump）。同一地点重载后 ID 不会变。
- [partial] (4) 身份漂移：浏览器两次重载同屏拾取（ZR5 区级）: 两次加载在 180 s 内都没有空闲（仍有 59–63 个载入任务），第一次中途还发生了 WebGL 上下文丢失（D5）。40 个点中 12 个结果不同：有的一次是地面、一次是建筑；有的是射线上距离相近（相差约 20–200 m）的前后两栋楼。这反映的是淡入/LOD 状态不同，不能据此判定同一建筑换了 ID。第二轮带逐 ID 位置比对的重测脚本（pick-test.mjs + scenes2.json）因槽位未执行。结论：不确定，需要在场景空闲后重测。
- [fail] (4) 按原 ID 再访：G02 工作镇建筑: 4 个工作镇共 187 栋（OX5-G02-T1-0 … T4-57），buildingSpecById 全部返回 null。池 worker 'buildingSpec' 和 UI 兜底的 lookup.worker 都依赖这个函数，所以瓦片未加载时按 ID 再访失败（D2）。证据：shots/qa-identity/g02-node.txt
## DEFECTS (5)
- QA-ID-01 [major] <buildings-o> 农工宿舍（dorm）内部通路断开：楼梯间/门厅进不了任何一户，「二层起居室」视点落在封闭户内（抽样 25/31 栋，2–3 层的全部如此）
    repro: cd web && node scripts/walk-buildings.mjs --id OX3-1.3.a.1ar-28.n13-0 --verbose → lobby:false, living2F:false, roomsReached 3/44, floorsReachedPct [10,5]。用与室外地面无关的室内起点复核：node shots/qa-identity/flood.mjs OX3-1.3.a.1ar-28.n13-0 stair living lobby → 从 stair 只到 5 间核心筒房间，各户 hall@-14.3/-3.0/2.8/14.1 在两层都不可达；从 living（选择面板「二层起居」视点，相机 [-16.5,5.6,0]）只到同一户 4 间，到不了楼梯、走廊和任何门。浏览器内对应操作（未实测）：/?select=OX3-1.3.a.1ar-28.n13-0 → 二层视点 → 步行
    evidence: shots/qa-identity/walk-ox3-dorm-f1.png（二层：绿色＝可达，只有左侧楼梯间；红色＝走不到的楼板）、shots/qa-identity/walk-ox3-dorm-f0.png、shots/qa-identity/dorm-flood.txt（31 栋宿舍逐栋结果，如 OX1-0.3.13m.ua-0.n8-0 只到 8/64、OX5-1.3.1jx.4h-7.10-3 只到 8/111）。对照：同一工具测住宅 ZR3-4.3.i9.16e-7.n3-2 每层 13/14，O 区住宅 5/5
    expected: 街门→门厅/信报区→楼梯间→走廊→各户门都能走通，各层房间可达，二层视点与楼梯相连（§1「上楼可从走廊进户」，§6 抽查4「内部通路」，§1「可复访的内部空间」）
    actual: 核心筒楼梯平台和门厅通往各户的门在碰撞体中不存在或不可通过，只有核心筒和单户内部可走。4 层宿舍大多正常（如 OX1-0.3.ye.y4-n18.n2-2 为 15/17），2–3 层宿舍全部失败
    suggestion: 检查 dorm.js 在 ≤3 层平面上的改动（山墙外挂疏散梯、双入口门厅）是否删除或挪走了 residentialPlan 的户门；修复后用 walk-buildings --id 回归
- QA-ID-02 [major] <city> G02 工作镇 187 栋（OX5-G02-T<k>-<i>）无法按 ID 再访：buildingSpecById 和 'buildingSpec' 任务返回 null
    repro: node -e 'import("./scripts/node-world.mjs").then(async m=>{m.initWorldNode();const u=await import("./src/world/urban.js");console.log(u.buildingSpecById("OX5-G02-T1-0"))})' → null（4 镇 187 栋全部为 null）。调用链：ui/nav.js lookupBuilding → city.getBuilding（只认已加载的瓦片）→ buildingIndex（只含附近已索引的瓦片）→ specLookup，最后落到 workers/handlers/lookup.js 或 ui/lookup.worker.js 的 buildingSpecById → null。因此在轨道视角对 OX5-G02-T1-0 用 /?select= 或搜索，都无法解析（浏览器内实测脚本 g02-test.mjs 已备好，因槽位未执行）
    evidence: shots/qa-identity/g02-node.txt（G02-T1 -27.92398,-44.71239 39 栋；T2 44 栋；T3 46 栋；T4 58 栋；全部 null）
    expected: 程序生成的每个实例都能按原 ID 再访（§6「返回轨道并按原 ID 再访」「身份漂移的实例均需修复」）
    actual: G02 工作镇实例只在所在瓦片已加载时可解析；冷启动或从远处按 ID 查找时提示「没有这个建筑 ID」
    suggestion: 让 'buildingSpec' 能识别 G02-T 前缀：按 mega.towns()/SITES.waterStairs.towns 调用 towns.js 的 workTown(town) 取出规格（需与 core/lead 协调 lookup.js）
- QA-ID-03 [minor] <urban> 裙楼住宅塔清单高度按 3.8 m 层高计算，比实际资产高 25–30 m
    repro: Node：buildingSpecById('ZR1-0.3.1dd.199-13.n3-0') → use residential_tower，floors 42，floorHeight 3.1，裙楼 3×5 m，meta.height 163.2；generateBuilding(spec,'exterior').anchors.roof.y = 137.6（42 层＝15 + 4.2 + 38×3.1）。同类：ZR3-4.3.it.15i-n17.n9-0 清单 97.2 / 实际 85.7；ZR4-5.3.kf.ze-n21.n11-0 清单 199.8 / 实际 169.3。原因在 src/world/urban/builders.js GEN[BU.TOWER_PODIUM]：towerH = pf·5 + (floors−pf)·3.8 对 office 和 residential_tower 都用，但 residential_tower 的 fh 为 3.1
    evidence: shots/qa-identity/lodcons.json（rows 中的 roofVsSpec）；UI 选择面板和清单 CSV 的 height_m 取 meta.height（ui/format.js buildingHeight）
    expected: 清单高度与资产一致：meta.height = 裙楼高 + (floors−裙楼层数)×floorHeight
    actual: 抽样 5 栋 residential_tower 中 4 栋清单高度偏高 11–30 m；选择面板和 CSV 显示约 163 m，实际约 138 m
    suggestion: towerH 改用该栋的 fh（residential_tower 用 3.1）
- QA-ID-04 [minor] <buildings-o> OX4/OX6 的部分工务类型不按规格层数生成，清单层数/层高与资产层表不符
    repro: Node：generateBuilding(buildingSpecById(id),'full').anchors.floors 与规格比对。OX4-2.3.12z.ir-n4.9-0 insulated_station：规格 3 层（gfh 7、fh 6、高 19 m），资产 2 层（0.45/7.0、7.45/5.7），roof.y 13.1。OX6-3.3.me.at-7.n2-0 insulated_station：规格 fh 3.6、高 7.6 m，资产上层 5.7 m、roof 10.15。OX4-2.3.12z.ir-n6.7-0 pumphouse 与 OX4-2.3.12z.ir-n5.9-3 meltwater_pump：规格 1 层 5 m，资产 2 层、roof 10.4。另外 walk-buildings 测 OX4-2.3.12z.ir-n4.9-0：floorsReachedPct [0,0]，rooms 0/1（工具对坡地可能误报，仅供参考）
    evidence: shots/qa-identity/lodcons.json（byUse 中 pumphouse/insulated_station/meltwater_pump 的 floorsMismatch 与 roofOff3）、shots/qa-identity/walk-semantic.log
    expected: 选择面板显示的层数和层高就是资产实际的层表（§2 灰模「每栋记录朝向、层表」，抽查4「楼层高度」）
    actual: 抽样 insulated_station 4 栋中 1 栋层数不符、3 栋层高不符；meltwater_pump 9 栋中 2 栋、pumphouse 7 栋中 1 栋层数和高度不符
    suggestion: 生成器按 spec.floors/floorHeight 出层表；或由 urban 把这些类型的规格写成实际构造（比如 2 层、上层 5.7 m）
- QA-ID-05 [minor] <atmosphere> WebGL 上下文丢失后不恢复：每帧刷出 TypeError（一次运行共 4,291 条）
    repro: 在机器 GPU 负载高时（多个代理的浏览器同时渲染）打开 /?pose=-47.67251,105.3791,2874,0,-32,35&time=3.475&workers=3（ZR5 核心区级视角）并等待空闲。控制台先出现「WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost」，随后 three.module 的 update 不断抛出「Cannot read properties of null (reading 'byteLength')」。在 src 中 grep webglcontextlost/contextrestored 无结果
    evidence: shots/qa-identity/pick/pick-report-zr5.json（runs[0].logs：pageErrors 4,291 条，warns 首条 CONTEXT_LOST_WEBGL）、shots/qa-identity/pick/zr5-district-run0.png
    expected: 监听 webglcontextlost，暂停渲染；收到 contextrestored 后重建 GPU 资源，或提示刷新。控制台不应刷屏（§6「检查…控制台」）
    actual: 渲染循环继续访问已失效的缓冲，报错不断累积
    suggestion: 在 Pipeline 的 renderer canvas 上处理 contextlost/restored（停掉 setAnimationLoop，恢复后重建批次和纹理，或提示刷新）

######## QA #4
## SUMMARY
qa-style 验收结论（构建 13cc425，http://127.0.0.1:4300，只读）：§6「风格与功能逐栋符合设定」部分不通过；抽查 3「区域识别」部分通过。

测试条件：机器负载 230–375，三个浏览器槽位长期被其他 QA 占用。我的帧都没有在 150 s 内达到 idle（还有 66–181 个 worker 任务未完成），所以只评判已经稳定的几何与数据层特征。两个任务因 page.screenshot 超时丢失：R3 ZR1 海岸航拍、Z6 细长办公楼外观。

通过的部分：
- O 区温室行 OX1-0.3.11s.x7-n1.2-1…36：门斗、种植床、中央作业道、配水渠、服务大门都读得出来。
- ZR1 地面站 ZR1-0.3.1a5.17w-n10.n5-0：Z03 三连筒壳、站台雨棚、列车、跨线天桥加楼梯塔、站前广场齐全。
- OX4 MO-45 区域：融水前池、低矮白色工务群、温室行，可以认出是富氧区。

主要问题：
1. 诊所 ZR1-0.3.1a5.17w-n9.n6-0 外观是素盒子，门厅只有空白标牌，看不出医疗设施，也不属于 R2/Z03 语言。门厅里还出现住宅信报箱墙，这是 building-kit 的通用逻辑。
2. 小地块办公楼（宽 5.5–7.3 m、8–12 层）内部只有楼梯、电梯、储藏和走廊，没有办公空间；其 interior 视点也拍不到室内。
3. OX4 冰崖立面被判成 FARM 材质，从区域视角看是一整面红岩墙。
4. OX1 农田外缘按整格呈阶梯状，不随渠系展开。
5. S03 视域约 95 km² 内没有任何低层聚落。

区域并排（标签已隐藏）：O 与 Z 能靠农田/水务和建成体块分开。但 Z 区的公共交通、银白塔簇，以及 ZR2 的峡谷特征都读不出来。ZR1 那一格借用了 qa-shots 的 S05 书签帧。

已知问题（ZR1 300 m–3 km 体块不可见）没有让我的任何一帧失效。所有证据在 shots/qa-style/。
## CHECKS
- [pass] 富氧区温室：种植跨距 / 配水 / 服务入口（O01/O02/O03/R1）: 温室行 OX1-0.3.11s.x7-n1.2-1…36 的航拍（C/O1-gh-row-OX1-n1.2-front3q.png，裁切 C/O1-crop-channel.png）能看到：玻璃坡屋顶加屋脊通风窗；每栋东山墙有白板门斗，带双门、台阶和黄扶手；-1 号长边有深蓝色配水渠；铺装服务场地。室内（C/O2-gh-n1.2-2-living.png，buildingView 'living'）有中央混凝土作业道、两侧抬高种植床、补光灯架，远端山墙服务大门敞开，门外可见储罐。用途一读即知，Node 'full' 也带 plant/soil/concrete_wet/tank 部件。扣分：行首泵房无水源（见 D7）；作物是低多边形菱形叶片，人眼高度显粗糙（见 D8）。
- [partial] 闸站 / 泵站（O02；S07O 闸站 OX1-0.3.11t.x8-n1.1-0）: 闸站航拍 O4 为压缩时间从队列删掉，本项没有我自己拍的网页帧。Node：OX1-0.3.11t.x8-n1.1-0 exterior/full 两档都能生成；有 gate/walkway/control/stair/back 视点、2 间控制室、colliders 1136；OX4 闸站与融水泵 OX4-2.3.10u.m5-n8.0-0 等也都能生成。qa-shots 的 S07O 帧（shots/qa-shots/cap7/S07O.png）可见黄色栏杆、闸门门架、闸墩和检修道；但它的 S07Oe 背侧设备院帧镜头落在地面斜坡上，不可用，归 qa-shots 的镜头卡核查。OX1 温室行首泵房 OX1-0.3.11s.x7-n1.2-0 没有取水对象（D7）。
- [pass] 祝融市公共站房：站台 / 高差换乘 / 人流入口（Z03/R2/Z02）: ZR1-0.3.1a5.17w-n10.n5-0 的高位背面航拍（C/Z2-station-n10n5-high-back.png）与 A/A01-crop-station.png：三连白色筒壳站厅加玻璃扇面、两条站台的连续雨棚、停靠列车、从站厅伸向站台的跨线天桥加楼梯/电梯塔（高差换乘），站前广场有行人。站房身份清晰。小问题：站厅朝站台一侧是大面积灰色实墙；站前广场约 200×150 m 空旷，几乎没有布景。
- [partial] 普通住宅（Z01/Z02）: A/A02-clinic-n9n6-back3q.png、A/A04-school-n8n5-front3q.png 里的住宅板楼：连续曲线白色阳台带、玻璃楼梯竖条、分户窗洞，室内映射的房间可见。Node 统计 S07 住宅 ZR1-0.3.1a5.17w-n8.n6-7 的窗内房间类型：living 60 / bedroom 129 / kitchen 32 / bath 16 / stair 16，与用途一致。扣分：多数中层屋面是空白膜面加设备箱，几乎没有 R2/Z03 的屋顶花园；整体偏米灰，而不是暖白陶瓷加蓝灰玻璃。这一项属主观观感，没有单列缺陷。
- [fail] 卫生设施（诊所）: ZR1-0.3.1a5.17w-n9.n6-0：外观是 4 层平顶穿孔窗米灰盒子，只有侧面一个雨棚（A02）。入口为玻璃门厅，有候诊长椅和接待台，但吊牌空白，并出现住宅信报箱墙（C/Z8-clinic-n9n6-entrance.png）。lobby 视点是灰暗的接待台、空白吊牌和三扇门（C/Z4-clinic-n9n6-lobby.png）。关掉标签后无法认出是诊所，见 D1、D2。
- [partial] 学校: 没有拍到可用的网页帧：A04 视线被前景住宅板楼挡住，后续学校任务为压缩时间删掉。Node：ZR1 学校 'full' 有 classroom 6–22 间、yard 入口、lobby/office/bath。Z2 帧上缘可见学校的绿色球场和红色跑道。
- [partial] 仓库 / 港口棚（ZR5 港区）: C/P1-port-ZR5-hy-4n2-front3q.png：港口棚 ZR5-3.3.1ks.hy-4.n2-0 是带高侧窗的筒拱大棚，临水面一排装卸门，前方是带系缆桩的码头；后方仓库为同类筒拱。两者能认出是物流建筑，但彼此几乎没有差异。码头外本应是海面的区域在非 idle 帧里画成平的米灰面，水面没建完，没有据此评判。Node：港口棚中心点 h=-0.5 m、waterAt=海，ground.entrance=-2.2 m（ZR5-3.3.1ks.hy-3.n2-0 为 -2.3 / -2.8 m），画面上无法确认是否泡在水里，没有立缺陷。
- [partial] 背街服务建筑 / 后勤面（Z01/Z02/R4/Z04）: 诊所背面（A02）有服务门、台阶和垃圾收集箱，后勤面读得出来。商铺联排 ZR1-0.3.1a5.17w-n8.n7-* 的背街航拍为压缩时间删掉，没有自拍帧。
- [fail] 屋顶 / 后勤面 / 内部延续同一建筑身份: 温室内部与外观完全一致（O2）；站房的雨棚和天桥与站厅连贯（Z2）。诊所内部是通用接待厅加住宅信报箱（D1、D2）。细长办公楼 ZR1-0.3.1a5.17w-n10.n9-2 的 interior 视点拍不到任何室内（C/Z7-office-pencil-n10n9-2-interior.png），Node 'full' 也没有办公房间（D3）。
- [partial] 抽查 3 区域识别（隐去标签并排：OX1 水网 / OX4 极地站 / ZR1 沿岸城群 / ZR2 峡谷城）: 并排图 shots/qa-style/region-2x2-final.png：R1=S03 机位 3 km；R2=OX4 MO-45 1.3 km；ZR1 一格用 qa-shots 的 S05（我的 R3 截图超时）；R4=ZR2 峡谷 4 km 斜俯。另有书签版本 region-bookmarks-2x2.png。
O 区可读：OX1 有农田拼块加宽渠；OX4 有融水前池、白色温室行、低矮工务群和冰盖。
不足：OX1 只有农田和一条渠，没有多汊湖、赤岩台地、闸站白点和低层聚落（D5、D6）；OX4 冰崖读成红岩墙（D4）。
Z 区只能靠建成体块认出来：ZR1 是远处一片灰色盒状塔林，不是银白塔簇，画面里看不到公共交通；ZR2 的 R4 帧（非 idle，地形没细化）是发白的平原上散布体块，峡谷崖壁、河道和桥都读不出来。Node 剖面显示峡谷实际约 2.7 km 宽、600–800 m 深，谷底有 83 m 宽的河，问题在画面表达。
结论：O 与 Z 能分开，但简报指定的 Z 区识别要素（公共交通、银白塔簇）和 ZR2 峡谷特征都读不出来。
- [fail] 办公楼用途符合性（附带全量扫描）: S07 周边 25 个 L13 瓦片共 7424 栋建筑，其中 18 栋 office 短边 < 12 m，6 栋短边 5.5–7.3 m 却有 8–12 层。抽查的这类楼在 'full' LOD 里每层只有 stair/lift/storage/corridor，没有办公室（见 D3，Node 输出在 node-evidence.txt）。
## DEFECTS (8)
- QY-01 [major] <buildings-z> 诊所 ZR1-0.3.1a5.17w-n9.n6-0 关掉标签后认不出是卫生设施，也不属于祝融市 R2/Z03 语言
    repro: http://127.0.0.1:4300/?pose=21.8700632,117.9972565,585.5,139,-22.08,35&time=2.633&clean=1&workers=3（背面 3/4 航拍）；然后在页面执行 await __MARS__.app.controls.buildingView('ZR1-0.3.1a5.17w-n9.n6-0','entrance',{instant:true,waitMs:45000})，再对 'lobby' 执行同样操作
    evidence: shots/qa-style/A/A02-clinic-n9n6-back3q.png ; shots/qa-style/C/Z8-clinic-n9n6-entrance.png ; shots/qa-style/C/Z4-clinic-n9n6-lobby.png
    expected: §6：卫生设施要按所在省域、用途和参考图核对，屋顶、后勤面、内部延续同一身份。期望从街面和空中都能认出是诊所：医疗标识或名称、可辨的急救车位和入口、Z03 的白陶瓷壳或蓝灰幕墙语言、屋顶花园或设备的组织方式；门厅应是候诊和分诊空间。
    actual: 外观是 4 层平顶穿孔窗米灰盒子，屋面空白，只有一个小设备箱和侧面雨棚。入口和门厅只有长椅、接待台、空白吊牌（signage_blank）和普通门；没有任何医疗元素；门厅光线灰暗。与同街区的办公楼、学校无从区分。
    suggestion: 诊所类型加入用途识别元素：带医疗标识的吊牌和立面招牌、急救车雨棚的地面标线与坡道、候诊区导向；立面加入 Z 区白陶瓷曲面或幕墙段，屋顶加植栽或设备分区。
- QY-02 [minor] <building-kit> 非住宅楼门厅里出现住宅信报箱墙（诊所 ZR1-0.3.1a5.17w-n9.n6-0 入口可见）
    repro: 同 QY-01 的 'entrance' 视点：透过左侧门厅玻璃可见 4×8 的信报箱格。代码：src/buildings/interior/index.js 约 202–216 行，只要 plan.lobby 存在，首层 lobby 就会放 mailboxWall()，不区分用途。
    evidence: shots/qa-style/C/Z8-clinic-n9n6-entrance.png
    expected: 信报区是住宅（以及宿舍、商住楼上部住户入口）的门厅构件；诊所、学校、办公、社区等公共建筑的门厅应是候诊、问询、闸机等对应用途的构件。
    actual: 诊所门厅侧墙是一整排住宅信报箱，与候诊长椅并列。plan 型的公共建筑都走同一段逻辑，属于系统性问题。
    suggestion: mailboxWall 只对 residential / residential_tower / shop_row 上部住户入口 / dorm 生效；其他用途改放问询台、导向屏或不放。
- QY-03 [major] <urban> 小地块办公楼没有任何办公空间（例：ZR1-0.3.1a5.17w-n10.n9-2，7.1×8.3 m、12 层）
    repro: Node（在 web/ 下）：LODS=full node shots/qa-style/meshcheck.mjs 21.863225 117.995423 0 "" 9 ZR1-0.3.1a5.17w-n10.n9-2，结果 rooms={stair:12, lift:12, storage:12, corridor:13, lobby:1}。node shots/qa-style/smallscan.mjs 21.8692 117.9986 2 列出同类楼。网页：?pose=21.8628755,117.9941099,597.5,74,-23.11,35&time=2.633&clean=1&workers=3，然后执行 buildingView('ZR1-0.3.1a5.17w-n10.n9-2','interior',{instant:true,waitMs:45000})。
    evidence: shots/qa-style/node-evidence.txt ; shots/qa-style/C/Z7-office-pencil-n10n9-2-interior.png
    expected: §1/§6：每栋建筑按功能生成可用的楼层、入口和房间，共用模块也要保留实例差异；办公楼应有办公空间，interior 视点应落在室内。
    actual: S07 周边 25 个瓦片中有 18 栋 office 短边 < 12 m，其中至少 6 栋只有 5.5–7.3 m 宽却有 8–12 层：ZR1-0.3.1a4.17v-2.n10-0（5.5×9.8 m，10 层）、ZR1-0.3.1a5.17w-n10.n9-2（7.1×8.3 m，12 层）、ZR1-0.3.1a5.17w-6.n8-10（6.1×11.4 m，10 层）、ZR1-0.3.1a4.17w-n6.n11-0（6.2×11.0 m，9 层）、ZR1-0.3.1a4.17v-n8.n7-1（6.3×10.1 m，9 层）、ZR1-0.3.1a5.17w-2.n9-7（7.3×12.8 m，8 层）。抽查到的两栋在 'full' LOD 每层只有核心筒，没有办公室。interior 视点落在 1.9 m 眼高的红色地面开放空间，画面是拉伸变形的城市，拍不到室内。
    suggestion: urban：office 地块短边设下限（约 ≥ 12–14 m），过小的地块改作 shop_row 或住宅，或与相邻地块合并。buildings-z：office 生成器在核心筒占满平面时降级（如单侧办公加外置楼梯），不要输出只有核心筒的楼。
- QY-04 [major] <terrain-fn> OX4 MO-45 冰崖立面材质被判为 FARM，区域视角下整面冰崖读成红岩墙
    repro: http://127.0.0.1:4300/?pose=73.58744,53.30339,1320,15,-21,35&time=8.444&clean=1&workers=3。Node：sampleTerrain(latLonToUnit(73.630, 53.339), 0) → h=654, mat=6 (FARM), ice=0.19, rock=0.06, slopeHint=1.00。剖面：崖脚池面 416 m，冰盖顶 733 m；423–654 m 段都是 mat 6，只有 731 m 的崖顶唇部为 ICE。
    evidence: shots/qa-style/C/R2-OX4-region-MO45.png ; shots/qa-style/ox4-cliff-probe.txt
    expected: §2 OX4「冰崖、融水前池、背风温室相接。岩脚显出土红色，积霜留在阴面」；O03 参考图里冰崖是白蓝色带竖向裂纹的冰体，只有崖脚露出土红岩。
    actual: 约 300 m 高的冰崖立面整面呈红褐色竖向槽纹，像红岩峡谷壁；只有崖顶冰盖是白色。冰崖、融水前池、背风温室这条 OX4 识别链里，冰崖这一环读不出来。
    suggestion: 冰盖边缘的陡坡（slope > ~0.6 且相邻冰盖 ice≈1）把 ice/frost 延伸到立面，材质判为 ICE；只在崖脚几米内过渡到 ROCK_RED/BASALT。陡坡上不应再判成 FARM。
- QY-05 [major] <urban> OX1 农田外缘按整格呈阶梯状，范围不随渠系分枝展开（S03 视域）
    repro: http://127.0.0.1:4300/?pose=7.215,104.86,3043,35,-24,35&time=3.009&clean=1&workers=3（即 S03 机位），看画面上半部农田与赤土的交界。
    evidence: shots/qa-style/C/R1-OX1-region-S03pose.png ; shots/qa-style/C/R1-crop-staircase.png
    expected: §1「富氧水网呈蓝色树枝，沿枝条两侧长出颜色深浅不同的耕地，过了灌溉末端便露出粗糙的赤土」；ARCHITECTURE §5「边界永不显示为像素阶梯」。
    actual: 农田与裸赤土的边界沿整块田格走，形成明显的锯齿阶梯；赤土里有孤立的单块田；田格网线延伸进裸地。农田团块的形状与画面里的直渠没有对应关系，看不出沿渠两侧生长、灌溉末端收尾的逻辑。
    suggestion: 农田覆盖的取舍改为按到渠/支渠的距离和高差（灌溉可达性）做连续阈值，并在田块层级做部分退化（半块田、休耕或撂荒带）；裸地上不再绘制田格网线。
- QY-06 [major] <urban> S03（OX1 东泽水网）视域里没有低层镇或工务住宅，「低层聚落 / 低矮工务群」缺失
    repro: N=0 node shots/qa-style/enum.mjs 7.265 104.895 7，覆盖 S03 视域中心 ±4.9 km、225 个 L13 瓦片，结果 {sluice_station:48, pumphouse:15, maintenance:2, control_tower:3, service_depot:2, greenhouse:150}，没有 dorm、farm_station、cold_storage。districtInfo 网格（7.0–7.55N，104.6–105.15E）显示视域内只有 farm/wild/outpost；最近的 otown 区 0.3.11r.x8 在 7.30N 104.75E，距视域中心约 8.8 km，位于 S03 画面外。网页：同 QY-05 机位。
    evidence: shots/qa-style/C/R1-OX1-region-S03pose.png ; shots/qa-style/enum-s03-r7.txt
    expected: §2 OX1「沿堤路串起闸务站、温室和低层镇」；§5 03「沿堤路排开白色维护房、工务塔和低层聚落」；抽查 3 要求富氧区靠水务、耕地和低矮工务群识别。
    actual: 95 km² 视域内只有分散的闸站、泵房和温室行，没有一栋宿舍或镇区建筑。3 km 高的画面上只有田格和一条渠，读不出聚落，也读不出沿堤路的工务建筑群。
    suggestion: urban：沿干渠和堤路在闸站附近生成小型 otown（宿舍、维护房、农产集散站）。或者由 lead 把 S03 改对准 0.3.11r.x8 一带含镇区的河段，但简报要求 OX1 沿堤路普遍成镇，优先在 urban 侧补。
- QY-07 [minor] <urban> 温室行首泵房 OX1-0.3.11s.x7-n1.2-0 没有取水水源，配水链断在干地上
    repro: http://127.0.0.1:4300/?pose=7.2813545,104.8073245,233.1,299,-31.53,35&time=3.009&clean=1&workers=3。spec.meta：serves='greenhouses'，servesSide='right'，poolSide='back'，canalId=null。hydro.waterAt 搜索结果：最近水体为方位 105°、270 m 外的渠，水位 170.0 m，比泵房地坪 162.4 m 高 7.6 m。
    evidence: shots/qa-style/C/O1-gh-row-OX1-n1.2-front3q.png ; shots/qa-style/C/O1-crop-channel.png
    expected: §1「富氧区沿水路组织聚落」；§5 03 回看时能从门前水渠指出上游；§5 04 中「沿保温管可从融水泵房找到温室配水间」的同类逻辑，即配水能追溯到渠。
    actual: 泵房是孤立的方盒，背面（poolSide）没有水池或渠，也没有进水管或干管通向任何水体；温室 -1 的配水渠起点是干燥的铺装场地，看不出水从哪里来。
    suggestion: 温室行生成时让行首泵房落在支渠取水口上（与闸站的 waterSite 相同的放置逻辑），或给出可见的输水干管并由 buildings-o 绘制。
- QY-08 [minor] <buildings-o> 温室作物在人眼高度是粗糙的低多边形菱形叶片
    repro: 先用 QY-07 的机位，再执行 buildingView('OX1-0.3.11s.x7-n1.2-2','living',{instant:true,waitMs:45000})。
    evidence: shots/qa-style/C/O2-gh-n1.2-2-living.png
    expected: §1/§6 游戏级资产：近景种植床上的叶菜或高架作物应有可信的叶形、叶脉和体积，前景有材质分辨率。
    actual: 每株作物是 4–6 片平面菱形叶卡，颜色均一、无叶形变化。温室结构的精度很高，作物与之对比明显失衡。
    suggestion: 为 'full' LOD 的作物换成带 alpha 叶片贴图或细分叶片的株型，并做株高和色差的实例变化；远处保留现有简化。

######## QA #5
## SUMMARY
qa-zoom（§6 连续缩放与真实地形）验收结论：不通过。测试对象是 http://127.0.0.1:4300 上的生产构建，选了三处地形逐级推近并做侧移。(a) range-zr1w 赤岩山口：城市从约 750 m 沿山坡长到约 1200 m，上方为裸岩脊，目标点 23.615N 111.926E。(b) ZR2 西陆峡廊河谷：河道两侧有堤，目标点 34.8685N −105.2131E。(c) ZR3 高原陡崖：目标点 13.225N −18.44E，只做到 5 km 侧拍和步行测试，ladder 因时间砍掉。

先说明拍摄条件：机器同时跑着其他 QA 的浏览器（slot 上限被调成 3 个），地形细化非常慢，绝大多数帧在 40–200 s 内都没有到 idle（状态里一直是 busy=terrain，待处理 worker 任务 50–450 个）。所以下面只报告在多帧或多个地点重复出现、或者在 Node 端用世界函数证实了的问题。凡是可能只是没收敛造成的观感，都只写进检查项备注，不作为缺陷提交。

已确认的问题：
1) 地形长时间停在粗级。冷启动或跳转到区域/近地机位后，地形在 2–3 分钟内仍是 L2–L5，城市体块却先加载完。这时相机按保持逻辑停在真实高度，比画出来的粗地形低 100–556 m，于是从地下看，地面消失，街道和楼浮在天上。
2) 步行碰撞跟着粗瓦片走。地面取的是 max(瓦片, 解析高度)，步行者先被抬到粗瓦片上（比真实地面高 146–206 m），瓦片细化后又从 69–185 m 高处掉下来。
3) 陡坎高度没有做频带限制。range-zr1w 坡面上 80 m 的陡坎，在 minW 取 2/20/80 m 时完全一样，在各级网格上混叠成梳齿和锯齿：天际线上是一排针状尖刺，人眼高度看到规则的三角齿，而且齿形随 LOD 变化而闪变。
4) 河岸水线是锯齿。周期约 25 cm，与 L18 顶点间距相当；1 km 侧移后河宽会随细化跳变。
5) 全盘尺度看不出所选的山脊和峡谷，只有 ZR1 赤裂谷能看成一条线。

通过的部分：1000 km 尺度山脊和山口走廊都很清楚；100 km–1 km 能看到支脊、冲沟、台阶状崖坎和侧谷；侧移前后地形轮廓连续，没有大的形状跳变；Node 端 6 对同级相邻瓦片的共享边高度和水位误差为 0；在 ZR3 陡崖坡面上，等地形细化到 L20 后，脚底与可见地面完全贴合（射线距离 1.65005 m）。

另外两项没能核实：地形线框/LOD 图层只在地形卡在 L2–L4 时拍到，细级瓦片边界没法检查；城市体块缺失属已知问题，帧里看到的体块空缺按要求没有报告。证据目录：shots/qa-zoom/（a-pass-run1、a-pass2、b-canyon、wire、walk，以及各目录下的 report.json）。
## CHECKS
- [fail] 全盘识读走向（岩脊 / 河谷 / 坡岸）: 轨道 50 mm 全盘（pose=23.615,111.926,17900000,0,-90,50&time=2.138）：ZR1 赤裂谷能看成一条暗红细线，但 range-zr1w（约 100 km 宽、3000 m 以上的岩脊）看不出地形，只能从白色城区的西缘间接推断，山口收窄的走廊也看不出来。证据：shots/qa-zoom/a-pass-run1/L0-orbit.png、L0-orbit-crop.png。ZR2 西陆峡廊在全盘（TW90 书签截图）白色星形城区里完全看不到峡谷或河道，裁切图：shots/qa-zoom/TW90-zr2-crop.png。ZR3 陡崖没有拍全盘。
- [pass] 1000 km 区域走向: pose=23.615,111.926,1001280,0,-90,50：赤岩山脊带的阴影起伏、穿过山口的白色城市走廊、两侧城区边缘都清楚（a-pass-run1/L1-1000km.png，侧移 150 km 后见 L1-1000km-lat.FAILED.png）。城区边缘和农田边缘有块状锯齿，但这两帧没 idle，可能是粗纹理被放大，所以不判。
- [partial] 区域层（100 km→1 km）坡折与支沟: 已读到：山口 5 km（a-pass2/L4-5km.png）能看到支脊、冲沟、坡折，城市沿坡爬到山脚；峡谷 5 km / 1 km（b-canyon/L4-5km.png、L4-5km-lat.png、L5-1km.png）能看到多级台阶崖坎、侧谷分叉和谷底河道。问题：山脊上普遍有梳齿状尖刺（见缺陷 Z-03）；20 km 和 100 km 帧在 150 s 内都没有收敛（a-pass2/L3-20km.png、b-canyon/L3-20km.png 都是模糊的粗级），这一级的最终画质没法确认。
- [fail] 地面层岩壁截面、岸坎、脚下起伏: 山口赤岩坡（pose=23.6005,111.9313,1414.23,163,8,28&mode=walk）：sampleTerrain 给出 ROCK_RED（rock 0.55，strata 0.15–0.77），但画面是光滑的沙丘状地面，没有露岩、岩层或碎石；近处一道崖坎的顶线是一排规则三角齿（a-pass2/L7-eye-rock.png）。这一帧最高只到 L15，最终纹理可能还会变，但三角齿是几何问题。峡谷堤顶眼高（b-canyon/L7-eye-levee-along.png、L7-eye-levee-across.png）：对岸 1–3 km 的台阶崖壁呈圆鼓的枕头状，看不到岩壁截面；Node 端剖面显示同一位置是 70–75° 的陡坎（34.8885N −105.22056E 方位 163°，1111→977 m 只有约 45 m 水平距离），这一差距可能部分来自没收敛。河岸只有约 1.2 m 高的沙堤，能看到岸坎，但岸线是锯齿（见 Z-04）。ZR3 陡崖坡面细化到 L20 后，脚下有裂隙网和陡壁冲沟（walk/c-escarp-walked.png），这里算合格。
- [partial] 相邻地形块无露底裂缝（含 wireframe / lod 图层）: Node 端：tileBuilder 生成的同级相邻瓦片，共享边高度和水位最大差都是 0（6 组，覆盖 L12–L17，三处地点都有；shots/qa-zoom/edges-node.mjs）。浏览器内：已收敛的帧里没看到透出天空的裂缝。但 wireframe 和 lod 帧拍的时候地形卡在 L2–L4（wire/a-lod-5km.png、a-wire-5km.png、b-wire-200m.png），细级瓦片边界没法检查。walk/a-rock-walked.png（L12）里一块巨大平面崖面的底部有一条笔直的暗带，疑似裙边露出来，没有核实，不作为缺陷提交。
- [fail] 水线对位: 河岸水线呈规则锯齿（缺陷 Z-04）：眼高横看对岸时近岸锯齿最明显，1 km 高度时两岸也是扇贝形；1 km 侧移 180 m 后，河宽在细化过程中从约 70 px 变到约 45 px（b-canyon/m-river2.png）。水面反射和对岸倒影的位置是对的。
- [partial] LOD 跳变（侧移前后与细化中对比）: 5 km 和 1 km 侧移，对比 150 ms、600 ms 和最终帧（a-pass2/m-5km.png、m-ridge-pop.png、b-canyon/m-1km.png）：山脊和台阶的大轮廓连续，没有大的形状跳变。但梳齿尖刺的大小和位置会随 LOD 变化（闪变），河宽会随细化跳变；粗瓦片换成细瓦片时地表会骤降 140–200 m（见 Z-01/Z-02 的步行轨迹）。
- [partial] 侧面视差 / 阴影与可见地形一致: 侧移帧对里视差符合地形；低角度阳光下山脊的向阳面和背阴面关系正确。但部分山脊的阴影边缘也是锯齿状的梳齿（a-pass2/crop-comb.png、crop-spike.png），原因与 Z-03 相同。地形停在粗级时，城市体块立在平坦的占位面上，与山脊地形不一致（Z-01）。
- [fail] 步行碰撞：坡地上脚底贴地: 地形收敛后合格：ZR3 坡面在 L20 时，射线距离 1.65005 m，眼高减去解析地面高度为 1.6500 m（walk/report.json c-escarp-walked）。细化过程中不合格：步行者站到粗瓦片上，比真实地面高 146–206 m，随后从 69–185 m 高处掉下；站在 L10/L12 瓦片上时，脚底仍比解析地面高 0.34–0.46 m（Z-02）。冷启动保持期间，相机比画出来的粗地形低 100–213 m（Z-01）。
- [partial] 拍摄环境 / 收敛说明: workers=3，视口 1600×900；同机还有 2 个其他 QA 的浏览器（slot 上限 3）。各步多数是 idle=false（busy=terrain，待处理任务 46–457 个），因此大部分观感判断都附了没收敛的说明。只报告在多处或多帧重复出现、或 Node 端用世界函数证实的问题。脚本和报告在 shots/qa-zoom/（zoomseq.mjs、jobs/*.json、各目录下的 report.json）。
## DEFECTS (5)
- Z-01 [major] <terrain-render> 冷启动或跳转到区域/近地机位后地形 2–3 分钟停在 L2–L5，城市先加载完，相机低于画出的粗地形，从地下看楼浮在天上
    repro: 新开页面（clean=1&workers=3）：(1) /?pose=23.767004,111.875219,6280.49,163,-28,35&time=2.138，等 139 s，再切 &debug=lod 和 wireframe；(2) 在同一页面 goto 34.874738,-105.188219,1159.98,253,-9,35（峡谷谷底上方 200 m），开 wireframe，等 112 s；(3) 新开页面 /?pose=34.8703,-105.2138,958.751,163,-15,28&mode=walk&time=21.214，等 144 s；(4) /?pose=13.2318,-18.4375,1563.268,20,-20,28&mode=walk&time=17.029，等 140 s
    evidence: shots/qa-zoom/wire/a-lod-5km.png（139 s 后整片地形仍是 L2 的绿色平面，城市体块已加载完）、wire/a-wire-5km.png、wire/a-clean-5km.png（约 200 s 后最高只到 L5，看不到山脊）、wire/b-wire-200m.png（HUD 显示「离地 −556 m」，terrain levels 只有 0–3，地面消失，街道和楼浮在天空里）；walk/report.json：b-levee-start 的 eyeOverTile = −213 m，c-escarp-start 的 eyeOverTile = −100 m，walk/c-escarp-start.png。同机有其他 QA 浏览器负载。
    expected: 先建地形：相机所在位置及其上方的瓦片应该优先细化到能覆盖相机高度，地形没就位时城市不应先立在占位面上；画面里不应出现相机在地表以下、地面消失、楼体悬空的情况。
    actual: 城市体块先加载完，地形却长时间停在 L2–L5；保持的相机比粗地形低 100–556 m，看到的是地表背面，楼和街道浮在天上，山脊完全没有。
    suggestion: 排查以下几点：worker 队列里 terrain 与 city 任务的优先级（相机下方及头顶的瓦片应加最高优先级）；_cancelStale 按帧数作废请求，低帧率下可能反复作废，形成活锁；相机低于已画瓦片时是否该强制立即细化，或者让城市体块等地形就位后再显示。
- Z-02 [major] <controls> 步行地面取 max(粗瓦片, 解析高度)：步行者被抬到粗瓦片上 146–206 m，瓦片细化后从 69–185 m 高处掉下
    repro: 新开页面 /?pose=23.592,111.9344,1526.382,163,-20,28&mode=walk&time=2.138&clean=1&workers=3，等约 140 s（地形还在细化）后按住 W 8 s、D 4 s；同样操作 /?pose=34.8703,-105.2138,958.751,163,-15,28&mode=walk&time=21.214（按住 W 6 s），以及 /?pose=13.2318,-18.4375,1563.268,20,-20,28&mode=walk&time=17.029（W 8 s、A 4 s）
    evidence: shots/qa-zoom/walk/report.json：a-rock-start 请求的 alt 为 1526.38，实际 alt 1672.45，站在 L4 瓦片 1670.80 上，比解析地面 1524.47 高 148 m；a-rock-walked 轨迹末尾 hag 69.07，grounded false；c-escarp-walked 轨迹里 feetH 从 1559.59 跳到 1765.41（+206 m）；b-levee-walked 轨迹 feetH 1141.7，而 terrainH 已变为 966.8（hag 176.5）；最终仍站在 L10/L12 瓦片上，比解析地面高 0.34 / 0.46 m（eyeOverAnalytic 1.989 / 1.652，rayDist 2.114）。截图：walk/a-rock-start.png、walk/a-rock-walked.png、walk/m-walk.png
    expected: 步行的脚底应始终在最终地面上（与 ARCHITECTURE §8「never lifted by coarse tiles」一致），或者与正在显示的地形连续一致；地形细化时不应出现上百米的抬升和坠落。
    actual: 保持状态一释放，步行者就被抬到比真实地面高 146–206 m 的粗瓦片上；瓦片细化后从 69–185 m 高处自由落下。
    suggestion: 步行地面以解析的 heightAt 加碰撞体为准，粗瓦片只用来兜底防止穿模（而且只在瓦片低于解析高度时才参与）；或者在地形未细化前继续保持步行。
- Z-03 [major] <terrain-fn> range-zr1w 赤岩坡面的陡坎是没有频带限制的高度断层，在各级网格上混叠成梳齿和针状尖刺，并随 LOD 闪变
    repro: /?pose=23.767004,111.875219,6280.49,163,-28,35&time=2.138&clean=1；/?pose=23.664751,111.909393,2280.49,163,-18,35；/?pose=23.635413,111.919188,1480.49,163,-9,35；眼高：/?pose=23.6005,111.9313,1414.23,163,8,28&mode=walk。Node 端：node shots/qa-zoom/fin.mjs 23.47 111.976 73 600 900 10
    evidence: shots/qa-zoom/a-pass2/crop-comb.png（5 km 时山脊上成排的三角齿阴影）、a-pass2/L5-1km.png、a-pass2/L6-200m.png（山脊天际线是一排针状尖刺，坡面中部也有锯齿列）、a-pass2/L7-eye-rock.png（眼高看到崖坎顶线是规则三角齿）、a-pass2/m-ridge-pop.png（细化前后齿形不同）。Node：同一剖面在 minW = 2/20/80 m 时都在 10 m 内从 2052 m 陡降到 1972 m，三个结果完全相同；spike.mjs 测到最大坡度 8.8（约 83°）。
    expected: heightAt(minWavelength) 应对所有地形特征做频带限制（ARCHITECTURE §5：短于 2·minWavelength 的成分应淡出）。陡坎可以锋利，但每一级网格上应该是连续的陡面，不应在网格上混叠成齿。
    actual: 80 m 的台阶式陡坎是硬断层，与 minW 无关；在 L12–L18 网格上变成梳齿、尖针和三角齿，天际线不自然，移动时还会闪变。
    suggestion: 把 relief.js 里的陡坎、岩层、阶地这类阶跃函数，按 minWavelength 做平滑（例如 smoothstep 宽度不小于 minW），让粗级平滑近似、细级再锐化；同时检查 terrain-render 的 normal map 是否会放大同一断层。
- Z-04 [major] <terrain-render> ZR2 河岸水线呈规则三角锯齿（约 25 cm 周期，即网格三角形），细化过程中河宽会跳变
    repro: /?pose=34.86995,-105.21364,962.851,163,2,28&mode=walk&time=21.214&clean=1（北堤顶，眼高横看河面）；1 km 高度：/?pose=34.883696,-105.152451,1959.98,253,-18,35，然后侧移到 34.886605,-105.153535（同样的高度和朝向），对比 150 ms 帧与 60 s 后的帧
    evidence: shots/qa-zoom/b-canyon/L7-eye-levee-across.png 与 crop-waterline.png（近岸水线是连续的直角三角齿，土色三角形一个个顶出水面）；b-canyon/m-river2.png（1 km 时两岸也是扇贝形锯齿，侧移细化后河宽从约 70 px 变成约 45 px）；顺河方向的帧 b-canyon/L7-eye-levee-along.png 在掠射角下较平滑。
    expected: 按 ARCHITECTURE §8，浅岸湿顶点应下压到 level − 0.3 m，让可见水线跟随 mask 等值线，而不是让粗三角形顶出水面；水线不应随 LOD 明显移动。
    actual: 岸边的地形三角形穿出水面，水线沿三角形对角线成齿状；河道覆盖范围随瓦片级别和纹理分辨率变化而跳变。
    suggestion: 检查 tileBuilder 中堤岸型河道（河面高于堤后地面 2–3.5 m 的悬河，堤顶只高出水面 1.2 m）的湿顶点下压条件；必要时由 water 用 mask 等值线在片元里裁剪覆盖，对齐近岸三角形的奇偶对角线。
- Z-05 [major] <terrain-render> 全盘尺度看不出所选山脊（range-zr1w）和河谷（ZR2 西陆峡廊），只有 ZR1 赤裂谷能看成一条线
    repro: /?pose=23.615,111.926,17900000,0,-90,50&time=2.138&clean=1（以山口为中心的全盘）；?bookmark=TW90（ZR2 星形城区）
    evidence: shots/qa-zoom/a-pass-run1/L0-orbit.png 与 L0-orbit-crop.png（山口所在位置只看到白色城区的边缘，看不出岩脊地形和山口走廊）；shots/qa-zoom/TW90-zr2-crop.png（ZR2 白色星形城区里看不到峡谷或河道）；对比 1000 km 帧 a-pass-run1/L1-1000km.png，同一岩脊在那里非常清楚。
    expected: §6：全盘读得到走向；§1：干燥高地露出连续赭红岩骨，山脊让建设带中断（参考 A03 中的红色岩脊和峡谷在全盘尺度就清晰可辨）。
    actual: 全盘尺度下岩脊与周围的红色荒原明度、色相几乎一样，起伏阴影也不够；ZR2 峡谷（台阶宽 6–10 km）在白色城区里约 1 px，完全被吞掉。
    suggestion: 加大轨道尺度的 uTrExag 起伏增强和岩体/荒原的色调对比（岩骨更深、更饱和），给峡谷底部和崖壁加深色带，或在轨道级纹理里保留峡谷暗线；也可请 terrain-fn 评估在全盘尺度能否读出这些特征的宽度。

######## QA #6
## SUMMARY
qa-assets（§6 游戏级资产与清晰分栋 + 抽查 5 尺度与锐度）验收，被测为 13cc425 生产构建 @4300。测试期间机器负载 220–360，浏览器槽位上限 3、排队约 8 个任务，我等了约 2 小时才拿到一次槽位。拿到后跑了 8 个视点，每个只等了 68–139 s，没有一个达到 idle（共享 worker 15 分钟内只完成 43/292 个作业）。凡是靠图片下的结论都以这一点为前提。

【能确认的】
- ZR1 周边式街坊 170 m 鸟瞰：各楼的体量、层数差（7/8/11 层）、共墙处的高差、各自的入口（弧形雨棚、台阶、扶手、玻璃双开门）、屋顶收边和设备（女儿墙、楼梯间、风帽、空调、水箱、落水管）都清楚，内院背立面同样做到了细部。
- ZR5 立面近看：窗洞有约 0.24 m 的真实进深，有窗台、窗框和中梃，室内映射能看到家具纵深，陶瓷板缝清楚。Node 检查确认楼板与窗对齐（没有跨楼板的玻璃）。
- ZR1 二层起居室是真实、可用的房间。
- Node 统计 ZR1/ZR3/ZR5 共 140 栋住宅，所有非共墙面都开了窗，没有只有正面的对象。
- 所有用途都有专用类型模块，没有 generic 占位。
- 尺度：门净高约 2.3 m，阳台栏杆约 1.04–1.1 m，人高 1.58–1.84 m，都合理。
- 全程没有控制台错误。

【没能确认的】行人视角绕楼一周在 4 个片区都没成功（缺陷 D1）：街面视点下显示的地形和城市与相机所在的真实地面相差一层到数十米。ZR1 相机越过屋顶，ZR3 从下方看到楼底，OX1 站在屋顶高度，S07 站台俯视只看到天色。

【新缺陷】
- D1（major）：上面这种街面错位。
- D2（major）：ZR5 进深约 11.3–11.8 m 的两户板楼里，每层都有厨房、卧室或卫生间进不去（ZR5 抽 5 栋中 4 栋，ZR1/ZR4/ZR3 抽样都正常）。
- D3（minor）：轨距按轨头中心取值，内侧轨距只有 1.365 m。
- D4（minor）：室内家具是盒子拼成、没有材质。

walk-buildings 对 OX1 宿舍报 0/67、对 ZR1 报 backDoorOutside=false，我用真实地形剖面核过，是工具把街面当成取最低角的平面造成的假象，不算缺陷。已知的 ZR1 远处体量模型不可见问题按要求未报告。
## CHECKS
- [partial] ZR1 住宅片区·一个街区距离（150–300 m）观察主楼、邻楼与巷道: 只拿到正面一个朝向：/?pose=22.0033475,118.0125671,631,223.39,-18.91,50&time=2.633&clean=1&workers=3&mode=orbit，170 m、50 mm，185 s 时仍未 idle。证据：shots/qa-assets/zr1/a-front.png，以及放大图 crops/zr1-a-front-entr2.png、zr1-a-front-roof2.png。
通过的部分：ZR1-0.3.1a5.17z-2.5-12 和它两侧的 -2.5-11、-2.5-13 体量与层数都能分开，共墙处有高差；每栋都有自己的入口（弧形雨棚、台阶加扶手、玻璃双开门带侧窗）；屋顶有女儿墙、带门的楼梯间、风帽、空调机组、水箱和落水管；内院一侧的背立面同样有阳台和窗。
不足：街区整体偏灰白、对比低，170 m 外看不出路缘和车行道；立面基本是小窗加横带，邻楼之间材质和颜色几乎一样，只靠层数、波形带和花池区分。另外三个朝向因为浏览器槽位排队没有拍到。ZR3/ZR5/OX1 只有 ZR3 坡地一张非 idle 的鸟瞰任务排上，后来被裁掉，没有执行。
- [fail] 行人视角（1.65 m）绕楼一周：ZR1 / ZR3 / ZR5 / OX1 城镇: 8 个人眼视点在 68–139 s 内都没有 idle（共享 worker 15 分钟只完成 43/292 个作业），画面都不能用来判断，原因见 D1。具体情况：
- ZR1（zr1/e-front.png、e-back-right.png）：相机高出 8 层楼的屋顶。
- ZR3（zr3/e-front.png、zr3slope/e-front-left.png）：城市浮在相机上方，看到的是楼底和阳台底板。
- OX1（ox1/e-front.png）：相机站在宿舍屋面的高度。
- ZR5（zr5/e-front.png）：画面最下面一排是上层窗，看不到地面。
所以背面、侧面、墙脚与地面的接合都没能做人眼复核。资产本身没有判退，判退的是这次的观察条件。截图都在 shots/qa-assets/。
- [pass] 近看构造：窗洞进深、楼板对位、窗框与板缝: 图片：shots/qa-assets/zr5/e-front.png，以及放大图 crops/zr5-window.png、crops/zr5-balcony.png。可以看到窗框退进墙面、有窗台挑出、有中梃和亮子，室内映射能看到衣柜、书桌、门把手这类纵深；陶瓷幕墙分格缝清楚；每层的波形楼板带有圆角收口和暖色底面，窗都夹在两条板带之间；阳台有玻璃栏板和扶手。
Node 检查（shots/qa-assets/winalign.mjs ZR1-0.3.1a5.17z-2.5-12）：玻璃退进外墙面中位数 0.244 m（0.195–0.27 m）；8 层都没有跨楼板的玻璃，标准层窗台 +0.05、窗顶 +2.39 m，背立面落地门到 +3.07 m。
保留意见：截图时还没 idle，TAA 没收敛，画面偏软；花池植物这时还像未完成材质的尖角团块和灰蓝色烟雾状垂吊植物，因为非最终态，没有作为缺陷报告。
- [partial] 入口构造（雨棚、台阶、门）与门高对 1.7 m 人: 鸟瞰放大图 crops/zr1-a-front-entr2.png 能看到弧形雨棚、台阶加金属扶手、玻璃双开门和两侧固定玻璃，坡道和扶手也在。
Node 量了 'full' LOD 的几何（shots/qa-assets/scale.mjs）：ZR1、ZR5、OX1 主入口门框高 0–2.75 m，玻璃门扇 0.23–2.68 m，相当于门净高约 2.3 m 加亮子；ZR3 住宅门框 0–2.30 m。人模型成人身高 1.58–1.84 m（props/people.js personScale），比例合理。
缺口：没有拿到有效的人眼画面，门旁站人的直观对比没做成；OX1 宿舍入口用真实地形剖面核过（shots/qa-assets/entrywalk.mjs），台阶底部落在地形上，可以走上去。
- [pass] 屋顶收边与屋顶设备: 170 m 鸟瞰放大图（crops/zr1-a-front-roof2.png）和两张意外拍到屋顶的帧（zr1/e-front.png、zr1/e-back-right.png）显示：女儿墙加压顶；楼梯间带门；屋面有风帽、空调和热泵机组、水箱、天线、卫星锅；落水管沿立面下来；矮楼和高邻楼之间的共墙在屋面以上做成实墙（e-back-right.png 左侧）。
Node：四栋样楼都有 anchors.roof.access（屋顶出口）。屋面边缘构件顶部高出屋面：ZR1 1.56 m、ZR3 1.41 m、ZR5 1.08 m、OX1 2.00 m，都达到约 1.1 m 的护栏高度。
- [partial] 内部可使用的房间: 游戏内看 ZR1-0.3.1a5.17z-2.5-12 的二层起居室（buildingView 'living'，截图 shots/qa-assets/zr1/v-living.png，walk 模式，眼高 566.5 m 正好在二层楼板上）：有沙发、茶几、书架、电视柜、地毯，落地推拉门外是阳台，窗外对面楼的楼层高度对得上。
Node 可达性检查（scripts/walk-buildings.mjs，胶囊半径 0.28 m、台阶 0.35 m）：
- ZR1 共 5 栋，119/119、97/97、175/175、185/185、159/159，全部可达。
- ZR4 共 3 栋，138/138、138/138、107/107，全部可达。
- ZR3 联排住宅 11/11，可达。
- ZR5 抽 5 栋，有 4 栋每层都有房间进不去，见 D2。
家具偏粗糙，见 D4。
- [partial] 联排/共墙可读性（分户入口、屋脊、共有墙）: ZR1 周边式街坊在鸟瞰里能读出来：每栋有独立入口和雨棚，相邻楼高度不同时共墙露出实墙，屋顶各有自己的楼梯间。
ZR3 低层联排（ZR3-4.3.iy.16b-7.n12-14…-18，2–5 层，左右共墙，平屋顶和坡屋顶混排）只在 Node 层面核对过：每户各有前门和后门；坡屋顶在 kit 里有共墙挡水墙（pitchedRoof partyA/partyB）。
人眼画面因为 D1 没法看。
- [partial] 共用模块保留实例差异: ZR1 同一街坊里各楼的层数（7/8/11/13）、面宽、入口位置、波形带的起伏幅度、花池密度、屋顶设备布置都不一样，鸟瞰里能看出来。代码 kit/styles.js styleInstance 也按 hash 改变陶瓷色调、窗框深浅、栏杆形式、阳台节奏、窗型、遮阳和百叶、屋顶花园等。
不过同一风格内邻楼在 170 m 处读起来颜色和材质几乎相同，区分主要靠体量。另外 ZR5 的 'Z-port' 实际解析成和 ZR1 相同的 zr_ceramic 风格，属于 §3 允许的同系做法，没有判退。
- [pass] 背面与侧面（判退仅有正面的对象、空壳、占位盒）: Node 按立面统计 'exterior' LOD 的玻璃面积（shots/qa-assets/facades.mjs）：
- ZR1 50/50、ZR3 40/40、ZR5 50/50 栋住宅，非共墙面都有开窗，背面窗面积和正面相当（例如 ZR3 联排正面 6–11 m²、背面 6–9 m²）。
- OX1 80 栋里有 4 处空白面：2 栋社区活动室的后勤背面、2 处联排端山墙，属于合理做法。
所有用途都有专用类型模块（shots/qa-assets/types.mjs），没有 generic 占位。'full' LOD 有楼板、交通核、走廊、房间和碰撞体，不是空壳；ZR1 鸟瞰里内院背立面也做到了细部。
- [partial] 与地形的关系（台基、坡地、墙脚）: Node（shots/qa-assets/slopes.mjs，ZR3 九块瓦片共 5461 栋）：高差最大的 12 栋（四角高差 4.4–6.8 m，例如 ZR3-4.3.iy.16b-3.n6-0 是 89 m 长的板楼，四角 1823.5–1830.3 m）的几何底面都低于最低角（台基埋入地下 0.6 m 以上），没有悬空。kit 会去掉被埋住的窗、生成挡土台阶（assemble.js emitBase / plinth.js retainingSteps）。
坡地人眼帧 zr3slope/e-front-left.png 因为 D1 无效，台基和挡土墙没有做视觉复核。
- [partial] 尺度：轨距 1.435 m、栏杆约 1.1 m、门高对人: 栏杆：阳台玻璃栏板高出各层楼板 0.29–1.04 m，加上扶手约 1.1 m，样楼每一层都符合。
门：净高约 2.3 m，人身高 1.58–1.84 m，比例合理。
轨距：streetBuild.js:918 把钢轨中心放在 ±GAUGE/2（0.7175 m），轨头宽 0.07 m，内侧轨距只有 1.365 m，见 D3。
站台人眼俯视帧 scale/platform-down.png 因为 D1 只有一片天色，没能拍到轨道。
- [partial] 抽查 5 各尺度缺什么（轨道 / 区域 / 街面与人 / 材料接缝）: - 轨道层的城市纹理：本模块没有测，由其他 QA 覆盖。
- 区域层：170 m 鸟瞰里路面和广场几乎同色、偏白，路缘、车道和人行道分不出来，行道树尚可，车辆和人很小。
- 街面构造与人：没有拿到有效画面（D1）。人模型代码是 8 边车削体加球形头、没有五官（props/models.js buildPerson），但我自己的画面里没有近景人物能复核，所以没有作为缺陷报告。
- 材料接缝：ZR5 立面陶瓷板缝、窗框、窗台边、板带圆角都看得清，但非 idle 状态下 TAA 没收敛，偏软；室内家具没有材质细节（D4）。
- [pass] 控制台与稳定性: run.mjs 两次会话共 10 个步骤，console error、warning、pageerror 都是 0（报告：shots/qa-assets/jobA.report.json）。第一次会话中的截屏超时，是机器负载造成的，不是页面崩溃。
## DEFECTS (4)
- QA-ASSETS-01 [major] <terrain-render> 跳到街面人眼视点后，显示的地形和城市整体偏离相机所在的真实地面（一层到数十米），持续超过 2 分钟
    repro: 1) 冷启动打开 http://127.0.0.1:4300/?pose=22.0014739,118.0106569,561.25,223.39,12,20&time=2.633&clean=1&workers=3&mode=walk（ZR1，ZR1-0.3.1a5.17z-2.5-12 正面 9 m，眼高 = 解析地面 559.6 + 1.65）。等 128 s（机器负载约 300）后截图。
2) 在同一页面依次 __MARS__.goto({pose:…, mode:'walk'}) 到以下位置，每处等 68–139 s：
- ZR3 21.2511252,-15.000176,1860.86,55.35,12,20（time 15.5）
- ZR3 坡地 21.2578552,-15.0107125,1831.1,10.35,6,20
- ZR5 -42.8008428,105.7016189,20.79,312.92,12,20
- OX1 9.0503125,106.250669,190.28,278.82,12,20
- S07 站台 21.870419,117.9976605,544.88,313.67,-38,35
controls.holdInfo() 都显示 {walk:true, lifted:0}，相机就在请求的真实眼高上。
    evidence: shots/qa-assets/zr1/e-front.png（相机高出 8 层楼的屋顶）
shots/qa-assets/zr1/e-back-right.png（站在 2.5-12 屋面上，看到邻楼共墙）
shots/qa-assets/zr3/e-front.png、shots/qa-assets/zr3slope/e-front-left.png，以及放大图 crops/zr3slope-top.png（建筑悬在头顶，看到楼底、阳台底板和挂在下面的台阶）
shots/qa-assets/ox1/e-front.png（站在宿舍屋面高度）
shots/qa-assets/scale/platform-down.png（俯视 38° 只看到天色）
报告 shots/qa-assets/jobA.report.json：idleOk 全为 false，worker 完成 13/55 到 43/292。
    expected: 街面视点一落地，相机脚下和周围就应该是精确地形，建筑站在各自的 spec.ground 上（§1「相邻地块预载后再展开高细节几何，使变焦途中建筑位置、地形轮廓和邻接关系连续」）。也就是说相机下方的地形瓦片要最先细化；在细化完成前，相机、地形和城市至少要用同一个参考面。
    actual: 相机按解析地面固定在真实眼高，但显示的仍是误差几十米的粗级地形瓦片：体量模型按粗地形下沉或抬升（±60 m），细节建筑立在 spec.ground，两者都和相机对不上。结果是在 ZR1 越过屋顶俯看，在 ZR3 和 S07 站台从地下仰看楼底或只看到天色，在 OX1 站在屋面高度。等了 68–139 s 都没有恢复。
    suggestion: terrain-render：相机离地低于约 50 m 时，把相机所在及相邻的瓦片排到最高优先级（必要时绕开共享池积压），并尽快给出足够细的高度；粗瓦片在相机附近的竖向误差应在几米以内。city 和 controls：细化完成前，相机和城市应该用同一个参考面（例如相机暂时跟显示地面走，或近处体量不做 seat 偏移）。注意本次机器负载在 220–360 之间，现象被放大了，但正常负载下同样存在这个时间窗口。
- QA-ASSETS-02 [major] <building-kit> ZR5 浅进深两户板楼的 'full' 室内：每层都有厨房、卧室或卫生间进不去（封闭或门被堵）
    repro: 在 web/ 下运行：
node scripts/walk-buildings.mjs --id ZR5-0.3.12d.p-5.n8-5,ZR5-0.3.12d.p-4.n8-12,ZR5-0.3.12d.p-5.n8-4,ZR5-0.3.12d.p-5.n8-6 --verbose
平面图：
node scripts/walk-buildings.mjs --id ZR5-0.3.12d.p-4.n8-12 --png shots/qa-assets/walk-zr5b-f1.png --floor 1 --scale 8
同一工具对 ZR1 5 栋、ZR4 3 栋、ZR3 1 栋、ZR5-0.3.12d.p-5.n7-0 都是 100% 可达。
    evidence: shots/qa-assets/walk-zr5-f1.png（ZR5-0.3.12d.p-5.n8-5 二层：左前角厨房整块是红色，即可走地面但进不去，四周没有缺口）
shots/qa-assets/walk-zr5b-f1.png（ZR5-0.3.12d.p-4.n8-12 二层：右户的次卧、核心旁卫生间和书房都是红色）
房间表：node shots/qa-assets/rooms.mjs ZR5-0.3.12d.p-5.n8-5 1（厨房在 (-6.63,4.18)，3.66×2.99 m，和门厅 (-5.53,1.79) 共边 3.66 m，但没有能通行的门洞）。
    expected: §1 和 §6 要求每栋楼的房间都能用：门厅或走廊进户后，厨房、卫浴、卧室都有门可进（kit/plan.js repairDoors 的目标）。
    actual: 下列每栋都从首层到顶层逐层重复：
- ZR5-0.3.12d.p-5.n8-5：98/109，11 间厨房不可达。
- -5.n8-4：厨房和一间卧室不可达。
- -5.n8-6：厨房和卫生间不可达，楼层可达率 62%。
- -4.n8-12：卫生间和两间卧室不可达，楼层可达率 58%。
这几栋进深都在 11.35–11.79 m，进深 ≥ 12.7 m 的样楼都正常，看起来是浅进深两户加中央核心的平面在补门时失败（或门洞被家具堵住）。
    suggestion: 对进深不超过约 12 m 的两户方案，把 repairDoors / furnishRoom 的结果再跑一遍连通性检查；对不可达的房间强制在最长共边上开门，并清出家具。把 walk-buildings 的城市抽样（尤其 ZR5 'Z-port' 浅板楼）加进回归测试。
- QA-ASSETS-03 [minor] <city> 轨道几何的内侧轨距只有 1.365 m，不是标准轨距 1.435 m
    repro: 读 src/render/city/streetBuild.js 第 918–923 行：for (const rs of [-G.GAUGE / 2, G.GAUGE / 2]) 把钢轨中心放在 ±0.7175 m，轨头宽 ±0.035 m。由此内侧作用边间距 = 1.435 − 0.07 = 1.365 m。props 列车轮对中心 ±0.72 m（props/models.js 第 459 行）也按这个间距对齐。
    evidence: 代码：src/render/city/streetBuild.js:918-923（GAUGE 取自 src/buildings/types/z_station_geom.js:27）。没有渲染图：站台俯视帧 shots/qa-assets/scale/platform-down.png 受 QA-ASSETS-01 影响只拍到天色。
    expected: 标准轨距 1.435 m 是两根钢轨轨头内侧作用边之间的距离（§6 抽查 5「用门高、轨距和栏杆作比例检查」），所以钢轨中心距应约为 1.505 m。
    actual: 内侧轨距 1.365 m，窄了 70 mm（约 4.9%）。
    suggestion: 把钢轨中心放到 ±(GAUGE/2 + 0.035)；props 的轮对横向位置同步改成 ±0.7525 左右。
- QA-ASSETS-04 [minor] <building-kit> 住宅室内家具是盒子拼成、没有材质，离游戏级近景还有差距
    repro: __MARS__.app.controls.buildingView('ZR1-0.3.1a5.17z-2.5-12','living',{lens:24,instant:true})，walk 模式，二层起居室，local 10:30（time=2.633）。
    evidence: shots/qa-assets/zr1/v-living.png
    expected: §1 和 §6 要求人眼高度下房间能用，而且是游戏级资产：家具有倒角、软包、织物和木纹等材质，室内采光有层次。
    actual: 房间布局合理（沙发、茶几、书架、电视柜、地毯、阳台推拉门，窗外邻楼对位正确），但沙发是三块方盒叠成，书架里的书是素色方块，织物和木材都是单色、看不到纹理；靠近玻璃门处室内仍偏暗、偏平（截图时未 idle，TAA 偏软）。
    suggestion: 给 furniture 加倒角、软垫圆角和织物、木纹的细节纹理；书和杂物按实例随机变化；窗边室内采光加强。这是打磨项，不影响可用性。
## BOOKMARK CORRECTIONS

######## QA #7
## SUMMARY
qa-spot 抽查了 §6 的 1、2、4 项。被测构建：13cc425，地址 http://127.0.0.1:4300。证据都在 shots/qa-spot/。测试时机器负载均值在 336–359 之间（10 核），所有书签帧到 180 s 仍未进入 idle，轨道视图约 20 分钟后才收敛。另有 5 张 clean 截图因 page.screenshot 超过 30 s 而缺失。所以画质结论只针对几何、布局和功能，不判断纹理是否到位。
抽查 1：不通过。四个转台加 S02 在 320 px 下能分出星状浅银城带、夜间亮核和暗水，但主视图 S01 只有 1 个夜侧都市亮核（ZR5 的西半边），ZR4 和云团混在一起，ZR5 很淡。另外两个问题：夜面铺满与地块无关的随机散点；富氧水网在 320 px 下读不出来。
抽查 2：部分通过。四经度画面重投影到经纬网后，地形、海岸和城带对得上；ZR1/ZR3/ZR4/ZR5/ZR2/OX2 白天的城带和夜灯位置重合，可以确认城市只随地表旋转。问题有三：大量夜灯落在没有任何建筑的地方；objectId/province 调试层随昼夜变色，全盘尺度也没有城市 ID 色，抽查 2 要求的 ID 通道叠加做不了；time 在 15 和 3 之间切换后云不复原。
抽查 4：不通过。随机抽到的 4 栋楼（ZR2/ZR1 各一栋商住楼，OX5/OX3 各一栋宿舍），ID 能重生成，层高规则统一，楼梯每层都通，门洞是开的，窗外能看到邻楼，各省按同一规则生成，「存书签」回访 4/4 都准。但「存视点」保存的屋顶和二层视点，重载后回访 8 次全部落到别处，有一次进了另一栋楼的室内。街对面和后院视点有 3 处落进邻楼体内。冷启动回访时相机在显示地形下方，画面变成从地下仰看城市。
## CHECKS
- [fail] 抽查1 全盘识读（S01/S02/TE0/TE90/TE180/TW90 缩到 320 px）: 用 capture-shots 拍 1600×900，均未 idle（190–230 s，workers pending 39–110），再按线性光缩到 320 px，见 s320/all-320.png 和 s320/*-320x3.png。S01：日侧只有 ZR1 的分叉浅银城带一眼可辨；ZR4 在右缘，城区和同亮度的云团混在一起；ZR5 在底部跨晨昏线，只剩淡灰斑。夜侧三分之一只有 ZR5 西半边一团灯，其余是均匀散点（crop-S01-night-x3.png），不满足至少两个夜侧亮核。暗水和赤岩间断清楚。S01 主视图因此不通过（D1）。S02：左上 ZR2 和右缘 ZR3 两个亮核加西内海暗水，通过。TE90：ZR1 和 ZR5 两核，通过。TE180：ZR4 一核。TE0 和 TW90 日侧的 ZR3、ZR2 星状城带清楚，城地明度对比足够。共性问题：夜面均匀散点把暗部抬成褐色底噪（D5）；富氧水网在 320 px 下不可读（D7）；云和城区都是浅色，小图里容易混淆。S01 底部 ZR5 附近有一块直边灰块，两次独立截图都出现，但都没收敛，未作为缺陷上报。
- [partial] 抽查2 旋转与换时（四经度 × time 15/3，clean + debug=objectId/province）: 脚本 tt.mjs，输出在 tt/*.png。用 reproj.mjs 把四个经度的 time=15 画面重投影到等距经纬网（rp/t15-mosaic.png）：相邻视图重叠区的地形、海岸和城带亮度一致（rp/t15-pair-*.png 中为黄色），省域和巨构标签在两个时刻位置不变，province 层的省界在两个时刻一致。用 overlay.mjs 叠加昼夜（tt-E0/E90/E180/W90-overlay.png）：白天浅银城带（红）和夜灯（绿）在 ZR3、ZR1、ZR5、ZR4、ZR2、OX2 处重合成黄色，红色单独区域都是云。结论：城市只随地表旋转，昼夜只改变受光，这一点通过。未通过的部分：大量夜灯在没有地块的地方（D5）；ID 和数据调试层随昼夜变色，全盘尺度没有城市 ID 色可叠加（D6）；云场在 ±12 h 切换后路径相关、不复原（D8）。轨道瓦片约 20 分钟后才 idle，objectId/province 两轮均已 idle。
- [fail] 抽查4 任意落点（两区各两省，随机普通建筑）: 用 Math.random 抽省：Z 抽到 ZR2、ZR1，O 抽到 OX5、OX3。再用 pick.mjs（seed 1794790854）在各省内随机找城块、随机挑 ≥2 层的普通楼：ZR2-1.3.p4.1ho-n4.3-11（shop_row 4F，Z-terrace）、ZR1-0.3.1c7.19m-n1.4-9（shop_row 11F，Z-ceramic）、OX5-3.3.30.1j9-7.n10-1（dorm 2F，O-utility）、OX3-1.3.7d.10a-n8.3-1（dorm 3F，O-levee）。流程 visit.mjs：轨道 → 30 km → 1.2 km → UI 选中并环看 → street/back/roof/living(2F) → objectId → UI「存视点」+「存书签」→ 重载页面 → 按书签回访。通过项：buildingSpecById 由 ID 重生成的结果与城块一致；首访各视点中心拾取的 16 次中 13 次是目标 ID（另 3 次见 D3）；objectId 下目标、邻楼、树、行人各自分色。节点数据检查（bldg.json）：首层层高 Z 商住 4.8 m、O 宿舍 3.4 m，标准层 3.1 m；楼梯间每层都有可站楼板；门洞射线全部穿过，门侧 2.6 m 的墙体是闭合的。2F 起居室窗外能看到对街或后院的邻楼（ZR2/ZR1/OX5-v-living.png，window.jsonl）。同一用途跨省用同一套房间程序，风格按省区分。「存书签」按当前位姿回访 4/4 完全一致。失败项：D2（视点书签回访错位）、D3（视点落进邻楼）、D4（冷启动地下视角 / 环看贴楼）。说明：阳台和室内植物显示为色块碎片，与 building-kit 收敛截图不同，判断为纹理尚未加载，未上报。
- [partial] 测试环境与收敛（证据说明）: 负载均值 336–359（10 核），browser slot 被占满。capture-shots 在 180 s 内都没 idle。tt.mjs 的轨道帧到第 13 张（约 20 分钟后）才 idle，之后每帧 8–17 s 就 idle，说明不存在永不 idle 的问题。近景帧都是 30–60 s 未 idle 时拍的，有 5 张 clean 截图因 page.screenshot 超时 30 s 缺失：ZR2-v-street、ZR2-v-back、ZR1-v-street、OX5-v-roof、OX5-R-street。所有缺陷都附了数据层证据（node 脚本输出、拾取结果、位姿差），尽量不依赖纹理是否到位。已知问题 ZR1 300 m–3 km 体量模型不可见，对本次各帧没有决定性影响（ZR1-2-district.png 中楼群完整）。
## DEFECTS (8)
- QP-01 [blocker] <lead> S01 主视图缩到 320 px 只能指认 1 个夜侧都市亮核，日侧第 2、3 片城区分别被云和晨昏线吞掉
    repro: node scripts/slot.mjs --slots 3 -- node scripts/capture-shots.mjs --base http://127.0.0.1:4300 --only S01 --out shots/qa-spot/cap --width 1600 --height 900 --query "&workers=3"；然后 node shots/qa-spot/img.mjs down shots/qa-spot/cap/S01.png S01-320.png 320（或 sips -Z 320），不看说明，直接在小图上指认。
    evidence: shots/qa-spot/cap/S01.png；shots/qa-spot/s320/S01-320x3.png；shots/qa-spot/crop-S01-night-x3.png（夜侧提亮 3 倍）；shots/qa-spot/crop-S01-right.png；shots/qa-spot/crop-S01-bottom.png
    expected: §5 01 和 §6 抽查1：缩到 320 px 后，仍能凭轮廓指出三片日侧城区、至少两个夜侧都市亮核，以及一处红岩或暗水间断。
    actual: 日侧只有右上的 ZR1 分叉城带清楚。ZR4 在右缘，浅银城区和同样亮的云团混成一片。ZR5 在底部压在晨昏线上，只剩淡灰斑。夜侧三分之一里只有 ZR5 西半边一团暖灯（左下），其余是均匀散点，没有第二个都市亮核。
    suggestion: 调整 S01 的 solTime / subsolarLat / pose。例如让晨昏线压过 ZR1 或 ZR5 的城核，使两个城核都有夜侧部分，同时让 ZR4 和 ZR1 东臂留在日侧；或者把镜头中心东移。另外配合 QP-05 去掉散点底噪、降低城区上空的云量，让亮核从背景里跳出来。
- QP-02 [major] <controls> 「存视点」保存的屋顶 / 二层起居室视点，重载后回访落到别处（街沿、一层店面外，甚至另一栋楼室内）
    repro: 1) 打开 /?workers=3；2) __MARS__.ui.selectBuilding('ZR1-0.3.1c7.19m-n1.4-9',{fly:false})，再 await __MARS__.app.controls.buildingView(id,'roof') 和 'living'；3) 点建筑面板「存视点」；4) 同一浏览器配置下重新加载页面；5) 用 __MARS__.bookmarks() 找到该楼 view='roof' / 'living' 的书签，执行 await __MARS__.goto(bmId,{instant:true})，约 45 s 后看画面并调用 controls.pick()。ZR2-1.3.p4.1ho-n4.3-11、OX5-3.3.30.1j9-7.n10-1、OX3-1.3.7d.10a-n8.3-1 复现结果相同。
    evidence: shots/qa-spot/visit/ZR1-R-roof.png（另一栋楼 ZR1-0.3.1c7.19m-0.5-13 室内，拾取距离 1.4 m）；shots/qa-spot/visit/OX5-R-roof.png（街沿）；shots/qa-spot/visit/ZR2-R-living.png（一层店面外，不是 2F）；首访对照：shots/qa-spot/visit/ZR2-v-living.png、shots/qa-spot/visit/OX5-v-living.png；位姿差：shots/qa-spot/visit-analysis.txt；原始记录：shots/qa-spot/visit/log.json
    expected: §6 抽查4 要求保存、退出再回访；§1/§4 要求同一栋楼进门、上楼、回轨道后尺度、位置和邻接关系都可复查，书签回到原楼原街角；§5 07 要求保存四个视点。同一个视点书签应当回到同一个眼位。
    actual: roof 和 living 视点书签回访时 __MARS__.goto 返回 false（App.applyBookmark 走 r.interrupted 分支），相机停在 saveAllViews 写入的通用 fallback 位姿（三分之四外景或入口外）。4 栋楼的 roof + living 共 8 次回访全部错位，偏差 5–80 m，朝向最多差 230°，中心拾取变成地面或别的楼。street 视点回访位姿一致。「存书签」按当前位姿回访 4/4 完全一致。
    suggestion: controls.buildingView 在冷启动（建筑尚未流入）时不要以 interrupted 结束书签请求，应等 anchors 或 'full' LOD 就绪后再落位。ui 的 saveAllViews 应保存每个视点已解析出的真实眼位（用 anchors.cameras 换算出的 pose）作为 fallback，不要存通用的三分之四或入口位姿。
- QP-03 [major] <controls> 人眼视点（街对面 / 后院）按固定偏移放置，不检查邻楼和遮挡：相机落进对街或后院邻楼体内，或被行道树挡住
    repro: 打开 /?workers=3，先 __MARS__.ui.selectBuilding(id,{fly:false})，再 await __MARS__.app.controls.buildingView(id,'street'|'back')，然后 __MARS__.app.controls.pick()。(a) id='ZR1-0.3.1c7.19m-n1.4-9'，street：拾取到 ZR1-0.3.1c7.19m-n1.5-1，距离 5.1 m，相机站在对街楼的柱廊下；(b) id='OX3-1.3.7d.10a-n8.3-1'，street：拾取 OX3-1.3.7d.10a-n7.3-3，距离 0.16 m，整屏是一面墙；back：拾取 OX3-1.3.7d.10a-n8.3-4，距离 0.23 m；(c) id='ZR2-1.3.p4.1ho-n4.3-11'，street：一棵行道树挡住画面中央。数据层复核：node shots/qa-spot/camclash.mjs <ids>。
    evidence: shots/qa-spot/visit/ZR1-v-street-oid.png；shots/qa-spot/visit/OX3-v-street.png；shots/qa-spot/visit/OX3-v-back.png；shots/qa-spot/visit/ZR2-v-street-oid.png；shots/qa-spot/camclash.jsonl
    expected: §5 07 定格一要求从街对面取景，看清站台、行道树、住宅门口和后勤入口的方向；§6 抽查4 要求能绕到背面查看。视点应站在街道或后院的空地上，正对目标楼。
    actual: anchors.cameras 的 street 视点固定在建筑系 z≈+28.2–28.5 m，back 视点固定在 z≈−18.2–18.5 m，不看实际街宽和邻楼。ZR1 目标楼的 street 锚点（建筑系 [−6.3,1.6,28.2]）落在对街 7 层住宅 ZR1-0.3.1c7.19m-n1.5-1 的占地内，局部坐标 (0.7,3.5)。OX3 的 back 锚点 [5.6,2,−18.2] 落在 OX3-1.3.7d.10a-n8.3-4 体内，street 锚点离 n7.3-2 不到 2 m。buildingView 只修正高度（贴最终地面或路沿），不做水平净空检查。4 栋随机楼的 8 个街对面 / 后院视点中有 3 个不可用，另有 1 个被树遮挡。
    suggestion: buildingView 落位时（或 building-kit 生成 anchors.cameras 时），对候选眼位做邻楼占地、拾取外壳、行道树的净空和视线检查：沿街道中线或后院空地滑动，或缩短距离、换广角；实在找不到可用眼位就退到街道中线。
- QP-04 [major] <controls> 冷启动回访和环看：相机按最终地形放置，但显示的粗地形及坐在上面的建筑高出 20–30 m，持续 ≥45–65 s，画面变成从地下仰看城市，或相机贴在楼面上
    repro: (a) 用 QP-02 的流程保存 street 视点，重载后执行 __MARS__.goto(<ZR2/ZR1/OX5 的 street 书签>,{instant:true})，45–65 s 后截图并调用 controls.pick()；(b) 首访时从 pose 39.8035874,-95.2530407,2698.7,0,-35,35 出发，执行 __MARS__.app.controls.focusBuilding('ZR2-1.3.p4.1ho-n4.3-11')；(c) 同样对 OX3-1.3.7d.10a-n8.3-1 执行 focusBuilding，再用 node shots/qa-spot/hgt.mjs 10.423237 -123.336739 对照最终地形高度。
    evidence: shots/qa-spot/visit/ZR2-R-street.png（楼群倒挂，天空和霾在画面底部）；shots/qa-spot/visit/ZR1-R-street.png（从楼板下方仰看）；shots/qa-spot/visit/ZR2-3-focus.png（整屏一块面）；shots/qa-spot/visit/OX3-3-focus.png；shots/qa-spot/visit-analysis.txt
    expected: 书签落位和环看都不应出现地下视角，相机也不应嵌进建筑（§4 要求推近后重算并保持接地正确；§6 要求重开后书签回到原楼原街角，并按最高原生质量重渲染）。
    actual: 三次 street 回访中，向上 +3°…+25° 的视线在 7.8 m、38 m、50 m 处击中显示地形，说明相机在显示地面以下，画面是城市底面（倒挂的楼、车）。ZR2 环看落位后，中心拾取到目标楼仅 0.65 m，离地 2.7 m，画面被一整块面填满。OX3 环看的中心拾取是地形，距离 17.8 m，对应地面高 409.6 m；而 node heightAt 显示该宿舍周围最终地形为 386–388 m，差约 23 m，城市建筑也坐在这层粗地形上。拍摄时机器重载，但这种状态持续了 45–65 s 以上。
    suggestion: 当显示地形或建筑底座仍高于被保持的人眼时，临时把眼位抬到显示地面之上，或遮罩画面，同时优先细化该点下方的地形块；也可以在保持期间让建筑按最终地形落座。terrain-render 也需要关注：粗块高度误差达 20–30 m，且在保持位姿下细化很慢。
- QP-05 [major] <terrain-render> 全盘夜面的「郊外节点」散点不来自任何地块：没有建筑的地方也发光，均匀铺满整片陆地，吃掉连续暗面
    repro: 拍 TE90 书签（time=15）。取画面像素 (641,301)，对应 lat 21.2911、lon 65.421。运行 node shots/qa-spot/dottiles.mjs 21.2911 65.421 10：±10 km 内 1112 个 L13 城块，共 0 栋建筑。运行 node shots/qa-spot/dotscan.mjs 21.2911,65.421：±6 km 内 961 个 urbanSample 点，coverage=0，light=0。运行 node shots/qa-spot/dots.mjs shots/qa-spot/tt/E90-t15.png 90 560 150 860 400 12：在 300×250 px 的陆地范围内找到 288 个孤立亮点，抽检 12 个，全部位于 cov10km≤0.008、light≤0.001 处。
    evidence: shots/qa-spot/crop-TE90-nw.png；shots/qa-spot/crop-S02-c.png；shots/qa-spot/crop-S01-night-x3.png；shots/qa-spot/dots-E90-t15.json；shots/qa-spot/dots-scan.txt；shots/qa-spot/tt-E90-overlay.png（只有绿色的点：夜间有灯，白天那里没有城区）
    expected: §1 要求夜间发光由占用率、营业和交通派生；§4 要求远景城群的灯光与占地从同一组地块派生；§5 02 要求相邻两个站之间有很长一段黑暗，高地背坡留出连续暗面；ARCHITECTURE §0 要求各尺度使用同一份数据。
    actual: src/world/surface.js 的 bgDots() / kBg 在轨道层（texel ≥1.2–3 km）给 density 先验 >0.01 的所有陆地加随机 Worley 灯点（O 区按 12% 权重）。这些灯点和走廊、站点无关，推近后会消失，因为城市数据里没有对应地块。S01、S02 和转台夜面因此都铺着均匀的颗粒底噪，320 px 下整个夜半球被抬成褐色。
    suggestion: 散点改为从 urban 的真实聚落、站点、路口派生（或用 urbanSample 的面积平均 light 做能量守恒的聚集），并沿交通走廊排布；没有地块的地方保持黑暗。
- QP-06 [major] <terrain-render> objectId / province 调试层在全盘尺度不是 ID 通道：随昼夜受光和曝光变色，地表也没有城市或地块 ID 色
    repro: 不加 clean，分别打开 /?pose=0,0,17900000,0,-90,50&time=15&debug=objectId&workers=3 和同一地址改为 time=3（或用 shots/qa-spot/tt.mjs 第二轮），对比同一经纬度的颜色。province 层把参数改为 debug=province 后对比。
    evidence: shots/qa-spot/tto-E0-pair.png；shots/qa-spot/tto-W90-pair.png；shots/qa-spot/ttp-E90-pair.png；shots/qa-spot/tt/E0-t15-objectId.png；shots/qa-spot/tt/E0-t03-objectId.png
    expected: §6 抽查2 要求用 ID 通道叠加验证城市只随地表旋转、昼夜只改变受光与发光，所以 ID / 数据层本身必须与时间无关。
    actual: 同一片海的水体 objectId 色，在日侧是 (19,43,122)，在夜侧是 (89,126,217)。province 层在夜侧是偏亮的平涂，在日侧带地形明暗并整体偏暗；海面日侧显示真实受光的水，夜侧全黑。地形在 objectId 下仍照常受光并带夜灯（src/render/terrain/material.js 中 DEBUG_MODES.objectId = 0），全盘尺度没有任何城市或地块 ID 色可以叠加。水体着色器本身输出常数 cls*0.25（src/render/water/material.js:621），颜色变化来自后面的光照、曝光和夜侧提亮。
    suggestion: 调试数据层绕过光照、夜侧提亮和色调映射直接输出。地形在 objectId 下用 urbanSample 的 blockId / parcelId 稳定哈希着色。水体在 province / zone 下显示所属省域色。atmosphere 和 water 模块需要配合。
- QP-07 [major] <terrain-render> 富氧水网在全盘和 320 px 下读不出「蓝色树枝」，O 区只是一片随机的橄榄色斑块
    repro: 拍 clean 的 TE0、TW90、S01（1600×900）并缩到 320 px。看 OX5、OX2（TE0 左下；TW90 西内海西南岸）和 OX1（S01 内海北岸）。
    evidence: shots/qa-spot/crop-TE0-w.png；shots/qa-spot/crop-TW90-sw.png；shots/qa-spot/crop-S01-ox1.png；shots/qa-spot/s320/TE0-320x3.png
    expected: §1「构建日侧地表」要求富氧水网呈蓝色树枝，枝条两侧长出颜色深浅不同的耕地，过了灌溉末端露出粗糙赤土，并且这三种人工轮廓在低分辨率预览里也能分开（参考 A01）。
    actual: O 区表现为 Voronoi 状的灰橄榄斑块，随机分布，与水系走向无关。只有 OX1 在全分辨率下能看到几段短蓝线，缩到 320 px 后完全消失，三种轮廓里富氧水网这一种无法分辨。
    suggestion: 轨道层地表色沿 hydro 主干和支渠画出比像素宽的蓝色带（按角尺寸展宽，保持能量守恒），耕地色沿渠两侧随距离衰减，过了灌溉末端露出赤土。如需加宽主渠尺度，请 terrain-fn 配合。
- QP-08 [minor] <atmosphere> time 切换正好 ±12 h 时云场单向漂移，15→3→15 后云不复原
    repro: 打开页面并 setTime(15)，截图；执行 __MARS__.setTime(3)，再执行 __MARS__.setTime(15)，再截图，比较云。原因在 src/render/clouds/index.js:190–193：d=((d%24)+36)%24−12 把 +12 和 −12 都映射成 −12，所以 cloudTime 从 15 变成 3 再变成 −9。
    evidence: shots/qa-spot/rp/t15-pair-W90-E0.png（同为 time 15，地形和海岸重合呈黄色，云呈红绿错位）；shots/qa-spot/rp/t15-mosaic.png；shots/qa-spot/rp/mosaic-seam-W45.png
    expected: 固定机位拨动时间再拨回，画面应复原；转台在同一时刻复拍应得到同样的云（§4 灯光与大气、§5 02 转台）。
    actual: 同一会话里做过一次昼夜（12 h）往返，回到同一 solTime 时云已经偏移 24 h，四经度转台拼接后接缝处的云明显错位，同一书签复拍的结果不一致。
    suggestion: cloudTime 改为由 solTime 加整数日计数确定性推导；或在恰好 ±12 h 时按设定方向（例如沿时间轴正向）取 +12，不要两个方向都取 −12。
## BOOKMARK CORRECTIONS

######## QA #8
## SUMMARY
qa-repro（§6 网页可复现），在 13cc425 的干净 clone 上完成。结论：构建可复现，但干净环境里 npm run prep:data 跑不通（依赖仓库外文件）。具体：git clone → npm ci → npm run build → vite preview 全部通过。产出的 dist 共 97 个文件，与 4300 端口的参考构建逐文件 sha256 一致。prep:data 读取的是仓库外的 ../参考图/03-control；把这个目录补到 clone 旁边后，重新生成的 data 文件与仓库里提交的逐字节一致。

构建后的页面：资产请求 0 失败、0 个 4xx/5xx、不依赖任何外部主机；页面与 worker 控制台 0 error / 0 warning；所有 WebGL program 链接和编译 0 失败。6 个随机落点、昼夜切换（URL time 参数与 __MARS__.setTime）、按 ID 进楼与回访都能正常执行：状态值正确，位姿保持不变，ID 跨会话稳定，可以飞回原楼。37 个书签全部能打开，没有 console error，但没有一个在截止时间内进入 idle。

测试环境严重过载，时序和画质结论不可靠：多个 QA agent 同时运行，3 个浏览器槽位被占满，load average 250–377（10 核），swap 用掉 6–8.5 GB。每页 3 个 worker 约 150 s 只能完成 20–25 个 job，大部分截图仍停在粗级地形。所以"是否最终 idle"和多数画面的美术判断无法下结论，需要在空闲机器上用 workers=8 复跑。等槽位约 60 min，总用时约 3.8 h，超出了时间盒。

发现的问题：
- 1 个 major：街面落地时城市曾上下颠倒，间歇出现，2 次加载中出现 1 次。
- 4 个 minor：capture-shots 截图超时，C01/C02 没留下任何定格；prep:data 依赖仓库外文件；默认落地画面是夜半球；生产构建里带着 dev 测试台。

收尾：4390 上的 preview 服务已停，clone 目录已删除。日志与截图在 shots/qa-repro/。另外用 4300 上的同一份构建在负载较低时补测了 S07：等 191 s 后画面构图正确（街道、行道树、入口雨棚、坡道、行人），见 shots/qa-repro/recheck4300/S07.png。说明前面那些空白或错位的帧主要是细化没完成造成的。
## CHECKS
- [partial] 干净环境构建（git clone → npm ci → prep:data → build → preview）: clone 位置：/private/tmp/claude-501/qa-repro-fxh4wrv1/web（13cc425，工作树干净，316 个文件）。
- npm ci：通过（Node 24.20 / npm 12.0.2，1 min 05 s，20 个包，0 漏洞）。npm 12 的 allowScripts 拦截了 fsevents@2.3.3 的安装脚本，在 macOS 上只影响文件监听，不影响 build/preview。
- npm run prep:data：在纯净 clone 里失败，报错 `Error: ENOENT: no such file or directory, open '/private/tmp/claude-501/qa-repro-fxh4wrv1/参考图/03-control/zone-O.png'`，见 QR-03。把 参考图/03-control 复制到 clone 同级后重跑成功（47 s），生成的 public/data/*.bin 和 manifest.json 与提交版 sha256 逐字节一致（coast key mcst1-2048x1024-4c77c280）。
- npm run build：通过（vite 8.3.5，275 个模块，41 s）。有两条警告：vite.config.js 用了 __dirname（configLoader native 不支持）；INEFFECTIVE_DYNAMIC_IMPORT（src/world/urban.js 同时被动态和静态导入）。
- dist 共 97 个文件，与 4300 参考构建逐文件 sha256 完全一致，构建可复现。
- npx vite preview --port 4390 --strictPort --host 127.0.0.1：服务正常。
- 日志与校验文件在 shots/qa-repro/logs/
- [pass] 构建后页面：资产请求 / 着色器 / 控制台: 默认落地 /?workers=3 与 /?clean=1&workers=3 的结果：
- 请求：共 64 个（1 document、55 script（含各 worker chunk）、1 css、7 个 data fetch），约 25.2 MB。0 个 requestfailed，0 个 HTTP≥400，没有任何外部主机或 CDN 依赖。
- 控制台：页面和 worker 都是 0 error / 0 warning，0 个 pageerror。
- WebGL（ANGLE Metal，Apple M5）：three 的 checkShaderErrors=true。我用注入脚本在每个任务结束时检查所有 program 的 LINK_STATUS、COMPILE_STATUS 和 info log。12 个探测任务里 program 最多 98 个，全部 0 失败、0 日志，也没有 webglcontextlost。
- capture-shots 跑的 37 个书签：0 条 console error。
- 时序：load 事件 0.3–6 s，__MARS__.ready 1.5–16 s。
- 报告：shots/qa-repro/landing/report.json、steps/report.json、diag/report.json
- [partial] 任意落点：6 个随机 URL 位姿（seed 793808716，用世界函数校验过陆、海、街位置）: 6 个位姿（都加了 &clean=1&workers=3）：
- orbit：?pose=18.044,-50.855,11922972,0,-90,50&time=11.689
- regional：-10.13333,39.85024,35049,256.9,-46.4,35&time=10.865（ZR3）
- street：1.5559191,142.0162801,347.03,121.1,6,32&time=1.124（ZR4，住宅 ZR4-5.3.4f.to-n9.3-2 前 14 m）
- sea：14.32675,178.60619,30,261,0,35&time=4.867（靠近 ±180° 接缝）
- polar：-85.481,38.8498,4584,31.3,-25,35&time=17.378
- canyon：-9.49943,-103.93204,1196,1.3,-6,35&time=0.027（OX2 谷底上方 150 m）

结果：
- 6 处全部加载完成，ready 10–15 s，0 错误、0 个 4xx、0 个着色器失败，位姿与请求逐位一致（hold 生效）。
- 75 s 内都没有进入 idle：terrain 一直在忙，40–75 个 job 排队。
- 画面：orbit 和 sea 正常；regional、polar、canyon 仍是粗级地形的单色色块，看不出峡谷和极地起伏。
- street 出现城市上下颠倒（QR-01）。同一位姿复测（不加 clean）在 t≈80 s 和 t≈270 s 都正常：门、台阶、坡道、雨棚、信报箱都看得到（diag/street-hud-t270.png），camera-up 与当地垂线的点积为 0.9945。
- 截图：shots/qa-repro/steps/pose-*.png
- [partial] 昼夜切换（URL time 参数 + __MARS__.setTime，固定位姿）: 固定位姿：21.6,118.4,30000,330,-45,35（ZR1 上空 30 km）。
- 同一页面内 setTime 10.633 → 14.133 → 6.133：state.solTime 每次都正确更新，位姿完全不动（hold lifted 0），无错误。
- 切回白天后的帧与最初的白天帧平均差 5.0/255，只有 1.2% 像素差超过 24，切换可逆。
- 新页面用 URL time=14.133：solTime=14.133。
- ?bookmark=C04：solTime=13.633，位姿与书签一致，站前夜景能看到窗光和列车灯（steps/url-bookmark-C04.png）。

视觉一致性无法判定：这个位姿每页只完成了 13–15 个 job，一直停在粗级地形。
- 白天和黄昏帧是模糊色块。
- URL 打开的夜景帧（dn2-night-url.png）是均匀亮米色，看不到灯，平均亮度 172/255。
- 同页 setTime 得到的夜景帧（dn1-night.png）有暖色灯斑，与 URL 夜景帧平均差 49.9/255。两者细化程度不同，不能据此判断灯位是否随地表一致。
- 截图：shots/qa-repro/steps/dn*.png
- [partial] 进楼与按 ID 回访: 测试对象：随机住宅 ZR4-5.3.4f.to-n9.3-2（地块 5.3.4f.to/n9.3/2，11 层，18.0×11.7 m，朝向 301°，2 个入口）。
- ?select=<id>：进入环看模式，建筑面板出现，列出 7 个人眼视点。
- controls.buildingView 的 lobby / living / roof 都返回 {arrived:true, mode:'walk'}，高度合理（347.41 / 351.01 / 382.01 m，入口标高 345.25）。
- living：起居室家具和窗外邻楼都看得到（b1-living.png）。
- lobby：画面不是门厅，HUD 显示「离地 −31 m」，即粗级地形仍比步行者高 31 m。
- roof：整帧深蓝，看不到屋面。
- B2 新页面的 street 视点：整帧米色。
- 以上三帧异常都出现在细化未完成时；capture 中 C10（S07 屋顶）和 S07c 是正常的，所以不单列缺陷。
- 回访：先回到 3,000 km 轨道，再用 __MARS__.ui.selectBuilding(id) 回访，飞回同一栋楼（有描边和标签，b1-revisit.png）。回访前后 getFocusInfo 完全一致（中心 ECEF、半径 20.37 m、朝向 301.12、spec）。
- 新页面再用 ?select=<id>：中心坐标逐位相同。
- Node 侧：S07、O07 和这栋随机楼的 buildingSpecById 结果稳定，并与 generateCityTile 里同 ID 的条目一致。
- 截图：shots/qa-repro/steps/b1-*.png、b2-street.png
- [partial] 全部书签 capture-shots（37 个，每个书签开新页面，用 clean clone 自带脚本）: 37/37 都能打开：goto 正常返回，0 console error，0 页面崩溃，最终位姿与书签一致。

capA（idle 上限 120 s）：S01–S06b、S08–S09c、TE0/TE90/TE180/TW90、C01、C02。
- 17 张定格，每个书签 131–214 s，全部 NOT-IDLE，结束时 49–126 个 job 排队。
- C01、C02 截图超时，没有任何定格（QR-02）。

capB（idle 上限 30 s，因时间所限）：S07–S07d、S07O–S07Oe、C03–C10。
- 18/18 有定格，每个书签 48–74 s，全部 NOT-IDLE，27–54 个 job 排队。

整体情况：
- 没有任何书签在上限内进入 idle，阻塞的主要是 terrain，其次是 city 和 props。
- 许多定格仍是粗级地形：S03、S08 几乎空白；S06 看不到峡谷崖壁；S04 镜头在悬空建筑下方；C03 的城市落在眼高之下。这些帧不能用于美术判定。
- 负载较低时用 4300 的同一份构建补测：S02 等 156 s、S07 等 191 s 仍未 idle，但 S07 画面构图已正确。
- 报告：shots/qa-repro/capA/report.json、capB/report.json、recheck4300/report.json
- [pass] 生产构建体积与最大资产: dist 共 30 MB / 97 个文件。
- data：25.2 MB。coast.bin 8,388,672 B；zone.bin 8,388,608 B；water、province、emission、density 各 2,097,152 B。
- JS：5.74 MB。world.worker 1.08 MB、city.worker 1.00 MB、buildings.worker 0.56 MB、three.module 0.35 MB、props.worker 0.27 MB、urban 0.27 MB、three.core 0.22 MB、mega.worker 0.21 MB、main 0.20 MB。
- CSS：37 kB。
- 没有 glTF 或纹理图片，几何和纹理全部在运行时程序化生成。
- 另外打包了 10 个 dev 测试台 HTML 和 10 个 dev-* chunk，约 190 kB（QR-05）。
- 首屏传输约 25.2 MB：vite preview 会 gzip JS，但 .bin 原样传输（zone.bin gzip 后只有 34 KB）。这项只作诊断，§1 没有下载体积预算。
- 清单：shots/qa-repro/logs/dist-sizes.txt
- [pass] 收尾与测试环境: - 收尾：4390 上的 vite preview 已停止（端口已释放）；clone 目录 /private/tmp/claude-501/qa-repro-fxh4wrv1（144 MB）已删除。
- 浏览器纪律：所有浏览器都经 scripts/slot.mjs 启动，同一时间只开 1 个，视口 1600×900。
- 宿主环境：Apple M5，10 核，24 GB。测试期间 load average 250–377，swap 用掉 6–8.5 GB，wired 13–17 GB。另有 2 个他人浏览器和大量 node 进程在跑。
- 结论：所有时序和 idle 结论都受这个环境影响。
## DEFECTS (5)
- QR-01 [major] <water> 街面落地加载中城市与行道树上下颠倒地悬在相机上方（间歇，疑似镜像相机矩阵串入主 pass）
    repro: 在 13cc425 构建上打开 /?pose=1.5559191,142.0162801,347.03,121.1,6,32&time=1.124&clean=1&workers=3（ZR4，cube face 5，住宅 ZR4-5.3.4f.to-n9.3-2 前 14 m，眼高 1.65 m）。load 后约 90 s、场景仍在加载时截图（宿主过载，terrain 和 city 都还在忙）。2 次加载中出现 1 次；另一次（不加 clean）在 t≈80 s 和 t≈270 s 都正常。
    evidence: shots/qa-repro/steps/pose-street.png
局部裁切：shots/qa-repro/thumbs/street-crop-tr.png、street-crop-tl.png、street-crop-bottom.png
同一位姿的正常对照：shots/qa-repro/diag/street-hud-t60.png、street-hud-t270.png
位姿数据：shots/qa-repro/steps/report.json 与 diag/report.json（__MARS__.pose 为 pitch 6、roll 0；camera-up·当地垂线 = 0.9945，相机本身是正的）
    expected: 眼高 1.65 m 的街景：脚下是街面，住宅立面、行道树、车辆都直立在相机周围。
    actual: 粗级地形正常画在画面下半（灰色城区夹橙色土）。上半部分是整片倒挂的住宅：屋顶朝下，因剔除反向能看到室内。行道树树冠朝下、树干朝上，还有一辆倒置的车。也就是城市和 props 的几何被镜像，而地形没有。
    suggestion: 代码里唯一的镜像相机渲染是 src/render/water/reflection.js 的 PlanarReflection。它在水面网格的 onBeforeRender 里，在主 pass 中途嵌套调用 renderer.render(scene, rc)。主 pass 中排在水面之后绘制的对象（BatchedMesh 城市批次、props 实例）可能沿用了镜像相机的 view/projection 或按相机裁剪的状态，而先画的地形不受影响，这与观察到的现象吻合。
建议：把反射移到主 pass 之前单独渲染，或在嵌套渲染后强制刷新相机 uniform；然后在街面落地时让粗级水面进入视野反复验证。
若排除这个原因，再检查 city 批次的 anchor 矩阵（render/city/batch.js、detail.js）和 props 的锚点。
- QR-02 [minor] <lead> capture-shots 的截图在 30 s 时超时，区级验收书签 C01/C02 没有留下任何定格（连 FAILED 诊断图也没有）
    repro: node scripts/slot.mjs --slots 3 -- node scripts/capture-shots.mjs --base http://127.0.0.1:4390 --only …,C01,C02 --width 1600 --height 900 --idle 120000 --query "&workers=3"（每个书签开新页面，宿主过载）。
    evidence: shots/qa-repro/capA/report.json：C01 和 C02 的错误都是 "TimeoutError: page.screenshot: Timeout 30000ms exceeded"，capA/ 目录里没有 C01.png、C02.png，也没有 *.FAILED.png。
对照：用我自己的探针、截图超时设为 120 s 时，C01 能成功截图（shots/qa-repro/diag/diag-C01.png）。同期主线程在 130 s 内有 277 个 long task，合计 63 s，最长 1.4 s（diag/report.json）。
    expected: 每个书签都留下定格；即使失败，也至少留下一张诊断截图，作为 §6 要求的区级实拍截图。
    actual: Playwright 的 page.screenshot 默认 30 s 超时先触发，脚本自己包的 60 s withTimeout 根本没机会生效。失败后补拍的 FAILED 截图只给了 20 s，同样失败，结果什么都没保存。
    suggestion: 在 capture-shots.mjs（以及 shot.mjs）里给 page.screenshot 显式传 {timeout: 120000}，FAILED 截图也用较长超时。
另外，report.json 目前只记录 console error：它丢掉了第一个书签页面加载阶段的错误（openPage 之后执行了 errors.length = 0），也不记录 warning 和失败或 4xx 的请求。建议一并补上，让它能直接当网页可复现的验收工具用。
- QR-03 [minor] <lead> npm run prep:data 在纯净 clone 中失败：依赖仓库外的 ../参考图/03-control，README 却写「仓库里已有，可跳过」
    repro: git clone web 仓库到空目录，执行 npm ci，再执行 npm run prep:data。
    evidence: shots/qa-repro/logs/prep1.log（`Error: ENOENT: no such file or directory, open '/private/tmp/claude-501/qa-repro-fxh4wrv1/参考图/03-control/zone-O.png'`）
补上源 PNG 后：shots/qa-repro/logs/prep2.log，以及 committed-data.sha 与 regen-data.sha 完全一致。
    expected: 按 README 写的步骤，在干净环境里每条命令都能成功；或者脚本明确提示缺少哪个目录、怎么获取。
    actual: 脚本用 path.resolve('../参考图/03-control') 读取仓库外的 5 张 PNG，直接抛出 ENOENT 退出。构建本身不受影响，因为 public/data/*.bin 已经提交到仓库。
    suggestion: 把 5 张源控制图（约 750 KB）提交进仓库（例如 web/data-src/），或让 prep-data 支持 --src 参数，缺文件时给出清楚的提示。同时更新 README，写明这个依赖。
- QR-04 [minor] <lead> 不带参数打开网页，第一眼看到的是夜半球（当地 21:40），与导演意图里的「第一眼」不符
    repro: 打开 /（或 /?workers=3），不带任何参数。
    evidence: shots/qa-repro/landing/01-landing-default.png（HUD 显示「15.00°N 100.00°E 当地 21:40 夜间 太阳 −46°」）
成因：src/app/state.js:21 的 solTime = 15.0，加上 src/controls/CameraRig.js:41 的默认位姿 15°N 100°E。
    expected: 导演意图要求「从太空第一眼…阳光下，银白的城市群包围钴蓝内海…越过晨昏线，同一片建成区逐渐亮起」：第一屏应当是日侧城市大陆，晨昏线放在一侧（类似 S01 的构图）。
    actual: 首屏约九成球盘处于夜面，只有左上角球缘有阳光，看不到日侧的银白城带和钴蓝内海。
    suggestion: 调整默认时刻（或默认经度），使首屏是日侧城市大陆并带晨昏线；或者首次打开直接套用 S01 的构图和时刻。
- QR-05 [minor] <lead> 生产构建打包了 10 个 dev 测试台；dev/urban 在构建产物里用 import('/src/...') 加载源码，必然失败
    repro: 执行 npm run build 后查看 dist/dev/*.html；再执行 curl -D - http://127.0.0.1:4390/src/core/geo.js。
    evidence: shots/qa-repro/logs/build.log（dist/dev/*.html 和 assets/dev-*.js 合计约 190 kB）
shots/qa-repro/logs/curl-src-fallback.txt（返回 200，Content-Type 是 text/html，即 SPA 回退页）
dev/urban.html:236–238 有 `await import(base + '/src/data/controlMaps.js')` 等写法。
    expected: 生产交付只包含访客页面；如果保留测试台，它们在构建里也应能运行。
    actual: vite.config.js 把 dev/*.html 全部加进了 rollupOptions.input，访客可以打开 /dev/*.html。其中 dev/urban 的 worker 基准测试通过 /src/… 动态导入，在构建产物里只会拿到 HTML 回退页，模块加载失败。
    suggestion: 只在开发模式或单独的 bench 配置里加入 dev 页面。顺手把 vite.config.js 里的 __dirname 改成 import.meta.dirname（构建时有 configLoader 警告），并处理 src/world/urban.js 的 INEFFECTIVE_DYNAMIC_IMPORT 警告。