'use strict';

// 约束 Prompt 构造 + 模型输出解析 + 无 Key 时的演示响应

const MODE_TASKS = {
  code: '根据用户的需求，写一份**只用已掌握知识点**就能逐行看懂、且可以直接运行的完整代码。',
  explain: '逐段解释用户给出的代码：每一行在做什么、用到哪些知识点、哪些地方超出了用户的画像。不要重写代码，重点是讲清楚。',
  review: '审查用户给出的代码，找出所有超出画像的用法，逐条说明，并给出一个"降级改写"版本（只用已掌握知识点，宁可啰嗦）。'
};

function groupByLevel(items) {
  const g = { mastered: [], seen: [], unknown: [] };
  for (const it of items) {
    if (g[it.level]) g[it.level].push(it.name + (it.note ? '（' + it.note + '）' : ''));
  }
  return g;
}

function buildSystem(items, mode) {
  const g = groupByLevel(items || []);
  const fmt = arr => arr.length ? arr.map(x => '- ' + x).join('\n') : '（暂无）';
  const task = MODE_TASKS[mode] || MODE_TASKS.code;

  return [
    '# 角色',
    '你是「守界编程助教」。你的第一目标不是写出最优雅或最短的代码，而是写出用户能逐行看懂的代码。',
    '用户正在学习编程，超出他当前知识面的写法会让他无法继续学习。',
    '',
    '# 用户的知识点画像',
    '【已掌握｜可自由使用】',
    fmt(g.mastered),
    '',
    '【接触过｜可以使用，但必须加一行中文注释说明】',
    fmt(g.seen),
    '',
    '【未学 / 不在清单内｜禁止悄悄使用】',
    fmt(g.unknown),
    '以及任何未出现在上面清单中的语法、内置函数、标准库模块、第三方库、框架、设计模式。',
    '',
    '# 硬性规则',
    '1. 只使用【已掌握】里的语法、API、概念。不要炫技，不要"顺手优化"，不要引入更简短的高级写法。',
    '2. 如果任务客观上必须使用清单外的知识，你必须同时做到三件事：',
    '   a) 在代码中该行加注释：Python 用 `# [K] 知识点名称`，JS/HTML 用 `// [K] 知识点名称` 或 `<!-- [K] 知识点名称 -->`',
    '   b) 在「超纲清单」里用下面的标记逐条写出，一条一行',
    '   c) 在「实现思路」里说明为什么绕不开，以及有没有更基础的替代写法',
    '3. 宁可代码更啰嗦、更基础，也绝不偷偷引入新知识。',
    '4. 不要使用用户上传文件中没有出现的第三方库；不确定的 API 一律不用。',
    '5. 代码块必须能独立运行，包含必要的导入、示例输入和打印输出。',
    '6. 全程用中文讲解；代码里的标识符用英文。',
    '7. 严格按下面的 Markdown 结构输出，不要加额外的开场白或总结。',
    '',
    '# 超纲标记语法（必须原样使用）',
    '[[NEW::知识点名称::为什么这里必须用它::一句话解释它是什么以及更基础的替代写法]]',
    '示例：[[NEW::lambda 表达式::sorted 需要一个"按什么排序"的小函数::可以理解成一次性、没有名字的小函数，基础写法是用 def 定义函数再传进去]]',
    '若完全没有超纲知识，「超纲清单」这一节只写一个字：无',
    '',
    '# 输出结构',
    '## 实现思路',
    '（用已掌握的知识点描述步骤，说明哪里绕不开新知识）',
    '## 代码',
    '```语言',
    '（代码；每处超纲用法的行上加 [K] 注释）',
    '```',
    '## 知识点对照',
    '| 代码位置 | 用到的知识点 | 状态 |',
    '| --- | --- | --- |',
    '| 第 3 行 | for 循环 | 已掌握 |',
    '## 超纲清单',
    '- [[NEW::...]]',
    '## 自测小题',
    '1. （只给题目，不给答案，1～3 道）',
    '',
    '# 本次任务',
    task
  ].join('\n');
}

function buildUser(input) {
  const parts = [];
  parts.push('## 我的问题\n' + String(input.question || '').trim());
  if (input.mode && input.mode !== 'code') {
    parts.push('（本次模式：' + (input.mode === 'explain' ? '知识点解析' : '代码审查') + '）');
  }
  if (input.options && input.options.language) {
    parts.push('希望使用的语言：' + input.options.language);
  }
  if (Array.isArray(input.files) && input.files.length) {
    const blocks = input.files.map(f =>
      '### 文件：' + f.name + '\n```\n' + String(f.content || '') + '\n```'
    );
    parts.push('## 我上传的参考文件\n' + blocks.join('\n\n'));
  }
  if (Array.isArray(input.images) && input.images.length) {
    parts.push('## 图片附件\n另附 ' + input.images.length + ' 张图片（' +
      input.images.map(i => i.name).join('、') + '），请结合图片内容理解需求。图片仅作参考，生成代码时仍须遵守知识点画像。');
  }
  parts.push('请按 system 中规定的结构输出。');
  return parts.join('\n\n');
}

// 宽松解析：章节缺失、标记不规范也不能崩，尽量把信息抽出来。
function parse(markdown) {
  const raw = String(markdown || '');
  const sections = [];
  const secRe = /^##\s+(.+?)\s*$/gm;
  const heads = [];
  let m;
  while ((m = secRe.exec(raw)) !== null) heads.push({ title: m[1], start: m.index, bodyStart: secRe.lastIndex });
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : raw.length;
    sections.push({ title: heads[i].title, content: raw.slice(heads[i].bodyStart, end).trim().slice(0, 8000) });
  }

  const codeBlocks = [];
  const codeRe = /^```(\w*)\s*\n([\s\S]*?)^```/gm;
  while ((m = codeRe.exec(raw)) !== null) {
    const code = m[2].replace(/\n$/, '');
    const kRe = /\[K\]\s*([^\n]+)/g;
    const knowledge = [];
    let k;
    while ((k = kRe.exec(code)) !== null) {
      knowledge.push(k[1].replace(/\*\/\s*$/, '').replace(/-->\s*$/, '').trim().slice(0, 60));
    }
    codeBlocks.push({ lang: (m[1] || 'text').toLowerCase(), code: code.slice(0, 30000), knowledge });
  }

  const newTopics = [];
  const newRe = /\[\[NEW::(.+?)::(.+?)::(.+?)\]\]/g;
  while ((m = newRe.exec(raw)) !== null) {
    newTopics.push({
      name: m[1].trim().slice(0, 60),
      reason: m[2].trim().slice(0, 300),
      explain: m[3].trim().slice(0, 500)
    });
  }

  const quizSec = sections.find(s => /自测|小题|练习/.test(s.title));
  return {
    sections,
    codeBlocks,
    newTopics,
    quiz: quizSec ? quizSec.content.slice(0, 2000) : '',
    summary: (sections.find(s => /实现思路|思路/.test(s.title)) || {}).content || ''
  };
}

// ---------------- 演示数据（未配置 Key 时） ----------------
const MOCK_PY = [
  '## 实现思路',
  '把句子用空格拆成单词列表，再用一个字典记录每个单词出现了几次。遍历时用 if 判断"这个单词见过吗"，见过就 +1，没见过就记 1。',
  '唯一绕不开的地方：题目还要求"按次数从多到少输出"。给排序函数传一个临时的排序规则，需要用到一个你还没学的写法，我在下面标出来了。更基础的替代方案是用 def 单独写一个函数。',
  '',
  '## 代码',
  '```python',
  'def count_words(text):',
  '    result = {}                          # [K] 字典 dict',
  '    for word in text.split():            # [K] for 循环 / 字符串常用方法',
  '        word = word.lower()',
  '        if word in result:              # [K] if 条件判断',
  '            result[word] = result[word] + 1',
  '        else:',
  '            result[word] = 1',
  '    return result',
  '',
  'text = "Apple banana apple APPLE"',
  'counts = count_words(text)',
  '',
  '# [K] lambda 表达式 —— 这是本次唯一超纲的地方',
  'for word, n in sorted(counts.items(), key=lambda item: item[1], reverse=True):',
  '    print(word, n)',
  '```',
  '',
  '## 知识点对照',
  '| 代码位置 | 用到的知识点 | 状态 |',
  '| --- | --- | --- |',
  '| 第 2 行 | 字典 dict | 已掌握 |',
  '| 第 3 行 | for 循环、字符串常用方法 | 已掌握 |',
  '| 第 5 行 | if 条件判断 | 已掌握 |',
  '| 第 13 行 | lambda 表达式 | **超纲，已标注** |',
  '',
  '## 超纲清单',
  '- [[NEW::lambda 表达式::sorted 需要一个"按什么排序"的小函数，临时写一个最省事::可以理解成"一次性、没有名字的小函数"；基础写法是用 def 定义一个普通函数再把它传给 key 参数]]',
  '',
  '## 自测小题',
  '1. 如果把第 13 行的 lambda 改成普通 def 函数，代码要怎么改？',
  '2. 为什么第 6 行不直接写 result[word] += 1？两种写法结果一样吗？',
  '3. 如果输入是空字符串，这段程序会输出什么？',
  '',
  '> 当前为**演示数据**（未配置 API Key）。配置 Key 并关闭「演示模式」后，将由模型按你的知识点画像实时生成。'
].join('\n');

const MOCK_WEB = [
  '## 实现思路',
  '用一个输入框收集文字，点击按钮时读出内容，判断是不是空，然后写到页面上的段落里。只用到变量、函数声明、if 条件、getElementById 和 onclick。',
  '这次没有用到画像之外的知识，所以超纲清单写"无"。',
  '',
  '## 代码',
  '```html',
  '<!DOCTYPE html>',
  '<html>',
  '<body>',
  '  <input id="name" type="text">',
  '  <button id="btn" onclick="sayHello()">点我</button>',
  '  <p id="out"></p>',
  '  <script>',
  '    function sayHello() {                                  // [K] 函数声明',
  '      var text = document.getElementById("name").value;  // [K] DOM getElementById',
  '      if (text == "") {                                 // [K] if 条件',
  '        document.getElementById("out").innerHTML = "请先输入名字";',
  '      } else {',
  '        document.getElementById("out").innerHTML = "你好，" + text;',
  '      }',
  '    }',
  '  </script>',
  '</body>',
  '</html>',
  '```',
  '',
  '## 知识点对照',
  '| 代码位置 | 用到的知识点 | 状态 |',
  '| --- | --- | --- |',
  '| 第 9 行 | 函数声明 | 已掌握 |',
  '| 第 10 行 | DOM getElementById | 已掌握 |',
  '| 第 11 行 | if 条件 | 已掌握 |',
  '',
  '## 超纲清单',
  '无',
  '',
  '## 自测小题',
  '1. 如果想让按钮点击后清空输入框，应该加哪一行代码？',
  '2. onclick 和 value 分别是由谁提供的？',
  '',
  '> 当前为**演示数据**（未配置 API Key）。配置 Key 并关闭「演示模式」后，将由模型按你的知识点画像实时生成。'
].join('\n');

function mockAnswer(input) {
  const lang = String((input.options || {}).language || '');
  const q = String(input.question || '') + ' ' + lang;
  const web = /html|css|网页|前端|javascript|js\b|按钮|页面|dom/i.test(q) || lang === 'html';
  return {
    content: web ? MOCK_WEB : MOCK_PY,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    model: 'mock-demo'
  };
}

module.exports = { MODE_TASKS, buildSystem, buildUser, parse, mockAnswer };
