import { ensureBootstrapMacro } from './bootstrapMacro.js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

ensureBootstrapMacro();

// [新] 加载 .env 文件（如果存在）
const envFile = path.join(process.cwd(), '.env')
if (fs.existsSync(envFile)) {
  try {
    const envContent = fs.readFileSync(envFile, 'utf-8')
    const envLines = envContent.split('\n')
    const validLines: string[] = []

    for (const line of envLines) {
      // 跳过注释和空行
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      // 解析键值对
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim()
        const value = trimmed.substring(eqIndex + 1).trim()
        // 只设置环境变量（不检查是否已存在）
        if (key && value) {
          process.env[key] = value
        }
      }
    }

    // 验证加载成功
    if (process.env.CLAUDE_TRUNCATE_COMPACT_THRESHOLD) {
      console.log(`[ENV] 成功加载 .env 文件，截断阈值：${process.env.CLAUDE_TRUNCATE_COMPACT_THRESHOLD}`)
    }
  } catch (err) {
    console.error(`[ENV] 读取 .env 文件失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

const apiJsonPath = path.join(process.cwd(), '.doge', 'api.json')
let activeConfig = null
if (fs.existsSync(apiJsonPath)) {
  const data = JSON.parse(fs.readFileSync(apiJsonPath, 'utf-8'))
  const presetName = data.activePreset
  if (presetName && data.presets && data.presets[presetName]) {
    activeConfig = data.presets[presetName]
  }
}

// 读取日志级别，默认 info，可通过环境变量覆盖
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'
process.env.DOGE_LOG_LEVEL = LOG_LEVEL

// 根据日志级别设置 API 配置
if (activeConfig?.baseURL && !activeConfig.baseURL.startsWith('http://0.0.0.0')) {
  const rawBase = activeConfig.baseURL.replace(/\/+$/, '');
  if (activeConfig.provider === 'anthropic') {
    process.env.ANTHROPIC_BASE_URL = rawBase;
  } else {
    process.env.ANTHROPIC_BASE_URL = rawBase;
  }
  if (activeConfig.apiKey) {
    process.env.DOGE_API_KEY = activeConfig.apiKey;
  } else {
    delete process.env.DOGE_API_KEY;
  }
  process.env.ANTHROPIC_MODEL = activeConfig.model || '';
  process.env.CLAUDE_CODE_COMPATIBLE_API_PROVIDER = activeConfig.provider || 'openai';
} else {
  // 本地模式
  process.env.ANTHROPIC_BASE_URL = 'http://0.0.0.0:1';
  process.env.DOGE_API_KEY = 'DOGE_FAKE_KEY';
  process.env.ANTHROPIC_MODEL = 'claude-dummy';
  process.env.CLAUDE_CODE_COMPATIBLE_API_PROVIDER = 'openai';
}

await import('./entrypoints/cli.tsx')