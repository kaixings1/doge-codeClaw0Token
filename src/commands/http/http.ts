import type { LocalJSXCommandCall } from '../../types/command.js'
import React from 'react'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  // 显示帮助信息
  if (!args || args.trim() === '') {
    onDone('HTTP 客户端帮助')
    return React.createElement('div', null,
      React.createElement('h2', null, 'HTTP 客户端'),
      React.createElement('h3', null, '用法'),
      React.createElement('pre', null, '/http <URL> [方法] [数据]\n\n示例:\n/http https://api.example.com/users\n/http https://api.example.com/users POST \'{"name":"John"}\''),
      React.createElement('h3', null, '支持的方法'),
      React.createElement('ul', null,
        React.createElement('li', null, 'GET - 默认方法'),
        React.createElement('li', null, 'POST - 发送数据'),
        React.createElement('li', null, 'PUT - 更新数据'),
        React.createElement('li', null, 'DELETE - 删除资源')
      )
    )
  }

  const parts = args.trim().split(/\s+/)
  const url = parts[0]
  const method = (parts[1] || 'GET').toUpperCase()
  const body = parts.slice(2).join(' ') || null

  if (!url) {
    onDone('请提供 URL 参数')
    return React.createElement('div', null, '错误: 请提供 URL 参数')
  }

  let validatedUrl = url
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      validatedUrl = 'https://' + url
    }
    new URL(validatedUrl)
  } catch (e) {
    onDone('无效的 URL: ' + url)
    return React.createElement('div', null, '错误: 无效的 URL 格式')
  }

  onDone('正在发送 ' + method + ' 请求到 ' + validatedUrl + '...')

  const startTime = Date.now()

  try {
    const urlObj = new URL(validatedUrl)
    const isHttps = urlObj.protocol === 'https:'
    const httpModule = isHttps ? require('https') : require('http')

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'User-Agent': 'Claude-Code/1.0',
        'Accept': 'application/json, text/plain, */*',
      },
    }

    const response = await new Promise((resolve, reject) => {
      const req = httpModule.request(requestOptions, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage || 'OK',
            headers: res.headers,
            body: data,
          })
        })
      })
      req.on('error', reject)
      if (body && method !== 'GET' && method !== 'HEAD') {
        req.write(body)
      }
      req.end()
    })

    const endTime = Date.now()
    const duration = endTime - startTime

    let responseBody = response.body || ''
    const contentType = response.headers['content-type'] || ''

    try {
      if (contentType.includes('application/json')) {
        const jsonData = JSON.parse(responseBody)
        responseBody = JSON.stringify(jsonData, null, 2)
      } else if (responseBody.length > 5000) {
        responseBody = responseBody.substring(0, 5000) + '\n... (响应被截断)'
      }
    } catch (e) {
      if (responseBody.length > 5000) {
        responseBody = responseBody.substring(0, 5000) + '\n... (响应被截断)'
      }
    }

    onDone('## HTTP 请求结果\n\nURL: ' + validatedUrl + '\n方法: ' + method + '\n状态码: ' + response.status + ' ' + response.statusText + '\n耗时: ' + duration + 'ms')

    return React.createElement('div', null,
      React.createElement('h2', null, 'HTTP 请求结果'),
      React.createElement('p', null, 'URL: ' + validatedUrl),
      React.createElement('p', null, '方法: ' + method),
      React.createElement('p', null, '状态码: ' + response.status + ' ' + response.statusText),
      React.createElement('p', null, '耗时: ' + duration + 'ms'),
      React.createElement('h3', null, '响应头'),
      React.createElement('pre', null,
        React.createElement('code', null,
          Object.entries(response.headers)
            .map(([k, v]) => k + ': ' + v).join('\n')
        )
      ),
      React.createElement('h3', null, '响应体'),
      React.createElement('pre', null,
        React.createElement('code', null, responseBody)
      )
    )
  } catch (error) {
    const endTime = Date.now()
    const duration = endTime - startTime
    const errorMsg = error.message || String(error)

    onDone('## HTTP 请求失败\n\nURL: ' + validatedUrl + '\n方法: ' + method + '\n错误: ' + errorMsg + '\n耗时: ' + duration + 'ms')

    return React.createElement('div', null,
      React.createElement('h2', null, 'HTTP 请求失败'),
      React.createElement('p', null, 'URL: ' + validatedUrl),
      React.createElement('p', null, '方法: ' + method),
      React.createElement('p', { style: { color: 'red' } }, '错误: ' + errorMsg),
      React.createElement('p', null, '耗时: ' + duration + 'ms')
    )
  }
}

export default {
  name: 'http',
  type: 'local-jsx',
  description: 'HTTP 客户端 - 发送 HTTP 请求',
  call: call
}
