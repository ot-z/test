// 设置页：模型、Key、演示模式、Python 执行开关、连通性测试
import { get, post, friendlyError } from './api.js';
import { state, toast, refreshStatus, setNotice } from './state.js';

const $ = id => document.getElementById(id);

export function initSettings() {
  fillForm(state.config || {});
  $('cfg-temp').addEventListener('input', () => { $('temp-value').textContent = $('cfg-temp').value; });
  $('btn-toggle-key').addEventListener('click', () => {
    const input = $('cfg-key');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('btn-toggle-key').textContent = show ? '隐藏' : '显示';
  });
  $('btn-save-cfg').addEventListener('click', save);
  $('btn-test-conn').addEventListener('click', testConnection);
  window.addEventListener('view-changed', async e => {
    if (e.detail.view !== 'settings') return;
    try { fillForm(await get('/config')); } catch (_) {}
  });
}

function fillForm(c) {
  $('cfg-key').value = '';
  $('cfg-key').placeholder = c.apiKeyMasked ? ('已保存：' + c.apiKeyMasked + '（留空不修改）') : 'sk-...';
  $('cfg-base').value = c.baseUrl || 'https://api.deepseek.com';
  $('cfg-model').value = c.model || 'deepseek-flash';
  $('cfg-vision').value = c.visionModel || 'deepseek-flash';
  $('cfg-temp').value = c.temperature != null ? c.temperature : 0.3;
  $('temp-value').textContent = $('cfg-temp').value;
  $('cfg-thinking').checked = !!c.thinking;
  $('cfg-mock').checked = !!c.mock;
  $('cfg-runner').checked = !!c.enableRunner;
  setNotice('settings-notice', '');
}

async function save() {
  const payload = {
    apiKey: $('cfg-key').value.trim(), // 留空 → 服务端保留原 Key
    baseUrl: $('cfg-base').value.trim(),
    model: $('cfg-model').value.trim() || 'deepseek-flash',
    visionModel: $('cfg-vision').value.trim() || 'deepseek-flash',
    temperature: Number($('cfg-temp').value),
    thinking: $('cfg-thinking').checked,
    mock: $('cfg-mock').checked,
    enableRunner: $('cfg-runner').checked
  };
  try {
    const data = await post('/config', payload);
    state.config = data;
    await refreshStatus();
    fillForm(data);
    setNotice('settings-notice', '设置已保存到 app/data/config.json。' +
      (payload.enableRunner ? '本机 Python 执行已开启，请只运行自己看得懂的代码。' : ''), 'success');
    toast('设置已保存', 'success');
  } catch (e) {
    setNotice('settings-notice', friendlyError(e), 'error');
    toast(friendlyError(e), 'error');
  }
}

async function testConnection() {
  const btn = $('btn-test-conn');
  btn.disabled = true;
  btn.textContent = '测试中…';
  setNotice('settings-notice', '正在向模型发送一条最短请求…');
  try {
    const data = await post('/config/test', {});
    setNotice('settings-notice', '连接成功 · ' + data.latencyMs + ' ms · 模型 ' + data.model +
      ' · 回复「' + (data.reply || '').trim() + '」', 'success');
    toast('连接成功', 'success');
  } catch (e) {
    setNotice('settings-notice', friendlyError(e) + (e.detail ? '（' + e.detail + '）' : ''), 'error');
    toast('连接失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}
