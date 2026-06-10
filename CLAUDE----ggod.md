# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 常用命令

### 开发和构建

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 编译为可执行文件（Windows）
bun run complie

# 输出版本号
bun run version

# 运行单个命令
bun run dev -- <command>  # 例如：bun run dev -- login
```

### 代码检查

```bash
# 类型检查
bun run tsc

# 格式化
bun run format

# 运行 lint
bun run lint
```

### 运行测试

```bash
# 运行所有测试
bun run test

# 运行单个测试文件
bun run test test_truncate.ts

# 运行单个测试用例
bun run test --grep "<pattern>"

# 运行测试并显示覆盖率
bun run test --coverage
```

### 调试

```bash
# 启用详细日志
LOG_LEVEL=debug bun run dev

# 查看命令列表
bun run dev -- help

# 查看命令详情
bun run dev -- <command> --help
```

## 代码架构

### 核心组件

```
src/
├── bootstrap-entry.ts          # 入口点：加载 .env，设置 API 配置
├── bootstrap-entry.ts          # CLI/TUI 主入口
├── main.tsx                    # React Ink UI 主应用
├── commands.ts                 # 所有命令的注册表
├── core.ts                     # 核心引擎：任务调度、上下文管理
├── Tool.ts                     # 工具基类和接口
├── Task.ts                     # 任务类：管理 LLM 交互
├── query.ts                    # 上下文查询引擎
├── QueryEngine.ts              # 查询执行引擎
├── context.ts                  # 上下文状态管理
├── cost-tracker.ts             # Token 成本跟踪
├── history.ts                  # 会话历史记录管理
├── features.ts                 # 功能特性开关（GrowthBook）
├── plugins/builtinPlugins.ts   # 内置插件注册
├── skills/bundledSkills.ts     # 捆绑技能注册
├── tools/                     # 工具目录（80+ 个工具）
├── commands/                  # 命令目录（200+ 命令）
├── services/                   # 服务层（API、MCP、OAuth 等）
├── types/                     # 类型定义
└── utils/                     # 工具函数
```

### 命令系统

- **位置**: `src/commands/`
- **格式**: 每个命令是一个 ES 模块，导出默认命令对象
- **类型**: `Command` 接口，包含 `type`, `name`, `description`, `isEnabled`, `load`, `aliases` 等字段
- **加载**: 在启动时通过 `commands.ts` 批量导入并注册
- **分类**: `builtin` (内置), `plugin` (插件), `skills` (技能), `mcp` (MCP), `bundled` (捆绑)

### 工具系统

- **位置**: `src/tools/`
- **数量**: 80+ 个工具，覆盖文件操作、系统调用、MCP、计划模式等
- **架构**: 每个工具是独立的 ES 模块，包含 `definition`, `createTool`, `execute` 等
- **注册**: 通过 `tools.ts` 批量导入并注册到核心引擎

### 插件系统

- **位置**: `src/plugins/`
- **类型**: `BuiltinPluginDefinition`
- **功能**: 提供技能、钩子、MCP 服务器的组合
- **启用**: 通过 `/plugin` 命令在 UI 中管理

### 技能系统

- **位置**: `src/skills/`
- **类型**: `BundledSkillDefinition`
- **功能**: 为模型提供专用能力的提示
- **注册**: 通过 `bundledSkills.ts` 批量注册

### 服务层

- **位置**: `src/services/`
- **API**: `api/` - Anthropic/OpenAI 兼容 API 客户端
- **MCP**: `mcp/` - Model Context Protocol 服务器管理
- **OAuth**: `oauth/` - 认证和令牌管理
- **SessionMemory**: `SessionMemory/` - 会话持久化
- **Analytics**: `analytics/` - 遥测和监控

### 上下文截断

- **机制**: 基于 token 计数的自动精简
- **阈值**: 警告 (3000), 精简 (3500), 错误 (4000)
- **配置**: `.env` 中的 `CLAUDE_TRUNCATE_*` 变量
- **策略**: 保留最近 N 条消息，系统提示优先保留

### 配置系统

- **全局配置**: `~/.doge/.claude.json` (通过 `config.ts` 管理)
- **项目配置**: `.doge/api.json` (项目级设置)
- **环境变量**: `.env` (覆盖全局配置)
- **配置字段**: `GLOBAL_CONFIG_KEYS` 白名单验证

### 状态管理

- **全局配置**: `getGlobalConfig()` / `saveGlobalConfig()`
- **项目配置**: `getCurrentProjectConfig()` / `saveCurrentProjectConfig()`
- **信任对话框**: 通过 `checkHasTrustDialogAccepted()` 管理
- **缓存**: 使用 `lodash-es/memoize` 优化读取

## 重要说明

### Git 忽略

以下文件**不应**提交到仓库：

- `.doge/` - 用户配置和 API 密钥
- `.claude/` - Claude Code 全局配置
- `api_keys.json` - API 密钥
- `.env` - 环境变量
- `bun.lock`, `package-lock.json` - 依赖锁文件
- `debug*.txt` - 调试日志

### 环境变量

常见环境变量：

```bash
# API 配置
ANTHROPIC_BASE_URL=https://api.anthropic.com
DOGE_API_KEY=your-api-key

# 上下文截断
CLAUDE_TRUNCATE_WARN_THRESHOLD=25000
CLAUDE_TRUNCATE_COMPACT_THRESHOLD=30000
CLAUDE_TRUNCATE_ERROR_THRESHOLD=35000

# 调试
LOG_LEVEL=debug
DISABLE_AUTOUPDATER=true
```

### 开发工作流

1. **拉取更新**:
   ```bash
   git pull
   bun install
   bun link
   ```

2. **添加功能**:
   - 创建新命令：`src/commands/<name>/`
   - 创建新工具：`src/tools/<name>/`
   - 创建新技能：`src/skills/bundled/<name>/`

3. **测试**:
   - 运行单元测试
   - 手动测试新命令：`bun run dev -- <command>`

4. **提交**:
   - 遵循 `.gitignore`
   - 不提交敏感信息

### 特殊说明

- **Doge Code** 是 Claude Code 的 Fork，包含中文本地化和定制功能
- **API 密钥** 应保存在 `.doge/api.json` 而非硬编码
- **上下文截断** 是 Doge Code 的核心功能，防止 token 溢出
- **远程桥接** 通过 `/bridge` 和 `--remote` 模式支持移动端/Web 客户端
- **计划模式** 通过 `/plan` 进入，提供任务拆解和验证
- **成本跟踪** 通过 `/cost` 查看 Token 消耗和美元成本