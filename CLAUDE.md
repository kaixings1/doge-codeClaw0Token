# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目概述

**Doge Code** 是基于 Claude Code 源码树重构和魔改的 AI 编程助手 CLI 工具。它移除了官方订阅限制，添加了多模型支持、汉化界面和自定义代理功能。

## 技术栈

- **运行时**: Bun >= 1.3.5 或 Node.js >= 24.0.0
- **语言**: TypeScript (ES2020) + React (Ink TUI)
- **包管理器**: Bun (primary), npm
- **UI 框架**: Ink (React-based TUI)

## 核心命令

### 启动与运行

```bash
# 安装依赖
bun install

# 开发模式运行
bun run dev

# 或启动狗命令
doge

# 查看版本
bun run version

# Windows 快速启动
d.bat
```

### CLI 内部命令

```
/login          切换 BaseURL、API Key、模型配置
/clear          清空会话上下文
/plugins        管理插件
/skills         管理技能
/agents         管理代理
/compact        压缩会话，减少 token 消耗
/context        查看上下文用量
/rewind         上下文回滚 (或 ESC ESC)
/resume         恢复选定的会话
/rename         重命名会话
/model          切换当前模型
/cost           查看计费情况
/plan /Shift+Tab 进入计划模式
```

### 构建与测试

```bash
# 安装依赖
bun install

# 全局注册
bun link

# 编译为 exe (Windows)
install.bat
complie.bat

# 测试 (如有)
bun test
bun test <file>
bun test --coverage
```

## 高层架构

### 启动流程

```
bootstrap-entry.ts (主入口)
  ↓
  加载 .env + .doge/api.json 配置
  ↓
  设置环境变量 (API_KEY, BASE_URL, MODEL 等)
  ↓
entrypoints/cli.tsx (CLI 启动器)
  ↓
  解析命令行参数，处理快速路径 (--version, --help 等)
  ↓
main.tsx (主 TUI)
  ↓
  初始化核心模块：auth, config, plugins, tools
  ↓
  Ink TUI 启动
  ↓
commands.ts (命令分发)
  ↓
  assistant/gate.ts + tools/ + services/api/
```

### 核心目录结构

```
src/
├── bootstrap/              # 启动引导和配置初始化
├── commands/               # CLI 命令实现 (/login, /clear 等 100+ 命令)
├── components/             # Ink TUI 组件 (React-based)
├── context/                # 会话上下文管理
├── coordinator/            # 多代理协调器 (agent swarms)
├── entrypoints/            # 入口点 (cli.tsx, init.js, repl 等)
├── ink/                    # Ink TUI 封装
├── plugins/                # 插件系统
├── screens/                # TUI 屏幕/视图
├── services/               # 后端服务 (API, auth, analytics)
├── tools/                  # AI 工具实现 (70+ 工具：BashTool, ReadTool, EditTool 等)
├── utils/                  # 通用工具函数
└── shims/                  # 兼容性适配层
```

## 重要架构决策

### 1. 配置隔离

Doge Code 使用 `~/.doge` 作为独立配置目录，与官方 Claude Code 的 `~/.claude` 分离，避免配置冲突。

### 2. 多模型支持

通过 `.doge/api.json` 管理多个模型预设 (presets)，支持：
- Anthropic API
- OpenAI 兼容接口
- 本地代理 (Ollama, 自定义服务器)

### 3. API 转接层

`src/services/api/openaiCompat.ts` 将 Anthropic Messages API 转换为 OpenAI Chat Completions 格式，允许在不修改核心逻辑的情况下使用不同 API。

### 4. Feature Flags

使用 GrowthBook feature flags 控制功能开关，支持构建时死代码消除。关键入口文件 (`cli.tsx`, `main.tsx`) 包含大量条件导入。

### 5. 命令系统

所有 `/` 命令在 `src/commands/` 中实现，每个命令是独立目录。`src/commands.ts` 统一注册，支持动态技能、插件、MCP 注入。

## 配置文件

### `.doge/api.json` (项目级 API 配置)

```json
{
  "activePreset": "default",
  "presets": {
    "name": {
      "provider": "anthropic" | "openai",
      "baseURL": "https://...",
      "apiKey": "...",
      "model": "...",
      "savedModels": [...]
    }
  }
}
```

### `.env` (环境变量)

- `LOG_LEVEL` - 日志级别
- `CLAUDE_TRUNCATE_COMPACT_THRESHOLD` - 截断压缩阈值
- `ANTHROPIC_BASE_URL`, `DOGE_API_KEY`, `CLAUDE_CONFIG_DIR` 等

### 截断相关环境变量

- `CLAUDE_TRUNCATE_WARN_THRESHOLD` - 警告阈值 (令牌数)
- `CLAUDE_TRUNCATE_COMPACT_THRESHOLD` - 压缩阈值 (令牌数)
- `CLAUDE_TRUNCATE_ERROR_THRESHOLD` - 错误阈值 (令牌数)
- `CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES` - 最大历史消息数
- `CLAUDE_KEEP_LAST_MESSAGES` - 保留最后消息数

## 调试

```bash
# 启用调试器
bun run --inspect ./src/bootstrap-entry.ts

# 详细日志
LOG_LEVEL=debug bun run dev

# 热重载
bun run --watch ./src/bootstrap-entry.ts
```

## 扩展指南

### 添加新命令

1. 在 `src/commands/` 下创建新命令目录
2. 创建 `index.ts` 导出命令对象 (`type: 'local-jsx'`, `name`, `description`, `load`)
3. 在 `src/commands.ts` 中导入并添加到 `COMMANDS` 数组
4. 如需远程安全命令，添加到 `REMOTE_SAFE_COMMANDS` Set

### 添加新工具

1. 在 `src/tools/` 下创建新工具目录
2. 创建工具实现和 `prompt.ts`
3. 在 `src/tools.ts` 中导出并注册
4. 在 `Tool.ts` 中定义权限规则

### 修改 API 通信

- `src/services/api/claude.ts` - Claude API 封装
- `src/services/api/client.ts` - HTTP 客户端封装
- `src/services/api/openaiCompat.ts` - OpenAI 兼容层
- `src/services/api/errors.ts` - 错误处理

## 上下文管理

- `src/services/compact/autoCompact.ts` - 自动压缩逻辑
- `src/services/compact/compact.ts` - 压缩实现
- `src/utils/truncateRecovery.ts` - 截断恢复
- `src/services/contextCollapse/` - 上下文折叠

## 数据目录

| 路径 | 说明 |
|------|------|
| `.doge/api.json` | API 配置 |
| `.doge/sessions/` | 会话历史 |
| `.doge/plugins/` | 插件配置 |
| `~/.doge/` | 用户级全局配置 |

## 注意事项

- 此项目**不是**官方 Claude Code，而是深度修改的 Fork
- 大部分脚本假设 Windows 环境
- 首次运行时若遇到 "process.stdin 不支持原始模式"，请确保在真实终端中运行
- 项目使用 Bun 作为主要运行时，确保已安装 Bun >= 1.3.5
- **安全警告**: `.doge/api.json` 包含真实 API Key，请勿提交至公开仓库
