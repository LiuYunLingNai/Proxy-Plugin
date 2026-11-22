import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { action, cachedLocal, readLocal } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import { useToast } from '../components/ToastProvider'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  StatCard,
} from '../ui'
import { SettingsPanel } from './SettingsPanel'
import { LiveTraffic } from '../components/LiveTraffic'
import { SubscriptionEditor } from '../components/SubscriptionEditor'

type ProxyState = {
  platform: string
  running: boolean
  appliedSubscriptionId?: string | null
  version: { version?: string } | null
  config: {
    takeover: string
    mode: string
    core: { mixedPort: number; controllerPort: number }
    subscription: { items: { id: string; name: string; active: boolean }[] }
  }
  runtime: { mode?: string; 'mixed-port'?: number } | null
  applied: string
  system: {
    owned?: boolean
    enabled?: boolean
    conflict?: boolean
    reason?: string
  }
  tun: { interface?: boolean | null; routes?: boolean | null; reason?: string }
  apiError?: string | null
  lastError?: string
  otherCores?: { pid: number; name?: string }[] | { error?: string }
}
type Subscription = {
  id: string
  name: string
  index: number
  active: boolean
  applied: boolean
  cached: boolean
  nodes?: number | null
  updatedAt?: number
  usage?: { upload?: number; download?: number; total?: number; expire?: number }
}
type PendingAction = {
  title: string
  description: string
  action: () => Promise<void>
} | null

function takeText(value?: string | null) {
  return value === 'system' ? '系统代理' : value === 'tun' ? 'TUN' : '关闭'
}

function modeText(value?: string | null) {
  return value === 'global' ? '全局' : value === 'direct' ? '直连' : '规则'
}

function formatTime(value?: number) {
  if (!value) return '尚未更新'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}

function trafficBytes(bytes: number) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let unit = 0
  while (bytes >= 1024 && unit < units.length - 1) {
    bytes /= 1024
    unit++
  }
  return `${unit === 0 ? bytes : bytes.toFixed(2)} ${units[unit]}`
}

function validBytes(value?: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function SubscriptionUsage({ usage }: { usage?: Subscription['usage'] }) {
  const { upload, download, total, expire } = usage || {}
  const used = validBytes(upload) && validBytes(download) ? upload + download : undefined
  const amounts = [
    used !== undefined ? `已用 ${trafficBytes(used)}` : undefined,
    used === undefined && validBytes(upload) ? `已上传 ${trafficBytes(upload)}` : undefined,
    used === undefined && validBytes(download) ? `已下载 ${trafficBytes(download)}` : undefined,
    validBytes(total) ? `总量 ${trafficBytes(total)}` : undefined,
  ].filter(Boolean)
  const expiration = expire && expire > 0 ? new Date(expire * 1000) : null
  const hasExpiration = expiration && Number.isFinite(expiration.getTime())
  if (!amounts.length && !hasExpiration) return null

  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
      {amounts.length ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">流量</dt>
          <dd className="text-foreground">{amounts.join(' · ')}</dd>
        </div>
      ) : null}
      {hasExpiration ? (
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">到期时间</dt>
          <dd className="text-foreground">
            <time dateTime={expiration.toISOString()}>{formatTime(expiration.getTime())}</time>
          </dd>
        </div>
      ) : null}
    </dl>
  )
}

function StatusLine({
  label,
  value,
  ok,
  detail,
}: {
  label: string
  value: string
  ok?: boolean
  detail?: string
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 border-b border-divider py-2.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-xs font-medium text-foreground">
        <span className="inline-flex items-center justify-end gap-1.5">
          {ok !== undefined ? (
            <span
              className={`size-1.5 rounded-full ${ok ? 'bg-success' : 'bg-muted-foreground/40'}`}
            />
          ) : null}
          <span className="break-words">{value}</span>
        </span>
        {detail ? (
          <span className="mt-0.5 block break-words text-2xs font-normal text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  )
}

export type DashboardView = 'home' | 'subscriptions'
const titles = { home: '主页', subscriptions: '订阅' }
const pageIcons = { home: 'lucide:house', subscriptions: 'lucide:layers-3' }

export function ProxyPage({ view = 'home' }: { view?: DashboardView }) {
  // 运行状态优先，其次是接管与订阅操作。沿用 Guoba 的语义色和间距，启动核心作为主要操作。
  const { showToast } = useToast()
  const [status, setStatus] = useState<ProxyState | null>(null)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(() => cachedLocal<Subscription[]>('subscriptions') || [])
  const [subscriptionsReady, setSubscriptionsReady] = useState(() => !!cachedLocal('subscriptions'))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingSubscription, setEditingSubscription] = useState<string | null>(null)
  const busyRef = useRef(false)
  const refreshing = useRef(false)
  const statusFetching = useRef(false)
  const mounted = useRef(true)
  const refreshRevision = useRef(0)

  const refresh = useCallback(
    async (quiet = false) => {
      if (refreshing.current || busyRef.current) return
      refreshing.current = true
      const revision = refreshRevision.current
      if (!quiet) setLoading(true)
      if (!statusFetching.current) {
        statusFetching.current = true
        void action<ProxyState>('status', { light: view === 'subscriptions' }).then(nextStatus => {
          if (mounted.current && revision === refreshRevision.current) setStatus(nextStatus)
        }).catch(cause => {
          if (mounted.current && revision === refreshRevision.current)
            setError(cause instanceof Error ? cause.message : '读取运行状态失败')
        }).finally(() => { statusFetching.current = false })
      }
      try {
        setError('')
        const nextSubscriptions = await readLocal<Subscription[]>('subscriptions')
        if (!mounted.current || revision !== refreshRevision.current) return
        setSubscriptions(nextSubscriptions)
        setSubscriptionsReady(true)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '读取代理状态失败'
        setError(message)
      } finally {
        refreshing.current = false
        if (!quiet) setLoading(false)
      }
    },
    [view],
  )

  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 10000)
    return () => {
      mounted.current = false
      refreshRevision.current++
      window.clearInterval(timer)
    }
  }, [refresh])

  const run = async (key: string, method: () => Promise<unknown>, success: string) => {
    if (busyRef.current) return
    refreshRevision.current++
    busyRef.current = true
    setBusy(key)
    try {
      await method()
      showToast('success', success)
      busyRef.current = false
      await refresh(true)
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '操作失败')
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const chooseTakeover = (mode: string) => {
    if (mode === 'tun' && status?.applied !== 'tun') {
      setPending({
        title: '开启 TUN 接管',
        description: 'TUN 会修改本机路由和 DNS。需要对应系统权限；开启失败时插件会尝试回滚。',
        action: () => run('takeover', () => action('takeover', { mode }), '接管方式已更新'),
      })
      return
    }
    void run('takeover', () => action('takeover', { mode }), '接管方式已更新')
  }

  const addSubscription = async (event: FormEvent) => {
    event.preventDefault()
    if (!url.trim() || busyRef.current) return
    refreshRevision.current++
    busyRef.current = true
    setBusy('subscription-add')
    try {
      const result = await action<{ name: string; applied: boolean }>('subscriptionAdd', {
        name: name.trim() || undefined,
        url: url.trim(),
      })
      setName('')
      setUrl('')
      showToast('success', result.applied ? `${result.name} 已添加并应用` : `${result.name} 已保存`)
      busyRef.current = false
      await refresh(true)
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '添加订阅失败')
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const updateSubscription = async (subscription: Subscription) =>
    run(
      `sub-${subscription.id}`,
      () => action('subscriptionUpdate', { key: subscription.id }),
      `${subscription.name} 已更新`,
    )
  const selectSubscription = async (subscription: Subscription) => {
    if (busyRef.current) return
    refreshRevision.current++
    busyRef.current = true
    setBusy(`sub-${subscription.id}`)
    try {
      await action('subscriptionSelect', { key: subscription.id })
      if (!mounted.current) return
      setSubscriptions(current =>
        current.map(item => ({
          ...item,
          active: item.id === subscription.id,
          applied: status?.running === true && item.id === subscription.id,
        })),
      )
      showToast('success', `${subscription.name} 已切换`)
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '切换失败')
    } finally {
      busyRef.current = false
      setBusy('')
      void refresh(true)
    }
  }
  const removeSubscription = (subscription: Subscription) =>
    setPending({
      title: `删除 ${subscription.name}`,
      description: subscription.active
        ? '这份配置当前正在使用，需先切换订阅或停止核心。'
        : '此操作会删除该订阅及本地缓存。',
      action: async () =>
        run(
          `sub-${subscription.id}`,
          () => action('subscriptionRemove', { key: subscription.id }),
          '订阅已删除',
        ),
    })

  const externalCores = Array.isArray(status?.otherCores) ? status.otherCores : []

  return (
    <div className="gb-fade-slide-in space-y-5">
      {busy ? (
        <div
          role="status"
          className="rounded-lg bg-primary-soft px-4 py-2 text-sm text-primary-soft-foreground"
        >
          {busy.startsWith('sub-') && busy !== 'sub-all'
            ? '正在校验并应用订阅配置…'
            : '正在执行操作…'}
        </div>
      ) : null}
      <PageTitle
        icon={pageIcons[view]}
        actions={
          <Button
            size="sm"
            icon="lucide:settings-2"
            onClick={() => setSettingsOpen(true)}
            disabled={!status}
          >
            设置
          </Button>
        }
      >
        {titles[view]}
      </PageTitle>

      {error ? (
        <Callout tone="danger" title="代理状态不可用">
          {error}
        </Callout>
      ) : null}
      {externalCores.length ? (
        <Callout tone="warning" title="检测到其他代理核心">
          {externalCores.map(item => `${item.name || 'mihomo'} · PID ${item.pid}`).join('，')}
          。本插件不会自动接管或停止它们。
        </Callout>
      ) : null}
      {status?.apiError ? (
        <Callout tone="warning" title="核心控制接口异常">
          {status.apiError}
        </Callout>
      ) : null}
      {status?.lastError ? (
        <Callout tone="danger" title="最近一次操作失败">
          {status.lastError}
        </Callout>
      ) : null}

      <fieldset disabled={!!busy || (view === 'subscriptions' ? !subscriptionsReady : !status)} className="min-w-0 space-y-5 border-0 p-0">
        {view === 'home' ? (
          <>
            <LiveTraffic running={status?.running === true} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="mihomo 核心"
                value={status?.running ? '运行中' : '已停止'}
                icon="lucide:cpu"
                tone={status?.running ? 'success' : 'neutral'}
                hint={status?.version?.version || status?.platform || '等待状态'}
                loading={loading && !status}
              />
              <StatCard
                label="接管方式"
                value={takeText(status?.applied)}
                icon="lucide:network"
                tone={
                  status?.applied === 'tun'
                    ? 'warning'
                    : status?.applied === 'system'
                      ? 'info'
                      : 'neutral'
                }
                hint={`目标：${takeText(status?.config.takeover)}`}
                loading={loading && !status}
              />
              <StatCard
                label="路由模式"
                value={modeText(status?.runtime?.mode || status?.config.mode)}
                icon="lucide:split"
                tone="primary"
                hint={`${status?.runtime?.['mixed-port'] || status?.config.core.mixedPort || '—'} 代理端口`}
                loading={loading && !status}
              />
              <StatCard
                label="订阅配置"
                value={subscriptions.length}
                unit="条"
                icon="lucide:layers-3"
                tone="info"
                hint={subscriptions.find(item => item.active)?.name || '使用本地配置'}
                loading={loading && !status}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
              <Card>
                <CardHeader
                  title="核心与接管"
                  description={`${status?.platform || '平台检测中'} · 控制端口 ${status?.config.core.controllerPort || '—'}`}
                  actions={
                    <Button
                      size="sm"
                      icon="lucide:refresh-cw"
                      loading={loading}
                      onClick={() => void refresh()}
                    >
                      刷新状态
                    </Button>
                  }
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">接管方式</p>
                    <div className="flex flex-wrap gap-2">
                      {(['off', 'system', 'tun'] as const).map(mode => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={status?.config.takeover === mode ? 'primary' : 'secondary'}
                          loading={busy === 'takeover'}
                          onClick={() => chooseTakeover(mode)}
                        >
                          {takeText(mode)}
                        </Button>
                      ))}
                    </div>
                    <p className="mt-2 text-2xs text-muted-foreground">
                      核心是否运行与流量如何接管分别管理。
                    </p>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">路由模式</p>
                    <div className="flex flex-wrap gap-2">
                      {(['rule', 'global', 'direct'] as const).map(mode => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={
                            (status?.runtime?.mode || status?.config.mode) === mode
                              ? 'primary'
                              : 'secondary'
                          }
                          disabled={!status?.running}
                          loading={busy === 'mode'}
                          onClick={() =>
                            void run(
                              'mode',
                              () => action('mode', { mode }),
                              `已切换为${modeText(mode)}模式`,
                            )
                          }
                        >
                          {modeText(mode)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-divider pt-4">
                  {status?.running ? (
                    <Button
                      variant="danger"
                      size="sm"
                      icon="lucide:square"
                      loading={busy === 'stop'}
                      onClick={() => void run('stop', () => action('stop'), '核心已停止')}
                    >
                      停止核心
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      icon="lucide:play"
                      loading={busy === 'start'}
                      onClick={() => void run('start', () => action('start'), '核心已启动')}
                    >
                      启动核心
                    </Button>
                  )}
                  <Button
                    size="sm"
                    icon="lucide:rotate-cw"
                    disabled={!status?.running}
                    loading={busy === 'restart'}
                    onClick={() => void run('restart', () => action('restart'), '核心已重启')}
                  >
                    重启核心
                  </Button>
                  <Button size="sm" icon="lucide:settings-2" onClick={() => setSettingsOpen(true)}>
                    插件设置
                  </Button>
                </div>
              </Card>

              <Card>
                <CardHeader title="接管状态" description="检测到的系统级状态" />
                <StatusLine
                  label="系统代理"
                  value={
                    status?.system.owned
                      ? '本插件接管'
                      : status?.system.conflict
                        ? '存在冲突'
                        : status?.system.enabled
                          ? '已开启（非本插件）'
                          : '未接管'
                  }
                  ok={status?.system.owned}
                  detail={status?.system.reason}
                />
                <StatusLine
                  label="TUN 网卡"
                  value={
                    status?.tun.interface === true
                      ? '已检测到'
                      : status?.tun.interface === false
                        ? '未检测到'
                        : '未能检测'
                  }
                  ok={status?.tun.interface ?? undefined}
                  detail={status?.tun.reason}
                />
                <StatusLine
                  label="TUN 路由"
                  value={
                    status?.tun.routes === true
                      ? '已检测到'
                      : status?.tun.routes === false
                        ? '未检测到'
                        : '未能检测'
                  }
                  ok={status?.tun.routes ?? undefined}
                />
                <StatusLine
                  label="控制接口"
                  value={
                    status?.running && !status.apiError
                      ? '可用'
                      : status?.running
                        ? '异常'
                        : '核心未运行'
                  }
                  ok={status?.running && !status.apiError}
                />
              </Card>
            </div>
          </>
        ) : null}
        <div className="space-y-4">
          {view === 'subscriptions' ? (
            <Card>
              <CardHeader
                title="订阅"
                description="各订阅独立缓存，一次运行一份完整配置"
                actions={
                  subscriptions.length ? (
                    <Button
                      size="sm"
                      icon="lucide:refresh-cw"
                      loading={busy === 'sub-all'}
                      onClick={() =>
                        void run(
                          'sub-all',
                          async () => {
                            const results =
                              await action<{ ok: boolean; name: string; error?: string }[]>(
                                'subscriptionUpdateAll',
                              )
                            const failed = results.filter(item => !item.ok)
                            if (failed.length)
                              throw new Error(
                                `更新成功 ${results.length - failed.length}/${results.length}。${failed.map(item => `${item.name} ${item.error}`).join('；')}`,
                              )
                          },
                          '全部订阅已更新',
                        )
                      }
                    >
                      更新全部
                    </Button>
                  ) : null
                }
              />
              <form
                className="grid gap-3 border-b border-divider pb-4 sm:grid-cols-2"
                onSubmit={addSubscription}
              >
                <Field label="名称">
                  {controlId => (
                    <Input
                      id={controlId}
                      value={name}
                      onChange={event => setName(event.target.value)}
                      placeholder="可选"
                      maxLength={64}
                    />
                  )}
                </Field>
                <Field label="订阅地址">
                  {controlId => (
                    <Input
                      id={controlId}
                      type="password"
                      autoComplete="off"
                      value={url}
                      onChange={event => setUrl(event.target.value)}
                      placeholder="https://…"
                      required
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  className="justify-self-end sm:col-span-2"
                  variant="primary"
                  size="sm"
                  icon="lucide:plus"
                  loading={busy === 'subscription-add'}
                  disabled={!url.trim()}
                >
                  添加订阅
                </Button>
              </form>
              {subscriptions.length ? (
                <div className="divide-y divide-divider">
                  {subscriptions.map(subscription => (
                    <div key={subscription.id} data-subscription-id={subscription.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1 basis-52">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{subscription.name}</span>
                          {subscription.active ? (
                            <Badge tone="success" dot>
                              选中
                            </Badge>
                          ) : null}
                          {status?.running && status.appliedSubscriptionId === subscription.id ? <Badge tone="info">运行中</Badge> : null}
                        </div>
                        <p className="mt-1 text-2xs text-muted-foreground">
                          {subscription.cached
                            ? subscription.nodes === null
                              ? '含 provider'
                              : `${subscription.nodes ?? 0} 个节点`
                            : '尚未缓存'}{' '}
                          · {formatTime(subscription.updatedAt)}
                        </p>
                        <SubscriptionUsage usage={subscription.usage} />
                      </div>
                      {!subscription.active ? (
                        <Button
                          size="xs"
                          icon="lucide:check"
                          loading={busy === `sub-${subscription.id}`}
                          onClick={() => void selectSubscription(subscription)}
                        >
                          切换
                        </Button>
                      ) : null}
                      <Button
                        size="icon-sm"
                        aria-label={`编辑 ${subscription.name}`}
                        title="编辑订阅"
                        icon="lucide:pencil"
                        onClick={() => {
                          setEditingSubscription(subscription.id)
                        }}
                      />
                      <Button
                        size="icon-sm"
                        aria-label={`更新 ${subscription.name}`}
                        title="更新订阅"
                        icon="lucide:refresh-cw"
                        loading={busy === `sub-${subscription.id}`}
                        onClick={() => void updateSubscription(subscription)}
                      />
                      <Button
                        size="icon-sm"
                        aria-label={`删除 ${subscription.name}`}
                        title="删除订阅"
                        variant="ghost"
                        icon="lucide:trash-2"
                        disabled={subscription.active && (!status || !!status.running)}
                        onClick={() => removeSubscription(subscription)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="lucide:layers-3"
                  title="还没有订阅"
                  description="添加一条 mihomo YAML 订阅后即可在这里切换配置。"
                  className="mt-4"
                />
              )}
            </Card>
          ) : null}
        </div>
      </fieldset>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => void refresh(true)}
      />
      <SubscriptionEditor
        subscriptionId={editingSubscription}
        onClose={() => setEditingSubscription(null)}
        onBusyChange={value => {
          if (value) refreshRevision.current++
          busyRef.current = value
          setBusy(value ? 'subscription-edit' : '')
        }}
        onSaved={() => void refresh(true)}
      />

      <ConfirmDialog
        open={!!pending}
        title={pending?.title || ''}
        description={pending?.description}
        confirmText="继续"
        tone={pending?.title.startsWith('删除') ? 'danger' : 'primary'}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const current = pending
          setPending(null)
          if (current) void current.action()
        }}
      />
    </div>
  )
}
