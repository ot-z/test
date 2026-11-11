// 代码生成 / 知识点解析 / 代码审查：输入、附件、结果渲染、超纲闭环、会话
import { get, post, del, friendlyError } from './api.js';
import { render, extractCodeBlocks, escapeHtml } from './md.js';
import { state, toast, switchView } from './state.js';

const TEXT_EXT = /\.(py|js|jsx|ts|tsx|html|htm|css|json|md|txt|java|c|cpp|h|cs|go|rb|php|sql|sh|xml|yaml|yml|ini|csv)$/i;
const MODE_TIP = {
  code: '按画像生成可运行代码',
  explain: '把代码贴进输入框，逐段解释用到的知识点',
  review: '把代码贴进输入框，找出越界写法并给出降级改写'
};
const EMPTY_HTML = `
  <div class="empty-state">
    <div class="empty-icon">◈</div>
    <h3>先告诉我你想做什么</h3>
    <p>生成结果会按「实现思路 → 代码 → 知识点对照 → 超纲清单 → 自测小题」展示。<br>
       凡是超出你画像的写法，都会被单独列成卡片，并附带讲解。</p>
    <div class="empty-chips">
      <button type="button" class="chip" data-sample="写一个统计单词出现次数的 Python 程序">统计单词次数</button>
      <button type="button" class="chip" data-sample="做一个输入名字后显示问候语的网页">问候网页</button>
      <button type="button" class="chip" data-sample="解释这段代码：for i in range(3): print(i)">解释一段代码</button>
    </div>
  </div>`;

let files = [];
let images = [];
let mode = 'code';
let busy = false;
const $ = id => document.getElementById(id);

export function initChat() {
  $('mode-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    mode = btn.dataset.mode;
    document.querySelectorAll('#mode-tabs .seg').forEach(b => b.classList.toggle('active', b === btn));
    updateTip();
  });
  $('file-input').addEventListener('change', onFiles);
  $('image-input').addEventListener('change', onImages);
  $('attachments').addEventListener('click', onAttachmentRemove);
  $('btn-generate').addEventListener('click', generate);
  $('question').addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') generate();
  });
  $('btn-new-session').addEventListener('click', () => {
    state.currentSessionId = null;
    $('result').innerHTML = EMPTY_HTML;
    renderSessions();
    toast('已新建会话');
  });
  $('session-list').addEventListener('click', onSessionClick);
  $('result').addEventListener('click', onResultClick);
  updateTip();
  renderSessions();
}

function updateTip() {
  let tip = MODE_TIP[mode];
  if (files.length) {
    const chars = files.reduce((n, f) => n + (f.content || '').length, 0);
    tip += ` · ${files.length} 个文件 / ${chars} 字符`;
  }
  if (images.length) tip += ` · ${images.length} 张图片，将自动使用视觉模型`;
  if (files.some(f => f.unsupported)) tip += ' · 有不支持的文件类型，请补充文字说明';
  $('composer-tip').textContent = tip;
}

// ---------------- 附件 ----------------
async function onFiles(e) {
  for (const f of Array.from(e.target.files || [])) {
    if (files.length >= 10) { toast('最多附加 10 个文件', 'error'); break; }
    if (!TEXT_EXT.test(f.name)) {
      files.push({ name: f.name, content: '', unsupported: true });
      continue;
    }
    try {
      const text = await f.text();
      files.push({ name: f.name, content: text.slice(0, 12000) });
    } catch (_) {
      files.push({ name: f.name, content: '', unsupported: true });
    }
  }
  e.target.value = '';
  renderAttachments();
}

async function onImages(e) {
  for (const f of Array.from(e.target.files || [])) {
    if (images.length >= 4) { toast('最多附加 4 张图片', 'error'); break; }
    if (f.size > 4 * 1024 * 1024) { toast('图片超过 4 MiB，请压缩后重试：' + f.name, 'error'); continue; }
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(f);
    });
    if (dataUrl) images.push({ name: f.name, dataUrl });
  }
  e.target.value = '';
  renderAttachments();
}

function renderAttachments() {
  const box = $('attachments');
  box.innerHTML = '';
  files.forEach((f, i) => box.appendChild(makeChip(
    (f.unsupported ? '⚠ ' : '📎 ') + f.name,
    f.unsupported ? '不支持解析' : (f.content.length + ' 字符'),
    'file', i, f.unsupported
  )));
  images.forEach((im, i) => box.appendChild(makeChip('🖼 ' + im.name, '图片', 'image', i, false)));
  updateTip();
}

function makeChip(label, meta, type, index, bad) {
  const el = document.createElement('span');
  el.className = 'attach-chip' + (bad ? ' bad' : '');
  const b = document.createElement('b');
  b.textContent = label;
  const small = document.createElement('span');
  small.textContent = meta;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '×';
  btn.dataset.type = type;
  btn.dataset.i = String(index);
  el.append(b, small, btn);
  return el;
}

function onAttachmentRemove(e) {
  const btn = e.target.closest('button[data-type]');
  if (!btn) return;
  const i = Number(btn.dataset.i);
  if (btn.dataset.type === 'file') files.splice(i, 1);
  else images.splice(i, 1);
  renderAttachments();
}

// ---------------- 生成 ----------------
async function generate() {
  if (busy) return;
  const question = $('question').value.trim();
  if (!question && !files.length && !images.length) {
    toast('请先输入问题，或附加文件 / 图片', 'error');
    return;
  }
  busy = true;
  const btn = $('btn-generate');
  btn.disabled = true;
  btn.textContent = '生成中…';
  $('result').innerHTML = '<div class="card result-card"><div class="alert alert-warn">正在按你的知识点画像生成，稍等几秒…（演示模式为即时返回）</div></div>';

  try {
    const data = await post('/generate', {
      question, mode,
      files: files.map(f => ({ name: f.name, content: f.content })),
      images,
      options: { language: $('language-select').value },
      sessionId: state.currentSessionId || ''
    });
    state.lastResult = data;
    state.currentSessionId = data.sessionId;
    state.codeBlocks = data.parsed.codeBlocks || [];
    renderResult(data);
    await renderSessions();
  } catch (e) {
    $('result').innerHTML = '<div class="card result-card"><div class="alert alert-error"><b>生成失败</b><br>' +
      escapeHtml(friendlyError(e)) + '</div></div>';
    toast(friendlyError(e), 'error');
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = '生成 ✦';
  }
}

function sourceLabel(source) {
  if (source === 'both') return '模型上报 + 本地扫描双重确认';
  if (source === 'scan') return '本地扫描发现（模型可能漏标）';
  return '模型主动标注';
}

function renderResult(data) {
  const suspects = (data.audit && data.audit.suspects ? data.audit.suspects : [])
    .filter(s => s.level !== 'mastered');
  const demo = data.mock;
  let html = '<div class="card result-card">';

  html += '<div class="result-meta">';
  html += '<span class="badge ' + (demo ? 'badge-warn' : 'badge-ok') + '">' + (demo ? '演示数据' : '真实模型生成') + '</span>';
  html += '<span class="badge badge-off">' + escapeHtml(data.model || '') + '</span>';
  html += '<span>知识点：已掌握 ' + (state.knowledge.stats ? state.knowledge.stats.mastered : 0) + ' 条</span>';
  html += '<span>超纲 ' + suspects.length + ' 处</span>';
  if (data.truncated) html += '<span class="badge badge-warn">附件过长已截断</span>';
  html += '</div>';

  if (demo) {
    html += '<div class="alert alert-warn">当前是<b>演示数据</b>（未配置 Key 或开启了演示模式）。到「设置」填写 API Key 并关闭演示模式，即可由模型按你的画像实时生成。</div>';
  }
  if (suspects.length) {
    html += '<div class="alert alert-warn">⚠ 发现 <b>' + suspects.length + '</b> 处超出画像的知识点。' +
      '下面每条都说明了「是什么 / 为什么必须用它 / 更基础的写法」。<br>' +
      '本地静态扫描只作为兜底，结果为<b>疑似越界</b>，请人工确认；确认学会后可一键加入画像。</div>';
  } else {
    html += '<div class="alert alert-ok">✓ 本次没有发现超出画像的写法，代码应都在你的已掌握范围内。</div>';
  }

  if (suspects.length) {
    html += '<div class="topic-list">' + suspects.map((s, i) => {
      let card = '<div class="topic-card"><div class="topic-head">';
      card += '<span class="level-dot unknown"></span><b>' + escapeHtml(s.topic) + '</b>';
      card += '<span class="source-badge ' + escapeHtml(s.source || '') + '">' + sourceLabel(s.source) + '</span>';
      if (s.line) card += '<span class="hint">第 ' + s.line + ' 行</span>';
      card += '</div>';
      if (s.explain) card += '<p>💡 ' + escapeHtml(s.explain) + '</p>';
      if (s.reason) card += '<p>为什么需要：' + escapeHtml(s.reason) + '</p>';
      if (s.snippet) card += '<div class="snippet">' + escapeHtml(s.snippet) + '</div>';
      if (s.hint) card += '<p>更基础的写法：' + escapeHtml(s.hint) + '</p>';
      card += '<div class="row-end"><button type="button" class="btn btn-mini btn-learned" data-action="mastered" data-i="' + i +
        '" data-topic="' + escapeHtml(s.topic) + '">我已学会 → 加入已掌握</button></div></div>';
      return card;
    }).join('') + '</div>';
  }

  html += '<div class="md-body">' + render(data.raw) + '</div>';
  html += '</div>';
  $('result').innerHTML = html;
}

function renderHistory(markdown) {
  state.codeBlocks = extractCodeBlocks(markdown);
  $('result').innerHTML = '<div class="card result-card">' +
    '<div class="alert alert-warn">这是历史会话的原文回放（超纲卡片与扫描结果不保存，如需请重新生成）。</div>' +
    '<div class="md-body">' + render(markdown) + '</div></div>';
}

// ---------------- 结果区交互 ----------------
async function onResultClick(e) {
  const sample = e.target.closest('.chip[data-sample]');
  if (sample) {
    $('question').value = sample.dataset.sample;
    $('question').focus();
    return;
  }
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'mastered') {
    const name = btn.dataset.topic;
    btn.disabled = true;
    btn.textContent = '正在加入…';
    try {
      const data = await post('/knowledge/mastered', { name });
      state.knowledge.items = data.items;
      state.knowledge.stats = data.stats;
      btn.textContent = '✓ 已加入已掌握';
      toast('「' + name + '」已加入，下次生成会放宽约束', 'success');
      window.dispatchEvent(new Event('knowledge-changed'));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '重试加入';
      toast(friendlyError(err), 'error');
    }
    return;
  }

  const idx = Number(btn.dataset.code);
  const block = state.codeBlocks[idx];
  if (!block) { toast('找不到对应的代码块', 'error'); return; }

  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(block.code);
      toast('代码已复制到剪贴板', 'success');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = block.code;
      document.body.appendChild(ta);
      ta.select();
      const done = document.execCommand('copy');
      ta.remove();
      toast(done ? '代码已复制' : '复制失败，请手动选中代码', done ? 'success' : 'error');
    }
  } else if (action === 'download') {
    const ext = { python: 'py', javascript: 'js', html: 'html', css: 'css', java: 'java', c: 'c', cpp: 'cpp', sql: 'sql' }[block.lang] || 'txt';
    const blob = new Blob([block.code], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'study-code.' + ext;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast('已下载 study-code.' + ext, 'success');
  } else if (action === 'play') {
    const lang = ['python', 'javascript', 'html'].includes(block.lang) ? block.lang : '';
    if (!lang) { toast('该语言暂不支持在线运行，可复制后在本地运行', 'error'); return; }
    window.dispatchEvent(new CustomEvent('play-code', { detail: { lang, code: block.code } }));
    switchView('playground');
  }
}

// ---------------- 会话列表 ----------------
async function renderSessions() {
  try {
    const data = await get('/sessions');
    state.sessions = data.sessions || [];
  } catch (_) { return; }
  const list = $('session-list');
  list.innerHTML = '';
  if (!state.sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'session-empty';
    empty.textContent = '还没有会话，生成一次就会出现在这里。';
    list.appendChild(empty);
    return;
  }
  for (const s of state.sessions) {
    const row = document.createElement('div');
    row.className = 'session-item' + (s.id === state.currentSessionId ? ' active' : '');
    row.dataset.id = s.id;
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = s.title || '未命名会话';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '×';
    delBtn.dataset.del = s.id;
    delBtn.title = '删除会话';
    row.append(txt, delBtn);
    list.appendChild(row);
  }
}

async function onSessionClick(e) {
  const row = e.target.closest('.session-item');
  if (!row) return;
  if (e.target.closest('button[data-del]')) {
    try {
      await del('/sessions/' + row.dataset.id);
      if (state.currentSessionId === row.dataset.id) {
        state.currentSessionId = null;
        $('result').innerHTML = EMPTY_HTML;
      }
      await renderSessions();
      toast('会话已删除');
    } catch (err) { toast(friendlyError(err), 'error'); }
    return;
  }
  try {
    const data = await get('/sessions/' + row.dataset.id);
    state.currentSessionId = row.dataset.id;
    const last = [...(data.session.messages || [])].reverse().find(m => m.role === 'assistant');
    renderHistory(last ? last.content : '（这个会话还没有回答）');
    await renderSessions();
  } catch (err) { toast(friendlyError(err), 'error'); }
}
