/**
 * 参数面板：做成灯光台的"编码轮"（encoder）那一套。
 *
 * 真控台上没有滑块，只有一排旋钮：一行一个参数，左边术语、右边一个大号等宽数字，
 * 转旋钮改值。这里把整行做成横向拖拽区来模拟旋钮，同时把原生 range 透明地压在行上——
 * 指针交互走我们自己的逻辑，键盘和读屏交给浏览器原生，两边都不牺牲。
 *
 * 行左端那条 3px 的组色竖条只在"值≠本章默认"时点亮。灯光师管这叫 programmer 层：
 * 一眼看出自己动过哪些参数、哪些还是原样。
 */

const GROUP_VAR = {
  灯阵: 'var(--grp-rig)',
  运动: 'var(--grp-move)',
  氛围: 'var(--grp-air)',
  证据图层: 'var(--grp-proof)',
};

function decimals(step) {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

function fmt(v, step) {
  return Number(v).toFixed(decimals(step));
}

/**
 * 造一行 encoder。同一个 item 可以造多份（参数栏一份、底部编码条一份），
 * 它们共享 state，靠 sync() 互相回读，所以改任何一处另一处立刻跟上。
 */
function createEncoder(item, state, onChange, getDefault) {
  const row = document.createElement('label');
  row.className = 'enc';
  row.style.setProperty('--grp', GROUP_VAR[item.group] || 'var(--acc-live)');

  const top = document.createElement('div');
  top.className = 'enc-top';

  const label = document.createElement('span');
  label.className = 'enc-label';
  label.textContent = item.label;

  const en = document.createElement('span');
  en.className = 'enc-en';
  en.textContent = item.en || '';

  const val = document.createElement('span');
  val.className = 'enc-val';

  top.append(label, en, val);

  const track = document.createElement('div');
  track.className = 'enc-track';
  const fill = document.createElement('div');
  fill.className = 'enc-fill';
  track.appendChild(fill);

  const native = document.createElement('input');
  native.className = 'enc-native';
  native.type = 'range';
  native.min = item.min;
  native.max = item.max;
  native.step = item.step;
  native.setAttribute('aria-label', `${item.label}${item.unit || ''}`);

  row.append(top, track, native);

  const span = item.max - item.min;

  const paint = () => {
    const v = state[item.key];
    val.innerHTML = `${fmt(v, item.step)}<span class="enc-unit">${item.unit || ''}</span>`;
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, (v - item.min) / span))})`;
    native.value = v;
    const def = getDefault(item.key);
    row.classList.toggle('is-dirty', def !== undefined && Math.abs(v - def) > 1e-9);
  };

  const commit = (v) => {
    const stepped = Math.round(v / item.step) * item.step;
    const clamped = Math.min(item.max, Math.max(item.min, stepped));
    if (clamped === state[item.key]) return;
    state[item.key] = clamped;
    paint();
    onChange(item.key);
  };

  native.addEventListener('input', () => commit(parseFloat(native.value)));

  /*
   * 指针拖拽：整行横向拖 360px 走完全程；按住 Shift 精调到 1/10。
   *
   * 触屏上这件事和"抽屉要能纵向滚"直接冲突，早先版本两处都做错了：
   *
   *   1. `.enc-native` 是一个 opacity:0 铺满整行的原生 range，触屏事件先落在它身上，
   *      而原生 range 的默认行为是**点哪儿就跳到哪儿的值**——所以在参数抽屉里
   *      随便点一下（比如想停住惯性滚动），那一行的参数就被改掉了，
   *      点在行右侧甚至会直接跳到接近最大值。实测「灯数量」单击一次 48→83。
   *   2. 本行的 pointerdown 一进来就 `dragging = true`，于是竖滑只要带一点横向分量，
   *      pointermove 立刻开始改值。浏览器要过一会儿才判定成滚动并发 pointercancel，
   *      但值早就动了。实测横 40px / 竖 200px 的斜滑：抽屉滚了，值也被改了。
   *
   * 现在：原生 range 交出指针（`pointer-events: none`，见 styles.css），
   * 全部指针输入由本行接管；触屏先进入 pending，**等手势自己证明是横向的**才接管。
   * 一旦先越过纵向阈值就永久判给滚动，本次手势再横move 也不改值——
   * 宁可少改一次，也不要在滑动列表时误改参数。
   */
  const SLOP = 10; // 判定方向前允许的自由移动（px）
  let mode = null; // null | 'pending'（触屏待判定）| 'drag' | 'scroll'（本次手势已让给滚动）
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let acc = 0;

  const beginDrag = (e) => {
    mode = 'drag';
    lastX = e.clientX; // 从判定那一刻算起，别把 slop 那段也折进值里
    acc = state[item.key];
    row.classList.add('is-active');
    row.setPointerCapture(e.pointerId);
  };

  row.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    if (e.pointerType === 'mouse') {
      // 鼠标没有"拖着滚动"这回事，不存在歧义，直接进入拖拽
      beginDrag(e);
      native.focus({ preventScroll: true }); // 点完能接着用方向键微调
      e.preventDefault(); // 免得拖出一片文字选区
    } else {
      mode = 'pending';
      lastX = e.clientX;
      acc = state[item.key];
    }
  });

  row.addEventListener('pointermove', (e) => {
    if (mode === 'pending') {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ay > SLOP && ay >= ax) {
        mode = 'scroll'; // 纵向先越线 → 这一下是滚动，本次手势不再改值
      } else if (ax > SLOP && ax > ay) {
        beginDrag(e);
      }
      return;
    }
    if (mode !== 'drag') return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    acc += (dx / 360) * span * (e.shiftKey ? 0.1 : 1);
    commit(acc);
  });

  const end = (e) => {
    if (mode === null) return;
    const wasDrag = mode === 'drag';
    mode = null;
    if (!wasDrag) return; // pending 状态松手 = 只是点了一下，什么都不该发生
    row.classList.remove('is-active');
    if (e.pointerId !== undefined && row.hasPointerCapture?.(e.pointerId)) {
      row.releasePointerCapture(e.pointerId);
    }
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);

  // 双击回到本章默认值——调乱了随时能回来
  row.addEventListener('dblclick', () => {
    const def = getDefault(item.key);
    if (def !== undefined) commit(def);
  });

  row.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      commit(state[item.key] - Math.sign(e.deltaY) * item.step * (e.shiftKey ? 1 : 5));
    },
    { passive: false }
  );

  return { el: row, sync: paint, key: item.key };
}

function createToggle(item, state, onChange) {
  const row = document.createElement('label');
  row.className = 'enc enc--toggle';
  row.style.setProperty('--grp', GROUP_VAR[item.group] || 'var(--acc-live)');

  const input = document.createElement('input');
  input.type = 'checkbox';

  const boxEl = document.createElement('span');
  boxEl.className = 'toggle-box';

  const top = document.createElement('div');
  top.className = 'enc-top';
  const label = document.createElement('span');
  label.className = 'enc-label';
  label.textContent = item.label;
  const en = document.createElement('span');
  en.className = 'enc-en';
  en.textContent = item.en || '';
  top.append(label, en);

  row.append(input, boxEl, top);

  const paint = () => {
    input.checked = !!state[item.key];
  };
  input.addEventListener('change', () => {
    state[item.key] = input.checked;
    onChange(item.key);
  });

  return { el: row, sync: paint, key: item.key };
}

function createSelect(item, state, onChange) {
  const row = document.createElement('label');
  row.className = 'enc enc--select';
  row.style.setProperty('--grp', GROUP_VAR[item.group] || 'var(--acc-live)');

  const top = document.createElement('div');
  top.className = 'enc-top';
  const label = document.createElement('span');
  label.className = 'enc-label';
  label.textContent = item.label;
  const en = document.createElement('span');
  en.className = 'enc-en';
  en.textContent = item.en || '';
  top.append(label, en);

  const select = document.createElement('select');
  for (const opt of item.options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    state[item.key] = select.value;
    onChange(item.key);
  });

  row.append(top, select);

  return { el: row, sync: () => (select.value = state[item.key]), key: item.key };
}

/**
 * @param {HTMLElement} root 参数栏容器
 * @param {object} state
 * @param {(key:string)=>void} onChange
 * @param {object} opts
 * @param {Array} opts.controls 控件表
 * @param {()=>object} opts.getDefaults 取"本章默认值"，用于 dirty 标记与双击复位
 */
export function buildPanel(root, state, onChange, { controls, getDefaults }) {
  root.innerHTML = '';
  const rows = [];
  const byKey = new Map();
  const getDefault = (key) => getDefaults()[key];

  const make = (item) => {
    if (item.type === 'toggle') return createToggle(item, state, onChange);
    if (item.type === 'select') return createSelect(item, state, onChange);
    return createEncoder(item, state, onChange, getDefault);
  };

  for (const group of controls) {
    const section = document.createElement('section');
    section.className = 'panel-group';
    section.style.setProperty('--grp', GROUP_VAR[group.group] || 'var(--fg-ghost)');

    const heading = document.createElement('h3');
    heading.append(document.createTextNode(group.group));
    const en = document.createElement('span');
    en.className = 'rail-head-en';
    en.textContent = group.en || '';
    const count = document.createElement('span');
    count.className = 'group-count';
    heading.append(en, count);
    section.appendChild(heading);

    const groupRows = [];
    for (const item of group.items) {
      const row = make({ ...item, group: group.group });
      section.appendChild(row.el);
      rows.push(row);
      groupRows.push(row);
      if (!byKey.has(item.key)) byKey.set(item.key, []);
      byKey.get(item.key).push(row);
    }

    // 组头右侧那个 "3/7"：本组有几项被改过
    group._paintCount = () => {
      const defs = getDefaults();
      const dirty = groupRows.filter((r) => {
        const d = defs[r.key];
        return d !== undefined && typeof state[r.key] === 'number' && Math.abs(state[r.key] - d) > 1e-9;
      }).length;
      count.textContent = dirty ? `${dirty}/${groupRows.length}` : '';
    };

    root.appendChild(section);
  }

  const sync = () => {
    for (const r of rows) r.sync();
    for (const g of controls) g._paintCount?.();
  };

  /** 老陆点到某个参数时让它闪一下，比在文字里写"看右边第三行"有效得多。 */
  const flash = (key) => {
    for (const r of byKey.get(key) || []) {
      r.el.classList.remove('is-flash');
      void r.el.offsetWidth; // 强制回流以重启动画
      r.el.classList.add('is-flash');
    }
  };

  /** 把指定参数额外挂一份到底部编码条上。 */
  const mountEncoders = (container, keys, controlsFlat) => {
    container.innerHTML = '';
    for (const key of keys) {
      const item = controlsFlat.find((i) => i.key === key);
      if (!item) continue;
      const row = make(item);
      container.appendChild(row.el);
      rows.push(row);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row);
    }
    sync();
  };

  sync();
  return { sync, flash, mountEncoders };
}
