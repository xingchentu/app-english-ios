'use strict';
/**
 * L_Agent Server
 * - 静态托管 public/（SPA）
 * - /api/chat   : 调用 Claude Code CLI（cwd = ~/project/test）流式对话
 * - /api/fs     : 服务器目录只读浏览
 * - /api/english: 30 天英语学习资料（计划 / 资料）
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');

const store = require('./lib/store');
const claude = require('./lib/claude');
const files = require('./lib/files');
const english = require('./lib/english');

const app = express();
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* 跨域：App（Capacitor WebView）从 https://localhost 跨域访问本服务器，
   需要 CORS 头；同时放行 OPTIONS 预检（JSON 请求为非简单请求）。 */
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

/* ------------------------------------------------------------------ */
/* 聊天：会话存储                                                       */
/* ------------------------------------------------------------------ */
const CHAT_FILE = store.dataPath('chat', 'conversations.json');
const running = new Map(); // conversationId -> cancel()

function loadChat() {
  return store.readJson(CHAT_FILE, { conversations: [] });
}
function saveChat(data) {
  return store.writeJson(CHAT_FILE, data);
}
function findConv(id) {
  return loadChat().conversations.find((c) => c.id === id) || null;
}
function patchConv(id, patch) {
  return store.updateJson(CHAT_FILE, { conversations: [] }, (data) => {
    const idx = data.conversations.findIndex((c) => c.id === id);
    if (idx >= 0) Object.assign(data.conversations[idx], patch);
    return data;
  });
}

/* ------------------------------------------------------------------ */
/* 聊天 API                                                            */
/* ------------------------------------------------------------------ */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: 'L_Agent',
    time: new Date().toISOString(),
    claudeBin: claude.CLAUDE_BIN,
    claudeCwd: claude.DEFAULT_CWD,
    fsRoot: files.ROOT,
    host: os.hostname(),
  });
});

app.get('/api/chat/conversations', (req, res) => {
  const data = loadChat();
  const list = data.conversations
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
      messageCount: (c.messages || []).length,
      preview: (c.messages || []).filter((m) => m.role === 'user').slice(-1)[0]?.content?.slice(0, 60) || '',
      running: running.has(c.id),
    }));
  res.json({ conversations: list });
});

app.post('/api/chat/conversations', (req, res) => {
  const data = loadChat();
  const conv = {
    id: randomUUID(),
    title: (req.body && req.body.title) || '新的对话',
    sessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  data.conversations.unshift(conv);
  saveChat(data);
  res.json({ conversation: conv });
});

app.get('/api/chat/conversations/:id', (req, res) => {
  const conv = findConv(req.params.id);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  res.json({ conversation: conv });
});

app.patch('/api/chat/conversations/:id', (req, res) => {
  const conv = findConv(req.params.id);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  const data = patchConv(req.params.id, {
    title: req.body.title || conv.title,
    updatedAt: Date.now(),
  });
  res.json({ conversation: data.conversations.find((c) => c.id === req.params.id) });
});

app.delete('/api/chat/conversations/:id', (req, res) => {
  const data = store.updateJson(CHAT_FILE, { conversations: [] }, (d) => ({
    conversations: d.conversations.filter((c) => c.id !== req.params.id),
  }));
  res.json({ ok: true, conversations: data.conversations.length });
});

/**
 * 流式对话：POST /api/chat/stream
 * body: { conversationId, message }
 * 返回 text/event-stream 风格的事件流
 */
app.post('/api/chat/stream', async (req, res) => {
  const { conversationId, message } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: '消息不能为空' });
  }
  if (!conversationId) return res.status(400).json({ error: '缺少 conversationId' });

  const conv = findConv(conversationId);
  if (!conv) return res.status(404).json({ error: '会话不存在' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  const send = (evt) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  // 记录用户消息
  store.updateJson(CHAT_FILE, { conversations: [] }, (data) => {
    const c = data.conversations.find((x) => x.id === conversationId);
    if (c) {
      c.messages.push({ role: 'user', content: message, ts: Date.now() });
      if (c.messages.filter((m) => m.role === 'user').length === 1) {
        c.title = message.trim().slice(0, 24);
      }
      c.updatedAt = Date.now();
    }
    return data;
  });

  let full = '';
  let sessionId = conv.sessionId;

  const handle = claude.runChat({
    prompt: message,
    resume: conv.sessionId || null,
    onEvent: (evt) => {
      if (evt.type === 'delta') full += evt.text;
      if (evt.type === 'tool') evt.name = evt.name || 'tool';
      send(evt);
    },
  });

  running.set(conversationId, handle.cancel);
  // 只在客户端断开（响应被关闭且未正常结束）时才终止 Claude
  res.on('close', () => {
    if (res.writableFinished) return;
    const cancel = running.get(conversationId);
    if (cancel) {
      cancel();
      running.delete(conversationId);
    }
  });

  try {
    const result = await handle.promise;
    running.delete(conversationId);
    if (result && result.sessionId) sessionId = result.sessionId;

    const finalText = (full || '').trim();
    store.updateJson(CHAT_FILE, { conversations: [] }, (data) => {
      const c = data.conversations.find((x) => x.id === conversationId);
      if (c) {
        c.sessionId = sessionId || c.sessionId;
        c.updatedAt = Date.now();
        if (finalText) {
          c.messages.push({ role: 'assistant', content: finalText, ts: Date.now() });
        }
      }
      return data;
    });
    send({ type: 'done', sessionId, text: finalText });
  } catch (err) {
    running.delete(conversationId);
    send({ type: 'error', message: err && err.message ? err.message : '请求失败' });
  }
  try {
    res.end();
  } catch (e) {}
});

app.post('/api/chat/stop', (req, res) => {
  const { conversationId } = req.body || {};
  const cancel = running.get(conversationId);
  if (cancel) {
    cancel();
    running.delete(conversationId);
    return res.json({ ok: true, stopped: true });
  }
  res.json({ ok: true, stopped: false });
});

/* ------------------------------------------------------------------ */
/* 文件浏览 API（只读）                                                 */
/* ------------------------------------------------------------------ */
app.get('/api/fs/list', (req, res) => {
  try {
    const target = req.query.path || files.ROOT;
    res.json(files.listDir(target));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/fs/read', (req, res) => {
  try {
    const abs = files.safeResolve(req.query.path || '');
    res.json(files.readFile(abs));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/fs/raw', (req, res) => {
  try {
    const abs = files.safeResolve(req.query.path || '');
    const st = fs.statSync(abs);
    if (st.isDirectory()) return res.status(400).json({ error: '这是一个目录' });
    const ext = path.extname(abs).toLowerCase();
    res.setHeader('Content-Type', files.MIME[ext] || 'application/octet-stream');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`);
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ------------------------------------------------------------------ */
/* 英语学习 API                                                        */
/* ------------------------------------------------------------------ */
app.get('/api/english/index', (req, res) => {
  res.json(english.getIndex());
});

app.get('/api/english/day/:day', async (req, res) => {
  const day = parseInt(req.params.day, 10);
  if (!day || day < 1 || day > english.TOTAL_DAYS) {
    return res.status(400).json({ error: '天数不合法' });
  }
  let data = english.getDay(day);
  if (!data) {
    data = english.seedDay(day);
    english.saveDay(day, data);
  }
  // 若配置了 YOUTUBE_API_KEY，把搜索链接解析为真实视频直链（并写回文件，避免重复消耗配额）
  try {
    const changed = await english.resolveDayVideos(data);
    if (changed) english.saveDay(day, data);
  } catch (e) {
    /* 解析失败不影响正常返回，链接保持原样 */
  }
  const progress = english.getProgress();
  res.json({
    day: data,
    progress: {
      tasks: (progress.tasks || {})[String(day)] || {},
      words: (progress.words || {})[String(day)] || {},
    },
  });
});

/** 生成某天资料（SSE 进度流） */
app.post('/api/english/day/:day/generate', async (req, res) => {
  const day = parseInt(req.params.day, 10);
  if (!day || day < 1 || day > english.TOTAL_DAYS) {
    return res.status(400).json({ error: '天数不合法' });
  }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  const send = (evt) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  let last = 0;
  const ticker = setInterval(() => {
    const secs = Math.round((Date.now() - last) / 1000);
    send({ type: 'progress', stage: 'running', message: `Claude 正在产出内容…（已用 ${secs}s）` });
  }, 10000);
  last = Date.now();

  try {
    send({ type: 'progress', stage: 'start', message: `开始生成 Day ${day} 资料…` });
    const data = await english.generateDay(day, {
      onProgress: (p) => send({ type: 'progress', stage: p.stage, message: p.message }),
    });
    clearInterval(ticker);
    send({ type: 'done', day: data });
  } catch (e) {
    clearInterval(ticker);
    send({ type: 'error', message: e.message || '生成失败' });
  }
  try {
    res.end();
  } catch (e) {}
});

/* 客户端配置：把 YouTube API Key 下发到前端（前端用自己的网络把搜索链接解析为真实视频直链，
   因为部分部署环境的服务器本身连不到 Google）。Key 仅存于运行环境/本地配置文件，不进代码仓库。 */
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');
function getServerConfig() {
  let f = {};
  try {
    f = JSON.parse(require('fs').readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    /* ignore */
  }
  return { youtubeApiKey: process.env.YOUTUBE_API_KEY || f.youtubeApiKey || '' };
}
app.get('/api/config', (req, res) => res.json(getServerConfig()));
app.post('/api/english/progress/task', (req, res) => {
  const { day, index, done } = req.body || {};
  english.setTask(day, index, !!done);
  res.json({ ok: true });
});

app.post('/api/english/progress/word', (req, res) => {
  const { day, word, mastered } = req.body || {};
  english.setWord(day, word, !!mastered);
  res.json({ ok: true });
});

app.get('/api/english/cycle', (req, res) => {
  res.json(english.getCycle());
});

app.post('/api/english/cycle', (req, res) => {
  const startDate = req.body && req.body.startDate;
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  }
  res.json(english.setCycle({ startDate }));
});

/* ------------------------------------------------------------------ */
/* SPA 回退：所有非 API 的 GET 都返回 index.html                        */
/* ------------------------------------------------------------------ */
const SPA_ROUTES = ['/', '/chat', '/folder', '/english', '/english/plan', '/english/study'];
SPA_ROUTES.forEach((r) => {
  app.get(r, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
});
app.get(/^\/(chat|folder|english)(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[L_Agent] server running: http://0.0.0.0:${PORT}`);
  console.log(`[L_Agent] claude cwd: ${claude.ensureCwd(claude.DEFAULT_CWD)}`);
  console.log(`[L_Agent] fs root   : ${files.ROOT}`);
});
