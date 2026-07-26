/**
 * 场馆：地面、四面台、环形看台碗、鸟巢式编织钢构、观众席。（灯具本体见 fixtureModel.js）
 *
 * 尺度做了压缩——真鸟巢直径约 300 m，全画出来光束会细得看不见。这里把看台内墙
 * 收到半径 34 m，观感等价而帧率友好。
 */

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOWL_TOP, buildBowlStructure, forEachSeat, groundHeightAt, SeatField } from './seating.js';
import { BOWL, FIELD, openingHeight, rimHeight, SHELL as SHELL_DIM, STAGE } from './venueGeometry.js';

export const VENUE = {
  stageWidth: STAGE.width,
  stageDepth: STAGE.depth,
  stageHeight: STAGE.height,
  // 看台内墙（光斑打在这上面）现在是**椭圆**，不再是一个半径。
  // 仍然导出一个等效半径给少数只需要量级的地方用。
  wall: BOWL.inner,
  wallRadiusEquiv: Math.sqrt(BOWL.inner.a * BOWL.inner.b),
  wallTop: BOWL_TOP,
  bowlOuter: BOWL.outer,
  bowlTop: BOWL_TOP,
  shell: SHELL_DIM,
};

/**
 * 观众：坐在座位上的一层点。
 *
 * 位置直接从座位表来，不再是"往斜面上撒随机点"——那样人会浮在台阶之间，
 * 也不可能和椅子对上。现在每个人都真的坐在某一张椅子上，空座就露出红椅面。
 */
function buildCrowd(occupancy = 0.62) {
  const px = [];
  const phases = [];
  const tints = [];

  let i = 0;
  forEachSeat((x, y, z) => {
    i++;
    // 用确定性的伪随机决定这张椅子上有没有人：每次刷新观众分布一致，不会闪
    const r = Math.abs(Math.sin(i * 78.233) * 43758.5453) % 1;
    if (r > occupancy) return;
    px.push(x, y + 1.05, z); // 坐着的人头顶，v1 的 0.95 会陷进靠背里
    phases.push(r * Math.PI * 2);
    tints.push((Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1));
  });

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(px), 3));
  geo.setAttribute('aPhase', new BufferAttribute(new Float32Array(phases), 1));
  geo.setAttribute('aTint', new BufferAttribute(new Float32Array(tints), 1));

  const mat = new ShaderMaterial({
    // uSize 走 gl_PointSize = uSize/距离，观看距离随尺度放大了约 4 倍，
    // 不把它提上去，观众会在真实尺度下集体消失
    uniforms: { uTime: { value: 0 }, uSize: { value: 95 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aTint;
      uniform float uTime;
      uniform float uSize;
      varying float vGlow;
      varying float vTint;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 快慢两种闪烁叠加，看起来才像一片各自为政的人群而不是齐刷刷的灯带
        float slow = 0.55 + 0.45 * sin(uTime * 0.7 + aPhase);
        float fast = step(0.982, fract(sin(aPhase * 91.7 + floor(uTime * 3.0)) * 43758.5));
        vGlow = slow * 0.5 + fast * 0.9;
        vTint = aTint;
        gl_PointSize = uSize * (1.0 + fast) / max(-mv.z, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      varying float vTint;
      uniform float uOpacity;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = dot(d, d);
        if (r > 0.25) discard;
        float falloff = exp(-r * 14.0);
        vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.7, 0.85, 1.0), vTint);
        float a = falloff * vGlow * 0.5 * uOpacity;
        gl_FragColor = vec4(warm * a, a);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
  });

  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = 'crowd';
  return pts;
}

/**
 * 场馆建筑本体：鸟巢那圈编织钢结构。
 *
 * 真实的国家体育场是椭圆平面（约 333×294 m，高 69 m），外壳由二十多榀主桁架
 * 相互交织而成，顶部收成一个椭圆开口。它的立面不是圆柱：**从地面往上先微微外鼓，
 * 再向内收进屋顶檐口**——这条剖面线是"鸟巢"辨识度的一半，另一半是构件的编织。
 *
 * 建模思路：先定义一张参数曲面 shell(u, v)
 *   u = 方位角，v = 0（地面）→ 1（顶部开口边缘）
 * 然后让每根构件沿着这张曲面走：u 随 v 线性偏转。两族反向偏转的构件一交叉，
 * 编织感就出来了。顶部再叠一圈檐口环梁和一层半透明膜（真机是 ETFE）。
 *
 * 构件截面用**矩形箱梁**而不是圆管：真机就是扁平的箱型截面，用圆管会立刻失真。
 * 沿曲线挤出矩形要靠 Frenet 标架，这比 TubeGeometry 多写三十行，但换来的是对的剪影。
 *
 * 尺度同样压缩过（见文件头）：地面处半长轴 58 m、半短轴 50 m，总高 34 m。
 */

/** 构件数量。尺度放大之后要跟着加密，否则网眼大得不像话。 */
const SHELL = {
  primary: 176,
  secondary: 104,
};

/**
 * 外壳曲面 shell(u, v)。
 *
 * u = 方位角（自 +X 长轴起算），v = 0 地面 → 0.62 檐口 → 1 屋盖开口内环。
 *
 * 有两条关键事实，前几版都做反了：
 *
 * 1. **立面是向外倾的，上大下小**。柱脚圈 153×136.5 m（24 榀桁架柱、柱距 37.96 m，
 *    按周长 911 m 反算得到），到檐口张到 166.15×148.65 m，外倾约 13°。
 *    我原先做成"从地面往上收口"，整个方向是反的。
 *
 * 2. **屋盖是马鞍形**：檐口标高随方位在 42.8～68.5 m 之间起伏，高点在短轴侧、
 *    低点在长轴端，相差 25.7 m。这条起伏是鸟巢侧影的灵魂，原先只叠了 1.8 m 的
 *    装饰性波动，而且相位还是反的。
 *
 * 3. 屋盖开口 92.65×63.75 m，长宽比 1.45，明显比整体的 1.12 更细长——
 *    所以长短轴必须**各自插值**，不能共用一个半径系数。
 */
function shellPoint(u, v, out = new Vector3(), lift = 0) {
  const { base, rim, opening } = SHELL_DIM;
  let a;
  let b;
  let y;

  if (v <= 0.62) {
    // 立面段：向外倾，下快上缓
    const t = v / 0.62;
    const k = Math.sin((Math.PI * t) / 2);
    a = base.a + (rim.a - base.a) * k;
    b = base.b + (rim.b - base.b) * k;
    y = rimHeight(u) * k;
  } else {
    // 屋盖段：从檐口收进开口内环，中部略起拱
    const w = (v - 0.62) / 0.38;
    a = rim.a + (opening.a - rim.a) * w;
    b = rim.b + (opening.b - rim.b) * w;
    y = rimHeight(u) + (openingHeight(u) - rimHeight(u)) * w + 1.5 * Math.sin(Math.PI * w);
  }

  const g = 1 + lift / rim.a;
  return out.set(a * g * Math.cos(u), y, b * g * Math.sin(u));
}

/** 确定性伪随机：换一个种子就是另一张网，但同一个种子每次刷新都一样。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 沿一条曲线挤出矩形箱梁。
 * halfW 沿曲线法线（大致是切向），halfH 沿副法线（大致是径向厚度）。
 */
function girder(points, halfW, halfH, segs = 22) {
  const curve = new CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = new Float32Array((segs + 1) * 4 * 3);
  const idx = [];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const p = new Vector3();

  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, p);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let c = 0; c < 4; c++) {
      const [sn, sb] = corners[c];
      const k = (i * 4 + c) * 3;
      pos[k] = p.x + N.x * sn * halfW + B.x * sb * halfH;
      pos[k + 1] = p.y + N.y * sn * halfW + B.y * sb * halfH;
      pos[k + 2] = p.z + N.z * sn * halfW + B.z * sb * halfH;
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let c = 0; c < 4; c++) {
      const a0 = i * 4 + c;
      const b0 = i * 4 + ((c + 1) % 4);
      const c0 = (i + 1) * 4 + ((c + 1) % 4);
      const d0 = (i + 1) * 4 + c;
      idx.push(a0, b0, c0, a0, c0, d0);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 沿外壳某一等高线画一圈环梁。 */
function shellRing(v, halfW, halfH) {
  const pts = [];
  const n = 72;
  for (let i = 0; i <= n; i++) {
    pts.push(shellPoint((i / n) * Math.PI * 2, v));
  }
  return girder(pts, halfW, halfH, 96);
}

/**
 * 编织钢构。
 *
 * 关键在**乱**。早先我用两族方向相反、间隔均匀的构件去交叉，得到的是一张规整的席编，
 * 而参考图里的鸟巢是几百根走向各异的杆件互相穿插——有的近乎竖直、有的横着掠过顶面、
 * 有的只跨半程。规律感一出来就不像了。
 *
 * 所以这里改成：每根构件的起始方位、扭转量（含正负）、跨越的高度区间、以及贴在曲面上的
 * 深度层次，全部由一个**定种子**的伪随机数发生器给出——看着是乱的，但每次刷新都一样。
 */
function buildLattice() {
  const parts = [];
  const rnd = mulberry32(20080808); // 种子=开幕日期，图个乐

  const strand = (u0, twist, v0, v1, lift, w, h, segs = 18) => {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const v = v0 + (v1 - v0) * t;
      pts.push(shellPoint(u0 + twist * v, v, new Vector3(), lift));
    }
    return girder(pts, w, h, segs);
  };

  // 主构件：跨越整个外壳，扭转量与方向都随机
  for (let k = 0; k < SHELL.primary; k++) {
    const u0 = rnd() * Math.PI * 2;
    const dir = rnd() < 0.5 ? -1 : 1;
    const twist = dir * (0.35 + rnd() * 1.25);
    const v0 = rnd() * 0.12;
    const v1 = 0.86 + rnd() * 0.14;
    const lift = (rnd() - 0.5) * 5;
    parts.push(strand(u0, twist, v0, v1, lift, 0.6, 0.6)); // 真机主次构件统一 1.2 m 见方
  }

  // 次级短构件：只跨一段，把网眼填密，也是真实结构里的次结构
  for (let k = 0; k < SHELL.secondary; k++) {
    const u0 = rnd() * Math.PI * 2;
    const dir = rnd() < 0.5 ? -1 : 1;
    const twist = dir * (0.15 + rnd() * 1.6);
    const v0 = rnd() * 0.55;
    const v1 = Math.min(1, v0 + 0.3 + rnd() * 0.45);
    const lift = (rnd() - 0.5) * 7;
    parts.push(strand(u0, twist, v0, v1, lift, 0.5, 0.5, 12));
  }

  // 立面上那些近乎竖直、还会分叉的柱子——参考图里很显眼
  for (let k = 0; k < 26; k++) {
    const u0 = (k / 26) * Math.PI * 2 + rnd() * 0.05;
    parts.push(strand(u0, 0.1 * (rnd() - 0.5), 0, 0.55, 3, 0.6, 0.6, 10));
    // 分叉：到半高处岔出两根
    parts.push(strand(u0, 0.22, 0.5, 0.9, 2, 0.45, 0.45, 8));
    parts.push(strand(u0, -0.22, 0.5, 0.9, 2, 0.45, 0.45, 8));
  }

  // 檐口环梁与几道环向系杆
  for (const [v, w, h] of [[1.0, 0.9, 1.5], [0.8, 0.5, 0.9], [0.62, 0.7, 1.2], [0.3, 0.5, 0.9]]) {
    const pts = [];
    const n = 84;
    for (let i = 0; i <= n; i++) pts.push(shellPoint((i / n) * Math.PI * 2, v, new Vector3(), 1.2));
    parts.push(girder(pts, w, h, 108));
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());

  const mat = new MeshStandardMaterial({
    // 参考图里钢构是中性灰、偏亮（白膜衬着才显出网），不是深色
    color: 0x8a8d93,
    roughness: 0.55,
    metalness: 0.45,
    emissive: 0x14181f,
  });
  const mesh = new Mesh(merged, mat);
  mesh.name = 'lattice';
  return mesh;
}

/**
 * 屋顶那层半透明膜（真机是 ETFE）。它挂在檐口和立面之间，
 * 会被光束扫到时透出一片柔光——这是鸟巢夜景里最好看的一部分。
 * depthWrite 关掉，免得它把穿过去的光束遮没。
 */
function buildMembrane() {
  const uSegs = 84;
  const vSegs = 10;
  const v0 = 0.63; // 屋盖段：檐口到开口内环
  const pos = new Float32Array((uSegs + 1) * (vSegs + 1) * 3);
  const idx = [];
  const p = new Vector3();

  for (let j = 0; j <= vSegs; j++) {
    const v = v0 + (1 - v0) * (j / vSegs);
    for (let i = 0; i <= uSegs; i++) {
      shellPoint((i / uSegs) * Math.PI * 2, v, p);
      const k = (j * (uSegs + 1) + i) * 3;
      // 稍稍缩进钢构里侧，免得和构件打架出 z-fighting
      pos[k] = p.x * 0.99;
      pos[k + 1] = p.y - 1.5; // 沉在钢构底下，让钢构在膜上投出剪影
      pos[k + 2] = p.z * 0.99;
    }
  }
  for (let j = 0; j < vSegs; j++) {
    for (let i = 0; i < uSegs; i++) {
      const a = j * (uSegs + 1) + i;
      const b = a + 1;
      const c = a + uSegs + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({
      // 参考图里屋顶是一整片白膜，不是若有若无的薄纱。这里提到 0.42：
      // 既能读出"这是个有顶的场馆"，又还能让光束透过去射向夜空——
      // 做成全不透明虽然更真实，但会把本项目最好看的一幕挡掉。
      color: 0xdfe4ea,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.42,
      side: DoubleSide,
      depthWrite: false,
    })
  );
  mesh.name = 'membrane';
  mesh.renderOrder = 2;
  return mesh;
}

/** 场馆外的地坪：让建筑有个落脚的地方，不然它像浮在虚空里。 */
function buildPlaza() {
  const geo = new RingGeometry(0.001, 1, 128, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({ color: 0x0c0f15, roughness: 1, metalness: 0 })
  );
  mesh.scale.set(SHELL.a + 70, 1, SHELL.b + 70);
  mesh.position.y = -0.05;
  mesh.name = 'plaza';
  return mesh;
}

/** 舞台台面 + 一圈发光沿边。 */
function buildStage() {
  const group = new Group();
  const { stageWidth: w, stageDepth: d, stageHeight: h } = VENUE;

  const deck = new Mesh(
    new BoxGeometry(w, h, d),
    new MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.42, metalness: 0.55 })
  );
  deck.position.y = h / 2;
  group.add(deck);

  // 台沿灯带：一圈细细的加色矩形，勾出舞台轮廓
  const edge = new Mesh(
    new BoxGeometry(w + 0.28, 0.1, d + 0.28),
    new MeshBasicMaterial({ color: 0x2f6fff, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false })
  );
  edge.position.y = h - 0.06;
  edge.renderOrder = 3;
  group.add(edge);

  // 场地：标准 400 m 田径场。内场是 105×68 的足球场，外圈跑道外廓 176.9×92.5。
  // 演唱会时内场铺保护层做站席，这里用深色表示。
  const infield = new Mesh(
    new RingGeometry(0, 1, 96, 1),
    new MeshStandardMaterial({ color: 0x0d1016, roughness: 1, metalness: 0 })
  );
  infield.rotation.x = -Math.PI / 2;
  infield.scale.set(FIELD.trackIn.a, FIELD.trackIn.b, 1);
  infield.position.y = 0.002;

  const track = new Mesh(
    new RingGeometry(0.001, 1, 128, 1),
    new MeshStandardMaterial({ color: 0x5c2a22, roughness: 0.95, metalness: 0 })
  );
  track.rotation.x = -Math.PI / 2;
  track.scale.set(FIELD.trackOut.a, FIELD.trackOut.b, 1);
  track.position.y = 0.001;

  // 跑道到看台之间的缓冲区
  const apron = new Mesh(
    new RingGeometry(0.001, 1, 128, 1),
    new MeshStandardMaterial({ color: 0x14171d, roughness: 1, metalness: 0 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.scale.set(BOWL.inner.a, BOWL.inner.b, 1);
  apron.position.y = 0.0005;

  group.add(apron, track, infield);

  group.name = 'stage';
  return group;
}

/**
 * 场馆里任一点的"站立高度"——平面图上点哪儿就把人放到哪儿。
 * 看台是椭圆环、一级一级的台阶，所以直接问 seating 模块要标高。
 * @returns {number} 眼睛的高度（米）
 */
export function eyeHeightAt(x, z) {
  const onStage =
    Math.abs(x) < STAGE.width / 2 + 0.6 && Math.abs(z) < STAGE.depth / 2 + 0.6;
  if (onStage) return STAGE.height + 1.65;

  const g = groundHeightAt(x, z);
  return g + (g > 0.5 ? 1.25 : 1.65); // 坐在看台上 vs 站在内场
}

/** 建整个场馆，返回可加进 scene 的 Group 与需要逐帧更新的部件。 */
export function buildVenue({ seatDensity = 1 } = {}) {
  const group = new Group();
  group.name = 'venue';

  const { group: bowlGroup, mesh: bowl } = buildBowlStructure();
  const seats = new SeatField(seatDensity);
  bowlGroup.add(seats.mesh);
  const crowd = buildCrowd();
  const lattice = buildLattice();
  const membrane = buildMembrane();
  const plaza = buildPlaza();
  const stage = buildStage();

  group.add(bowlGroup, crowd, lattice, membrane, plaza, stage);

  // 环境光：只用两盏不投影的灯把体量勾出来，成本可以忽略
  // 三盏不投影的灯，只为把体量勾出来，成本可忽略。
  // 演唱会现场的灯具确实是黑的，但它们能被满场的杂散光照到轮廓——
  // 一点环境光都不给的话，凑近看只剩一团辉光，机身完全是黑的。
  const hemi = new HemisphereLight(0x44598a, 0x131722, 3.3);
  const key = new DirectionalLight(0x8fa8d8, 1.15);
  key.position.set(20, 40, 25);
  const bounce = new DirectionalLight(0x4a6a92, 0.45); // 台面反上来的一点冷光
  bounce.position.set(-6, -10, 4);
  group.add(hemi, key, bounce);

  return { group, crowd, bowl, bowlGroup, seats, lattice, membrane, stage };
}
