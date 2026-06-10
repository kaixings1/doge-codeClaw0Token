# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 常用命令

### 开发

```bash
# 安装依赖
bun install

# 启动开发模式
bun run dev

# 启动生产模式
bun run start

# 查看版本信息
bun run version
```

### 测试

```bash
# 运行所有测试
bun test

# 运行单个测试文件
bun test test_truncate.ts

# 运行特定测试函数
bun test test_truncate.ts -t "截断测试"

# 运行单个测试用例
bun test src/services/compact/autoCompact.ts -t "should compress long context"

# 仅运行失败的测试
bun test --filter "should handle empty"
```

### 代码检查

```bash
# TypeScript 类型检查
bunx tsc --noEmit

# 格式化代码
bunx biome format .

# 运行 linter（修复问题）
bunx biome lint . --write

# 同时格式化和 lint
bunx biome check . --write
```

## 高层代码架构

### 项目结构

```
src/
├── bootstrap/          # 启动和初始化逻辑
│   ├── bootstrap-entry.ts      # 主入口点
│   └── bootstrapMacro.ts       # 引导宏
├── commands/           # 所有斜杠命令（/clear, /login 等）
│   ├── clear/         # /clear 命令
│   ├── login/         # /login 命令
│   └── ...            # 数百个命令目录
├── services/           # 核心服务
│   ├── api/           # API 客户端和兼容层
│   ├── compact/       # 上下文压缩/截断
│   └── ...            # 其他服务
├── skills/             # 技能系统（模型可调用的功能）
│   ├── bundledSkills.js          # 内置技能
│   └── loadSkillsDir.js          # 技能目录加载
├── tools/              # 工具定义（Bash, Edit, Read 等）
├── types/              # TypeScript 类型定义
├── screens/            # TUI 屏幕组件
└── ...                # 其他核心模块

.doge/                  # 项目级配置（不应与 ~/.doge 混淆）
├── api.json           # 当前活跃的 API 配置预设
└── ...                # 其他项目级数据

.claude/                # 用户全局配置（会话、插件、设置等）
```

### 核心模块职责

#### 1. 命令系统 (`src/commands.ts`) - 核心枢纽

**关键理解点**: 这是整个应用的大脑，负责命令的生命周期管理。

- **入口**: 集中导入所有内置命令
- **过滤**: 根据认证状态（`/login`）、功能开关过滤命令
- **加载**: 懒加载技能、插件、工作流命令（使用 `memoize()` 缓存）
- **导出**: `getCommands()` 返回当前可用命令列表
- **可用性检查**: `meetsAvailabilityRequirement()` 处理认证要求
- **动态技能**: 支持从技能目录、插件、工作流动态加载
- **远程安全**: `REMOTE_SAFE_COMMANDS` 定义在远程模式下可执行的命令
- **桥接安全**: `BRIDGE_SAFE_COMMANDS` 定义可通过移动端/Web 执行的命令

**阅读顺序**: 先阅读 `src/commands.ts` 理解命令如何被注册、过滤和加载。

#### 2. 启动流程 (`src/bootstrap-entry.ts`) - 应用初始化

**关键理解点**: 应用启动时的一系列初始化步骤。

- **环境加载**: 读取 `.env` 文件设置环境变量
- **配置加载**: 从 `.doge/api.json` 加载 API 配置预设
- **日志级别**: 支持 `LOG_LEVEL` 环境变量控制日志
- **入口**: 最终调用 `src/entrypoints/cli.tsx`

**阅读顺序**: 先阅读 `src/bootstrap-entry.ts` 了解应用如何启动和初始化。

#### 3. API 服务 (`src/services/api/`) - 模型交互层

**关键理解点**: 这是与应用外部大模型通信的核心接口层。

- **主要客户端**: `client.ts` - 主要 API 交互，处理请求/响应
- **兼容层**: `openaiCompat.ts` - OpenAI Chat Completions ↔ Anthropic Messages 转接（关键！这是项目特色）
- **Anthropic SDK**: `claude.ts` - 直接使用 Anthropic 官方 SDK
- **错误处理**: 统一错误包装和日志记录

**阅读顺序**: 
1. 先阅读 `src/services/api/client.ts` 了解基础 API 交互
2. 再阅读 `src/services/api/openaiCompat.ts` 理解转接层逻辑

#### 4. 上下文管理 (`src/services/compact/`) - 上下文压缩

**关键理解点**: 管理对话上下文长度，防止超出模型上下文窗口。

- **截断**: `autoCompact.ts` - 自动压缩过长的上下文
- **阈值**: `CLAUDE_TRUNCATE_COMPACT_THRESHOLD` 环境变量控制截断点
- **恢复**: 支持从截断点恢复会话状态

**阅读顺序**: 阅读 `src/services/compact/autoCompact.ts` 理解上下文如何被压缩。

#### 5. 技能系统 (`src/skills/`) - 可执行动作

**关键理解点**: 模型可以调用的功能集合，包括内置命令、自定义技能和插件。

- **内置技能**: `bundledSkills.js` - 预定义技能（如 `/clear`, `/rename`）
- **技能目录**: `/skills/` 目录下的 YAML 技能文件
- **插件技能**: 从已启用插件加载的技能
- **工作流技能**: 从 GitHub 工作流定义生成的技能

**阅读顺序**: 阅读 `src/skills/bundledSkills.js` 了解技能如何被注册和执行。

#### 6. TUI 渲染 (`src/screens/`) - 用户界面

**关键理解点**: 使用 Ink 库构建的可复用 TUI 组件。

- **状态栏**: `statusline.tsx` - 显示会话状态、成本、模型信息
- **主屏幕**: 渲染对话历史、工具调用、模型响应
- **组件**: Ink 库构建的多个可复用组件

**阅读顺序**: 阅读 `src/screens/statusline.tsx` 了解状态信息如何显示。

#### 7. 工具定义 (`src/tools/`) - 可用的工具

**关键理解点**: 模型可以调用的外部工具（如 Bash、Edit、Read 等）。

**阅读顺序**: 阅读 `src/tools` 目录下的文件，了解工具如何被定义和调用。

### 数据流与执行流程

#### 命令执行流程

```
用户输入 "/clear"
    ↓
src/commands.ts: getCommands() 获取命令列表
    ↓
findCommand() / getCommand() 查找命令
    ↓
command.contentLength 检查（用于模型理解）
    ↓
command.type 分支:
  - 'local': 直接执行本地逻辑（如清空上下文）
  - 'prompt': 将提示词发送给模型
  - 'local-jsx': 渲染 Ink 组件（如状态栏更新）
```

#### 模型响应处理流程

```
模型响应
    ↓
src/services/api/client.ts: 解析响应
    ↓
src/services/context.ts: 更新会话上下文
    ↓
src/screens/: 渲染新的 UI 帧
    ↓
状态栏：显示 token 成本
```

### 调试技巧

- **启用详细日志**: `export LOG_LEVEL=debug` 或 `bun run dev -- --log-level debug`
- **查看命令是否注册**: `bun run dev --help`
- **检查技能加载**: `bun run dev --debug`
- **跟踪执行流程**: 在关键函数中添加 `console.log()`
- **查看命令详情**: 在 `src/commands.ts` 中使用 `console.log(getCommands())`

### 配置管理

- **项目级**: `.doge/api.json` - 当前会话的 API 配置
- **全局用户**: `.claude/` - 会话、插件、全局设置
- **环境变量**: `.env` - 启动时加载（如 `CLAUDE_TRUNCATE_COMPACT_THRESHOLD`）

## 开发指南

### 添加新命令

1. 在 `src/commands/` 创建目录（如 `new-feature/`）
2. 创建 `index.js` 导出命令对象
3. 在 `src/commands.ts` 导入并添加到 `COMMANDS` 数组
4. 确保命令有:
   - `name`: 命令名称
   - `description`: 用户可见描述
   - `type`: 'local' | 'prompt' | 'local-jsx'
   - `contentLength`: 提示词长度（用于模型理解）

### 添加新技能

1. 在 `src/skills/` 创建技能文件（YAML 格式）
2. 或修改 `bundledSkills.js` 添加新技能
3. 技能应包含:
   - `name`: 技能名称
   - `description`: 技能描述
   - `execute`: 执行逻辑

### 添加新工具

1. 在 `src/tools/` 创建工具定义文件
2. 在 `src/commands.ts` 或 `bundledSkills.js` 注册工具
3. 工具应包含:
   - `name`: 工具名称
   - `description`: 工具描述
   - `parameters`: 工具参数定义
   - `execute`: 工具执行逻辑

### 调试技巧

- **查看命令注册状态**: 在 `src/commands.ts` 中添加 `console.log(getCommands())`
- **跟踪模型响应**: 在 `src/services/api/client.ts` 中添加响应日志
- **检查上下文状态**: 使用 `/context` 命令或查看 `src/services/context.ts`
- **使用 Ink 调试**: 在 JSX 组件中添加 `console.log()` 查看渲染内容

### 配置管理

- **项目级**: `.doge/api.json` - 当前会话的 API 配置
- **全局用户**: `.claude/` - 会话、插件、全局设置
- **环境变量**: `.env` - 启动时加载（如 `CLAUDE_TRUNCATE_COMPACT_THRESHOLD`）

## 重要注意事项

- **不要**修改 `.doge/` 目录的内容，这是项目级数据
- **不要**将 `.doge/` 内容提交到 Git（已配置在 `.gitignore`）
- **不要**与原版 Claude Code 共用 `.claude/` 目录
- **编译**: 运行 `complie.bat` 或手动编译为 exe（见 `install.bat`, `complie.bat`）
- **启动**: 使用 `d.bat`（包含环境变量设置）或直接 `bun run dev`
- **OpenAI 兼容接口**: `src/services/api/openaiCompat.ts` 提供了 OpenAI Chat Completions ↔ Anthropic Messages 转接能力，这是项目的重要特色
- **上下文截断**: 当上下文过长时，`src/services/compact/autoCompact.ts` 会自动截断，可以通过 `CLAUDE_TRUNCATE_COMPACT_THRESHOLD` 环境变量控制截断阈值
- **技能动态加载**: 技能可以从 `src/skills/` 目录、插件和工作流动态加载，阅读 `src/skills/loadSkillsDir.js` 了解加载机制
