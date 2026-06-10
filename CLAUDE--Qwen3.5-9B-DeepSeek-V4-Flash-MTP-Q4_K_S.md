# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 🚀 快速命令速查

### 环境配置
```bash
export LOG_LEVEL=silent        # 静默模式，最小日志输出
export LOG_LEVEL=error          # 仅错误日志
export LOG_LEVEL=info           # 默认信息日志
export LOG_LEVEL=debug          # 详细调试日志
```

### 开发启动
```bash
bun run dev                    # 启动开发环境
bun run dev --quiet            # 静默启动，减少输出
bun run version                # 查看版本信息
```

### 常用命令
```bash
bun run dev -- /clear          # 清空上下文
bun run dev -- /skills         # 管理技能
bun run dev -- /agents         # 管理代理
bun run dev -- /compact        # 压缩会话内容
bun run dev -- /rename <name>   # 命名当前会话
bun run dev -- /cost           # 查看 token 用量
```

### 日志级别控制
```bash
# 静默模式 - 仅必要输出
export LOG_LEVEL=silent
doge

# 错误模式 - 仅错误信息
export LOG_LEVEL=error
doge

# 默认模式
export LOG_LEVEL=info
doge
```

## 📊 输出控制

### 减少终端输出
1. **环境变量方式**：设置 `LOG_LEVEL=silent`
2. **启动参数**：`bun run dev --quiet`
3. **会话级别**：使用 `/compact` 压缩对话历史
4. **手动清理**：`/clear` 清空上下文（同时重置输出缓冲区）

### 构建与发布
```bash
bun install                    # 安装依赖
bun link                       # 链接为全局命令
bun run build                  # 编译为 npm 包
```

## 🏗️ 架构总览

### 应用类型
基于 **ink** 框架构建的 **TUI (终端用户界面)** + **CLI 命令系统** + **多模态工具执行**。

### 核心文件
| 文件 | 职责 |
|------|------|
| `src/bootstrap-entry.ts` | 应用启动入口，加载环境变量、配置、插件 |
| `src/main.tsx` | Ink 组件树根节点，渲染 TUI 界面 |
| `src/core.ts` | 核心编排逻辑，任务调度、上下文流转、多轮对话管理 |
| `src/commands.ts` | 命令系统注册中心，所有 CLI 命令统一入口 |
| `src/context.ts` | 全局 Context，单点注册工具/技能，管理会话状态 |
| `src/query.ts` | 查询引擎，路由到合适的工具/技能/代理 |
| `src/tools.ts` | 工具系统，文件操作/终端执行/代码解释器/浏览器 |
| `src/Tool.ts` | 工具基类接口定义 |
| `src/history.ts` | 会话历史持久化 |
| `src/cost-tracker.ts` | Token 用量跟踪 |

### 关键架构模式

#### 1️⃣ 命令系统 (`src/commands/`) - 类似 `git` 的子命令模式
- **模式**：命令文件 + TypeScript 类继承注册机制
- **执行流程**：
  ```
  CLI 输入 → 命令解析 → Command 实例创建 → 上下文处理 → 结果输出
  ```
- **典型命令**：`/clear`, `/compact`, `/skills`, `/agents`, `/context`, `/rename`
- **注册方式**：所有命令在 `src/commands.ts` 中通过 `registerCommand()` 统一注册

#### 2️⃣ 工具系统 (`src/tools/`) - 继承式工具基类
- **设计**：继承 `Tool` 基类实现 `execute()` 方法
- **工具类型**：
  - 文件操作：`FileReadTool`, `FileWriteTool`, `FileEditTool`
  - 终端执行：`BashTool`
  - 代码解释：`CodeInterpreter`
  - 浏览器交互：`BrowserTool`
  - Git 操作：`BranchTool`
  - 数据库：`DatabaseTool`
- **调用流程**：
  ```
  Context 初始化 → 工具注册 → QueryEngine 路由决策 → Tool 执行 → 结果写入 Context
  ```

#### 3️⃣ 查询引擎 (`src/query.ts`) - 智能路由决策
- **职责**：根据对话历史、上下文、工具状态决定下一步行动
- **决策依据**：
  - 用户意图识别
  - 可用工具列表
  - 技能与代理注册表
  - 会话状态
- **输出**：
  - 工具调用请求
  - 技能执行请求
  - 代理调用请求
  - 纯文本回复

#### 4️⃣ 上下文管理 (`src/context.ts`) - 单点注册中心
- **核心数据结构**：
  ```typescript
  Context = {
    sessionId: string,
    conversation: Message[],
    tools: Tool[],
    skills: Skill[],
    agents: Agent[],
    config: Config,
    state: AppState
  }
  ```
- **持久化**：
  - `src/history.ts` - 会话历史
  - `src/cost-tracker.ts` - Token 用量

### 数据流
```
用户输入 → CLI 解析 → 创建 Task → Context 状态更新
    ↓
QueryEngine 路由决策
    ↓
工具/技能/代理执行
    ↓
结果回写 Context
    ↓
Ink 渲染更新
```

## 🔧 开发模式

### 添加新命令
1. 在 `src/commands/<command-name>/` 创建命令目录
2. 创建命令类，继承自 `Command` 基类
3. 在 `src/commands.ts` 中调用 `registerCommand()`
4. 在 `src/commands/rename/generateSessionName.ts` 等文件中定义命令逻辑

### 添加新工具
1. 在 `src/tools/<tool-name>/` 创建工具目录
2. 创建工具类，继承 `Tool` 基类
3. 实现 `execute()` 方法
4. 在 `src/context.ts` 中初始化时注册

### 添加新技能/代理
- **技能**：在 `src/skills/` 创建技能定义
- **代理**：在 `src/commands/agents/` 创建代理逻辑
- **插件**：在 `src/plugins/` 注册插件

### 调试技巧
```bash
# 查看可用命令
bun run dev -- /help

# 查看会话状态
bun run dev -- /context

# 查看工具列表
bun run dev -- /tools

# 查看 token 用量
bun run dev -- /cost

# 检查命令注册
bun run dev -- /commands
```

## 📁 重要目录

| 目录 | 说明 |
|------|------|
| `src/commands/` | 所有 CLI 命令实现 |
| `src/tools/` | 所有工具实现 |
| `src/skills/` | 技能定义 |
| `src/agents/` | 代理定义 |
| `src/plugins/` | 插件注册 |
| `src/services/api/` | API 客户端实现 (Anthropic/OpenAI 兼容) |
| `src/services/mcp/` | MCP 服务器实现 |

## ⚙️ 环境配置

### 配置文件
- **主配置**：`.doge/api.json` - API 预设、密钥、模型列表
- **环境变量**：`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` 等
- **默认 API**：`http://0.0.0.0:1` (本地模式，需配置 `.doge/api.json`)

### 多 API 支持
- **Anthropic** - 原生 Claude API
- **OpenAI** - OpenAI Chat Completions API
- **自定义** - 支持任意 baseURL + apiKey 的 OpenAI 兼容接口
- **代理** - 支持本地代理转发

### Token 监控
- 状态栏实时显示 token 用量
- 会话级别统计
- 持久化到 `.doge/api.json`

## 📦 构建与发布

### 编译命令
```bash
bun run build              # 编译为 npm 包 (dist/)
bun run build:exe          # 打包为 Windows exe
```

### npm 发布
- 工作流：`.github/workflows/publish-npm.yml`
- 打包脚本：`scripts/release/prepare-release-package.mjs`
- 启动包装器：`scripts/release/bin/claudex.js`

### 版本信息
```bash
bun run version            # 查看版本
```

## 🔄 与原版的关系

- **源码来源**：基于 Claude Code 的还原版源码树
- **Fork 历史**：
  1. 第一层：还原后的官方源码
  2. 第二层：基于还原版继续魔改
  3. 当前：Doge Code 分支
- **主要改动**：
  - 多 API 支持 (Anthropic/OpenAI/自定义)
  - 中文提示词优化
  - Token 监控增强
  - 自定义模型注册
  - 配置隔离 (`.doge/` 替代 `.claude/`)

## ⚠️ 常见问题

**Q: 启动后显示 "DOGE_FAKE_KEY" ？**  
A: 正常，表示未加载 `.doge/api.json`。创建该文件并配置预设即可。  

**Q: 如何切换模型/API？**  
A: 编辑 `.doge/api.json` 的 `presets` 字段，或运行 `bun run dev -- /login`。  

**Q: 命令不生效？**  
A: 检查 `src/commands.ts` 注册是否正确，或运行 `bun run dev -- /help`。  

**Q: 如何查看当前会话？**  
A: 运行 `bun run dev -- /context` 或 `bun run dev -- /info`。  

**Q: 如何重置配置？**  
A: 删除 `.doge/` 目录后重新运行 `bun install` 并创建新的 `api.json`。  

## 📝 开发建议

- 新增命令时参考现有命令的 `execute()` 实现
- 新增工具时确保 `execute()` 返回符合 LLM 预期的格式
- 修改 Context 状态时注意持久化机制
- 使用 `/compact` 清理长对话以节省 token
- 定期检查 `.doge/api.json` 中的 token 用量

## 🔍 关键文件说明

- `src/core.ts` - 核心编排引擎，任务调度与上下文流转
- `src/commands.ts` - 命令注册中心
- `src/context.ts` - 全局上下文，工具/技能/代理注册
- `src/query.ts` - 查询引擎，智能路由决策
- `src/main.tsx` - Ink 组件树根节点
- `src/bootstrap-entry.ts` - 启动时环境变量与配置加载
- `src/cost-tracker.ts` - Token 用量跟踪与持久化
- `src/history.ts` - 会话历史持久化

