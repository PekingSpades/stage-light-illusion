/**
 * 看台与固定座椅——真实尺度、椭圆环。
 *
 * ## 平面：椭圆，而且两侧比两端深得多
 *
 * 尺寸从用户给的真实座位图 `src/image/2018706144452_37781.jpg` 逐像素量出来，
 * 再用 400 m 标准跑道外廓 176.9 m 标定：
 *
 *     看台内边缘 177 × 114 m（长短轴比 1.55）
 *     看台外边缘 253 × 232 m（长短轴比 1.09）
 *     侧面进深 59 m，两端只有 38 m
 *
 * 注意内外两条边界的**长短轴比完全不同**：内圈细长（贴着跑道），外圈接近圆。
 * 这说明看台不是把内圈等距外扩得到的——两侧堆得深，把整体拉圆。
 *
 * 所以这里每一排按"从内边界到外边界的**比例** s∈[0,1]"定位，而不是按固定进深外扩。
 * 好处有两个：
 *   1. 每层顶沿高度全场一致，不会某个方向的看台突然矮一截；
 *   2. **座椅在构造上就不可能跑出外边界**——上一版把碗做成正圆、外壳是椭圆，
 *      短轴方向硬生生凸出去 8 m，就是这个 bug。
 * 代价是排距随方向变化（两侧约 1.0 m、两端约 0.64 m），也就是两端更陡；
 * 真实体育场的两端（球门后）本来也比侧面陡，这个代价可接受。
 *
 * ## 配色
 *
 * 亮红里随机掺近白，越往上白椅越多（下层约 8%、上层到一半），对着参考图
 * `src/image/img_008.jpg` 定的。这是"一眼认出是鸟巢"最强的特征。
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOWL, ellipsePerimeter } from './venueGeometry.js';

/**
 * 三层看台。
 * s0/s1 是"从内边界到外边界"的比例区间；层与层之间留出的缺口就是环廊 + 挑台立面。
 */
export const TIERS = [
  // riser 由**两端**的坡度定死：两端排距只有 0.57 m，riser 一大坡度立刻飙到 44°，
  // 超出真实看台能接受的范围。按两端 ≤40° 反推，riser 只能取到 0.47 上下。
  { id: 'lower', label: '下层', s0: 0.0, s1: 0.36, rows: 24, base: 1.2, riser: 0.44 },
  { id: 'middle', label: '中层', s0: 0.42, s1: 0.72, rows: 20, base: 17.5, riser: 0.47 },
  { id: 'upper', label: '上层', s0: 0.78, s1: 1.0, rows: 15, base: 32.0, riser: 0.46 },
];

const SEG = 168; // 环向分段（椭圆两端曲率大，比圆更需要分段）
const SEAT_PITCH = 0.5; // 座位中心距（米）
const AISLES = 32; // 竖向疏散通道数
const AISLE_HALF_ANGLE = 0.0075; // 通道半角（弧度），约合 1.2 m 净宽

/** 看台顶（最上一排的踏面高度）。 */
export const BOWL_TOP = TIERS[2].base + TIERS[2].rows * TIERS[2].riser;

/**
 * 层与层之间**没有观众**的空带（环廊 + 挑台立面），以及最顶上的女儿墙。
 *
 * 这几条带子是激光扫射的目标面。演唱会上激光不能扫到人，所以只能沿这些空带走——
 * 每条带子在水平面上是**水平的一整圈**，所以激光落在上面就是一条笔直的水平光带。
 * s 是它所在的"内→外比例"，y 是取的落点标高。
 */
export const CONCOURSE_BANDS = [
  { id: 'low', label: '下层环廊', s: 0.39, y: (TIERS[0].base + TIERS[0].rows * TIERS[0].riser + TIERS[1].base) / 2 },
  { id: 'mid', label: '中层环廊', s: 0.75, y: (TIERS[1].base + TIERS[1].rows * TIERS[1].riser + TIERS[2].base) / 2 },
];
// 只有这两条。**最顶上那层看台的上沿不打激光**——那儿再往上就是屋盖钢构，
// 而且顶排观众的头就在边上，打上去等于往人身上扫。现场也确实只有两排。

/** 比例 s 处那圈椭圆的半轴。s=0 贴跑道，s=1 是看台外沿。 */
export function ringAxes(s) {
  return {
    a: BOWL.inner.a + s * (BOWL.outer.a - BOWL.inner.a),
    b: BOWL.inner.b + s * (BOWL.outer.b - BOWL.inner.b),
  };
}

/** 某层某排的内外椭圆与踏面标高。 */
function rowGeom(tier, k) {
  const s = tier.s0 + ((tier.s1 - tier.s0) * k) / tier.rows;
  const sNext = tier.s0 + ((tier.s1 - tier.s0) * (k + 1)) / tier.rows;
  return {
    in: ringAxes(s),
    out: ringAxes(sNext),
    y: tier.base + k * tier.riser,
    yNext: tier.base + (k + 1) * tier.riser,
  };
}

/** 场馆里任一点的地面标高。平面图点哪儿就把人放到哪儿。 */
export function groundHeightAt(x, z) {
  const r = Math.hypot(x, z);
  if (r < 1e-6) return 0;
  const u = Math.atan2(z, x);
  // 该方向上内外边界各在多远
  const rAt = (e) => (e.a * e.b) / Math.hypot(e.b * Math.cos(u), e.a * Math.sin(u));
  const rIn = rAt(BOWL.inner);
  const rOut = rAt(BOWL.outer);
  if (r <= rIn) return 0;
  const s = Math.min(1, (r - rIn) / Math.max(rOut - rIn, 1e-6));

  for (const tier of TIERS) {
    if (s < tier.s0) return tier.base; // 落在环廊 / 挑台段
    if (s <= tier.s1) {
      const k = Math.floor(((s - tier.s0) / (tier.s1 - tier.s0)) * tier.rows);
      return tier.base + k * tier.riser;
    }
  }
  return BOWL_TOP;
}

/** 确定性伪随机：同一个座位号永远得到同一个值，刷新配色不变。 */
function hash01(n) {
  return Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 方位角是否落在疏散通道里（通道处不放椅，露出台阶）。 */
function inAisle(angle) {
  const step = (Math.PI * 2) / AISLES;
  const phase = ((angle % step) + step) % step;
  return phase < AISLE_HALF_ANGLE || phase > step - AISLE_HALF_ANGLE;
}

/**
 * 遍历所有座位。座椅、观众点、计数都走这一个生成器——
 * 三处各写一遍排布规则，迟早会对不上。
 *
 * 座位沿椭圆**按弧长等分**：椭圆上等角度并不等弧长，直接按角度分会让两端的座位挤成一团。
 */
export function forEachSeat(visit, density = 1) {
  const stride = Math.max(1, Math.round(1 / density));
  const N = 720;
  const cum = new Float64Array(N + 1);

  TIERS.forEach((tier, ti) => {
    for (let k = 0; k < tier.rows; k++) {
      const g = rowGeom(tier, k);
      // 座椅坐在踏步靠前的位置
      const a = g.in.a + (g.out.a - g.in.a) * 0.42;
      const b = g.in.b + (g.out.b - g.in.b) * 0.42;
      const count = Math.floor(ellipsePerimeter(a, b) / SEAT_PITCH);

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

      let seg = 0;
      for (let i = 0; i < count; i += stride) {
        const target = (i / count) * total;
        while (seg < N && cum[seg + 1] < target) seg++;
        const u = (seg / N) * Math.PI * 2;
        if (inAisle(u)) continue;
        visit(a * Math.cos(u), g.y, b * Math.sin(u), u, ti, k);
      }
    }
  });
}

export function countSeats(density = 1) {
  let n = 0;
  forEachSeat(() => n++, density);
  return n;
}

/** 环向扫一圈，生成一条"从 (e0,y0) 到 (e1,y1)"的四边形带。 */
function ringStrip(positions, indices, base, e0, y0, e1, y1) {
  const start = base.v;
  for (let s = 0; s <= SEG; s++) {
    const u = (s / SEG) * Math.PI * 2;
    const c = Math.cos(u);
    const si = Math.sin(u);
    positions.push(e0.a * c, y0, e0.b * si, e1.a * c, y1, e1.b * si);
  }
  for (let s = 0; s < SEG; s++) {
    const i0 = start + s * 2;
    indices.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
  }
  base.v += (SEG + 1) * 2;
}

/**
 * 混凝土台阶：逐排生成"踏步环 + 立板环"。
 * 手写 BufferGeometry——每层的起始标高是跳变的（上层挑出压住下层），
 * 一条 Lathe 剖面线表达不了。
 */
function buildSteps() {
  const positions = [];
  const indices = [];
  const base = { v: 0 };

  for (const tier of TIERS) {
    for (let k = 0; k < tier.rows; k++) {
      const g = rowGeom(tier, k);
      ringStrip(positions, indices, base, g.in, g.y, g.out, g.y); // 踏步
      ringStrip(positions, indices, base, g.out, g.y, g.out, g.yNext); // 立板
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 层间挑台立面（facia）、场地边墙、顶部女儿墙。 */
function buildFacia() {
  const positions = [];
  const indices = [];
  const base = { v: 0 };

  ringStrip(positions, indices, base, ringAxes(0), 0, ringAxes(0), TIERS[0].base);
  for (let i = 1; i < TIERS.length; i++) {
    const prev = TIERS[i - 1];
    const tier = TIERS[i];
    const e = ringAxes(tier.s0);
    ringStrip(positions, indices, base, e, prev.base + prev.rows * prev.riser, e, tier.base);
  }
  const top = ringAxes(1);
  ringStrip(positions, indices, base, top, BOWL_TOP, top, BOWL_TOP + 1.6);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** 单张座椅：座面 + 靠背。两个盒子 24 个三角，再多在 20 米外也看不见。 */
function buildSeatGeometry() {
  const pan = new BoxGeometry(0.46, 0.055, 0.4);
  pan.translate(0, 0.42, 0.02);
  const back = new BoxGeometry(0.46, 0.42, 0.055);
  back.rotateX(-0.21); // 靠背后仰 12°
  back.translate(0, 0.63, -0.19);
  return mergeGeometries([pan, back], false);
}

/**
 * 一整碗固定座椅。
 * 几万张椅子只能走 InstancedMesh：合并成大几何体会吃掉几十兆内存，
 * 每张一个 Mesh 是几万次 draw call。实例化之后是**一个 draw call**。
 */
export class SeatField {
  /** @param {number} density 1=全部；移动端传 0.2 只画五分之一 */
  constructor(density = 1) {
    this.density = density;
    const count = countSeats(density);
    this.count = count;

    const mat = new MeshStandardMaterial({
      color: 0xffffff, // 真实颜色逐实例给，这里必须是白的，否则会和实例色相乘变暗
      roughness: 0.88,
      metalness: 0.0,
    });

    this.mesh = new InstancedMesh(buildSeatGeometry(), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'seats';

    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    // 降密度时把座椅按比例加宽：一排少画一半椅子、每张宽一倍，
    // 远看仍是连续的一条红带，而不是一排梳子。这比单纯抽稀好得多。
    const widen = Math.min(2.0, Math.pow(1 / Math.max(density, 0.05), 0.62));
    const one = new Vector3(widen, 1, 1);
    const up = new Vector3(0, 1, 0);
    const color = new Color();

    let i = 0;
    forEachSeat((x, y, z, u, ti, row) => {
      // 椅子朝场心：椭圆上的法线方向与"指向圆心"并不一致，
      // 但观众确实是朝着场地中心看演出的，所以用后者。
      q.setFromAxisAngle(up, Math.atan2(-x, -z));
      pos.set(x, y, z);
      m.compose(pos, q, one);
      this.mesh.setMatrixAt(i, m);

      const h = hash01(i * 7 + 13);
      const t = (TIERS[ti].base + row * TIERS[ti].riser) / BOWL_TOP;
      const whiteRatio = Math.min(0.5, 0.08 + 0.46 * smoothstep(0.25, 0.92, t));
      const base = h < whiteRatio ? 0xd8d4cb : 0xd8232a;
      const jitter = 0.84 + 0.3 * hash01(i * 31 + 7);
      color.setHex(base).multiplyScalar(jitter);
      this.mesh.setColorAt(i, color);
      i++;
    }, density);

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** 看台本体（台阶 + 挑台立面 + 边墙）。 */
export function buildBowlStructure() {
  const geo = mergeGeometries([buildSteps(), buildFacia()], false);
  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({
      color: 0x6b6e75, // 参考图里是浅灰混凝土
      roughness: 0.95,
      metalness: 0.02,
      side: DoubleSide, // 场内看背面、俯瞰看正面，两面都要
    })
  );
  mesh.name = 'bowl';

  const group = new Group();
  group.add(mesh);
  return { group, mesh };
}
