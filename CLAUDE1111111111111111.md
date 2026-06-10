# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

# 常用命令

## 开发与构建

```bash
# 安装依赖
bun install

# 启动开发服务器（TUI/CLI）
bun run dev

# 启动生产版本
bun run start

# 输出版本信息
bun run version

# 编译为可执行程序
complie.bat

# 使用预编译的 exe 启动
d.bat

# 安装为全局命令
bun link

# 使用全局命令
# doge
```

## 测试

```bash
# 运行测试（如存在测试文件）
bun test

# 运行单个测试文件
bun test test_truncate.ts
bun test test_truncate_unit.js

# 运行集成测试
bun test test_truncate_integration.js
```

## 代码检查

```bash
# TypeScript 编译检查（如果 tsconfig.json 存在）
bun tsc --noEmit

# 格式化（如配置了 prettier）
bun format

# 运行 lint（如配置了 eslint）
bun lint
```

## Git 工作流

```bash
# 检查状态
git status

# 查看差异
git diff

# 提交更改
git commit -m "描述性提交消息"

# 推送到远程
git push

# 拉取更新
git pull

# 创建并提交 PR
git pull --rebase origin/main
```

# 项目架构概览

Doge Code 是一个基于 Claude Code 的 Fork 和魔改版本，主要特点包括：

- 支持自定义 Anthropic 兼容接口地址
- 多入口的 OpenAI Chat Completions ↔ Anthropic Messages 转接能力
- 自定义 API Key 和模型管理
- 本地数据记录到 `./.doge` 路径体系
- CLI/TUI 主体结构，无视登录流绑定

## 核心文件结构

```
src/
├── bootstrap/          # 引导入口和初始化逻辑
├── bootstrap-entry.ts  # 应用启动入口
├── cli/                # CLI 相关逻辑
├── commands/           # 所有斜杠命令（/login, /clear, /model 等）
│   └── <command-name>/  # 每个命令独立目录
├── components/         # React/Ink UI 组件
├── context/            # 上下文管理
├── coordinator/        # 协调器逻辑
├── core.ts             # 核心运行时
├── cost-tracker.ts     # Token 成本跟踪
├── dialogLaunchers.tsx # 对话框启动器
├── entrypoints/        # 入口点（cli, tui 等）
├── history.ts          # 会话历史记录管理
├── hooks/              # React/Ink 钩子
├── ink/                # Ink UI 渲染相关
├── main.tsx            # 主应用渲染
├── memdir/             # 内存目录管理
├── migrations/         # 数据迁移逻辑
├── plugins/            # 插件系统
├── proactive/          # 主动功能（KAIROS 等）
├── query.ts            # 查询引擎（核心查询逻辑）
├── QueryEngine.ts      # 查询引擎实现
├── setup.ts            # 应用设置
├── state/              # 全局状态管理
├── services/           # 外部服务（API, MCP, 数据库等）
│   └── api/            # API 客户端封装
├── skills/             # 技能加载和管理
├── tools/              # 工具实现
├── types/              # TypeScript 类型定义
├── utils/              # 工具函数
├── vendor/             # 第三方依赖
└── vendor.shims/       # 垫片/兼容层
```

## 关键模块说明

### 1. 命令系统（src/commands/）

所有斜杠命令都位于 `src/commands/` 目录，每个命令有独立目录：

- `/commands/add-dir/` - 添加目录
- `/commands/clear/` - 清空上下文
- `/commands/config/` - 配置管理
- `/commands/login/` - 登录/切换 API
- `/commands/model/` - 切换模型
- `/commands/compact/` - 压缩会话
- `/commands/context/` - 查看上下文用量
- `/commands/rewind/` - 上下文回滚
- `/commands/rename/` - 重命名会话
- `/commands/plugins/` - 插件管理
- `/commands/skills/` - 技能管理
- `/commands/agents/` - 代理管理
- `/commands/teleport/` - 传输会话

查看 `src/commands.ts` 了解所有可用命令的完整列表。

### 2. 查询引擎（src/query.ts, src/QueryEngine.ts）

处理用户输入的解析和路由：

- 识别 `/` 命令
- 识别模型提示
- 识别代码操作
- 路由到相应工具

### 3. 上下文管理（src/history.ts, src/state/）

- 会话历史记录存储（sqlite/duckdb）
- 上下文窗口大小控制
- 自动截断/压缩逻辑

### 4. 成本跟踪（src/cost-tracker.ts, src/costHook.ts）

- 实时 Token 消耗监控
- 成本计算
- 预算警告

### 5. 插件系统（src/plugins/）

- 插件加载和发现
- 内置插件管理
- 插件技能注册

### 6. 技能系统（src/skills/）

- 技能定义和验证
- 技能加载（从磁盘）
- 技能索引构建

### 7. 工具系统（src/tools/）

- 工具定义和执行
- 工具调用处理
- 工具输出格式化

## 配置说明

### 环境变量（.env）

```env
# 上下文截断控制
CLAUDE_TRUNCATE_WARN_THRESHOLD=25000
CLAUDE_TRUNCATE_COMPACT_THRESHOLD=30000
CLAUDE_TRUNCATE_ERROR_THRESHOLD=35000
CLAUDE_TRUNCATE_MAX_HISTORY_MESSAGES=300
CLAUDE_KEEP_LAST_MESSAGES=15

# API 配置（可选）
ANTHROPIC_BASE_URL=http://your-api.com
DOGE_API_KEY=your-api-key

# 日志级别
LOG_LEVEL=info
```

### 配置文件（./.doge）

- `api.json` - API 配置（baseURL, apiKey, 模型等）
- `settings.json` - 用户设置

## 开发工作流

1. **首次安装**
   ```bash
   git clone <repo-url>
   cd doge-code
   bun install
   bun link
   bun run dev
   ```

2. **日常更新**
   ```bash
   git pull
   bun install
   bun link
   bun run dev
   ```

3. **添加新命令**
   - 在 `src/commands/` 创建新目录
   - 实现命令逻辑
   - 在 `src/commands.ts` 中导入并注册

4. **调试**
   - 启动 `bun run dev`
   - 查看控制台日志
   - 使用 `LOG_LEVEL=debug` 启用详细日志

## 注意事项

- 默认配置使用 `bun` 作为运行时，需要 Bun 1.3.5+
- 支持 Node.js 24+
- 部分功能依赖远程 API（Anthropic, OpenAI 等）
- 本地数据存储在 `./.doge` 目录，避免与原版 Claude Code 配置混用

## 快速命令参考

| 命令 | 说明 |
|------|------|
| `/login` | 切换 API 端点和密钥 |
| `/clear` | 清空上下文 |
| `/model` | 切换模型 |
| `/compact` | 压缩会话 |
| `/config` | 查看配置 |
| `/plugins` | 插件管理 |
| `/skills` | 技能管理 |
| `/agents` | 代理管理 |
| `/rewind` | 上下文回滚 |
| `/cost` | 查看 Token 成本 |
| `/help` | 显示帮助 |
| `/exit` | 退出 |

# 授权

本仓库是 Claude Code 的 Fork，包含恢复期代码与后续魔改。不代表官方立场。
