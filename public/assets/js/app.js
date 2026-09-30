/* 应用入口：Hash 路由（#/chat、#/folder、#/english/plan、#/english/study） */
import { initTheme, toggleTheme, setTopbar } from './shell.js';
import { needsServerConfig } from './config.js';
import { openSettings } from './settings.js';
import chatView from './views/chat.js';
import folderView from './views/folder.js';
import englishView from './views/english.js';

initTheme();

const root = document.getElementById('view');

const ROUTES = {
  '/chat': { view: chatView, nav: '/chat' },
  '/folder': { view: folderView, nav: '/folder' },
  '/english/plan': { view: englishView, nav: '/english' },
  '/english/study': { view: englishView, nav: '/english' },
};

let current = null;

function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '') || '/chat';
  const [pathRaw, queryRaw] = raw.split('?');
  let path = pathRaw || '/chat';
  if (!path.startsWith('/')) path = '/' + path;
  const query = {};
  (queryRaw || '').split('&').forEach((kv) => {
    if (!kv) return;
    const [k, v] = kv.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  });
  return { path, query };
}

function normalize(path) {
  if (path === '/' || path === '') return '/chat';
  if (path === '/english' || path === '/english/') return '/english/plan';
  if (ROUTES[path]) return path;
  if (path.startsWith('/english')) return '/english/plan';
  return '/chat';
}

async function route() {
  const { path, query } = parseHash();
  const next = normalize(path);
  if (next !== path) {
    location.replace('#' + next);
    return;
  }
  const routeDef = ROUTES[next];
  const view = routeDef.view;

  // 导航高亮
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.route === routeDef.nav);
  });

  if (current && current.view !== view && current.view.unmount) {
    try { current.view.unmount(); } catch (e) { /* noop */ }
  }
  current = { view, path: next };

  root.innerHTML = '';
  try {
    await view.mount(root, { path: next, query, setTopbar });
  } catch (e) {
    root.innerHTML = `<div class="page"><div class="card"><div class="empty">页面加载失败：${e.message}</div></div></div>`;
  }
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const r = btn.dataset.route;
    const target = r === '/english' ? '/english/plan' : r;
    if (location.hash !== '#' + target) location.hash = '#' + target;
    else route();
  });
});

document.getElementById('btn-theme').addEventListener('click', () => toggleTheme());

document.getElementById('btn-settings').addEventListener('click', () => {
  openSettings({ required: false });
});

window.addEventListener('hashchange', route);

async function boot() {
  // App 内（Capacitor 本地加载）首次需要配置服务器地址
  if (needsServerConfig()) {
    await openSettings({ required: true });
  }
  if (!location.hash) location.replace('#/chat');
  route();
}

boot();
