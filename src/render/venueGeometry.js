/**
 * 场馆几何的唯一真相源——所有尺寸、椭圆参数、半径查询都从这里出。
 *
 * ## 为什么要重写成真实尺度
 *
 * 之前场馆按 0.35 压缩（做成 116×100 m），但舞台、座椅、人、灯具全是真尺寸。
 * 这种"半压缩"会同时惹出三个问题，用户都指出来了：
 *
 *   1. 座椅区和田径场的比例不对——跑道被压扁了，座椅却没有；
 *   2. 座椅穿出建筑外壳——看台碗做成了**正圆** r=53 m，而外壳是椭圆、短轴只有 45 m，
 *      短轴方向硬生生凸出去 8 m；
 *   3. 建筑外形不对——压缩之后长短轴比也跟着失真。
 *
 * 所以这一版一次改到底：**全部真实尺度、全部椭圆**。
 *
 * ## 尺寸来源
 *
 * 平面比例是从用户提供的真实座位图 `src/image/2018706144452_37781.jpg` 上量出来的
 * （逐像素扫描座位区的内外边界），再用 400 m 标准跑道的外廓长度 176.9 m 标定：
 *
 *   看台外轮廓 253 × 232 m（长短轴比 1.09）
 *   看台内边缘 177 × 114 m（长短轴比 1.55）
 *   **侧面进深 59 m，两端只有 38 m** —— 相差 1.56 倍
 *
 * 最后这一条是关键：看台**不是把内圈等距外扩**得到的。等距外扩会保持"内圈细长"的形状，
 * 而真实看台在两侧堆得更深、把整体拉圆。所以这里的每一排是内椭圆的**等距偏移曲线**，
 * 但排能排到多远由外边界椭圆裁定——两侧自然就比两端多出几十排。
 */

/** 400 m 标准跑道：8 道、道宽 1.22 m，外廓约 176.9 × 92.5 m。 */
export const FIELD = {
  pitch: { a: 52.5, b: 34 }, // 标准足球场 105 × 68
  // 跑道内沿（突沿）：直段 84.39 m + 半径 36.5 m 的半圆，所以半长轴 = 84.39/2 + 36.5。
  // 真实跑道是 stadium 形不是椭圆，这里用等效椭圆近似——本项目只拿它画地面色块。
  trackIn: { a: 78.695, b: 36.5 },
  trackOut: { a: 89.68, b: 47.48 }, // 9 道 × 1.22 m
};

/** 看台碗。内边缘贴着跑道外的缓冲区，外边缘按平面图量得。 */
export const BOWL = {
  // 首排必须完全让开跑道外沿 (89.68, 47.48) 再加安全区与挡墙。
  // 上一版取 88.5×57，长轴方向比跑道外沿还小，首排直接压在跑道上。
  inner: { a: 104, b: 60 },
  outer: { a: 140, b: 124 },
};

/** 建筑外壳：333 × 294 m，高 69 m。 */
export const SHELL = {
  base: { a: 153, b: 136.5 }, // 柱脚圈：24 榀桁架柱、柱距 37.96 m，周长 911 m 反算得
  rim: { a: 166.15, b: 148.65 }, // 檐口——立面向外倾，上大下小
  opening: { a: 92.65, b: 63.75 }, // 屋盖开口内环
  height: 69,
  a: 166.15,
  b: 148.65,
};

/**
 * 檐口标高随方位起伏——这就是鸟巢的**马鞍屋盖**。
 * 高点在短轴侧、低点在长轴端，相差 25.7 m，是它侧影的灵魂。
 * @param {number} u 方位角，自 +X（长轴）起算
 */
export function rimHeight(u) {
  return 55.65 - 12.85 * Math.cos(2 * u);
}

/** 屋盖开口边缘的标高。 */
export function openingHeight(u) {
  return 54.3 - 6.0 * Math.cos(2 * u);
}

/** 把点收进椭圆内。 */
export function clampToEllipse(x, z, e) {
  const k = Math.hypot(x / e.a, z / e.b);
  return k > 1 ? [x / k, z / k] : [x, z];
}

/** 舞台：正中央的四面台。 */
export const STAGE = {
  width: 24,
  depth: 16,
  height: 1.8,
};

/** 椭圆周长（Ramanujan 近似，误差 &lt; 1e-5）。用来算一圈能坐多少人。 */
export function ellipsePerimeter(a, b) {
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * 椭圆上参数角 u 处、沿**外法线**偏移 d 之后的点。
 *
 * 注意不能简单地把半轴各加 d：那样得到的是另一个椭圆，
 * 而椭圆的等距偏移曲线并不是椭圆——在曲率大的两端会明显偏出去。
 * 看台的每一排都是等进深的，所以必须走真正的法线偏移。
 */
export function offsetPoint(a, b, u, d, out = [0, 0]) {
  const cu = Math.cos(u);
  const su = Math.sin(u);
  // 切向 (-a·sin u, b·cos u) → 外法线 (b·cos u, a·sin u)，归一化
  let nx = b * cu;
  let nz = a * su;
  const len = Math.hypot(nx, nz) || 1;
  nx /= len;
  nz /= len;
  out[0] = a * cu + nx * d;
  out[1] = b * su + nz * d;
  return out;
}

/** 点是否落在椭圆内（含边界）。 */
export function insideEllipse(x, z, a, b) {
  return (x * x) / (a * a) + (z * z) / (b * b) <= 1;
}

/**
 * 从中心朝方位角 u 射出，与椭圆 (a,b) 的交点距离。
 * 光斑投到看台内墙、热点遮挡判定都要用它——原先那些地方把场馆当圆处理，
 * 换成椭圆之后必须统一走这里。
 */
export function ellipseRadiusAt(a, b, u) {
  const c = Math.cos(u);
  const s = Math.sin(u);
  return (a * b) / Math.sqrt(b * b * c * c + a * a * s * s);
}

/**
 * 射线与竖直椭圆柱面 (x/a)² + (z/b)² = 1 求交，返回最近的正向交点参数 t。
 * 相机/灯在柱面内部时恒有唯一正根。
 */
export function rayEllipseCylinder(origin, dir, a, b) {
  const ox = origin[0] / a;
  const oz = origin[2] / b;
  const dx = dir[0] / a;
  const dz = dir[2] / b;

  const qa = dx * dx + dz * dz;
  if (qa < 1e-12) return null; // 垂直朝天，永远打不到墙

  const qb = 2 * (ox * dx + oz * dz);
  const qc = ox * ox + oz * oz - 1;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;

  const sq = Math.sqrt(disc);
  const t1 = (-qb - sq) / (2 * qa);
  const t2 = (-qb + sq) / (2 * qa);
  const t = t1 > 1e-4 ? t1 : t2;
  return t > 1e-4 ? t : null;
}

/**
 * 椭圆的弧长采样器。
 *
 * 激光的落点必须**沿看台按等弧长排布**（这样看上去间距才均匀），
 * 而椭圆上等角度并不等弧长，所以得先把弧长表打出来，再按弧长反查角度。
 */
export function ellipseArcSampler(a, b, N = 1440) {
  const cum = new Float64Array(N + 1);
  let px = a;
  let pz = 0;
  for (let i = 1; i <= N; i++) {
    const u = (i / N) * Math.PI * 2;
    const cx = a * Math.cos(u);
    const cz = b * Math.sin(u);
    cum[i] = cum[i - 1] + Math.hypot(cx - px, cz - pz);
    px = cx;
    pz = cz;
  }
  const total = cum[N];

  /** 弧长 → 方位角（自动绕圈）。 */
  const angleAt = (arc) => {
    let t = ((arc % total) + total) % total;
    // 二分查表
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= t) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    return ((lo + (t - cum[lo]) / seg) / N) * Math.PI * 2;
  };

  /** 方位角 → 弧长。 */
  const arcAt = (u) => {
    const t = ((u % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const f = (t / (Math.PI * 2)) * N;
    const i = Math.floor(f);
    const frac = f - i;
    return cum[i] + (cum[Math.min(N, i + 1)] - cum[i]) * frac;
  };

  return { total, angleAt, arcAt };
}

/** 椭圆柱面上一点的向内法线（水平面内）。 */
export function ellipseInwardNormal(x, z, a, b, out = [0, 0, 0]) {
  let nx = -x / (a * a);
  let nz = -z / (b * b);
  const len = Math.hypot(nx, nz) || 1;
  out[0] = nx / len;
  out[1] = 0;
  out[2] = nz / len;
  return out;
}
