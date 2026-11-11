// 极简 Markdown 渲染器
// 安全原则：所有文本先 escapeHtml，再生成标签；模型输出绝不直接拼进 innerHTML。
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(text) {
  // text 已经过转义
  return text
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^\[NEW::(.+?)::(.+?)::(.+?)\]$/, '<span class="new-marker">超纲：$1</span>');
}

function codeCard(lang, code, index) {
  const label = escapeHtml(lang || 'text');
  return [
    '<div class="code-card">',
    '  <div class="code-head">',
    '    <span class="code-lang">' + label + '</span>',
    '    <span class="code-actions">',
    '      <button type="button" data-code="' + index + '" data-action="copy">复制</button>',
    '      <button type="button" data-code="' + index + '" data-action="download">下载</button>',
    '      <button type="button" data-code="' + index + '" data-action="play">送入演示</button>',
    '    </span>',
    '  </div>',
    '  <pre><code>' + escapeHtml(code) + '</code></pre>',
    '</div>'
  ].join('\n');
}

export function render(markdown) {
  const source = String(markdown || '');
  const blocks = [];
  // 先把围栏代码块挖出来，用占位符代替，避免里面的 markdown 语法被误解析
  const withoutCode = source.replace(/^```(\w*)\s*\n([\s\S]*?)^```/gm, (_, lang, code) => {
    const i = blocks.push({ lang: (lang || 'text').toLowerCase(), code: code.replace(/\n$/, '') }) - 1;
    return '\u0000CODEBLOCK' + i + '\u0000';
  });

  const lines = withoutCode.split('\n');
  const out = [];
  let listType = null;
  let tableRows = [];
  let paragraph = [];

  const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };
  const closeTable = () => {
    if (!tableRows.length) return;
    const rows = tableRows.filter(r => !/^\s*\|?[\s:\-|]+\|?\s*$/.test(r));
    if (rows.length) {
      out.push('<div class="table-wrap"><table>');
      rows.forEach((row, idx) => {
        const cells = row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
        const tag = idx === 0 ? 'th' : 'td';
        out.push('<tr>' + cells.map(c => '<' + tag + '>' + inline(escapeHtml(c)) + '</' + tag + '>').join('') + '</tr>');
      });
      out.push('</table></div>');
    }
    tableRows = [];
  };
  const flushParagraph = () => {
    if (paragraph.length) { out.push('<p>' + inline(escapeHtml(paragraph.join(' '))) + '</p>'); paragraph = []; }
  };
  const closeAll = () => { closeList(); closeTable(); flushParagraph(); };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^\u0000CODEBLOCK\d+\u0000$/.test(line.trim())) {
      closeAll();
      const idx = Number(line.trim().match(/CODEBLOCK(\d+)/)[1]);
      out.push(codeCard(blocks[idx].lang, blocks[idx].code, idx));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushParagraph(); closeList(); tableRows.push(line); continue; }
    else closeTable();

    if (/^\s*$/.test(line)) { closeAll(); continue; }

    const h = line.match(/^(#{2,4})\s+(.+)$/);
    if (h) { closeAll(); const n = Math.min(h[1].length, 4); out.push('<h' + n + '>' + inline(escapeHtml(h[2])) + '</h' + n + '>'); continue; }

    if (/^>\s?/.test(line)) { closeAll(); out.push('<blockquote>' + inline(escapeHtml(line.replace(/^>\s?/, ''))) + '</blockquote>'); continue; }

    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ul || ol) {
      flushParagraph(); closeTable();
      const want = ul ? 'ul' : 'ol';
      if (listType && listType !== want) closeList();
      if (!listType) { out.push('<' + want + '>'); listType = want; }
      out.push('<li>' + inline(escapeHtml((ul || ol)[1])) + '</li>');
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  closeAll();
  return out.join('\n');
}

// 与 prompt.parse 顺序一致，供代码块按钮取用
export function extractCodeBlocks(markdown) {
  const result = [];
  const re = /^```(\w*)\s*\n([\s\S]*?)^```/gm;
  let m;
  while ((m = re.exec(String(markdown || ''))) !== null) {
    result.push({ lang: (m[1] || 'text').toLowerCase(), code: m[2].replace(/\n$/, '') });
  }
  return result;
}
