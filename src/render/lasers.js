/**
 * 激光扫射。
 *
 * ## 现场是怎么做的
 *
 * 舞台四周一圈激光器，位置固定，只能转。激光**不能扫到人**——功率太高，直射眼睛有危险。
 * 所以它们只沿看台之间**没有观众的环廊空带**走。现场只有**两排**：下层环廊与中层环廊。
 * 最顶上那层看台的上沿不打——再往上是屋盖钢构，而顶排观众的头就在边上。
 *
 * 还有两条现场观察到的规律，决定了整套实现的形状：
 *
 *   **一侧的激光只服务一侧。** 装在舞台 +z 边上的那排激光只扫正对着它的那段看台，
 *   来回平扫，不会绕到别的方向去。所以激光按边分组，各管一段圆弧。
 *
 *   **每台激光都在自己那个扇区里走完整段、左右大幅扫描**，走到扇区端点立刻掉头。
 *
 *   **可相邻落点的间距还得保持不变，而且掉头要逐台错开。**
 *   三条放在一起看似不可能，其实有一个很干净的解：**只用相位差驱动，不加固定偏移**。
 *
 *   设所有激光共用同一条三角波 f，第 k 台是 f(t + kδ)。三角波的斜率是常数 ±v，于是
 *
 *       相邻落点间距 = f(t + (k+1)δ) − f(t + kδ) = ±δ·v
 *
 *   大小恒为 δ·v，**两个扫射方向上完全相同**（只是排的先后次序反过来）。
 *   同时每台走的都是整条三角波，也就是整个扇区；而各台的相位不同，
 *   掉头自然逐台发生，像一道波传过整排。
 *
 *   早先我在相位差之外还给每台加了一个固定偏移，两者叠加才导致间距在两个方向上一大一小
 *   （实测 8.1 m vs 1.2 m）。去掉固定偏移，这个不对称就消失了。
 *
 *   间距由相位差直接决定：间距/扇区长 = 2·δ（δ 以周期为单位）。
 *
 *   顺带的副产品：因为驱动量是弧长而不是转角，**每台激光的角速度都不一样，且随位置不断变化**
 *   （椭圆上同样的弧长在不同位置对应不同的转角）。这一条也是现场能看出来的。
 *
 * ## 反解（就是现场那道"标定"）
 *
 * 已知光源 P 与目标落点 Q（在环廊椭圆上、标高恒定）：
 *
 *     水平距离 t = |Q_xz − P_xz|
 *     水平方向 h = (Q_xz − P_xz)/t
 *     俯仰角   θ = atan2(Q_y − P_y, t)
 *
 * 落点是给定的，所以落点标高天然恒等——那条水平光带因此是笔直的，不会参差不齐。
 * 演出前技师逐台对齐，本质上就是在做这件事。
 *
 * ## 和本项目主题的关系
 *
 * 又是一族直线：一排激光同时打向同一条环廊，笔直的光线扫出一张近乎水平的直纹面，
 * 落点连成一条精确的直线。摇头灯那边是"直线织出曲线"，这边是"直线织出直线，但必须算准"。
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { CONCOURSE_BANDS, ringAxes } from './seating.js';
import { ellipseArcSampler } from './venueGeometry.js';

const SEGMENTS = 8; // 激光是直线，不需要沿程细分太多

const vertexShader = /* glsl */ `
  precision highp float;

  attribute vec2 corner;      // x: 沿光束的参数 t∈[0,1]；y: 左右侧 ±1
  attribute vec3 iOrigin;
  attribute vec3 iDir;
  attribute vec2 iParams;     // x: 长度  y: 亮度
  attribute vec3 iColor;

  uniform float uWidth;       // 世界尺度下的半宽（米）
  uniform float uMinPixels;   // 屏幕上至少这么多像素宽
  uniform float uPixelScale;  // 每单位深度对应多少世界尺寸/像素

  varying float vSide;
  varying float vIntensity;
  varying vec3  vColor;
  varying float vAxisFacing;

  void main() {
    float t = corner.x;
    vec3 axisWorld = normalize(iDir);
    vec3 posWorld = iOrigin + axisWorld * (iParams.x * t);

    vec3 viewPos = (viewMatrix * vec4(posWorld, 1.0)).xyz;
    vec3 axisView = normalize((viewMatrix * vec4(axisWorld, 0.0)).xyz);
    vec3 toEye = normalize(-viewPos);

    vec3 side = cross(axisView, toEye);
    float sideLen = length(side);
    if (sideLen < 1e-4) {
      vec3 ref = abs(axisView.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      side = normalize(cross(axisView, ref));
    } else {
      side /= sideLen;
    }

    // 激光在物理上只有几毫米粗。真按世界尺度画，一百米外就细到亚像素、
    // 采样不到、整条光线闪成虚线。所以给它一个**屏幕空间最小宽度**：
    // 深度越大，世界尺度的半宽就按比例撑大，屏幕上始终占住那几个像素。
    float depth = max(-viewPos.z, 0.1);
    float minWorld = uPixelScale * depth * uMinPixels;
    float radius = max(uWidth, minWorld);

    viewPos += side * (radius * corner.y);

    vSide = corner.y;
    vIntensity = iParams.y;
    vColor = iColor;
    vAxisFacing = abs(dot(axisView, toEye));

    gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uHaze;
  uniform float uGain;

  varying float vSide;
  varying float vIntensity;
  varying vec3  vColor;
  varying float vAxisFacing;

  void main() {
    float r = abs(vSide);
    // 激光的横截面比灯光束锐得多：一个极窄的亮芯 + 一点点晕，
    // 这正是它看起来"像一根线"而灯光束"像一根柱"的原因。
    float core = exp(-(r * r) * 42.0);
    float halo = exp(-(r * r) * 4.5);
    float radial = core * 1.0 + halo * 0.10;

    float facingFade = 1.0 - smoothstep(0.988, 0.9998, vAxisFacing);

    float a = radial * facingFade * vIntensity * uGain * (0.3 + 0.9 * uHaze);
    if (a <= 0.0015) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/**
 * 激光器阵：按**边**分组。每条边上一排激光器，只服务正对着自己的那段看台。
 *
 * @param {number} perSide 每条边每条环廊上的激光器数量
 * @param {number} sides 边数（四面台就是 4）
 */
export function createLaserRig(perSide, sides = 4, { edgeX = 13.5, edgeZ = 9.5, height = 3.2 } = {}) {
  const units = [];
  const bands = CONCOURSE_BANDS.length;

  for (let sIdx = 0; sIdx < sides; sIdx++) {
    const facing = (sIdx / sides) * Math.PI * 2;
    const nx = Math.cos(facing);
    const nz = Math.sin(facing);
    const tx = -nz;
    const tz = nx;
    const half = Math.abs(tx) > 0.5 ? edgeX : edgeZ;

    for (let bIdx = 0; bIdx < bands; bIdx++) {
      for (let i = 0; i < perSide; i++) {
        const f = perSide === 1 ? 0 : (i / (perSide - 1) - 0.5) * 2; // -1..1
        units.push({
          side: sIdx,
          band: bIdx,
          slot: i,
          perSide,
          sides,
          // 两条环廊的激光器分上下两排装机
          position: [
            nx * (Math.abs(nx) > 0.5 ? edgeX : edgeZ) + tx * f * half,
            height + bIdx * 0.9,
            nz * (Math.abs(nz) > 0.5 ? edgeZ : edgeX) + tz * f * half,
          ],
          facing,
        });
      }
    }
  }
  return { units, sides, perSide };
}

// 每条环廊椭圆的弧长采样器，只在环廊几何变化时重建
const samplers = new Map();
function samplerFor(bandIndex) {
  if (!samplers.has(bandIndex)) {
    const e = ringAxes(CONCOURSE_BANDS[bandIndex].s);
    samplers.set(bandIndex, { s: ellipseArcSampler(e.a, e.b), e });
  }
  return samplers.get(bandIndex);
}

/** 三角波（0..1 → 0..1..0），用来做"到端点立刻掉头"。 */
function triangle(x) {
  const t = ((x % 1) + 1) % 1;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

/**
 * 算出某一时刻每台激光的光束。
 *
 * 驱动量是**落点在环廊上的弧长位置**（见文件头）：
 *   1. 每条边分到一段圆弧，四段之间**留空隙**——现场也不是连续一圈；
 *   2. 同一条边上的每台激光都扫**整段**弧，走的是同一条三角波，只差一点相位；
 *   3. 三角波的斜率是常数，所以相邻落点间距恒等于「相位差 × 斜率」，
 *      两个扫射方向上大小相同（只是排的次序反过来）；
 *   4. 相位不同，掉头就逐台发生，像一道波传过整排。
 *
 * 反解那一步同样重要：先定落点、再由落点反求灯的转角，
 * 于是角速度自动随位置变化——这正是现场"间距不变但灯转得快慢不一"的原因。
 */
export function computeLasers(rig, p, time, out = []) {
  const {
    freq = 0.055, // 走完一个来回的频率
    coverage = 0.72, // 每条边占它那 90° 扇区的比例，其余留空（四块不连续）
    spacing = 0.05, // 相邻落点间距，占扇区弧长的比例
  } = p;

  out.length = 0;

  for (const unit of rig.units) {
    const { s: sampler, e } = samplerFor(unit.band);

    const sectorLen = (sampler.total / unit.sides) * coverage;
    const arcMid = sampler.arcAt(unit.facing);

    // 相位差 δ 与间距的关系：间距 = 2·δ·扇区长（三角波斜率为 2）。
    // 总相位跨度必须小于半个周期，否则排尾会折回来和排头撞上，所以要钳一下。
    const maxSpread = 0.42;
    const n = Math.max(unit.perSide - 1, 1);
    const delta = Math.min(spacing / 2, maxSpread / n);

    // 四条边同相：四块扇区镜像着同步走，现场看到的就是这种对称
    const ph = time * freq + (unit.slot - n / 2) * delta;
    const arc = arcMid + (triangle(ph) - 0.5) * sectorLen;

    const u = sampler.angleAt(arc);
    const qx = e.a * Math.cos(u);
    const qz = e.b * Math.sin(u);
    const qy = CONCOURSE_BANDS[unit.band].y;

    // 反解：由落点定转角，而不是由转角定落点
    const dx = qx - unit.position[0];
    const dz = qz - unit.position[2];
    const t = Math.hypot(dx, dz);
    if (t < 1) continue;
    const dy = qy - unit.position[1];
    const len = Math.hypot(t, dy);

    out.push({
      origin: unit.position,
      dir: [dx / len, dy / len, dz / len],
      length: len,
      band: unit.band,
      side: unit.side,
      hit: [qx, qy, qz],
    });
  }
  return out;
}

/** 两条环廊各一种颜色。绿光（532nm）最亮最常用，放在更显眼的下层。 */
const BAND_COLORS = [0x35ff6a, 0x35d7ff];

export class LaserField {
  constructor(capacity) {
    this.capacity = capacity;

    const geometry = new InstancedBufferGeometry();
    const vertCount = (SEGMENTS + 1) * 2;
    const corners = new Float32Array(vertCount * 2);
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      corners[(i * 2 + 0) * 2 + 0] = t;
      corners[(i * 2 + 0) * 2 + 1] = -1;
      corners[(i * 2 + 1) * 2 + 0] = t;
      corners[(i * 2 + 1) * 2 + 1] = 1;
    }
    geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2));

    const indices = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    geometry.setIndex(indices);

    this.origins = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.dirs = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.params = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage);
    this.colors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('iOrigin', this.origins);
    geometry.setAttribute('iDir', this.dirs);
    geometry.setAttribute('iParams', this.params);
    geometry.setAttribute('iColor', this.colors);
    geometry.instanceCount = 0;
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1200);

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uWidth: { value: 0.05 },
        uMinPixels: { value: 0.85 },
        uPixelScale: { value: 0.001 },
        uHaze: { value: 0.6 },
        uGain: { value: 1 },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
      fog: false,
      toneMapped: true,
    });

    this.geometry = geometry;
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;

    this._color = new Color();
  }

  /** 屏幕空间最小宽度需要知道"每像素多少世界尺寸"，随视角与画布尺寸变。 */
  setProjection(fovDeg, viewportHeightPx) {
    this.material.uniforms.uPixelScale.value =
      (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(viewportHeightPx, 1);
  }

  update(lasers, { intensity = 1 } = {}) {
    const n = Math.min(lasers.length, this.capacity);
    // 截断是静默的，而灯位按边依次排列，被截掉的永远是最后一条边——
    // 一旦发生，画面上就是"少了一面"。所以宁可吵一次也不要默默丢。
    if (lasers.length > this.capacity && !this._warned) {
      this._warned = true;
      console.warn(`LaserField 容量 ${this.capacity} 装不下 ${lasers.length} 条激光，末尾整条边会消失`);
    }
    const o = this.origins.array;
    const d = this.dirs.array;
    const p = this.params.array;
    const c = this.colors.array;

    for (let i = 0; i < n; i++) {
      const l = lasers[i];
      const k3 = i * 3;
      const k2 = i * 2;
      o[k3] = l.origin[0];
      o[k3 + 1] = l.origin[1];
      o[k3 + 2] = l.origin[2];
      d[k3] = l.dir[0];
      d[k3 + 1] = l.dir[1];
      d[k3 + 2] = l.dir[2];
      p[k2] = l.length;
      p[k2 + 1] = intensity;

      this._color.setHex(BAND_COLORS[l.band % BAND_COLORS.length]);
      c[k3] = this._color.r;
      c[k3 + 1] = this._color.g;
      c[k3 + 2] = this._color.b;
    }

    this.geometry.instanceCount = n;
    if (n > 0) {
      this.origins.needsUpdate = true;
      this.dirs.needsUpdate = true;
      this.params.needsUpdate = true;
      this.colors.needsUpdate = true;
    }
  }

  setUniforms({ haze, gain }) {
    if (haze !== undefined) this.material.uniforms.uHaze.value = haze;
    if (gain !== undefined) this.material.uniforms.uGain.value = gain;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
