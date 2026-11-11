// 代码测试与演示：JS/HTML 走 sandbox iframe，Python 走本机受限子进程
import { post, friendlyError } from './api.js';
import { state, toast, setNotice } from './state.js';

const $ = id => document.getElementById(id);
const EXAMPLES = {
  javascript: [
    '// 只用最基础的写法：变量、for 循环、if 判断',
    'var total = 0;',
    'for (var i = 1; i <= 5; i = i + 1) {',
    '    if (i % 2 == 1) {',
    '        console.log("奇数：" + i);',
    '        total = total + i;',
    '    }',
    '}',
    'console.log("奇数的和是 " + total);'
  ].join('\n'),
  html: [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<body style="font-family: sans-serif; padding: 16px;">',
    '  <h3>一个只有基础写法的页面</h3>',
    '  <input id="name" type="text" placeholder="输入名字">',
    '  <button id="btn" onclick="sayHello()">点我</button>',
    '  <p id="out"></p>',
    '  <script>',
    '    function sayHello() {',
    '      var text = document.getElementById("name").value;',
    '      if (text == "") {',
    '        document.getElementById("out").innerHTML = "请先输入名字";',
    '      } else {',
    '        document.getElementById("out").innerHTML = "你好，" + text;',
    '      }',
    '      console.log("按钮被点击了，输入是：" + text);',
    '    }',
    '  <' + '/script>',
    '</body>',
    '</html>'
  ].join('\n'),
  python: [
    '# 只用变量、for 循环、if 判断、函数',
    'def sum_odd(n):',
    '    total = 0',
    '    for i in range(1, n + 1):',
    '        if i % 2 == 1:',
    '            total = total + i',
    '    return total',
    '',
    'print("1 到 10 的奇数和：", sum_odd(10))'
  ].join('\n')
};

// 注入到 iframe 的 console 钩子：把日志通过 postMessage 送回父页面
const HOOK = [
  '<!DOCTYPE html><meta charset="utf-8">',
  '<script>',
  '(function(){',
  '  var fmt = function(v){ if (typeof v === "string") return v; try { return JSON.stringify(v); } catch(e){ return String(v); } };',
  '  var send = function(kind, args){ parent.postMessage({ __studyRunner:true, kind:kind, text: Array.prototype.map.call(args, fmt).join(" ") }, "*"); };',
  '  console.log = function(){ send("log", arguments); };',
  '  console.info = function(){ send("info", arguments); };',
  '  console.warn = function(){ send("warn", arguments); };',
  '  console.error = function(){ send("error", arguments); };',
  '  window.onerror = function(msg){ send("error", [msg]); return false; };',
  '  window.addEventListener("unhandledrejection", function(ev){ send("error", ["Promise 未处理：", ev.reason]); });',
  '  window.addEventListener("load", function(){ send("done", ["执行结束"]); });',
  '})();',
  '<' + '/script>'
].join('\n');

let runnerFrame = null;

export function initPlayground() {
  $('play-code').value = EXAMPLES.javascript;
  $('btn-load-example').addEventListener('click', () => {
    $('play-code').value = EXAMPLES[$('play-lang').value] || '';
    updateLang();
  });
  $('btn-clear-code').addEventListener('click', () => { $('play-code').value = ''; });
  $('btn-clear-output').addEventListener('click', clearOutput);
  $('btn-run').addEventListener('click', run);
  $('play-lang').addEventListener('change', updateLang);

  window.addEventListener('message', e => {
    if (!e.data || !e.data.__studyRunner) return;
    if (runnerFrame && e.source !== runnerFrame.contentWindow) return;
    appendLine(e.data.kind, e.data.text);
  });
  window.addEventListener('play-code', e => {
    const { lang, code } = e.detail;
    $('play-lang').value = lang;
    $('play-code').value = code;
    updateLang();
    toast('代码已送入演示区，点「运行」即可查看结果', 'success');
  });
  updateLang();
}

function updateLang() {
  const lang = $('play-lang').value;
  const label = { javascript: 'JavaScript', html: 'HTML', python: 'Python' }[lang] || lang;
  $('editor-label').textContent = label;
  const hints = {
    javascript: '在 sandbox iframe 中运行，不能访问本页数据；避免死循环',
    html: '完整页面会在下方 iframe 中显示，页面里的 console 输出会回传',
    python: '需先在「设置」开启本机执行；隔离模式 + 3 秒超时'
  };
  $('play-hint').textContent = hints[lang] || '';
  if (lang === 'python') {
    setNotice('play-notice', 'Python 代码不在浏览器里运行，而是由本机 Node 服务派生子进程执行；请只运行自己看得懂的代码。');
  } else {
    setNotice('play-notice', '');
  }
}

function clearOutput() {
  $('play-output-text').textContent = '（还没有运行记录）';
}

function appendLine(kind, text) {
  const pre = $('play-output-text');
  if (pre.textContent === '（还没有运行记录）') pre.textContent = '';
  const prefix = { log: '', info: '[info] ', warn: '[warn] ', error: '[error] ', done: '--- ' }[kind] || '';
  let next = pre.textContent + prefix + String(text == null ? '' : text) + '\n';
  if (next.length > 8000) next = next.slice(-8000);
  pre.textContent = next;
  pre.scrollTop = pre.scrollHeight;
}

async function run() {
  const lang = $('play-lang').value;
  const code = $('play-code').value;
  clearOutput();
  if (!code.trim()) { toast('请先写点代码', 'error'); return; }

  if (lang === 'python') {
    try {
      const data = await post('/run', { lang: 'python', code });
      if (data.stdout) appendLine('log', data.stdout.trimEnd());
      if (data.stderr) appendLine('error', data.stderr.trimEnd());
      if (!data.stdout && !data.stderr) appendLine('log', '（程序没有任何输出）');
      appendLine('done', '退出码 ' + data.exitCode + ' · 耗时 ' + data.durationMs + ' ms' + (data.truncated ? ' · 输出已截断' : ''));
      setNotice('play-notice', '运行完成。若提示未开启执行，请到「设置」勾选对应开关。', 'success');
    } catch (e) {
      const msg = friendlyError(e);
      appendLine('error', msg);
      setNotice('play-notice', msg + '（设置 → 允许在本机运行 Python 代码）', 'error');
      toast(msg, 'error');
    }
    return;
  }

  // HTML / JavaScript：sandbox iframe，无 allow-same-origin
  const box = $('frame-box');
  box.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', '代码运行沙箱');
  runnerFrame = frame;
  const safeJs = code.replace(/<\/script/gi, '<\\/script');
  frame.srcdoc = lang === 'html'
    ? HOOK + '\n' + code
    : HOOK + '\n<script>\n' + safeJs + '\n<' + '/script>';
  box.appendChild(frame);
  box.classList.toggle('show', lang === 'html');
  appendLine('info', '已在隔离沙箱中开始运行（' + lang + '）');
  setNotice('play-notice', '沙箱 iframe 不允许同源，代码无法读取本页数据或本地文件。若页面卡住，多半是代码里有死循环，请刷新页面。');
}
