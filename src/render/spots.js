/**
 * 光斑：光束打在看台围墙上的椭圆亮斑。
 *
 * 它在教学上有个不可替代的作用——**把烟雾浓度调到 0**，空中的光束整根消失，
 * 只剩墙上一圈跳动的亮斑。这一刻能让人瞬间明白：空中那条"发光的曲线"从来不是实体，
 * 光真正到达的只有起点（灯）和终点（被照亮的表面），中间那段是烟尘替你显影出来的。
 *
 * 几何：射线与竖直圆柱面（看台内墙）求交，得到落点后按入射角把圆形光斑拉成椭圆。
 * 掠射（入射角接近 90°）时 1/cos 会爆掉，必须钳制，否则光斑会拉成横贯全场的一条。
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { ellipseInwardNormal, rayEllipseCylinder } from './venueGeometry.js';

/** 生成一张径向渐变贴图当作光斑的柔和边缘。 */
function makeSpotTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.18)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class SpotField {
  constructor(capacity, { wall, wallTop }) {
    this.capacity = capacity;
    this.wall = wall; // {a, b} —— 看台内墙是椭圆，不是圆
    this.wallTop = wallTop;

    this.texture = makeSpotTexture();
    const geometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
      fog: false,
    });

    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.count = 0;

    this._m = new Matrix4();
    this._color = new Color();
    this._n = new Vector3();
    this._nArr = [0, 0, 0];
    this._x = new Vector3();
    this._y = new Vector3();
    this._pos = new Vector3();
  }

  /**
   * @param {Array} beams computeBeams 的输出
   * @param {object} opts
   * @param {(i:number)=>number} opts.hueOf
   * @param {(i:number)=>number} opts.intensityOf
   * @param {number} opts.beamAngle 全角（度）
   * @param {number} opts.gain 总体亮度
   */
  update(beams, { hueOf, intensityOf, beamAngle, gain = 1 }) {
    const spread = Math.tan((beamAngle * Math.PI) / 360);
    let written = 0;

    for (let i = 0; i < beams.length && written < this.capacity; i++) {
      const intensity = intensityOf(i);
      if (intensity <= 0.01) continue;

      const b = beams[i];
      const t = rayEllipseCylinder(b.origin, b.dir, this.wall.a, this.wall.b);
      if (t === null || t > b.length) continue; // 光束还没够着墙就衰减完了

      const hx = b.origin[0] + b.dir[0] * t;
      const hy = b.origin[1] + b.dir[1] * t;
      const hz = b.origin[2] + b.dir[2] * t;
      if (hy < 0 || hy > this.wallTop) continue; // 从看台顶上飞进夜空了

      // 墙面内法线。椭圆柱面的法线不是"指向中心"，要按椭圆梯度算，
      // 不然两端的光斑会明显歪掉。
      ellipseInwardNormal(hx, hz, this.wall.a, this.wall.b, this._nArr);
      this._n.set(this._nArr[0], this._nArr[1], this._nArr[2]);

      const cosI = Math.abs(b.dir[0] * this._n.x + b.dir[1] * this._n.y + b.dir[2] * this._n.z);
      const stretch = Math.min(1 / Math.max(cosI, 1e-3), 6); // 掠射时钳制，否则拉成一条

      // 光斑长轴方向 = 光束方向在墙面上的投影
      const dn = b.dir[0] * this._n.x + b.dir[1] * this._n.y + b.dir[2] * this._n.z;
      this._x.set(b.dir[0] - this._n.x * dn, b.dir[1] - this._n.y * dn, b.dir[2] - this._n.z * dn);
      if (this._x.lengthSq() < 1e-8) this._x.set(0, 1, 0); // 正入射：椭圆退化成圆，方向随意
      this._x.normalize();
      this._y.crossVectors(this._n, this._x).normalize();

      const r0 = Math.max(0.12, t * spread); // 落点处的光斑半径
      this._x.multiplyScalar(r0 * 2 * stretch);
      this._y.multiplyScalar(r0 * 2);
      this._pos.set(hx + this._n.x * 0.06, hy + this._n.y * 0.06, hz + this._n.z * 0.06);

      // 用三个基向量直接拼变换矩阵：PlaneGeometry 在 XY 平面、法线 +Z
      this._m.makeBasis(this._x, this._y, this._n).setPosition(this._pos);
      this.mesh.setMatrixAt(written, this._m);

      // 越远越暗；掠射时能量摊薄，也要压暗
      const falloff = Math.max(0, 1 - t / (b.length * 1.05));
      const bright = intensity * gain * falloff * Math.max(cosI, 0.12) * 0.9;
      this._color.setHSL(hueOf(i), 0.8, 0.6).multiplyScalar(Math.min(bright, 1.4));
      this.mesh.setColorAt(written, this._color);

      written++;
    }

    this.mesh.count = written;
    if (written > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
