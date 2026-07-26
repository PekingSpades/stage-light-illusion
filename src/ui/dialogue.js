/**
 * 老陆——带你逐章看懂的灯光总监。
 *
 * 做成游戏 NPC 对话而不是一张说明卡片，是因为讲解本来就有顺序：
 * 一次只给一句，你按一下他再说下一句，注意力就跟着走。卡片则是一次糊上来五段，
 * 眼睛不知道该落在哪儿。
 *
 * 打字机的实现有个坑要避开：**别逐字往 DOM 里插节点**，那样每个字都触发一次重排，
 * 一段话下来上百次。这里整页一次性拆成 span 插好（visibility:hidden），
 * 之后只是逐个加 class 让它显形——布局只算一次，之后零重排。
 *
 * 节奏也不是均匀的：中文比拉丁字母慢一点，逗号后停一下，句号后停久一点。
 * 匀速吐字读起来像机器念稿；有停顿才像人在说话。
 */

const CJK = /[㐀-鿿豈-﫿]/;
const PAUSE = {
  '，': 140,
  '、': 140,
  '：': 180,
  '；': 180,
  '…': 180,
  '。': 260,
  '！': 260,
  '？': 260,
  '—': 120,
};

const BASE_CJK = 42;
const BASE_LATIN = 20;

export class Dialogue {
  /**
   * @param {object} refs DOM 引用
   * @param {(act:object)=>void} onAct 执行台词附带的动作（切机位 / 改参数 / 高亮某行）
   */
  constructor(refs, onAct) {
    this.el = refs.root;
    this.textEl = refs.text;
    this.liveEl = refs.live;
    this.progressEl = refs.progress;
    this.nextEl = refs.next;
    this.onAct = onAct;

    this.pages = [];
    this.index = 0;
    this.chars = [];
    this.revealed = 0;
    this.acc = 0;
    this.state = 'idle';
    this.auto = false;
    this.autoWait = 0;
    this.staleTimer = 0;

    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  _setState(s) {
    this.state = s;
    this.el.dataset.state = s;
    if (s !== 'finished') {
      this.el.classList.remove('is-stale');
      this.staleTimer = 0;
    }
  }

  /** 载入一章的台词。 */
  load(pages) {
    this.pages = pages && pages.length ? pages : [{ t: '' }];
    this.index = 0;
    this._play();
  }

  _play() {
    const page = this.pages[this.index];
    this.el.dataset.mood = page.mood || 'talk';
    this.progressEl.textContent = `${this.index + 1} / ${this.pages.length}`;

    // 先把 **强调** 拆出来，再逐字建 span；bold 段落包在 <b> 里
    const frag = document.createDocumentFragment();
    this.chars = [];
    const plain = page.t.replace(/\*\*/g, '');

    let bold = false;
    for (const chunk of page.t.split('**')) {
      const host = bold ? document.createElement('b') : frag;
      for (const ch of chunk) {
        const span = document.createElement('span');
        span.textContent = ch;
        host.appendChild(span);
        this.chars.push({ el: span, delay: this._delay(ch) });
      }
      if (bold) frag.appendChild(host);
      bold = !bold;
    }

    this.textEl.replaceChildren(frag);
    // 读屏一次性拿到整页，不跟着打字机逐字念
    this.liveEl.textContent = plain;

    this.revealed = 0;
    this.acc = 0;

    if (this.reduced) {
      this.skip();
    } else {
      this._setState('typing');
    }
  }

  _delay(ch) {
    if (ch === ' ' || ch === ' ') return 0;
    const base = CJK.test(ch) ? BASE_CJK : BASE_LATIN;
    return base + (PAUSE[ch] || 0);
  }

  /**
   * 由主循环驱动，不另开 rAF 也不用 setTimeout——
   * 页面冻结/切后台时它自然跟着停，不会攒出一堆待办。
   * @param {number} dt 秒
   */
  tick(dt) {
    const ms = Math.min(dt * 1000, 64);

    if (this.state === 'typing') {
      this.acc += ms;
      while (this.revealed < this.chars.length) {
        const c = this.chars[this.revealed];
        if (this.acc < c.delay) break;
        this.acc -= c.delay;
        c.el.classList.add('on');
        this.revealed++;
      }
      if (this.revealed >= this.chars.length) this._settle();
      return;
    }

    if (this.state === 'awaiting' && this.auto) {
      this.autoWait -= ms;
      if (this.autoWait <= 0) this.advance();
      return;
    }

    if (this.state === 'finished') {
      // 讲完一会儿就淡下去，把画面还给舞台
      this.staleTimer += ms;
      if (this.staleTimer > 20000) this.el.classList.add('is-stale');
    }
  }

  _settle() {
    const last = this.index >= this.pages.length - 1;
    this._setState(last ? 'finished' : 'awaiting');
    this.autoWait = 900 + 28 * this.chars.length;
  }

  /** 立刻出全文。 */
  skip() {
    for (let i = this.revealed; i < this.chars.length; i++) this.chars[i].el.classList.add('on');
    this.revealed = this.chars.length;
    this._settle();
  }

  /** 空格 / 点击对话框：正在打字就出全文，已经打完就翻下一页。 */
  advance() {
    if (this.state === 'typing') {
      this.skip();
      return true;
    }
    if (this.state === 'awaiting') {
      const act = this.pages[this.index].act;
      if (act) this.onAct(act);
      this.index++;
      this._play();
      return true;
    }
    return false; // finished：不消费按键，让空格落回"冻结"
  }

  setAuto(v) {
    this.auto = v;
    this.autoWait = 900;
  }
}

/**
 * 把一章的正文自动切成对话页。
 * 按句号断句贪心累积，一页不超过约 78 字——再长就不像说话了。
 */
export function paginate(chapter) {
  if (chapter.dialog) return chapter.dialog;

  const pages = [];
  for (const para of chapter.body) {
    const sentences = para.split(/(?<=[。！？])/).filter((s) => s.trim());
    let buf = '';
    for (const s of sentences) {
      if (buf && (buf + s).replace(/\*\*/g, '').length > 78) {
        pages.push({ t: buf, mood: 'talk' });
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf.trim()) pages.push({ t: buf, mood: 'talk' });
  }
  if (chapter.tip) pages.push({ t: chapter.tip, mood: 'point' });
  return pages.length ? pages : [{ t: chapter.title, mood: 'talk' }];
}
