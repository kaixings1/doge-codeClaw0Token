# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目信息

- **项目名称**: Doge Code (基于 Claude Code 的汉化/魔改版)
- **入口语言**: TypeScript
- **运行时**: Bun (>=1.3.5) + Node.js (>=24.0.0)
- **包管理器**: npm / bun
- **主入口**: `./src/bootstrap-entry.ts`
- **CLI 命令名**: `doge` (全局) 或 `d.bat` (项目内)

## 常用命令

### 启动与运行

- `bun run dev` - 启动 TUI 开发模式（热重载）
- `bun run start` - 启动应用
- `bun run version` - 输出版本信息
- `d.bat` - Windows 快速启动（预设环境变量）

### 安装与构建

- `bun install` - 安装依赖
- `bun link` - 全局注册为 `doge` 命令
- `install.bat` - Windows 一键安装
- `complie.bat` - 编译为 `doge.exe` 独立可执行文件

### 测试

- `bun test` - 运行所有测试
- `bun test <file>` - 运行单个测试文件
- `bun test --coverage` - 运行测试并生成覆盖率报告

## 代码架构

### 启动流程

```
bootstrap-entry.ts
  → 加载 .env + .doge/api.json
  → 设置环境变量
  → entrypoints/cli.tsx
  → main.tsx (TUI 主循环)
  → commands.ts (命令分发)
  → assistant/gate.ts + tools/ + services/api/
```

### 核心模块

| 模块 | 职责 |
|------|------|
| `bootstrap-entry.ts` | 启动逻辑、环境配置、模式初始化 |
| `entrypoints/` | CLI 入口解析 |
| `cli/` | 输出打印、NDJSON 序列化、传输层 |
| `commands/` | 所有 `/` 命令实现（100+ 个） |
| `tools/` | 工具系统（BashTool, ReadTool, EditTool 等） |
| `assistant/` | 会话网关，管理助手生命周期 |
| `components/` | Ink/React UI 组件 |
| `services/api/` | API 通信层 |

### 重要架构特点

1. **API 转接层**: `services/api/openaiCompat.ts` 将 Anthropic Messages API 转换为 OpenAI Chat Completions 格式
2. **跨模型切换**: `/login` 支持配置不同厂商的 BaseURL、API Key、模型
3. **命令加载**: `commands.ts` 统一注册，支持动态技能、插件、MCP 注入
4. **远程安全**: `REMOTE_SAFE_COMMANDS` / `BRIDGE_SAFE_COMMANDS` 标识远程可执行命令

## 配置系统

- **项目级**: `./.doge/api.json` - API 配置
- **全局**: `~/.doge/` - 用户级配置
- **环境变量**: `ANTHROPIC_BASE_URL`, `DOGE_API_KEY`, `CLAUDE_CONFIG_DIR` 等

## 注意事项

- 此项目**不是**官方 Claude Code，而是深度修改的 Fork
- 大部分脚本假设 Windows 环境
- 首次运行时若遇到 "process.stdin 不支持原始模式"，请确保在真实终端中运行

## 调试

- `bun run --inspect ./src/bootstrap-entry.ts` - 启用调试器
- `LOG_LEVEL=debug` - 详细日志
- `bun run --watch ./src/bootstrap-entry.ts` - 热重载

## 添加新命令

1. 在 `src/commands/` 下创建新命令目录
2. 创建 `index.js` 导出命令对象
3. 在 `src/commands.ts` 中导入并添加到 `COMMANDS` 数组

## 添加远程安全命令

1. 在 `src/commands.ts` 中导入新命令
2. 将命令对象添加到 `REMOTE_SAFE_COMMANDS` Set
3. 确保命令类型为 `'local'` 或 `'prompt'`，不依赖本地资源

## 数据目录

- `.doge/api.json` - API 配置
- `.doge/sessions/` - 会话历史
- `.doge/plugins/` - 插件配置
- `~/.doge/` - 用户级全局配置
