# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目概述

Doge Code 是基于 Claude Code 的中文汉化版和定制版，核心特性：
- 多模型/API 提供商支持（Anthropic Claude、OpenAI 兼容接口、本地部署模型）
- 会话记忆自动压缩（`/compact` 命令）
- 100+ 内置 CLI/TUI 命令 + 插件/MCP 工具扩展
- 远程桥接模式（移动端/Web 客户端）
- 可编译为独立可执行文件
- 中文提示词优化，显著降低 token 消耗

## 高层架构（快速理解全局）

### 启动与命令系统（最关键的跨文件链路）

```
src/bootstrap-entry.ts  →  src/dev-entry.ts (开发环境)  →  src/main.tsx
     ↓                                                  ↓
src/commands.ts (命令注册中心) ────────────────────→ Ink TUI 渲染层
     ↓
src/core.ts (会话状态、实验评估) ─────────────────→ 所有命令共享的上下文
```

**关键跨文件概念：**

1. **命令注册** (`src/commands.ts`):
   - 主注册表维护所有命令的元数据和实现函数
   - 通过 `memoize` 缓存命令列表，支持运行时动态技能加载
   - 命令分类：`local` (TUI 专用)、`prompt` (模型调用)、`local-jsx` (UI 渲染)
   - 支持从 builtin/bundled/skills/plugin/mcp 五个来源加载命令

2. **会话生命周期** (`src/core.ts`):
   - 管理 session 状态、token 计数、压缩阈值
   - 集成 GrowthBook 进行 A/B 实验评估
   - 提供 `buildEffectiveContext()` 统一构建用户/系统上下文

3. **API 抽象层** (`src/services/api/`):
   - `claude.ts`: Anthropic SDK 主封装，处理消息格式转换
   - `client.ts`: 基础 HTTP 客户端，包含重试、超时、错误处理
   - `openaiCompat.ts`: 中间转接层，将 Anthropic Messages 格式转发到 OpenAI Chat Completions
   - `filesApi.ts`: 文件上传/下载，支持本地路径和远程 URL

4. **压缩系统** (`src/services/compact/`):
   - `compact.ts`: 核心压缩逻辑，调用 Anthropic API 进行上下文分组和摘要
   - `sessionMemoryCompact.ts`: 专门处理 session 记忆的压缩状态管理
   - `autoCompact.ts`: 基于 token 阈值的自动触发器
   - `reactiveCompact.ts`: 响应式压缩，当提示长度超过 `CLAUDE_TRUNCATE_COMPACT_THRESHOLD` 时触发

### 插件与 MCP 工具

- `src/plugins/builtinPlugins.ts`: 注册内置插件（如文件操作、代码编辑器等）
- `src/commands/mcp/index.ts`: MCP 协议工具发现与调用，支持本地/远程 MCP 服务器
- `src/utils/plugins/loadPluginCommands.js`: 从插件目录扫描并加载命令

## 开发工作流

### 环境准备

```bash
# 安装依赖（推荐 Bun）
bun install

# 或安装 Node.js 24+ 和 npm
npm install
```

### 日常开发命令

```bash
# 启动开发服务器（TUI 模式）
bun run dev

# 编译 TypeScript 并打包
bun run build

# 运行单个测试文件
bun test src/services/compact/compact.test.ts

# 运行所有测试（可选覆盖率）
bun test --coverage

# 输出版本信息
bun run version

# 检查依赖完整性（恢复模式）
bun run dev:restore-check
```

### Windows 快捷命令

```bash
install.bat    # 安装依赖
complie.bat    # 编译打包
d.bat          # 全局运行入口（已配置环境变量）
```

### 运行单个测试的最佳实践

```bash
# 运行特定测试文件
bun test src/commands/rename/generateSessionName.test.ts

# 运行测试并只打印失败用例
bun test --reporter=jest-junit

# 运行测试并捕获输出（方便调试）
bun test --verbose
```

## 关键配置位置

- `.doge/api.json`: API 提供商配置（BaseURL、模型、密钥）
- `.env`: 环境变量（`CLAUDE_TRUNCATE_COMPACT_THRESHOLD` 等）
- `package.json`: 脚本定义和 bin 入口
- `tsconfig.json`: TypeScript 编译配置

## 代码风格与规范

- TypeScript 6.0+，严格模式
- ES Modules 语法 (`import/export`)
- Ink 2.x 用于 TUI 渲染
- Zod 用于运行时类型验证
- Bun 运行时（1.3.5+），但兼容 Node.js 24+

## 常见调试场景

| 问题 | 检查点 |
|------|--------|
| 压缩失败 | `src/services/compact/compact.ts` API 调用逻辑 |
| 命令未注册 | `src/commands.ts` 中的 `INTERNAL_ONLY_COMMANDS` 数组 |
| 桥接模式异常 | `REMOTE_SAFE_COMMANDS` / `BRIDGE_SAFE_COMMANDS` 白名单 |
| 插件未加载 | `src/utils/plugins/loadPluginCommands.js` |
| 上下文压缩异常 | `src/services/compact/sessionMemoryCompact.ts` 状态管理 |

## 与上游的关系

- 上游仓库：`https://github.com/HELPMEEADICE/doge-code.git`
- 上游分支：`main`
- 自动同步：通过 GitHub Actions 定期拉取更新并自动发布 npm 包
- 数据隔离：默认使用 `~/.doge` 而非官方的 `~/.claude` 目录

## 测试策略

- Jest 测试框架 + `*.test.ts` 命名约定
- 测试文件与源文件同目录（如 `src/services/compact/compact.ts` → `compact.test.ts`）
- 支持 `--filter` 按名称运行子集，支持 `--coverage` 生成报告
