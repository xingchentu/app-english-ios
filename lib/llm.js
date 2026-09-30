'use strict';
/**
 * 直连本地 LLM 代理（Anthropic Messages 协议）
 * 用于批量内容生成：比走 Claude CLI 快得多（无系统提示词与工具开销）
 * 配置来源：/root/.claude/settings.json 的 env（ANTHROPIC_BASE_URL 等）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function loadSettingsEnv() {
  const out = {};
  try {
    const p = path.join(process.env.HOME || '/root', '.claude', 'settings.json');
    const conf = JSON.parse(fs.readFileSync(p, 'utf8'));
    Object.assign(out, conf.env || {});
  } catch (e) { /* ignore */ }
  return out;
}

function getConfig() {
  const s = loadSettingsEnv();
  return {
    baseUrl: (process.env.ANTHROPIC_BASE_URL || s.ANTHROPIC_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, ''),
    token: process.env.ANTHROPIC_AUTH_TOKEN || s.ANTHROPIC_AUTH_TOKEN || 'sk-claude-local',
    model: process.env.ANTHROPIC_MODEL || s.ANTHROPIC_MODEL || 'claude-main',
  };
}

function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: Object.assign(
          {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(data),
          },
          headers
        ),
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf) });
          } catch (e) {
            reject(new Error('响应解析失败: ' + buf.slice(0, 200)));
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function extractJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

/**
 * 生成结构化 JSON
 * @param {object} opts {system, prompt, schemaHint, maxTokens, timeout}
 */
async function runJsonFast(opts) {
  const cfg = getConfig();
  if (opts.model) cfg.model = opts.model;
  const headers = {
    'x-api-key': cfg.token,
    authorization: `Bearer ${cfg.token}`,
    'anthropic-version': '2023-06-01',
  };
  const system = `${opts.system || ''}

【输出格式要求】
只输出一个合法的 JSON 对象，不要输出 markdown 代码块标记，不要输出任何解释文字。
JSON 必须符合以下结构（字段名与类型保持一致）：
${opts.schemaHint || ''}`;

  const t0 = Date.now();
  const { status, json } = await postJson(
    `${cfg.baseUrl}/v1/messages`,
    headers,
    {
      model: cfg.model,
      max_tokens: opts.maxTokens || 8000,
      messages: [{ role: 'user', content: opts.prompt }],
      system,
    },
    opts.timeout || 10 * 60 * 1000
  );

  if (status !== 200) {
    throw new Error(`LLM 接口错误 ${status}: ${JSON.stringify(json).slice(0, 200)}`);
  }
  const text = (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new Error('LLM 返回为空');
  const data = extractJson(text);
  data._meta = { model: json.model, seconds: Math.round((Date.now() - t0) / 1000), usage: json.usage };
  return data;
}

module.exports = { runJsonFast, getConfig };
