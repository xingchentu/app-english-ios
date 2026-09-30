/* 服务器地址设置弹窗：首次启动（App 内）或点击齿轮时打开。
   支持“测试连接”与保存，地址存 localStorage（见 config.js）。 */
import { getServerUrl, setServerUrl, resolveUrl, getYtKeyLocal, setYtKeyLocal } from './config.js';
import { toast, ICONS } from './shell.js';

function gearIcon() {
  return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />');
}
function svg(inner) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export function openSettings(opts = {}) {
  const required = !!opts.required;
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.style.cssText =
      'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.55);backdrop-filter:blur(2px);padding:18px';
    ov.innerHTML = `
      <div style="width:100%;max-width:420px;background:var(--card,#171a23);border:1px solid var(--border,#262b38);
                  border-radius:16px;padding:18px 18px 16px;box-shadow:0 18px 50px rgba(0,0,0,.45)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          ${gearIcon()}
          <h2 style="font-size:17px;margin:0">设置</h2>
        </div>
        <p style="color:var(--muted,#9aa3b2);font-size:13px;margin:0 0 12px;line-height:1.5">
          请输入运行 L_Agent 服务端的地址（手机与服务器需可互通）。<br/>
          例如：<code style="color:var(--accent,#6ea8fe)">http://192.168.1.50:8080</code> 或服务器的公网 IP。
        </p>
        <input id="sv-url" class="input" placeholder="http://IP:8080" style="width:100%;box-sizing:border-box"
               value="${getServerUrl().replace(/"/g, '&quot;')}" />
        <div id="sv-msg" style="font-size:12.5px;min-height:18px;margin:8px 0;color:var(--muted,#9aa3b2)"></div>
        <hr style="border:none;border-top:1px solid var(--border,#262b38);margin:14px 0" />
        <div style="font-size:13px;color:var(--fg,#e8ecf4);margin-bottom:6px;font-weight:600">YouTube API Key（可选）</div>
        <input id="sv-yt" class="input" placeholder="AIza..." style="width:100%;box-sizing:border-box"
               value="${(getYtKeyLocal() || '').replace(/"/g, '&quot;')}" />
        <div style="font-size:12px;color:var(--muted,#9aa3b2);margin-top:6px;line-height:1.5">
          用于把视频搜索链接解析为真实视频直链（点开直接看对应视频）。留空则使用服务器默认配置。
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button id="sv-test" class="btn" style="flex:1">测试连接</button>
          <button id="sv-save" class="btn primary" style="flex:1">${required ? '保存并进入' : '保存'}</button>
          ${required ? '' : '<button id="sv-cancel" class="btn" style="flex:1">取消</button>'}
        </div>
      </div>`;
    document.body.appendChild(ov);

    const urlEl = ov.querySelector('#sv-url');
    const ytEl = ov.querySelector('#sv-yt');
    const msgEl = ov.querySelector('#sv-msg');
    urlEl.focus();

    function close(saved) {
      ov.remove();
      resolve(!!saved);
    }

    ov.querySelector('#sv-test').addEventListener('click', async () => {
      const u = setServerUrl(urlEl.value);
      if (!u) { msgEl.textContent = '请先填写地址'; msgEl.style.color = 'var(--danger,#ff6b6b)'; return; }
      msgEl.style.color = 'var(--muted,#9aa3b2)';
      msgEl.textContent = '正在连接…';
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(resolveUrl('/api/health'), { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json().catch(() => ({}));
        msgEl.style.color = 'var(--ok,#4ade80)';
        msgEl.textContent = '✅ 连接成功' + (j.name ? '（' + j.name + '）' : '');
      } catch (e) {
        msgEl.style.color = 'var(--danger,#ff6b6b)';
        msgEl.textContent = '❌ 无法连接：' + (e && e.message ? e.message : '网络错误') + '（请检查 IP、端口、防火墙）';
      }
    });

    ov.querySelector('#sv-save').addEventListener('click', async () => {
      const u = setServerUrl(urlEl.value);
      if (!u) { msgEl.textContent = '请先填写地址'; msgEl.style.color = 'var(--danger,#ff6b6b)'; return; }
      const yt = setYtKeyLocal(ytEl.value);
      // 同步到服务器（服务端解析 / 其他端复用）；失败不影响本地使用
      try {
        await fetch(resolveUrl('/api/config'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ youtubeApiKey: yt }),
        });
      } catch {
        /* 服务器不可达时忽略，本地已保存 */
      }
      toast('已保存设置', 'ok');
      close(true);
    });

    const cancel = ov.querySelector('#sv-cancel');
    if (cancel) cancel.addEventListener('click', () => close(false));
  });
}

export const SETTINGS_ICON = gearIcon();
