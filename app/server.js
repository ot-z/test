'use strict';

// 学习助手 · 本地服务
// 零第三方依赖：只用 Node 内置模块。启动：node app/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const store = require('./lib/store');
const prompt = require('./lib/prompt');
const guard = require('./lib/guard');
const deepseek = require('./lib/deepseek');
const runner = require('./lib/runner');
const presets = require('./lib/presets');

const BASE_PORT = Number(process.env.PORT) || 5188; // 8765 常被其他本机服务占用，默认改用 5188
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 20 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
const ok = (res, data) => json(res, 200, { ok: true, data: data === undefined ? null : data });
function bad(res, e) {
  const code = e && e.code ? e.code : 'INTERNAL';
  const message = e && e.message ? e.message : '服务器内部错误';
  const status = { NO_KEY: 400, BAD_KEY: 401, RATE_LIMIT: 429, BAD_REQUEST: 400,
    INVALID_INPUT: 400, RUNNER_DISABLED: 403, RUNNER_TIMEOUT: 408, NOT_FOUND: 404 }[code] || 500;
  if (code === 'INTERNAL') console.error('[server]', message, e && e.stack ? e.stack.split('\n')[1] : '');
  json(res, status, { ok: false, error: { code, message, detail: e && e.detail ? e.detail : undefined } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大（上限 20 MiB，请减少或压缩图片）'), { code: 'INVALID_INPUT' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'INVALID_INPUT' })); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.resolve(PUBLIC_DIR, '.' + rel);
  // 路径穿越防护：必须位于 public 目录内
  if (!target.startsWith(PUBLIC_DIR + path.sep)) {
    return bad(res, Object.assign(new Error('非法路径'), { code: 'NOT_FOUND' }));
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) return bad(res, Object.assign(new Error('文件不存在：' + rel), { code: 'NOT_FOUND' }));
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  });
}

// ---------------- 输入清洗 ----------------
const TEXT_EXT = /\.(py|js|jsx|ts|tsx|html|htm|css|json|md|txt|java|c|cpp|h|cs|go|rb|php|sql|sh|bat|xml|yaml|yml|ini|csv)$/i;

function cleanInput(body) {
  const cfg = store.getConfig();
  const question = String(body.question || '').trim().slice(0, 6000);
  const mode = ['code', 'explain', 'review'].includes(body.mode) ? body.mode : 'code';
  const rawFiles = Array.isArray(body.files) ? body.files : [];
  const files = [];
  let used = 0;
  let truncated = false;
  for (const f of rawFiles.slice(0, 10)) {
    const name = String(f.name || 'unnamed').slice(0, 120);
    let content = String(f.content || '');
    if (!TEXT_EXT.test(name)) {
      files.push({ name, content: '（该类型的文件内容不会被读取，请在问题中补充文字说明）' });
      continue;
    }
    if (content.length > cfg.maxFileChars) { content = content.slice(0, cfg.maxFileChars) + '\n…（文件过长已截断）'; truncated = true; }
    const left = cfg.maxTotalChars - used;
    if (left <= 0) { truncated = true; break; }
    if (content.length > left) { content = content.slice(0, left) + '\n…（附件总长度已截断）'; truncated = true; }
    used += content.length;
    files.push({ name, content });
  }
  const images = [];
  for (const im of (Array.isArray(body.images) ? body.images : []).slice(0, 4)) {
    const name = String(im.name || 'image').slice(0, 120);
    const dataUrl = String(im.dataUrl || '');
    const m = dataUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw Object.assign(new Error('图片格式不支持，仅接受 PNG / JPEG / GIF / WebP：' + name), { code: 'INVALID_INPUT' });
    if (m[2].length * 0.75 > MAX_IMAGE) {
      throw Object.assign(new Error('图片超过 4 MiB：' + name + '。请压缩后重试。'), { code: 'INVALID_INPUT' });
    }
    images.push({ name, dataUrl });
  }
  if (!question && !files.length && !images.length) {
    throw Object.assign(new Error('请至少输入问题，或上传文件 / 图片。'), { code: 'INVALID_INPUT' });
  }
  return {
    question, mode, files, images, truncated,
    options: { language: String((body.options || {}).language || '').slice(0, 30) },
    sessionId: String(body.sessionId || '').slice(0, 40)
  };
}

// ---------------- 路由 ----------------
async function handleApi(req, res, pathname) {
  const method = req.method.toUpperCase();
  const body = ['POST', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : {};
  const parts = pathname.split('/').filter(Boolean); // ['api', 'xxx', ...]

  if (pathname === '/api/health' && method === 'GET') {
    const c = store.getConfig();
    return ok(res, { status: 'ok', version: '1.0.0', node: process.version,
      hasKey: !!c.apiKey, mock: !!c.mock, runner: !!c.enableRunner,
      host: HOST, port: server.address() ? server.address().port : BASE_PORT });
  }

  if (pathname === '/api/config' && method === 'GET') return ok(res, store.publicConfig());
  if (pathname === '/api/config' && method === 'POST') {
    store.saveConfig(body);
    return ok(res, store.publicConfig());
  }
  if (pathname === '/api/config/test' && method === 'POST') return ok(res, await deepseek.testConnection(store.getConfig()));

  if (pathname === '/api/knowledge' && method === 'GET') {
    const k = store.getKnowledge();
    return ok(res, { items: k.items, updatedAt: k.updatedAt, stats: store.knowledgeStats(k.items), presets: presets.presetList() });
  }
  if (pathname === '/api/knowledge' && method === 'POST') {
    const saved = store.saveKnowledge(body.items || []);
    return ok(res, { items: saved.items, stats: store.knowledgeStats(saved.items), updatedAt: saved.updatedAt });
  }
  if (pathname === '/api/knowledge/preset' && method === 'POST') {
    const saved = store.loadPreset(String(body.id || ''), body.mode === 'replace' ? 'replace' : 'merge');
    return ok(res, { items: saved.items, stats: store.knowledgeStats(saved.items) });
  }
  if (pathname === '/api/knowledge/mastered' && method === 'POST') {
    if (!String(body.name || '').trim()) throw Object.assign(new Error('知识点名称不能为空'), { code: 'INVALID_INPUT' });
    const saved = store.addMastered(body.name, body.category || '自定义');
    return ok(res, { items: saved.items, stats: store.knowledgeStats(saved.items) });
  }

  if (pathname === '/api/sessions' && method === 'GET') return ok(res, { sessions: store.listSessions() });
  if (parts[1] === 'sessions' && parts[2] && method === 'GET') {
    const s = store.getSession(parts[2]);
    if (!s) throw Object.assign(new Error('会话不存在'), { code: 'NOT_FOUND' });
    return ok(res, { session: s });
  }
  if (parts[1] === 'sessions' && parts[2] && method === 'DELETE') {
    return ok(res, store.deleteSession(parts[2]));
  }

  if (pathname === '/api/generate' && method === 'POST') {
    const input = cleanInput(body);
    const cfg = store.getConfig();
    const knowledge = store.getKnowledge();
    const system = prompt.buildSystem(knowledge.items, input.mode);
    const userText = prompt.buildUser(input);

    let session = input.sessionId ? store.getSession(input.sessionId) : null;
    if (!session) {
      session = { id: store.uid('s_'), title: (input.question || (input.images.length ? '图片提问' : '附件提问')).slice(0, 26),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
    }
    const history = (session.messages || []).slice(-6).map(m => ({ role: m.role, content: m.content }));
    const messages = [{ role: 'system', content: system }, ...history];

    const modelCfg = Object.assign({}, cfg);
    if (input.images.length) {
      const content = [{ type: 'text', text: userText }];
      for (const im of input.images) content.push({ type: 'image_url', image_url: { url: im.dataUrl } });
      messages.push({ role: 'user', content });
      modelCfg.model = cfg.visionModel || cfg.model; // 图片场景切到视觉模型
    } else {
      messages.push({ role: 'user', content: userText });
    }

    const answer = await deepseek.generate(modelCfg, messages, input);
    const parsed = prompt.parse(answer.content);
    const audit = guard.audit(parsed.codeBlocks, knowledge.items, parsed.newTopics);

    const now = new Date().toISOString();
    session.messages.push({ role: 'user', content: (input.question || '（见附件/图片）').slice(0, 2000) });
    session.messages.push({ role: 'assistant', content: answer.content });
    session.updatedAt = now;
    store.saveSession(session);

    return ok(res, {
      sessionId: session.id, title: session.title,
      mock: !!cfg.mock || !cfg.apiKey,
      model: answer.model,
      raw: answer.content,
      parsed, audit,
      usage: answer.usage,
      truncated: input.truncated
    });
  }

  if (pathname === '/api/audit' && method === 'POST') {
    const blocks = Array.isArray(body.codeBlocks) ? body.codeBlocks
      : [{ lang: String(body.lang || 'text'), code: String(body.code || '') }];
    const k = store.getKnowledge();
    const parsed = blocks.map(b => ({ lang: b.lang, code: b.code }));
    return ok(res, guard.audit(parsed, k.items, body.newTopics || []));
  }

  if (pathname === '/api/run' && method === 'POST') {
    const lang = String(body.lang || '').toLowerCase();
    if (lang !== 'python' && lang !== 'py') {
      throw Object.assign(new Error('本机执行目前只支持 Python；HTML / JavaScript 请在浏览器沙箱中运行。'), { code: 'INVALID_INPUT' });
    }
    return ok(res, await runner.runPython(body.code, store.getConfig()));
  }

  throw Object.assign(new Error('接口不存在：' + pathname), { code: 'NOT_FOUND' });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname || '/';
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw Object.assign(new Error('不支持的请求方法'), { code: 'INVALID_INPUT' });
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    return bad(res, e);
  }
});

// 端口被占用时自动顺延，最多试 20 个端口，并把真实地址写到 data/address.txt
function listenWithFallback(port, attempt) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && attempt < 20) {
      console.log('  端口 ' + port + ' 已被占用，尝试 ' + (port + 1) + ' ...');
      server.removeAllListeners('error');
      listenWithFallback(port + 1, attempt + 1);
    } else {
      console.error('  启动失败：' + e.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    server.removeAllListeners('error');
    server.on('error', e => console.error('[server] 运行错误：' + e.message));
    const realPort = server.address().port;
    const address = 'http://' + HOST + ':' + realPort;
    const c = store.getConfig(); // 会确保 data 目录存在
    try { fs.writeFileSync(path.join(store.DATA_DIR, 'address.txt'), address, 'utf8'); } catch (_) {}
    console.log('');
    console.log('  学习助手已启动');
    console.log('  ------------------------------------------');
    console.log('  打开浏览器: ' + address);
    console.log('  当前模式  : ' + (c.mock || !c.apiKey ? '演示模式（未调用真实模型）' : '真实模型 ' + c.model));
    console.log('  数据目录  : ' + store.DATA_DIR);
    console.log('  停止服务  : Ctrl + C');
    console.log('');
  });
}
listenWithFallback(BASE_PORT, 0);
