'use strict';

// DeepSeek（OpenAI 兼容）调用封装：统一错误分类 + 演示模式降级
const prompt = require('./prompt');

function fail(code, message, detail) {
  const e = new Error(message);
  e.code = code;
  if (detail) e.detail = String(detail).slice(0, 500);
  return e;
}

function endpoint(config) {
  const base = String(config.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  return base + '/chat/completions';
}

function bodyOf(config, messages, extra) {
  return Object.assign({
    model: config.model || 'deepseek-flash',
    messages,
    temperature: Number(config.temperature) || 0,
    thinking: { type: config.thinking ? 'enabled' : 'disabled' },
    stream: false
  }, extra || {});
}

async function request(config, messages, extra) {
  const key = (config.apiKey || '').trim();
  if (!key) throw fail('NO_KEY', '还没有配置 API Key。请在「设置」页填写，或保持「演示模式」体验完整流程。');

  let res;
  try {
    res = await fetch(endpoint(config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify(bodyOf(config, messages, extra)),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw fail('TIMEOUT', '模型响应超时（60 秒）。可以稍后重试，或把问题拆小一点。');
    }
    throw fail('UPSTREAM', '无法连接模型服务：' + (e.message || '网络错误') + '。请检查网络与 baseUrl。');
  }

  let data;
  const text = await res.text();
  try { data = JSON.parse(text); } catch (_) { data = null; }

  if (!res.ok) {
    const upstream = data && data.error && data.error.message ? data.error.message : text.slice(0, 300);
    if (res.status === 401 || res.status === 402 || /api.?key|invalid.*key|authentication/i.test(upstream)) {
      throw fail('BAD_KEY', 'API Key 无效或余额不足（HTTP ' + res.status + '）。请到「设置」页检查。', upstream);
    }
    if (res.status === 429) {
      throw fail('RATE_LIMIT', '请求太频繁或额度受限（HTTP 429）。稍等一会儿再试。', upstream);
    }
    if (res.status === 400) {
      if (/image|vision|multimodal|does not support/i.test(upstream)) {
        throw fail('BAD_REQUEST', '当前模型不接受图片输入。请在「设置」页把「视觉模型」改为支持图片的模型（当前官方为 deepseek-flash），或改用文字描述需求。', upstream);
      }
      throw fail('BAD_REQUEST', '模型拒绝了这次请求（HTTP 400）：' + upstream, upstream);
    }
    throw fail('UPSTREAM', '模型服务返回错误（HTTP ' + res.status + '）：' + upstream, upstream);
  }

  if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
    throw fail('UPSTREAM', '模型返回的数据格式异常，无法读取回答内容。', text.slice(0, 300));
  }
  const msg = data.choices[0].message;
  return {
    content: String(msg.content || ''),
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 },
    model: data.model || config.model
  };
}

// 统一入口：演示模式直接返回内置示例，不发起任何网络请求。
async function generate(config, messages, input) {
  if (config.mock || !config.apiKey) return prompt.mockAnswer(input || {});
  return request(config, messages);
}

async function testConnection(config) {
  const key = (config.apiKey || '').trim();
  if (!key) throw fail('NO_KEY', '请先填写 API Key 再测试连接。');
  // 连通性测试始终走真实请求，不受「演示模式」开关影响，也不修改用户配置。
  const started = Date.now();
  const result = await request(config, [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: '请只回复两个字：正常' }
  ], { temperature: 0, thinking: { type: 'disabled' } });
  return { ok: true, latencyMs: Date.now() - started, model: result.model, reply: result.content.slice(0, 50) };
}

module.exports = { request, generate, testConnection, fail, endpoint };
