'use strict';

// 知识点预设模板：level 取值 mastered(已掌握) / seen(接触过) / unknown(未学)
// 每条知识点由 分类 + 名称 唯一确定。
const PRESETS = {
  'python-basic': {
    name: 'Python 基础',
    description: '适合刚学完变量、判断、循环、列表字典、函数，还没接触面向对象和进阶语法的阶段',
    items: [
      ['变量与赋值', 'mastered'], ['数字与字符串', 'mastered'],
      ['print 输出', 'mastered'], ['input 输入', 'mastered'],
      ['注释', 'mastered'], ['算术运算符', 'mastered'],
      ['比较运算符', 'mastered'], ['if 条件判断', 'mastered'],
      ['for 循环', 'mastered'], ['while 循环', 'mastered'],
      ['列表 list', 'mastered'], ['字典 dict', 'mastered'],
      ['字符串常用方法', 'mastered'], ['函数定义与调用', 'mastered'],
      ['函数返回值', 'mastered'], ['缩进与代码块', 'mastered'],
      ['列表推导式', 'unknown'], ['lambda 表达式', 'unknown'],
      ['装饰器', 'unknown'], ['生成器 yield', 'unknown'],
      ['类与对象', 'unknown'], ['异常处理 try/except', 'unknown'],
      ['with 上下文管理', 'unknown'], ['异步 async/await', 'unknown'],
      ['f-string 格式化', 'unknown'], ['第三方库', 'unknown'],
      ['类型注解', 'unknown'], ['模块 import', 'unknown'],
      ['切片', 'unknown'], ['*args 与 **kwargs', 'unknown']
    ]
  },
  'frontend-basic': {
    name: '前端基础',
    description: '适合学完 HTML 标签、CSS 基础、JS 变量/函数/循环/DOM 入门的阶段',
    items: [
      ['HTML 常用标签', 'mastered'], ['CSS 选择器', 'mastered'],
      ['CSS 颜色与字体', 'mastered'], ['盒模型', 'mastered'],
      ['JavaScript 变量', 'mastered'], ['函数声明', 'mastered'],
      ['if 条件', 'mastered'], ['for 循环', 'mastered'],
      ['数组基础', 'mastered'], ['字符串基础', 'mastered'],
      ['DOM getElementById', 'mastered'], ['innerHTML 文本', 'mastered'],
      ['onclick 事件', 'mastered'], ['console.log 调试', 'mastered'],
      ['箭头函数', 'unknown'], ['Promise 与 async/await', 'unknown'],
      ['解构赋值', 'unknown'], ['class 类', 'unknown'],
      ['数组高阶方法', 'unknown'], ['模板字符串', 'unknown'],
      ['ES 模块 import/export', 'unknown'], ['addEventListener', 'unknown'],
      ['展开运算符', 'unknown'], ['可选链', 'unknown'],
      ['let/const 与块级作用域', 'unknown']
    ]
  },
  'common-basic': {
    name: '通用概念',
    description: '跨语言的基本功，任何语言都适用',
    items: [
      ['顺序结构', 'mastered'], ['分支结构', 'mastered'],
      ['循环结构', 'mastered'], ['变量', 'mastered'],
      ['函数', 'mastered'], ['注释', 'mastered'],
      ['调试输出', 'mastered'], ['伪代码与思路拆解', 'seen'],
      ['时间复杂度', 'unknown'], ['递归', 'unknown'],
      ['正则表达式', 'unknown']
    ]
  }
};

// L3 静态扫描用的「进阶语法特征库」。
// topic 必须与上面模板里的知识点名称一致，才能和画像直接比对。
const FEATURES = [
  // ---------- Python ----------
  { topic: '列表推导式', lang: 'python', pattern: /\[[^\]\n]*\bfor\b[^\]\n]*\]/, hint: '改用 for 循环 + append，逐项添加' },
  { topic: 'lambda 表达式', lang: 'python', pattern: /\blambda\b/, hint: '改用 def 定义一个普通函数再传入' },
  { topic: '装饰器', lang: 'python', pattern: /^\s*@[A-Za-z_]/, hint: '装饰器可以先用普通函数调用替代' },
  { topic: '生成器 yield', lang: 'python', pattern: /\byield\b/, hint: '改为把结果 append 到列表后 return' },
  { topic: '类与对象', lang: 'python', pattern: /\bclass\s+[A-Za-z_]/, hint: '先用字典 + 函数表达同样的数据' },
  { topic: '异常处理 try/except', lang: 'python', pattern: /\btry\s*:|\bexcept\b|\braise\b/, hint: '先用 if 提前判断非法输入' },
  { topic: 'with 上下文管理', lang: 'python', pattern: /\bwith\s+/, hint: '改成手动 open / close 的写法' },
  { topic: '异步 async/await', lang: 'python', pattern: /\basync\s+def\b|\bawait\b/, hint: '先写同步版本，理解流程后再学异步' },
  { topic: 'f-string 格式化', lang: 'python', pattern: /\bf["']/, hint: '改用字符串拼接或 str() 转换' },
  { topic: '第三方库', lang: 'python', pattern: /\b(?:import|from)\s+(?:numpy|pandas|requests|flask|django|matplotlib|torch|bs4|openai)\b/, hint: '第三方库需要额外安装，先用标准库或基础语法实现' },
  { topic: '类型注解', lang: 'python', pattern: /def\s+\w+\([^)]*:\s*\w+|\)\s*->\s*\w+/, hint: '去掉参数与返回值后面的类型标注' },
  { topic: '模块 import', lang: 'python', pattern: /\b(?:import|from)\s+\w+/, hint: '先不拆模块，把代码写在一个文件里' },
  { topic: '切片', lang: 'python', pattern: /\[\s*\d*\s*:\s*\d*\s*\]/, hint: '改用 for 循环按下标逐项取' },
  { topic: '*args 与 **kwargs', lang: 'python', pattern: /\*args|\*\*kwargs/, hint: '改成明确写出每个参数' },
  // ---------- JavaScript ----------
  { topic: '箭头函数', lang: 'javascript', pattern: /=>/, hint: '改用 function 关键字定义函数' },
  { topic: 'Promise 与 async/await', lang: 'javascript', pattern: /\bPromise\b|\basync\b|\bawait\b/, hint: '先写同步代码，异步留到后面学' },
  { topic: '解构赋值', lang: 'javascript', pattern: /(?:const|let|var)\s*[{[]/, hint: '改成逐个声明变量再赋值' },
  { topic: 'class 类', lang: 'javascript', pattern: /\bclass\s+[A-Za-z_]/, hint: '先用普通对象 + 函数表达' },
  { topic: '数组高阶方法', lang: 'javascript', pattern: /\.(?:map|filter|reduce|forEach|flatMap)\s*\(/, hint: '改用 for 循环逐项处理' },
  { topic: '模板字符串', lang: 'javascript', pattern: /`/, hint: '改用 + 号拼接字符串' },
  { topic: 'ES 模块 import/export', lang: 'javascript', pattern: /\bimport\s+.*\bfrom\b|\bexport\s+/, hint: '先把代码放在同一个文件里' },
  { topic: 'addEventListener', lang: 'javascript', pattern: /addEventListener/, hint: '改用 onclick 属性绑定事件' },
  { topic: '展开运算符', lang: 'javascript', pattern: /\.\.\./, hint: '改用循环逐项复制' },
  { topic: '可选链', lang: 'javascript', pattern: /\?\./, hint: '改用 if 逐层判断是否存在' },
  { topic: 'let/const 与块级作用域', lang: 'javascript', pattern: /\b(?:let|const)\b/, hint: '若只学过 var，请改回 var' }
];

function presetList() {
  return Object.keys(PRESETS).map(id => ({
    id, name: PRESETS[id].name, description: PRESETS[id].description,
    count: PRESETS[id].items.length
  }));
}

function presetItems(id) {
  const p = PRESETS[id];
  if (!p) return null;
  return p.items.map(([name, level]) => ({ name, category: p.name, level, note: '' }));
}

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_/（）()·、,，.。:：\[\]]/g, '');
}

module.exports = { PRESETS, FEATURES, presetList, presetItems, normalizeName };
