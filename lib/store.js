'use strict';
/**
 * 简单的 JSON 文件存储工具（原子写入，避免并发写坏文件）
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ensureDir(DATA_DIR);

function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[store] readJson failed:', file, e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return data;
}

function updateJson(file, fallback, updater) {
  const cur = readJson(file, fallback);
  const next = typeof updater === 'function' ? updater(cur) : updater;
  writeJson(file, next);
  return next;
}

module.exports = { DATA_DIR, ensureDir, dataPath, readJson, writeJson, updateJson };
