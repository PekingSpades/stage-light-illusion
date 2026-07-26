/**
 * 2D 平面图（plot）——灯光设计软件最标志性的视图。
 *
 * 灯光师不是靠三维预览干活的，他们看的是这张俯视图：舞台在哪、每盏灯在哪、朝哪打、
 * 机位在哪。它在这里是主要的移动方式：
 *
 *   点楔形 → 飞到那个预设机位
 *   点灯位 → 独奏那台灯
 *   **点空白处 → 就站到那儿去**；按住拖动可以贴着场地一路走过去
 *
 * 最后这条最要紧：预设机位只有六个，而"每个座位看到的都不一样"正是本站的主命题，
 * 所以必须让人能站到任意一点。它同时也是手机上最顺手的移动方式——手指点一下就到了。
 *
 * 符号沿用行业习惯：圆圈是灯位，圆心伸出的短三角是它当前的水平朝向；
 * 楔形是机位（视锥），实心带序号；中心竖虚线是舞台中线 CL；画面下缘是观众正面。
 */

// 边距收到 12：地图的比例尺本来只有 0.72 px/m，标记挤成一团。
// 连同 extent 175→150（见 main.js），比例尺抬到 0.88 px/m，+22%，而 rail 一个像素没加宽。
const MARGIN = 12;

/** 在场地里"走"能到的最远半径（米）。看台外沿 140，再留一点余量。 */
const WALK_MAX_R = 171.5;

export class PlanView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number} opts.extent 视野半径（米）
   * @param {{w:number,d:number}} opts.stage 舞台尺寸
   * @param {(preset:object)=>void} opts.onPickCamera
   * @param {(index:number)=>void} opts.onPickFixture
   */
  constructor(canvas, { extent, stage, wall, tiers, bands, onPickCamera, onPickFixture, onPickPoint }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.extent = extent;
    this.wall = wall ?? { a: extent * 0.7, b: extent * 0.6 };
    this.tiers = tiers; // 座位区：[{inner:{a,b}, outer:{a,b}, fill}]
    this.bands = bands; // 环廊空带：[{a,b}]
    this.stage = stage;
    this.onPickCamera = onPickCamera;
    this.onPickFixture = onPickFixture;
    this.onPickPoint = onPickPoint;

    this.size = 288;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = this.size * this.dpr;
    canvas.height = this.size * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);

    this.k = (this.size / 2 - MARGIN) / extent;
    this.c = this.size / 2;

    this.hover = null; // {kind:'cam'|'fx'}
    this.walking = false; // 正按着空白处拖动 = 在场地里走
    this.frame = 0;
    this._hits = { cams: [], fixtures: [] };

    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerup', (e) => this._onUp(e));
    canvas.addEventListener('pointercancel', () => {
      this.walking = false;
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.canvas.style.cursor = 'crosshair';
    });
  }

  /** 画布坐标 → 世界坐标（俯视，只有 x/z）。 */
  toWorld(px, py) {
    return [(px - this.c) / this.k, (py - this.c) / this.k];
  }

  toPlan(wx, wz) {
    return [this.c + wx * this.k, this.c + wz * this.k];
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    const s = this.size / r.width;
    return [(e.clientX - r.left) * s, (e.clientY - r.top) * s];
  }

  /**
   * 命中判定：**最近者胜**，不是"列表里第一个够近的"。
   *
   * 原先按列表序返回首个命中，只要两个标记的命中盘相交，排在后面的那个就**永远点不中**——
   * 这不是概率问题，是确定性的。当时中心那三个工具机位坐标几乎完全相同（相距 0.0 与 0.4 px），
   * 于是有四个机位从来没被点开过。改成最近者胜之后，
   * 密到什么程度都只是"点准一点"，不会有点不到的东西。
   *
   * 命中半径按指针类型分档：手指比鼠标粗得多。
   */
  _pick(px, py, pointerType = 'mouse') {
    const coarse = pointerType === 'touch' || pointerType === 'pen';
    const camR = coarse ? 16 : 14;
    const fxR = coarse ? 9 : 7;

    let best = null;
    let bestD = Infinity;
    for (const h of this._hits.cams) {
      const d = Math.hypot(px - h.x, py - h.y);
      if (d < camR && d < bestD) {
        bestD = d;
        best = { kind: 'cam', ...h };
      }
    }
    if (best) return best; // 机位优先于灯位：它是更大的目标，也是更常用的操作
    for (const h of this._hits.fixtures) {
      const d = Math.hypot(px - h.x, py - h.y);
      if (d < fxR && d < bestD) {
        bestD = d;
        best = { kind: 'fx', ...h };
      }
    }
    return best;
  }

  _onDown(e) {
    const [px, py] = this._local(e);
    const hit = this._pick(px, py, e.pointerType);
    if (hit) return; // 点在楔形/灯位上，交给 pointerup 处理
    this.walking = true;
    this.canvas.setPointerCapture?.(e.pointerId);
    this._walkTo(px, py);
    e.preventDefault();
  }

  _onMove(e) {
    const [px, py] = this._local(e);
    if (this.walking) {
      this._walkTo(px, py);
      return;
    }
    const hit = this._pick(px, py, e.pointerType);
    this.hover = hit;
    this.canvas.style.cursor = hit ? 'pointer' : 'crosshair';
  }

  _onUp(e) {
    if (this.walking) {
      this.walking = false;
      this.canvas.releasePointerCapture?.(e.pointerId);
      return;
    }
    const [px, py] = this._local(e);
    const hit = this._pick(px, py, e.pointerType);
    if (!hit) return;
    if (hit.kind === 'cam') this.onPickCamera(hit.preset);
    else this.onPickFixture(hit.index);
  }

  _walkTo(px, py) {
    this._lastWalk = [px, py];
    if (!this.onPickPoint) return;
    // 场馆之外没什么可看的，把落点收进外圈里
    let [wx, wz] = this.toWorld(px, py);
    const r = Math.hypot(wx, wz);
    // 和 extent 解耦：extent 只管"画多大范围"，可达范围是另一件事。
    // 收 extent 时如果不钉住这个值，能走到的地方会跟着悄悄缩水。
    const maxR = WALK_MAX_R;
    if (r > maxR) {
      wx = (wx / r) * maxR;
      wz = (wz / r) * maxR;
    }
    this.onPickPoint(wx, wz);
  }

  /** 底图（网格、舞台、看台圈、比例尺）只在尺寸变化时重画，缓存到离屏画布。 */
  _buildStatic() {
    const off = document.createElement('canvas');
    off.width = this.size * this.dpr;
    off.height = this.size * this.dpr;
    const g = off.getContext('2d');
    g.scale(this.dpr, this.dpr);

    g.fillStyle = '#0b0d10';
    g.fillRect(0, 0, this.size, this.size);

    // 1m 细网格 + 5m 粗网格
    // 网格按尺度放大：1 m 网格在 350 m 的场馆上会糊成实心块
    for (let step = 10; step <= 50; step += 40) {
      g.strokeStyle = step === 10 ? '#151a21' : '#222a34';
      g.lineWidth = 1;
      g.beginPath();
      for (let v = -this.extent; v <= this.extent; v += step) {
        const [x] = this.toPlan(v, 0);
        const [, y] = this.toPlan(0, v);
        g.moveTo(x, MARGIN);
        g.lineTo(x, this.size - MARGIN);
        g.moveTo(MARGIN, y);
        g.lineTo(this.size - MARGIN, y);
      }
      g.stroke();
    }

    // 看台内墙（椭圆）
    g.strokeStyle = '#2b333e';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(this.c, this.c, this.wall.a * this.k, this.wall.b * this.k, 0, 0, Math.PI * 2);
    g.stroke();

    // ---- 座位平面图：三层看台画成填充的椭圆环，层间空带留深色 ----
    // 这层底图让人一眼看出"哪儿是座位、哪儿是没人的环廊"，
    // 也正好解释了激光为什么只能沿环廊扫。
    if (this.tiers) {
      for (const t of this.tiers) {
        const eIn = t.inner;
        const eOut = t.outer;
        g.beginPath();
        g.ellipse(this.c, this.c, eOut.a * this.k, eOut.b * this.k, 0, 0, Math.PI * 2);
        g.ellipse(this.c, this.c, eIn.a * this.k, eIn.b * this.k, 0, 0, Math.PI * 2);
        g.fillStyle = t.fill;
        g.fill('evenodd');
        g.strokeStyle = 'rgba(216,35,42,0.35)';
        g.lineWidth = 0.8;
        g.beginPath();
        g.ellipse(this.c, this.c, eOut.a * this.k, eOut.b * this.k, 0, 0, Math.PI * 2);
        g.stroke();
      }
      // 环廊空带：激光的目标面，画成一圈细亮线
      for (const b of this.bands || []) {
        g.beginPath();
        g.ellipse(this.c, this.c, b.a * this.k, b.b * this.k, 0, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(77,217,240,0.5)';
        g.setLineDash([3, 3]);
        g.lineWidth = 1;
        g.stroke();
        g.setLineDash([]);
      }
    }

    // 舞台轮廓
    const hw = (this.stage.w / 2) * this.k;
    const hd = (this.stage.d / 2) * this.k;
    g.strokeStyle = '#4d8df0';
    g.fillStyle = 'rgba(77,141,240,0.09)';
    g.lineWidth = 1.2;
    g.fillRect(this.c - hw, this.c - hd, hw * 2, hd * 2);
    g.strokeRect(this.c - hw, this.c - hd, hw * 2, hd * 2);

    // 中线 CL
    g.strokeStyle = '#3a414d';
    g.setLineDash([8, 6]);
    g.beginPath();
    g.moveTo(this.c, MARGIN);
    g.lineTo(this.c, this.size - MARGIN);
    g.stroke();
    g.setLineDash([]);

    g.fillStyle = '#6e7787';
    g.font = '9px ui-monospace, Menlo, monospace';
    g.fillText('CL', this.c + 4, MARGIN + 9);

    // 四面台有**两个正面、两个侧面**，机位就是照这个分到四条边上的。
    // 只在下缘写一句"观众正面"会让人以为上面那条边不是正面——那正是这张图要讲的事。
    g.textAlign = 'center';
    g.fillText('正面 A', this.c, this.size - 4);
    g.fillText('正面 C', this.c, 9);
    g.save();
    g.translate(9, this.c);
    g.rotate(-Math.PI / 2);
    g.fillText('侧面 D', 0, 0);
    g.restore();
    g.save();
    g.translate(this.size - 5, this.c);
    g.rotate(Math.PI / 2);
    g.fillText('侧面 B', 0, 0);
    g.restore();
    g.textAlign = 'left';

    // 比例尺
    const barM = 50;
    const bar = barM * this.k;
    const barY = this.size - MARGIN - 6; // 给下缘的"正面 A"让位
    g.strokeStyle = '#8a93a3';
    g.beginPath();
    g.moveTo(MARGIN, barY);
    g.lineTo(MARGIN + bar, barY);
    g.moveTo(MARGIN, barY - 3);
    g.lineTo(MARGIN, barY + 3);
    g.moveTo(MARGIN + bar, barY - 3);
    g.lineTo(MARGIN + bar, barY + 3);
    g.stroke();
    g.fillText(`${barM}m`, MARGIN + bar + 4, barY + 3);

    this.staticLayer = off;
  }

  /**
   * @param {object} data
   * @param {Array} data.beams 当前光束（取 origin/dir 画朝向）
   * @param {Array} data.presets 机位表
   * @param {object} data.ctx 传给 preset.anchor 的上下文
   * @param {string|null} data.currentId 当前机位
   * @param {{x:number,y:number,z:number}} data.camPos 实时相机位置
   * @param {number[]} data.camDir 实时相机朝向（世界）
   * @param {number} data.solo 被独奏的灯序号，-1 为无
   */
  draw({ beams, presets, ctx, currentId, camPos, camDir, solo }) {
    if (!this.staticLayer) this._buildStatic();
    const g = this.ctx;
    g.clearRect(0, 0, this.size, this.size);
    g.drawImage(this.staticLayer, 0, 0, this.size, this.size);

    this._hits.fixtures.length = 0;
    this._hits.cams.length = 0;

    // ---- 灯位 ----
    const dense = beams.length > 48;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      const [x, y] = this.toPlan(b.origin[0], b.origin[2]);
      const isSolo = i === solo;
      const isHover = this.hover && this.hover.kind === 'fx' && this.hover.index === i;

      if (!dense) {
        // 朝向三角：从灯位沿水平投影方向伸出去
        const hl = Math.hypot(b.dir[0], b.dir[2]) || 1e-6;
        const ux = b.dir[0] / hl;
        const uz = b.dir[2] / hl;
        g.strokeStyle = isSolo ? '#ffc233' : 'rgba(255,194,51,0.34)';
        g.lineWidth = isSolo ? 1.6 : 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + ux * 9, y + uz * 9);
        g.stroke();
      }

      g.beginPath();
      g.arc(x, y, dense ? 1.6 : 3.4, 0, Math.PI * 2);
      if (isSolo) {
        g.fillStyle = '#ffc233';
        g.fill();
        g.strokeStyle = '#ffc233';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, 6.5, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.strokeStyle = isHover ? '#e6eaf0' : '#8a93a3';
        g.lineWidth = 1.2;
        g.stroke();
      }

      this._hits.fixtures.push({ x, y, index: i });
    }

    // ---- 实时相机（空心楔形，跟着你转） ----
    this._wedge(g, camPos.x, camPos.z, Math.atan2(camDir[0], camDir[2]), {
      stroke: '#8a93a3',
      fill: 'rgba(138,147,163,0.10)',
    });

    // ---- 机位楔形 ----
    presets.forEach((preset, i) => {
      const a = preset.anchor(ctx);
      const t = preset.resolve(ctx).target;
      const ang = Math.atan2(t[0] - a[0], t[2] - a[2]);
      const [x, y] = this.toPlan(a[0], a[2]);
      const cur = preset.id === currentId;
      const hov = this.hover && this.hover.kind === 'cam' && this.hover.preset === preset;

      this._wedge(g, a[0], a[2], ang, {
        stroke: cur ? '#ffc233' : '#4dd9f0',
        fill: cur ? 'rgba(255,194,51,0.20)' : 'rgba(77,217,240,0.16)',
      });

      g.beginPath();
      g.arc(x, y, hov || cur ? 8 : 7, 0, Math.PI * 2);
      g.fillStyle = cur ? '#ffc233' : hov ? '#4dd9f0' : 'rgba(9,12,18,0.9)';
      g.fill();
      g.strokeStyle = cur ? '#ffc233' : '#4dd9f0';
      g.lineWidth = 1.2;
      g.stroke();

      g.fillStyle = cur || hov ? '#0b0d10' : '#4dd9f0';
      g.font = 'bold 9px ui-monospace, Menlo, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), x, y + 0.5);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';

      this._hits.cams.push({ x, y, preset });
    });

    if (this.walking) {
      g.strokeStyle = '#ffc233';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(this._lastWalk?.[0] ?? this.c, this._lastWalk?.[1] ?? this.c, 5, 0, Math.PI * 2);
      g.stroke();
    }

    // 悬停机位时把名字写出来
    if (this.hover && this.hover.kind === 'cam') {
      g.fillStyle = '#cfe8f2';
      g.font = '10px system-ui, sans-serif';
      const label = this.hover.preset.label;
      const w = g.measureText(label).width;
      const lx = Math.min(Math.max(this.hover.x - w / 2, 4), this.size - w - 4);
      g.fillStyle = 'rgba(9,12,18,0.9)';
      g.fillRect(lx - 3, this.hover.y - 24, w + 6, 14);
      g.fillStyle = '#cfe8f2';
      g.fillText(label, lx, this.hover.y - 14);
    }
  }

  _wedge(g, wx, wz, ang, { stroke, fill }) {
    const [x, y] = this.toPlan(wx, wz);
    const r = 26;
    const half = Math.PI * 0.22;
    // 画布 y 轴向下，而世界方位角是从 +z 起算，所以这里用 (sin, cos) 而不是 (cos, sin)
    const a0 = ang - half;
    const a1 = ang + half;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.sin(a0) * r, y + Math.cos(a0) * r);
    g.lineTo(x + Math.sin(a1) * r, y + Math.cos(a1) * r);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = 1;
    g.stroke();
  }

  /** 挂一排屏幕阅读器可达的按钮，键盘用户不必依赖 canvas 命中。 */
  mountA11y(host, presets, onPick) {
    host.innerHTML = '';
    presets.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `机位 ${i + 1}：${p.label}`;
      b.addEventListener('click', () => onPick(p));
      host.appendChild(b);
    });
  }
}
