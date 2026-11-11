'use strict';

// L3 后验静态扫描：不依赖模型自觉，逐行检查生成代码里是否出现"进阶语法特征"。
// 命中且画像中没有标记为 mastered → 疑似越界（交由人工确认）。
const { FEATURES, normalizeName } = require('./presets');

function masteredSet(items) {
  const set = new Set();
  for (const it of (items || [])) {
    if (it.level === 'mastered') set.add(normalizeName(it.name));
  }
  return set;
}

function langFamily(lang) {
  const l = String(lang || '').toLowerCase();
  if (['python', 'py'].includes(l)) return 'python';
  if (['javascript', 'js', 'html', 'css', 'node'].includes(l)) return 'javascript';
  return 'all';
}

function scanCodeBlocks(codeBlocks, items) {
  const mastered = masteredSet(items);
  const hits = [];
  for (const block of (codeBlocks || [])) {
    const family = langFamily(block.lang);
    const lines = String(block.code || '').split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // 纯注释行跳过：避免 [K] 注释里提到知识点名造成误报
      if (/^(#|\/\/|<!--|\/\*|\*)/.test(trimmed)) return;
      for (const f of FEATURES) {
        if (family !== 'all' && f.lang !== family) continue;
        let matched = false;
        try { matched = f.pattern.test(line); } catch (_) { /* 忽略异常正则 */ }
        if (!matched) continue;
        if (mastered.has(normalizeName(f.topic))) continue;
        const dup = hits.find(h => h.topic === f.topic && h.line === idx + 1);
        if (dup) continue;
        hits.push({
          topic: f.topic, line: idx + 1, lang: f.lang,
          snippet: trimmed.slice(0, 120), hint: f.hint, source: 'scan'
        });
      }
    });
  }
  return hits;
}

// 合并「模型主动上报」与「本地扫描命中」，同名知识点去重并标记来源。
function mergeSuspects(scanHits, modelTopics, items) {
  const mastered = masteredSet(items);
  const result = [];
  const seen = new Set();

  for (const t of (modelTopics || [])) {
    const name = String(t.name || '').trim();
    if (!name || seen.has(normalizeName(name))) continue;
    seen.add(normalizeName(name));
    result.push({
      topic: name, line: 0, snippet: '', hint: '',
      reason: t.reason || '', explain: t.explain || '',
      source: 'model', level: mastered.has(normalizeName(name)) ? 'mastered' : 'unknown'
    });
  }
  for (const h of (scanHits || [])) {
    const key = normalizeName(h.topic);
    const existing = result.find(r => normalizeName(r.topic) === key);
    if (existing) {
      existing.source = 'both';
      if (!existing.line) { existing.line = h.line; existing.snippet = h.snippet; existing.hint = h.hint; }
    } else {
      seen.add(key);
      result.push(Object.assign({}, h, { level: 'unknown' }));
    }
  }
  return result;
}

function audit(rawOrBlocks, items, modelTopics) {
  const blocks = Array.isArray(rawOrBlocks)
    ? rawOrBlocks
    : [{ lang: 'text', code: String(rawOrBlocks || '') }];
  const scanHits = scanCodeBlocks(blocks, items);
  const suspects = mergeSuspects(scanHits, modelTopics || [], items);
  return {
    suspects,
    passed: suspects.filter(s => s.level === 'unknown').length === 0,
    scanFound: scanHits.length,
    modelReported: (modelTopics || []).length,
    note: '正则扫描存在误报与漏报，结果仅为「疑似越界」，请人工确认。'
  };
}

module.exports = { scanCodeBlocks, mergeSuspects, audit, masteredSet, langFamily };
