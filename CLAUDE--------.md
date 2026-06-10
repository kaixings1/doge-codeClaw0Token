# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 核心架构

### 启动流程

```
bootstrap-entry.ts    → 环境初始化 + API 配置加载 → 动态入口分发
    ↓
CLI 主循环 (main.tsx)  → 命令路由 → 工具调用 → 分析生成 → 响应流
    ↓
bridge/bridgeMain.ts  → 远程会话管理（如启用）
    ↓
QueryEngine.ts        → 上下文分析与回答生成
```

### 关键目录

| 目录 | 作用 |
|------|------|
| `src/bootstrap-entry.ts` | 启动入口，加载 `.doge/api.json`，分发到 CLI/bridge/daemon 等 |
| `src/main.tsx` | React 主应用，实现 CLI/TUI 循环 |
| `src/commands.ts` | 命令注册表，导出所有 CLI 命令 |
| `src/commands/` | 148+ 个命令实现，独立目录结构 |
| `src/services/api/` | API 客户端（Anthropic SDK + OpenAI 转接层） |
| `src/services/analytics/` | 分析/遥测服务（Datadog + 1P 事件） |
| `src/utils/` | 工具函数（配置、认证、调试、模型） |
| `src/tools/` | 工具定义和实现，供分析使用 |
| `src/constants/` | 常量定义（提示词、模型名称、路径等） |
| `src/bridge/` | Bridge 远程会话管理（多会话、轮询、会话生成） |
| `src/query/` | 上下文分析引擎（QueryEngine） |
| `src/skills/` | 技能目录（Claude 按需调用的功能） |

### 命令系统

- **注册方式**: `src/commands.ts` 通过 `import <cmd> from './commands/<name>'` 注册
- **命令结构**: `src/commands/<cmd>/index.js` 或 `src/commands/<cmd>.js`
- **命令类型**: `type: 'local-jsx'` (交互式 JSX) 或 `type: 'local'` (纯函数)
- **参数**: `{ name, description, load: () => import(...) }`
- **示例**: `/login`、`/plugin`、`/init`

### 工具系统

- **工具定义**: `src/tools/<tool-name>/prompt.js` (工具名 + 说明)
- **工具实现**: `src/tools/<tool-name>/<toolName>.js` (工具逻辑)
- **工具调用**: `QueryEngine.ts` 分析后调用工具
- **常用工具**: `BashTool`、`FileWriteTool`、`AgentTool`、`SkillTool`、`SkillSearch`

### API 层

```
services/api/client.ts          # Anthropic SDK 客户端
services/api/openaiCompat.ts    # OpenAI Chat Completions → Messages 转接
services/api/claude.ts          # Anthropic 接口实现
```

支持自定义 `baseURL` 和 `API_KEY`，OpenAI 兼容接口通过中间层转发。

---

## 配置与 API

### 项目级配置

文件：`.doge/api.json`

```json
{
  "activePreset": "user",
  "presets": {
    "user": {
      "model": "claude-opus-4-6",
      "provider": "anthropic",
      "apiKey": "YOUR_API_KEY",
      "baseURL": "https://api.anthropic.com",
      "auth": {
        "type": "api_key",
        "apiKey": "YOUR_API_KEY"
      }
    }
  }
}
```

### 环境变量（API 相关）

| 变量 | 用途 |
|------|------|
| `ANTHROPIC_BASE_URL` | Anthropic API 端点 |
| `OPENAI_BASE_URL` | OpenAI API 端点（OpenAI 兼容） |
| `DOGE_API_KEY` | 当前 API 密钥 |
| `ANTHROPIC_MODEL` | 当前模型 |
| `CLAUDE_CODE_COMPATIBLE_API_PROVIDER` | `openai` 或 `anthropic` |
| `API_TIMEOUT_MS` | API 超时（10 分钟） |
| `BASH_DEFAULT_TIMEOUT_MS` | Bash 命令超时（10 分钟） |

### 其他重要环境变量

- `CLAUDE_CODE_SIMPLE` - 简化工具模式（1=启用，减少工具调用）
- `DEBUG` - 详细日志
- `LOG_LEVEL` - 日志级别（`info`/`debug`/`error`）

---

## CLI 命令速查

### 核心命令

| 命令 | 说明 |
|------|------|
| `/login` | 切换 Anthropic 账户 / API 配置 |
| `/log` | 查看日志 |
| `/config` | 显示/修改配置 |
| `/model` | 切换模型 |
| `/plan` | 计划模式（详细分析后行动） |
| `/clear` | 清空上下文 |
| `/rewind` | 回滚到指定轮次 |

### 工作流命令

| 命令 | 说明 |
|------|------|
| `/files` | 文件操作 |
| `/grep` | 代码搜索 |
| `/glob` | 文件查找 |
| `/shell` | 终端 |
| `/ide` | IDE 集成 |
| `/desktop` | 桌面应用 |

### 代码与测试

| 命令 | 说明 |
|------|------|
| `/fix-pr` | 自动修复 PR |
| `/autofix` | 代码修复 |
| `/doctor` | 诊断问题 |
| `/cost` | 查看 token 消耗 |

### 会话管理

| 命令 | 说明 |
|------|------|
| `/session` | 远程会话 URL |
| `/resume` | 恢复会话 |
| `/rename` | 重命名会话 |
| `/compact` | 压缩上下文 |

---

## 开发命令

### 启动与运行

```bash
# 开发模式（热更新）
bun run dev

# 生产模式
bun run start

# 版本
bun run version
```

### 编译与构建

```bash
# 编译为 exe（Windows）
bun run build

# 或使用脚本（推荐）
install.bat  # 安装 + link 全局
complie.bat  # 编译 exe
d.bat       # 启动（含环境变量）
```

### 测试与调试

```bash
# 运行所有测试
bun test

# 单个测试
bun test src/commands/plugin/__tests__/parseArgs.test.ts

# TypeScript 检查
bunx tsc --noEmit

# 启用调试
DEBUG=true bun run dev
```

---

## 技能与工具

### 技能系统

- **位置**: `src/skills/<skill-name>/SKILL.md`
- **调用**: `/skill-name` 或 `/ask <skill-name>`
- **用途**: 按需调用特定功能（如 `/verify`、`/session-report`）

### 常用工具

| 工具 | 说明 |
|------|------|
| `/bash <command>` | 执行 Bash 命令 |
| `/write <file> <content>` | 写文件 |
| `/read <file>` | 读文件 |
| `/edit <file> <old> <new>` | 编辑文件 |
| `/grep <pattern>` | 搜索代码 |
| `/glob <pattern>` | 查找文件 |

---

## 插件系统

### 内置插件

```bash
# 查看插件
/plugins

# 安装插件
/plugins install <plugin-name>
```

常用插件：
- `frontend-design@claude-plugins-official` - 前端设计原则与组件模式
- `playwright@claude-plugins-official` - 真实浏览器，截图验证
- `skill-creator@claude-plugins-official` - 技能创建器

### 插件开发

- **位置**: `src/plugins/bundled/` (内置)
- **类型**: 支持多种插件类型（设计、测试、分析等）

---

## 代理系统 (Agents)

### Agent 命令

```bash
# 创建代理
/agents add <name>

# 删除代理
/agents remove <name>

# 查看代理
/agents
```

### Agent 类型

- **子代理**: 被主 Agent 调用以完成特定任务
- **探索代理**: 自动探索代码库（用于 `/init`）

---

## 隐私与配置选项

### 隐私级别

| 环境变量 | 效果 |
|----------|------|
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | 仅必要流量（遥测关闭） |
| `DISABLE_TELEMETRY` | 关闭遥测 |

### 隐私配置

```bash
/config privacy
```

---

## 常见工作流

### 1. 项目初始化

```bash
# 首次运行
doge

# 分析代码库并生成 CLAUDE.md
/init
```

### 2. 日常开发

```bash
# 启动
bun run dev

# 开发中
doge "分析这个函数并重构它"
```

### 3. 复杂任务

```bash
# 进入计划模式
/plan

# 或者两次 Shift+Tab
```

### 4. 会话管理

```bash
# 清理上下文
/clear

# 回滚到之前的轮次
/rewind 10
```

---

## 测试说明

### 测试目录

```
src/commands/plugin/__tests__/  # 插件测试
src/commands/                  # 其他命令测试
```

### 运行测试

```bash
# 所有测试
bun test

# 单个测试
bun test src/commands/plugin/__tests__/parseArgs.test.ts

# 过滤测试
bun test -t "truncate"
```

---

## 重要提示

1. **环境要求**: Bun 1.3.5+ / Node.js 24+
2. **配置位置**: `.doge/` 而非 `~/.claude/`
3. **命令名**: `doge` (包名：`@doge-code/cli`)
4. **调试**: `DEBUG=true` 或查看 `latest` 符号链接
5. **更新**: `git pull → bun install → bun link`
6. **隐私**: `.doge/api.json` 包含 API 密钥，不要提交到 Git
