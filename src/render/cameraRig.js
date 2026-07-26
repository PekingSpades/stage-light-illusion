/**
 * 相机：自由绕飞 + 一组"能揭示某个道理"的预设机位。
 *
 * 四面台的看点就在于**每个座位看到的图案都不一样**。所以预设不是装饰，
 * 它们各自对应一句结论：正面看到最漂亮的曲线，侧面同一瞬间形状完全不同（说明曲线不是实物），
 * 而"灯眼"机位——把摄像机放到灯口正后方沿着光束看——会让整束光塌缩成一个点，
 * 这是"它是一条直线"最无可辩驳的证据。
 */

import { MathUtils, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { groundHeightAt, ringAxes } from './seating.js';

/** 相机允许到达的最低高度（米）。比地面略高一点，免得贴着地面出现 z-fighting。 */
const MIN_CAMERA_Y = 0.45;

/**
 * @typedef {{id:string,label:string,hint:string,live?:boolean,
 *            resolve:(ctx:object)=>{position:number[],target:number[]},
 *            anchor:(ctx:object)=>number[]}} Preset
 *
 * anchor 是这个机位在场景里的**标记位置**，热点和平面图都从这里取坐标——
 * 全场只有这一份真相，不允许第二处硬编码同样的点。
 * 通常就等于机位本身，只有"高空俯瞰"例外：真放到 64 米高，标记会缩成一个远得看不见的点，
 * 所以把标记压到 26 米，人还是知道它在头顶。
 */

/**
 * 机位。分成两类：
 *
 *   **座位机位** —— 内场与三层看台，各有"正面"和"侧面"。四面台的看点就是每个座位看到的
 *   图案都不一样，所以这一组是主力。高度直接问 seating 模块要该处的踏面标高，
 *   这样机位永远落在真的座位上，不会浮空也不会陷进台阶里。
 *
 *   **工具机位** —— 俯瞰、舞台中央、场外全景、灯眼。各自对应一句要讲的结论。
 *
 * "正面"= 长边看台（短轴 ±z 方向，进深大、位置好）；"侧面"= 两端看台（长轴 ±x 方向）。
 *
 * **四面台有两个正面、两个侧面，所以八个座位机位是绕着场子分到四条边上的，不是全挤在两条射线上。**
 * 早先内场/下层/中层/上层的"正面"全放在 +z、"侧面"全放在 +x，
 * 结果在平面图上四个标记串成一条线、径向只差十几像素，根本点不准
 * （实测最近的一对只有 9.4 px，而命中半径 11 px）。
 * 现在正面在 ±z 之间交替、侧面在 ±x 之间交替，每条射线上只剩两个标记，间距翻倍。
 * 四条边镜像对称，换边不改变任何教学含义。
 */

/** 椭圆上的方位方向（度，自 +x 起算，与 seatAt 的 dirX/dirZ 对应）。 */
function dirAt(deg) {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** 座位机位：给定方向与"内→外比例"，高度自动落在座位上。 */
function seatAt(dirX, dirZ, s, targetY = 18) {
  const e = ringAxes(s);
  const x = dirX * e.a;
  const z = dirZ * e.b;
  const y = groundHeightAt(x, z) + 1.3;
  return { position: [x, y, z], target: [0, targetY, 0] };
}

/** @type {Preset[]} */
export const PRESETS = [
  {
    id: 'infield-front',
    kind: 'seat',
    label: '内场·正面',
    hint: '站在内场靠前的位置，正对舞台长边。灯就在头顶不远处，光束几乎贴着你掠过去。',
    resolve: () => ({ position: [0, 1.7, 46], target: [0, 26, 0] }),
    anchor: () => [0, 2.0, 46],
  },
  {
    id: 'infield-side',
    kind: 'seat',
    label: '内场·侧面',
    hint: '同样在内场，但站到舞台短边这一侧。同一瞬间，光束的图案完全换了个样子。',
    // 侧面放 −x：+x 那条射线留给下层/上层侧面，避免四个标记串成一条线
    resolve: () => ({ position: [-78, 1.7, 0], target: [0, 26, 0] }),
    anchor: () => [-78, 2.0, 0],
  },
  {
    id: 'lower-front',
    kind: 'seat',
    label: '下层看台·正面',
    hint: '下层看台的正面，抬头就是整片光束。这是全场票价最高的位置之一。',
    // 正面之一：放在 −z 那个正面，和内场/中层的 +z 正面错开
    resolve: () => seatAt(0, -1, 0.2, 22),
    anchor: () => { const p = seatAt(0, -1, 0.2); return p.position; },
  },
  {
    id: 'lower-side',
    kind: 'seat',
    label: '下层看台·侧面',
    hint: '下层看台的侧面。离舞台更远，但能看到光束沿着长轴铺开的样子。',
    resolve: () => seatAt(1, 0, 0.2, 22),
    anchor: () => { const p = seatAt(1, 0, 0.2); return p.position; },
  },
  {
    id: 'middle-front',
    kind: 'seat',
    label: '中层看台·正面',
    hint: '中层看台正面，视线与光束大致齐平——包络看得最完整的高度。',
    resolve: () => seatAt(0, 1, 0.57, 18),
    anchor: () => { const p = seatAt(0, 1, 0.57); return p.position; },
  },
  {
    id: 'middle-side',
    kind: 'seat',
    label: '中层看台·侧面',
    hint: '中层看台侧面。和正面对比着看，最能说明"曲线随座位改变"。',
    // 侧面放 −x，与下层/上层的 +x 侧面分开
    resolve: () => seatAt(-1, 0, 0.57, 18),
    anchor: () => { const p = seatAt(-1, 0, 0.57); return p.position; },
  },
  {
    id: 'upper-front',
    kind: 'seat',
    label: '上层看台·正面',
    hint: '上层看台正面，居高临下。整片灯阵的相位波从这里看得最清楚。',
    // 正面之一：−z
    resolve: () => seatAt(0, -1, 0.92, 14),
    anchor: () => { const p = seatAt(0, -1, 0.92); return p.position; },
  },
  {
    id: 'upper-side',
    kind: 'seat',
    label: '上层看台·侧面',
    hint: '上层看台侧面，全场最远的座位。光束在这里显得又长又平。',
    // 同在 +x 侧，但沿弧偏 14°：三层侧面全压在长轴端时，最近的一对只有 22.8 px，
    // 差一点点够不到 24 px 的可点门槛。偏这一下就拉到 31.8 px，而方位上仍明显是"侧面"。
    resolve: () => seatAt(...dirAt(-14), 0.92, 14),
    anchor: () => { const p = seatAt(...dirAt(-14), 0.92); return p.position; },
  },
  {
    id: 'top',
    kind: 'tool',
    label: '高空·俯瞰',
    hint: '从上往下看，能看清相位波是怎么绕着灯圈一圈圈跑的。',
    resolve: () => ({ position: [0, 150, 0.01], target: [0, 4, 0] }),
    anchor: () => [0, 60, 0.01],
  },
  {
    id: 'stage',
    kind: 'tool',
    label: '舞台中央·演员视角',
    hint: '被一圈灯包在中间，光束向四面八方放射出去。',
    resolve: () => ({ position: [0, 3.6, 0], target: [0, 22, 60] }),
    anchor: () => [0, 3.6, 0],
  },
  {
    id: 'venue',
    kind: 'tool',
    label: '场外·建筑全景',
    hint: '退到场馆外面：立面向外倾、屋盖是马鞍形——长轴端低、短轴侧高，这就是鸟巢本体。',
    resolve: () => ({ position: [230, 95, 300], target: [0, 30, 0] }),
    anchor: () => [230, 95, 300],
  },
  {
    id: 'lamp',
    kind: 'tool',
    label: '灯眼·沿光束看',
    hint: '摄像机骑在光束上顺着它看过去：整束光被极度压缩成一个亮点，且无论灯头怎么摆都一直是一个点——这就是"它是直线"最直接的证据。',
    live: true,
    resolve: (ctx) => {
      const beams = ctx.beams;
      if (!beams || !beams.length) return { position: [0, 22, 88], target: [0, 12, 0] };
      const b = beams[Math.min(Math.max(ctx.lampIndex | 0, 0), beams.length - 1)];
      const d = b.dir;

      let px = d[2];
      let pz = -d[0];
      const pl = Math.hypot(px, pz);
      if (pl < 1e-4) {
        px = 1;
        pz = 0;
      } else {
        px /= pl;
        pz /= pl;
      }

      // 只往前挪不到一米：刚好越过灯口那团辉光（它会留在摄像机背后，不然糊满全屏），
      // 又能让整束光从眼前一路收缩到消隐点。侧向让开一点是必须的——完全骑在轴线上，
      // 光束的公告板条带会退化并被淡出（见 beams.js），反倒什么都看不见。
      const AHEAD = 0.9;
      const OFFSET = 0.32;
      return {
        position: [
          b.origin[0] + d[0] * AHEAD + px * OFFSET,
          b.origin[1] + d[1] * AHEAD,
          b.origin[2] + d[2] * AHEAD + pz * OFFSET,
        ],
        target: [
          b.origin[0] + d[0] * 160,
          b.origin[1] + d[1] * 160,
          b.origin[2] + d[2] * 160,
        ],
      };
    },
    anchor: (ctx) => {
      const beams = ctx.beams;
      if (!beams || !beams.length) return [0, 22, 88];
      const b = beams[Math.min(Math.max(ctx.lampIndex | 0, 0), beams.length - 1)];
      return [b.origin[0] + b.dir[0] * 0.6, b.origin[1] + b.dir[1] * 0.6, b.origin[2] + b.dir[2] * 0.6];
    },
  },
];

export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.065;
    c.minDistance = 3;
    c.maxDistance = 600;

    // maxPolarAngle 约束的是**相机相对目标点的位置**，不是视线方向。
    // 之前设成 0.497π（≈89.5°）等于规定"相机不得低于目标点"，于是任何仰视机位都活不下来：
    //「内场·贴地仰视」的极角是 108.6°，一旦 OrbitControls 接管就把相机从 y=1.6 拽回目标点上方，
    // 表现就是"切过去停一会儿又自己飞回来"。
    // 正确做法：放开极角，允许相机低于目标点往上看；"别钻到地板下面"改由下面的 y 钳制单独保证。
    c.maxPolarAngle = Math.PI - 0.02;
    c.target.set(0, 9, 0);
    c.update();

    this.goalPos = new Vector3();
    this.goalTarget = new Vector3();
    this.curTarget = new Vector3().copy(c.target);

    this.activePreset = null;
    this.flying = false;
    this.flightTime = 0;
    this.lampIndex = 0;

    this._onUserInput = () => this.release();
    domElement.addEventListener('pointerdown', this._onUserInput);
    domElement.addEventListener('wheel', this._onUserInput, { passive: true });
    this.domElement = domElement;
  }

  /** 用户一动手就交还控制权：预设是引导，不是牢笼。 */
  release() {
    if (!this.activePreset && !this.flying) return;
    this.activePreset = null;
    this.flying = false;
    this.controls.target.copy(this.curTarget);
    this.controls.enabled = true;
    this.controls.update();
    this.onRelease?.();
  }

  /** @param {Preset} preset */
  goTo(preset, ctx = {}) {
    this.activePreset = preset;
    this.flying = true;
    this.flightTime = 0;
    this.controls.enabled = false; // 飞行期间由我们直接驱动，避免和 OrbitControls 抢
    const g = preset.resolve({ ...ctx, lampIndex: this.lampIndex });
    this.goalPos.fromArray(g.position);
    this.goalTarget.fromArray(g.target);
  }

  update(dt, ctx = {}) {
    const preset = this.activePreset;

    if (preset) {
      const g = preset.resolve({ ...ctx, lampIndex: this.lampIndex });
      this.goalPos.fromArray(g.position);
      this.goalTarget.fromArray(g.target);

      // live 机位要一直咬住目标（灯头在动），静态机位飞到位就松手交还 OrbitControls
      const lambda = preset.live ? 9 : 3.4;
      this.camera.position.x = MathUtils.damp(this.camera.position.x, this.goalPos.x, lambda, dt);
      this.camera.position.y = MathUtils.damp(this.camera.position.y, this.goalPos.y, lambda, dt);
      this.camera.position.z = MathUtils.damp(this.camera.position.z, this.goalPos.z, lambda, dt);
      this.curTarget.x = MathUtils.damp(this.curTarget.x, this.goalTarget.x, lambda, dt);
      this.curTarget.y = MathUtils.damp(this.curTarget.y, this.goalTarget.y, lambda, dt);
      this.curTarget.z = MathUtils.damp(this.curTarget.z, this.goalTarget.z, lambda, dt);
      this.camera.lookAt(this.curTarget);

      this.flightTime += dt;
      // 阻尼是指数收敛，永远差最后一点点。所以用一个小阈值求落点精度，
      // 再加一条超时兜底：万一帧率极低导致迟迟收不拢，也不能一直不把控制权还给 OrbitControls。
      if (!preset.live && (this.camera.position.distanceTo(this.goalPos) < 0.12 || this.flightTime > 4)) {
        this.flying = false;
        this.activePreset = null;
        this.camera.position.copy(this.goalPos); // 收尾对齐，免得永远差最后几厘米
        this.controls.target.copy(this.goalTarget);
        this.curTarget.copy(this.goalTarget);
        this.controls.enabled = true;
        this.controls.update();
        this.onRelease?.();
      }
    } else {
      this.controls.update();
      this.curTarget.copy(this.controls.target);
    }

    this.clampToFloor();
  }

  /**
   * 不许穿到地板下面。
   * 极角已经放开（见构造函数），所以"别钻地"必须在这里单独兜住。
   * 只钳 y、不动 target：下一帧 OrbitControls 会从钳过的位置重新推导球坐标，状态自洽。
   */
  clampToFloor() {
    if (this.camera.position.y < MIN_CAMERA_Y) {
      this.camera.position.y = MIN_CAMERA_Y;
    }
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onUserInput);
    this.domElement.removeEventListener('wheel', this._onUserInput);
    this.controls.dispose();
  }
}
