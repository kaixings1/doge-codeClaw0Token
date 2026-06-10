# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目信息

- **项目名称**: Doge Code (基于 Claude Code 的汉化/魔改版)
- **入口语言**: TypeScript (ES2020)
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
- `bun test test_truncate.ts` - 运行特定测试文件

## 代码架构

### 启动流程

\`\`\`
bootstrap-entry.ts
  → 加载 .env + .doge/api.json
  → 设置环境变量
  → entrypoints/cli.tsx
  → main.tsx (TUI 主循环)
  → commands.ts (命令分发)
  → assistant/gate.ts + tools/ + services/api/
\`\`\`

### 核心模块

| 模块 | 职责 |
|------|------|
| \`bootstrap-entry.ts\` | 启动逻辑、环境配置、模式初始化 |
| \`entrypoints/\` | CLI 入口解析，包括 cli.tsx、mcp.ts、sdk/ |
| \`cli/\` | 输出打印、NDJSON 序列化、传输层 |
| \`commands/\` | 所有 `/` 命令实现（100+ 个命令） |
| \`tools/\` | 工具系统（70+ 个工具，如 BashTool、ReadTool、EditTool 等） |
| \`assistant/\` | 会话网关，管理助手生命周期 |
| \`components/\` | Ink/React UI 组件 |
| \`services/api/\` | API 通信层，包括 openaiCompat.ts、claude.ts、client.ts |

### 重要架构特点

1. **API 转接层**: \`services/api/openaiCompat.ts\` 将 Anthropic Messages API 转换为 OpenAI Chat Completions 格式
2. **跨模型切换**: \`/login\` 支持配置不同厂商的 BaseURL、API Key、模型
3. **命令加载**: \`commands.ts\` 统一注册，支持动态技能、插件、MCP 注入
4. **远程安全**: \`REMOTE_SAFE_COMMANDS\` / \`BRIDGE_SAFE_COMMANDS\` 标识远程可执行命令
5. **上下文截断**: 通过 \`services/compact/\` 和 \`src/utils/truncate*\` 管理上下文长度
6. **工具权限系统**: \`Tool.ts\` 定义工具权限上下文和验证逻辑

### 测试文件位置

- \`test_truncate.ts\` - 截断环境变量测试
- \`test_truncate.js\` - 截断配置测试
- \`test_truncate_integration.js\` - 集成测试
- \`test_truncate_unit.js\` - 单元测试

## 配置系统

- **项目级**: \`./.doge/api.json\` - API 配置
- **全局**: \`~/.doge/\` - 用户级配置
- **环境变量**: \`ANTHROPIC_BASE_URL\`, \`DOGE_API_KEY\`, \`CLAUDE_CONFIG_DIR\` 等

### 截断环境变量

- \`CLAUDE_TRUNCATE_WARN_THRESHOLD\` - 警告阈值（令牌数）
- \`CLAUDE_TRUNCATE_COMPACT_THRESHOLD\` - 压缩阈值（令牌数）
- \`CLAUDE_TRUNCATE_ERROR_THRESHOLD\` - 错误阈值（令牌数）
- \`CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES\` - 最大历史消息数
- \`CLAUDE_KEEP_LAST_MESSAGES\` - 保留最后消息数

## 调试

- \`bun run --inspect ./src/bootstrap-entry.ts\` - 启用调试器
- \`LOG_LEVEL=debug\` - 详细日志
- \`bun run --watch ./src/bootstrap-entry.ts\` - 热重载

## 添加新命令

1. 在 \`src/commands/\` 下创建新命令目录
2. 创建 \`index.ts\` 导出命令对象（格式：\`type: 'local-jsx'\`, \`name\`, \`description\`, \`load: () => import(...)\`）
3. 在 \`src/commands.ts\` 中导入并添加到 \`COMMANDS\` 数组
4. 如需远程安全命令，添加到 \`REMOTE_SAFE_COMMANDS\` Set

## 添加新工具

1. 在 \`src/tools/\` 下创建新工具目录
2. 创建工具实现和 \`prompt.ts\`
3. 在 \`src/tools.ts\` 中导出并注册
4. 在 \`Tool.ts\` 中定义权限规则

## 修改 API 通信

- \`src/services/api/claude.ts\` - Claude API 封装
- \`src/services/api/client.ts\` - HTTP 客户端封装
- \`src/services/api/openaiCompat.ts\` - OpenAI 兼容层
- \`src/services/api/errors.ts\` - 错误处理

## 上下文管理

- \`src/services/compact/autoCompact.ts\` - 自动压缩逻辑
- \`src/services/compact/compact.ts\` - 压缩实现
- \`src/utils/truncateRecovery.ts\` - 截断恢复
- \`src/services/contextCollapse/\` - 上下文折叠

## 数据目录

- `.doge/api.json` - API 配置
- `.doge/sessions/` - 会话历史
- `.doge/plugins/` - 插件配置
- `~/.doge/` - 用户级全局配置

## 注意事项

- 此项目**不是**官方 Claude Code，而是深度修改的 Fork
- 大部分脚本假设 Windows 环境
- 首次运行时若遇到 "process.stdin 不支持原始模式"，请确保在真实终端中运行
- 项目使用 Bun 作为主要运行时，确保已安装 Bun >= 1.3.5

