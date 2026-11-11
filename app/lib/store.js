'use strict';

// 本地 JSON 持久化：原子写（先写 .tmp 再 rename），避免写一半损坏数据。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const presets = require('./presets');

const DATA_DIR = path.join(__dirname, '..', 'data');

const DEFAULT_CONFIG = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  visionModel: 'deepseek-flash',
  temperature: 0.3,
  thinking: false,
  mock: true,
  enableRunner: false,
  maxFileChars: 12000,
  maxTotalChars: 24000
};

function uid(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function read(name, fallback) {
  ensureDir();
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(fallback, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(fallback));
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // 文件损坏时备份一份，避免直接丢数据
    try { fs.copyFileSync(p, p + '.broken'); } catch (_) {}
    fs.writeFileSync(p, JSON.stringify(fallback, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(fallback));
  }
}

function write(name, value) {
  ensureDir();
  const p = filePath(name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  return value;
}

// ---------------- 配置 ----------------
function getConfig() {
  const c = read('config.json', DEFAULT_CONFIG);
  return Object.assign({}, DEFAULT_CONFIG, c);
}

function saveConfig(patch) {
  const old = getConfig();
  const next = Object.assign({}, old);
  const allowed = ['baseUrl', 'model', 'visionModel', 'temperature', 'thinking',
    'mock', 'enableRunner', 'maxFileChars', 'maxTotalChars', 'apiKey'];
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    // 空字符串表示「不修改已有 Key」，防止前端脱敏展示后把真 Key 覆盖掉
    if (k === 'apiKey' && patch[k] === '') continue;
    next[k] = patch[k];
  }
  next.baseUrl = String(next.baseUrl || DEFAULT_CONFIG.baseUrl).replace(/\/+$/, '');
  next.temperature = Math.min(2, Math.max(0, Number(next.temperature) || 0));
  next.maxFileChars = Math.max(1000, Number(next.maxFileChars) || 12000);
  next.maxTotalChars = Math.max(2000, Number(next.maxTotalChars) || 24000);
  write('config.json', next);
  return next;
}

function publicConfig() {
  const c = getConfig();
  const out = Object.assign({}, c);
  const key = c.apiKey || '';
  out.hasKey = key.length > 0;
  out.apiKeyMasked = key ? key.slice(0, 3) + '****' + key.slice(-4) : '';
  delete out.apiKey; // 明文 Key 永不返回给浏览器
  return out;
}

// ---------------- 知识点画像 ----------------
// 首次启动给一份可用的默认画像，避免「已掌握：暂无」让模型几乎无法写代码。
// 用户可在知识点画像页一键换成别的模板或清空。
function defaultKnowledge() {
  const items = presets.presetItems('python-basic').map(i => Object.assign({ id: uid('k_') }, i));
  return { updatedAt: new Date().toISOString(), items };
}

function getKnowledge() {
  const k = read('knowledge.json', defaultKnowledge());
  if (!Array.isArray(k.items)) k.items = [];
  return k;
}

function knowledgeStats(items) {
  const s = { mastered: 0, seen: 0, unknown: 0, total: items.length };
  for (const it of items) if (s[it.level] !== undefined) s[it.level]++;
  return s;
}

function saveKnowledge(items) {
  if (!Array.isArray(items)) throw new Error('items 必须是数组');
  const seen = new Set();
  const cleaned = [];
  for (const it of items) {
    const name = String(it.name || '').trim();
    const category = String(it.category || '未分类').trim();
    if (!name) continue;
    const level = ['mastered', 'seen', 'unknown'].includes(it.level) ? it.level : 'unknown';
    const dedup = category + '::' + presets.normalizeName(name);
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    cleaned.push({
      id: it.id || uid('k_'), name: name.slice(0, 60), category: category.slice(0, 60),
      level, note: String(it.note || '').slice(0, 200)
    });
  }
  return write('knowledge.json', { updatedAt: new Date().toISOString(), items: cleaned });
}

function loadPreset(id, mode) {
  const incoming = presets.presetItems(id);
  if (!incoming) throw new Error('未知的模板：' + id);
  const current = mode === 'replace' ? [] : getKnowledge().items.slice();
  const map = new Map(current.map(i => [i.category + '::' + presets.normalizeName(i.name), i]));
  for (const item of incoming) {
    const key = item.category + '::' + presets.normalizeName(item.name);
    if (!map.has(key)) map.set(key, Object.assign({ id: uid('k_') }, item));
  }
  return saveKnowledge(Array.from(map.values()));
}

function addMastered(name, category) {
  const k = getKnowledge();
  const norm = presets.normalizeName(name);
  // 先按名称找（忽略分类）：超纲卡片来自模型输出，通常不带分类信息。
  // 命中就地把原有条目标为已掌握，避免出现同名重复条目。
  const found = k.items.filter(i => presets.normalizeName(i.name) === norm);
  if (found.length) {
    found.forEach(i => { i.level = 'mastered'; });
  } else {
    k.items.push({ id: uid('k_'), name: String(name).slice(0, 60), category: category || '自定义', level: 'mastered', note: '由超纲卡片一键加入' });
  }
  return write('knowledge.json', Object.assign(k, { updatedAt: new Date().toISOString() }));
}

// ---------------- 会话 ----------------
function getSessions() {
  const s = read('sessions.json', { sessions: [] });
  if (!Array.isArray(s.sessions)) s.sessions = [];
  return s;
}

function listSessions() {
  return getSessions().sessions
    .map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: (s.messages || []).length }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getSession(id) {
  return getSessions().sessions.find(s => s.id === id) || null;
}

function saveSession(session) {
  const all = getSessions();
  const idx = all.sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) all.sessions[idx] = session;
  else all.sessions.push(session);
  // 只保留最近 50 个会话
  all.sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  all.sessions = all.sessions.slice(0, 50);
  write('sessions.json', all);
  return session;
}

function deleteSession(id) {
  const all = getSessions();
  const before = all.sessions.length;
  all.sessions = all.sessions.filter(s => s.id !== id);
  write('sessions.json', all);
  return { deleted: before - all.sessions.length };
}

module.exports = {
  DATA_DIR, DEFAULT_CONFIG, uid,
  getConfig, saveConfig, publicConfig,
  getKnowledge, knowledgeStats, saveKnowledge, loadPreset, addMastered,
  getSessions, listSessions, getSession, saveSession, deleteSession
};
