// 全局状态 + 通用 UI 工具（各视图模块共享，避免循环依赖）
import { get } from './api.js';

export const state = {
  config: null,
  knowledge: { items: [], stats: { mastered: 0, seen: 0, unknown: 0, total: 0 }, presets: [] },
  sessions: [],
  currentSessionId: null,
  view: 'chat',
  lastResult: null,
  codeBlocks: []
};

const VIEW_META = {
  chat: { title: '代码生成', desc: '描述需求，生成限定在已掌握知识点内的代码' },
  knowledge: { title: '知识点画像', desc: '维护「我会什么」，它就是模型的代码白名单' },
  playground: { title: '代码演示', desc: '在隔离环境里运行代码，看看它到底做了什么' },
  settings: { title: '设置', desc: '配置模型、API Key 与本机执行开关' }
};

let toastTimer = null;
export function toast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show' + (type === 'error' || type === 'success' ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

export function setNotice(id, text, kind = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'notice' + (kind ? ' ' + kind : '');
}

export async function refreshStatus() {
  const c = await get('/config');
  state.config = c;
  const model = document.getElementById('badge-model');
  const mock = document.getElementById('badge-mock');
  const key = document.getElementById('badge-key');
  const side = document.getElementById('side-status');
  if (model) model.textContent = '模型：' + (c.model || '—');
  if (mock) {
    const demo = c.mock || !c.hasKey;
    mock.textContent = demo ? '演示模式' : '真实模型';
    mock.className = 'badge ' + (demo ? 'badge-warn' : 'badge-ok');
  }
  if (key) {
    key.textContent = c.hasKey ? 'Key 已配置' : '未配置 Key';
    key.className = 'badge ' + (c.hasKey ? 'badge-ok' : 'badge-off');
  }
  if (side) side.textContent = '● 本地服务已连接';
  return c;
}

export function switchView(name) {
  if (!VIEW_META[name]) return;
  state.view = name;
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + name);
  });
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  const meta = VIEW_META[name];
  document.getElementById('view-title').textContent = meta.title;
  document.getElementById('view-desc').textContent = meta.desc;
  window.dispatchEvent(new CustomEvent('view-changed', { detail: { view: name } }));
}
