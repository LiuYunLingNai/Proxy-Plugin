import { useCallback, useEffect, useRef, useState } from 'react'
import { action, followStream } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import { useToast } from '../components/ToastProvider'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Input,
  InfoRow,
  SelectMenu,
  Segmented,
  Switch,
} from '../ui'

function useData<T>(name: string, interval = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const active = useRef(true)
  const fetching = useRef(false)
  const reload = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    try {
      const result = await action<T>(name)
      if (active.current) {
        setData(result)
        setError('')
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : '加载失败')
    } finally {
      fetching.current = false
      if (active.current) setLoading(false)
    }
  }, [name])
  useEffect(() => {
    active.current = true
    void reload()
    const timer = interval ? window.setInterval(() => void reload(), interval) : null
    return () => {
      active.current = false
      if (timer) window.clearInterval(timer)
    }
  }, [reload, interval])
  return { data, error, loading, reload }
}

type Connection = {
  id: string
  start?: string
  upload?: number
  download?: number
  chains: string[]
  rule?: string
  metadata: {
    host?: string
    destinationIP?: string
    destinationPort?: string
    network?: string
    process?: string
    processPath?: string
    sourceIP?: string
    sourcePort?: string
    type?: string
  }
  rulePayload?: string
}
type Connections = {
  running: boolean
  connections: Connection[]
  uploadTotal: number | null
  downloadTotal: number | null
}
function bytes(value?: number | null) {
  if (value === null || value === undefined) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let amount = value,
    index = 0
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index++
  }
  return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`
}

export function ConnectionsPage() {
  const { data, error, loading, reload } = useData<Connections>('connections', 1000)
  const { showToast } = useToast()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [sort, setSort] = useState('download')
  const [network, setNetwork] = useState('all')
  const [details, setDetails] = useState<Connection | null>(null)
  const currentConnection = data?.connections.find(item => item.id === details?.id)
  const detailConnection = currentConnection || details
  useEffect(() => {
    if (currentConnection) setDetails(currentConnection)
  }, [currentConnection])
  const rows =
    data?.connections
      .filter(item =>
        [item.metadata.host, item.metadata.destinationIP, item.metadata.process, ...item.chains]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .filter(item => network === 'all' || item.metadata.network?.toLowerCase() === network) || []
  rows.sort((left, right) =>
    sort === 'upload'
      ? (right.upload || 0) - (left.upload || 0)
      : sort === 'download'
        ? (right.download || 0) - (left.download || 0)
        : String(right.start || '').localeCompare(String(left.start || '')),
  )
  const close = async (id?: string) => {
    setBusy(true)
    try {
      await action(id ? 'closeConnection' : 'closeAllConnections', id ? { id } : undefined)
      showToast('success', '连接已断开')
      await reload()
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '断开失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      <PageTitle
        icon="lucide:arrow-left-right"
        actions={
          <Button
            size="sm"
            icon="lucide:refresh-cw"
            loading={loading}
            onClick={() => void reload()}
          >
            刷新
          </Button>
        }
      >
        连接
      </PageTitle>
      {error ? (
        <Callout tone="danger" title="连接加载失败">
          {error}
        </Callout>
      ) : null}
      <Card>
        <CardHeader
          title={`${data?.connections.length ?? '—'} 个活动连接`}
          description={`累计上传 ${bytes(data?.uploadTotal)} · 下载 ${bytes(data?.downloadTotal)}`}
          actions={
            <Button
              size="sm"
              disabled={busy || !data?.connections.length}
              onClick={() => setConfirmAll(true)}
              icon="lucide:unplug"
            >
              断开全部
            </Button>
          }
        />
        <div className="mb-4 flex flex-wrap gap-3">
          <SelectMenu
            ariaLabel="连接协议"
            className="w-32"
            value={network}
            onChange={setNetwork}
            options={[
              { value: 'all', label: '全部协议' },
              { value: 'tcp', label: 'TCP' },
              { value: 'udp', label: 'UDP' },
            ]}
          />
          <SelectMenu
            ariaLabel="连接排序"
            className="w-40"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'download', label: '下载量优先' },
              { value: 'upload', label: '上传量优先' },
              { value: 'time', label: '最近建立' },
            ]}
          />
        </div>
        <Input
          icon="lucide:search"
          aria-label="搜索连接"
          placeholder="搜索域名、IP、进程或代理链"
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="mb-4 max-w-lg"
        />
        {rows.length ? (
          <div className="divide-y divide-divider">
            {rows.map(item => (
              <div key={item.id} className="flex flex-wrap items-start gap-3 py-4">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-all text-sm font-semibold">
                    {item.metadata.host || item.metadata.destinationIP || '未知目标'}
                    {item.metadata.destinationPort ? `:${item.metadata.destinationPort}` : ''}
                  </p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {item.metadata.process || item.metadata.sourceIP || '未知来源'} ·{' '}
                    {item.chains.join(' → ') || 'DIRECT'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge>{item.metadata.network || 'TCP'}</Badge>
                    {item.rule ? (
                      <span className="text-xs text-muted-foreground">{item.rule}</span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>↑ {bytes(item.upload)}</p>
                  <p className="mt-1">↓ {bytes(item.download)}</p>
                </div>
                <Button size="sm" disabled={busy} onClick={() => void close(item.id)}>
                  断开
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDetails(item)}
                >
                  详情
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="lucide:arrow-left-right"
            title={
              loading && !data
                ? '正在读取连接'
                : !data?.running
                  ? '核心未运行'
                  : '没有匹配的活动连接'
            }
          />
        )}
      </Card>
      <Drawer
        open={!!details}
        onClose={() => setDetails(null)}
        title="连接详情"
        icon="lucide:arrow-left-right"
        description="查看目标、进程、代理链和流量"
        footer={
          <div className="flex items-center justify-between gap-3">
            <Badge tone={currentConnection ? 'success' : 'neutral'}>
              {currentConnection ? '活动连接' : '连接已结束'}
            </Badge>
            <Button disabled={busy || !currentConnection} onClick={() => {
              if (currentConnection) void close(currentConnection.id)
            }}>
              断开此连接
            </Button>
          </div>
        }
      >
        {detailConnection ? (
          <div className="space-y-5">
            <div className="divide-y divide-divider">
              {[
                ['域名', detailConnection.metadata.host],
                ['来源 IP', detailConnection.metadata.sourceIP],
                ['来源端口', detailConnection.metadata.sourcePort],
                ['目标 IP', detailConnection.metadata.destinationIP],
                ['目标端口', detailConnection.metadata.destinationPort],
                ['协议', detailConnection.metadata.network?.toUpperCase()],
                ['入站类型', detailConnection.metadata.type],
                ['进程', detailConnection.metadata.process],
                ['进程路径', detailConnection.metadata.processPath],
                ['代理链', detailConnection.chains.join(' → ') || 'DIRECT'],
                ['匹配规则', [detailConnection.rule, detailConnection.rulePayload].filter(Boolean).join(' · ')],
                ['建立时间', detailConnection.start ? new Date(detailConnection.start).toLocaleString() : ''],
                ['连接 ID', detailConnection.id],
              ].map(([label, value]) => (
                <InfoRow key={label} label={label} value={value || '—'} wrap />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface-2 p-4">
                <p className="text-xs text-muted-foreground">累计上传</p>
                <p className="mt-1 text-base font-semibold">↑ {bytes(detailConnection.upload)}</p>
              </div>
              <div className="rounded-lg bg-surface-2 p-4">
                <p className="text-xs text-muted-foreground">累计下载</p>
                <p className="mt-1 text-base font-semibold">↓ {bytes(detailConnection.download)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
      <ConfirmDialog
        open={confirmAll}
        title="断开全部连接"
        description="应用后续请求会重新建立连接。"
        confirmText="断开"
        tone="danger"
        onClose={() => setConfirmAll(false)}
        onConfirm={() => {
          setConfirmAll(false)
          void close()
        }}
      />
    </div>
  )
}

type Logs = { files: { source: string; lines: string[] }[] }
export function LogsPage() {
  const [live, setLive] = useState(true)
  const { data, error, loading, reload } = useData<Logs>('logs', live ? 5000 : 0)
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('all')
  const [source, setSource] = useState('all')
  const [stream, setStream] = useState<{ source: string; text: string }[]>([])
  const [streamError, setStreamError] = useState('')
  const [mode, setMode] = useState('file')
  const [follow, setFollow] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode !== 'stream' || !live) return
    const controller = new AbortController()
    setStreamError('')
    void followStream<{ type: string; payload: string }>(
      'logs',
      value => {
        setStreamError('')
        setStream(current => [
          ...current.slice(-499),
          { source: 'stream', text: `[${value.type}] ${value.payload}` },
        ])
      },
      setStreamError,
      controller.signal,
      level === 'all' ? 'debug' : level,
    )
    return () => controller.abort()
  }, [mode, live, level])
  useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [stream, data, follow])
  const lines = (
    mode === 'stream'
      ? stream
      : (data?.files || [])
          .filter(file => source === 'all' || file.source === source)
          .flatMap(file => file.lines.map(text => ({ source: file.source, text })))
  )
    .filter(item => item.text)
    .filter(
      item =>
        item.text.toLowerCase().includes(query.toLowerCase()) &&
        (level === 'all' || new RegExp(`(?:level=|\\[|\\b)${level}`, 'i').test(item.text)),
    )
  return (
    <div className="space-y-5">
      <PageTitle
        icon="lucide:file-text"
        actions={
          <Button
            size="sm"
            icon="lucide:refresh-cw"
            loading={loading}
            onClick={() => void reload()}
          >
            刷新
          </Button>
        }
      >
        日志
      </PageTitle>
      {error ? (
        <Callout tone="danger" title="日志加载失败">
          {error}
        </Callout>
      ) : null}
      {streamError ? (
        <Callout tone="warning" title="实时日志流不可用">
          {streamError}
        </Callout>
      ) : null}
      <Card>
        <CardHeader
          title="核心日志"
          actions={
            <Switch
              label="自动刷新"
              checked={live}
              onChange={event => setLive(event.target.checked)}
            />
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented
            ariaLabel="日志来源"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'file', label: '核心文件日志' },
              { value: 'stream', label: '实时日志流' },
            ]}
          />
          <Switch
            label="跟随日志"
            checked={follow}
            onChange={event => setFollow(event.target.checked)}
          />
          <Button
            size="sm"
            onClick={() => {
              const text = lines.map(item => item.text).join('\n')
              const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
              const link = document.createElement('a')
              link.href = url
              link.download = 'mihomo.log'
              link.click()
              URL.revokeObjectURL(url)
            }}
          >
            导出日志
          </Button>
          {mode === 'stream' ? (
            <Button size="sm" onClick={() => setStream([])}>
              清空显示
            </Button>
          ) : null}
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem]">
          <Input
            icon="lucide:search"
            aria-label="搜索日志"
            placeholder="搜索日志内容"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <SelectMenu
            ariaLabel="日志级别"
            value={level}
            onChange={setLevel}
            options={['all', 'debug', 'info', 'warning', 'error'].map(value => ({ value, label: value === 'all' ? '全部级别' : value }))}
          />
          <SelectMenu
            ariaLabel="日志文件"
            value={source}
            onChange={setSource}
            disabled={mode === 'stream'}
            options={[
              { value: 'all', label: '全部文件' },
              ...(data?.files || []).map(file => ({ value: file.source, label: file.source })),
            ]}
          />
        </div>
        {lines.length ? (
          <div
            ref={logRef}
            className="max-h-[65vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-6"
            aria-label="日志内容"
          >
            {lines.map((item, index) => (
              <p key={`${item.source}-${index}`} className="break-all whitespace-pre-wrap">
                {item.text}
              </p>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="lucide:file-text"
            title={loading && !data ? '正在读取日志' : '没有匹配的日志'}
          />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          显示近期日志，订阅地址及常见凭据已脱敏。
        </p>
      </Card>
    </div>
  )
}
