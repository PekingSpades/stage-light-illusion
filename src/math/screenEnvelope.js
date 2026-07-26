/**
 * 屏幕空间包络——"你眼睛真正看到的那条曲线"。
 *
 * 为什么必须在屏幕空间算？这是本项目最容易被做错的一点，值得说清楚：
 *
 * 设想一排灯只做上下俯仰摆动。第 i 盏灯的光束整条都躺在平面 x = xᵢ 里，
 * 相邻两束光分属两个**平行**平面，因此它们在三维空间中永远不相交——
 * 空间里压根不存在一条"由交点连成的曲线"。可你明明看见了曲线。
 *
 * 因为看见的东西是**投影**。把这一族三维直线投到视网膜（或屏幕）上，
 * 得到的是一族二维直线；二维直线族一定有包络，那条与每一根光束都相切的
 * 二维曲线，就是你看到的"拐弯的光"。
 *
 * 由此得到一个可以直接验证的推论，也是本演示最有说服力的地方：
 * **换个座位，曲线的形状就变了**——因为它是投影的性质，不是空间中的实物。
 * （唯一的例外是光束扫出真正的直纹曲面，比如单叶双曲面：
 *   那时任何角度看轮廓都是弯的，见 lines.js 里的三维包络。）
 *
 * 本模块不引入 three.js 类型，只接收一个 4×4 的 viewProjection 矩阵
 * （列主序，与 three.js 的 Matrix4.elements 一致）。
 */

const CLIP_EPS = 1e-4;

/**
 * 用列主序 4×4 矩阵变换齐次点，返回 [x, y, z, w]（裁剪空间）。
 */
function transform(m, x, y, z, out) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return out;
}

const _a = [0, 0, 0, 0];
const _b = [0, 0, 0, 0];

/**
 * 把一条三维线段投影成屏幕上的二维线段，并对相机近平面做裁剪。
 *
 * 不裁剪会出大问题：相机背后的点 w < 0，除以 w 之后坐标会翻到屏幕另一侧，
 * 于是屏幕上凭空出现一条方向完全错误的线，包络也就跟着崩掉。
 *
 * @returns {{x1:number,y1:number,x2:number,y2:number}|null} 像素坐标；整段都在相机背后时返回 null
 */
export function projectSegment(m, p0, p1, width, height) {
  transform(m, p0[0], p0[1], p0[2], _a);
  transform(m, p1[0], p1[1], p1[2], _b);

  let ax = _a[0], ay = _a[1], aw = _a[3];
  let bx = _b[0], by = _b[1], bw = _b[3];

  const aIn = aw > CLIP_EPS;
  const bIn = bw > CLIP_EPS;
  if (!aIn && !bIn) return null;

  if (aIn !== bIn) {
    // 在 w = CLIP_EPS 处切一刀，把跑到相机背后的那一头拉回近平面上。
    const t = (CLIP_EPS - aw) / (bw - aw);
    const cx = ax + (bx - ax) * t;
    const cy = ay + (by - ay) * t;
    if (aIn) {
      bx = cx; by = cy; bw = CLIP_EPS;
    } else {
      ax = cx; ay = cy; aw = CLIP_EPS;
    }
  }

  const hw = width * 0.5;
  const hh = height * 0.5;
  return {
    x1: (ax / aw) * hw + hw,
    y1: hh - (ay / aw) * hh,
    x2: (bx / bw) * hw + hw,
    y2: hh - (by / bw) * hh,
  };
}

/**
 * 投影单个世界坐标点。点在相机背后时返回 null——调用方必须处理，
 * 否则会在屏幕上画出一个位置完全错误的标记。
 */
export function projectPoint(m, p, width, height) {
  transform(m, p[0], p[1], p[2], _a);
  if (_a[3] <= CLIP_EPS) return null;
  const hw = width * 0.5;
  const hh = height * 0.5;
  return { x: (_a[0] / _a[3]) * hw + hw, y: hh - (_a[1] / _a[3]) * hh };
}

/**
 * 把一族光束投影成屏幕线段表。顺序保持不变（相邻关系就是灯阵上的相邻关系）。
 */
export function projectBeams(beams, viewProjection, width, height, out = []) {
  out.length = 0;
  const p1 = [0, 0, 0];
  for (let i = 0; i < beams.length; i++) {
    const b = beams[i];
    p1[0] = b.origin[0] + b.dir[0] * b.length;
    p1[1] = b.origin[1] + b.dir[1] * b.length;
    p1[2] = b.origin[2] + b.dir[2] * b.length;
    const seg = projectSegment(viewProjection, b.origin, p1, width, height);
    if (seg) {
      seg.index = i;
      out.push(seg);
    } else {
      out.push(null); // 占位，保持下标与灯序号一一对应
    }
  }
  return out;
}

// envelope2D 的临时缓冲，逐帧复用，避免每帧新建数组
const _dx = [];
const _dy = [];
const _len = [];
const _ox = [];
const _oy = [];

/**
 * 求屏幕空间包络：与每一束光都相切的那条曲线。
 *
 * 教科书上讲包络有两种等价说法。一种是"取相邻两条直线的交点，让它们无限靠近"——
 * 直观，但灯只有几十盏时相邻两条离得并不近，算出来的交点会跳来跳去，连成锯齿。
 * 另一种是**解析法**，本函数用的就是它，结果光滑得多：
 *
 *   把直线族写成 F(x, u) = (x − p(u)) × d(u) = 0，u 是灯的序号（视作连续变量），
 *   p(u) 是灯在屏幕上的位置，d(u) 是光束在屏幕上的单位方向。
 *   包络同时满足 F = 0 与 ∂F/∂u = 0。代入 x = p + s·d 解出切点到灯的距离：
 *
 *                    p′ × d
 *              s = ───────────
 *                    d × d′
 *
 * 分母 d × d′ 是光束方向在屏幕上的转动速率。它趋近 0 意味着相邻光束在屏幕上
 * 转不动了，切点被推向无穷远——那里包络确实不存在，必须断开而不是硬连过去。
 *
 * 附带的好处：这个式子直接给出**每一束光上的切点**。把这些点画出来，
 * "曲线与每根光束相切"就不再是一句断言，而是屏幕上看得见的事实。
 *
 * @param {Array} screenSegs projectBeams 的输出（可含 null）
 * @param {object} [opts]
 * @param {boolean} [opts.closed=false] 灯阵是否成环
 * @param {number} [opts.maxJump=Infinity] 相邻切点像素距离上限，超过就断开
 * @param {(i:number)=>any} [opts.groupOf] 组号变化处强制断段（矩形灯圈的拐角）
 * @param {number} [opts.minTurn=2e-3] 转动速率下限，低于它认为包络退化
 * @returns {{x:number,y:number}[][]} 若干段折线
 */
export function envelope2D(screenSegs, opts = {}) {
  const { closed = false, maxJump = Infinity, groupOf = null, minTurn = 2e-3 } = opts;
  const n = screenSegs.length;
  const polylines = [];
  if (n < 3) return polylines; // 少于三盏灯谈不上"方向的变化率"

  for (let i = 0; i < n; i++) {
    const s = screenSegs[i];
    if (!s) {
      _len[i] = 0;
      continue;
    }
    const ex = s.x2 - s.x1;
    const ey = s.y2 - s.y1;
    const len = Math.hypot(ex, ey);
    if (len < 1e-3) {
      _len[i] = 0;
      continue;
    }
    _dx[i] = ex / len;
    _dy[i] = ey / len;
    _len[i] = len;
    _ox[i] = s.x1;
    _oy[i] = s.y1;
  }

  let current = [];
  let prev = null;
  const flush = () => {
    if (current.length > 1) polylines.push(current);
    current = [];
    prev = null;
  };

  const first = closed ? 0 : 1;
  const last = closed ? n - 1 : n - 2;

  for (let i = first; i <= last; i++) {
    const c = i;
    const m = (i - 1 + n) % n;
    const p = (i + 1) % n;

    if (!_len[c] || !_len[m] || !_len[p]) {
      flush();
      continue;
    }
    if (groupOf && (groupOf(m) !== groupOf(c) || groupOf(p) !== groupOf(c))) {
      flush();
      continue;
    }
    // 相邻光束在屏幕上朝向相反时，中心差分算出来的"导数"没有意义
    if (_dx[c] * _dx[m] + _dy[c] * _dy[m] < 0 || _dx[c] * _dx[p] + _dy[c] * _dy[p] < 0) {
      flush();
      continue;
    }

    const ddx = (_dx[p] - _dx[m]) * 0.5;
    const ddy = (_dy[p] - _dy[m]) * 0.5;
    const opx = (_ox[p] - _ox[m]) * 0.5;
    const opy = (_oy[p] - _oy[m]) * 0.5;

    const omega = _dx[c] * ddy - _dy[c] * ddx; // d × d′
    if (Math.abs(omega) < minTurn) {
      flush();
      continue;
    }

    const s = (opx * _dy[c] - opy * _dx[c]) / omega; // (p′ × d) / (d × d′)
    // 切点必须落在真正画出来的那段光束上，否则它只存在于延长线上，观众看不见
    if (!(s > 0.5) || s > _len[c]) {
      flush();
      continue;
    }

    const pt = { x: _ox[c] + _dx[c] * s, y: _oy[c] + _dy[c] * s, index: c };
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) > maxJump) flush();
    current.push(pt);
    prev = pt;
  }

  flush();
  return polylines;
}
