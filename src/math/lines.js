/**
 * 直线族几何工具。
 *
 * 整个演示的科学内核只有一句话：**看上去的曲线，是一族直线的包络（envelope）。**
 * 包络的经典构造法（也就是"弦线艺术 / string art"的原理）是：
 *
 *   取直线族中相邻的两条线，求它们的交点；让两条线无限靠近，
 *   交点的极限位置就落在包络上。把所有相邻交点连起来，就画出了那条曲线。
 *
 * 在平面上相邻两条直线一定相交；但舞台上的光束是三维的，相邻两束光一般
 * 互不相交，属于**异面直线（skew lines）**。这时"交点"要换成
 * **两条直线上距离最近的那对点的中点**——当两条线足够靠近时，这个中点收敛到
 * 平面情形的交点，所以它是包络在三维里的自然推广。
 *
 * 本文件不依赖 three.js，纯数值，方便单独测试。
 */

const EPS = 1e-9;

/** 归一化（原地）。零向量原样返回。 */
export function normalize(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  if (len < EPS) return a;
  a[0] /= len;
  a[1] /= len;
  a[2] /= len;
  return a;
}

/**
 * 求两条异面直线上互相最近的一对点。
 *
 * 直线 1：P1 + s1 * D1        直线 2：P2 + s2 * D2      （D1、D2 需为单位向量）
 *
 * 令 r = P2 - P1，b = D1·D2，d = D1·r，e = D2·r，则
 *
 *     s1 = (d - b·e) / (1 - b²)
 *     s2 = (b·d - e) / (1 - b²)
 *
 * 分母 1 - b² = sin²θ（θ 为两直线夹角）。两线趋于平行时分母 → 0，解发散，
 * 必须显式判掉：此时"交点"跑到无穷远，对应的包络点没有意义。
 *
 * @param {number[]} p1 直线 1 上一点
 * @param {number[]} d1 直线 1 的单位方向
 * @param {number[]} p2 直线 2 上一点
 * @param {number[]} d2 直线 2 的单位方向
 * @param {number} [minSin2=1e-6] 分母（sin²θ）下限；小于它视为平行
 * @returns {{s1:number, s2:number, gap:number}|null} 参数值与两最近点的间距；平行时返回 null
 */
export function closestParamsBetweenLines(p1, d1, p2, d2, minSin2 = 1e-6) {
  const rx = p2[0] - p1[0];
  const ry = p2[1] - p1[1];
  const rz = p2[2] - p1[2];

  const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  const denom = 1 - b * b; // = sin²θ
  if (denom < minSin2) return null; // 近乎平行：无稳定交点

  const d = d1[0] * rx + d1[1] * ry + d1[2] * rz;
  const e = d2[0] * rx + d2[1] * ry + d2[2] * rz;

  const s1 = (d - b * e) / denom;
  const s2 = (b * d - e) / denom;

  // 两最近点之间的距离——衡量"这个交点有多真实"。
  const gx = rx + d2[0] * s2 - d1[0] * s1;
  const gy = ry + d2[1] * s2 - d1[1] * s1;
  const gz = rz + d2[2] * s2 - d1[2] * s1;

  return { s1, s2, gap: Math.hypot(gx, gy, gz) };
}

/**
 * 相邻两束光的"交点"——三维中取最近点对的中点。
 *
 * @returns {number[]|null} 世界坐标；若两线平行、或交点落在光束长度之外、
 *                          或两线错开太远（gap 超限）则返回 null。
 */
export function adjacentIntersection(p1, d1, p2, d2, opts = {}) {
  const { minS = 0.05, maxS = Infinity, maxGap = Infinity, minSin2 = 1e-6 } = opts;

  const r = closestParamsBetweenLines(p1, d1, p2, d2, minSin2);
  if (!r) return null;

  // 交点必须落在两束光的实际长度内，否则它只存在于"光束的延长线"上，
  // 观众根本看不见——把它画出来会得到一条凭空出现的假曲线。
  if (r.s1 < minS || r.s2 < minS) return null;
  if (r.s1 > maxS || r.s2 > maxS) return null;
  if (r.gap > maxGap) return null;

  const ax = p1[0] + d1[0] * r.s1;
  const ay = p1[1] + d1[1] * r.s1;
  const az = p1[2] + d1[2] * r.s1;
  const bx = p2[0] + d2[0] * r.s2;
  const by = p2[1] + d2[1] * r.s2;
  const bz = p2[2] + d2[2] * r.s2;

  return [(ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5];
}

/**
 * 由一族光束求包络曲线。
 *
 * 输入的 beams 必须**按空间顺序排列**（沿灯排/灯圈依次），否则"相邻"没有意义，
 * 连出来的不是包络而是一团乱麻。
 *
 * @param {{origin:number[], dir:number[], length:number}[]} beams 有序光束表
 * @param {object} [opts]
 * @param {boolean} [opts.closed=false] 灯是否首尾相接成环（四面台的灯圈是环）
 * @param {number} [opts.maxGap=Infinity] 允许的最近点间距上限
 * @param {(i:number)=>any} [opts.groupOf] 取第 i 盏灯所属的"组"。组号一变就强制断段。
 *        四面台是矩形灯圈，拐角处外法线突然转 90°，两侧的光束朝向毫无连续性可言，
 *        它们的交点是几何巧合而非包络，连起来会得到一条横穿全场的假曲线。
 * @returns {number[][][]} 若干段折线；每段是连续有效的包络点序列。
 *          分段是必要的：包络会在直线族的"退化处"断开，硬连起来会出现横穿全场的假线。
 */
export function envelopeFromBeams(beams, opts = {}) {
  const { closed = false, maxGap = Infinity, minSin2 = 1e-6, groupOf = null } = opts;
  const n = beams.length;
  const segments = [];
  if (n < 2) return segments;

  const pairCount = closed ? n : n - 1;
  let current = [];

  for (let i = 0; i < pairCount; i++) {
    const j = (i + 1) % n;
    const a = beams[i];
    const b = beams[j];
    const maxS = Math.min(a.length, b.length);

    const sameGroup = groupOf ? groupOf(i) === groupOf(j) : true;
    const hit = sameGroup
      ? adjacentIntersection(a.origin, a.dir, b.origin, b.dir, {
          minS: 0.05,
          maxS,
          maxGap,
          minSin2,
        })
      : null;

    if (hit) {
      current.push(hit);
    } else if (current.length > 1) {
      segments.push(current);
      current = [];
    } else {
      current = [];
    }
  }

  if (current.length > 1) segments.push(current);
  return segments;
}

