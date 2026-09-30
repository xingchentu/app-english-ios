/* 后端接口封装 */
import { resolveUrl } from './config.js';

async function request(url, options = {}) {
  const res = await fetch(resolveUrl(url), options);
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      if (ct.includes('json')) {
        const j = await res.json();
        msg = j.error || msg;
      }
    } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  if (ct.includes('json')) return res.json();
  return res.text();
}

export const api = {
  get: (url) => request(url),
  post: (url, body) =>
    request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }),
  patch: (url, body) =>
    request(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }),
  del: (url) => request(url, { method: 'DELETE' }),

  /**
   * POST + SSE 流式读取
   * @returns {Promise<void>} 完成后 resolve
   */
  async stream(url, body, onEvent, signal) {
    const res = await fetch(resolveUrl(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal,
    });
    if (!res.ok) throw new Error(`请求失败 (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          onEvent(JSON.parse(raw));
        } catch (e) { /* ignore malformed */ }
      }
    }
    if (buf.trim()) {
      const line = buf.split('\n').find((l) => l.startsWith('data:'));
      if (line) {
        try { onEvent(JSON.parse(line.slice(5).trim())); } catch (e) {}
      }
    }
  },
};
