// 统一请求封装：把服务端的 {ok,data,error} 结构转成 Promise / Error
export async function api(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  };
  let response;
  try {
    response = await fetch('/api' + path, init);
  } catch (e) {
    throw new Error('无法连接本地服务，请确认 node app/server.js 正在运行。');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw new Error('服务器返回了无法解析的内容（HTTP ' + response.status + '）。');
  }
  if (!payload.ok) {
    const info = payload.error || {};
    const error = new Error(info.message || '请求失败');
    error.code = info.code || 'UNKNOWN';
    error.detail = info.detail || '';
    throw error;
  }
  return payload.data;
}

export const get = path => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: body || {} });
export const del = path => api(path, { method: 'DELETE' });

export function friendlyError(e) {
  let msg = e && e.message ? e.message : String(e);
  if (e && e.code === 'NO_KEY') msg += '（设置 → 填写 API Key 并关闭演示模式）';
  if (e && e.code === 'BAD_KEY') msg += '（设置 → 检查 Key 是否正确、账户是否有余额）';
  if (e && e.code === 'RUNNER_DISABLED') msg += '（设置 → 开启本机 Python 执行）';
  return msg;
}
