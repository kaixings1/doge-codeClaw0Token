# 上下文截断功能说明

## 概述

Claude Code 现在支持通过环境变量控制上下文截断，避免上下文过长的性能问题。

## 环境变量配置

### 基础截断控制

```bash
# 警告阈值 (token 数)
CLAUDE_TRUNCATE_WARN_THRESHOLD=2500

# 精简阈值 (token 数) - 超过时触发自动截断
CLAUDE_TRUNCATE_COMPACT_THRESHOLD=3000

# 错误阈值 (token 数) - 超过时报错
CLAUDE_TRUNCATE_ERROR_THRESHOLD=3500

# 最大历史消息数
CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES=30

# 始终保留最后 N 条消息
CLAUDE_KEEP_LAST_MESSAGES=15
```

### 截断模式

```bash
# CLAUDE_CONTEXT_MODE 可选值:
# - original: 不截断，完整历史
# - compact: 精简模式，自动截断
# - truncate: 截断模式，仅删除最旧消息

CLAUDE_CONTEXT_MODE=compact
```

## 工作机制

### 1. 三级阈值

- **警告阈值** (3000 tokens): 发出警告，继续运行
- **精简阈值** (3500 tokens): 自动截断，删除最旧消息
- **错误阈值** (4000 tokens): 错误状态，可能失败

### 2. 优先级截断

截断时优先删除：
1. Attachment 消息 (附件)
2. User 消息 (用户输入)
3. System 消息 (系统提示)
4. Assistant 消息 (模型输出)

### 3. 保留策略

始终保留最后 N 条消息，包括：
- 最近的系统提示
- 最近的模型回复
- 最近的工具调用结果

## 使用示例

### 示例 1: 基础配置

```bash
export CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES=25
export CLAUDE_KEEP_LAST_MESSAGES=10
export CLAUDE_TRUNCATE_COMPACT_THRESHOLD=2000
```

### 示例 2: 高上下文需求

```bash
export CLAUDE_TRUNCATE_ERROR_THRESHOLD=5000
export CLAUDE_TRUNCATE_MAX_HISTORY_TOKENS=30000
```

### 示例 3: 低上下文需求

```bash
export CLAUDE_TRUNCATE_WARN_THRESHOLD=1500
export CLAUDE_KEEP_LAST_MESSAGES=5
```

## 监控截断

### 检查截断频率

```bash
# 查看截断日志
grep "[系统截断]" ~/.claude/CLAUDE.log
```

### 查看截断统计

```bash
# 最近的截断事件
grep "[系统截断]" ~/.claude/CLAUDE.log | tail -20
```

## 常见问题

### Q: 截断会丢失重要信息吗？

A: 不会。截断优先删除附件和旧用户消息，保留最近的对话。

### Q: 截断后对话会中断吗？

A: 不会。系统会在截断后添加一条说明消息，模型会从中断处继续。

### Q: 如何完全禁用截断？

A: 设置 `CLAUDE_CONTEXT_MODE=original`

## 性能影响

- **截断前**: 上下文持续增长，API 调用变慢
- **截断后**: 上下文保持稳定，API 调用正常

## 调试

### 启用详细日志

```bash
export DOGE_LOG_LEVEL=debug
```

### 查看详细截断信息

```bash
grep "truncate" ~/.claude/CLAUDE.log
```
