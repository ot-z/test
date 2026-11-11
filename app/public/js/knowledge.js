// 知识点画像：统计、分组、增删改、预设模板、批量导入导出
import { get, post, friendlyError } from './api.js';
import { escapeHtml } from './md.js';
import { state, toast } from './state.js';

const $ = id => document.getElementById(id);
const LEVEL_TEXT = { mastered: '已掌握', seen: '接触过', unknown: '未学' };
let saveTimer = null;

export function initKnowledge() {
  fillPresets();
  $('btn-load-preset').addEventListener('click', () => loadPreset('merge'));
  $('btn-replace-preset').addEventListener('click', () => loadPreset('replace'));
  $('btn-add-k').addEventListener('click', addItem);
  $('k-name').addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });
  $('btn-toggle-import').addEventListener('click', () => $('import-box').classList.toggle('hidden'));
  $('btn-do-import').addEventListener('click', doImport);
  $('btn-export-k').addEventListener('click', exportJson);
  $('knowledge-groups').addEventListener('click', onGroupClick);
  $('knowledge-groups').addEventListener('change', onGroupChange);
  window.addEventListener('knowledge-changed', reload);
  window.addEventListener('view-changed', e => { if (e.detail.view === 'knowledge') reload(); });
  render();
}

function fillPresets() {
  const sel = $('preset-select');
  sel.innerHTML = '';
  for (const p of (state.knowledge.presets || [])) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + ' · ' + p.count + ' 条';
    sel.appendChild(opt);
  }
  const first = (state.knowledge.presets || [])[0];
  $('preset-hint').textContent = first ? first.description : '合并：只补充新条目，不改你已设置的等级';
  sel.addEventListener('change', () => {
    const p = (state.knowledge.presets || []).find(x => x.id === sel.value);
    if (p) $('preset-hint').textContent = p.description;
  });
}

async function reload() {
  try {
    const data = await get('/knowledge');
    state.knowledge = data;
    fillPresets();
    render();
  } catch (e) { toast(friendlyError(e), 'error'); }
}

function render() {
  const items = state.knowledge.items || [];
  const stats = state.knowledge.stats || { mastered: 0, seen: 0, unknown: 0, total: 0 };
  $('stat-row').innerHTML = [
    statCard('total', stats.total, '知识点总数'),
    statCard('mastered', stats.mastered, '已掌握 · 模型可自由使用'),
    statCard('seen', stats.seen, '接触过 · 需附注释'),
    statCard('unknown', stats.unknown, '未学 · 禁止悄悄使用')
  ].join('');

  const groups = {};
  for (const it of items) (groups[it.category] = groups[it.category] || []).push(it);
  const keys = Object.keys(groups).sort();
  if (!keys.length) {
    $('knowledge-groups').innerHTML = '<div class="card section-card"><div class="hint">画像还是空的。先在上面载入一个预设模板，或手动添加知识点。</div></div>';
    return;
  }
  $('knowledge-groups').innerHTML = keys.map(category => {
    const rows = groups[category].map(it => {
      const opts = Object.keys(LEVEL_TEXT).map(level =>
        '<option value="' + level + '"' + (it.level === level ? ' selected' : '') + '>' + LEVEL_TEXT[level] + '</option>'
      ).join('');
      return '<div class="k-row" data-id="' + escapeHtml(it.id) + '">' +
        '<div class="k-name"><span class="level-dot ' + it.level + '"></span>' + escapeHtml(it.name) +
        (it.note ? '<small>' + escapeHtml(it.note) + '</small>' : '') + '</div>' +
        '<select class="select" data-level>' + opts + '</select>' +
        '<button type="button" class="k-del" data-del title="删除">×</button></div>';
    }).join('');
    return '<div class="k-group"><div class="k-group-head"><span>' + escapeHtml(category) +
      '</span><span>' + groups[category].length + ' 条</span></div>' + rows + '</div>';
  }).join('');
}

function statCard(cls, num, label) {
  return '<div class="stat-card ' + cls + '"><div class="num">' + num + '</div><div class="label">' + label + '</div></div>';
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const data = await post('/knowledge', { items: state.knowledge.items });
      state.knowledge.items = data.items;
      state.knowledge.stats = data.stats;
      render();
    } catch (e) { toast(friendlyError(e), 'error'); }
  }, 250);
}

function onGroupChange(e) {
  const sel = e.target.closest('select[data-level]');
  if (!sel) return;
  const id = sel.closest('.k-row').dataset.id;
  const item = (state.knowledge.items || []).find(x => x.id === id);
  if (!item) return;
  item.level = sel.value;
  sel.closest('.k-name').querySelector('.level-dot').className = 'level-dot ' + item.level;
  queueSave();
}

function onGroupClick(e) {
  const btn = e.target.closest('button[data-del]');
  if (!btn) return;
  const id = btn.closest('.k-row').dataset.id;
  state.knowledge.items = (state.knowledge.items || []).filter(x => x.id !== id);
  queueSave();
  render();
}

function addItem() {
  const name = $('k-name').value.trim();
  if (!name) { toast('请填写知识点名称', 'error'); return; }
  const item = {
    id: 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    category: $('k-category').value.trim() || '自定义',
    level: $('k-level').value,
    note: ''
  };
  const dup = (state.knowledge.items || []).some(x => x.name === name && x.category === item.category);
  if (dup) { toast('同一分类下已存在这个知识点', 'error'); return; }
  state.knowledge.items.push(item);
  $('k-name').value = '';
  queueSave();
  render();
  toast('已添加「' + name + '」', 'success');
}

async function loadPreset(mode) {
  const id = $('preset-select').value;
  if (!id) { toast('请先选择模板', 'error'); return; }
  if (mode === 'replace' && !window.confirm('替换会清空当前画像里的所有等级设置，确定继续吗？')) return;
  try {
    const data = await post('/knowledge/preset', { id, mode });
    state.knowledge.items = data.items;
    state.knowledge.stats = data.stats;
    render();
    toast(mode === 'replace' ? '已替换为模板画像' : '模板已合并载入', 'success');
  } catch (e) { toast(friendlyError(e), 'error'); }
}

function doImport() {
  const lines = $('import-text').value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('没有可导入的内容', 'error'); return; }
  const levelMap = { '已掌握': 'mastered', '接触过': 'seen', '未学': 'unknown', mastered: 'mastered', seen: 'seen', unknown: 'unknown' };
  let added = 0;
  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim());
    const name = parts[0];
    if (!name) continue;
    const category = parts[1] || '自定义';
    const level = levelMap[parts[2] || ''] || 'unknown';
    const dup = state.knowledge.items.some(x => x.name === name && x.category === category);
    if (dup) continue;
    state.knowledge.items.push({
      id: 'k_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, category, level, note: ''
    });
    added++;
  }
  $('import-text').value = '';
  $('import-box').classList.add('hidden');
  queueSave();
  render();
  toast('导入完成，新增 ' + added + ' 条', 'success');
}

function exportJson() {
  const blob = new Blob([JSON.stringify({ updatedAt: new Date().toISOString(), items: state.knowledge.items }, null, 2)],
    { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'knowledge-profile.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('画像已导出', 'success');
}
