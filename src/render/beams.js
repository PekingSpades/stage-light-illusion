/**
 * 体积光束渲染。
 *
 * 做法：每束光是一条**绕自身轴向摄像机翻转的梯形条带**（billboard strip），
 * 片元着色器里按到轴线的距离做高斯衰减。相比"画一个圆锥网格"，它没有多边形棱角、
 * 边缘天然柔和，而且全部光束用一个 InstancedMesh 画完——一个 draw call。
 *
 * 关于"加色混合必须排序"的常见说法：**这里不需要**。加色是逐片元求和，加法可交换，
 * 结果与绘制顺序无关；只要 depthWrite 关掉（否则先画的会挡住后画的）、depthTest 开着
 * （这样舞台和看台仍能正确遮挡光束）就够了。所以实例化在这里是安全的。
 *
 * 真实光束之所以看得见，是雾机打出的气溶胶把光侧向散射进你眼里；没有烟，光束是隐形的。
 * 因此亮度建模为"沿程被散射掉的能量"：随距离衰减，叠一层缓慢流动的噪声当作烟雾不均匀。
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

const SEGMENTS = 24; // 沿光束长度的细分：够多才能让条带宽度平滑变化

const vertexShader = /* glsl */ `
  precision highp float;

  attribute vec2 corner;        // x: 沿光束的参数 t∈[0,1]；y: 左右侧 ±1
  attribute vec3 iOrigin;       // 灯的位置（世界坐标）
  attribute vec3 iDir;          // 光束单位方向（世界坐标）
  attribute vec4 iParams;       // x: 长度  y: 起始半径  z: 末端半径  w: 亮度
  attribute vec3 iColor;

  varying float vT;
  varying float vSide;
  varying float vIntensity;
  varying vec3  vColor;
  varying float vAxisFacing;    // |视线·光束轴|：接近 1 表示几乎顺着光束看过去

  void main() {
    float t = corner.x;
    vec3 axisWorld = normalize(iDir);
    vec3 posWorld = iOrigin + axisWorld * (iParams.x * t);

    vec3 viewPos = (viewMatrix * vec4(posWorld, 1.0)).xyz;
    vec3 axisView = normalize((viewMatrix * vec4(axisWorld, 0.0)).xyz);
    vec3 toEye = normalize(-viewPos);          // 视空间里摄像机在原点

    // 条带的横向方向 = 轴 × 视线。顺着光束看时两者共线、叉积退化，
    // 这时取任一与轴垂直的方向兜底，同时由 vAxisFacing 把亮度淡出。
    vec3 side = cross(axisView, toEye);
    float sideLen = length(side);
    if (sideLen < 1e-4) {
      vec3 ref = abs(axisView.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      side = normalize(cross(axisView, ref));
    } else {
      side /= sideLen;
    }

    float radius = mix(iParams.y, iParams.z, t);
    viewPos += side * (radius * corner.y);

    vT = t;
    vSide = corner.y;
    vIntensity = iParams.w;
    vColor = iColor;
    vAxisFacing = abs(dot(axisView, toEye));

    gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uHaze;        // 烟雾浓度：越浓越亮、衰减越慢
  uniform float uDecay;       // 沿程衰减指数
  uniform float uCoreWidth;   // 亮芯相对宽度
  uniform float uGain;

  varying float vT;
  varying float vSide;
  varying float vIntensity;
  varying vec3  vColor;
  varying float vAxisFacing;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }

  void main() {
    float r = abs(vSide);

    // 径向：窄亮芯 + 宽光晕，叠出真实光束"中间实、边缘虚"的样子
    float core = exp(-(r * r) / max(uCoreWidth * uCoreWidth, 1e-4));
    float halo = exp(-(r * r) * 1.7);
    float radial = core * 0.8 + halo * 0.4;

    // 沿程衰减 + 根部淡入（免得条带起始端出现一条生硬横边）
    float travel = pow(max(1.0 - vT, 0.0), uDecay);
    float atten = mix(travel, 1.0, 0.05 * uHaze);
    float rootFade = smoothstep(0.0, 0.03, vT);

    // 烟雾流动：沿光束漂移的低频噪声
    float smoke = mix(1.0, 0.74 + 0.48 * noise1(vT * 6.5 + uTime * 0.3), clamp(uHaze, 0.0, 1.0) * 0.75);

    // 几乎顺着光束看时条带退化成一条线，硬画会闪；淡出它，由灯口辉光顶替
    float facingFade = 1.0 - smoothstep(0.985, 0.9995, vAxisFacing);

    float a = radial * atten * rootFade * smoke * facingFade
              * vIntensity * uGain * (0.35 + 0.9 * uHaze);

    if (a <= 0.0015) discard;

    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class BeamField {
  /** @param {number} capacity 最大光束数；缓冲一次分配到位，之后只改内容不重建 */
  constructor(capacity) {
    this.capacity = capacity;

    const geometry = new InstancedBufferGeometry();

    // 逐顶点的条带骨架：SEGMENTS+1 排，每排左右两点
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
    this.params = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    this.colors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);

    geometry.setAttribute('iOrigin', this.origins);
    geometry.setAttribute('iDir', this.dirs);
    geometry.setAttribute('iParams', this.params);
    geometry.setAttribute('iColor', this.colors);
    geometry.instanceCount = 0;

    // 顶点位置完全在 shader 里算出来，three 无从推断包围体；
    // 给一个足够大的球并关掉视锥剔除，否则光束会被整体剔掉。
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 500);

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uHaze: { value: 0.6 },
        uDecay: { value: 1.6 },
        uCoreWidth: { value: 0.34 },
        uGain: { value: 1.0 },
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
    this.mesh.renderOrder = 10;

    this._color = new Color();
  }

  /**
   * 用一帧的光束数据刷新实例属性。
   *
   * @param {Array} beams computeBeams 的输出
   * @param {object} opts
   * @param {(i:number)=>number} opts.hueOf 取第 i 束光的色相（0–1）
   * @param {(i:number)=>number} opts.intensityOf 取第 i 束光的亮度（0 表示不画）
   * @param {number} opts.beamAngle 光束全角（度）
   */
  update(beams, { hueOf, intensityOf, beamAngle }) {
    const n = Math.min(beams.length, this.capacity);
    const halfAngle = (beamAngle * Math.PI) / 360;
    const spread = Math.tan(halfAngle);

    const o = this.origins.array;
    const d = this.dirs.array;
    const p = this.params.array;
    const c = this.colors.array;

    let written = 0;
    for (let i = 0; i < n; i++) {
      const intensity = intensityOf(i);
      if (intensity <= 0.001) continue; // 完全不亮的光束直接不占实例槽位

      const b = beams[i];
      const k3 = written * 3;
      const k4 = written * 4;

      o[k3] = b.origin[0];
      o[k3 + 1] = b.origin[1];
      o[k3 + 2] = b.origin[2];
      d[k3] = b.dir[0];
      d[k3 + 1] = b.dir[1];
      d[k3 + 2] = b.dir[2];

      p[k4] = b.length;
      p[k4 + 1] = 0.075;                       // 灯口半径（米）
      p[k4 + 2] = 0.075 + b.length * spread;   // 末端半径 = L·tan(θ/2)
      p[k4 + 3] = intensity;

      this._color.setHSL(hueOf(i), 0.85, 0.62);
      c[k3] = this._color.r;
      c[k3 + 1] = this._color.g;
      c[k3 + 2] = this._color.b;

      written++;
    }

    this.geometry.instanceCount = written;
    if (written > 0) {
      this.origins.addUpdateRange(0, written * 3);
      this.dirs.addUpdateRange(0, written * 3);
      this.params.addUpdateRange(0, written * 4);
      this.colors.addUpdateRange(0, written * 3);
      this.origins.needsUpdate = true;
      this.dirs.needsUpdate = true;
      this.params.needsUpdate = true;
      this.colors.needsUpdate = true;
    }
  }

  setUniforms({ time, haze, decay, gain }) {
    const u = this.material.uniforms;
    if (time !== undefined) u.uTime.value = time;
    if (haze !== undefined) u.uHaze.value = haze;
    if (decay !== undefined) u.uDecay.value = decay;
    if (gain !== undefined) u.uGain.value = gain;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
