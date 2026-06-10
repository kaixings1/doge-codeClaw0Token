# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

---

# Doge Code 项目指南

## 项目概述

Doge Code 是基于 Claude Code 源码重构的汉化魔改版本，支持自定义 Anthropic 兼容接口、OpenAI Chat Completions 转接、自定义 API Key 和模型管理。它使用 Bun 运行时，命令行入口为 `doge`。

## 开发环境配置

### 环境要求
- Bun 1.3.5+
- Node.js 24.0.0+

### 安装依赖
```bash
bun install
```

### 启动开发
```bash
bun run dev
```

### 输出版本信息
```bash
bun run version
```

## 常用命令

### 开发命令
- `bun run dev` — 启动 CLI/TUI
- `bun run start` — 同 dev
- `bun run version` — 输出版本信息
- `bun link` — 注册为全局命令 `doge`

### 主要 CLI 命令（通过 `/` 调用）

#### 会话管理
- `/login` — 切换 baseURL、API Key、模型配置
- `/clear` — 清空上下文，重新会话
- `/resume <id>` — 恢复选定的会话
- `/compact` — 压缩会话内容，减少 token 消耗
- `/context` — 查看上下文用量
- `/rewind` 或 `ESC+ESC` — 上下文回滚到指定轮次

#### 模型与配置
- `/model` — 切换当前模型
- `/config` — 配置管理
- `/env` — 环境变量管理

#### 插件与技能
- `/plugins` — 插件管理
- `/skills` — 技能管理
- `/mcp` — MCP 工具管理

#### 代理与协作
- `/agents` — 代理管理
- `/teleport` — 远程会话连接
- `/share` — 分享会话

#### 分析与统计
- `/cost` — 查看计费情况
- `/stats` — 统计信息
- `/insights` — 生成会话分析报告
- `/usage` — 使用信息

#### 任务与计划
- `/plan` 或 `Shift+Tab×2` — 计划模式
- `/tasks` — 任务管理
- `/ultraplan` — 超计划模式

#### 其他
- `/help` — 显示帮助
- `/exit` — 退出 TUI
- `/theme` — 更改终端主题
- `/vim` — 切换 vim 模式
- `/fast` — 快速模式
- `/passes` — 通过验证模式

### 工作流命令
- `/workflow` — 列出/创建/执行工作流
- 工作流脚本位于 `.doge/workflows/`

## 代码架构

### 核心模块

#### 1. 命令系统 (`src/commands/`)
- `commands.ts` — 命令注册中心，通过 `memoize` 缓存命令列表
- 每个命令目录包含 `index.js`，定义命令的 `name`、`description`、`type` 等
- 命令按来源分类：`builtin`（内置）、`skills`（技能目录）、`plugin`（插件）、`bundled`（打包）、`mcp`（MCP 工具）、`workflow`（工作流）
- 命令按 `type` 分类：`prompt`（AI 提示）、`local`（本地 UI 操作）、`local-jsx`（Ink UI 渲染）
- `getCommands(cwd)` 加载所有命令，通过 `meetsAvailabilityRequirement()` 和 `isCommandEnabled()` 过滤
- 动态技能从 `src/skills/` 加载，插件技能从 `src/plugins/` 加载

#### 2. 核心引擎 (`src/` 根目录)
- `core.ts` — 核心协调器，会话生命周期管理
- `Tool.ts` — 工具调用机制，定义工具的 `name`、`description`、`parameters`（Zod Schema）
- `query.ts` — 上下文查询引擎，支持自然语言到工具调用的转换
- `QueryEngine.ts` — 查询解析和执行
- `context.ts` — 会话上下文状态管理
- `history.ts` — 消息历史记录与截断逻辑
- `feature-repository.ts` — 功能开关（Feature Flags）管理
- `cost-tracker.ts` — 会话成本跟踪

#### 3. API 服务 (`src/services/api/`)
- `claude.ts` — Anthropic 官方 API 客户端
- `client.ts` — 通用 API 客户端封装
- `openaiCompat.ts` — OpenAI Chat Completions ↔ Anthropic Messages 格式转接
- `filesApi.ts` — 文件操作 API
- `logging.ts` — 日志服务
- `errors.ts` — 错误处理与映射

#### 4. 前端组件 (`src/components/`)
- 使用 Ink.js 构建 TUI 界面
- `main.tsx` — 主入口，渲染 REPL 界面
- `dialogLaunchers.tsx` — 对话框组件
- `statusline.tsx` — 状态栏组件
- `replLauncher.tsx` — REPL 启动器

#### 5. 插件系统 (`src/plugins/`)
- `builtinPlugins.ts` — 内置插件定义
- 插件提供 `commands`、`skills`，通过 `src/utils/plugins/` 加载
- 插件可配置为启用/禁用状态

#### 6. 技能系统 (`src/skills/`)
- 技能目录：`.doge/skills/`
- `bundledSkills.ts` — 打包技能
- `loadSkillsDir.js` — 技能目录加载
- 技能通过 YAML frontmatter 定义 `name`、`description`、`whenToUse`、`parameters`、`prompt` 等

#### 7. 工具系统 (`src/tools/`)
- `tools.ts` — 工具注册中心
- `WorkflowTool/` — 工作流执行工具
- 工具提供 `name`、`description`、`parameters`，支持异步执行

#### 8. 状态管理 (`src/state/`)
- `AppState.ts` — 全局应用状态
- `SessionState.ts` — 会话状态
- `TaskState.ts` — 任务状态
- 通过 `src/context/` 协调跨模块状态

#### 9. 快捷键 (`src/keybindings/`)
- 定义快捷键映射
- 支持自定义快捷键
- 与 Ink 的 `onKeyDown` 事件集成

#### 10. 输出样式 (`src/outputStyles/`)
- 定义 Markdown 渲染样式
- 支持自定义主题

#### 11. 插件 (`src/plugins/`)
- 插件定义与加载
- 内置插件管理

#### 12. 语音 (`src/voice/`)
- 语音输入与输出
- STT（语音转文本）和 TTS（文本转语音）

#### 13. 远程模式 (`src/remote/`)
- 支持移动端/Web 客户端远程连接
- `/teleport` 生成连接二维码
- 桥接器安全命令白名单（`BRIDGE_SAFE_COMMANDS`）

### 架构设计要点

#### 命令-技能分离
- **命令**：用户通过 `/` 调用的交互命令，直接影响 TUI 状态
- **技能**：AI 模型可调用的能力，通过 `SkillTool` 展示给模型
- 命令和技能共享同一代码库，但通过 `type` 和 `disableModelInvocation` 区分

#### 命令加载流程
1. `getCommands(cwd)` 被调用
2. `loadAllCommands(cwd)` 并行加载：
   - 技能目录命令
   - 插件技能
   - 内置技能
   - 插件命令
   - 工作流命令
3. `COMMANDS()` 返回内置命令（`memoize` 缓存）
4. 合并、去重、按优先级排序
5. 通过 `meetsAvailabilityRequirement()` 和 `isCommandEnabled()` 过滤

#### 命令可用性检查
- `meetsAvailabilityRequirement(cmd)`: 检查命令的 `availability` 字段（`claude-ai`、`console` 等）
- `isCommandEnabled(cmd)`: 检查命令是否启用
- 认证状态变更（如 `/login`）时重新评估

#### 工作流系统
- 工作流脚本：JSON/TS/JS 文件，包含 `name`、`description`、`steps` 数组
- 步骤可包含 `name`、`description`、`prompt`、`command` 字段
- 支持并行执行（多个步骤同时运行）
- `/workflow <name>` 执行指定工作流

## 关键设计模式

### 1. Memoization
- `lodash-es/memoize` 广泛用于缓存开销较大的操作
- `getCommands(cwd)`、`loadAllCommands(cwd)`、`getSkillToolCommands`、`getSlashCommandToolSkills`
- `clearCommandMemoizationCaches()` 用于清除缓存

### 2. 条件导入
- 基于 Feature Flags 的条件导入，避免加载未启用功能
- `feature('KAIROS') ? require(...) : null`
- 减少启动时的模块加载时间

### 3. 防御性编程
- 所有 `require()` 调用用 `.catch()` 包裹
- 加载失败不影响核心功能运行
- `try/catch` 防止技能加载失败导致整个系统崩溃

### 4. 命令白名单
- `REMOTE_SAFE_COMMANDS`: 远程模式下安全的命令（仅影响 TUI 状态）
- `BRIDGE_SAFE_COMMANDS`: 桥接器可执行的命令（生成文本输出）
- `isBridgeSafeCommand(cmd)`: 判断命令是否桥接器安全

### 5. 上下文截断
- 多级阈值：警告、精简、错误
- 保留最近 N 条消息（`CLAUDE_KEEP_LAST_MESSAGES`）
- 保留最近 N 个 token 的历史（`CLAUDE_TRUNCATE_MAX_HISTORY_TOKENS`）
- 系统提示保留（`CLAUDE_KEEP_SYSTEM_PROMPT`）

## 配置文件

### 项目级 `.doge/`
- `.doge/api.json` — 活动 API 配置预设
- `.doge/workflows/` — 工作流脚本
- `.doge/skills/` — 技能目录
- `.doge/plugins/` — 插件配置

### 全局配置
- `~/.doge/.claude.json` — 全局配置（与原版 Claude Code 隔离）

### 环境变量 (`.env`)
- `CLAUDE_TRUNCATE_WARN_THRESHOLD` — 截断警告阈值
- `CLAUDE_TRUNCATE_COMPACT_THRESHOLD` — 截断精简阈值
- `CLAUDE_TRUNCATE_ERROR_THRESHOLD` — 截断错误阈值
- `CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES` — 最大历史消息数
- `CLAUDE_TRUNCATE_MAX_HISTORY_TOKENS` — 最大历史 token 数
- `CLAUDE_KEEP_LAST_MESSAGES` — 保留最后 N 条消息
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` — 自动精简窗口
- `CLAUDE_MIN_CONTEXT_WINDOW` — 上下文窗口最小值
- `CLAUDE_KEEP_SYSTEM_PROMPT` — 保留系统提示
- `CLAUDE_AUTO_COMPACT_ENABLED` — 启用自动精简
- `CLAUDE_AUTO_COMPACT_BUFFER` — 自动精简缓冲
- `CLAUDE_WARNING_BUFFER` — 警告缓冲
- `CLAUDE_ERROR_BUFFER` — 错误缓冲
- `LOG_LEVEL` — 日志级别
- `ANTHROPIC_BASE_URL` — Anthropic 基础 URL
- `DOGE_API_KEY` — API 密钥
- `ANTHROPIC_MODEL` — 模型名称
- `CLAUDE_CODE_COMPATIBLE_API_PROVIDER` — API 提供商

## 测试

### 运行测试
```bash
bun test
```

### 运行单个测试文件
```bash
bun test src/commands/compact/index.test.js
```

### 运行特定测试
```bash
bun test src/commands/compact/index.test.js --filter "压缩会话"
```

## 调试技巧

### 启用调试日志
```bash
export LOG_LEVEL=debug
bun run dev
```

### 查看命令列表
```bash
bun run dev
# 然后输入 /help
```

### 查看可用技能
```bash
bun run dev
# 然后输入 /skills
```

### 查看工作流
```bash
/workflow
# 列出所有工作流
```

### 清除缓存
```bash
# 清除命令 memoization 缓存
doge clear-commands-cache
# 或者手动清除
```

## 注意事项

1. **配置隔离**：Doge Code 使用 `.doge/` 目录，与原版 Claude Code 的 `.claude/` 隔离
2. **Feature Flags**：许多功能通过 `feature()` 开关，启动时根据配置决定是否加载
3. **动态加载**：技能、插件、工作流在运行时动态加载，避免启动时全部加载
4. **防御性错误处理**：单个模块加载失败不应影响整个系统
5. **远程安全**：桥接器模式有严格的命令白名单，防止不安全命令执行