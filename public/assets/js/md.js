/* 极简 Markdown 渲染器（够用于聊天与资料展示，无外部依赖） */
import { esc } from './shell.js';

const CB = '\u0000CB'; // code block placeholder
const IC = '\u0000IC'; // inline code placeholder
const P = '\u0000';

function inline(s) {
  const codes = [];
  let out = s.replace(/`([^`\n]+)`/g, (m, c) => {
    codes.push(c);
    return `${IC}${codes.length - 1}${P}`;
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:10px"/>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (m, u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(new RegExp(`${IC}(\\d+)${P}`, 'g'), (m, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return out;
}

function renderTable(rows) {
  const head = rows[0].map((c) => `<th>${inline(c)}</th>`).join('');
  const body = rows
    .slice(2)
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

export function renderMarkdown(src) {
  if (!src) return '';
  const blocks = [];
  let text = String(src).replace(/\r\n/g, '\n');

  // 抽取围栏代码块
  text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push({ lang: lang || '', code: code.replace(/\n$/, '') });
    return `${CB}${blocks.length - 1}${P}`;
  });

  text = esc(text);

  const lines = text.split('\n');
  let html = '';
  let i = 0;

  const flushPara = (buf) => {
    if (!buf.length) return;
    html += `<p>${inline(buf.join('<br/>'))}</p>`;
    buf.length = 0;
  };

  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    // 代码块占位
    const cbMatch = line.trim().match(new RegExp(`^${CB}(\\d+)${P}$`));
    if (cbMatch) {
      flushPara(para);
      const b = blocks[Number(cbMatch[1])];
      html += `<div class="code-wrap"><button class="copy-code" data-code="${encodeURIComponent(b.code)}">复制</button><pre><code>${b.code}</code></pre></div>`;
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(para);
      const lv = Math.min(h[1].length, 4);
      html += `<h${lv}>${inline(h[2])}</h${lv}>`;
      i++;
      continue;
    }

    // 分割线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(para);
      html += '<hr/>';
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara(para);
      const rows = [splitRow(line)];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
        rows.push(splitRow(lines[j]));
        j++;
      }
      html += renderTable(rows);
      i = j;
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushPara(para);
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      html += `<blockquote>${inline(buf.join('<br/>'))}</blockquote>`;
      continue;
    }

    // 列表
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara(para);
      const ordered = !!ol;
      const items = [];
      while (i < lines.length) {
        const mU = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        const mO = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (ordered && mO) items.push(mO[1]);
        else if (!ordered && mU) items.push(mU[1]);
        else break;
        i++;
      }
      html += `<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }

    // 空行
    if (!line.trim()) {
      flushPara(para);
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara(para);
  return html;
}

/** 纯文本渲染（用户消息） */
export function renderPlain(src) {
  return esc(src).replace(/\n/g, '<br/>');
}
