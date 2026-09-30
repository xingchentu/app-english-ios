/* 聊天页：与 Claude Code CLI 对话（纯对话，不注入任何预设 prompt） */
import { api } from '../api.js';
import { esc, toast, setTopbar, ICONS, copyText } from '../shell.js';
import { renderMarkdown, renderPlain } from '../md.js';

const state = {
  el: null,
  conversations: [],
  current: null,
  messages: [],
  streaming: false,
  controller: null,
  raw: '',
};

function build() {
  const el = document.createElement('section');
  el.className = 'chat-wrap';
  el.innerHTML = `
    <div id="chat-messages"></div>
    <div class="composer">
      <textarea id="chat-input" rows="1" placeholder="发消息给 Claude…"></textarea>
      <button class="send-btn" id="chat-send" title="发送">${ICONS.send}</button>
    </div>
  `;
  state.el = el;

  const input = el.querySelector('#chat-input');
  const sendBtn = el.querySelector('#chat-send');

  sendBtn.addEventListener('click', () => {
    if (state.streaming) return stopStream();
    send();
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (state.streaming) return;
      send();
    }
  });

  el.querySelector('#chat-messages').addEventListener('click', (e) => {
    const cp = e.target.closest('.copy-code');
    if (cp) {
      copyText(decodeURIComponent(cp.dataset.code || ''));
      return;
    }
  });

  return el;
}

/* ---------------- 会话列表 ---------------- */
async function loadConversations() {
  try {
    const data = await api.get('/api/chat/conversations');
    state.conversations = data.conversations || [];
  } catch (e) {
    state.conversations = [];
  }
}

async function ensureConversation() {
  if (state.current) return state.current;
  if (state.conversations.length) {
    await selectConversation(state.conversations[0].id);
    return state.current;
  }
  const data = await api.post('/api/chat/conversations', { title: '新的对话' });
  state.current = data.conversation;
  state.messages = [];
  await loadConversations();
  renderMessages();
  updateTopbar();
  return state.current;
}

async function newConversation() {
  if (state.streaming) stopStream();
  const data = await api.post('/api/chat/conversations', { title: '新的对话' });
  state.current = data.conversation;
  state.messages = [];
  await loadConversations();
  renderMessages();
  updateTopbar();
  toast('已创建新对话', 'ok', 1500);
}

async function selectConversation(id) {
  if (state.streaming && state.current && state.current.id !== id) stopStream();
  try {
    const data = await api.get('/api/chat/conversations/' + id);
    state.current = data.conversation;
    state.messages = state.current.messages || [];
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  renderMessages();
  updateTopbar();
}

async function removeConversation(id) {
  try {
    await api.del('/api/chat/conversations/' + id);
    if (state.current && state.current.id === id) state.current = null;
    await loadConversations();
    renderDrawer();
    if (!state.current) await ensureConversation();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------------- 渲染 ---------------- */
function msgNode(m) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai');
  const avatar = m.role === 'user' ? '我' : 'L';
  wrap.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="bubble">${m.role === 'user' ? renderPlain(m.content) : renderMarkdown(m.content)}</div>
  `;
  return wrap;
}

function renderMessages() {
  const box = state.el.querySelector('#chat-messages');
  box.innerHTML = '';
  if (!state.messages.length) {
    const hero = document.createElement('div');
    hero.className = 'chat-hero';
    hero.innerHTML = `
      <div class="ring">L</div>
      <div style="font-size:15px;color:var(--text);font-weight:600">L_Agent</div>
      <div class="small">直接输入内容即可开始对话<br/>由 Claude Code 驱动 · 工作目录 ~/project/test</div>
    `;
    box.appendChild(hero);
    return;
  }
  state.messages.forEach((m) => box.appendChild(msgNode(m)));
  box.scrollTop = box.scrollHeight;
}

function updateTopbar() {
  setTopbar({
    title: (state.current && state.current.title) || 'L_Agent',
    sub: state.streaming ? 'Claude 正在回复…' : 'Claude 对话',
    menu: { onClick: openDrawer },
    action: { icon: ICONS.plus, title: '新对话', onClick: newConversation },
  });
}

/* ---------------- 发送 ---------------- */
async function send() {
  const input = state.el.querySelector('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  await ensureConversation();

  input.value = '';
  input.style.height = 'auto';

  const box = state.el.querySelector('#chat-messages');
  box.querySelector('.chat-hero')?.remove();

  const userMsg = { role: 'user', content: text };
  state.messages.push(userMsg);
  box.appendChild(msgNode(userMsg));

  // AI 气泡（占位）
  const aiWrap = document.createElement('div');
  aiWrap.className = 'msg ai';
  aiWrap.innerHTML = `<div class="avatar">L</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  box.appendChild(aiWrap);
  const bubble = aiWrap.querySelector('.bubble');
  box.scrollTop = box.scrollHeight;

  state.raw = '';
  state.streaming = true;
  state.controller = new AbortController();
  updateTopbar();
  setSendIcon(true);

  let painted = 0;
  const paint = (force) => {
    const now = Date.now();
    if (!force && now - painted < 90) return;
    painted = now;
    const md = renderMarkdown(state.raw);
    bubble.innerHTML = md || '<span class="muted small">（未收到回复，请重试）</span>';
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  };

  try {
    await api.stream(
      '/api/chat/stream',
      { conversationId: state.current.id, message: text },
      (evt) => {
        if (evt.type === 'delta') {
          state.raw += evt.text;
          paint();
        } else if (evt.type === 'tool') {
          const tip = document.createElement('div');
          tip.className = 'tiny muted';
          tip.style.marginBottom = '6px';
          tip.textContent = `⚙ 使用工具：${evt.name}`;
          bubble.parentElement.insertBefore(tip, bubble.nextSibling);
        } else if (evt.type === 'error') {
          state.raw += `\n\n> ⚠ ${evt.message}`;
          paint(true);
        } else if (evt.type === 'done') {
          paint(true);
        }
      },
      state.controller.signal
    );
  } catch (e) {
    if (e.name !== 'AbortError') {
      bubble.innerHTML = renderMarkdown(state.raw) + `<p style="color:#ef4444">⚠ ${esc(e.message)}</p>`;
    }
  }

  state.streaming = false;
  state.controller = null;
  setSendIcon(false);
  paint(true);

  const finalText = state.raw.trim();
  if (finalText) {
    state.messages.push({ role: 'assistant', content: finalText, ts: Date.now() });
    const conv = state.conversations.find((c) => c.id === state.current.id);
    if (conv && !conv.title) conv.title = text.slice(0, 20);
  }
  updateTopbar();
  box.scrollTop = box.scrollHeight;
}

function stopStream() {
  if (state.controller) state.controller.abort();
  api.post('/api/chat/stop', { conversationId: state.current && state.current.id }).catch(() => {});
  state.streaming = false;
  setSendIcon(false);
  updateTopbar();
}

function setSendIcon(streaming) {
  const btn = state.el.querySelector('#chat-send');
  if (!btn) return;
  btn.innerHTML = streaming ? ICONS.stop : ICONS.send;
  btn.title = streaming ? '停止' : '发送';
}

/* ---------------- 抽屉 ---------------- */
let drawer = null;
function openDrawer() {
  closeDrawer();
  const mask = document.createElement('div');
  mask.className = 'drawer-mask';
  mask.addEventListener('click', closeDrawer);

  const d = document.createElement('aside');
  d.className = 'drawer';
  d.innerHTML = `
    <header>
      <div style="font-weight:700">会话列表</div>
      <button class="icon-btn" id="drawer-close">${ICONS.close}</button>
    </header>
    <div class="list" id="drawer-list"></div>
    <div style="padding:10px">
      <button class="btn primary block" id="drawer-new">${ICONS.plus} 新对话</button>
    </div>
  `;
  d.querySelector('#drawer-close').addEventListener('click', closeDrawer);
  d.querySelector('#drawer-new').addEventListener('click', () => { closeDrawer(); newConversation(); });
  d.querySelector('#drawer-list').addEventListener('click', (e) => {
    const del = e.target.closest('.conv-del');
    if (del) {
      e.stopPropagation();
      removeConversation(del.dataset.id);
      return;
    }
    const item = e.target.closest('.conv-item');
    if (item) {
      closeDrawer();
      selectConversation(item.dataset.id);
    }
  });
  document.body.appendChild(mask);
  document.body.appendChild(d);
  drawer = { mask, d };
  renderDrawer();
}

function closeDrawer() {
  if (drawer) {
    drawer.mask.remove();
    drawer.d.remove();
    drawer = null;
  }
}

function renderDrawer() {
  if (!drawer) return;
  const list = drawer.d.querySelector('#drawer-list');
  if (!state.conversations.length) {
    list.innerHTML = '<div class="empty small">暂无会话</div>';
    return;
  }
  list.innerHTML = state.conversations
    .map((c) => `
      <div class="conv-item ${state.current && state.current.id === c.id ? 'active' : ''}" data-id="${c.id}">
        <div class="grow" style="min-width:0">
          <div class="ellipsis" style="font-size:13.5px">${esc(c.title || '新的对话')}</div>
          <div class="tiny muted ellipsis">${esc(c.preview || '暂无消息')}</div>
        </div>
        <button class="icon-btn conv-del" data-id="${c.id}" style="width:28px;height:28px;border-radius:9px">${ICONS.trash}</button>
      </div>`)
    .join('');
}

/* ---------------- 挂载 ---------------- */
export default {
  async mount(root, ctx) {
    if (!state.el) build();
    root.innerHTML = '';
    root.appendChild(state.el);
    setSendIcon(state.streaming);
    updateTopbar();
    try {
      await loadConversations();
      await ensureConversation();
      renderDrawer();
    } catch (e) {
      toast('加载会话失败：' + e.message, 'err');
    }
  },
  unmount() {
    closeDrawer();
  },
};
