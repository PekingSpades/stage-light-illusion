/**
 * 灯阵（rig）的几何与运动模型——纯数学，不碰 three.js。
 *
 * 坐标约定：右手系，**y 轴向上**，舞台中心在原点，舞台长边沿 x 轴。
 * 观众四面环绕（in-the-round / 四面台）。长度单位：米。
 */

import { normalize } from '../math/lines.js';

const DEG = Math.PI / 180;

/**
 * 沿矩形周边均匀布灯。
 *
 * 每边分到的灯数按边长比例分配（四舍五入后修正总数），边内均匀排布并留半格边距，
 * 这样拐角处不会挤成一堆，绕一圈的间距也基本一致。
 *
 * @returns {{position:number[], outward:number[], tangent:number[], side:number}[]}
 *          按**绕行顺序**返回——顺序就是相位波传播的顺序，也是求包络时"相邻"的定义。
 */
function rectRing(width, depth, count, height) {
  const hw = width / 2;
  const hd = depth / 2;

  // 四条边：起点、终点、外法线。绕行顺序 +x → +z → -x → -z。
  const edges = [
    { from: [-hw, -hd], to: [hw, -hd], outward: [0, 0, -1] },
    { from: [hw, -hd], to: [hw, hd], outward: [1, 0, 0] },
    { from: [hw, hd], to: [-hw, hd], outward: [0, 0, 1] },
    { from: [-hw, hd], to: [-hw, -hd], outward: [-1, 0, 0] },
  ];

  const lengths = edges.map((e) => Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]));
  const perimeter = lengths.reduce((a, b) => a + b, 0);

  // 按边长比例分配，再把四舍五入丢掉/多出的灯补到最长的边上，保证总数精确等于 count。
  const raw = lengths.map((l) => (l / perimeter) * count);
  const per = raw.map((v) => Math.max(1, Math.round(v)));
  let drift = count - per.reduce((a, b) => a + b, 0);
  while (drift !== 0) {
    let target = 0;
    for (let i = 1; i < per.length; i++) {
      if (drift > 0 ? lengths[i] > lengths[target] : per[i] > per[target]) target = i;
    }
    per[target] += drift > 0 ? 1 : -1;
    drift += drift > 0 ? -1 : 1;
  }

  const fixtures = [];
  edges.forEach((edge, si) => {
    const n = per[si];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n; // 半格边距，避免拐角处两边的灯重叠
      const x = edge.from[0] + (edge.to[0] - edge.from[0]) * t;
      const z = edge.from[1] + (edge.to[1] - edge.from[1]) * t;
      const outward = [...edge.outward];
      fixtures.push({
        position: [x, height, z],
        outward,
        tangent: normalize([outward[2], 0, -outward[0]]), // up × outward
        side: si,
      });
    }
  });

  return fixtures;
}

/** 沿圆周均匀布灯。圆环没有拐角，是演示"直纹曲面"最干净的形状。 */
function circleRing(radius, count, height) {
  const fixtures = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const outward = [Math.cos(a), 0, Math.sin(a)];
    fixtures.push({
      position: [outward[0] * radius, height, outward[2] * radius],
      outward,
      tangent: normalize([outward[2], 0, -outward[0]]),
      side: 0,
    });
  }
  return fixtures;
}

/** 单排直线布灯。教学模式用：一维灯排的包络最容易看懂。 */
function lineRow(span, count, height) {
  const fixtures = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    fixtures.push({
      position: [(t - 0.5) * span, height, 0],
      outward: [0, 0, -1],
      tangent: [1, 0, 0],
      side: 0,
    });
  }
  return fixtures;
}

/**
 * 建灯阵。
 * @param {'rect'|'circle'|'line'} shape
 */
export function createRig(shape, { width, depth, radius, span, count, height }) {
  let fixtures;
  if (shape === 'circle') fixtures = circleRing(radius, count, height);
  else if (shape === 'line') fixtures = lineRow(span, count, height);
  else fixtures = rectRing(width, depth, count, height);

  fixtures.forEach((f, i) => {
    f.index = i;
  });
  return { shape, closed: shape !== 'line', fixtures };
}

/**
 * 计算某一时刻每盏灯的光束方向。
 *
 * 这里是整个演示的"发动机"，只有两行公式：
 *
 *     相位  φ_i = 2π·f·t + i·Δφ
 *     俯仰  T_i = T₀ + A_T·sin(φ_i) + S·(i/(N−1) − ½)
 *     水平  P_i = P₀ + A_P·sin(φ_i + ψ)
 *
 * S（tiltSpread）是灯控台上叫"扇形展开 / fan"的东西：俯仰角沿灯排线性铺开。
 * 它不只是好看——纯正弦驱动时，俯仰角沿灯排的变化率 dT/di 每个周期会两次穿过零，
 * 那一瞬间相邻光束彼此平行，包络被推到无穷远、从画面上消失。叠一个常数斜率上去，
 * 只要它大过正弦项的幅度，dT/di 就恒不为零，包络便始终存在且距离有界。
 *
 * 只对不闭合的灯阵（单排）生效：环形灯阵上加线性斜坡，首尾接缝处会突然跳一大截。
 *
 * i 是灯在灯阵中的序号。**Δφ（相邻灯相位差）是全场的灵魂**：Δφ=0 时所有灯完全同步，
 * 看到的是一整片平面在摆动；Δφ≠0 时"波"就沿着灯排跑起来，同一瞬间各灯指向不同，
 * 这一族朝向各异的直线才有了包络——曲线就是这么"长"出来的。
 *
 * P₀ 是绕世界竖直轴的旋转。它对每盏灯都改变"相对自身正前方"的同一个偏角，
 * 所以在圆形灯阵上它就是一个恒定的切向扭转：圆环 + 恒定 T + 恒定 P₀ 扫出的
 * 正是**单叶双曲面**——纯粹由直线构成、外形却是曲面的经典例子，
 * 其腰半径恰为 R·|sin P₀|（与俯仰角无关）。
 *
 * 方向的构造：先从竖直向上的 up 朝 outward 方向压下 T 角，再绕 up 转 P 角。
 *
 * fixture.position 存的是**灯头的 tilt 转轴**。真实摇头灯的出光口在灯头前端，离转轴还有
 * 十几厘米（lensOffset），所以光束起点要沿方向再推出去这一段——灯头一摆，光的起点
 * 也跟着划一小段弧。这一步只是把线段的起点沿自身方向平移，**不改变这条直线本身**，
 * 所以包络、双曲面腰半径那些结论一个都不受影响。
 *
 * @param {{fixtures:Array}} rig
 * @param {object} p 运动参数（角度用**度**，频率用 Hz）
 * @param {number} time 秒
 * @param {Array} out 复用的输出数组，元素形如 {origin, dir, length}
 */
export function computeBeams(rig, p, time, out = []) {
  const {
    tiltBase = 55,
    tiltAmp = 28,
    tiltSpread = 0,
    panBase = 0,
    panAmp = 0,
    panPhaseLag = 90,
    freq = 0.12,
    phaseStep = 24,
    beamLength = 70,
    lensOffset = 0,
  } = p;

  const wt = 2 * Math.PI * freq * time;
  const dPhi = phaseStep * DEG;
  const lag = panPhaseLag * DEG;

  const fixtures = rig.fixtures;
  const n = fixtures.length;
  out.length = n;

  // 扇形展开只对单排灯生效；环形灯阵加线性斜坡会在首尾接缝处炸出一个突变
  const spread = !rig.closed && n > 1 ? tiltSpread : 0;

  for (let i = 0; i < n; i++) {
    const f = fixtures[i];
    const phase = wt + i * dPhi;

    const fan = spread === 0 ? 0 : spread * (i / (n - 1) - 0.5);
    const T = (tiltBase + tiltAmp * Math.sin(phase) + fan) * DEG;
    const P = (panBase + panAmp * Math.sin(phase + lag)) * DEG;

    const ct = Math.cos(T);
    const st = Math.sin(T);
    const o = f.outward;

    // 从 up 朝 outward 压下 T 角（up=(0,1,0)，outward 是水平单位向量）
    let dx = o[0] * st;
    let dy = ct;
    let dz = o[2] * st;

    // 再绕世界 up 轴旋转 P 角
    if (P !== 0) {
      const cp = Math.cos(P);
      const sp = Math.sin(P);
      const nx = dx * cp + dz * sp;
      const nz = -dx * sp + dz * cp;
      dx = nx;
      dz = nz;
    }

    let slot = out[i];
    if (!slot) {
      slot = out[i] = { origin: [0, 0, 0], dir: [0, 0, 0], length: beamLength, index: i };
    }
    slot.origin[0] = f.position[0] + dx * lensOffset;
    slot.origin[1] = f.position[1] + dy * lensOffset;
    slot.origin[2] = f.position[2] + dz * lensOffset;
    slot.pivot = f.position;
    slot.dir[0] = dx;
    slot.dir[1] = dy;
    slot.dir[2] = dz;
    slot.length = beamLength;
    slot.index = i;
  }

  return out;
}
