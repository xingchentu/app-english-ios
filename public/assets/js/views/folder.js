/* 文件页：服务器目录只读浏览（目录点击进入，文件直接打开） */
import { api } from '../api.js';
import { esc, toast, setTopbar, ICONS, fmtSize, fmtTime } from '../shell.js';
import { renderMarkdown } from '../md.js';
import { resolveUrl } from '../config.js';

const rawUrl = (path) => resolveUrl('/api/fs/raw?path=' + encodeURIComponent(path));
const rawUrlDl = (path) => resolveUrl('/api/fs/raw?path=' + encodeURIComponent(path) + '&download=1');

const state = {
  el: null,
  root: '',
  path: '',
  entries: [],
  filter: '',
  cache: new Map(),
  viewer: null,
  showingMd: false,
};

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.css', '.scss', '.less', '.html', '.vue', '.sh', '.py', '.go', '.java', '.c', '.cpp', '.rs', '.php', '.rb', '.yml', '.yaml', '.toml', '.xml', '.sql', '.gradle']);
const DOC_EXT = new Set(['.md', '.txt', '.pdf', '.doc', '.docx', '.log', '.csv', '.ini', '.conf', '.env']);
const MEDIA_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.mp3', '.wav', '.m4a', '.flac']);

function kindOf(e) {
  if (e.type === 'dir') return 'dir';
  const ext = (e.ext || '').toLowerCase();
  if (IMG_EXT.has(ext)) return 'img';
  if (CODE_EXT.has(ext)) return 'code';
  if (DOC_EXT.has(ext)) return 'doc';
  if (MEDIA_EXT.has(ext)) return 'media';
  return 'file';
}

const ICON_LETTER = { dir: '', img: '🖼', code: '{ }', doc: 'DOC', media: '▶', file: '···' };

function build() {
  const el = document.createElement('section');
  el.className = 'page';
  el.innerHTML = `
    <div class="card tight">
      <div class="row">
        <button class="icon-btn" id="fs-up" title="上一级">${ICONS.up}</button>
        <button class="icon-btn" id="fs-home" title="根目录">${ICONS.home}</button>
        <button class="icon-btn" id="fs-refresh" title="刷新">${ICONS.refresh}</button>
        <input class="input grow" id="fs-search" placeholder="搜索当前目录…" />
      </div>
      <div class="path-crumbs" id="fs-crumbs" style="margin-top:10px"></div>
      <div class="chips-scroll" id="fs-quick"></div>
    </div>
    <div class="fs-list" id="fs-list"></div>
  `;
  state.el = el;

  el.querySelector('#fs-up').addEventListener('click', () => {
    if (!state.parent) return toast('已在根目录', '', 1200);
    go(state.parent);
  });
  el.querySelector('#fs-home').addEventListener('click', () => go(state.root));
  el.querySelector('#fs-refresh').addEventListener('click', () => {
    state.cache.delete(state.path);
    go(state.path);
    toast('已刷新', 'ok', 1200);
  });
  el.querySelector('#fs-search').addEventListener('input', (e) => {
    state.filter = e.target.value.trim().toLowerCase();
    renderList();
  });

  el.querySelector('#fs-crumbs').addEventListener('click', (e) => {
    const c = e.target.closest('.crumb');
    if (c) go(c.dataset.path);
  });
  el.querySelector('#fs-quick').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) go(c.dataset.path);
  });
  el.querySelector('#fs-list').addEventListener('click', (e) => {
    const row = e.target.closest('.fs-row');
    if (!row) return;
    const p = row.dataset.path;
    const t = row.dataset.type;
    if (t === 'dir') go(p);
    else openFile(p);
  });

  return el;
}

async function go(path) {
  const target = path || state.root || '';
  try {
    const data = await api.get('/api/fs/list?path=' + encodeURIComponent(target));
    state.root = data.root;
    state.path = data.path;
    state.parent = data.parent;
    state.crumbs = data.breadcrumb || [];
    state.entries = data.entries || [];
    state.cache.set(data.path, state.entries);
    state.filter = '';
    const input = state.el.querySelector('#fs-search');
    if (input) input.value = '';
    renderCrumbs();
    renderQuick();
    renderList();
    syncHash();
  } catch (e) {
    toast(e.message || '打开失败', 'err');
  }
}

function syncHash() {
  const next = `#/folder?p=${encodeURIComponent(state.path)}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

function renderCrumbs() {
  const box = state.el.querySelector('#fs-crumbs');
  box.innerHTML = (state.crumbs || [])
    .map((c) => `<button class="crumb ${c.path === state.path ? 'active' : ''}" data-path="${esc(c.path)}">${esc(c.name)}</button>`)
    .join('');
}

function renderQuick() {
  const root = state.root || '/root';
  const quick = [
    { name: '根目录', path: root },
    { name: 'project', path: root + '/project' },
    { name: 'test', path: root + '/project/test' },
    { name: '本应用', path: root + '/project/20260928/app' },
    { name: 'English 数据', path: root + '/project/20260928/app/data/english' },
  ];
  const box = state.el.querySelector('#fs-quick');
  box.innerHTML = quick
    .map((q) => `<button class="chip ${q.path === state.path ? 'active' : ''}" data-path="${esc(q.path)}">${esc(q.name)}</button>`)
    .join('');
}

function renderList() {
  const box = state.el.querySelector('#fs-list');
  const list = state.entries.filter(
    (e) => !state.filter || e.name.toLowerCase().includes(state.filter)
  );
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="big">📂</div><div>${state.filter ? '没有匹配的文件' : '空目录'}</div></div>`;
    return;
  }
  box.innerHTML = list
    .map((e) => {
      const kind = kindOf(e);
      const icon = kind === 'dir' ? ICONS.folder : ICON_LETTER[kind] || '···';
      const meta = e.type === 'dir'
        ? '文件夹'
        : `${fmtSize(e.size)} · ${fmtTime(e.mtime)}`;
      return `
        <button class="fs-row" data-path="${esc(e.path)}" data-type="${e.type}">
          <div class="fs-icon ${kind}">${icon}</div>
          <div class="grow" style="min-width:0">
            <div class="fs-name">${esc(e.name)}</div>
            <div class="fs-meta">${meta}</div>
          </div>
          <div class="chev">${e.type === 'dir' ? ICONS.chevron : ICONS.external}</div>
        </button>`;
    })
    .join('');
}

/* ---------------- 文件查看器 ---------------- */
async function openFile(path) {
  try {
    const info = await api.get('/api/fs/read?path=' + encodeURIComponent(path));
    showViewer(info, path);
  } catch (e) {
    toast(e.message || '打开失败', 'err');
  }
}

function showViewer(info, path) {
  closeViewer();
  const ext = (info.ext || '').toLowerCase();
  const isImg = IMG_EXT.has(ext);
  const isMd = ext === '.md' || ext === '.markdown';
  state.showingMd = isMd;

  const ov = document.createElement('div');
  ov.className = 'viewer';
  ov.innerHTML = `
    <header>
      <button class="icon-btn" id="v-close">${ICONS.close}</button>
      <div class="grow" style="min-width:0">
        <div class="ellipsis" style="font-weight:600;font-size:14px">${esc(info.name)}</div>
        <div class="tiny muted ellipsis">${esc(path)} · ${fmtSize(info.size)}</div>
      </div>
      ${isMd ? `<button class="icon-btn" id="v-md" title="切换渲染">${ICONS.spark}</button>` : ''}
      <a class="icon-btn" href="${rawUrl(path)}" target="_blank" rel="noopener" title="新窗口打开">${ICONS.external}</a>
      <a class="icon-btn" href="${rawUrlDl(path)}" title="下载">${ICONS.download}</a>
    </header>
    <div class="body" id="v-body"></div>
  `;
  document.body.appendChild(ov);
  state.viewer = ov;

  const body = ov.querySelector('#v-body');
  if (isImg) {
    body.innerHTML = `<div class="center"><img src="${rawUrl(path)}" alt="${esc(info.name)}"/></div>`;
  } else if (MEDIA_EXT.has(ext)) {
    body.innerHTML = `<div class="center"><video src="${rawUrl(path)}" controls style="max-width:100%"></video></div>`;
  } else if (info.isText) {
    body.innerHTML = isMd
      ? `<div class="md-body">${renderMarkdown(info.content)}</div>`
      : `<pre>${esc(info.content)}</pre>`;
    if (info.truncated) {
      const tip = document.createElement('div');
      tip.className = 'tiny muted center';
      tip.style.marginTop = '10px';
      tip.textContent = '（文件过大，仅显示前 300KB）';
      body.appendChild(tip);
    }
  } else {
    body.innerHTML = `<div class="empty"><div class="big">📄</div>
      <div>该文件类型暂不支持在线预览</div>
      <div style="margin-top:12px"><a class="btn primary" href="${rawUrl(path)}" target="_blank" rel="noopener">${ICONS.external} 打开 / 下载</a></div></div>`;
  }

  ov.querySelector('#v-close').addEventListener('click', closeViewer);
  const mdBtn = ov.querySelector('#v-md');
  if (mdBtn) {
    mdBtn.addEventListener('click', () => {
      state.showingMd = !state.showingMd;
      body.innerHTML = state.showingMd
        ? `<div class="md-body">${renderMarkdown(info.content)}</div>`
        : `<pre>${esc(info.content)}</pre>`;
    });
  }
}

function closeViewer() {
  if (state.viewer) {
    state.viewer.remove();
    state.viewer = null;
  }
}

export default {
  async mount(root, ctx) {
    if (!state.el) build();
    root.innerHTML = '';
    root.appendChild(state.el);
    setTopbar({
      title: '文件',
      sub: state.path || '服务器目录',
      menu: null,
      action: { icon: ICONS.home, title: '回到根目录', onClick: () => go(state.root || '') },
    });

    const want = ctx.query.p || state.path || '';
    if (want && want === state.path && state.entries.length) {
      renderList();
      return;
    }
    if (want) return go(want);
    try {
      const data = await api.get('/api/fs/list');
      return go(data.path);
    } catch (e) {
      toast(e.message, 'err');
    }
  },
  unmount() {
    closeViewer();
  },
};
