'use strict';

// Python 受限执行（默认关闭）：隔离模式 + 不加载 site 包 + 临时目录 + 超时 + 输出截断。
// 注意：这不是真正的沙箱，进程仍以当前用户权限运行，仅供本机自用。
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const TIMEOUT_MS = 3000;
const MAX_OUTPUT = 8192;

function makeError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// 让 Windows 下中文输出按 UTF-8 编码，避免 Node 侧解码乱码。
const PREFIX = [
  'import sys',
  'try:',
  '    sys.stdout.reconfigure(encoding="utf-8")',
  '    sys.stderr.reconfigure(encoding="utf-8")',
  'except Exception:',
  '    pass',
  ''
].join('\n');

function runPython(code, config) {
  return new Promise((resolve, reject) => {
    if (!config.enableRunner) {
      reject(makeError('RUNNER_DISABLED', '本机 Python 执行未开启。请到「设置」页勾选「允许在本机运行 Python 代码」并阅读风险说明。'));
      return;
    }
    const source = String(code || '');
    if (!source.trim()) { reject(makeError('INVALID_INPUT', '代码为空。')); return; }
    if (source.length > 20000) { reject(makeError('INVALID_INPUT', '代码过长（上限 20000 字符）。')); return; }

    const started = Date.now();
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), settled = false;

    const child = spawn('python', ['-I', '-S', '-c', PREFIX + source], {
      cwd: os.tmpdir(),
      env: {
        PATH: process.env.PATH || '',
        SYSTEMROOT: process.env.SYSTEMROOT || '',
        TEMP: os.tmpdir(), TMP: os.tmpdir()
      },
      windowsHide: true
    });

    const collect = (buf, chunk) => {
      const next = Buffer.concat([buf, Buffer.from(chunk)]);
      return next.length > MAX_OUTPUT ? next.slice(0, MAX_OUTPUT) : next;
    };

    child.stdout.on('data', c => { stdout = collect(stdout, c); });
    child.stderr.on('data', c => { stderr = collect(stderr, c); });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (_) {}
      reject(makeError('RUNNER_TIMEOUT', '代码运行超过 3 秒，已强制终止。检查是否存在死循环或 input() 等待。'));
    }, TIMEOUT_MS);

    child.on('error', e => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      reject(makeError('UPSTREAM', '无法启动 Python：' + e.message + '。请确认命令行可以执行 python。'));
    });

    child.on('close', exitCode => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        exitCode,
        durationMs: Date.now() - started,
        truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT
      });
    });
  });
}

module.exports = { runPython, TIMEOUT_MS, MAX_OUTPUT };
