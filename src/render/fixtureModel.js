/**
 * 电脑摇头灯（moving head）建模。
 *
 * 用户说的"能水平旋转又能垂直摆动的灯"，行业里叫**电脑摇头灯**；本项目这种细而亮的
 * 光柱属于其中的**光束灯（beam）**，国内口语叫"光束灯 / 7R / 9R"。
 * 尺寸照 **Clay Paky Sharpy** 这一档的规格书来（它是这类灯的行业原型，国产克隆外形几乎一致）。
 *
 * 三段构成，正好对应两个转轴：
 *
 *     灯头 head  ──┐
 *     摇臂 yoke  ──┼─ tilt 绕两臂之间的水平轴，行程约 250°
 *     底座 base  ──┘  pan 绕底座上表面中心的竖直轴，行程 540°
 *
 * 真机关键尺寸（mm）：底座 345×280×150；摇臂外宽 405、两臂净距 245、臂高 245；
 * 灯头筒身 Ø185×330、前遮光罩 Ø195、**前透镜 Ø130**；**tilt 轴心到出光口 175**。
 *
 * 摇臂**厚达 80mm**——这是最容易做错的地方。做成细杆就会像一门炮而不是灯。
 *
 * 出光口不在转轴上：灯头绕臂间的轴摆动，透镜却在前端 175mm 处，所以灯头一摆，
 * 光束的起点也跟着划一小段弧。这个偏移由 LENS_OFFSET 交给 rig.js，光是真的从透镜里射出来的。
 *
 * 3~30 米看得见的细节只有五个，其余一概不做（螺丝、铭牌、线缆、接口在 3 米外就分辨不出）：
 *   ① 前透镜的暗色高反光  ② 灯头的环向散热鳍剪影  ③ 两臂不对称（一侧藏 tilt 电机）
 *   ④ 前遮光罩的凸缘高光边  ⑤ 底座侧面那块发光小屏
 *
 * 性能：按部件分 5 个 InstancedMesh，96 台灯共 5 个 draw call，单台约 1.9k 三角面。
 * 机身金属**不进 bloom**（材质够暗，低于阈值），只有透镜和光束发光。
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 真机尺寸（米）。改这里就能整体换档，比如换成更大的 MegaPointe。 */
export const FIXTURE = {
  baseW: 0.345,
  baseD: 0.280,
  baseH: 0.150,
  armGap: 0.245, // 两臂内侧净距（灯头 Ø185 两侧各留 30 余量）
  armThick: 0.080, // 单臂厚度：(405 − 245) / 2
  armRise: 0.245, // 底座上表面到 tilt 轴
  armDepth: 0.118, // 臂的前后进深（根部）
  headR: 0.0925, // 筒身 Ø185
  headBack: 0.155, // tilt 轴往灯尾
  headFront: 0.175, // tilt 轴往出光口 —— 就是 LENS_OFFSET
  hoodR: 0.0975, // 前遮光罩 Ø195
  lensR: 0.065, // 前透镜 Ø130
};

/** tilt 转轴离底座底面的高度。灯阵里 fixture.position 存的就是这个点。 */
export const PIVOT_HEIGHT = FIXTURE.baseH + FIXTURE.armRise;

/** 出光口相对 tilt 轴的距离。光束起点 = 转轴 + 方向 × 这个值。 */
export const LENS_OFFSET = FIXTURE.headFront;

function box(w, h, d, x = 0, y = 0, z = 0) {
  return new BoxGeometry(w, h, d).translate(x, y, z);
}

/** 沿 +Y 的圆柱段。rotX 用来把它掰成沿 X 的横轴件（比如臂顶的轴承壳）。 */
function cyl(rt, rb, h, seg, x = 0, y = 0, z = 0, rotX = 0) {
  const g = new CylinderGeometry(rt, rb, h, seg, 1, false);
  if (rotX) g.rotateX(rotX);
  return g.translate(x, y, z);
}

/**
 * 底座：一个压铸铝盒子。上表面中心是 pan 转台，后面板出电源与信号接口，
 * 两短侧各一条提手，底下四个吊装脚（台沿摆放时用，吊装时挂欧米茄夹）。
 * 原点在底面中心，+Z 为灯具正面。
 */
function buildBase() {
  const { baseW: w, baseD: d, baseH: h } = FIXTURE;
  const parts = [
    box(w, h * 0.62, d, 0, h * 0.31, 0), // 主箱体下段
    box(w * 0.94, h * 0.38, d * 0.94, 0, h * 0.81, 0), // 上段略收，形成一圈台肩
    box(w * 0.34, h * 0.34, 0.028, 0, h * 0.40, -d / 2 - 0.014), // 后接口面板
    cyl(0.014, 0.014, 0.030, 8, -w * 0.24, h * 0.40, -d / 2 - 0.028, Math.PI / 2), // powerCON
    cyl(0.012, 0.012, 0.028, 8, -w * 0.10, h * 0.40, -d / 2 - 0.027, Math.PI / 2), // DMX in
    cyl(0.012, 0.012, 0.028, 8, w * 0.10, h * 0.40, -d / 2 - 0.027, Math.PI / 2), // DMX out
    // 两侧提手：U 形圆棒
    cyl(0.009, 0.009, d * 0.62, 8, -w / 2 - 0.026, h * 0.62, 0, Math.PI / 2).rotateY(Math.PI / 2),
    cyl(0.009, 0.009, d * 0.62, 8, w / 2 + 0.026, h * 0.62, 0, Math.PI / 2).rotateY(Math.PI / 2),
    box(0.026, 0.016, 0.016, -w / 2 - 0.013, h * 0.62, -d * 0.31),
    box(0.026, 0.016, 0.016, -w / 2 - 0.013, h * 0.62, d * 0.31),
    box(0.026, 0.016, 0.016, w / 2 + 0.013, h * 0.62, -d * 0.31),
    box(0.026, 0.016, 0.016, w / 2 + 0.013, h * 0.62, d * 0.31),
    // 吊装脚
    box(0.11, 0.022, 0.055, -w * 0.26, -0.011, 0),
    box(0.11, 0.022, 0.055, w * 0.26, -0.011, 0),
    // pan 转台：底座与摇臂之间那道圆形接缝，摇头灯一眼可辨的特征之一
    cyl(0.125, 0.132, 0.020, 24, 0, h + 0.010, 0),
  ];
  return mergeGeometries(parts, false);
}

/**
 * 摇臂：厚重的 U 形铝铸件。
 * 原点在 pan 轴上、底座上表面高度；tilt 轴在 y = armRise。
 * 两臂**故意不对称**——左臂鼓出一块 tilt 电机罩，真机就是这样，也是"像不像"的来源之一。
 */
function buildYoke() {
  const { armGap, armThick, armRise, armDepth } = FIXTURE;
  const x = armGap / 2 + armThick / 2;
  const capR = armDepth / 2;
  const parts = [
    box(armGap + armThick * 2, 0.030, armDepth * 1.02, 0, 0.015, 0), // 根部横梁
    // 两条臂：上端略收，做出锥度
    box(armThick, armRise, armDepth, -x, armRise / 2, 0),
    box(armThick, armRise, armDepth, x, armRise / 2, 0),
    // 臂顶收成圆头，把 tilt 轴承包进去
    cyl(capR, capR, armThick, 18, -x, armRise, 0, Math.PI / 2),
    cyl(capR, capR, armThick, 18, x, armRise, 0, Math.PI / 2),
    // 左臂外侧的 tilt 电机罩（不对称就在这儿）
    cyl(capR * 0.62, capR * 0.62, 0.042, 14, -x - armThick / 2 - 0.021, armRise, 0, Math.PI / 2),
  ];
  // 臂外侧的散热开槽：三条浅浅的凹条，侧光扫过时能读出金属件的厚度
  for (let i = 0; i < 3; i++) {
    const y = armRise * (0.28 + i * 0.19);
    parts.push(box(0.006, 0.030, armDepth * 0.66, -x - armThick / 2, y, 0));
    parts.push(box(0.006, 0.030, armDepth * 0.66, x + armThick / 2, y, 0));
  }
  return mergeGeometries(parts, false);
}

/**
 * 灯头：分段圆筒。原点在 tilt 轴上，几何沿 **+Y** 指向出光方向
 * （与 beams.js 的约定一致：把 +Y 转到光束方向就是灯头的姿态）。
 *
 * 剖面刻意做出台阶——后端风扇腔最细，筒身最粗，前端遮光罩又鼓出一圈。
 * 一根等直径的圆柱看着就是炮管，台阶才是光学头。
 */
function buildHead() {
  const { headR: r, headBack: back, headFront: front, hoodR } = FIXTURE;
  const parts = [
    cyl(r * 0.76, r * 0.80, 0.030, 16, 0, -back + 0.015, 0), // 尾部风扇腔
    cyl(r * 0.80, r * 0.80, 0.012, 16, 0, -back + 0.036, 0), // 风扇格栅压圈
    cyl(r * 0.96, r * 0.82, 0.060, 20, 0, -back + 0.072, 0), // 后锥收
    cyl(r, r * 0.96, back + front - 0.135, 20, 0, (front - back) / 2 + 0.021, 0), // 筒身
    cyl(hoodR, r * 1.01, 0.042, 20, 0, front - 0.021, 0), // 前遮光罩，外沿凸出
    cyl(hoodR * 0.99, hoodR * 0.99, 0.008, 20, 0, front - 0.004, 0), // 罩口凸缘高光边
  ];
  // 环向散热鳍：筒身后半 10 道，齿高 6mm、齿距 ~11mm
  for (let i = 0; i < 10; i++) {
    parts.push(cyl(r * 1.065, r * 1.065, 0.005, 20, 0, -back + 0.10 + i * 0.011, 0));
  }
  return mergeGeometries(parts, false);
}

/** 前透镜：平凸玻璃。灭灯时也会反出一圈冷光——识别度最高的一处细节。 */
function buildLens() {
  const { lensR, headFront } = FIXTURE;
  return cyl(lensR, lensR, 0.012, 22, 0, headFront - 0.016, 0);
}

/** 底座侧面的小显示屏。暗场里一点橙光，成本极低、可信度极高。 */
function buildDisplay() {
  const { baseW: w, baseH: h } = FIXTURE;
  return box(0.060, 0.034, 0.004, w / 2 + 0.001, h * 0.55, 0).rotateY(0);
}

/**
 * 一整个灯阵的灯具本体。
 *
 * 按运动方式分批，因为三段的运动各不相同：
 *   底座＋显示屏 —— 不动，只按灯位朝向摆一次
 *   摇臂         —— 只跟 pan 转
 *   灯头＋透镜   —— 跟 pan 和 tilt 一起转
 * 合成一个几何体就没法分别驱动，所以这里是"5 个 draw call 换正确的运动"。
 */
export class MovingHeadRig {
  constructor(capacity) {
    this.capacity = capacity;

    const bodyMat = new MeshStandardMaterial({ color: 0x26282e, roughness: 0.62, metalness: 0.3 });
    const yokeMat = new MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.55, metalness: 0.42 });
    const headMat = new MeshStandardMaterial({ color: 0x33363e, roughness: 0.46, metalness: 0.52 });
    const lensMat = new MeshStandardMaterial({
      color: 0x0b1220,
      roughness: 0.05,
      metalness: 0.9,
      emissive: 0x060d16,
    });
    // 小屏用 Basic：它只需要"自己亮着"，不该被场上的光影响，也不该进 bloom
    const dispMat = new MeshBasicMaterial({ color: 0x8a4a08, toneMapped: true });

    this.bases = new InstancedMesh(buildBase(), bodyMat, capacity);
    this.yokes = new InstancedMesh(buildYoke(), yokeMat, capacity);
    this.heads = new InstancedMesh(buildHead(), headMat, capacity);
    this.lenses = new InstancedMesh(buildLens(), lensMat, capacity);
    this.displays = new InstancedMesh(buildDisplay(), dispMat, capacity);

    this.parts = [this.bases, this.yokes, this.heads, this.lenses, this.displays];
    for (const m of this.parts) {
      m.count = 0;
      m.frustumCulled = false;
    }

    this.group = new Group();
    this.group.name = 'fixtures';
    this.group.add(...this.parts);

    this._m = new Matrix4();
    this._q = new Quaternion();
    this._qTilt = new Quaternion();
    this._pos = new Vector3();
    this._one = new Vector3(1, 1, 1);
    this._axisY = new Vector3(0, 1, 0);
    this._axisX = new Vector3(1, 0, 0);
  }

  /**
   * 摆放底座与小屏。只在灯阵重建时调用一次。
   * @param {Array} fixtures rig.fixtures，其 position 是 **tilt 转轴**的位置
   */
  layout(fixtures) {
    const n = Math.min(fixtures.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const f = fixtures[i];
      // 底座正面朝外——真实布场也是把接口和显示屏朝着方便操作的一侧
      const azim = Math.atan2(f.outward[0], f.outward[2]);
      this._q.setFromAxisAngle(this._axisY, azim);
      this._pos.set(f.position[0], f.position[1] - PIVOT_HEIGHT, f.position[2]);
      this._m.compose(this._pos, this._q, this._one);
      this.bases.setMatrixAt(i, this._m);
      this.displays.setMatrixAt(i, this._m);
    }
    for (const m of [this.bases, this.displays]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * 每帧让摇臂和灯头跟上光束方向。
   *
   * 从光束单位方向 d 反解两个转角：
   *     pan  a = atan2(d.x, d.z)
   *     tilt t = acos(d.y)          （0 = 竖直朝天）
   * 因为 Ry(a)·Rx(t) 作用在 +Y 上正好给出 (sin t·sin a, cos t, sin t·cos a) = d。
   */
  aim(beams, fixtures) {
    const n = Math.min(beams.length, this.capacity);
    const yokeY = FIXTURE.baseH;

    for (let i = 0; i < n; i++) {
      const d = beams[i].dir;
      const f = fixtures[i];

      const azim = Math.atan2(d[0], d[2]);
      const tilt = Math.acos(Math.min(1, Math.max(-1, d[1])));

      this._q.setFromAxisAngle(this._axisY, azim);

      // 摇臂：只转 pan，立在底座上表面
      this._pos.set(f.position[0], f.position[1] - PIVOT_HEIGHT + yokeY, f.position[2]);
      this._m.compose(this._pos, this._q, this._one);
      this.yokes.setMatrixAt(i, this._m);

      // 灯头与透镜：pan 之后再绕臂间水平轴摆 tilt，位置就在转轴上
      this._qTilt.setFromAxisAngle(this._axisX, tilt);
      this._q.multiply(this._qTilt);
      this._pos.set(f.position[0], f.position[1], f.position[2]);
      this._m.compose(this._pos, this._q, this._one);
      this.heads.setMatrixAt(i, this._m);
      this.lenses.setMatrixAt(i, this._m);
    }

    for (const m of [this.yokes, this.heads, this.lenses]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }

  dispose() {
    for (const m of this.parts) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
