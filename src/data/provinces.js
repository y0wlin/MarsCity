// Province table (prompt §2). ID 1..12 = OX1..OX6, ZR1..ZR6 (§4 图层接入).
// Names and coordinates are the art package's own setting (本包创作设定).

export const ZONES = {
  O: { code: 'O', name: '富氧改造区', share: 0.35, ref: 'R1' },
  Z: { code: 'Z', name: '祝融市宜居城建区', share: 0.65, ref: 'R4 / R2' },
};

export const PROVINCES = [
  null,
  { id: 1, code: 'OX1', name: '东泽水网', zone: 'O', lon: 105, lat: 8,
    form: '台地泄水进入蓝色多汊湖。沿堤路串起闸务站、温室和低层镇。',
    night: '闸站白点与稀疏镇灯，渠田大部保持暗色',
    shot: '从入湖河口逆流看。宽水面被较高的旧河床分成几支，田块的窄边朝向引水渠。旧堤上留出一排工务住宅和一条林荫路，一座小桥把它们接到闸房。' },
  { id: 2, code: 'OX2', name: '西峡集水地', zone: 'O', lon: -105, lat: -9,
    form: '支谷截水，检修线绕过峭壁接入窄谷泵站。可从工务宿舍走到栈桥。',
    night: '灯列服从谷底曲折与车站间距',
    shot: '以峡壁阴影为前景，沿谷底追踪一条从支沟汇入主渠的水路。检修步道固定在水线之上的稳定岩肩。' },
  { id: 3, code: 'OX3', name: '赤岸围垦地', zone: 'O', lon: -135, lat: 22,
    form: '低围堤圈住长条耕地，排渠汇入潮池。聚落集中在较高的旧堤。',
    night: '堤埂暗，聚落和通航口成串',
    shot: '低角度掠过海岸，外侧水色较深，朝水坡覆有深色护面，背侧才是排水沟和长条农田。' },
  { id: 4, code: 'OX4', name: '北冠冰缘', zone: 'O', lon: 45, lat: 72,
    form: '冰崖、融水前池、背风温室相接。岩脚显出土红色，积霜留在阴面。',
    night: '低太阳下的小型暖色维修屋和少数调度灯',
    shot: '沿低角度日光看冰崖脚下的融水前池，温室依背风岩体排列，沿保温管可从融水泵房找到温室配水间。' },
  { id: 5, code: 'OX5', name: '南台地梯田', zone: 'O', lon: -45, lat: -28,
    form: '六级水阶构成干原至耕地的过渡，工作镇落在泄洪线以外的台肩。',
    night: '各级闸口独立亮起，库面间断成暗带',
    shot: '顺谷向下选能同时看到几道水面标高的机位。六级水阶依次折入支谷，中段检修路以回头弯绕开落差。' },
  { id: 6, code: 'OX6', name: '南极补给链', zone: 'O', lon: -165, lat: -65,
    form: '霜原、岩岛与短生长季农棚。低矮保温站由管廊和服务路连接。',
    night: '管廊转折处有标志灯，两站之间有长暗段',
    shot: '从一座岩岛上的补给站望向下一处可避风的坡脚，管廊随地形起伏，长段霜原只保留少量维护标志。' },
  { id: 7, code: 'ZR1', name: '东海岸都市带', zone: 'Z', lon: 118, lat: 22,
    form: '多个核心沿岸相连，低岛、桥、渡站和地面轨道分担往来。潮堤外是深水航道。',
    night: '港区冷白，岸城连续暖亮，内湾仍暗',
    shot: '把远岸处理成几个有间距的高层中心。先由低岛渡站、桥头社区与岸边学校给出日常尺度，再沿内陆轨道抬高天际线。' },
  { id: 8, code: 'ZR2', name: '西陆峡廊', zone: 'Z', lon: -105, lat: 35,
    form: '住宅层层退台，沿崖站点形成次中心。桥横跨峡谷通勤，红岩越过楼冠。',
    night: '两岸带状灯，中间留河水与崖壁暗隙',
    shot: '两侧坡面的街道沿等高线展开。站台跨在标高相近的两段街面之间，住宅屋顶可成为上一级街道的小花园。' },
  { id: 9, code: 'ZR3', name: '中陆高原群城', zone: 'Z', lon: -15, lat: 22,
    form: '城际站串联多个高地市镇，公共塔簇居中，低密社区沿风口分开。',
    night: '多核亮斑由较暗的城际廊道连接',
    shot: '从台地边缘横看三座相互可见的城镇。老城区沿避风坡聚集，新社区追随城际站形成另一团较浅的屋面。' },
  { id: 10, code: 'ZR4', name: '晨曦群岛', zone: 'Z', lon: 165, lat: 8,
    form: '各岛拥有自己的码头、诊所和学校。航线穿越经度接缝，两岸共享班次。',
    night: '离散岛城与码头成链，深水航道留空',
    shot: '将城市功能分散到可通航的几个岛。主岛有码头广场和车站，较小岛有学校、诊所与朝向渡口的街市。' },
  { id: 11, code: 'ZR5', name: '南盆港群', zone: 'Z', lon: 105, lat: -46,
    form: '港池呈扇形，货运调度在岸后，住宅、水上市集及滨水公园沿侧湾生长。',
    night: '作业岸线硬而冷，居住湾细碎温暖',
    shot: '从港湾入口向内看，货运泊位、集装卸区和仓储街形成连续序列，办公和住宅退到侧湾。' },
  { id: 12, code: 'ZR6', name: '南纬穹谷', zone: 'Z', lon: -105, lat: -65,
    form: '日照较好的谷坡集中居住，暖廊跨街，设备背向盛行风，温室庭院连成片。',
    night: '公共暖廊间断透光，背坡收暗',
    shot: '住宅阶梯状集中在向阳谷坡，用连续有顶廊把住户入口、公共温室和街角小店相连。' },
];

export function provinceById(id) { return PROVINCES[id] || null; }
export function provinceByCode(code) { return PROVINCES.find((p) => p && p.code === code) || null; }

// Megastructures (§3 巨构数量与形状): exactly two on the planet.
export const MEGASTRUCTURES = [
  { id: 'G01', name: '东海分段潮堤', province: 'ZR1', serves: 'city' },
  { id: 'G02', name: '南台地水阶', province: 'OX5', serves: 'water' },
];
