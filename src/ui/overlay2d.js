/**
 * 2D 叠加层：把"你眼睛看到的那条曲线"直接画在画面上。
 *
 * 它必须画在 2D 画布上而不是三维场景里，因为屏幕空间包络**本来就不是空间中的物体**——
 * 它是这一族直线投影之后才出现的东西，只在当前这个视点下成立。
 * 每帧随相机重算，所以你一转视角就会看见它跟着变形；这正是要传达的结论。
 */

const GOLD = '#ffcc44';

export class Overlay2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
  }

  resize(width, height, dpr) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // 之后所有绘制都用 CSS 像素坐标，与 projectBeams 的输出一致
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * 画屏幕空间包络。
   * @param {{x:number,y:number}[][]} polylines
   */
  drawEnvelope(polylines, { color = GOLD, lineWidth = 2.6, glow = 14, dots = false } = {}) {
    const ctx = this.ctx;
    if (!polylines.length) return;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.lineWidth = lineWidth;

    for (const poly of polylines) {
      if (poly.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.stroke();
    }

    if (dots) {
      // 切点是"曲线与每束光相切"的直接证据，得比曲线本身更抓眼：
      // 先扣一圈深色底再点实心点，免得贴在亮曲线上看不出是独立的点。
      for (const poly of polylines) {
        for (const p of poly) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(6,8,14,0.85)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
          ctx.fill();

          ctx.shadowBlur = 8;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  /**
   * 画交点的运动拖尾——"曲线是运动留下的痕迹"这句话的图示。
   * @param {number[][]} trail 世界坐标点列，越靠后越新
   */
  drawTrail(trail, project, { color = GOLD, maxWidth = 3 } = {}) {
    const ctx = this.ctx;
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.strokeStyle = color;

    for (let i = 1; i < trail.length; i++) {
      const a = project(trail[i - 1]);
      const b = project(trail[i]);
      if (!a || !b) continue;
      const t = i / trail.length; // 0 最旧、1 最新
      // 最旧的一段也要留住可见度，否则整条拖尾只剩靠近交点的一小截，
      // "弧是走出来的"这句话就看不出来了
      ctx.globalAlpha = (0.3 + 0.7 * t) * 0.95;
      ctx.lineWidth = 1.1 + maxWidth * t;
      ctx.shadowBlur = 4 + 9 * t;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 在某个世界点旁边挂一个小标注。 */
  drawMarker(point, project, text, { color = GOLD, radius = 5 } = {}) {
    const s = project(point);
    if (!s) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (text) {
      ctx.shadowBlur = 0;
      ctx.font = '12px ui-sans-serif, "PingFang SC", "Noto Sans SC", system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, s.x + radius + 6, s.y);
    }
    ctx.restore();
  }
}
