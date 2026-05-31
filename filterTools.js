// 根据任务类型过滤工具
function filterToolsByTask(tools, taskType) {
  const taskToolMap = {
    'code_review': ['Read', 'Grep', 'Edit'],
    'debug': ['Read', 'Bash', 'Edit'],
    'build': ['Bash'],
    '': ['Grep', 'Glob', 'Read'],
    'default': ['Read', 'Write', 'Edit', 'Bash', 'Grep']
  };
  
  const allowedTools = taskToolMap[taskType] || taskToolMap.default;
  const filtered = {};
  
  for (const tool of allowedTools) {
    if (tools[tool]) filtered[tool] = tools[tool];
  }
  
  return filtered;
}

module.exports = { filterToolsByTask };
