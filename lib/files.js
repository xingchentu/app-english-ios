'use strict';
/**
 * 服务器目录浏览（只读）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.FS_ROOT || path.join(process.env.HOME || '/root'));
const MAX_PREVIEW = 300 * 1024; // 300KB 文本预览

const DENY = ['/proc', '/sys', '/dev', '/run'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.xml': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
};

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.css', '.scss', '.less', '.html', '.htm', '.xml', '.yml', '.yaml', '.toml', '.ini',
  '.conf', '.sh', '.bash', '.py', '.rb', '.go', '.java', '.c', '.h', '.cc', '.cpp',
  '.rs', '.php', '.sql', '.log', '.env', '.gitignore', '.properties', '.vue', '.gradle',
]);

function isDenied(abs) {
  return DENY.some((d) => abs === d || abs.startsWith(d + '/'));
}

function safeResolve(target) {
  const abs = path.resolve(target || ROOT);
  if (isDenied(abs)) throw new Error('该目录不允许访问');
  const rel = path.relative(ROOT, abs);
  if (rel === '..' || rel.startsWith('..' + path.sep)) throw new Error('超出允许访问的根目录');
  return abs;
}

function stat(p) {
  try {
    return fs.statSync(p);
  } catch (e) {
    return null;
  }
}

function listDir(target) {
  const abs = safeResolve(target);
  const st = stat(abs);
  if (!st) throw new Error('目录不存在');
  if (!st.isDirectory()) throw new Error('不是目录');

  const names = fs.readdirSync(abs);
  const entries = [];
  for (const name of names) {
    const full = path.join(abs, name);
    let s;
    try {
      s = fs.lstatSync(full);
    } catch (e) {
      continue;
    }
    const isDir = s.isDirectory();
    entries.push({
      name,
      path: full,
      type: isDir ? 'dir' : 'file',
      ext: isDir ? '' : path.extname(name).toLowerCase(),
      size: isDir ? null : s.size,
      mtime: s.mtimeMs,
      hidden: name.startsWith('.'),
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  return {
    root: ROOT,
    path: abs,
    parent: abs === ROOT ? null : path.dirname(abs),
    breadcrumb: buildBreadcrumb(abs),
    entries,
  };
}

function buildBreadcrumb(abs) {
  const rel = path.relative(ROOT, abs);
  const parts = rel ? rel.split(path.sep) : [];
  const crumbs = [{ name: ROOT === '/' ? '/' : path.basename(ROOT), path: ROOT }];
  let cur = ROOT;
  for (const p of parts) {
    cur = path.join(cur, p);
    crumbs.push({ name: p, path: cur });
  }
  return crumbs;
}

function readFile(abs) {
  const st = stat(abs);
  if (!st) throw new Error('文件不存在');
  if (st.isDirectory()) throw new Error('这是一个目录');
  const ext = path.extname(abs).toLowerCase();
  const isText = TEXT_EXT.has(ext) || st.size < 64 * 1024;
  const info = {
    path: abs,
    name: path.basename(abs),
    ext,
    size: st.size,
    mtime: st.mtimeMs,
    mime: MIME[ext] || 'application/octet-stream',
    isText,
    truncated: false,
    content: '',
  };
  if (isText) {
    const buf = fs.readFileSync(abs);
    if (buf.length > MAX_PREVIEW) {
      info.content = buf.slice(0, MAX_PREVIEW).toString('utf8');
      info.truncated = true;
    } else {
      info.content = buf.toString('utf8');
    }
  }
  return info;
}

module.exports = { ROOT, listDir, readFile, safeResolve, MIME, TEXT_EXT };
