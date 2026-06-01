# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目信息

- **项目名称**: Doge Code (基于 Claude Code 的汉化/魔改版)
- **入口语言**: TypeScript
- **运行时**: Bun (>=1.3.5) + Node.js (>=24.0.0)
- **包管理器**: npm (主要) / bun
- **主入口**: `./src/bootstrap-entry.ts`
- **CLI 命令名**: `doge` (全局) 或 `d.bat` (项目内)

## 常用命令

### 开发与运行

- `bun run dev` - 启动 TUI 开发模式
- `bun run start` - 启动应用（同 dev）
- `bun run version` - 输出版本信息
- `bun run ./src/bootstrap-entry.ts` - 直接入口启动
- `d.bat` - Windows 快速启动（预设环境变量）

### 安装与构建

- `bun install` - 安装依赖
- `bun link` - 全局注册为 `doge` 命令
- `install.bat` - Windows 一键安装（安装依赖 + 注册）
- `complie.bat` - 编译为 `doge.exe` 独立可执行文件

### 测试

- `bun test` - 运行所有测试
- `bun test <file>` - 运行单个测试文件（如 `bun test src/commands/plugin/__tests__/parseArgs.test.ts`）
- `bun test --coverage` - 运行测试并生成覆盖率报告

### 汉化工作流

- `./check_untranslated.sh` - 扫描未汉化的英文注释
- `_replacements.json` - 批量文本替换配置
- `Temp/english_comment_files*.txt` - 待汉化文件位置记录

项目持续进行汉化，检查脚本位于根目录。


## 高层代码架构

项目是 Claude Code 的恢复源码树，经过大幅修改以支持中文、自定义 API 和多模型切换。

### 启动流程

```
bootstrap-entry.ts (入口)
  ↓
加载配置和环境变量
  ↓
main.tsx (TUI 主循环)
  ↓
commands.ts (命令注册与分发)
  ↓
assistant/gate.ts (会话网关)
  ↓
tools/ (工具执行)
```

### 核心模块

- **`entrypoints/`**: CLI 入口解析（`cli.tsx`, `init.ts`）
- **`cli/`**: 输出打印、NDJSON 序列化、传输层（WebSocket/SSE）
- **`commands/`**: 所有 `/` 命令实现，子目录按功能分组（`plugin/`, `agents/`, `bridge/` 等）
- **`tools/`**: 工具系统基础类和具体实现（`BashTool`, `ReadTool`, `EditTool` 等）
- **`assistant/`**: 助手会话管理、会话历史、会话发现
- **`components/`**: Ink/React UI 组件
- **`services/api/`**: API 通信层，关键文件 `openaiCompat.ts` 处理 Anthropic↔OpenAI 协议转接
- **`bridge/`**: 与 IDE 桥接通信（ReplBridge、远程会话）
- **`buddy/`**: 伙伴系统（满级稀有伴侣功能）

### 重要架构特点

1. **API 转接层**: 核心转接逻辑在 `services/api/openaiCompat.ts`，将 Anthropic Messages API 格式转换为 OpenAI Chat Completions 格式，支持任意兼容 OpenAI 的端点。
2. **跨模型切换**: `/login` 命令支持配置不同厂商的 BaseURL、API Key 和模型，配置存储在项目 `.doge/` 或用户 `~/.doge/` 目录。
3. **数据隔离**: 默认使用 `~/.doge/` 目录存储配置和会话，避免与原版 Claude Code 冲突。
4. **汉化层**: 代码注释和用户界面优先使用中文；`_replacements.json` 存储批量替换规则；`Temp/` 目录记录待汉化的英文注释位置。
5. **可执行编译**: `complie.bat` 使用 `bun build --compile` 生成独立的 `doge.exe`，无需运行时分发。

### 关键文件

- `src/bootstrap-entry.ts`: 实际启动逻辑和环境初始化
- `src/commands.ts`: 命令注册、解析和分发中心
- `src/main.tsx`: TUI 主循环和事件处理
- `src/core.ts`: 核心会话循环和消息处理
- `src/assistant/gate.ts`: 会话网关，管理助手实例生命周期
- `d.bat`: Windows 启动脚本，设置关键环境变量并调用 bun

### 环境变量

启动时通过 `d.bat` 设置。关键变量:
- `STREAM_FLUSH_MS=150`: 流式响应刷新间隔
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS=128000`: 最大上下文 token
- `CLAUDE_CODE_SIMPLE=1`: 简化工具模式（1=启用）
- `CLAUDE_CODE_ATTRIBUTION_HEADER=0`: 禁用属性头
- `API_TIMEOUT_MS=600000`: API 超时（10 分钟）
- `BASH_DEFAULT_TIMEOUT_MS=600000`: Bash 命令超时
- `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`: API 端点切换
- `CLAUDE_CONFIG_DIR`: 覆盖配置目录（默认 `~/.doge`）

API 配置通过 `bootstrap-entry.ts` 从 `.doge/api.json` 读取：
- `CLAUDE_CODE_COMPATIBLE_API_PROVIDER`: 提供商类型（openai/anthropic）

### 配置与登录

- **项目级配置**: `./.doge/api.json` - 存储当前项目的 BaseURL、API Key、模型选择
- **全局配置**: `~/.doge/` - 用户级配置和会话历史
- **切换配置**: `/login` 命令支持交互式配置，或直接编辑 `api.json`
- **数据隔离**: 默认使用 `~/.doge/` 而非 `~/.claude/`，避免与原版冲突

### Windows 批处理脚本说明

- `d.bat` - 主启动脚本，设置所有环境变量后启动
- `install.bat` - 安装依赖 + 编译 exe + 复制到 `F:\bin`
- `complie.bat` - 仅编译为 `doge.exe`
- `commit.bat` - 快速提交到 GitHub

### Git 同步（Fork 维护）

- `git pull` - 拉取当前仓库更新
- `git pull upstream main` - 同步上游 Fork 仓库（需先配置 `git remote add upstream <url>`）

## 注意事项

- 此项目**不是**官方 Claude Code，而是深度修改的 Fork。
- 大部分脚本假设 Windows 环境（`.bat` 文件），Bash 脚本（`*.sh`）主要用于检查逻辑和 Unix 兼容。
- 测试位于 `src/commands/plugin/__tests__/` 下，运行需显式指定路径。
- 编译为 exe 时需要确保 Bun 已正确安装并能访问 Node.js 原生模块。
- 首次运行时若遇到 "process.stdin 不支持原始模式" 错误，请确保在真实终端（如 Windows Terminal、CMD、PowerShell）中运行，而非某些受限的 IDE 内置终端。

## 故障排除

- **"process.stdin 不支持原始模式"**：在真实终端（Windows Terminal、CMD、PowerShell）中运行，避免使用受限的 IDE 内置终端
- **API 连接失败**：检查 `.doge/api.json` 中的 BaseURL 和 API Key 是否正确，确保网络可访问
- **编译失败**：确认 Bun 版本 >=1.3.5，运行 `bun --version` 检查
- **会话历史丢失**：检查 `~/.doge/sessions/` 目录是否存在且权限正确

## 调试

- `bun run --inspect ./src/bootstrap-entry.ts` - 启用 Node.js 调试器
- 设置环境变量 `LOG_LEVEL=debug` 启用详细日志
- `bun run --watch ./src/bootstrap-entry.ts` - 热重载模式开发

## 数据目录结构

- `.doge/api.json` - API 配置（BaseURL、API Key、模型）
- `.doge/sessions/` - 会话历史存储
- `.doge/plugins/` - 插件配置
- `~/.doge/` - 用户级全局配置（当项目无 `.doge/` 时使用）

## 添加汉化文本

1. 在 `_replacements.json` 中添加正则匹配规则
2. 运行 `./check_untranslated.sh` 扫描遗漏
3. 检查 `Temp/english_comment_files*.txt` 确认覆盖

## 故障排除

- **"process.stdin 不支持原始模式"**：在真实终端（Windows Terminal、CMD、PowerShell）中运行，避免使用受限的 IDE 内置终端
- **API 连接失败**：检查 `.doge/api.json` 中的 BaseURL 和 API Key 是否正确，确保网络可访问
- **编译失败**：确认 Bun 版本 >=1.3.5，运行 `bun --version` 检查
- **会话历史丢失**：检查 `~/.doge/sessions/` 目录是否存在且权限正确

## 调试

- `bun run --inspect ./src/bootstrap-entry.ts` - 启用 Node.js 调试器
- 设置环境变量 `LOG_LEVEL=debug` 启用详细日志
- `bun run --watch ./src/bootstrap-entry.ts` - 热重载模式开发

## 数据目录结构

- `.doge/api.json` - API 配置（BaseURL、API Key、模型）
- `.doge/sessions/` - 会话历史存储
- `.doge/plugins/` - 插件配置
- `~/.doge/` - 用户级全局配置（当项目无 `.doge/` 时使用）

## 添加汉化文本

1. 在 `_replacements.json` 中添加正则匹配规则
2. 运行 `./check_untranslated.sh` 扫描遗漏
3. 检查 `Temp/english_comment_files*.txt` 确认覆盖
