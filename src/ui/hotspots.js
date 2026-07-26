/**
 * 场景内机位热点：把"去哪个位置看"这件事直接标在那个位置上。
 *
 * 用 HTML 覆盖层而不是场景里的 Sprite。原因是本项目的后期链是
 * RenderPass → UnrealBloom → OutputPass(ACES)，任何画在三维里的中文字都会被辉光糊掉、
 * 被色调映射改色；而 DOM 元素还白拿了 Tab 键序、aria-current 和 44px 的手指命中区。
 *
 * 代价是每帧要把三维坐标投影成屏幕坐标。这部分复用主循环已经算好的 viewProjection，
 * 每个热点只写一次 transform，且值没变就不写——几十个标记的开销可以忽略。
 */

const EDGE_INSET = 30;

/** 线段与轴对齐包围盒求交（slab 法）。用来判断热点是不是被舞台挡住了。 */
function segmentHitsBox(ax, ay, az, bx, by, bz, box) {
  let t0 = 0;
  let t1 = 1;
  const d = [bx - ax, by - ay, bz - az];
  const o = [ax, ay, az];
  for (let i = 0; i < 3; i++) {
    const lo = box.min[i];
    const hi = box.max[i];
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo || o[i] > hi) return false;
      continue;
    }
    let n = (lo - o[i]) / d[i];
    let f = (hi - o[i]) / d[i];
    if (n > f) [n, f] = [f, n];
    t0 = Math.max(t0, n);
    t1 = Math.min(t1, f);
    if (t0 > t1) return false;
  }
  return true;
}

export class Hotspots {
  /**
   * @param {HTMLElement} container
   * @param {Array} presets cameraRig 的 PRESETS，需带 anchor(ctx)
   * @param {object} opts
   * @param {(preset:object)=>void} opts.onSelect
   * @param {{min:number[],max:number[]}} opts.stageBox 舞台包围盒，用于遮挡判定
   * @param {{a:number,b:number}} opts.wall 看台内墙椭圆
   * @param {number} opts.wallTop
   */
  constructor(container, presets, { onSelect, stageBox, wall, wallTop }) {
    this.container = container;
    this.presets = presets;
    this.stageBox = stageBox;
    this.wall = wall;
    this.wallTop = wallTop;
    this.currentId = null;

    this.items = presets.map((preset, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hotspot';
      btn.dataset.id = preset.id;
      btn.setAttribute('aria-label', `切到机位：${preset.label}。${preset.hint}`);

      const dot = document.createElement('span');
      dot.className = 'hotspot-dot';

      const label = document.createElement('span');
      label.className = 'hotspot-label';
      const num = document.createElement('span');
      num.className = 'hotspot-num';
      num.textContent = i + 1;
      const text = document.createElement('span');
      text.className = 'hotspot-text';
      text.textContent = preset.label;
      label.append(num, text);

      const hint = document.createElement('span');
      hint.className = 'hotspot-hint';
      hint.textContent = preset.hint;

      btn.append(dot, label, hint);
      btn.addEventListener('click', () => onSelect(preset));
      container.appendChild(btn);

      return { preset, el: btn, lastTransform: '', lastZ: 0, hidden: false };
    });
  }

  setCurrent(id) {
    if (this.currentId === id) return;
    this.currentId = id;
    for (const it of this.items) {
      const on = it.preset.id === id;
      it.el.classList.toggle('is-current', on);
      if (on) it.el.setAttribute('aria-current', 'true');
      else it.el.removeAttribute('aria-current');
    }
  }

  /** 热点被舞台台面或看台围墙挡住了吗？纯解析判定，不用 Raycaster。 */
  _occluded(cam, a) {
    if (segmentHitsBox(cam.x, cam.y, cam.z, a[0], a[1], a[2], this.stageBox)) return true;
    // 相机在场内、锚点在墙外（且不高过看台顶）→ 视线穿过了看台碗
    const inside = (x, z) => (x * x) / (this.wall.a * this.wall.a) + (z * z) / (this.wall.b * this.wall.b) < 1;
    const camIn = inside(cam.x, cam.z);
    const anchorIn = inside(a[0], a[2]);
    return camIn !== anchorIn && a[1] < this.wallTop;
  }

  /**
   * @param {Float32Array|number[]} m 列主序 viewProjection
   * @param {number} width CSS 像素
   * @param {number} height
   * @param {{x:number,y:number,z:number}} cam 相机世界坐标
   * @param {object} ctx 传给 anchor 的上下文（含 beams / lampIndex）
   */
  update(m, width, height, cam, ctx) {
    const hw = width / 2;
    const hh = height / 2;

    for (const it of this.items) {
      const a = it.preset.anchor(ctx);

      const cx = m[0] * a[0] + m[4] * a[1] + m[8] * a[2] + m[12];
      const cy = m[1] * a[0] + m[5] * a[1] + m[9] * a[2] + m[13];
      const cw = m[3] * a[0] + m[7] * a[1] + m[11] * a[2] + m[15];

      const dist = Math.hypot(a[0] - cam.x, a[1] - cam.y, a[2] - cam.z);

      // 站在这个机位上时就别再标它了，不然一个圆圈糊在鼻子上
      if (dist < 2.2) {
        if (!it.hidden) {
          it.el.hidden = true;
          it.hidden = true;
        }
        continue;
      }
      if (it.hidden) {
        it.el.hidden = false;
        it.hidden = false;
      }

      let x;
      let y;
      let edge = false;

      if (cw > 1e-4) {
        x = (cx / cw) * hw + hw;
        y = hh - (cy / cw) * hh;
        edge = x < EDGE_INSET || x > width - EDGE_INSET || y < EDGE_INSET || y > height - EDGE_INSET;
      } else {
        // 锚点在相机背后：除以负 w 会把它翻到屏幕另一侧，只能改成往边缘吸附
        edge = true;
        x = hw - cx * 1e6;
        y = hh + cy * 1e6;
      }

      if (edge) {
        // 从屏幕中心朝该方向射到内缩矩形的边上
        let dx = x - hw;
        let dy = y - hh;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const sx = (hw - EDGE_INSET) / (Math.abs(dx) || 1e-6);
        const sy = (hh - EDGE_INSET) / (Math.abs(dy) || 1e-6);
        const s = Math.min(sx, sy);
        x = hw + dx * s;
        y = hh + dy * s;
      }

      const scale = 1 - 0.28 * Math.min(1, Math.max(0, (dist - 18) / 52));
      const t = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) scale(${scale.toFixed(2)})`;
      if (t !== it.lastTransform) {
        it.el.style.transform = t;
        it.lastTransform = t;
      }

      // 近的画在上面，远的沉下去，避免标签互相压住时顺序乱跳
      const z = Math.max(21, Math.min(29, 29 - Math.round(dist / 12)));
      if (z !== it.lastZ) {
        it.el.style.zIndex = z;
        it.lastZ = z;
      }

      it.el.classList.toggle('is-edge', edge);
      it.el.classList.toggle('is-occluded', !edge && this._occluded(cam, a));
    }
  }
}
