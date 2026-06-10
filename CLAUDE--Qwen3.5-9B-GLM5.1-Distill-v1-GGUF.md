# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 常用命令

### 构建与运行

```bash
# 安装依赖（使用 Bun）
bun install

# 启动开发模式
bun run dev

# 启动生产模式
bun run start

# 输出版本信息
bun run version
```

### 测试运行

```bash
# 运行所有测试
bun run test

# 运行单个测试文件（如存在）
bun test src/path/to/test-file.ts

# 运行单元测试
bun test --filter "单元测试名称"
```

### 代码检查

```bash
# TypeScript 类型检查
bunx tsc --noEmit

# 格式化代码（如已配置）
bunx prettier --check .
```

### 编译为可执行文件

```bash
# 编译为 exe（Windows）
complie.bat

# 或使用常规构建命令
bun run build
```

## 高层架构

### 核心模块结构

本仓库基于 Claude Code 源码重构，采用模块化设计，主要模块如下：

**1. 命令系统 (`src/commands/`)**
- 每个命令独立封装在对应目录中
- 通过 `src/commands.ts` 统一注册和导出
- 支持动态技能加载和插件扩展
- 命令分类：CLI 命令、技能（skills）、插件（plugins）、工作流

**2. API 服务层 (`src/services/api/`)**
- `claude.ts`：Anthropic Messages API 核心客户端
- `client.ts`：通用 HTTP 客户端封装
- `openaiCompat.ts`：OpenAI Chat Completions ↔ Anthropic Messages 协议转接层
- 支持自定义 baseURL 和 API 密钥配置

**3. 核心引擎 (`src/` 根目录文件)**
- `core.ts`：核心业务逻辑封装
- `Tool.ts` / `tools.ts`：工具调用系统
- `Task.ts`：任务执行抽象
- `QueryEngine.ts`：查询引擎
- `commands.ts`：命令注册中心

**4. 上下文与状态管理**
- `src/state/`：应用状态存储
- `src/context.ts`：运行时上下文
- `src/history.ts`：会话历史记录

**5. UI 渲染层**
- `src/main.tsx`：主入口，Ink UI 渲染
- `src/ink/`：Ink 自定义组件
- `src/components/`：UI 组件库

### 命令生命周期

```mermaid
graph LR
    A[命令定义] --> B[commands.ts 注册]
    B --> C[getCommands() 加载]
    C --> D{可用性检查}
    D -->|通过 | E[添加到 COMMANDS]
    D -->|不通过 | F[过滤掉]
```

### API 请求流程

```mermaid
graph LR
    A[用户命令] --> B[commands.ts]
    B --> C[核心引擎]
    C --> D[API 服务层]
    D --> E[claude.ts / openaiCompat.ts]
    E --> F[HTTP 请求]
```

### 配置体系

- 用户配置：`~/.doge/` 目录
- 运行时配置：`.doge/api.json`（预设切换）
- 环境变量：`.env` 文件支持
- 预设管理：`src/bootstrap-entry.ts` 中加载

### 开发工作流

```bash
# 1. 克隆仓库
git clone <repo-url>
cd doge-code

# 2. 安装依赖
bun install

# 3. 全局链接（可选）
bun link

# 4. 启动开发
bun run dev

# 5. 开发时修改文件后热重载自动生效
```

### 命令注册机制

所有命令在 `src/commands.ts` 中集中导出，通过 `memoize` 优化加载性能：
- 内置命令：`COMMANDS()` 数组
- 动态技能：`getSkillDirCommands()` 动态加载
- 插件命令：`getPluginCommands()` 插件系统
- 工作流：`getWorkflowCommands()` 工作流脚本

### 远程模式

```bash
# 启动远程模式（仅本地安全的命令）
bun run dev --remote
```

远程模式预过滤命令集：`REMOTE_SAFE_COMMANDS` 和 `BRIDGE_SAFE_COMMANDS`

### 状态栏与 Token 监控

- Token 进出严密监控
- 状态栏实时显示
- 计费相关：`src/cost-tracker.ts`

### 插件系统

- 内置插件：`src/plugins/builtinPlugins.js`
- 插件命令：`src/utils/plugins/loadPluginCommands.js`
- 插件技能：`src/utils/plugins/loadPluginSkills.js`

### 技能系统

- 技能目录：`src/skills/`
- 内置技能：`src/skills/bundledSkills.js`
- 动态技能：`src/skills/loadSkillsDir.js`

### 工具调用系统

- 工具定义：`src/Tool.ts`
- 工具集合：`src/tools.ts`
- 工作流工具：`src/tools/WorkflowTool/`

### 模型管理

- 模型列表：`src/commands/model/`
- 模型切换：`src/commands/add-model/` 和 `remove-model/`

### 会话管理

- 会话列表：`src/commands/session/`
- 会话压缩：`src/commands/compact/`
- 上下文回滚：`src/commands/rewind/`
- 会话恢复：`src/commands/resume/`

### 环境入口

```bash
src/
├── bootstrap-entry.ts     # 主入口，加载 .env 和 api.json
├── dev-entry.ts           # 开发检查入口
├── main.tsx              # UI 渲染入口
├── commands.ts           # 命令注册中心
├── core.ts               # 核心业务逻辑
├── Tool.ts               # 工具基类
└── Task.ts               # 任务抽象
```

### 命令目录示例

```bash
src/commands/
├── clear/                # 清屏命令
├── compact/              # 压缩上下文命令
├── cost/                 # 查看成本命令
├── context/              # 上下文用量命令
├── rename/               # 会话重命名命令
├── model/                # 模型切换命令
├── skills/               # 技能管理命令
└── ...
```

### 服务层架构

```bash
src/services/api/
├── claude.ts            # Anthropic API 客户端
├── client.ts            # 通用 HTTP 客户端
├── openaiCompat.ts      # OpenAI 协议转接
└── ...
```

### 工具链集成

- TypeScript 6.0+
- Bun 1.3.5+
- Ink UI
- Lodash-es
- Zod 验证

### 关键文件说明

| 文件 | 作用 |
|------|------|
| `src/bootstrap-entry.ts` | 主入口，加载环境变量和 API 配置 |
| `src/commands.ts` | 命令注册和导出中心 |
| `src/core.ts` | 核心业务逻辑 |
| `src/Tool.ts` | 工具调用基类 |
| `src/commands.ts` | 命令列表管理 |

### 性能优化

- 命令加载使用 `lodash-es/memoize` 缓存
- API 请求支持重试机制 `src/services/api/withRetry.ts`
- 上下文压缩减少 token 消耗 `src/services/compact/autoCompact.ts`

### 错误处理

- 统一错误类型：`src/services/api/errors.ts`
- 错误包装：`src/services/api/errorUtils.ts`
- 日志系统：`src/services/api/logging.ts`

### 热重载

开发模式下修改文件后自动热重载，无需重启：
- Ink UI 支持热更新
- 命令系统动态刷新
- API 客户端自动重新连接
