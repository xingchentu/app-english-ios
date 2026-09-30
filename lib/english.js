'use strict';
/**
 * 英语学习助手（L_Agent English）
 * - 30 天为一个学习周期，每天资料持久化到 data/english/day-XX.json
 * - 资料结构：必学内容 / 拓展内容 / 视频(6) / 文章(10) / 词汇(来自10篇文章+6个视频)
 * - 生成方式：调用 Claude CLI（--json-schema 结构化输出）
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const claude = require('./claude');
const llm = require('./llm');

const EN_DIR = store.dataPath('english');
store.ensureDir(EN_DIR);
const CYCLE_FILE = path.join(EN_DIR, 'cycle.json');
const TOTAL_DAYS = 30;

/* ---------------- 30 天主题表（贴合兴趣：NBA / 财经 / 电影 / 旅游 / 电视剧） ---------------- */
const THEMES = [
  { domain: 'NBA', topic: '交易截止日与球队重建' },
  { domain: '财经', topic: '复利与指数基金入门' },
  { domain: '电影', topic: '奥斯卡获奖影片与幕后故事' },
  { domain: '旅游', topic: '日本自由行实用英语' },
  { domain: '电视剧', topic: 'Friends 咖啡馆日常对话' },
  { domain: 'NBA', topic: '季后赛战术与数据（analytics）' },
  { domain: '财经', topic: '通货膨胀与你的钱包' },
  { domain: '电影', topic: '科幻电影与视觉特效' },
  { domain: '旅游', topic: '机场值机、安检与酒店入住' },
  { domain: '电视剧', topic: 'Modern Family 家庭场景表达' },
  { domain: 'NBA', topic: '球星成长故事与个人品牌' },
  { domain: '财经', topic: '副业与被动收入' },
  { domain: '电影', topic: '动画电影与配音艺术' },
  { domain: '旅游', topic: '欧洲火车与跨国交通' },
  { domain: '电视剧', topic: 'The Office 职场幽默英语' },
  { domain: 'NBA', topic: '选秀大会与新秀观察' },
  { domain: '财经', topic: '股市基础术语与读财报' },
  { domain: '电影', topic: '影评写作与评分体系' },
  { domain: '旅游', topic: '餐厅点餐与小费文化' },
  { domain: '电视剧', topic: '悬疑剧常用表达与推理词汇' },
  { domain: 'NBA', topic: '伤病、负荷管理与康复' },
  { domain: '财经', topic: '个人预算与记账方法' },
  { domain: '电影', topic: '超级英雄电影宇宙' },
  { domain: '旅游', topic: '问路、交通与地图导航' },
  { domain: '电视剧', topic: '情景喜剧高频俚语' },
  { domain: 'NBA', topic: '总决赛经典时刻回顾' },
  { domain: '财经', topic: '加密货币与风险管理' },
  { domain: '电影', topic: '导演风格与镜头语言' },
  { domain: '旅游', topic: '旅行中的突发状况处理' },
  { domain: '综合', topic: '30 天复习：自我表达与成果展示' },
];

function themeOf(day) {
  return THEMES[(day - 1) % THEMES.length];
}

/* ---------------- 周期（起始日期） ---------------- */
function getCycle() {
  let cycle = store.readJson(CYCLE_FILE, null);
  if (!cycle || !cycle.startDate) {
    // 默认让“今天”落在第 10 天，这样前面 9 天可以作为历史回顾
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() - 9);
    cycle = { startDate: fmtDate(base), totalDays: TOTAL_DAYS, level: 'A2 → B1' };
    store.writeJson(CYCLE_FILE, cycle);
  }
  return cycle;
}

function setCycle(patch) {
  const cycle = Object.assign(getCycle(), patch || {});
  store.writeJson(CYCLE_FILE, cycle);
  return cycle;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayDate(day) {
  const cycle = getCycle();
  const start = new Date(cycle.startDate + 'T00:00:00');
  start.setDate(start.getDate() + (day - 1));
  return fmtDate(start);
}

function todayDay() {
  const cycle = getCycle();
  const start = new Date(cycle.startDate + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((now - start) / 86400000) + 1;
  return Math.min(Math.max(diff, 1), TOTAL_DAYS);
}

function dateToDay(dateStr) {
  const cycle = getCycle();
  const start = new Date(cycle.startDate + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  const diff = Math.floor((target - start) / 86400000) + 1;
  if (diff < 1 || diff > TOTAL_DAYS) return null;
  return diff;
}

/* ---------------- 读写某天资料 ---------------- */
function dayFile(day) {
  return path.join(EN_DIR, `day-${String(day).padStart(2, '0')}.json`);
}

function getDay(day) {
  return store.readJson(dayFile(day), null);
}

function saveDay(day, data) {
  const payload = Object.assign({}, data, {
    day,
    date: data.date || dayDate(day),
    savedAt: new Date().toISOString(),
  });
  store.writeJson(dayFile(day), payload);
  return payload;
}

function getIndex() {
  const cycle = getCycle();
  const today = todayDay();
  const days = [];
  for (let i = 1; i <= TOTAL_DAYS; i++) {
    const d = getDay(i);
    days.push({
      day: i,
      date: dayDate(i),
      theme: d && d.theme ? d.theme : `${themeOf(i).domain} · ${themeOf(i).topic}`,
      domain: themeOf(i).domain,
      status: d ? d.status || 'ready' : 'empty',
      generatedBy: d ? d.generatedBy || 'seed' : null,
      vocabCount: d && d.vocabulary ? d.vocabulary.length : 0,
      articleCount: d && d.articles ? d.articles.length : 0,
      videoCount: d && d.videos ? d.videos.length : 0,
      isToday: i === today,
    });
  }
  return { cycle, today, totalDays: TOTAL_DAYS, days };
}

/* ---------------- 兜底种子数据（AI 未生成时保证页面可用） ---------------- */
function seedDay(day) {
  const t = themeOf(day);
  const kw = encodeURIComponent(`${t.domain} ${t.topic} english`.replace(/\s+/g, '+'));
  const videos = [
    '6 Minute English',
    'Easy English street interview',
    'NBA highlights & analysis',
    'Money & investing explained',
    'Movie review breakdown',
    'Travel phrases & tips',
  ].map((title, i) => ({
    title: `${title} · ${t.topic}`,
    url: `https://www.youtube.com/results?search_query=${kw}`,
    channel: 'YouTube 搜索结果',
    minutes: 6 + i,
    desc: `围绕「${t.topic}」的可理解性输入视频（i+1 难度，A2→B1）。`,
  }));
  const articles = [];
  for (let i = 1; i <= 10; i++) {
    articles.push({
      title: `${t.domain} 精读短文 #${i}：${t.topic}`,
      level: 'A2-B1',
      words: 130,
      source: 'L_Agent 素材库',
      url: '',
      content: `这是第 ${day} 天「${t.topic}」主题的第 ${i} 篇短文占位内容。\n\n点击页面右上角的「AI 生成资料」按钮，Claude 会围绕今天的主题产出 10 篇 120-180 词的可理解性输入短文、6 个视频链接，以及从这些材料中提取的今日单词表。`,
    });
  }
  return {
    day,
    date: dayDate(day),
    theme: `${t.domain} · ${t.topic}`,
    domain: t.domain,
    level: 'A2 → B1',
    goals: [`围绕「${t.topic}」完成 60 分钟可理解性输入`],
    tasks: [
      { text: '看 2 个视频（无字幕→英文字幕）', minutes: 20 },
      { text: '精读 3 篇短文并标记生词', minutes: 20 },
      { text: '用今日单词造句 5 句', minutes: 15 },
      { text: '跟读 1 段视频片段', minutes: 5 },
    ],
    mustLearn: [{ title: '今日核心表达', content: '待 AI 生成', type: 'expression' }],
    expand: [{ title: '拓展阅读', content: '待 AI 生成', type: 'reading' }],
    videos,
    articles,
    vocabulary: [],
    status: 'empty',
    generatedBy: 'seed',
  };
}

/* ---------------- Claude 生成 ---------------- */
const SCHEMA_HINT = `{
  "theme": "今日主题（中文：领域 · 话题）",
  "goals": ["中文学习目标 3-4 条"],
  "tasks": [{"text": "任务描述", "minutes": 15}],
  "mustLearn": [{"title": "标题", "type": "article|expression|grammar|video", "content": "英文材料 + 中文讲解 + 要点解析"}],
  "expand": [{"title": "标题", "type": "note", "content": "拓展内容"}],
  "videos": [{"title": "视频标题", "url": "https://www.youtube.com/results?search_query=关键词", "channel": "频道名", "minutes": 8, "desc": "中文一句话说明"}],
  "articles": [{"title": "英文标题", "level": "A2-B1", "words": 130, "source": "L_Agent 原创", "content": "英文短文正文 100-150 词", "zh": "中文概要 1-2 句", "points": ["中文语言点讲解"]}],
  "vocabulary": [{"word": "单词", "pos": "n.", "meaning_en": "英英释义", "meaning_zh": "中文释义", "example": "英文例句", "source": "来源文章标题或视频标题"}]
}`;

const SCHEMA = {
  type: 'object',
  required: ['theme', 'goals', 'tasks', 'mustLearn', 'expand', 'videos', 'articles', 'vocabulary'],
  properties: {
    theme: { type: 'string', description: '今日主题（中文，领域 · 话题）' },
    goals: { type: 'array', items: { type: 'string' }, description: '今日学习目标 3-4 条（中文）' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'minutes'],
        properties: {
          text: { type: 'string' },
          minutes: { type: 'number' },
        },
      },
      description: '今日 60 分钟任务清单 4-6 条，minutes 之和约等于 60',
    },
    mustLearn: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string' },
          type: { type: 'string', description: 'article|expression|grammar|video' },
          content: { type: 'string', description: '正文：英文材料 + 中文讲解 + 要点解析' },
        },
      },
      description: '必学内容 3-4 条：核心精读片段 / 高频表达 / 语法点',
    },
    expand: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string' },
          type: { type: 'string' },
          content: { type: 'string' },
        },
      },
      description: '拓展内容 3-5 条：文化注释、同义替换、进阶例句、背景知识',
    },
    videos: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'url', 'channel', 'minutes', 'desc'],
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          channel: { type: 'string' },
          minutes: { type: 'number' },
          desc: { type: 'string', description: '中文一句话说明这个视频看什么' },
        },
      },
      description: '6 个视频，url 必须是 https://www.youtube.com/results?search_query=... 或 https://www.youtube.com/@频道 形式，禁止编造 watch?v= 视频ID',
    },
    articles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string' },
          level: { type: 'string' },
          words: { type: 'number' },
          source: { type: 'string' },
          url: { type: 'string' },
          content: { type: 'string', description: '英文短文正文 120-180 词' },
          zh: { type: 'string', description: '中文概要 1-2 句' },
          points: { type: 'array', items: { type: 'string' }, description: '2-4 个语言点中文讲解' },
        },
      },
      description: '10 篇英文短文，围绕今日主题，可理解性输入 i+1',
    },
    vocabulary: {
      type: 'array',
      items: {
        type: 'object',
        required: ['word', 'meaning_zh', 'example'],
        properties: {
          word: { type: 'string' },
          pos: { type: 'string' },
          meaning_en: { type: 'string' },
          meaning_zh: { type: 'string' },
          example: { type: 'string', description: '英文例句（来自今日文章或视频语境）' },
          source: { type: 'string', description: '来自哪篇文章或哪个视频的标题' },
        },
      },
      description: '28-36 个单词/短语，必须全部来自上面 10 篇文章和 6 个视频',
    },
  },
};

function buildPrompt(day) {
  const t = themeOf(day);
  const date = dayDate(day);
  return `你是英语学习助手 L_Agent 的课程内容生成器。请为学习者产出【第 ${day} 天】（${date}）的完整学习资料包。
重要：不要使用任何工具，不要联网搜索，不要读写文件，直接输出 JSON。

## 学习者档案
- 中国成年人，母语中文，每天投入 60 分钟
- 当前水平 CEFR A2，目标过渡到 B1；阅读能力强，词汇与地道表达偏弱
- 兴趣领域（按优先级）：NBA 篮球、财经/赚钱/商业、电影、旅游、电视剧
- 字幕偏好：解释用中文，材料与例句用英文
- 教学法：Krashen 可理解性输入（i+1）——每份材料约 80% 能看懂、20% 是新内容；材料难度 A2 基础、向 B1 过渡；禁止出现过多超纲长难句

## 今日主题（必须严格围绕）
- 领域：${t.domain}
- 话题：${t.topic}

## 产出要求（严格遵守数量）
1. videos：6 个视频。主题贴合今日话题，时长 5-15 分钟，语速适中、有英文字幕。
   - 链接规则（非常重要）：只能使用 YouTube 搜索链接（https://www.youtube.com/results?search_query=关键词）或频道链接（https://www.youtube.com/@频道名）。绝对不要编造 https://www.youtube.com/watch?v=xxxxx 这样的视频 ID，也不要编造不存在的 URL。
2. articles：10 篇英文短文，每篇 100-150 词，难度 A2→B1，围绕今日话题连续成体系（可以从不同角度切入同一话题：背景介绍、人物故事、数据解释、观点讨论、场景对话、词汇辨析、文化注释、实用表达、常见误区、小结复盘）。
   - 每篇要有中文概要（zh）和 2-4 条中文语言点讲解（points）。
3. vocabulary：28-36 个单词/短语，必须全部出自上面 10 篇文章与 6 个视频。每条包含：单词、词性、英英释义（简化到 A2 可读）、中文释义、英文例句（贴合语境）、来源（文章标题或视频标题）。
4. mustLearn：3-4 条必学内容（精读片段 / 高频表达 / 语法点），每条含英文材料 + 中文讲解 + 要点解析。
5. expand：3-5 条拓展内容（文化注释、同义替换、进阶例句、背景知识）。
6. goals：3-4 条中文学习目标；tasks：60 分钟任务清单（minutes 之和约 60）。

## 风格
- 英文材料自然地道，不要教科书腔；中文讲解简洁，直击要点。
- 输出必须是合法 JSON，不要输出任何解释性文字或 Markdown 代码块。`;
}

function normalizeDay(day, raw) {
  const t = themeOf(day);
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const videos = arr(raw.videos).slice(0, 8).map((v) => ({
    title: String(v.title || '').trim() || `${t.domain} 视频`,
    url: safeUrl(v.url, `${t.domain} ${t.topic}`),
    channel: String(v.channel || 'YouTube').trim(),
    minutes: Number(v.minutes) || 8,
    desc: String(v.desc || '').trim(),
  }));
  const articles = arr(raw.articles).slice(0, 12).map((a) => ({
    title: String(a.title || '').trim() || `${t.domain} 短文`,
    level: String(a.level || 'A2-B1').trim(),
    words: Number(a.words) || countWords(a.content),
    source: String(a.source || 'L_Agent 原创').trim(),
    url: typeof a.url === 'string' ? a.url : '',
    content: String(a.content || '').trim(),
    zh: String(a.zh || '').trim(),
    points: arr(a.points),
  }));
  const vocabulary = dedupeVocab(
    arr(raw.vocabulary).map((v) => ({
      word: String(v.word || '').trim(),
      pos: String(v.pos || '').trim(),
      meaning_en: String(v.meaning_en || '').trim(),
      meaning_zh: String(v.meaning_zh || '').trim(),
      example: String(v.example || '').trim(),
      source: String(v.source || '').trim(),
    }))
  );
  return {
    day,
    date: dayDate(day),
    theme: String(raw.theme || `${t.domain} · ${t.topic}`).trim(),
    domain: t.domain,
    level: 'A2 → B1',
    goals: arr(raw.goals).slice(0, 6),
    tasks: arr(raw.tasks).slice(0, 8).map((x) => ({
      text: String(x.text || '').trim(),
      minutes: Number(x.minutes) || 10,
    })),
    mustLearn: arr(raw.mustLearn).slice(0, 6).map(noteItem),
    expand: arr(raw.expand).slice(0, 8).map(noteItem),
    videos,
    articles,
    vocabulary,
    status: 'ready',
    generatedBy: 'claude',
  };
}

function noteItem(x) {
  return {
    title: String(x.title || '').trim(),
    type: String(x.type || 'note').trim(),
    content: String(x.content || '').trim(),
  };
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function dedupeVocab(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (!v.word) continue;
    const key = v.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function safeUrl(url, kw) {
  const u = String(url || '').trim();
  if (/^https?:\/\/(www\.)?youtube\.com\//i.test(u) || /^https?:\/\/youtu\.be\//i.test(u)) {
    // 屏蔽不可核验的 watch?v= 链接，替换为搜索链接
    if (/watch\?v=/i.test(u)) {
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(kw)}`;
    }
    return u;
  }
  if (/^https?:\/\//i.test(u)) return u;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(kw)}`;
}

/**
 * 生成某天资料（直连本地 LLM，失败则重试，仍失败回退 Claude CLI）
 */
async function generateDay(day, opts) {
  const options = opts || {};
  const onProgress = options.onProgress || function () {};
  const model = process.env.LLM_GEN_MODEL || 'ms-397b';
  onProgress({ stage: 'start', message: `正在生成第 ${day} 天资料（模型 ${model}）…` });

  const quality = (d) =>
    (d.articles || []).length * 10 + (d.videos || []).length * 3 + (d.vocabulary || []).length;
  const isGood = (d) =>
    d && d.articles && d.articles.length >= 8 && d.videos && d.videos.length >= 5 && d.vocabulary && d.vocabulary.length >= 18;

  let best = null;
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    let raw;
    try {
      raw = await llm.runJsonFast({
        model,
        system:
          '你是英语学习助手 L_Agent 的课程内容生成器，为中国成年人制作「可理解性输入(i+1)」英语学习材料。材料难度 A2→B1，主题贴合用户兴趣（NBA/财经/电影/旅游/电视剧）。不要使用任何工具，不要联网，直接输出 JSON。',
        prompt: buildPrompt(day),
        schemaHint: SCHEMA_HINT,
        maxTokens: 12000,
        timeout: 12 * 60 * 1000,
      });
    } catch (e) {
      if (i === attempts - 1) {
        onProgress({ stage: 'fallback', message: `直连多次失败，改用 Claude CLI…` });
        raw = await claude.runJson({
          prompt: buildPrompt(day),
          schema: SCHEMA,
          cwd: options.cwd,
          timeout: options.timeout || 20 * 60 * 1000,
        });
      } else {
        onProgress({ stage: 'retry', message: `第 ${i + 1} 次调用出错（${e.message.slice(0, 50)}），重试…` });
        continue;
      }
    }
    const data = normalizeDay(day, raw);
    if (!best || quality(data) > quality(best)) best = data;
    if (isGood(data)) break;
    if (i < attempts - 1) {
      onProgress({
        stage: 'retry',
        message: `第 ${i + 1} 次质量不足（文章${data.articles.length}/视频${data.videos.length}/单词${data.vocabulary.length}），重试…`,
      });
    }
  }

  if (!best || !best.articles || !best.articles.length) {
    const err = new Error('多次生成均未达到质量要求');
    err.day = day;
    throw err;
  }
  best.status = 'ready';
  best.generatedBy = 'claude';
  onProgress({ stage: 'saved', message: '已保存' });
  return saveDay(day, best);
}

/* ---------------- 学习进度（任务打卡 / 单词掌握） ---------------- */
const PROGRESS_FILE = path.join(EN_DIR, 'progress.json');

function getProgress() {
  return store.readJson(PROGRESS_FILE, { tasks: {}, words: {} });
}

function saveProgress(p) {
  return store.writeJson(PROGRESS_FILE, p);
}

function setTask(day, taskIndex, done) {
  const p = getProgress();
  p.tasks = p.tasks || {};
  const key = String(day);
  p.tasks[key] = p.tasks[key] || {};
  if (done) p.tasks[key][taskIndex] = true;
  else delete p.tasks[key][taskIndex];
  return saveProgress(p);
}

function setWord(day, word, mastered) {
  const p = getProgress();
  p.words = p.words || {};
  const key = String(day);
  p.words[key] = p.words[key] || {};
  if (mastered) p.words[key][word] = true;
  else delete p.words[key][word];
  return saveProgress(p);
}

module.exports = {
  THEMES, TOTAL_DAYS,
  themeOf, getCycle, setCycle, dayDate, todayDay, dateToDay,
  getDay, saveDay, getIndex, seedDay, generateDay,
  buildPrompt, SCHEMA_HINT, SCHEMA, normalizeDay,
  getProgress, setTask, setWord,
};
