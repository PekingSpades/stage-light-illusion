/**
 * 灯口辉光：每盏灯出光口上的一小团朝向摄像机的亮斑。
 *
 * 除了好看，它还兜住了一个渲染上的边界情况：当摄像机几乎顺着某束光看过去时，
 * 光束的 billboard 条带在屏幕上退化成一条线、被淡出（见 beams.js），
 * 这时画面上剩下的就是这团辉光——正好对应真实体验里"迎着光看只看得见一个刺眼的点"。
 *
 * 半径按真实透镜口径（Ø130mm）取，不要放大：辉光画得比透镜大得多的话，
 * 凑近看灯具时它会糊满整个画面，机身反而看不见了。真正的"炫光"交给 bloom 去发挥。
 */

import {
  AdditiveBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';

const vertexShader = /* glsl */ `
  precision highp float;
  attribute vec2 corner;      // 单位四边形的角，范围 [-1,1]
  attribute vec3 iCenter;
  attribute vec4 iParams;     // x: 半径  y: 亮度
  attribute vec3 iColor;

  varying vec2 vUv;
  varying float vIntensity;
  varying vec3 vColor;

  void main() {
    vec3 viewCenter = (viewMatrix * vec4(iCenter, 1.0)).xyz;
    // 正对摄像机的公告板：直接在视空间平移，不需要构造旋转
    viewCenter.xy += corner * iParams.x;
    vUv = corner;
    vIntensity = iParams.y;
    vColor = iColor;
    gl_Position = projectionMatrix * vec4(viewCenter, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying float vIntensity;
  varying vec3 vColor;
  uniform float uGain;

  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    // 极窄的核 + 宽晕，像镜头里的过曝光点
    float a = (exp(-r2 * 26.0) * 0.9 + exp(-r2 * 3.4) * 0.35) * vIntensity * uGain;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class GlowField {
  constructor(capacity) {
    this.capacity = capacity;

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute(
      'corner',
      new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2)
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    this.centers = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.params = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.colors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    geometry.setAttribute('iCenter', this.centers);
    geometry.setAttribute('iParams', this.params);
    geometry.setAttribute('iColor', this.colors);
    geometry.instanceCount = 0;
    geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), 500);

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uGain: { value: 1 } },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
    });

    this.geometry = geometry;
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }

  /**
   * @param {Array} beams
   * @param {{hueOf:Function, intensityOf:Function, radius?:number, colorOf?:Function}} opts
   */
  update(beams, { hueOf, intensityOf, radius = 0.2, tmpColor, offset = 0.12, hexOf = null }) {
    const n = Math.min(beams.length, this.capacity);
    // 同 LaserField：截断静默发生，而实例往往按某个维度依次排列，
    // 丢的就不是"整体变稀疏"而是"某一整类完全消失"。吵一次。
    if (beams.length > this.capacity && !this._warned) {
      this._warned = true;
      console.warn(`GlowField 容量 ${this.capacity} 装不下 ${beams.length} 个光点，末尾的会消失`);
    }
    const ctr = this.centers.array;
    const par = this.params.array;
    const col = this.colors.array;
    let written = 0;

    for (let i = 0; i < n; i++) {
      const intensity = intensityOf(i);
      if (intensity <= 0.01) continue;
      const b = beams[i];
      const k3 = written * 3;
      const k4 = written * 4;

      // 稍稍推出灯口一点，免得被灯头几何切掉一半
      ctr[k3] = b.origin[0] + b.dir[0] * offset;
      ctr[k3 + 1] = b.origin[1] + b.dir[1] * offset;
      ctr[k3 + 2] = b.origin[2] + b.dir[2] * offset;

      par[k4] = radius;
      par[k4 + 1] = intensity;

      if (hexOf) tmpColor.setHex(hexOf(i));
      else tmpColor.setHSL(hueOf(i), 0.75, 0.68);
      col[k3] = tmpColor.r;
      col[k3 + 1] = tmpColor.g;
      col[k3 + 2] = tmpColor.b;

      written++;
    }

    this.geometry.instanceCount = written;
    if (written > 0) {
      this.centers.needsUpdate = true;
      this.params.needsUpdate = true;
      this.colors.needsUpdate = true;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
