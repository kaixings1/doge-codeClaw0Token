const { filterToolsByTask } = require('./filterTools');
const tools = require('./tool_definitions.json').tools;

function initSession(userInput) {
  // 解析用户意图确定任务类型
  const taskType = detectTaskType(userInput); // 自定义检测逻辑
  
  // 根据任务类型过滤工具
  const relevantTools = filterToolsByTask(tools, taskType);
  
  // 只将相关工具定义发给大模型
  return { tools: relevantTools };
}

function detectTaskType(input) {
  if (input.includes('review') || input.includes('检查')) return 'code_review';
  if (input.includes('debug') || input.includes('调试')) return 'debug';
  if (input.includes('build') || input.includes('构建')) return 'build';
  if (input.includes('') || input.includes('搜索')) return '';
  return 'default';
}

console.log(initSession("帮我检查代码"));
