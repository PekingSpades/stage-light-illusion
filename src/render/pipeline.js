/**
 * 渲染管线：renderer / scene / camera / 后期合成。
 *
 * 色彩链路是这类"全黑背景 + 大量加色发光"的场景最容易翻车的地方，这里只走一条路：
 * 场景渲进 HDR 的离屏缓冲（线性空间）→ UnrealBloom 抽取高光并模糊 → OutputPass
 * 在最后**一次性**做色调映射与 sRGB 转换。
 *
 * three 在渲染到 render target 时会自动跳过材质里的色调映射（只有直接渲到屏幕才做），
 * 所以这里不会出现"映射两遍导致整体发灰"的经典问题——前提是 OutputPass 必须放在
 * 链条最后，且它之后不能再挂任何做色彩转换的 pass。
 */

import {
  ACESFilmicToneMapping,
  Color,
  FogExp2,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const BG = 0x05060a;

/**
 * 取景基准：16:9 的桌面画面 + 50° 竖直视角。
 *
 * PerspectiveCamera 的 fov 是**竖直**视角，水平视角由画幅推出来。桌面 16:9 下水平视角约 77°，
 * 同样一台相机搬到 390×844 的竖屏手机上，水平视角只剩 25°——24 米宽的舞台连一半都框不进去。
 * 这就是"手机上像被放大了"的真正原因：不是缩放做错了，是竖屏画幅本身把水平视野砍掉了 2/3。
 *
 * 修法是按画幅**反算竖直视角**，把水平视角尽量拉回基准值。竖屏要完全追平 16:9 需要
 * 3.85 倍的视野，那会得到鱼眼一样的画面，所以上限钳在 80°：手机上看得见完整舞台和整片光束，
 * 又不至于边缘扭曲。横屏比基准还宽时不做任何补偿。
 */
const REF_FOV = 50;
const REF_ASPECT = 16 / 9;
const MAX_FOV = 80;

function fovForAspect(aspect) {
  if (aspect >= REF_ASPECT) return REF_FOV;
  const half = Math.tan((REF_FOV * Math.PI) / 360) * (REF_ASPECT / aspect);
  const fov = (2 * Math.atan(half) * 180) / Math.PI;
  return Math.min(MAX_FOV, fov);
}

export function createPipeline(canvas) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(BG, 1);

  const scene = new Scene();
  scene.background = new Color(BG);
  // 雾色必须与背景同色，否则远处物体会淡出成另一种颜色，边界一眼可见
  // 雾密度必须跟着场馆尺度走。场馆从 116 m 放大到 333 m 之后，
  // 沿用 0.0075 会在 100 m 外就把一切糊成灰泥——"只改几何不改雾"的典型翻车。
  scene.fog = new FogExp2(BG, 0.0009);

  // 近平面取 0.5 而不是 0.1：深度缓冲的精度是按 far/near 的比值分配的，
  // near=0.1 时 50 米开外的分辨率只有几十厘米，一排排座椅会互相闪烁（z-fighting）。
  // 相机眼高 1.65 m，永远不会贴到比 0.5 m 更近的东西上，这一刀切得没有代价。
  const camera = new PerspectiveCamera(REF_FOV, 1, 1.0, 2000);
  camera.position.set(0, 13, 48);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.82, 0.55, 0.26);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const state = {
    renderer,
    scene,
    camera,
    composer,
    bloom,
    pixelRatioCap: 1.75,
    width: 1,
    height: 1,
  };

  /** 尺寸变化时有四处必须同步，漏掉任何一处都会出可见的错。 */
  state.resize = (width, height) => {
    state.width = width;
    state.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, state.pixelRatioCap);

    camera.aspect = width / height;
    camera.fov = fovForAspect(camera.aspect);
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    bloom.resolution.set(width, height);
  };

  /** 帧率不够时先砍分辨率——比砍灯数更不伤演示内容。 */
  state.setPixelRatioCap = (cap) => {
    if (Math.abs(cap - state.pixelRatioCap) < 0.01) return;
    state.pixelRatioCap = cap;
    state.resize(state.width, state.height);
  };

  return state;
}
