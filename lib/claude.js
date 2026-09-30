'use strict';
/**
 * Claude Code CLI 封装
 * - runChat    : 流式对话（stream-json + partial messages），支持 --resume 会话续接
 * - runJson    : 结构化输出（--json-schema），用于英语资料生成
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/opt/nodejs/bin/claude';
const DEFAULT_CWD =
  process.env.CLAUDE_CWD || path.join(process.env.HOME || '/root', 'project', 'test');

function ensureCwd(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error('[claude] cannot create cwd', dir, e.message);
  }
  return fs.existsSync(dir) ? dir : process.cwd();
}

/** 基础参数：非交互 + 流式 JSON + 自动接受文件编辑 */
function baseArgs() {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(*)',
  ];
}

function spawnEnv() {
  const env = Object.assign({}, process.env);
  env.NO_COLOR = '1';
  env.CI = '1';
  delete env.CLAUDECODE;
  return env;
}

function extractText(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

function extractTools(message) {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content
    .filter((b) => b && b.type === 'tool_use')
    .map((b) => b.name || 'tool');
}

/**
 * 流式对话
 * @param {object} opts {prompt, cwd, resume, onEvent}
 * @returns {{promise: Promise, cancel: Function}}
 */
function runChat(opts) {
  const onEvent = opts.onEvent || function () {};
  const cwd = ensureCwd(opts.cwd || DEFAULT_CWD);
  const args = baseArgs();
  if (opts.resume) args.push('--resume', opts.resume);

  let child;
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    try {
      child = spawn(CLAUDE_BIN, args, {
        cwd,
        env: spawnEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return reject(e);
    }

    let buf = '';
    let emitted = ''; // 已经推送给前端的文本（用于去重）
    let sessionId = opts.resume || null;
    let resultText = '';
    let stderr = '';

    const pushDelta = (text) => {
      if (!text) return;
      emitted += text;
      onEvent({ type: 'delta', text });
    };

    const handleLine = (line) => {
      line = line.trim();
      if (!line || line[0] !== '{') return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        return;
      }

      if (obj.session_id) sessionId = obj.session_id;

      // 逐 token 流式增量
      if (obj.type === 'stream_event' && obj.event) {
        const ev = obj.event;
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          pushDelta(ev.delta.text);
        } else if (ev.type === 'content_block_start' && ev.content_block) {
          if (ev.content_block.type === 'tool_use') {
            onEvent({ type: 'tool', name: ev.content_block.name || 'tool' });
          }
        }
        return;
      }

      // 完整的 assistant 消息（未走 stream_event 时兜底推送）
      if (obj.type === 'assistant') {
        const full = extractText(obj.message);
        if (full) {
          if (full.startsWith(emitted)) {
            pushDelta(full.slice(emitted.length));
          } else if (!emitted) {
            pushDelta(full);
          }
        }
        const tools = extractTools(obj.message);
        if (tools.length) onEvent({ type: 'tool', name: tools[tools.length - 1] });
        return;
      }

      if (obj.type === 'result') {
        resultText = typeof obj.result === 'string' ? obj.result : '';
        if (obj.session_id) sessionId = obj.session_id;
        if (obj.is_error) {
          onEvent({ type: 'error', message: resultText || 'Claude 返回错误' });
        } else if (resultText && !emitted) {
          pushDelta(resultText);
        }
        return;
      }
    };

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on('error', (err) => {
      if (!cancelled) onEvent({ type: 'error', message: err.message });
      reject(err);
    });

    child.on('close', (code) => {
      if (buf.trim()) handleLine(buf);
      if (cancelled) return resolve({ cancelled: true, sessionId, text: emitted });
      if (!emitted && !resultText && code !== 0) {
        onEvent({
          type: 'error',
          message: (stderr || '').trim().split('\n').slice(-3).join(' ') || `Claude 退出码 ${code}`,
        });
      }
      resolve({ code, sessionId, text: emitted || resultText, stderr });
    });

    try {
      child.stdin.write(opts.prompt || '');
      child.stdin.end();
    } catch (e) {
      /* ignore */
    }
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        if (child) child.kill('SIGKILL');
      } catch (e) {
        /* ignore */
      }
    },
  };
}

/**
 * 结构化 JSON 输出（用于生成英语资料）
 * @param {object} opts {prompt, schema, cwd, timeout(ms)}
 */
function runJson(opts) {
  const cwd = ensureCwd(opts.cwd || DEFAULT_CWD);
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--disallowedTools', 'WebSearch', 'WebFetch', 'Task', 'Workflow', 'NotebookEdit',
    '--json-schema', JSON.stringify(opts.schema),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, env: spawnEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = opts.timeout
      ? setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch (e) {}
          reject(new Error('生成超时'));
        }, opts.timeout)
      : null;

    child.stdout.on('data', (c) => (out += c.toString('utf8')));
    child.stderr.on('data', (c) => (err += c.toString('utf8')));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        return reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `退出码 ${code}`));
      }
      try {
        const parsed = JSON.parse(out);
        // CLI 返回的是信封对象，真正符合 schema 的内容在 result 字段
        let payload = parsed && typeof parsed.result === 'string' ? parsed.result : parsed;
        if (typeof payload === 'string') payload = JSON.parse(payload);
        resolve(payload);
      } catch (e) {
        let detail = out.slice(0, 300);
        try {
          const env = JSON.parse(out);
          detail = 'result=' + String(env.result).slice(0, 300) + ' | is_error=' + env.is_error;
        } catch (e2) {}
        reject(new Error('解析 Claude 输出失败: ' + detail));
      }
    });
    try {
      child.stdin.write(opts.prompt || '');
      child.stdin.end();
    } catch (e) {}
  });
}

module.exports = { runChat, runJson, ensureCwd, DEFAULT_CWD, CLAUDE_BIN };
