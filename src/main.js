/**
 * 主循环与装配。
 *
 * 每帧的顺序是固定的，且顺序本身有含义：
 *   1. 算光束（纯数学，不碰渲染）
 *   2. 把光束喂给各个渲染层
 *   3. 渲染三维画面
 *   4. **用同一台相机的矩阵**重算屏幕包络、机位热点、平面图
 * 第 4 步必须在第 3 步之后、用同一帧的相机矩阵，否则曲线和标记会比画面慢一帧，肉眼可见地漂。
 */

import { Color, Matrix4, PointLight, Raycaster, Vector2, Vector3 } from 'three';

import { createPipeline } from './render/pipeline.js';
import { buildVenue, eyeHeightAt, VENUE } from './render/venue.js';
import { LENS_OFFSET, MovingHeadRig, PIVOT_HEIGHT } from './render/fixtureModel.js';
import { BeamField } from './render/beams.js';
import { SpotField } from './render/spots.js';
import { GlowField } from './render/glows.js';
import { EnvelopeCurve3D, ExtensionLines } from './render/guides.js';
import { computeLasers, createLaserRig, LaserField } from './render/lasers.js';
import { CONCOURSE_BANDS, ringAxes, SeatField, TIERS } from './render/seating.js';
import { CameraRig, PRESETS } from './render/cameraRig.js';

import { createRig, computeBeams } from './scene/rig.js';
import { adjacentIntersection, envelopeFromBeams } from './math/lines.js';
import { envelope2D, projectBeams, projectPoint } from './math/screenEnvelope.js';

import { Overlay2D } from './ui/overlay2d.js';
import { buildPanel } from './ui/panel.js';
import { Hotspots } from './ui/hotspots.js';
import { PlanView } from './ui/planview.js';
import { Dialogue, paginate } from './ui/dialogue.js';
import { CHAPTERS, CONTROLS, CONTROLS_FLAT, DEFAULTS, INTRO } from './ui/content.js';

const MAX_BEAMS = 96;
// 灯位记的是灯头 tilt 转轴的高度：台面 + 底座 + 摇臂
const RIG_HEIGHT = VENUE.stageHeight + PIVOT_HEIGHT;

const state = { ...DEFAULTS };
// 默认落在"激光扫射"——一进来就是最有看头的场面。
// 注意：正因为起点不是第 1 章，顶栏那条序列轨表达的是**位置**而不是**进度**，
// 不能做成"走过的段镀金"，否则首屏就在说"8 章已经走了 6 章"。
let currentChapter = CHAPTERS[CHAPTERS.length - 2];

// ---------------------------------------------------------------- 场景装配

const canvas = document.getElementById('scene');
const pipeline = createPipeline(canvas);
const { scene, camera, composer, renderer } = pipeline;

// 手机上座位减半：一万一千张椅子在中端手机上是实打实的负担，而小屏幕根本分辨不出隔了一个
const venue = buildVenue({ seatDensity: window.innerWidth < 900 ? 0.12 : 0.5 });
scene.add(venue.group);

const beamField = new BeamField(MAX_BEAMS);
const spotField = new SpotField(MAX_BEAMS, { wall: VENUE.wall, wallTop: VENUE.wallTop });
const glowField = new GlowField(MAX_BEAMS);
const fixtures = new MovingHeadRig(MAX_BEAMS);
const envelope3D = new EnvelopeCurve3D(768);
const extensions = new ExtensionLines(MAX_BEAMS);

scene.add(beamField.mesh, spotField.mesh, glowField.mesh, fixtures.group, envelope3D.mesh, extensions.mesh);

// 激光：另一套完全不同的东西——固定光源、只水平转、落点必须压在没有观众的环廊上。
// 详见 render/lasers.js 里那段"标定"的推导。
// 容量 = 边数 × 环廊条数 × 每边台数上限。三个因子**都要从各自的真相源取**，
// 不能抄字面量：曾经这里写死 64，而每边 ≥ 9 台就已经越界，
// 超出的实例被 InstancedBufferAttribute 静默截掉；灯位又是按边依次生成的，
// 于是丢的不是零散几条，而是**末尾整整一条边**——画面上就是"俯视只有三面有激光"。
const LASER_SIDES = 4; // 四面台
const LASER_PER_SIDE_MAX = CONTROLS_FLAT.find((c) => c.key === 'laserPerSide').max;
const LASER_MAX = LASER_SIDES * CONCOURSE_BANDS.length * LASER_PER_SIDE_MAX;
const laserField = new LaserField(LASER_MAX);
const laserGlow = new GlowField(LASER_MAX);
scene.add(laserField.mesh, laserGlow.mesh);
let laserRig = createLaserRig(11, 4);
let lasers = [];
const laserHits = [];

const overlay = new Overlay2D(document.getElementById('overlay'));
const cameraRig = new CameraRig(camera, renderer.domElement);

// 检修灯：只在「灯具特写」机位亮起。演唱会现场的灯具背面本来就是纯剪影，
// 想看清构造得自己打一盏工作灯——真实布场也是这么干的。
// 挂在相机上，所以相机必须进场景图，否则子节点上的灯不参与光照。
const inspectLight = new PointLight(0xc3d6ff, 0, 9, 2);
inspectLight.position.set(0.5, 0.7, 0.3);
camera.add(inspectLight);
scene.add(camera);

// ---------------------------------------------------------------- 逐帧状态

let rig = null;
let beams = [];
let time = 0;
let currentPresetId = null;
const viewProj = new Matrix4();
const screenSegs = [];
const tmpColor = new Color();
const trail = []; // {p:[x,y,z], t:number}
const camDir = new Vector3();

/** 灯阵只在形状/数量/尺寸变化时重建——拖参数时每帧重建会卡。 */
function rebuildRig() {
  const count = Math.max(1, Math.round(state.count));
  rig = createRig(state.rigShape, {
    width: VENUE.stageWidth + 1.0,
    depth: VENUE.stageDepth + 1.0,
    radius: state.radius,
    span: state.span,
    count,
    height: RIG_HEIGHT,
  });
  beams = [];
  fixtures.layout(rig.fixtures);
  trail.length = 0;
}

function effectiveSolo() {
  if (state.soloIndex < 0 || !rig) return -1;
  return Math.min(Math.round(state.soloIndex), rig.fixtures.length - 1);
}

function makeAccessors() {
  const n = rig ? rig.fixtures.length : 1;
  let solo = effectiveSolo();
  let dim = 0.035;

  // 「灯眼」机位下自动把其余光束压暗：不然摄像机骑上去，画面被旁边几十束光塞满，
  // "整束光塌缩成一个点"这个最关键的证据反而看不出来。压暗而非熄灭，保留现场感。
  if (solo < 0 && cameraRig.activePreset?.id === 'lamp') {
    solo = Math.min(cameraRig.lampIndex, n - 1);
    dim = 0.09;
  }

  const hueSpan = n > 1 ? 0.34 : 0;
  const hueOf = (i) => (0.54 + hueSpan * (i / Math.max(n - 1, 1)) + 0.03 * Math.sin(time * 0.11)) % 1;
  const intensityOf = solo < 0 ? () => 1 : (i) => (i === solo ? 1.3 : dim);
  return { hueOf, intensityOf };
}

// ---------------------------------------------------------------- 主循环

let last = performance.now() / 1000;
let fpsAccum = 0;
let fpsFrames = 0;
let fpsValue = 60;
let planTick = 0;

function frame() {
  const now = performance.now() / 1000;
  const rawDt = Math.max(now - last, 0);
  // 切回标签页时 rawDt 会是几十秒，不钳制的话光束会瞬移一大段。
  // 但**帧率统计必须用未钳制的 rawDt**：拿钳制值去算，帧率永远显示成 1/0.05=20，
  // 真卡的时候反而看不出来，自动降级也就永远不会触发。
  const dt = Math.min(rawDt, 0.05);
  last = now;

  if (!state.frozen) time += dt;

  computeBeamsIntoState();

  const soloNow = effectiveSolo();
  cameraRig.lampIndex = soloNow >= 0 ? soloNow : 0;
  const { hueOf, intensityOf } = makeAccessors();

  // 灯束与激光可以各自开关，也可以同时开——两套是独立的系统
  const beamsOn = state.beamsOn;
  beamField.mesh.visible = beamsOn;
  spotField.mesh.visible = beamsOn;
  glowField.mesh.visible = beamsOn;
  if (beamsOn) {
    beamField.setUniforms({ time, haze: state.haze, gain: state.gain });
    beamField.update(beams, { hueOf, intensityOf, beamAngle: state.beamAngle });
    spotField.update(beams, { hueOf, intensityOf, beamAngle: state.beamAngle, gain: state.gain });
    glowField.update(beams, { hueOf, intensityOf, tmpColor });
    glowField.material.uniforms.uGain.value = state.gain;
  }

  if (state.showFixtures) fixtures.aim(beams, rig.fixtures);
  fixtures.setVisible(state.showFixtures);

  extensions.setOpacity(state.showExtensions ? 0.32 : 0);
  if (state.showExtensions) extensions.update(beams, { intensityOf });

  if (state.showEnvelope3D) {
    const segs = envelopeFromBeams(beams, {
      closed: rig.closed,
      maxGap: state.maxGap,
      groupOf: (i) => rig.fixtures[i].side,
    });
    envelope3D.update(segs);
  } else {
    envelope3D.mesh.visible = false;
  }

  updateLasers();

  updateTrail();
  venue.crowd.material.uniforms.uTime.value = time;
  cameraRig.update(dt, { beams });

  // 淡入淡出，别在切机位时"啪"地亮一下
  const wantInspect = cameraRig.activePreset?.id === 'focus' ? 26 : 0;
  inspectLight.intensity += (wantInspect - inspectLight.intensity) * Math.min(1, dt * 5);

  composer.render();

  // ---- 与三维同一帧的相机矩阵：屏幕包络、机位热点、平面图都用它 ----
  camera.updateMatrixWorld();
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const m = viewProj.elements;

  drawOverlay(m, intensityOf);
  syncCurrentPreset();
  hotspots.update(m, overlay.width, overlay.height, camera.position, {
    beams,
    lampIndex: cameraRig.lampIndex,
  });
  hotspots.setCurrent(currentPresetId);
  syncCamList();
  syncPlanViewKeys();

  // 平面图 20fps 足够，它是给人扫一眼的，不必逐帧
  if (++planTick % 3 === 0) {
    camera.getWorldDirection(camDir);
    plan.draw({
      beams,
      presets: PLAN_PRESETS,
      ctx: { beams, lampIndex: cameraRig.lampIndex },
      currentId: currentPresetId,
      camPos: camera.position,
      camDir: [camDir.x, camDir.y, camDir.z],
      solo: soloNow,
    });
  }

  dialogue.tick(dt);
  syncTimeline();
  if (soloNow >= 0) updateStats();

  // 帧率兜底：先降分辨率，绝不降灯数——灯数是演示内容的一部分
  // 阈值必须放得够宽。原先取 0.5 s，本意是滤掉"标签页刚回前台"那一帧，
  // 结果把**真正的慢帧**也一起滤掉了——设备越慢越采不到样本，帧率永远停在初值 60，
  // 画质分档因此成了死代码，与它的目的正好相反。
  // 现在后台已由 visibilitychange 显式暂停并重置 last，这里只需挡住极端离群值。
  if (rawDt < 2.0) {
    fpsAccum += rawDt;
    fpsFrames++;
  }
  if (fpsAccum >= 1) {
    fpsValue = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
    updateStats();
    autoQuality();
  }
}

function computeBeamsIntoState() {
  beams = computeBeams(
    rig,
    {
      tiltBase: state.tiltBase,
      tiltAmp: state.tiltAmp,
      tiltSpread: state.tiltSpread,
      panBase: state.panBase,
      panAmp: state.panAmp,
      panPhaseLag: state.panPhaseLag,
      freq: state.freq,
      phaseStep: state.phaseStep,
      beamLength: state.beamLength,
      lensOffset: LENS_OFFSET,
    },
    time,
    beams
  );
}

/** 激光：算光束 + 画落点。落点那颗亮斑才是观众在看台上真正看到的东西。 */
function updateLasers() {
  const on = state.laserOn && state.laserPerSide > 0;
  laserField.mesh.visible = on;
  laserGlow.mesh.visible = on;
  if (!on) return;

  const want = Math.max(2, Math.round(state.laserPerSide));
  if (laserRig.perSide !== want) {
    laserRig = createLaserRig(want, LASER_SIDES);
    // 真正的不变量在这里，而不在上面那三个因子里：只要灯位数超过缓冲容量，
    // 末尾整条边就会消失。宁可在造完灯位时就吵，也别让它以"少一面"的形式出现在画面上。
    if (laserRig.units.length > LASER_MAX) {
      console.error(`激光灯位 ${laserRig.units.length} 条 > 缓冲容量 ${LASER_MAX}，末尾整条边将不可见`);
    }
  }

  lasers = computeLasers(
    laserRig,
    {
      freq: state.laserFreq,
      coverage: state.laserCoverage,
      spacing: state.laserSpacing,
    },
    time,
    lasers
  );

  laserField.setUniforms({ haze: state.haze, gain: state.laserGain });
  laserField.setProjection(camera.fov, overlay.height * (window.devicePixelRatio || 1));
  laserField.update(lasers, { intensity: 1 });

  // 落点：把 hit 当成一个零长度光束喂给辉光层
  laserHits.length = lasers.length;
  for (let i = 0; i < lasers.length; i++) {
    laserHits[i] = laserHits[i] || { origin: [0, 0, 0], dir: [0, 0, 0] };
    laserHits[i].origin = lasers[i].hit;
  }
  const bandHex = [0x9dffb8, 0x9de8ff];
  laserGlow.update(laserHits, {
    hueOf: () => 0.33,
    intensityOf: () => 1,
    radius: 0.9,
    tmpColor,
    offset: 0,
    hexOf: (i) => bandHex[lasers[i].band % bandHex.length],
  });
  laserGlow.material.uniforms.uGain.value = state.laserGain * 1.4;
}

function updateTrail() {
  if (state.trailSeconds <= 0.01 || beams.length < 2) {
    if (trail.length) trail.length = 0;
    return;
  }
  if (!state.frozen) {
    const a = beams[0];
    const b = beams[1];
    const hit = adjacentIntersection(a.origin, a.dir, b.origin, b.dir, {
      minS: 0.2,
      maxS: Math.min(a.length, b.length),
      maxGap: Math.max(state.maxGap, 8),
    });
    if (hit) trail.push({ p: hit, t: time });
  }
  const cutoff = time - state.trailSeconds;
  let drop = 0;
  while (drop < trail.length && trail[drop].t < cutoff) drop++;
  if (drop) trail.splice(0, drop);
}

function drawOverlay(m, intensityOf) {
  overlay.clear();
  const { width, height } = overlay;
  const project = (p) => projectPoint(m, p, width, height);

  if (state.showEnvelope2D && beams.length > 1) {
    // 只把"亮着的"光束纳入包络：独奏时其余光束虽然还在，但观众看不见它们，
    // 那么由它们算出来的曲线也不该出现在画面上。
    const visible = [];
    for (let i = 0; i < beams.length; i++) {
      if (intensityOf(i) > 0.2) visible.push(beams[i]);
    }
    if (visible.length > 2) {
      projectBeams(visible, m, width, height, screenSegs);
      const polylines = envelope2D(screenSegs, {
        closed: rig.closed && visible.length === beams.length,
        maxJump: Math.max(width, height) * 0.3,
        groupOf: (i) => rig.fixtures[visible[i].index]?.side,
      });
      // 灯不多时把切点也点出来：曲线与每束光相切这件事，看见比听说管用
      overlay.drawEnvelope(polylines, { dots: visible.length <= 40 });
    }
  }

  if (trail.length > 1) {
    overlay.drawTrail(
      trail.map((e) => e.p),
      project
    );
    overlay.drawMarker(trail[trail.length - 1].p, project, '交点', { color: '#ffc233' });
  }
}

/** 人一旦拖着相机走远，就不该再说"你在 X 机位"了。 */
function syncCurrentPreset() {
  if (!currentPresetId) return;
  // 飞行途中距离必然大于阈值——这时候清掉，等于刚点完机位就立刻取消高亮，
  // 而且清掉之后本函数第一行就 return，再也不会恢复。
  // 于是"当前机位"那点金色其实从来没亮过（只有 live 的灯眼机位撞巧幸免）。
  // 这个判断只该管"人自己把相机拖走了"，不该管"正在飞过去"。
  if (cameraRig.flying) return;
  const preset = PRESETS.find((p) => p.id === currentPresetId);
  if (!preset || preset.live) return; // 灯眼是活的，只要没松手就一直算当前机位
  const pos = preset.resolve({ beams, lampIndex: cameraRig.lampIndex }).position;
  const d = Math.hypot(
    camera.position.x - pos[0],
    camera.position.y - pos[1],
    camera.position.z - pos[2]
  );
  if (d > 6) currentPresetId = null;
}

// ---------------------------------------------------------------- 交互

function goToPreset(preset) {
  cameraRig.goTo(preset, { beams });
  currentPresetId = PRESETS.includes(preset) ? preset.id : null;
}

function applyChapter(chapter) {
  currentChapter = chapter;
  Object.assign(state, DEFAULTS, chapter.params);
  rebuildRig();
  panel.sync();
  panel.mountEncoders(document.getElementById('encoders'), chapter.encoders || [], CONTROLS_FLAT);
  renderChapterTabs();
  dialogue.load(paginate(chapter));
  if (chapter.camera) {
    const preset = PRESETS.find((p) => p.id === chapter.camera);
    if (preset) goToPreset(preset);
  }
}

function renderChapterTabs() {
  const idx = CHAPTERS.indexOf(currentChapter);
  const nextId = CHAPTERS[(idx + 1) % CHAPTERS.length]?.id;
  document.querySelectorAll('.chapter-tab').forEach((el) => {
    const on = el.dataset.id === currentChapter.id;
    el.classList.toggle('is-active', on);
    el.classList.toggle('is-next', el.dataset.id === nextId && !on);
    if (on) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
  seqCount.textContent = `${pad(idx + 1)}/${pad(CHAPTERS.length)}`;
  // chapter.title 一直写着却从没露过面——dialogue 只在没有 dialog 时才拿它兜底，
  // 而 8 章全都有 dialog。放这儿正好，白捡一行信息。
  seqTitle.textContent = currentChapter.title ?? '';
  fitSeqTrack();
}

function onParamChange(key) {
  if (key === 'rigShape' || key === 'count' || key === 'span' || key === 'radius') {
    rebuildRig();
  }
  panel.sync();
}

function updateStats() {
  const el = document.getElementById('stats');
  if (!el) return;
  const solo = effectiveSolo();
  // 点中一台灯之后，把它此刻的 pan/tilt 读数亮出来。
  // 这一步很关键：它把"一排会动的机器"变成了可核对的对象——
  // 你能亲眼确认灯头的两个角度就是公式里的那两个数，中间没有魔法。
  if (solo >= 0 && beams[solo]) {
    const d = beams[solo].dir;
    const pan = (Math.atan2(d[0], d[2]) * 180) / Math.PI;
    const tilt = (Math.acos(Math.min(1, Math.max(-1, d[1]))) * 180) / Math.PI;
    el.innerHTML =
      `<b style="color:var(--acc-sel)">SOLO #${solo}</b> · PAN ${pan.toFixed(1)}° · TILT ${tilt.toFixed(1)}°` +
      ` <span style="color:var(--fg-ghost)">· ${rig.fixtures.length} 灯 · ${fpsValue.toFixed(0)} fps</span>`;
    return;
  }
  const seats = venue.seats ? venue.seats.count : 0;
  el.textContent = `${rig ? rig.fixtures.length : 0} 灯 · ${(seats / 1000).toFixed(0)}k 座 · Q${qualityLevel} · ${fpsValue.toFixed(0)} fps`;
}

/**
 * 画质分档。
 *
 * 座椅是全场最大的开销（满密度 7.4 万实例、178 万三角），设备差异又极大，
 * 所以不能写死一个值。做法是**先保守起步、再按实测帧率上下调**：
 * 桌面从中档开、手机从最低档开，站得住就升，撑不住就降。
 *
 * 降档时**先降座椅密度**而不是先降分辨率——座椅少画一半几乎看不出来（还会自动加宽补偿），
 * 而分辨率一降整个画面就发虚。
 */
const QUALITY = [
  { seats: 0.12, pixelCap: 1.0, bloom: 0.55 },
  { seats: 0.25, pixelCap: 1.25, bloom: 0.68 },
  { seats: 0.5, pixelCap: 1.5, bloom: 0.82 },
  { seats: 1.0, pixelCap: 1.75, bloom: 0.82 },
];
let qualityLevel = window.innerWidth < 900 ? 0 : 2;
let goodFrames = 0;

function applyQuality(level) {
  qualityLevel = Math.max(0, Math.min(QUALITY.length - 1, level));
  const q = QUALITY[qualityLevel];
  pipeline.setPixelRatioCap(q.pixelCap);
  pipeline.bloom.strength = q.bloom;
  if (Math.abs(venue.seats.density - q.seats) > 1e-3) {
    venue.bowlGroup.remove(venue.seats.mesh);
    venue.seats.dispose();
    venue.seats = new SeatField(q.seats);
    venue.bowlGroup.add(venue.seats.mesh);
  }
  updateStats();
}

function autoQuality() {
  if (fpsValue < 38) {
    goodFrames = 0;
    if (qualityLevel > 0) applyQuality(qualityLevel - 1);
    return;
  }
  // 连续几秒都很宽裕才升档，避免在阈值附近来回跳
  if (fpsValue > 56) {
    if (++goodFrames >= 4 && qualityLevel < QUALITY.length - 1) {
      goodFrames = 0;
      applyQuality(qualityLevel + 1);
    }
  } else {
    goodFrames = 0;
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, pipeline.pixelRatioCap);
  pipeline.resize(width, height);
  overlay.resize(width, height, dpr);
  envelope3D.setResolution(width * dpr, height * dpr);
}

// ---------------------------------------------------------------- 场景内拾取

const raycaster = new Raycaster();
const ndc = new Vector2();
let pressAt = null;

canvas.addEventListener('pointerdown', (e) => {
  pressAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  document.body.classList.add('dragging');
});

canvas.addEventListener('pointerup', (e) => {
  setTimeout(() => document.body.classList.remove('dragging'), 900);
  if (!pressAt) return;
  const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
  const held = performance.now() - pressAt.t;
  pressAt = null;
  if (moved > 6 || held > 500) return; // 那是在拖视角，不是点击
  pick(e);
});

/**
 * 点场景：先看有没有点中某台灯（点中就独奏它），否则看有没有点中看台（点中就飞过去坐下）。
 * "每个座位看到的都不一样"是本站的主命题，那就该让人真的能挑任意一个座位，
 * 而不是只能在我预设的六个机位里选。
 */
function pick(e) {
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  if (state.showFixtures) {
    const hit = raycaster.intersectObject(fixtures.heads, false)[0];
    if (hit && hit.instanceId !== undefined && hit.instanceId < rig.fixtures.length) {
      state.soloIndex = effectiveSolo() === hit.instanceId ? -1 : hit.instanceId;
      panel.sync();
      updateStats();
      return;
    }
  }

  const seat = raycaster.intersectObject(venue.bowl, false)[0];
  if (seat) {
    const p = seat.point;
    cameraRig.goTo({
      id: 'seat',
      label: '这个座位',
      hint: '你自己挑的位置。',
      resolve: () => ({ position: [p.x * 0.94, p.y + 1.3, p.z * 0.94], target: [0, 9, 0] }),
      anchor: () => [p.x * 0.94, p.y + 1.3, p.z * 0.94],
    });
    currentPresetId = null; // 临时机位不在热点表里，别去点亮任何一个
  }
}

/**
 * 站到场地里的任意一点去。平面图上点一下或按住拖动都走这里。
 * 高度按那一点的地面来（内场平地 / 看台阶梯 / 舞台台面），所以落点永远是"站着的人眼"。
 */
function moveToPoint(wx, wz) {
  const y = eyeHeightAt(wx, wz);
  cameraRig.goTo({
    id: 'spot',
    label: '这个位置',
    hint: '你自己挑的位置。',
    resolve: () => ({ position: [wx, y, wz], target: [0, 9, 0] }),
    anchor: () => [wx, y, wz],
  });
  currentPresetId = null;
}

/**
 * 聚焦：飞到被独奏那台灯的跟前。灯光台上 focus 就是这个动作。
 * 既然灯具是照着真机建的，就得有办法凑近看清它——否则做多细都白搭。
 */
function focusSoloedFixture() {
  const i = effectiveSolo();
  if (i < 0 || !rig.fixtures[i]) return;
  const f = rig.fixtures[i];
  // 站到灯**背后**看——正是灯光技师检查灯具的角度：光束朝远处打，
  // 不会有一团过曝的白糊住机身，摇臂、散热鳍、底座接口全看得清。
  // 机位跟着灯头当前朝向走，所以灯一摆，你始终在它背后。
  const D = 2.0;
  cameraRig.goTo({
    id: 'focus',
    label: '灯具特写',
    hint: '从背后凑近看这台摇头灯。',
    live: true,
    resolve: (ctx) => {
      const b = (ctx.beams && ctx.beams[i]) || null;
      let hx = -f.outward[0];
      let hz = -f.outward[2];
      if (b) {
        const hl = Math.hypot(b.dir[0], b.dir[2]);
        if (hl > 1e-3) {
          hx = -b.dir[0] / hl;
          hz = -b.dir[2] / hl;
        }
      }
      return {
        position: [f.position[0] + hx * D, f.position[1] + 0.42, f.position[2] + hz * D],
        target: [f.position[0], f.position[1] - 0.06, f.position[2]],
      };
    },
    anchor: () => [f.position[0], f.position[1], f.position[2]],
  });
  currentPresetId = null;
}

// ---------------------------------------------------------------- 启动

document.getElementById('intro-title').textContent = INTRO.title;
document.getElementById('intro-subtitle').textContent = INTRO.subtitle;

const seqTrack = document.getElementById('seq-track');
const seqCount = document.getElementById('seq-count');
const seqTitle = document.getElementById('seq-title');
const total = CHAPTERS.length;
const pad = (n) => String(n).padStart(2, '0');

CHAPTERS.forEach((chapter, i) => {
  const btn = document.createElement('button');
  btn.className = 'chapter-tab';
  btn.dataset.id = chapter.id;
  btn.type = 'button';
  // 原先写的是 role="tab"，但页面里既没有 tabpanel 也没有 aria-controls，
  // 那是个空头承诺。这就是一组顺序步骤，用 nav + aria-current="step" 才是实话。
  btn.setAttribute('aria-label', `第 ${i + 1} 章，共 ${total} 章：${chapter.label}`);

  const n = document.createElement('span');
  n.className = 'seq-n';
  n.textContent = pad(i + 1);
  const label = document.createElement('span');
  label.className = 'seq-label';
  label.textContent = chapter.label;
  btn.append(n, label);

  btn.addEventListener('click', () => applyChapter(chapter));
  seqTrack.appendChild(btn);
});

/**
 * 装不下就退化成数字刻度。
 *
 * 判据是**标签真的被 ellipsis 截断了**（scrollWidth > clientWidth），
 * 不是某个写死的断点宽度：写死断点等于把它和"章节数 × 中文名长度"绑死，
 * 加一章就得回来重调，而且无头环境下媒体查询里的 pointer 特性造不出来、验不了。
 */
function fitSeqTrack() {
  const nav = seqTrack.parentElement;
  nav.classList.remove('is-tight', 'is-tighter');
  seqTrack.classList.remove('is-dense');
  // 注意别用 scrollWidth > clientWidth 判截断：这两个属性都是**取整**的，
  // 文字实际需要 60.0px、盒子只有 59.5px 时两边都读成 60，检测不到。
  // 而 CSS 的 ellipsis 对这 0.5px 毫不留情——省略号自己也要占位置，
  // 于是"鸟巢四面台"直接掉成"鸟巢四…"，一口气丢两个字。
  // 用 Range 量文字的**小数**宽度才准。
  const range = document.createRange();
  const truncated = () =>
    [...seqTrack.querySelectorAll('.seq-label')].some((el) => {
      if (getComputedStyle(el).display === 'none') return false;
      range.selectNodeContents(el);
      return range.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.5;
    });

  // 逐级让步，每让一步就重新量一次，够了就停。
  if (!truncated()) return;
  seqTrack.classList.add('is-dense'); // 一级：非当前/下一段收成纯数字刻度
  if (!truncated()) return;
  nav.classList.add('is-tight'); // 二级：把本章标题让出去，宽度还给轨
  if (!truncated()) return;
  nav.classList.add('is-tighter'); // 三级：只留当前段的名字，下一段靠两条色码认
}
new ResizeObserver(fitSeqTrack).observe(seqTrack);

const panel = buildPanel(document.getElementById('panel-body'), state, onParamChange, {
  controls: CONTROLS,
  getDefaults: () => ({ ...DEFAULTS, ...currentChapter.params }),
});

const hotspots = new Hotspots(document.getElementById('hotspots'), PRESETS, {
  onSelect: goToPreset,
  stageBox: {
    min: [-VENUE.stageWidth / 2, 0, -VENUE.stageDepth / 2],
    max: [VENUE.stageWidth / 2, VENUE.stageHeight, VENUE.stageDepth / 2],
  },
  wall: VENUE.wall,
  wallTop: VENUE.wallTop,
});

/**
 * 上图的只有**座位机位**。
 *
 * 俯瞰／演员／场外／灯眼这四个是"视角"而不是"场地上的位置"：
 * 前三个的 x,z 全是 (0,0) 附近，在俯视投影里根本没有可区分的落点，
 * 硬画上去就是三个标记完全重合（实测相距 0.0 与 0.4 px，后两个永远点不中）；
 * 场外那个半径 378 m，直接落在画布外面，既看不见也点不到。
 * 它们改成图下面一排"视角键"，那个载体本身不承诺空间位置，也就不会说谎。
 */
const PLAN_PRESETS = PRESETS.filter((p) => p.kind === 'seat');
const TOOL_PRESETS = PRESETS.filter((p) => p.kind === 'tool');

// 键盘 1~9 是按 PRESETS 的下标绑的，平面图上的编号也是 i+1。
// 两者对得上**只是因为**座位机位恰好占着 PRESETS[0..7]；插一个机位就会整体错位。
if (import.meta.env.DEV) {
  console.assert(
    PLAN_PRESETS.every((p, i) => PRESETS[i] === p),
    '座位机位必须占据 PRESETS[0..7]，否则平面图编号与键盘 1~9 会错位',
  );
}

const plan = new PlanView(document.getElementById('plan'), {
  // 只需装下平面图**真正画出来的**东西：看台外沿 140 与最外的机位标记 137。
  // 建筑檐口 166 从来没画进这张图（wall 传的是 BOWL.inner），
  // 按 175 留边等于白扔掉 20% 的半径——标记因此挤成一团。
  extent: 150,
  stage: { w: VENUE.stageWidth, d: VENUE.stageDepth },
  wall: VENUE.wall,
  tiers: TIERS.map((t, i) => ({
    inner: ringAxes(t.s0),
    outer: ringAxes(t.s1),
    fill: ['rgba(216,35,42,0.30)', 'rgba(216,35,42,0.24)', 'rgba(216,35,42,0.18)'][i],
  })),
  bands: CONCOURSE_BANDS.map((b) => ringAxes(b.s)),
  onPickCamera: goToPreset,
  onPickFixture: (i) => {
    state.soloIndex = effectiveSolo() === i ? -1 : i;
    panel.sync();
    updateStats();
  },
  onPickPoint: (wx, wz) => moveToPoint(wx, wz),
});
plan.mountA11y(document.getElementById('plan-a11y'), PRESETS, goToPreset);

// 视角键：平面图画不了的那四个机位。无障碍列表仍然是全部 12 个，不受这里影响。
const planViewKeys = TOOL_PRESETS.map((preset) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'plan-view-key';
  b.textContent = preset.label.split('·').pop();
  b.title = `${preset.label} —— ${preset.hint}`;
  b.setAttribute('aria-label', preset.label);
  b.addEventListener('click', () => goToPreset(preset));
  document.getElementById('plan-views').append(b);
  return { preset, el: b };
});

function syncPlanViewKeys() {
  for (const { preset, el } of planViewKeys) {
    el.classList.toggle('is-active', preset.id === currentPresetId);
    el.setAttribute('aria-pressed', preset.id === currentPresetId ? 'true' : 'false');
  }
}

const dialogue = new Dialogue(
  {
    root: document.getElementById('npc'),
    text: document.getElementById('npc-text'),
    live: document.getElementById('npc-live'),
    progress: document.getElementById('npc-progress'),
    next: document.getElementById('npc-next'),
  },
  (act) => {
    if (act.set) {
      Object.assign(state, act.set);
      onParamChange(Object.keys(act.set)[0]);
    }
    if (act.flash) panel.flash(act.flash);
    if (act.cam) {
      const preset = PRESETS.find((p) => p.id === act.cam);
      if (preset) goToPreset(preset);
    }
  }
);

document.querySelector('.npc-box').addEventListener('click', () => dialogue.advance());
document.getElementById('npc-auto').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  dialogue.setAuto(on);
  e.stopPropagation();
});

const npcRestore = document.getElementById('npc-restore');
function toggleNpc() {
  const collapsed = document.body.classList.toggle('npc-collapsed');
  npcRestore.hidden = !collapsed;
}
document.getElementById('npc-collapse').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleNpc();
});
npcRestore.addEventListener('click', toggleNpc);

// ---------------------------------------------------------------- 手机：底部标签栏与抽屉

/**
 * 手机上没有键盘，桌面端那套快捷键全部失效，所以每个入口都必须在底部这排里摸得到。
 * 一次只开一块内容：抽屉打开时对话框和场景热点让位，免得在 6 英寸屏上互相压。
 * 这是刻意的取舍——移动端不必完整复刻桌面端的每一项交互，够用且顺手更重要。
 */
const camList = document.getElementById('cam-list');
PRESETS.forEach((preset, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cam-btn';
  b.dataset.id = preset.id;
  b.innerHTML = `${i + 1} · ${preset.label}<small>${preset.hint.slice(0, 18)}…</small>`;
  b.addEventListener('click', () => {
    goToPreset(preset);
    setSheet(null);
  });
  camList.appendChild(b);
});

let sheet = null;
function setSheet(name) {
  sheet = sheet === name ? null : name;
  const b = document.body.classList;
  b.remove('sheet-params', 'sheet-plan', 'sheet-cams', 'sheet-open');
  if (sheet) b.add(`sheet-${sheet}`, 'sheet-open');
  document.querySelectorAll('#mobilebar .mb[data-sheet]').forEach((el) => {
    const on = el.dataset.sheet === 'talk' ? !sheet && !b.contains('npc-off') : el.dataset.sheet === sheet;
    el.setAttribute('aria-pressed', String(on));
  });
}

document.querySelectorAll('#mobilebar .mb').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.act === 'freeze') {
      setFrozen(!state.frozen);
      btn.setAttribute('aria-pressed', String(state.frozen));
      return;
    }
    if (btn.dataset.sheet === 'talk') {
      const off = document.body.classList.toggle('npc-off');
      if (!off) setSheet(null);
      else setSheet(sheet);
      btn.setAttribute('aria-pressed', String(!off));
      return;
    }
    document.body.classList.remove('npc-off');
    setSheet(btn.dataset.sheet);
  });
});

// 机位列表的高亮：只在机位真的变了才动 DOM，别每帧查询一遍
const camButtons = [...camList.querySelectorAll('.cam-btn')];
let lastCamSync = '\u0000';
function syncCamList() {
  if (currentPresetId === lastCamSync) return;
  lastCamSync = currentPresetId;
  for (const el of camButtons) {
    if (el.dataset.id === currentPresetId) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  }
}

document.getElementById('panel-toggle').addEventListener('click', (e) => {
  const collapsed = document.body.classList.toggle('panel-collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
});

const freezeBtn = document.getElementById('freeze-btn');
function setFrozen(v) {
  state.frozen = v;
  freezeBtn.setAttribute('aria-pressed', String(v));
}
freezeBtn.addEventListener('click', () => setFrozen(!state.frozen));

// ---- 时间轴：拖它就是在一个摆动周期里前后找位置 ----
const timeline = document.getElementById('timeline');
let scrubbing = false;
timeline.addEventListener('pointerdown', () => {
  scrubbing = true;
  setFrozen(true);
});
timeline.addEventListener('pointerup', () => {
  scrubbing = false;
});
timeline.addEventListener('input', () => {
  const period = state.freq > 0.001 ? 1 / state.freq : 4;
  time = parseFloat(timeline.value) * period;
});
function syncTimeline() {
  if (scrubbing) return;
  const period = state.freq > 0.001 ? 1 / state.freq : 4;
  timeline.value = (((time % period) + period) % period) / period;
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

  // 空格先给老陆用；他讲完了就落回"冻结"
  if (e.code === 'Space' || e.code === 'Enter') {
    if (dialogue.advance()) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      setFrozen(!state.frozen);
      return;
    }
  }

  const idx = '123456789'.indexOf(e.key);
  if (idx >= 0 && idx < PRESETS.length) {
    goToPreset(PRESETS[idx]);
    return;
  }
  if (e.key === '0') {
    cameraRig.release();
    currentPresetId = null;
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const i = CHAPTERS.indexOf(currentChapter);
    applyChapter(CHAPTERS[(i + (e.key === 'ArrowRight' ? 1 : CHAPTERS.length - 1)) % CHAPTERS.length]);
    return;
  }
  if (e.key === 'f' || e.key === 'F') {
    focusSoloedFixture();
    return;
  }
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('ui-hidden');
  if (e.key === 'c' || e.key === 'C') toggleNpc();
  if (e.key === 'a' || e.key === 'A') document.getElementById('npc-auto').click();
});

window.addEventListener('resize', resize);

// 小屏：参数栏默认收起，分辨率上限压低
if (window.innerWidth < 900) {
  document.body.classList.add('panel-collapsed', 'is-compact');
  pipeline.pixelRatioCap = 1.5;
}

/**
 * 标签页切到后台就把渲染循环停掉。
 * 浏览器本来会把 rAF 降到很低的频率，但不会归零——96 束光 + 7 万座椅还在算，
 * 白耗电也白占 GPU。回到前台时要重置 last，否则第一帧的 dt 是几十秒。
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    renderer.setAnimationLoop(null);
  } else {
    last = performance.now() / 1000;
    fpsAccum = 0;
    fpsFrames = 0;
    renderer.setAnimationLoop(frame);
  }
});

resize();
applyChapter(currentChapter);
applyQuality(qualityLevel);
document.body.classList.add('is-ready');
renderer.setAnimationLoop(frame);
