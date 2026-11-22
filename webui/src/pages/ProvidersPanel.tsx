import { useEffect, useState } from 'react'
import { action } from '../api/client'
import { useToast } from '../components/ToastProvider'
import { Badge, Button, Callout, Card, CardHeader, EmptyState } from '../ui'

type Provider = {
  name: string
  type?: string
  vehicleType?: string
  updatedAt?: string
  ruleCount?: number
  behavior?: string
  proxies?: unknown[]
  subscriptionInfo?: { Upload: number; Download: number; Total: number; Expire: number }
}
export function ProvidersPanel({ kind }: { kind: 'proxies' | 'rules' }) {
  const [items, setItems] = useState<Provider[]>([])
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState('')
  const { showToast } = useToast()
  const load = async () => {
    try {
      const data = await action<{ providers: Provider[]; running: boolean }>('providers', { kind })
      setItems(data.providers)
      setRunning(data.running)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载失败')
    }
  }
  useEffect(() => {
    void load()
  }, [kind])
  const update = async (name: string, health = false) => {
    if (busy) return
    setBusy(name)
    try {
      await action(health ? 'healthProvider' : 'updateProvider', { kind, name })
      showToast('success', health ? '健康检查已完成' : '提供者已更新')
      await load()
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setBusy('')
    }
  }
  return (
    <Card>
      <CardHeader
        title={kind === 'proxies' ? '代理提供者' : '规则提供者'}
        actions={
          <Button size="sm" icon="lucide:refresh-cw" onClick={() => void load()}>
            刷新
          </Button>
        }
      />
      {error ? (
        <Callout tone="warning" title="提供者接口不可用">
          {error}
        </Callout>
      ) : null}
      {items.length ? (
        <div className="divide-y divide-divider">
          {items.map(item => (
            <div key={item.name} className="flex flex-wrap items-center gap-3 py-4">
              <div className="min-w-0 flex-1 basis-52">
                <p className="break-all text-sm font-semibold">{item.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge>{item.vehicleType || item.type || 'Provider'}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {kind === 'proxies'
                      ? `${item.proxies?.length ?? 0} 节点`
                      : `${item.ruleCount ?? '—'} 规则`}
                  </span>
                  {item.behavior ? <Badge>{item.behavior}</Badge> : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '尚未更新'}
                </p>
                {item.subscriptionInfo ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    已用{' '}
                    {(
                      (item.subscriptionInfo.Upload + item.subscriptionInfo.Download) /
                      1024 ** 3
                    ).toFixed(2)}{' '}
                    GiB / {(item.subscriptionInfo.Total / 1024 ** 3).toFixed(2)} GiB
                    {item.subscriptionInfo.Expire
                      ? ` · ${new Date(item.subscriptionInfo.Expire * 1000).toLocaleDateString()} 到期`
                      : ''}
                  </p>
                ) : null}
              </div>
              {kind === 'proxies' ? (
                <Button size="sm" disabled={!!busy} onClick={() => void update(item.name, true)}>
                  健康检查
                </Button>
              ) : null}
              <Button
                size="sm"
                loading={busy === item.name}
                disabled={!!busy}
                onClick={() => void update(item.name)}
              >
                更新
              </Button>
            </div>
          ))}
        </div>
      ) : !error ? (
        <EmptyState title={running ? '配置没有提供者' : '核心未运行'} />
      ) : null}
    </Card>
  )
}
