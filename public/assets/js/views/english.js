/* 英语学习助手 L_Agent：/english/plan（计划） 与 /english/study（资料） */
import { api } from '../api.js';
import { esc, toast, setTopbar, ICONS, fmtDateCn, copyText } from '../shell.js';

const state = {
  el: null,
  index: null,       // { cycle, today, days: [...] }
  day: 1,
  cache: new Map(),  // day -> { day: {...}, progress: {...} }
  tab: 'plan',
  vocabQuery: '',
  openWords: new Set(),
  openArts: new Set(),
  collapsed: new Set(),
  loading: false,
};

/* ---------------- 基础数据 ---------------- */
async function ensureIndex() {
  if (state.index && state.index.days && state.index.days.length) return state.index;
  state.index = await api.get('/api/english/index');
  if (!state.day) state.day = state.index.today || 1;
  return state.index;
}

async function loadDay(day, force) {
  if (!force && state.cache.has(day)) return state.cache.get(day);
  const data = await api.get('/api/english/day/' + day);
  state.cache.set(day, data);
  return data;
}

function cur() {
  return state.cache.get(state.day);
}

/* ---------------- 骨架 ---------------- */
function build() {
  const el = document.createElement('section');
  el.className = 'page';
  el.innerHTML = `
    <div class="daybar card">
      <div class="head">
        <button class="icon-btn" data-action="prev" title="上一天">${ICONS.left}</button>
        <div class="grow center">
          <div class="day-title" id="e-daytitle">Day 1</div>
        </div>
        <button class="icon-btn" data-action="next" title="下一天">${ICONS.right}</button>
        <button class="chip" data-action="today">今天</button>
      </div>
      <div class="row" style="margin:8px 0 6px">
        <input type="date" class="input" id="e-date" />
        <button class="btn sm" data-action="gen">${ICONS.spark} AI 资料</button>
      </div>
      <div class="chips-scroll" id="e-days"></div>
    </div>

    <div class="seg">
      <button data-tab="plan">计划</button>
      <button data-tab="study">资料</button>
    </div>

    <div id="e-body"></div>
  `;
  state.el = el;

  el.addEventListener('click', onClick);
  el.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'e-vocab-q') {
      state.vocabQuery = e.target.value || '';
      const box = el.querySelector('#e-vocab-list');
      const data = cur();
      if (box && data) {
        const q = state.vocabQuery.trim().toLowerCase();
        const words = (data.day.vocabulary || []).filter(
          (v) => !q || v.word.toLowerCase().includes(q) || (v.meaning_zh || '').includes(state.vocabQuery.trim())
        );
        box.innerHTML = renderVocab(words, data.progress || { tasks: {}, words: {} });
      }
    }
  });
  el.querySelector('#e-date').addEventListener('change', (e) => {
    if (!e.target.value || !state.index) return;
    const start = new Date(state.index.cycle.startDate + 'T00:00:00');
    const target = new Date(e.target.value + 'T00:00:00');
    const diff = Math.floor((target - start) / 86400000) + 1;
    if (diff < 1 || diff > 30) {
      toast('该日期不在 30 天周期内', 'err');
      e.target.value = cur() ? cur().day.date : '';
      return;
    }
    setDay(diff);
  });

  return el;
}

async function setDay(day) {
  day = Math.min(Math.max(parseInt(day, 10) || 1, 1), 30);
  state.day = day;
  state.openWords.clear();
  state.openArts.clear();
  try {
    await loadDay(day);
  } catch (e) {
    toast(e.message, 'err');
  }
  render();
}

/* ---------------- 交互 ---------------- */
async function onClick(e) {
  const tabBtn = e.target.closest('.seg button');
  if (tabBtn) {
    const t = tabBtn.dataset.tab;
    location.hash = '#/english/' + t;
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) {
    // 折叠区标题
    const sec = e.target.closest('.sec-head');
    if (sec) {
      const key = sec.dataset.sec;
      if (state.collapsed.has(key)) state.collapsed.delete(key);
      else state.collapsed.add(key);
      const node = state.el.querySelector(`.sec[data-sec="${key}"]`);
      if (node) node.classList.toggle('collapsed', state.collapsed.has(key));
    }
    return;
  }

  const action = el.dataset.action;
  const data = cur();

  switch (action) {
    case 'prev':
      setDay(state.day - 1);
      break;
    case 'next':
      setDay(state.day + 1);
      break;
    case 'today':
      setDay(state.index ? state.index.today : 1);
      break;
    case 'day':
      setDay(el.dataset.day);
      break;
    case 'gen':
      generate();
      break;
    case 'task': {
      const idx = el.dataset.index;
      const done = !el.classList.contains('done');
      el.classList.toggle('done', done);
      const box = el.querySelector('.box');
      if (box) box.innerHTML = done ? ICONS.check : '';
      updateProgress();
      api.post('/api/english/progress/task', { day: state.day, index: idx, done }).catch(() => {});
      break;
    }
    case 'word': {
      const w = el.dataset.word;
      if (state.openWords.has(w)) state.openWords.delete(w);
      else state.openWords.add(w);
      el.classList.toggle('open', state.openWords.has(w));
      break;
    }
    case 'star': {
      e.stopPropagation();
      const w = el.dataset.word;
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      api.post('/api/english/progress/word', { day: state.day, word: w, mastered: on }).catch(() => {});
      break;
    }
    case 'art': {
      const i = el.dataset.i;
      if (state.openArts.has(i)) state.openArts.delete(i);
      else state.openArts.add(i);
      const node = state.el.querySelector(`.art-item[data-i="${i}"]`);
      if (node) node.classList.toggle('open', state.openArts.has(i));
      break;
    }
    case 'vid': {
      window.open(el.dataset.url, '_blank', 'noopener');
      break;
    }
    case 'copy': {
      e.stopPropagation();
      copyText(decodeURIComponent(el.dataset.text || ''));
      break;
    }
    case 'to-study':
      location.hash = '#/english/study';
      break;
    case 'to-plan':
      location.hash = '#/english/plan';
      break;
    default:
      break;
  }
  void data;
}

function updateProgress() {
  const data = cur();
  if (!data) return;
  const total = (data.day.tasks || []).length;
  const done = state.el.querySelectorAll('.task.done').length;
  const bar = state.el.querySelector('#e-prog > i');
  const label = state.el.querySelector('#e-prog-label');
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = `${done}/${total} 已完成`;
}

/* ---------------- 渲染 ---------------- */
function render() {
  const data = cur();
  const idx = state.index;
  renderDayBar();
  state.el.querySelectorAll('.seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === state.tab);
  });
  const body = state.el.querySelector('#e-body');
  if (!data) {
    body.innerHTML = '<div class="card"><div class="skeleton" style="height:120px"></div></div>';
    return;
  }
  body.innerHTML = state.tab === 'plan' ? renderPlan(data, idx) : renderStudy(data);
  updateProgress();
}

function renderDayBar() {
  const data = cur();
  const idx = state.index;
  const title = state.el.querySelector('#e-daytitle');
  const dateStr = data ? data.day.date : idx && idx.days ? idx.days[state.day - 1].date : '';
  title.innerHTML = `Day ${state.day}<span>${fmtDateCn(dateStr)}</span>`;
  const dateInput = state.el.querySelector('#e-date');
  if (dateInput) dateInput.value = dateStr || '';

  const days = (idx && idx.days) || [];
  state.el.querySelector('#e-days').innerHTML = days
    .map((d) => {
      const cls = ['chip'];
      if (d.day === state.day) cls.push('active');
      const dot = d.status === 'ready' ? '' : '<i class="dot"></i>';
      return `<button class="${cls.join(' ')}" data-action="day" data-day="${d.day}">Day${d.day}${dot}</button>`;
    })
    .join('');
}

function renderPlan(data, idx) {
  const d = data.day;
  const prog = data.progress || { tasks: {}, words: {} };
  const isToday = idx && idx.today === d.day;
  const tasks = d.tasks || [];
  const doneCount = tasks.filter((t, i) => prog.tasks[String(i)]).length;
  const words = d.vocabulary || [];

  return `
    <div class="card plan-hero">
      <div class="row between">
        <div>
          <div style="font-size:17px;font-weight:800">Day ${d.day} · ${esc(d.theme)}</div>
          <div class="small muted" style="margin-top:2px">${esc(d.date)} · ${esc(d.level || 'A2 → B1')} · 60 分钟</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
          ${isToday ? '<span class="badge">今天</span>' : ''}
          <span class="badge ${d.status === 'ready' ? 'ok' : 'warn'}">${d.status === 'ready' ? '资料已就绪' : '待生成'}</span>
        </div>
      </div>
      <div class="progress" id="e-prog"><i style="width:${tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0}%"></i></div>
      <div class="row between tiny muted" style="margin-top:5px">
        <span id="e-prog-label">${doneCount}/${tasks.length} 已完成</span>
        <span>来源：${d.generatedBy === 'claude' ? 'Claude 生成' : '基础模板'}</span>
      </div>
    </div>

    <div class="sec" data-sec="goals">
      <div class="sec-head" data-sec="goals">
        <h3>🎯 今日目标</h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body card">
        ${(d.goals || []).map((g) => `<div class="row" style="align-items:flex-start;gap:8px;margin-bottom:6px"><span style="color:var(--accent)">•</span><div>${esc(g)}</div></div>`).join('') || '<div class="muted small">暂无</div>'}
      </div>
    </div>

    <div class="sec" data-sec="tasks">
      <div class="sec-head" data-sec="tasks">
        <h3>✅ 今日任务 <span class="badge gray">60 分钟</span></h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body card tight">
        ${tasks.map((t, i) => {
          const done = !!prog.tasks[String(i)];
          return `<div class="task ${done ? 'done' : ''}" data-action="task" data-index="${i}">
            <div class="box">${done ? ICONS.check : ''}</div>
            <div class="grow txt">${esc(t.text)}</div>
            <div class="mins">${t.minutes}′</div>
          </div>`;
        }).join('') || '<div class="muted small">暂无任务</div>'}
      </div>
    </div>

    <div class="sec" data-sec="words">
      <div class="sec-head" data-sec="words">
        <h3>🔤 今日单词 <span class="badge gray">${words.length}</span></h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body card">
        ${renderVocab(words, prog)}
        ${words.length ? `<button class="btn block sm" data-action="to-study" style="margin-top:10px">在「资料」里查看完整例句 ${ICONS.chevron}</button>` : ''}
      </div>
    </div>

    <div class="sec" data-sec="mat">
      <div class="sec-head" data-sec="mat">
        <h3>📦 今日材料概览</h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body">
        <div class="row" style="gap:8px">
          <div class="card tight grow center" data-action="to-study" style="cursor:pointer;margin:0">
            <div style="font-size:20px;font-weight:800;color:var(--accent)">${(d.articles || []).length}</div>
            <div class="tiny muted">篇文章</div>
          </div>
          <div class="card tight grow center" data-action="to-study" style="cursor:pointer;margin:0">
            <div style="font-size:20px;font-weight:800;color:var(--accent-2)">${(d.videos || []).length}</div>
            <div class="tiny muted">个视频</div>
          </div>
          <div class="card tight grow center" data-action="to-study" style="cursor:pointer;margin:0">
            <div style="font-size:20px;font-weight:800;color:var(--ok)">${(d.mustLearn || []).length + (d.expand || []).length}</div>
            <div class="tiny muted">条精讲</div>
          </div>
        </div>
        <button class="btn primary block" data-action="to-study" style="margin-top:10px">${ICONS.play} 开始今日学习</button>
      </div>
    </div>
  `;
}

function renderVocab(words, prog) {
  if (!words.length) return '<div class="muted small">生成资料后显示今日单词</div>';
  return words
    .map((v) => {
      const open = state.openWords.has(v.word);
      const mastered = !!(prog.words && prog.words[v.word]);
      return `<div class="vocab-item ${open ? 'open' : ''}" data-action="word" data-word="${esc(v.word)}">
        <div class="row between">
          <div class="grow" style="min-width:0">
            <span class="w">${esc(v.word)}</span><span class="pos">${esc(v.pos || '')}</span>
            <div class="zh">${esc(v.meaning_zh || '')}</div>
          </div>
          <span class="star ${mastered ? 'on' : ''}" data-action="star" data-word="${esc(v.word)}">★</span>
        </div>
        <div class="detail">
          ${v.meaning_en ? `<div class="small muted">${esc(v.meaning_en)}</div>` : ''}
          ${v.example ? `<div class="ex">${esc(v.example)}</div>` : ''}
          ${v.source ? `<div class="tiny muted" style="margin-top:4px">来源：${esc(v.source)}</div>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function renderStudy(data) {
  const d = data.day;
  const prog = data.progress || { tasks: {}, words: {} };
  const q = state.vocabQuery.trim().toLowerCase();
  const words = (d.vocabulary || []).filter(
    (v) => !q || v.word.toLowerCase().includes(q) || (v.meaning_zh || '').includes(state.vocabQuery.trim())
  );

  return `
    <div class="row between" style="margin-bottom:6px">
      <div class="small muted">Day ${d.day} · ${esc(d.theme)}</div>
      <button class="btn sm" data-action="to-plan">${ICONS.calendar} 查看计划</button>
    </div>

    <div class="sec" data-sec="must">
      <div class="sec-head" data-sec="must">
        <h3>📌 必学内容 <span class="badge gray">${(d.mustLearn || []).length}</span></h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body">
        ${(d.mustLearn || []).map((m) => `
          <div class="note-item">
            <div class="row between">
              <h4>${esc(m.title)}</h4>
              <button class="btn sm" data-action="copy" data-text="${encodeURIComponent(m.content || '')}">复制</button>
            </div>
            <div class="note-body">${esc(m.content || '')}</div>
          </div>`).join('') || '<div class="muted small">暂无</div>'}
      </div>
    </div>

    <div class="sec" data-sec="expand">
      <div class="sec-head" data-sec="expand">
        <h3>🌱 拓展内容 <span class="badge gray">${(d.expand || []).length}</span></h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body">
        ${(d.expand || []).map((m) => `
          <div class="note-item" style="border-left-color:var(--accent-2)">
            <div class="row between">
              <h4>${esc(m.title)}</h4>
              <button class="btn sm" data-action="copy" data-text="${encodeURIComponent(m.content || '')}">复制</button>
            </div>
            <div class="note-body">${esc(m.content || '')}</div>
          </div>`).join('') || '<div class="muted small">暂无</div>'}
      </div>
    </div>

    <div class="sec" data-sec="videos">
      <div class="sec-head" data-sec="videos">
        <h3>🎬 视频（可理解性输入）<span class="badge gray">${(d.videos || []).length}</span></h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body">
        ${(d.videos || []).map((v) => `
          <button class="vid-card" data-action="vid" data-url="${esc(v.url)}">
            <div class="vid-thumb">${ICONS.play}</div>
            <div class="grow" style="min-width:0">
              <div class="vid-title">${esc(v.title)}</div>
              <div class="tiny muted">${esc(v.channel || '')} · ${v.minutes} 分钟</div>
              <div class="tiny muted" style="margin-top:2px">${esc(v.desc || '')}</div>
            </div>
            <span class="chev">${ICONS.external}</span>
          </button>`).join('') || '<div class="muted small">暂无视频</div>'}
      </div>
    </div>

    <div class="sec" data-sec="articles">
      <div class="sec-head" data-sec="articles">
        <h3>📖 文章精读 <span class="badge gray">${(d.articles || []).length}</span></h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body">
        ${(d.articles || []).map((a, i) => `
          <div class="art-item ${state.openArts.has(String(i)) ? 'open' : ''}" data-i="${i}">
            <div class="art-head" data-action="art" data-i="${i}">
              <div class="idx">${i + 1}</div>
              <div class="grow" style="min-width:0">
                <div style="font-size:14px;font-weight:600;line-height:1.4">${esc(a.title)}</div>
                <div class="tiny muted">${esc(a.level || 'A2-B1')} · ${a.words || 0} 词 · ${esc(a.source || '')}</div>
              </div>
              <span class="chev">${ICONS.chevron}</span>
            </div>
            <div class="art-body">
              <div class="art-text">${esc(a.content || '')}</div>
              ${a.zh ? `<div class="art-zh" style="margin-top:8px">💬 ${esc(a.zh)}</div>` : ''}
              ${(a.points || []).length ? `<div style="margin-top:8px">${a.points.map((p) => `<div class="small" style="margin-bottom:4px">· ${esc(p)}</div>`).join('')}</div>` : ''}
              <div class="row" style="margin-top:10px;gap:8px">
                <button class="btn sm" data-action="copy" data-text="${encodeURIComponent(a.content || '')}">复制全文</button>
                ${a.url ? `<a class="btn sm" href="${esc(a.url)}" target="_blank" rel="noopener">${ICONS.external} 原文</a>` : ''}
              </div>
            </div>
          </div>`).join('') || '<div class="muted small">暂无文章</div>'}
      </div>
    </div>

    <div class="sec" data-sec="vocab">
      <div class="sec-head" data-sec="vocab">
        <h3>🧠 今日词汇 <span class="badge gray">${(d.vocabulary || []).length}</span></h3>
        <span class="arrow">${ICONS.chevron}</span>
      </div>
      <div class="sec-body">
        <input class="input" id="e-vocab-q" placeholder="搜索单词 / 中文释义…" value="${esc(state.vocabQuery)}" style="margin-bottom:8px" />
        <div id="e-vocab-list">${renderVocab(words, prog)}</div>
      </div>
    </div>
  `;
}

/* ---------------- AI 生成 ---------------- */
function overlay(text) {
  let ov = document.getElementById('e-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'e-overlay';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div class="box"><div class="spinner"></div><div style="font-weight:600;margin-bottom:4px">正在生成 Day ${state.day} 资料</div><div class="small muted" id="e-ov-msg">${esc(text || 'Claude 正在产出内容…')}</div></div>`;
  return ov;
}

function overlayMsg(msg) {
  const m = document.getElementById('e-ov-msg');
  if (m) m.textContent = msg;
}

function closeOverlay() {
  const ov = document.getElementById('e-overlay');
  if (ov) ov.remove();
}

async function generate() {
  if (state.loading) return;
  state.loading = true;
  overlay('准备中…');
  try {
    await api.stream(
      `/api/english/day/${state.day}/generate`,
      {},
      (evt) => {
        if (evt.type === 'progress') overlayMsg(evt.message || '生成中…');
        else if (evt.type === 'done') {
          if (evt.day) {
            state.cache.set(state.day, { day: evt.day, progress: cur() ? cur().progress : { tasks: {}, words: {} } });
          }
        } else if (evt.type === 'error') {
          toast(evt.message || '生成失败', 'err', 3500);
        }
      }
    );
    await ensureIndexRefresh();
    await loadDay(state.day, true);
    render();
    toast('Day ' + state.day + ' 资料已生成', 'ok');
  } catch (e) {
    toast(e.message || '生成失败', 'err');
  }
  closeOverlay();
  state.loading = false;
}

async function ensureIndexRefresh() {
  state.index = await api.get('/api/english/index');
}

/* ---------------- 挂载 ---------------- */
export default {
  async mount(root, ctx) {
    if (!state.el) build();
    state.tab = ctx.path === '/english/study' ? 'study' : 'plan';
    root.innerHTML = '';
    root.appendChild(state.el);

    setTopbar({
      title: 'L_Agent',
      sub: state.tab === 'plan' ? '英语学习 · 计划' : '英语学习 · 资料',
      menu: null,
      action: { icon: ICONS.spark, title: 'AI 生成本日资料', onClick: generate },
    });

    try {
      await ensureIndex();
      if (!state.day) state.day = state.index.today;
      await loadDay(state.day);
      render();
    } catch (e) {
      state.el.querySelector('#e-body').innerHTML =
        `<div class="card"><div class="empty">加载失败：${esc(e.message)}</div></div>`;
    }
  },
  unmount() {
    const q = state.el && state.el.querySelector('#e-vocab-q');
    if (q) state.vocabQuery = q.value;
    closeOverlay();
  },
};
