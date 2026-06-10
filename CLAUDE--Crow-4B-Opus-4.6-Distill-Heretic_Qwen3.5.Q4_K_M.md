# CLAUDE.md

此文件为 Claude Code 在处理此 Doge Code 代码库时提供指导。

## 项目概述

**Doge Code** 是一个深度定制的 CLI/TUI 工具，基于一份经过多次修改的 Claude Code 源码树构建而成。它支持自定义 Anthropic 兼容接口地址，已加入多入口的 OpenAI Chat Completions ↔ Anthropic Messages 转接能力，支持自定义 API Key、自定义模型与模型列表管理。

核心定位是"可自托管 / 可代理 / 可转接"的 Claude Code 变体——允许将自定义接入数据记录到 `~/.doge` 路径体系，在保留 CLI/TUI 主体结构的前提下，支持无登录流的绑定。

## 环境要求

- Bun 1.3.5 或更高版本
- Node.js 24 或更高版本

## 常用命令

### 安装与运行

```bash
# 安装依赖
bun install

# 启动开发模式
bun run dev

# 启动全局 CLI 工具（命令名为 'doge'）
doge
```

### 核心命令

| 命令 | 说明 |
|------|------|
| `/login` | 切换不同 BaseURL、API Key、模型 |
| `/clear` | 清空上下文，相当于退出软件再进入 |
| `/plugins` | 管理插件 |
| `/skills` | 管理技能 |
| `/agents` | 管理代理 |
| `/compact` | 压缩会话内容，减少 token 消耗 |
| `/context` | 查看上下文用量 |
| `/rewind` / 两次 ESC | 上下文回滚到指定轮次 |
| `/resume` | 恢复选定的会话 |
| `/rename` | 命名会话方便记忆 |
| `/model` | 切换当前使用的模型 |
| `/cost` | 计费情况查看 |
| `/plan` / Shift+Tab 两次 | 进入计划模式 |
| `/init` | 重新审视项目，更新 CLAUDE.md 文件 |
| `/task-budget` | 查看任务预算和剩余令牌数 |
| `/token-budget` | 查看令牌预算和续期状态 |
| `/play-sound` | 播放音频提示 |
| `/truncate` | 截断上下文 |

### 工作流命令

```bash
# 源码级更新
git pull
bun install
bun link
doge
```

### 配置

- 配置目录：`~/.doge/`
- 全局配置文件：`~/.doge/.claude.json`
- 环境变量：`~/.doge/.env`（支持自定义 API Key、Base URL、模型等）

### 开发命令

```bash
# 启动 CLI 开发模式
bun run ./src/bootstrap-entry.ts

# 输出版本信息
bun run version
```

## 代码架构

### 入口文件

- `src/bootstrap-entry.ts` - 启动入口，加载 `.env` 配置，设置环境变量
- `src/bootstrapMacro.ts` - 启动宏，生成构建时内联的版本信息
- `src/entrypoints/cli.tsx` - CLI 入口点，包含快速路径和特殊标志检查
- `src/main.ts` - 主 CLI 入口，处理命令解析和执行

### 核心模块

- `src/query.ts` - 查询处理核心，包含：
  - 消息处理与截断逻辑
  - 工具执行与流式处理
  - 上下文压缩与精简
  - 令牌预算管理
  - 任务预算和续期逻辑
  - 附件消息和任务摘要

- `src/types/message.ts` - 消息类型定义，包括：
  - 用户消息、助手消息、工具使用消息
  - 附件消息、元消息、Tombstone 消息
  - 消息内容块类型定义

- `src/services/api/claude.ts` - Anthropic Claude 兼容 API 客户端
- `src/services/api/openaiCompat.ts` - OpenAI 兼容 API 客户端

### 命令系统

命令系统位于 `src/commands/` 目录，支持以下命令类别：
- 会话管理命令：`/resume`、`/rename`、`/clear`、`/compact`
- 上下文管理命令：`/context`、`/context-expand`、`/context-delete`
- 工具管理命令：`/plugins`、`/skills`、`/agents`
- 预算管理命令：`/task-budget`、`/token-budget`

### 配置文件

- `.env` - 环境变量配置（API Key、Base URL、模型等）
- `.claude.json` - 全局 Claude 配置
- `~/.doge/` - 用户专属配置目录

### 工具限制

- `src/constants/toolLimits.ts` - 工具结果大小限制常量
- `src/utils/api.ts` - API 封装工具

## 特色功能

1. **自定义 API 支持**：支持自定义 Anthropic 兼容接口地址
2. **OpenAI 转接**：已加入 OpenAI Chat Completions ↔ Anthropic Messages 转接能力
3. **令牌预算管理**：支持任务预算和续期逻辑
4. **上下文管理**：支持压缩、精简、截断、备份、恢复等功能
5. **插件系统**：支持管理自定义插件
6. **技能管理**：支持管理技能定义

## 与原版 Claude Code 的对比

| 特性 | 原版 Claude Code | Doge Code |
|------|-------------------|-----------|
| 自定义 API 支持 | 无 | 支持自定义 Anthropic 兼容接口地址 |
| OpenAI 转接 | 无 | 已加入 OpenAI ↔ Anthropic 转接能力 |
| 令牌预算管理 | 有限 | 支持任务预算和续期 |
| 上下文管理 | 基础 | 支持压缩、精简、截断、备份、恢复 |
| 插件系统 | 内置 | 支持管理自定义插件 |
| 配置目录 | `~/.claude/` | `~/.doge/` |

## 开发注意事项

1. 使用 Bun 进行开发和运行
2. 通过 `.env` 文件配置自定义 API Key 和 Base URL
3. 上下文压缩和截断功能可显著提升性能
4. 令牌预算系统可帮助管理资源消耗
5. 插件系统支持自定义工具扩展

## 相关文档

- `README.md` - 项目介绍和安装说明
- `src/utils/config.ts` - 配置系统
- `src/utils/truncateRecovery.ts` - 上下文截断恢复
- `src/services/compact/autoCompact.ts` - 自动压缩逻辑