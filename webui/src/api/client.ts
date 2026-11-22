const tokenKey = 'proxy-plugin-access'
type LocalAction = 'rules' | 'subscriptions' | 'configDocument' | 'coreOptions'
const localCache = new Map<LocalAction, unknown>()
const localRequests = new Map<LocalAction, Promise<unknown>>()
let localRevision = 0
const mutations = new Set([
  'start', 'stop', 'restart', 'takeover', 'mode', 'subscriptionAdd', 'subscriptionEdit',
  'subscriptionSelect', 'subscriptionUpdate', 'subscriptionUpdateAll', 'subscriptionRename',
  'subscriptionRemove', 'saveRules', 'saveConfigDocument', 'saveCoreOptions', 'saveSettings',
  'rollback', 'switchKernelVersion',
])

function invalidateLocal() {
  localRevision++
  localCache.clear()
  localRequests.clear()
}

export function cachedLocal<T>(name: LocalAction): T | undefined {
  const value = localCache.get(name)
  return value === undefined ? undefined : structuredClone(value) as T
}

export async function readLocal<T>(name: LocalAction): Promise<T> {
  const pending = localRequests.get(name)
  if (pending) return structuredClone(await pending) as T
  const revision = localRevision
  const request = action<T>(name, { local: true }).then(async result => {
    if (localRevision !== revision) return readLocal<T>(name)
    localCache.set(name, structuredClone(result))
    return result
  })
  localRequests.set(name, request)
  try {
    return structuredClone(await request)
  } finally {
    if (localRequests.get(name) === request) localRequests.delete(name)
  }
}
const incomingToken = new URLSearchParams(location.hash.slice(1)).get('token')
if (incomingToken) {
  sessionStorage.setItem(tokenKey, incomingToken)
  history.replaceState(null, '', location.pathname + location.search)
}

export async function action<T>(name: string, args?: unknown): Promise<T> {
  const token = sessionStorage.getItem(tokenKey)
  if (!token) throw new Error('请在主人私聊中发送 #代理web，使用生成的链接打开页面')
  const configOperation =
    name === 'saveConfigDocument' ? 'save' : name === 'checkConfigDocument' ? 'check' : null
  const response = await fetch(
    new URL(configOperation ? `api/config/${configOperation}` : 'api/action', location.href),
    {
      method: 'POST',
      headers: {
        'Content-Type': configOperation ? 'text/plain' : 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: configOperation
        ? (args as { content: string }).content
        : JSON.stringify({ action: name, args }),
    },
  )
  const data = await response.json()
  if (response.status === 401) invalidateLocal()
  if (!response.ok || !data.ok) throw new Error(data.message || '代理操作失败')
  if (mutations.has(name)) invalidateLocal()
  return data.result as T
}

export async function readStream<T>(
  channel: string,
  onData: (value: T) => void,
  signal: AbortSignal,
  level = 'info',
) {
  const token = sessionStorage.getItem(tokenKey)
  if (!token) throw new Error('请发送 #代理web 获取访问链接')
  const response = await fetch(
    new URL(`api/stream/${channel}?level=${encodeURIComponent(level)}`, location.href),
    {
      signal,
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (!response.ok || !response.body) {
    const data = await response.json()
    throw new Error(data.message || '数据流不可用')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      if (pending.length > 1024 * 1024) throw new Error('数据流消息过大')
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index)
        pending = pending.slice(index + 1)
        if (line.trim()) onData(JSON.parse(line))
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export async function followStream<T>(
  channel: string,
  onData: (value: T) => void,
  onError: (message: string) => void,
  signal: AbortSignal,
  level = 'info',
) {
  while (!signal.aborted) {
    try {
      await readStream(channel, onData, signal, level)
      if (!signal.aborted) onError('数据流已断开，正在重新连接')
    } catch (cause) {
      if (signal.aborted) return
      const message = cause instanceof Error ? cause.message : '数据流错误'
      onError(message)
      if (message.includes('过期') || message.includes('访问链接')) return
    }
    if (!signal.aborted)
      await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', finish)
          resolve()
        }
        const timer = window.setTimeout(finish, 3000)
        signal.addEventListener('abort', finish, { once: true })
      })
  }
}
