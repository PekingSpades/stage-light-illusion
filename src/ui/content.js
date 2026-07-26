/**
 * 参数默认值、控件表、章节定义、老陆的台词。
 * 集中在一处，是为了让"讲什么"和"怎么演"能对着改，不会走散。
 *
 * 控件只写术语和数值，不写句子；解释一律由老陆开口。这条分工是刻意的：
 * 控件上挂说明文字，看的人会一边调一边读，两件事都做不好。
 */

export const DEFAULTS = {
  rigShape: 'rect', // rect | circle | line
  count: 64,
  span: 20, // 单排灯的长度（米）
  radius: 12, // 圆形灯阵的半径（米）

  tiltBase: 55, // 俯仰基准：0=竖直朝天，正=朝外压，负=朝场内压
  tiltAmp: 28,
  tiltSpread: 0, // 扇形展开（仅单排灯生效）
  panBase: 0, // 水平偏转：相对每盏灯自身正前方的固定偏角
  panAmp: 32,
  panPhaseLag: 90,
  freq: 0.18, // Hz
  phaseStep: 24, // 相邻灯相位差（度）
  beamLength: 110,
  beamAngle: 4, // 光束全角（度）

  haze: 0.6,
  gain: 1.0,
  maxGap: 2.0, // 三维腰线的容差（米）

  beamsOn: true, // 摇头灯光束
  laserOn: true, // 激光扫射（两者可各自开关，也可同时开）
  laserPerSide: 11, // 每条边、每条环廊的激光器数量
  laserFreq: 0.055, // 走完一个来回的频率
  laserCoverage: 0.72, // 每条边占它那 90° 扇区的比例（其余留空，四块不连续）
  laserSpacing: 0.05, // 相邻落点间距，占扇区弧长的比例（同时决定掉头波的速度）
  laserGain: 1.4,

  frozen: false,
  showEnvelope2D: true,
  showEnvelope3D: false,
  showExtensions: false,
  showFixtures: true,
  soloIndex: -1,
  trailSeconds: 0,
};

/**
 * 控件表。type: range | toggle | select
 * en 是灯光台上的英文缩写——行业里大家就这么叫，写出来比中文更好认。
 */
export const CONTROLS = [
  {
    group: '灯阵',
    en: 'RIG',
    items: [
      {
        key: 'rigShape',
        label: '灯阵形状',
        en: 'RIG',
        type: 'select',
        options: [
          { value: 'rect', label: '矩形（四面台）' },
          { value: 'circle', label: '圆环' },
          { value: 'line', label: '单排' },
        ],
      },
      { key: 'count', label: '灯数量', en: 'FIXTURES', type: 'range', min: 1, max: 96, step: 1 },
      { key: 'beamAngle', label: '光束角', en: 'BEAM', type: 'range', min: 1, max: 14, step: 0.5, unit: '°' },
      { key: 'beamLength', label: '光束长度', en: 'THROW', type: 'range', min: 20, max: 280, step: 1, unit: 'm' },
    ],
  },
  {
    group: '运动',
    en: 'MOVEMENT',
    items: [
      { key: 'phaseStep', label: '相邻灯相位差 Δφ', en: 'PHASE', type: 'range', min: 0, max: 90, step: 1, unit: '°' },
      { key: 'freq', label: '摆动频率', en: 'FREQ', type: 'range', min: 0, max: 0.8, step: 0.01, unit: 'Hz' },
      { key: 'tiltBase', label: '俯仰基准 T₀', en: 'TILT', type: 'range', min: -85, max: 85, step: 1, unit: '°' },
      { key: 'tiltAmp', label: '俯仰摆幅 A_T', en: 'TILT AMP', type: 'range', min: 0, max: 45, step: 1, unit: '°' },
      { key: 'tiltSpread', label: '扇形展开 S', en: 'FAN', type: 'range', min: -120, max: 120, step: 1, unit: '°' },
      { key: 'panBase', label: '水平偏转 P₀', en: 'PAN', type: 'range', min: -90, max: 90, step: 1, unit: '°' },
      { key: 'panAmp', label: '水平摆幅 A_P', en: 'PAN AMP', type: 'range', min: 0, max: 70, step: 1, unit: '°' },
      { key: 'panPhaseLag', label: '水平/俯仰相位差 ψ', en: 'LAG', type: 'range', min: 0, max: 180, step: 1, unit: '°' },
    ],
  },
  {
    group: '激光',
    en: 'LASER',
    items: [
      { key: 'beamsOn', label: '摇头灯光束', en: 'BEAMS', type: 'toggle' },
      { key: 'laserOn', label: '激光扫射', en: 'LASER', type: 'toggle' },
      { key: 'laserPerSide', label: '每边激光器数', en: 'PER SIDE', type: 'range', min: 2, max: 20, step: 1 },
      { key: 'laserFreq', label: '来回频率', en: 'RATE', type: 'range', min: 0.02, max: 0.6, step: 0.01, unit: 'Hz' },
      { key: 'laserCoverage', label: '每边覆盖占比', en: 'COVER', type: 'range', min: 0.3, max: 1, step: 0.01 },
      { key: 'laserSpacing', label: '落点间距', en: 'PITCH', type: 'range', min: 0.01, max: 0.09, step: 0.002 },
      { key: 'laserGain', label: '激光亮度', en: 'L-DIM', type: 'range', min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    group: '氛围',
    en: 'ATMOSPHERE',
    items: [
      { key: 'haze', label: '烟雾浓度', en: 'HAZE', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'gain', label: '整体亮度', en: 'DIM', type: 'range', min: 0.2, max: 2, step: 0.05 },
    ],
  },
  {
    group: '证据图层',
    en: 'PROOF',
    items: [
      { key: 'showEnvelope2D', label: '屏幕包络（金）', en: 'ENVELOPE', type: 'toggle' },
      { key: 'showEnvelope3D', label: '空间腰线（青）', en: 'STRICTION', type: 'toggle' },
      { key: 'showExtensions', label: '光束延长线', en: 'RAYS', type: 'toggle' },
      { key: 'maxGap', label: '腰线容差', en: 'TOL', type: 'range', min: 0.2, max: 20, step: 0.1, unit: 'm' },
      { key: 'showFixtures', label: '显示灯具', en: 'HEADS', type: 'toggle' },
      { key: 'soloIndex', label: '独奏（−1 为关）', en: 'SOLO', type: 'range', min: -1, max: 95, step: 1 },
      { key: 'trailSeconds', label: '交点拖尾', en: 'TRAIL', type: 'range', min: 0, max: 4, step: 0.1, unit: 's' },
    ],
  },
];

/** 扁平化的控件表，底部编码条按 key 取用。 */
export const CONTROLS_FLAT = CONTROLS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group })));

/**
 * 演示章节。
 * dialog[] 是老陆的台词，一页一句；act 在翻过这一页时执行。
 * 写作约定：单句尽量不超过 28 字；先说行话再翻成人话；每章最后一句是祈使句——
 * 让人从"听讲"切回"动手"。
 */
export const CHAPTERS = [
  {
    id: 'one',
    label: '一束光',
    en: 'SINGLE',
    camera: 'pit',
    title: '先看清楚：一束光是直的',
    encoders: ['tiltBase', 'tiltAmp', 'haze', 'beamAngle'],
    dialog: [
      { t: '先看一台。这玩意儿叫**电脑摇头灯**，能水平转、也能上下摆。' },
      { t: '细而亮的这一类叫**光束灯**，行话就说 beam。' },
      { t: '它射出去的是一条直线。从头到尾，**没弯过**。' },
      { t: '你能看见它，是因为雾机在放烟。没烟，这束光是隐形的。', mood: 'key' },
      {
        t: '我把延长线打开——它笔直穿出整个场馆。',
        mood: 'point',
        act: { set: { showExtensions: true }, flash: 'showExtensions' },
      },
      { t: '拖着视角绕它飞一圈。从哪个角度看，它都是直的。', mood: 'point' },
    ],
    params: {
      rigShape: 'line',
      count: 1,
      span: 4,
      tiltBase: 35,
      tiltAmp: 22,
      panBase: 0,
      panAmp: 30,
      phaseStep: 0,
      freq: 0.1,
      beamLength: 130,
      beamAngle: 3.5,
      haze: 0.75,
      showExtensions: true,
      showEnvelope2D: false,
      showEnvelope3D: false,
      trailSeconds: 0,
    },
  },
  {
    id: 'two',
    label: '两束光',
    en: 'PAIR',
    camera: 'front',
    title: '曲线是从哪儿冒出来的',
    encoders: ['phaseStep', 'trailSeconds', 'freq', 'tiltAmp'],
    dialog: [
      { t: '加第二台，两台对着打，都朝里。' },
      { t: '让第二台比第一台**晚一点点**开始摆。这就是相位差。' },
      { t: '盯住那个交点。它在动，一路划出一道弧。' },
      { t: '弧是交点**走过的路**，不是光的形状。', mood: 'key' },
      { t: '两根光线自始至终都是直的。弯的只有那条轨迹。' },
      { t: '把「交点拖尾」再拉长点，看它怎么被一点点走出来。', mood: 'point', act: { flash: 'trailSeconds' } },
    ],
    params: {
      rigShape: 'circle',
      radius: 5,
      count: 2,
      tiltBase: -34,
      tiltAmp: 26,
      panBase: 0,
      panAmp: 0,
      phaseStep: 62,
      freq: 0.11,
      beamLength: 95,
      beamAngle: 3.5,
      haze: 0.7,
      showExtensions: true,
      showEnvelope2D: false,
      showEnvelope3D: false,
      trailSeconds: 2.6,
      maxGap: 1.5,
    },
  },
  {
    id: 'row',
    label: '一排灯',
    en: 'ROW',
    camera: 'front',
    title: '很多条直线，织出一条曲线',
    encoders: ['phaseStep', 'tiltSpread', 'count', 'freq'],
    dialog: [
      { t: '排成一排，每台都比前一台晚一点。台上管这叫**跑相位**。' },
      { t: '同一瞬间，这一排的朝向各不相同——你得到了一族直线。' },
      { t: '金色那条就是它们的**包络线**，跟每一束光都相切。' },
      { t: '金色小点是切点。数一数，一束光对着一个点。', mood: 'key' },
      { t: '和拿直线绣出弧线的弦线艺术是同一回事。针针都是直的。' },
      { t: '青线是这条曲线在空间里的位置。这一章两条重合——它是真的。' },
      {
        t: '现在把相位差归零，自己看会发生什么。',
        mood: 'key',
        act: { set: { phaseStep: 0 }, flash: 'phaseStep' },
      },
    ],
    params: {
      rigShape: 'line',
      count: 26,
      span: 20,
      tiltBase: 0,
      // S=96 是离线扫参的结果：整个摆动周期里 24 个切点始终 100% 落在画面舒适区内。
      // 扇形展开撑住整把扇，保证 dT/di 恒不为零，包络不会被推到无穷远而消失。
      tiltSpread: 96,
      tiltAmp: 15,
      panBase: 90, // 共面扇：整排光束都躺在同一个竖直平面里
      panAmp: 0,
      phaseStep: 5,
      freq: 0.13,
      beamLength: 85,
      beamAngle: 2.6,
      haze: 0.62,
      showExtensions: false,
      showEnvelope2D: true,
      showEnvelope3D: true,
      maxGap: 1.2,
      trailSeconds: 0,
    },
  },
  {
    id: 'view',
    label: '换个座位',
    en: 'SEAT',
    camera: 'side',
    title: '大多数时候，那条曲线并不在空中',
    encoders: ['phaseStep', 'panAmp', 'maxGap', 'tiltBase'],
    dialog: [
      { t: '上一章那排灯，光束全躺在同一个平面里。' },
      { t: '真实演出不是这样。俯仰和水平一起摆，光束**互不共面**。' },
      { t: '数学上叫异面直线。说人话：相邻两束根本不相交。' },
      { t: '所以空间里已经没有那条曲线了。它不存在。', mood: 'key' },
      { t: '可你还是看得见一条弯的光带——因为它是**投影**出来的。' },
      { t: '青线才是三维里真正最接近的那些点。看，它和金线分家了。' },
      { t: '把「腰线容差」调小，青线会断成碎片。那些点不是交点。', act: { flash: 'maxGap' } },
      { t: '按 2 换到侧面座位。同一瞬间，金线的形状全变了。', mood: 'key', act: { cam: 'infield-side' } },
    ],
    params: {
      rigShape: 'rect',
      count: 56,
      tiltBase: 52,
      tiltAmp: 26,
      panBase: 0,
      panAmp: 32,
      panPhaseLag: 90,
      phaseStep: 22,
      freq: 0.1,
      beamLength: 110,
      beamAngle: 3,
      haze: 0.55,
      showEnvelope2D: true,
      showEnvelope3D: true,
      showExtensions: false,
      maxGap: 6,
      trailSeconds: 0,
    },
  },
  {
    id: 'ruled',
    label: '直纹曲面',
    en: 'RULED',
    camera: 'front',
    title: '一堆直线，真的能围出曲面',
    encoders: ['panBase', 'tiltBase', 'count', 'haze'],
    dialog: [
      { t: '前面说曲线只在投影里。但有一种情况，弯是**真的**。' },
      { t: '让所有灯停住不摆，每台朝自己正前方偏同一个角度。' },
      { t: '光束扫出来的这个东西，叫**单叶双曲面**。' },
      { t: '它整个曲面完全由直线构成。一根弯的都没有。', mood: 'key' },
      { t: '腰最细处的半径正好是 R·sin(偏转角)，跟俯仰角没关系。' },
      { t: '摩天大楼的双曲面塔能全用直钢梁搭起来，就是这个道理。' },
      { t: '慢慢拖「水平偏转」，从圆锥一路拧成圆筒。', mood: 'point', act: { flash: 'panBase' } },
    ],
    params: {
      rigShape: 'circle',
      radius: 12,
      count: 72,
      tiltBase: -34,
      tiltAmp: 0,
      panBase: 45,
      panAmp: 0,
      phaseStep: 0,
      freq: 0,
      beamLength: 100,
      beamAngle: 2.5,
      haze: 0.7,
      showEnvelope2D: false,
      showEnvelope3D: true,
      showExtensions: false,
      maxGap: 2,
      trailSeconds: 0,
    },
  },
  {
    id: 'arena',
    label: '鸟巢四面台',
    en: 'ARENA',
    camera: 'front',
    title: '把它们全部放回演唱会里',
    encoders: ['phaseStep', 'freq', 'haze', 'panAmp'],
    dialog: [
      { t: '回现场。长方形台，四面都是观众，台沿一圈六十多台摇头灯。' },
      { t: '相位差让波绕着灯圈跑，雾机让整根光柱显形。' },
      { t: '俯仰和水平错开 90° 相位——这就是你在鸟巢看到的那个东西。' },
      { t: '光从头到尾都是直的。弯的是**做法**。', mood: 'key' },
      { t: '几十条直线按相位排好队，剩下的交给你的眼睛。' },
      { t: '按 4 上高空，看那道波是怎么一圈圈绕着灯环跑的。', mood: 'point', act: { cam: 'top' } },
    ],
    params: {
      rigShape: 'rect',
      count: 64,
      tiltBase: 55,
      tiltAmp: 28,
      panBase: 0,
      panAmp: 32,
      panPhaseLag: 90,
      phaseStep: 24,
      freq: 0.18,
      beamLength: 110,
      beamAngle: 4,
      haze: 0.6,
      showEnvelope2D: false,
      showEnvelope3D: false,
      showExtensions: false,
      trailSeconds: 0,
    },
  },
  {
    id: 'laser',
    label: '激光扫射',
    en: 'LASER',
    camera: 'middle-front',
    title: '激光为什么能扫出一条笔直的水平线',
    encoders: ['laserPerSide', 'laserSpacing', 'laserFreq', 'laserGain'],
    dialog: [
      { t: '看台上那一圈激光，是另一套东西——它不能乱扫。' },
      { t: '激光功率高，直射眼睛有危险。所以只能走**没有观众的地方**。' },
      { t: '看台分三层，层与层之间有环廊。那几条带子一整圈都是水平的。', mood: 'key' },
      { t: '激光器位置固定，只能水平转。落点却要恒定压在环廊上。' },
      { t: '难点在于场馆是**椭圆**：长轴方向远、短轴方向近。' },
      { t: '同一个俯仰角，在远处打高、在近处打低——落点就成了波浪线。', mood: 'key' },
      { t: '还有一条：**一侧的激光只服务一侧**，在自己那段来回平扫，不会绕过去。' },
      { t: '而且落点之间的间距是**固定**的。这一条反过来定死了做法。', mood: 'key' },
      { t: '因为椭圆上同样的转角在远处对应更长的弧——按转角驱动，间距一定会变。' },
      { t: '所以驱动量不是转角，而是**落点在看台上的位置**：先按等弧长排好，再反解转角。', mood: 'key' },
      { t: '副产品正是现场看到的：每台激光转得快慢都不一样，同一台在扫的过程中也在变。' },
      { t: '每台都在自己那个扇区里走完整段、大幅左右扫，到端点立刻掉头。' },
      { t: '做法是所有灯共用一条三角波，只差一点相位——**不加任何固定偏移**。', mood: 'key' },
      { t: '三角波斜率是常数，所以相邻落点间距恒等于"相位差×斜率"，两个方向一样大。' },
      { t: '而相位不同，掉头就自然逐台发生，像一道波传过整排。' },
      { t: '拖「落点间距」看：它同时决定了间距和掉头波的速度，这两件事本来就是一回事。', mood: 'point', act: { flash: 'laserSpacing' } },
    ],
    params: {
      rigShape: 'rect',
      count: 48,
      tiltBase: 58,
      tiltAmp: 20,
      panAmp: 24,
      panPhaseLag: 90,
      phaseStep: 20,
      freq: 0.12,
      beamLength: 110,
      beamAngle: 3.4,
      haze: 0.62,
      gain: 0.7, // 把摇头灯压暗一点，让激光成为主角
      beamsOn: true,
      laserOn: true,
      laserPerSide: 13,
      laserFreq: 0.05,
      laserCoverage: 0.74,
      laserSpacing: 0.05,
      laserGain: 1.8,
      showEnvelope2D: false,
      showEnvelope3D: false,
      showExtensions: false,
      trailSeconds: 0,
    },
  },
  {
    id: 'lab',
    label: '自由实验室',
    en: 'FREE',
    camera: null,
    title: '随便调',
    encoders: ['phaseStep', 'freq', 'haze', 'count'],
    dialog: [
      { t: '参数全放开了。几个我常拿来试的组合：' },
      { t: '相位差归零 —— 曲线立刻塌成一面平墙。' },
      { t: '烟雾归零 —— 光柱消失，只剩看台上的光斑在跳。' },
      { t: '光束角拉到 12 度 —— 糊成一片，包络就读不出来了。' },
      { t: '圆环 + 俯仰摆幅归零 + 水平偏转 60 度 —— 又是双曲面。' },
      { t: '自己玩。想不明白就回上一章，我再讲一遍。', mood: 'point' },
    ],
    params: {
      // 实验室给一个"什么都开着"的完整现场：四面台 + 两条证据曲线都亮着，
      // 从这里往任何方向调都能立刻看出变化。
      rigShape: 'rect',
      count: 64,
      tiltBase: 54,
      tiltAmp: 27,
      panBase: 0,
      panAmp: 32,
      panPhaseLag: 90,
      phaseStep: 24,
      freq: 0.16,
      beamLength: 110,
      beamAngle: 3.2,
      haze: 0.6,
      showEnvelope2D: true,
      showEnvelope3D: true,
      showExtensions: false,
      maxGap: 6,
      trailSeconds: 0,
    },
  },
];

export const INTRO = {
  title: '光束实验室',
  subtitle: 'BEAM LAB',
};
