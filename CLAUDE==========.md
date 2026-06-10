# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目概述

Doge Code 是 Claude Code 的中文魔改版，具有以下核心特性：

- **多模型支持**：支持 Anthropic、OpenAI 兼容接口、AWS Bedrock、GCP Vertex、Azure Foundry 等多种 API 源
- **灵活的 API 路由**：通过环境变量自由切换不同厂商的模型和服务
- **请求伪装功能**：在重试时修改 User-Agent 和请求体，绕过供应商的重复请求检测
- **自定义端点**：支持本地模型、公司代理、第三方 API 等自定义 API 地址
- **数据隔离**：使用 `~/.doge` 目录而非官方的 `.claude`，避免与原版配置混用

## 常用命令

### 开发命令

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 启动生产版本
bun run start

# 输出当前版本信息
bun run version

# 注册为全局命令
bun link

# 全局命令（注册后）
doge
```

### CLI 命令速查

| 命令 | 功能 |
|------|------|
| `/login` | 切换不同 BaseURL、APIKEY、模型 |
| `/clear` | 清空上下文，相当于退出软件再进入 |
| `/compact` | 压缩会话内容，减少 token 消耗 |
| `/context` | 查看上下文用量 |
| `/model` | 切换当前使用的模型为新模型 |
| `/cost` | 查看计费情况 |
| `/plan` | 进入计划模式（Shift+Tab 两次） |
| `/config` | 查看和修改配置 |
| `/status` | 查看系统状态 |
| `/plugins` | 管理插件 |
| `/skills` | 管理技能 |
| `/agents` | 管理代理 |
| `/rewind` | 上下文回滚到指定轮次 |
| `/resume` | 恢复选定的会话 |
| `/rename` | 命名会话方便记忆 |
| `/export` | 导出会话数据 |
| `/backup` | 备份会话数据 |

## 高层架构

### 目录结构

```
src/
├── assistant/       # Agent 核心逻辑
├── bootstrap/       # 启动和初始化逻辑
├── bridge/          # 远程桥接支持
├── buddy/           # 伙伴系统
├── cli/             # CLI 相关
├── commands/        # 所有 CLI 命令
├── components/      # React/Ink UI 组件
├── coordinator/     # 协调器逻辑
├── context/         # 上下文管理
├── daemon/          # 后台守护进程
├── dev/             # 开发工具
├── entrypoints/     # 入口点
├── environment-runner/  # 环境执行器
├── hooks/           # React Hooks
├── ink/             # Ink 相关组件
├── jobs/            # 后台作业
├── keybindings/     # 快捷键
├── memdir/          # 内存目录
├── migrations/      # 数据迁移
├── moreright/       # 更多权限功能
├── native-ts/       # 原生 TypeScript 扩展
├── outputStyles/    # 输出样式
├── plugins/         # 插件系统
├── proactive/       # 主动功能
├── query/           # 查询引擎
├── remote/          # 远程模式
├── server/          # 服务器逻辑
├── services/        # 核心服务
├── skills/          # 技能系统
├── ssh/             # SSH 功能
├── state/           # 状态管理
├── tasks/           # 任务系统
├── tools/           # 工具定义
├── upstreamproxy/   # 上游代理
├── utils/           # 工具函数
├── vim/             # Vim 模式
└── voice/           # 语音功能
```

### 核心模块说明

#### 1. 服务层 (src/services/)

- **api/** - API 客户端封装和请求路由
  - `client.ts` - 统一的 API 客户端创建，支持多种认证方式
  - `openaiCompat.ts` - OpenAI 兼容接口适配层
  - `claude.ts` - Anthropic 原生 API 封装

- **compact/** - 上下文压缩和 token 管理
  - `autoCompact.ts` - 自动上下文压缩逻辑

- **oauth/** - OAuth 认证处理

#### 2. 命令系统 (src/commands/)

命令通过 `src/commands.ts` 集中注册和导出。命令分为三类：

- **builtin** - 内置命令，来自 `src/commands/`
- **plugin** - 插件命令
- **bundled** - 打包命令

命令通过 `src/types/command.ts` 定义接口，包括：
- `name` - 命令名称
- `description` - 命令描述
- `type` - 命令类型（prompt/local/local-jsx）
- `availability` - 认证要求

#### 3. API 客户端 (src/services/api/)

客户端支持多源 API 路由：

```
┌─────────────────────────────────────────────────┐
│                    API 请求                       │
└──────────────┬──────────────────────────────────┘
               │
        ┌──────▼──────────────┐
        │  getAnthropicClient() │
        └──────┬──────────────┘
               │
    ┌──────────▼──────────┐
    │  认证选择：            │
    │  • OAuth (官方订阅)  │
    │  • API Key           │
    │  • AWS Bedrock       │
    │  • GCP Vertex        │
    │  • Azure Foundry     │
    │  • 自定义端点        │
    └──────┬───────────────┘
           │
    ┌──────▼────────────────┐
    │  请求伪装层（重试时）    │
    │  • User-Agent 变化     │
    │  • Request-ID 变化    │
    │  • Request Body 变化  │
    └──────┬─────────────────┘
           │
    ┌──────▼────────────────┐
    │  实际 API 调用          │
    └────────────────────────┘
```

#### 4. 上下文管理 (src/context/)

- `context.ts` - 上下文状态存储
- `context.ts` - 上下文压缩和清理

#### 5. 技能系统 (src/skills/)

- 技能目录命令加载：`src/skills/loadSkillsDir.js`
- 内置技能获取：`src/skills/bundledSkills.js`

## 环境变量配置

### API 相关

| 环境变量 | 说明 |
|----------|------|
| `ANTHROPIC_BASE_URL` | 自定义 API 地址 |
| `ANTHROPIC_API_KEY` | API 密钥 |
| `ANTHROPIC_AUTH_TOKEN` | OAuth 访问令牌 |
| `CLAUDE_CODE_COMPATIBLE_API_PROVIDER` | 兼容接口提供者（anthropic/openai） |
| `CLAUDE_CODE_CONTAINER_ID` | 远程容器 ID |
| `CLAUDE_CODE_REMOTE_SESSION_ID` | 远程会话 ID |

### 多源 API

| 环境变量 | 说明 |
|----------|------|
| `CLAUDE_CODE_USE_BEDROCK` | 启用 AWS Bedrock |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock Bearer 令牌 |
| `CLAUDE_CODE_USE_FOUNDRY` | 启用 Azure Foundry |
| `CLAUDE_CODE_USE_VERTEX` | 启用 GCP Vertex |
| `CLAUDE_CODE_USE_STAGING_OAUTH` | 使用 staging OAuth |

### 调试相关

| 环境变量 | 说明 |
|----------|------|
| `DEBUG` | 启用调试模式（true/stderr） |
| `API_TIMEOUT_MS` | API 超时时间（毫秒） |

## 开发工作流

### 1. 初始设置

```bash
# 克隆仓库
git clone <repo-url>
cd doge-code

# 安装依赖
bun install

# 注册为全局命令
bun link

# 运行
bun run dev
```

### 2. 运行单个命令

```bash
# 以特定命令启动
bun run dev -- --help

# 查看可用命令
bun run dev
# 然后输入 /help
```

### 3. 调试技巧

```bash
# 启用详细日志
DEBUG=true bun run dev

# 查看特定模块日志
DEBUG=api bun run dev
```

## 数据目录说明

- `~/.doge/` - Doge Code 专用配置目录
- `.doge/` - 项目级配置（在仓库根目录）
- `~/.claude/` - 原版 Claude Code 配置（不应与 Doge Code 混用）

## 注意事项

1. **API 密钥安全**：不要在提交中包含 `.env` 文件或 API 密钥
2. **配置隔离**：Doge Code 使用独立的数据目录，避免与原版冲突
3. **多源 API**：通过环境变量灵活切换不同 API 源，适合本地开发、公司代理等场景
4. **请求伪装**：重试时自动修改请求指纹，绕过供应商检测
