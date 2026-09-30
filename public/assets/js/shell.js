/* 通用工具：toast / 顶栏控制 / 格式化 / 图标 */

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toast(msg, type = '', ms = 2400) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ---------------- 顶栏 ---------------- */
const topbar = {
  titleEl: () => document.getElementById('topbar-title'),
  subEl: () => document.getElementById('topbar-sub'),
  actionEl: () => document.getElementById('btn-action'),
  menuEl: () => document.getElementById('btn-menu'),
};

let actionHandler = null;
let menuHandler = null;

document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('#btn-action') && actionHandler) actionHandler();
  if (e.target.closest && e.target.closest('#btn-menu') && menuHandler) menuHandler();
});

export function setTopbar(opts = {}) {
  const { title, sub, action, menu } = opts;
  const t = topbar.titleEl(); const s = topbar.subEl();
  const a = topbar.actionEl(); const m = topbar.menuEl();
  if (title != null && t) t.textContent = title;
  if (sub != null && s) s.textContent = sub;
  if (action) {
    actionHandler = action.onClick || null;
    if (a) { a.style.display = 'inline-grid'; a.innerHTML = action.icon || ICONS.plus; a.title = action.title || ''; }
  } else {
    actionHandler = null;
    if (a) a.style.display = 'none';
  }
  if (menu) {
    menuHandler = menu.onClick || null;
    if (m) m.style.display = 'inline-grid';
  } else {
    menuHandler = null;
    if (m) m.style.display = 'none';
  }
}

/* ---------------- 主题 ---------------- */
export function initTheme() {
  const saved = localStorage.getItem('la-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', saved === 'light' ? '#eef1f8' : '#0d0f16');
}

export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('la-theme', next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#eef1f8' : '#0d0f16');
  return next;
}

/* ---------------- 格式化 ---------------- */
export function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDateCn(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dt.getDay()];
  return `${Number(m)}月${Number(d)}日 ${week}`;
}

/* ---------------- 图标 ---------------- */
const svg = (inner, w = 1.8) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  send: svg('<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  download: svg('<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 21h16"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>'),
  play: svg('<path d="M6 4l14 8-14 8V4z"/>'),
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  check: svg('<path d="M4 12.5 9 17.5 20 6.5"/>', 2.4),
};

/* ---------------- 复制 ---------------- */
export function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
      toast('已复制', 'ok', 1400);
      return;
    }
  } catch (e) { /* fallthrough */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('已复制', 'ok', 1400); } catch (e) { toast('复制失败', 'err'); }
  ta.remove();
}
