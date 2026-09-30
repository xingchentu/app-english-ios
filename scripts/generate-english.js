'use strict';
/**
 * 生成 30 天英语学习资料（调用 Claude）
 * 用法：
 *   node scripts/generate-english.js              生成全部未生成的天
 *   node scripts/generate-english.js --day 5      只生成第 5 天
 *   node scripts/generate-english.js --all        重新生成全部 30 天
 *   node scripts/generate-english.js --c 3        并发数（默认 3）
 */
const english = require('../lib/english');

function parseArgs(argv) {
  const opts = { days: [], all: false, concurrency: 3, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--day') opts.days.push(Number(argv[++i]));
    else if (a === '--days') {
      const v = argv[++i];
      if (v.includes('-')) {
        const [s, e] = v.split('-').map(Number);
        for (let d = s; d <= e; d++) opts.days.push(d);
      } else v.split(',').forEach((x) => opts.days.push(Number(x)));
    } else if (a === '--all') opts.all = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--c') opts.concurrency = Number(argv[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let days = opts.days.length
    ? opts.days
    : Array.from({ length: english.TOTAL_DAYS }, (_, i) => i + 1);

  if (!opts.all && !opts.force && !opts.days.length) {
    days = days.filter((d) => {
      const cur = english.getDay(d);
      return !cur || cur.status !== 'ready';
    });
  }

  if (!days.length) {
    console.log('所有资料已生成，无需处理。');
    return;
  }

  console.log(`待生成：Day ${days.join(', ')}（并发 ${opts.concurrency}）`);
  const queue = days.slice();
  let done = 0;

  async function worker(idx) {
    while (queue.length) {
      const day = queue.shift();
      const t0 = Date.now();
      try {
        const data = await english.generateDay(day, {
          onProgress: (p) => process.stdout.write(`[Day ${day}] ${p.message}\n`),
        });
        done++;
        console.log(
          `✅ [w${idx}] Day ${day} 完成：文章 ${data.articles.length} / 视频 ${data.videos.length} / 单词 ${data.vocabulary.length}（${Math.round((Date.now() - t0) / 1000)}s）${done}/${days.length}`
        );
      } catch (e) {
        console.error(`❌ [w${idx}] Day ${day} 失败：${e.message}`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(opts.concurrency, days.length); i++) workers.push(worker(i));
  await Promise.all(workers);
  console.log('全部完成。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
