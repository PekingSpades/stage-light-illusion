/**
 * 几何辅助图层——这些东西现实中不存在，是画给你看的"证据"。
 *
 * 1) 延长线：把每束光沿原方向延伸到很远。它笔直穿过整个场馆，
 *    直观地证明"光束是直线"这件事没有被任何东西弯折。
 * 2) 三维腰线：相邻两束光**最近点对的中点**连成的空间曲线（striction curve）。
 *    注意它与屏幕上看到的那条金色包络**不是同一条线**——这正是要讲清楚的地方。
 */

import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/** 每束光的无限延长线。 */
export class ExtensionLines {
  constructor(capacity) {
    this.capacity = capacity;
    const geo = new BufferGeometry();
    this.positions = new Float32Array(capacity * 6);
    geo.setAttribute('position', new BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = null;

    this.mesh = new LineSegments(
      geo,
      new LineBasicMaterial({
        color: 0x7fe2ff,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        toneMapped: true,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.geometry = geo;
  }

  /** @param {number} reach 延长到多远（米） */
  update(beams, { intensityOf, reach = 260 }) {
    const p = this.positions;
    let written = 0;
    for (let i = 0; i < beams.length && written < this.capacity; i++) {
      if (intensityOf(i) <= 0.01) continue;
      const b = beams[i];
      const k = written * 6;
      p[k] = b.origin[0];
      p[k + 1] = b.origin[1];
      p[k + 2] = b.origin[2];
      p[k + 3] = b.origin[0] + b.dir[0] * reach;
      p[k + 4] = b.origin[1] + b.dir[1] * reach;
      p[k + 5] = b.origin[2] + b.dir[2] * reach;
      written++;
    }
    this.geometry.setDrawRange(0, written * 2);
    this.geometry.attributes.position.needsUpdate = true;
  }

  setOpacity(v) {
    this.mesh.material.opacity = v;
    this.mesh.visible = v > 0.005;
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * 三维腰线。用 LineSegments2 才能画出有宽度的线（原生 WebGL 线宽在多数浏览器被锁死为 1px）。
 *
 * 缓冲一次分配到位后**原地改写**，不走 setPositions —— 那个方法每次都会新建
 * GL 缓冲，逐帧调用会让驱动疲于分配。
 */
export class EnvelopeCurve3D {
  constructor(capacity = 512) {
    this.capacity = capacity;

    const geo = new LineSegmentsGeometry();
    geo.setPositions(new Float32Array(capacity * 6)); // 一次性把缓冲撑到最大
    this.interleaved = geo.attributes.instanceStart.data;
    geo.instanceCount = 0;
    geo.boundingSphere = null;
    geo.boundingBox = null;

    this.material = new LineMaterial({
      color: 0x4dd8ff,
      linewidth: 4.6, // 比金色的屏幕包络粗一点：两者重合时能从底下透出一圈青边
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      dashed: false,
      toneMapped: true,
    });

    this.mesh = new LineSegments2(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.geometry = geo;
  }

  /** @param {number[][][]} segments envelopeFromBeams 的输出 */
  update(segments) {
    const arr = this.interleaved.array;
    let pairs = 0;

    for (const poly of segments) {
      for (let i = 0; i + 1 < poly.length && pairs < this.capacity; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const k = pairs * 6;
        arr[k] = a[0];
        arr[k + 1] = a[1];
        arr[k + 2] = a[2];
        arr[k + 3] = b[0];
        arr[k + 4] = b[1];
        arr[k + 5] = b[2];
        pairs++;
      }
    }

    this.geometry.instanceCount = pairs;
    this.interleaved.needsUpdate = true;
    this.mesh.visible = pairs > 0;
    return pairs;
  }

  /** LineMaterial 用像素做线宽，必须知道画布分辨率；忘了设线宽就会错。 */
  setResolution(width, height) {
    this.material.resolution.set(width, height);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
