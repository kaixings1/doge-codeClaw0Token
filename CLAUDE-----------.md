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

### 新增命令统计

| 类别 | 数量 |
|------|------|
| API/API-like | graphql, http, websocket, event-stream |
| CLI/API-like | shell, database, cron, queue, cache, backup, mcp-tool-search |
| Monitor/Utility | file-watcher, logger, metrics, monitor, task-create |
| Context/Plan | plan-mode, compare, schedule |
| Other | less-permission-prompts, context-collapse |

### 常用命令

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

**新增命令（21 个）**：
`less-permission-prompts` - 减少提示词权限要求
`context-collapse` - 上下文折叠
`task-create` - 创建任务
`plan-mode` - 计划模式
`compare` - 比较工具
`graphql` - GraphQL API
`http` - HTTP API
`database` - 数据库工具
`shell` - Shell API
`file-watcher` - 文件监控器
`schedule` - 日程管理
`cron` - 定时任务
`websocket` - WebSocket API
`event-stream` - 事件流 API
`queue` - 任务队列
`cache` - 缓存工具
`logger` - 日志工具
`metrics` - 指标工具
`monitor` - 监控系统
`backup` - 备份工具
`mcp-tool-search` - MCP 工具搜索

## 常用命令

### 新增命令统计

| 类别 | 数量 |
|------|------|
| API/API-like | graphql, http, websocket, event-stream |
| CLI/API-like | shell, database, cron, queue, cache, backup, mcp-tool-search |
| Monitor/Utility | file-watcher, logger, metrics, monitor, task-create |
| Context/Plan | plan-mode, compare, schedule |
| Other | less-permission-prompts, context-collapse |

项目是 Claude Code 的恢复源码树，经过大幅修改以支持中文、自定义 API 和多模型切换。

### 启动流程

```
bootstrap-entry.ts (入口)
  ↓
加载 .env 文件 + 读取 .doge/api.json
  ↓
设置环境变量 (ANTHROPIC_BASE_URL, DOGE_API_KEY 等)
  ↓
entrypoints/cli.tsx (CLI/TUI 初始化)
  ↓
main.tsx (TUI 主循环)
  ↓
commands.ts (命令注册与分发)
  ↓
assistant/gate.ts (会话网关)
  ↓
tools/ (工具执行) + services/api/ (API 通信)
```

### 核心模块

- **`bootstrap-entry.ts`**: 实际启动逻辑，加载 `.env` 和 `.doge/api.json`，设置关键环境变量，初始化本地模式或远程模式
- **`entrypoints/`**: CLI 入口解析（`cli.tsx`, `init.ts`）
- **`cli/`**: 输出打印、NDJSON 序列化、传输层（WebSocket/SSE）
- **`commands/`**: 所有 `/` 命令实现，子目录按功能分组（`plugin/`, `agents/`, `bridge/` 等），约 100+ 个内置命令
- **`tools/`**: 工具系统基础类和具体实现（`BashTool`, `ReadTool`, `EditTool` 等）
- **`assistant/`**: 会话网关（`gate.ts`）管理助手实例生命周期，会话历史管理
- **`components/`**: Ink/React UI 组件（`App.tsx`, `Messages.tsx`, `MessageSelector.tsx`, `VirtualMessageList.tsx`）
- **`services/api/`**: API 通信层，包含 `claude.ts`, `client.ts`, `openaiCompat.ts`（Anthropic↔OpenAI 协议转接）
- **`bridge/`**: 与 IDE 桥接通信（ReplBridge、远程会话）
- **`buddy/`**: 伙伴系统（满级稀有伴侣功能）

### 重要架构特点

1. **API 转接层**: 核心转接逻辑在 `services/api/openaiCompat.ts`，将 Anthropic Messages API 格式转换为 OpenAI Chat Completions 格式，支持任意兼容 OpenAI 的端点
2. **跨模型切换**: `/login` 命令支持配置不同厂商的 BaseURL、API Key 和模型，配置存储在项目 `.doge/` 或用户 `~/.doge/` 目录
3. **数据隔离**: 默认使用 `~/.doge/` 目录存储配置和会话，避免与原版 Claude Code 冲突
4. **汉化层**: 代码注释和用户界面优先使用中文；`_replacements.json` 存储批量替换规则；`Temp/` 目录记录待汉化的英文注释位置
5. **可执行编译**: `complie.bat` 使用 `bun build --compile` 生成独立的 `doge.exe`，无需运行时分发
6. **命令加载**: 命令通过 `commands.ts` 统一注册，支持从 `./commands/` 目录、`./skills/` 目录、插件和 MCP 动态加载
7. **远程安全**: 通过 `REMOTE_SAFE_COMMANDS` 和 `BRIDGE_SAFE_COMMANDS` 集合，标识可在移动端/Web 客户端安全执行的命令

### 命令系统架构

**命令来源**：
- 内置命令：约 100+ 个，通过 `commands.ts` 显式导入
- 技能目录命令：从 `./skills/` 目录动态加载
- 插件命令：从已启用的插件加载
- MCP 命令：从 MCP 服务器动态注册
- 工作流命令：通过 `WORKFLOW_SCRIPTS` 功能开关启用

**命令过滤**：
- `meetsAvailabilityRequirement()`: 根据 `availability` 属性过滤（`claude-ai` 订阅者、`console` 密钥用户等）
- `isCommandEnabled()`: 根据功能开关检查命令是否启用

**远程模式安全**：
- `REMOTE_SAFE_COMMANDS`: 仅影响本地 TUI 状态，不依赖本地文件系统/git/shell/IDE/MCP
- `BRIDGE_SAFE_COMMANDS`: 可在移动端/Web 客户端安全执行的命令
- `isBridgeSafeCommand()`: 判断命令是否可在远程控制桥接器中安全执行

### 配置系统

**项目级配置**：`./.doge/api.json`
- `presets`: 配置预设集合
- `activePreset`: 当前激活的预设名称
- 包含 `baseURL`, `apiKey`, `provider`, `model` 等字段

**全局配置**：`~/.doge/`
- 用户级配置和会话历史
- 当项目无 `.doge/` 目录时使用

**环境变量配置**：通过 `bootstrap-entry.ts` 设置
- `ANTHROPIC_BASE_URL`: Anthropic API 端点
- `DOGE_API_KEY`: API Key
- `ANTHROPIC_MODEL`: 当前模型
- `CLAUDE_CODE_COMPATIBLE_API_PROVIDER`: 提供商类型（`openai`/`anthropic`）
- `LOG_LEVEL`: 日志级别（默认 `info`）
- `CLAUDE_TRUNCATE_COMPACT_THRESHOLD`: 截断阈值（通过 `.env` 文件配置）

### 环境变量参考

启动时通过 `d.bat` 设置。关键变量:
- `STREAM_FLUSH_MS=150`: 流式响应刷新间隔
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS=128000`: 最大上下文 token
- `CLAUDE_CODE_SIMPLE=1`: 简化工具模式（1=启用）
- `CLAUDE_CODE_ATTRIBUTION_HEADER=0`: 禁用属性头
- `API_TIMEOUT_MS=600000`: API 超时（10 分钟）
- `BASH_DEFAULT_TIMEOUT_MS=600000`: Bash 命令超时
- `ANTHROPIC_BASE_URL`: API 端点切换
- `CLAUDE_CONFIG_DIR`: 覆盖配置目录（默认 `~/.doge`）

### Windows 批处理脚本说明

- `d.bat` - 主启动脚本，设置所有环境变量后启动
- `install.bat` - 安装依赖 + 编译 exe + 复制到 `F:\bin`
- `complie.bat` - 仅编译为 `doge.exe`
- `commit.bat` - 快速提交到 GitHub

### Git 同步（Fork 维护）

- `git pull` - 拉取当前仓库更新
- `git pull upstream main` - 同步上游 Fork 仓库（需先配置 `git remote add upstream <url>`）

## 注意事项

- 此项目**不是**官方 Claude Code，而是深度修改的 Fork
- 大部分脚本假设 Windows 环境（`.bat` 文件），Bash 脚本（`*.sh`）主要用于检查逻辑和 Unix 兼容
- 命令加载通过 `commands.ts` 统一处理，支持动态技能、插件、MCP 注入
- 编译为 exe 时需要确保 Bun 已正确安装并能访问 Node.js 原生模块
- 首次运行时若遇到 "process.stdin 不支持原始模式" 错误，请确保在真实终端（如 Windows Terminal、CMD、PowerShell）中运行，而非某些受限的 IDE 内置终端

## 故障排除

- **"process.stdin 不支持原始模式"**：在真实终端（Windows Terminal、CMD、PowerShell）中运行，避免使用受限的 IDE 内置终端
- **API 连接失败**：检查 `.doge/api.json` 中的 BaseURL 和 API Key 是否正确，确保网络可访问
- **编译失败**：确认 Bun 版本 >=1.3.5，运行 `bun --version` 检查
- **会话历史丢失**：检查 `~/.doge/sessions/` 目录是否存在且权限正确
- **命令未显示**：检查命令是否通过 `commands.ts` 显式导入，或是否在技能/插件目录中被正确识别

## 调试

- `bun run --inspect ./src/bootstrap-entry.ts` - 启用 Node.js 调试器
- 设置环境变量 `LOG_LEVEL=debug` 启用详细日志
- `bun run --watch ./src/bootstrap-entry.ts` - 热重载模式开发
- 读取 `.env` 文件内容以确认环境变量已正确加载

## 数据目录结构

- `.doge/api.json` - API 配置（BaseURL、API Key、模型）
- `.doge/sessions/` - 会话历史存储
- `.doge/plugins/` - 插件配置
- `~/.doge/` - 用户级全局配置（当项目无 `.doge/` 时使用）

## 添加汉化文本

1. 在 `_replacements.json` 中添加正则匹配规则
2. 运行 `./check_untranslated.sh` 扫描遗漏
3. 检查 `Temp/english_comment_files*.txt` 确认覆盖

## 添加新命令

1. 在 `src/commands/` 下创建新命令目录（如 `newcommand/`）
2. 创建 `index.js` 导出命令对象（包含 `name`, `description`, `type` 等字段）
3. 在 `src/commands.ts` 中导入并添加到 `COMMANDS` 数组
4. 对于技能目录命令，创建 `./skills/newskill/` 并添加 `frontmatter` 配置
5. 对于插件命令，实现 `PluginCommand` 接口并在插件 manifest 中注册

## 远程模式安全命令

以下命令在远程模式（`--remote`）下安全执行：
- `session` - 显示远程会话二维码/URL
- `exit` - 退出 TUI
- `clear` - 清屏
- `help` - 显示帮助
- `theme` - 更改终端主题
- `color` - 更改 agent 颜色
- `vim` - 切换 vim 模式
- `cost` - 显示会话成本
- `usage` - 显示使用信息
- `copy` - 复制最后一条消息
- `btw` - 快速备注
- `feedback` - 发送反馈
- `plan` - 计划模式切换
- `keybindings` - 快捷键管理
- `statusline` - 状态行切换
- `stickers` - 贴纸
- `mobile` - 移动端二维码

## 添加新远程安全命令

1. 在 `src/commands.ts` 中导入新命令
2. 将命令对象添加到 `REMOTE_SAFE_COMMANDS` Set
3. 对于可通过桥接器执行的命令，同时添加到 `BRIDGE_SAFE_COMMANDS` Set
4. 确保命令类型为 `'local'` 或 `'prompt'`，不依赖本地资源

## 命令加载机制

- **内置命令**: 在 `commands.ts` 中显式导入，约 100+ 个
- **技能目录**: 从 `./skills/` 加载，支持 `frontmatter` 配置
- **插件命令**: 通过 `getPluginCommands()` 动态加载
- **MCP 命令**: 通过 MCP 协议动态注册
- **工作流命令**: 需 `WORKFLOW_SCRIPTS` 功能开关
- **动态技能**: 通过 `getDynamicSkills()` 获取，插入到插件命令之后、内置命令之前

## 命令过滤机制

- **可用性过滤**: `meetsAvailabilityRequirement()` 检查 `availability` 属性
- **启用状态**: `isCommandEnabled()` 检查功能开关
- **远程过滤**: `filterCommandsForRemoteMode()` 仅保留 `REMOTE_SAFE_COMMANDS` 中的命令
