# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目概述

[`Doge Code`](README.md) 是 Claude Code 的 Fork 分支，基于一份还原后的源码树继续修改而来。
可以理解为：缝合怪 + 汉化版。

- 原作：Claude Code
- 本作：Doge Code
- 当前定位：可自托管 / 可代理 / 可转接的 Claude Code 变体

## 快速安装

```bash
# 安装依赖
bun install

# 全局链接（推荐）
bun link

# 启动
doge
```

或使用 Windows 编译后的可执行文件：
```batch
install.bat
complie.bat
d.bat
```

## 常用命令

### 基础操作
- `doge /login` - 切换不同 BaseURL、APIKEY、模型
- `doge /clear` - 清空上下文，相当于退出软件再进入
- `doge /version` - 输出当前版本信息

### 配置管理
- `doge /config` - 查看/编辑配置文件
- `doge /plugins` - 管理插件
- `doge /skills` - 管理技能
- `doge /agents` - 管理代理
- `doge /env` - 设置环境变量

### 会话管理
- `doge /compact` - 压缩会话内容，减少 token 消耗
- `doge /context` - 查看上下文用量
- `doge /resume` - 恢复选定的会话
- `doge /session` - 显示会话二维码或 URL
- `doge /rewind` - 上下文回滚到指定轮次

### 计划与任务
- `doge /plan` 或 `Shift+Tab` 两次 - 进入计划模式
- `doge /tasks` - 管理任务
- `doge /task-create` - 创建新任务
- `doge /summary` - 总结对话

### 文件与 IDE
- `doge /files` - 列出跟踪的文件
- `doge /ide` - IDE 集成相关功能
- `doge /shell` - 执行 shell 命令
- `doge /chrome` - 浏览器自动化

### 高级功能
- `doge /compare` - 对比两个会话
- `doge /graphql` - 执行 GraphQL 查询
- `doge /http` - HTTP 请求工具
- `doge /database` - 数据库操作
- `doge /mcp` - Model Context Protocol 管理

### 开发工具
- `doge /memory` - 查看会话记忆
- `doge /cost` - 查看会话成本
- `doge /stats` - 查看使用统计
- `doge /usage` - 查看使用信息
- `doge /healthcheck` - 系统健康检查

## 代码架构

### 核心入口
- `src/bootstrap-entry.ts` - 启动入口，加载 .env 配置
- `src/entrypoints/cli.tsx` - CLI/TUI 主入口
- `src/main.tsx` - TUI 主界面渲染

### 命令系统
- `src/commands.ts` - 所有命令的集中导出和 memoization
- `src/commands/` - 命令目录（每个命令独立子目录）
- 命令支持：技能（prompt）、插件、工作流、MCP

### 核心服务
- `src/core.ts` - 核心业务逻辑
- `src/QueryEngine.ts` - 查询引擎
- `src/context.ts` - 上下文管理

### API 服务
- `src/services/api/claude.ts` - Anthropic API 封装
- `src/services/api/client.ts` - API 客户端
- `src/services/api/openaiCompat.ts` - OpenAI 兼容转接层

### 工具与技能
- `src/tools/` - 工具集合
- `src/skills/` - 技能目录
- `src/plugins/` - 插件目录

### 配置管理
- `src/utils/config.ts` - 配置解析
- `~/.doge/` - 默认配置目录（非 `.claude`）

## 配置目录说明

- **配置目录**：`~/.doge`
- **全局配置文件**：`~/.doge/.claude.json`
- **API 配置**：`~/.doge/api.json`
- **代理配置**：`~/.doge/proxy_config.json`
- **API 密钥**：`~/.doge/api_keys.json`

## 开发指南

### 开发流程
1. `bun install` - 安装依赖
2. `bun run dev` - 启动开发环境
3. `bun run dev:restore-check` - 恢复模式调试

### 命令开发
每个命令应放在 `src/commands/命令名/` 目录：
- `index.ts` - 命令导出
- 其他 `.tsx` 或 `.ts` 文件 - 实现细节

### 插件开发
- 插件应放在 `src/plugins/` 目录
- 提供 `pluginManifest.json` 描述插件元数据

### 技能开发
- 技能文件放在 `src/skills/` 目录
- 使用 markdown 格式，包含 `---` 分隔符

## 重要提示
- 使用 `doge /init` 重新审视项目，更新 CLAUDE.md 文件
- 使用 `doge /clear` 重新会话，减少上下文
- 敏感配置（API Key）应放在 `.doge/` 目录而非 Git 仓库
- 使用 `doge /logout` 清理本地会话缓存
- 定期使用 `git pull` 拉取官方更新
