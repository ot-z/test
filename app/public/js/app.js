// 入口：加载初始数据 → 初始化各视图 → 绑定导航
import { get } from './api.js';
import { state, refreshStatus, switchView, toast } from './state.js';
import { initChat } from './chat.js';
import { initKnowledge } from './knowledge.js';
import { initPlayground } from './playground.js';
import { initSettings } from './settings.js';

async function boot() {
  try {
    await refreshStatus();
    const [knowledge, sessions] = await Promise.all([get('/knowledge'), get('/sessions')]);
    state.knowledge = knowledge;
    state.sessions = sessions.sessions || [];

    initChat();
    initKnowledge();
    initPlayground();
    initSettings();

    document.getElementById('nav').addEventListener('click', e => {
      const btn = e.target.closest('.nav-item');
      if (btn) switchView(btn.dataset.view);
    });
  } catch (e) {
    const side = document.getElementById('side-status');
    if (side) { side.textContent = '● 连接失败'; side.style.color = '#dc2626'; }
    toast('初始化失败：' + (e.message || e), 'error');
    console.error('[boot]', e);
  }
}

boot();
