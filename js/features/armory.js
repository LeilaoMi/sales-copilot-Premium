/* ============================================================
 * 销冠助手 · 实战军火库（可选增强）
 *
 * 定位：话术库（48 条种子 + 自己攒的）之外的第三层弹药——
 *   一份随站点部署的静态知识库文件（kb/knowledge.json），
 *   体量可以比话术库大一到两个数量级，检索引擎直接复用
 *   Playbook 的意图词典 + bigram + IDF 那一套，不另写算法。
 *
 * 为什么是静态文件而不是塞进 localStorage：
 *   话术库几十条放 localStorage 没问题，知识库上千条
 *   轻松突破 localStorage 的 5MB 上限。静态文件走 HTTP 缓存，
 *   不占本地存储，更新随部署走。
 *
 * 为什么懒加载：话术库页首屏不该为一个可选项多拉几百 KB。
 *   用户点「加载军火库」才 fetch，之后内存缓存。
 *
 * 为什么单文件版没有它：fetch 相对路径在 file:// 下被浏览器
 *   禁掉，加载失败会明说，不会白屏 —— 单文件版的核心价值
 *   是「双击就能记跟进」，军火库本来就只是增强。
 *
 * 条目是「能直接用的话 + 为什么这么说的知识」，不是方法论长文。
 * 数据质量声明：条目由 AI 辅助整理生成，用前自己过一遍脑子，
 *   不确定的说法（金额、案例）以你自己客户和产品的实际情况为准。
 * ============================================================ */
window.Armory = (function () {
  'use strict';

  let items = null;      // null = 未加载；[] = 加载了但为空
  let loading = false;
  let err = '';
  let q = '';            // 当前搜索词（重绘时保留）

  /* 和 playbook.js 同款的 djb2 稳定 id —— 同标题永远同 id，
   * 方便「存入话术库」时做重复判断 */
  function stableId(title) {
    let h = 5381;
    title = String(title || '');
    for (let i = 0; i < title.length; i++) {
      h = ((h << 5) - h + title.charCodeAt(i)) | 0;
    }
    return 'kb-' + (h >>> 0).toString(36);
  }

  /* ---------- 加载 ---------- */
  function load() {
    if (items || loading) return;
    loading = true; err = '';
    render();
    fetch('kb/knowledge.json')
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        const list = Array.isArray(data && data.items) ? data.items : [];
        items = list.map(x => ({
          id: x.id || stableId(x.title),
          category: x.category || '实战知识',
          title: String(x.title || ''),
          tags: Array.isArray(x.tags) ? x.tags : [],
          content: String(x.content || ''),
          /* builtin: true + updatedAt: 0 —— 让 Playbook.featOf 的缓存
           * 一次算好永久用，检索几千条也不卡 */
          builtin: true,
          source: 'armory',
          updatedAt: 0
        }));
        loading = false;
        render();
      })
      .catch(e => {
        loading = false;
        err = '加载失败：' + e.message
          + '。部署版（Vercel / Pages）才有军火库数据；单文件版没有这个功能，不影响其他使用。';
        render();
      });
  }

  function ready() { return !!(items && items.length); }

  function search(query) {
    if (!ready() || !window.Playbook || !window.Playbook.search) return [];
    return window.Playbook.search(items, query, { limit: 12 });
  }

  /* ---------- 存入个人话术库 ----------
   * 军火库是只读资料库，看中哪条复制走，变成自己的再改 ——
   * 和「一万条别人的话术不如自己攒的二十条」同一个逻辑。 */
  function saveToScripts(id) {
    const S = window.Store;
    if (!S || !ready()) return;
    const it = items.find(x => x.id === id);
    if (!it) return;
    const dup = S.list('scripts').find(s => s.title === it.title);
    if (dup) { toast('话术库已有同名条目：「' + it.title + '」', 'err'); return; }
    S.insert('scripts', {
      category: it.category, title: it.title, tags: (it.tags || []).slice(),
      content: it.content, source: 'user', updatedAt: Date.now()
    });
    toast('已存入话术库，去「我的」分类里改成本行业的话', 'ok');
  }

  /* ---------- 渲染 ---------- */
  const E = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function head() {
    if (loading) return '<span class="card-sub">加载中…</span>';
    if (err) return '<span class="card-sub" style="color:var(--red)">加载失败</span>';
    if (!ready()) return '<span class="card-sub">未加载</span>';
    const cats = {};
    items.forEach(x => { cats[x.category] = (cats[x.category] || 0) + 1; });
    return '<span class="card-sub">' + items.length + ' 条 · ' + Object.keys(cats).length + ' 类</span>';
  }

  function resultHtml(list) {
    if (!q.trim()) {
      const cats = {};
      items.forEach(x => { cats[x.category] = (cats[x.category] || 0) + 1; });
      return '<div class="dg-hint">输入客户原话或场景搜索，比如「嫌贵」「要招标」「老供应商」。</div>'
        + '<div class="toolbar">' + Object.keys(cats).map(c =>
          '<button class="btn btn-sm" data-kb-act="kb-qcat" data-q="' + E(c) + '">' + E(c) + ' ' + cats[c] + '</button>'
        ).join('') + '</div>';
    }
    if (!list.length) return emptyBox('军火库里没有命中的条目，试试换个说法');
    return list.map(({ s, score, why }) => `
      <div class="dg-item kb-hit">
        <div class="dg-h">${E(s.title)}
          <span class="chip">${E(s.category)}</span>
          ${why ? '<span class="dg-sub">' + E(why) + '</span>' : ''}
        </div>
        <pre class="kb-content">${E(s.content)}</pre>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn btn-sm" data-kb-act="kb-copy" data-id="${E(s.id)}">复制全文</button>
          <button class="btn btn-sm" data-kb-act="kb-save" data-id="${E(s.id)}">存入我的话术库</button>
        </div>
      </div>`).join('');
  }

  function inner() {
    return `
    <div class="card-head">
      <div class="card-title">实战军火库（云）${head()}</div>
      <div class="spacer"></div>
      ${ready() ? '' : (loading ? '' : '<button class="btn btn-sm" data-kb-act="kb-load">加载军火库</button>')}
    </div>
    ${err ? `<div class="dg-hint warn">${E(err)}</div>` : ''}
    ${ready() ? `
      <div class="pb-search">
        <input id="kb-q" type="search" placeholder="搜军火库：客户原话 / 场景 / 关键词" value="${E(q)}" autocomplete="off">
        ${q ? '<button class="pb-clear" data-kb-act="kb-clear" title="清空">×</button>' : ''}
      </div>
      <div id="kb-results">${resultHtml(search(q))}</div>` : ''}`;
  }

  function render() {
    const el = document.getElementById('kb-box');
    if (!el) return;
    el.innerHTML = inner();
    const input = el.querySelector('#kb-q');
    if (input) {
      input.addEventListener('input', function () {
        q = this.value;
        const out = el.querySelector('#kb-results');
        if (out) out.innerHTML = resultHtml(search(q));
        /* 只重绘结果区，不整卡重绘 —— 搜索框失焦问题同话术库 */
        const clear = el.querySelector('.pb-clear');
        if (clear) clear.remove();
        if (q) {
          const btn = document.createElement('button');
          btn.className = 'pb-clear'; btn.title = '清空'; btn.textContent = '×';
          btn.setAttribute('data-kb-act', 'kb-clear');
          input.after(btn);
        }
      });
    }
  }

  function emptyBox(msg) {
    return '<div class="empty">' + E(msg) + '</div>';
  }

  function toast(msg, type) {
    if (window.UI && window.UI.toast) { window.UI.toast(msg, type); return; }
    /* ui.js 没暴露 toast 时的兜底：页面上现挂一个，两秒后消失。
     * 正常情况下走不到这里 —— 放着是为了单测环境不炸 */
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);'
      + 'background:#1e293b;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;z-index:9999';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  /* ---------- 事件：卡片内委托，不进 ui.js 的 data-action 分发 ----------
   * 军火库的交互全部自管（同 sparring.js 的先例），
   * ui.js 不需要知道这个模块存在。 */
  document.addEventListener('click', function (ev) {
    const el = ev.target.closest('[data-kb-act]');
    if (!el) return;
    const act = el.getAttribute('data-kb-act');
    if (act === 'kb-load') { load(); return; }
    if (act === 'kb-clear') {
      q = ''; render();
      const input = document.querySelector('#kb-box #kb-q');
      if (input) input.focus();
      return;
    }
    if (act === 'kb-qcat') {
      q = el.getAttribute('data-q') || ''; render();
      /* 整卡重绘后输入框是新的，把焦点还回去——用户点分类通常
       * 是想接着搜，焦点丢了就得再点一次输入框 */
      const inp = document.querySelector('#kb-box #kb-q');
      if (inp) { inp.focus(); if (inp.setSelectionRange) try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} }
      return;
    }
    if (act === 'kb-copy') {
      const it = (items || []).find(x => x.id === el.getAttribute('data-id'));
      if (!it) return;
      const text = it.title + '\n\n' + it.content;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => toast('已复制全文', 'ok'),
          () => toast('复制失败，手动选择文本复制', 'err')
        );
      }
      return;
    }
    if (act === 'kb-save') { saveToScripts(el.getAttribute('data-id')); return; }
  });

  document.addEventListener('DOMContentLoaded', render);

  return { box: inner, render: render, load: load, search: search, ready: ready, stableId: stableId };
})();
