/* 服务器地址配置：在 App（Capacitor WebView）里，页面是本地打包的，
   必须通过“绝对地址”访问远端服务器；在浏览器里由服务器直接托管时，
   相对地址即可（同源）。地址存 localStorage，运行时可改。 */

const KEY = 'lagent.serverUrl';

export function getServerUrl() {
  return (localStorage.getItem(KEY) || '').trim();
}

export function setServerUrl(raw) {
  let u = (raw || '').trim();
  if (!u) {
    localStorage.removeItem(KEY);
    return '';
  }
  if (!/^https?:\/\//.test(u)) u = 'http://' + u;
  u = u.replace(/\/+$/, '');
  localStorage.setItem(KEY, u);
  return u;
}

/* 是否需要用户配置服务器地址：
   - 已配置过 → 否
   - Capacitor 本地加载（capacitor: 协议，或 https + localhost）→ 是
   - 浏览器由服务器托管（同源）→ 否，直接用相对地址 */
export function needsServerConfig() {
  if (getServerUrl()) return false;
  if (location.protocol === 'capacitor:') return true;
  const host = location.hostname;
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (loopback && location.protocol === 'https:') return true;
  return false;
}

/* 把相对 API 路径拼接成绝对地址；浏览器模式返回原相对路径 */
export function resolveUrl(path) {
  const base = getServerUrl();
  if (!base) return path;
  if (/^https?:\/\//.test(path)) return path;
  return base + (path.startsWith('/') ? path : '/' + path);
}
