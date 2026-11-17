// Camera bookmarks: the nine shot cards of prompt §5 (with their sub-frames), the four-longitude
// turntable (§6.2) and user bookmarks (localStorage). OWNER: integration (core).
//
// Bookmark: { id, group:'shot'|'turntable'|'user', name, note?, pose:{lat,lon,alt,heading,pitch,roll?,lens},
//             solTime (sol hours at lon 0), subsolarLat?, mode:'orbit'|'fly'|'walk'|'focus',
//             buildingId?, view? }
// When `megaView` is present the pose comes from app.systems.mega.views()[megaView].
// When `buildingId` + `view` are present the pose is resolved at runtime from the building's own
// camera anchors (BuildingMeshData.anchors.cameras[view]: street|entrance|lobby|stair|living|back|roof),
// so the frame always tracks the generated asset; `pose` is the fallback. `viewPitch` overrides the
// anchor pitch (deg), `viewLens` the focal length.
//
// Local solar time = solTime + lon/15. Shot times below are chosen in local time at the subject.

const local = (lon, h) => ((((h - lon / 15) % 24) + 24) % 24);   // sol time giving local time h at lon
const ORBIT_ALT = 1.79e7;   // 50 mm, 16:9: full disc with ~10 % margin top and bottom (§5 01)

// ordinary residential corner block 50 m from the platform canopy of the at-grade station S9tk6g93.5 (ZR1) — §5 07.
// Front (W) on the street opposite the station's south end and a park, free north side on the cross street (way round
// to the back door), 2F front living room looks across the street onto the canopy roofs (eye 2.4 m above their top).
// (was ZR1-0.3.1a5.17w-n8.n6-7: the station S9ruz39h.4 stood behind every across-the-street eye point, QS2-04)
const S07_BUILDING = 'ZR1-0.3.1aa.186-n20.4-2';
const S07_LON = 118.25498, S07_GROUND = 452.53, S07_ROOF = 452.53 + 25.3;   // ground.entrance, 8 storeys (3.6 + 7 × 3.1)
// §5 07 O-zone version: a water maintenance building with an upper control room (sluice station near S03)
const O07_BUILDING = 'OX1-0.2.iy.gk-n7.n1-0';   // 10 m step, 5 bays / 4 open (S03 area, 8 km below the basin outlet)

export const SHOTS = [
  {
    id: 'S01', group: 'shot', name: '01 轨道主视觉｜晨昏线上的城市大陆',
    note: '东内海偏左对镜头；春分日晨曦线为竖直的东经 112° 经线，约三分之一球盘入夜：夜侧 ZR5 核心与 ZR1 西翼两处亮核，日侧 ZR1 核心与东翼、ZR4、ZR5 东翼三片银白城区',
    pose: { lat: -8, lon: 124, alt: ORBIT_ALT, heading: 0, pitch: -90, lens: 50 },
    solTime: 22.533, subsolarLat: 0, mode: 'orbit',
  },
  {
    id: 'S02', group: 'shot', name: '02 夜半球｜从灯光辨认地形和城市功能',
    note: '东内海夜半球：ZR1、ZR4、ZR5 三个城网围着大块暗水，岸线由灯点勾出，日出只照亮东侧一段球缘',
    pose: { lat: -5, lon: 112, alt: ORBIT_ALT, heading: 0, pitch: -90, lens: 50 },
    solTime: 18.0, subsolarLat: 12, mode: 'orbit',
  },
  {
    id: 'S03', group: 'shot', name: '03 富氧水网｜从流域落到田埂',
    note: 'OX1 东泽汇水盆地：约 3 km 高 35 mm 斜看，上部远处马蹄形红岩台地，中部多汊湖与支谷入水口，下部岩槛闸、出口干渠与下游田渠',
    pose: { lat: 7.17812, lon: 104.82985, alt: 3110, heading: 35, pitch: -16, lens: 35 },
    solTime: local(104.86, 10.0), mode: 'orbit',
  },
  {
    // the saved last camera of card 03: eye level at the back (service) end of the outermost greenhouse of row 3.1,
    // on the channel side; upstream (the basin of the S03 aerial frame) lies behind the left shoulder (NE)
    id: 'S03b', group: 'shot', name: '03 富氧水网｜定格：温室进水阀与湿格栅', buildingId: 'OX1-0.3.11t.x5-3.1-22',
    note: '下游温室排 OX1-0.3.11t.x5-3.1 最外一栋的服务端：进水立管与闸阀、插板闸、服务路跨渠处的湿格栅，配水渠沿玻璃墙伸向远处，成排屋脊同向',
    pose: { lat: 7.2096987, lon: 104.8623385, alt: 118.88, heading: 155, pitch: -9, lens: 28 },
    solTime: local(104.86, 10.0), mode: 'walk',
  },
  {
    id: 'S04', group: 'shot', name: '04 冰缘省域｜工务设施如何适应高纬',
    note: 'OX4 北冠冰缘 MO-45 前池：对岸低台地（离地约 12 m）55 mm 看冰崖、融水泵房 OX4-2.3.10t.m5-2.n1-0 与 7 栋背风温室',
    pose: { lat: 73.61413, lon: 53.32391, alt: 445, heading: 9, pitch: 1.5, lens: 55 },
    solTime: local(53.32391, 8.0), mode: 'orbit',
  },
  {
    // eye in the service yard SW of the roller door (the kit's 'entrance' view only frames the duty-door vestibule)
    id: 'S04b', group: 'shot', name: '04 冰缘省域｜走近融水泵房服务入口', buildingId: 'OX4-2.3.10t.m5-2.n1-0',
    note: '融水泵房 OX4-2.3.10t.m5-2.n1-0 南侧服务入口：卷帘门、起吊梁、防撞柱与出水管，门前坡道车道通向前池取水栈桥；远处 MO-45 冰崖，右缘为背风温室的防雪栅',
    pose: { lat: 73.6242651, lon: 53.327253, alt: 425.68, heading: 60, pitch: -2, lens: 24 },
    solTime: local(53.32391, 8.0), mode: 'walk',
  },
  {
    id: 'S05', group: 'shot', name: '05 宜居城群｜从水上看见多座城市连成岸带',
    note: 'G01 内港水面：BG01 斜拉桥在中景约 2 km 横贯画面（两座 A 形塔立于桥岛，扇形拉索），远岸湾顶渡站、步廊、公共前排与高度不同的塔簇',
    pose: { lat: 0.53127, lon: 129.95260, alt: 20, heading: 12.7, pitch: 2, lens: 45 },
    solTime: local(129.94351, 15.5), mode: 'orbit',
  },
  {
    id: 'S05b', group: 'shot', name: '05 宜居城群｜备选：南盆港群航道与 BZ5 斜拉桥',
    note: 'ZR5 2.3 km 航道水面，BZ5 斜拉桥（H 形塔）在中景，两岸为密集港城',
    pose: { lat: -38.3725, lon: 103.18, alt: 24, heading: 352, pitch: 0.5, lens: 50 },
    solTime: local(103.18, 15.5), mode: 'orbit',
  },
  {
    // standing (eye 1.65 m) in the public park on the SOUTH first-terrace edge (ground 1121.7 m, 160 m above the
    // floor, cliff drop 70 m within 60 m), looking up the valley ENE: from the north rim the station hid behind the
    // rim blocks and the river fell outside a 40 mm frame (QS2-03); from here station + viaduct + river + bridges fit,
    // and the station platform sees this terrace back across the valley (S06b)
    id: 'S06', group: 'shot', name: '06 峡谷晚班｜一条通勤线在蓝调时刻亮起',
    note: 'ZR2 峡谷南侧第一级台阶边的公园露台（高出谷底约 160 m），40 mm 沿谷向东北偏东：对坡北岸台阶上的高架站 Sg1b4vvq.2 与下坡高架线、谷底河道与多座过河桥、对坡退台住宅、远处错叠岩壁，蓝调时刻',
    pose: { lat: 34.858356, lon: -105.313261, alt: 1123.38, heading: 70, pitch: -3, lens: 40 },
    solTime: local(-105.313, 18.97), mode: 'walk',   // sun ≈ −4.5°: the model's own blue hour, cliff tops still glowing
  },
  {
    // card 06 sub-frame: back at the station, looking across the valley to the terrace. From the platform itself the
    // station hall and the blocks in front of it hide the valley (line-of-sight check over the building boxes); 63 m
    // past the SE platform end, at platform eye height on the viaduct, the view is open
    id: 'S06b', group: 'shot', name: '06 峡谷晚班｜定格：站台东南端外高架段隔谷回看露台',
    note: '高架站 Sg1b4vvq.2 站台东南端外 63 m、站台人眼高度，50 mm 朝西南偏西（238.5°）：前景亮灯的林荫大道与车流，谷底城区，对坡层层退台与 S06 所在的公园露台（相距约 3.6 km），同一蓝调时刻',
    pose: { lat: 34.8882765, lon: -105.2487906, alt: 1130.08, heading: 238.5, pitch: -1.2, lens: 50 },
    solTime: local(-105.2488, 18.97), mode: 'orbit',
  },
  {
    // a fixed eye point, not the kit's 'street' anchor: that one looks square at the facade with the station behind it
    id: 'S07', group: 'shot', name: '07 普通建筑｜定格一 街对面', buildingId: S07_BUILDING,
    note: '眼高 1.65 m、28 mm，站在住宅对街的公园边：左侧站台雨棚与站房南端，中间街道与行道树，右侧住宅门口，楼北侧横街通往后门（后勤入口）',
    pose: { lat: 22.2180702, lon: 118.2545478, alt: 453.26, heading: 2, pitch: 2, lens: 28 },
    solTime: local(S07_LON, 14.0), mode: 'walk',
  },
  {
    id: 'S07b', group: 'shot', name: '07 普通建筑｜定格二 入口与门厅', buildingId: S07_BUILDING, view: 'entrance',
    pose: { lat: 22.2185944, lon: 118.2547543, alt: 454.63, heading: 64.89, pitch: -2.56, lens: 28 },
    solTime: local(S07_LON, 14.0), mode: 'walk',
  },
  {
    id: 'S07s', group: 'shot', name: '07 普通建筑｜楼梯（定格二→三之间）', buildingId: S07_BUILDING, view: 'stair', viewLens: 28,
    pose: { lat: 22.2186753, lon: 118.2549945, alt: 454.63, heading: 81.24, pitch: 21.62, lens: 28 },
    solTime: local(S07_LON, 14.0), mode: 'walk',
  },
  {
    id: 'S07c', group: 'shot', name: '07 普通建筑｜定格三 二层起居室回望站台', buildingId: S07_BUILDING, view: 'living',
    note: '二层朝街起居室（眼高约 458.2 m，高出站台雨棚顶约 2.4 m），隔街看站房南端与站台雨棚顶',
    pose: { lat: 22.2187745, lon: 118.2549225, alt: 458.23, heading: 273.08, pitch: -3.03, lens: 28 },
    solTime: local(S07_LON, 14.0), mode: 'walk',
  },
  {
    // the kit's 'back' anchor stands behind the corner shop row n20.4-1; this eye is in the block courtyard
    id: 'S07d', group: 'shot', name: '07 普通建筑｜定格四 后院', buildingId: S07_BUILDING,
    note: '街坊内院看背立面朝院一段：厨房小窗、检修口与楼层对齐；后门在与临街商铺 n20.4-1 相接的一侧',
    pose: { lat: 22.2184597, lon: 118.2553604, alt: 455.30, heading: 292, pitch: 8, lens: 24 },
    solTime: local(S07_LON, 14.0), mode: 'walk',
  },
  {
    id: 'S07O', group: 'shot', name: '07 普通建筑｜富氧区版 定格一 检修道', buildingId: O07_BUILDING, view: 'walkway', viewLens: 24,
    note: '富氧区版：水务维护楼（上层控制室）。站在近岸闸墩顶沿桥面下游栏杆看过渠：左侧闸叶后的上游闸池，右侧约 11 m 下的消力池与开孔出流，同框读出 10 m 水位差与流向',
    pose: { lat: 7.1426692, lon: 104.9452032, alt: 105.22, heading: 46.6, pitch: -12.4, lens: 24 },
    solTime: local(104.9447, 15.5), mode: 'walk',
  },
  {
    id: 'S07Ob', group: 'shot', name: '07 普通建筑｜富氧区版 定格二 值守入口', buildingId: O07_BUILDING, view: 'entrance',
    pose: { lat: 7.1424644, lon: 104.9445120, alt: 100.30, heading: 47.3, pitch: -2.8, lens: 28 },
    solTime: local(104.9447, 15.5), mode: 'walk',
  },
  {
    id: 'S07Oc', group: 'shot', name: '07 普通建筑｜富氧区版 楼梯', buildingId: O07_BUILDING, view: 'stair',
    pose: { lat: 7.1425794, lon: 104.9445706, alt: 100.52, heading: 45.8, pitch: 7.4, lens: 28 },
    solTime: local(104.9447, 15.5), mode: 'walk',
  },
  {
    id: 'S07Od', group: 'shot', name: '07 普通建筑｜富氧区版 定格三 控制室观察窗看闸池', buildingId: O07_BUILDING, view: 'control',
    pose: { lat: 7.1426091, lon: 104.9448058, alt: 105.07, heading: 58.3, pitch: -10.1, lens: 28 },
    solTime: local(104.9447, 15.5), mode: 'walk',
  },
  {
    id: 'S07Oe', group: 'shot', name: '07 普通建筑｜富氧区版 定格四 背侧设备院', buildingId: O07_BUILDING, view: 'back',
    pose: { lat: 7.1424102, lon: 104.9451397, alt: 100.42, heading: 294.3, pitch: 2.3, lens: 28 },
    solTime: local(104.9447, 15.5), mode: 'walk',
  },
  {
    id: 'S08', group: 'shot', megaView: 'g02-valley', name: '08 南台地水阶｜六级库面逐段缩入远方',
    note: '下游高处斜俯拍上行谷线',
    pose: { lat: -27.9885784, lon: -44.9931202, alt: 2600, heading: 67.98, pitch: -9.04, lens: 35 },
    solTime: local(-44.93, 16.5), mode: 'orbit',
  },
  {
    id: 'S08b', group: 'shot', megaView: 'g02-dam50', name: '08 南台地水阶｜50 mm 中段坝墩与起吊轨',
    pose: { lat: -27.935019, lon: -44.8243401, alt: 743.5, heading: 66.03, pitch: 6.57, lens: 50 },
    solTime: local(-44.93, 16.5), mode: 'orbit',
  },
  {
    id: 'S08c', group: 'shot', megaView: 'g02-grille', name: '08 南台地水阶｜90 mm 闸侧格栅',
    pose: { lat: -27.9336729, lon: -44.8213859, alt: 668.5, heading: 59.63, pitch: -1.61, lens: 90 },
    solTime: local(-44.93, 16.5), mode: 'orbit',
  },
  {
    id: 'S09', group: 'shot', megaView: 'g01-5km', name: '09 东海分段潮堤｜黄昏从外海接近主航口',
    note: '西南外海斜望主航口（约 3 km、320 m、40 mm），堤后为港区与城市',
    pose: { lat: 0.4172304, lon: 129.9382405, alt: 55, heading: 0.93, pitch: -0.62, lens: 35 },
    solTime: local(129.94, 18.08), mode: 'orbit',
  },
  {
    id: 'S09b', group: 'shot', megaView: 'g01-ship', name: '09 东海分段潮堤｜跟船穿过航口',
    pose: { lat: 0.4681236, lon: 129.9390769, alt: 14, heading: 12.17, pitch: -0.23, lens: 35 },
    solTime: local(129.94, 18.08), mode: 'orbit',
  },
  {
    id: 'S09c', group: 'shot', megaView: 'g01-office', name: '09 东海分段潮堤｜港务工作间窗外的航口',
    pose: { lat: 0.471527, lon: 129.934357, alt: 27.6, heading: 140.02, pitch: -4, lens: 24 },
    solTime: local(129.94, 18.08), mode: 'orbit',
  },
  {
    // look-back from a ship's deck inside the harbour (600 m in, 350 m east of the mouth axis): caisson segment S6
    // fills the left of the frame and hides the open sea that S09 saw past it; the sea shows only through the mouth.
    // (mega view 'g01-ship-in' stands 120 m inside, where the 560 m mouth fills the 28 mm frame and no barrier hides any sea)
    id: 'S09d', group: 'shot', name: '09 东海分段潮堤｜回望：堤身遮住一段外海',
    note: '港池内船甲板高度（离水 7 m）回望主航口：左侧 S6 沉箱堤段挡住外海，外海只从航口露出，右侧为西堤头与灯塔',
    pose: { lat: 0.478845, lon: 129.947411, alt: 7, heading: 212, pitch: -1, lens: 28 },
    solTime: local(129.94, 18.08), mode: 'orbit',
  },
];

// §6 网页可复现 acceptance viewpoints: district / street / building four sides + roof / night, so every
// level named by §6 has a revisitable bookmark (orbit = S01/S02, interior = S07b/S07s/S07c).
export const CHECKS = [
  { id: 'C01', group: 'check', name: '验收｜区级 ZR1 公共塔与主站 1 km', note: '公共塔幕墙、白陶瓷层间板、空中花园与主站筒壳屋顶（午后 15:30）',
    pose: { lat: 22.264576, lon: 117.932811, alt: 693, heading: 0, pitch: 5, lens: 35 }, solTime: 7.638, mode: 'orbit' },
  { id: 'C02', group: 'check', name: '验收｜区级 ZR1 地面站 S9ruz39h.4 1 km', note: '站房、站台雨棚、轨道与周边住宅街区',
    pose: { lat: 21.887337, lon: 118.001532, alt: 692, heading: 193.67, pitch: -8.5, lens: 50 }, solTime: 7.633, mode: 'orbit' },
  { id: 'C03', group: 'check', name: '验收｜街级 S9ruz39h.4 站前人眼高度（白天）', note: '眼高 1.65 m 看站前广场、入口雨棚与街道',
    pose: { lat: 21.871898, lon: 117.997485, alt: 544, heading: 193.67, pitch: 8, lens: 28 }, solTime: 7.633, mode: 'orbit' },
  { id: 'C04', group: 'check', name: '验收｜街级 S9ruz39h.4 站前人眼高度（21:30）', note: '同一机位的夜景：站厅灯、住宅窗光与路灯',
    pose: { lat: 21.871898, lon: 117.997485, alt: 544, heading: 193.67, pitch: 8, lens: 28 }, solTime: 13.633, mode: 'orbit' },
  { id: 'C05', group: 'check', name: '验收｜街级 公共塔前广场', note: '塔底广场仰望公共塔',
    pose: { lat: 22.280888, lon: 117.932811, alt: 445.6, heading: 0, pitch: 38, lens: 20 }, solTime: 7.638, mode: 'orbit' },
  // C06–C09: 55 m out from the footprint centre along each facade normal, 60 m above ground, pitch −40 (over the
  // neighbours, wall foot inside the frame); C10: 25 m above the roof, 12 m behind the centre, pitch −60
  { id: 'C06', group: 'check', name: '验收｜建筑四面 S07 住宅正立面（西）', note: `建筑 ${S07_BUILDING}，正立面朝西临街，对街为公园与站房南端`,
    pose: { lat: 22.2184947, lon: 118.2539874, alt: S07_GROUND + 60, heading: 81.24, pitch: -40, lens: 28 }, solTime: local(S07_LON, 14.0), mode: 'orbit' },
  { id: 'C07', group: 'check', name: '验收｜建筑四面 S07 住宅侧立面（北）', note: `建筑 ${S07_BUILDING}，北侧临横街（自由山墙）`,
    pose: { lat: 22.2195552, lon: 118.254827, alt: S07_GROUND + 60, heading: 171.24, pitch: -40, lens: 28 }, solTime: local(S07_LON, 14.0), mode: 'orbit' },
  { id: 'C08', group: 'check', name: '验收｜建筑四面 S07 住宅背立面（东）', note: `建筑 ${S07_BUILDING}，背立面朝街坊内院；北段与临街商铺 n20.4-1 相接`,
    pose: { lat: 22.2187779, lon: 118.2559726, alt: S07_GROUND + 60, heading: 261.24, pitch: -40, lens: 28 }, solTime: local(S07_LON, 14.0), mode: 'orbit' },
  { id: 'C09', group: 'check', name: '验收｜建筑四面 S07 住宅侧立面（南）', note: `建筑 ${S07_BUILDING}，南侧为与 n20.4-3 共用的山墙：看两栋的屋面高差与接缝`,
    pose: { lat: 22.2177174, lon: 118.2551329, alt: S07_GROUND + 60, heading: 351.24, pitch: -40, lens: 28 }, solTime: local(S07_LON, 14.0), mode: 'orbit' },
  { id: 'C10', group: 'check', name: '验收｜建筑屋顶 S07 住宅', note: `建筑 ${S07_BUILDING}：屋顶设备、楼梯间与屋面收边（屋面以上约 25 m 俯视）`,
    pose: { lat: 22.2186672, lon: 118.2551965, alt: S07_ROOF + 25, heading: 261.24, pitch: -60, lens: 28 }, solTime: local(S07_LON, 14.0), mode: 'orbit' },
  { id: 'C11', group: 'check', name: '验收｜冷启动 ZR2 峡谷底上方 200 m', note: '相机优先细化与粗瓦片平移：不得出现地下视角',
    pose: { lat: 34.874738, lon: -105.188219, alt: 1159.98, heading: 253, pitch: -9, lens: 35 }, solTime: 21.214, mode: 'orbit' },
  { id: 'C12', group: 'check', name: '验收｜G01 港池与潮堤 300 km', note: '受保护港池静水色与潮堤亮线在区域尺度可读',
    pose: { lat: 0.47, lon: 129.94, alt: 300000, heading: 0, pitch: -90, lens: 35 }, solTime: local(129.94, 15.0), mode: 'orbit' },
  { id: 'C13', group: 'check', name: '验收｜G01 港城总览 420 m', note: '受保护港池被港城环绕：货运东岸、湾顶渡站与步廊、居住西岸、塔簇',
    pose: { lat: 0.47, lon: 129.94, alt: 420, heading: 14, pitch: -4, lens: 35 }, solTime: local(129.94, 15.5), mode: 'orbit' },
];

export const TURNTABLE = [0, 90, 180, -90].map((lon) => ({
  id: `T${lon < 0 ? 'W' : 'E'}${Math.abs(lon)}`, group: 'turntable', name: `转台 中央经线 ${lon >= 0 ? '+' : ''}${lon}°`,
  pose: { lat: 0, lon, alt: ORBIT_ALT, heading: 0, pitch: -90, lens: 50 }, solTime: 15, subsolarLat: 12, mode: 'orbit',
}));

const KEY = 'mars.bookmarks.v1';
export function loadUserBookmarks() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
export function saveUserBookmarks(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ } }
export function allBookmarks() { return [...SHOTS, ...TURNTABLE, ...CHECKS, ...loadUserBookmarks()]; }
export function findBookmark(id) { return allBookmarks().find((b) => b.id === id) || null; }
