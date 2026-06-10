# 上下文截断 - 独立工具集

## 概述

这是一个**独立于核心代码**的上下文截断工具集。你可以在不修改核心代码的情况下使用。

## 使用方法

### 1. 设置环境变量

```bash
# 警告阈值 (token 数)
export CLAUDE_TRUNCATE_WARN_THRESHOLD=2500

# 精简阈值 (token 数) - 超过时触发自动截断
export CLAUDE_TRUNCATE_COMPACT_THRESHOLD=3000

# 错误阈值 (token 数) - 超过时报错
export CLAUDE_TRUNCATE_ERROR_THRESHOLD=3500

# 最大历史消息数
export CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES=30

# 始终保留最后 N 条消息
export CLAUDE_KEEP_LAST_MESSAGES=15
```

### 2. 启动 Claude Code

```bash
claude --env-file .env
```

### 3. 查看截断状态

```bash
# 查看截断统计
grep "[系统截断]" ~/.claude/CLAUDE.log | tail -20
```

## 工作原理

### 截断流程

1. **检查阈值** - 当 token 数超过 `compactThreshold` 时触发
2. **删除最旧消息** - 优先删除附件和旧用户消息
3. **保留最近消息** - 始终保留最后 N 条高优先级消息
4. **添加说明** - 截断后添加系统说明消息

### 优先级顺序

```
Attachment (0.3) < User (0.5) < System (0.8) < Assistant (0.9)
```

## 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| CLAUDE_TRUNCATE_WARN_THRESHOLD | 3000 | 警告阈值 |
| CLAUDE_TRUNCATE_COMPACT_THRESHOLD | 3500 | 精简阈值 |
| CLAUDE_TRUNCATE_ERROR_THRESHOLD | 4000 | 错误阈值 |
| CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES | 50 | 最大历史消息 |
| CLAUDE_KEEP_LAST_MESSAGES | 20 | 始终保留最后 N 条 |

## 监控截断

```bash
# 查看所有截断日志
grep "[系统截断]" ~/.claude/CLAUDE.log

# 查看最近的截断
grep "[系统截断]" ~/.claude/CLAUDE.log | tail -10

# 统计截断频率
grep "[系统截断]" ~/.claude/CLAUDE.log | wc -l
```

## 常见问题

### Q: 截断会影响对话质量吗？

A: 不会。截断优先删除附件和旧消息，保留最近的对话。

### Q: 如何完全禁用截断？

A: 设置 `CLAUDE_CONTEXT_MODE=original`

### Q: 截断频率过高怎么办？

A: 增大 `CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES` 的值。

## 下一步

1. **测试** - 运行实际对话，观察截断效果
2. **调优** - 根据实际需求调整阈值
3. **监控** - 定期检查截断日志
