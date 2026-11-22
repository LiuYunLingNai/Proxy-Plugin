import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { action } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import { useToast } from '../components/ToastProvider'
import { ProvidersPanel } from './ProvidersPanel'
import { LatencyBadge } from '../components/LatencyBadge'
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Modal, SelectMenu, Segmented, Tabs, cn } from '../ui'

type Proxy = {
  name: string
  type: string
  all?: string[]
  now?: string
  alive?: boolean
  udp?: boolean
  provider?: string
  history?: { delay: number; time: string }[]
}
type Snapshot = {
  running: boolean
  groups: Proxy[]
  proxies: Record<string, Proxy>
  providerError?: string
}

type RoutingStatus = {
  applied?: string
  runtime?: { mode: string; 'mixed-port'?: number } | null
  config: { mode: string }
}

const modeOptions = [
  { value: 'rule', label: '规则' },
  { value: 'global', label: '全局' },
  { value: 'direct', label: '直连' },
]
const groupTypes: Record<string, string> = {
  Selector: '手动选择',
  URLTest: '自动测速',
  Fallback: '故障转移',
  LoadBalance: '负载均衡',
  Relay: '链式代理',
}
const manualGroups = new Set(['Selector', 'URLTest', 'Fallback'])

function defaultGroup(groups: Proxy[], mode: string) {
  const regular = groups.filter(item => item.name !== 'GLOBAL')
  return (
    (mode === 'global' ? groups.find(item => item.name === 'GLOBAL') : undefined) ||
    regular.find(item => item.type === 'Selector') ||
    regular[0] ||
    groups[0]
  )?.name ?? ''
}

export function ProxiesPage() {
  const { showToast } = useToast()
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [group, setGroup] = useState('')
  const [tab, setTab] = useState('nodes')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('original')
  const [url, setUrl] = useState('https://www.gstatic.com/generate_204')
  const [timeout, setTimeoutValue] = useState(5000)
  const [testSettings, setTestSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [delays, setDelays] = useState<Record<string, number | null>>({})
  const [mode, setMode] = useState('rule')
  const [routing, setRouting] = useState<RoutingStatus | null>(null)
  const [pendingSelection, setPendingSelection] = useState<{ group: string; name: string } | null>(
    null,
  )
  const operating = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const load = async (chooseModeGroup = false) => {
    const requestRevision = ++revision.current
    setLoading(true)
    try {
      const [snapshot, state] = await Promise.all([
        action<Snapshot>('proxySnapshot'),
        action<RoutingStatus>('status', { light: true }),
      ])
      if (!mounted.current || revision.current !== requestRevision) return
      const currentMode = state.runtime?.mode || state.config.mode
      setData(snapshot)
      setMode(currentMode)
      setRouting(state)
      setError('')
      setGroup(current =>
        !chooseModeGroup && snapshot.groups.some(item => item.name === current)
          ? current
          : defaultGroup(snapshot.groups, currentMode),
      )
    } catch (cause) {
      if (mounted.current && revision.current === requestRevision)
        setError(cause instanceof Error ? cause.message : '加载失败')
    } finally {
      if (mounted.current && revision.current === requestRevision) setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      revision.current++
    }
  }, [])
  const operate = async (
    key: string,
    method: () => Promise<unknown>,
    message: string,
    refresh?: 'snapshot' | 'mode',
  ) => {
    if (operating.current) return
    operating.current = true
    revision.current++
    setBusy(key)
    try {
      await method()
      showToast('success', message)
      if (refresh && mounted.current) await load(refresh === 'mode')
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '操作失败')
    } finally {
      operating.current = false
      if (mounted.current) setBusy('')
    }
  }
  const selectNode = async (node: string) => {
    const targetGroup = data?.groups.find(item => item.name === group)
    if (loading || operating.current || !targetGroup || targetGroup.now === node) return
    operating.current = true
    revision.current++
    setBusy('node-selection')
    setPendingSelection({ group, name: node })
    try {
      const confirmed = await action<string>('selectNode', { group: targetGroup.name, name: node })
      if (!mounted.current) return
      setData(current =>
        current
          ? {
              ...current,
              groups: current.groups.map(item =>
                item.name === targetGroup.name ? { ...item, now: confirmed } : item,
              ),
              proxies: {
                ...current.proxies,
                [targetGroup.name]: {
                  ...current.proxies[targetGroup.name],
                  name: targetGroup.name,
                  type: targetGroup.type,
                  now: confirmed,
                },
              },
            }
          : current,
      )
      showToast('success', `${targetGroup.name} 已选择 ${confirmed}`)
    } catch (cause) {
      if (mounted.current)
        showToast('error', cause instanceof Error ? cause.message : '切换失败，保留原节点')
    } finally {
      operating.current = false
      if (mounted.current) {
        setPendingSelection(null)
        setBusy('')
      }
    }
  }
  const groups = data?.groups || []
  const selected = groups.find(item => item.name === group)
  const showGlobalFirst = mode === 'global'
  const visibleGroups = showGlobalFirst
    ? [...groups.filter(item => item.name === 'GLOBAL'), ...groups.filter(item => item.name !== 'GLOBAL')]
    : [...groups.filter(item => item.name !== 'GLOBAL'), ...groups.filter(item => item.name === 'GLOBAL')]
  const busyOrLoading = !!busy || loading
  const selectable = !!selected && manualGroups.has(selected.type)
  const canReset = selected?.type === 'URLTest' || selected?.type === 'Fallback'
  const currentProxy = selected?.now ? data?.proxies[selected.now] : undefined
  const proxyPort = routing?.runtime?.['mixed-port']
  const modeHint =
    mode === 'global'
      ? '流量由 GLOBAL 组转发'
      : mode === 'direct'
        ? '流量直连，节点选择暂不参与转发'
        : '代理组由命中的规则决定'
  const delay = (proxy: Proxy) =>
    Object.hasOwn(delays, proxy.name)
      ? delays[proxy.name]
      : proxy.alive === false
        ? null
        : proxy.history?.at(-1)?.delay
  const latencyRank = (proxy: Proxy) => {
    const value = delay(proxy)
    return value && value > 0 ? value : Infinity
  }
  const isTesting = (name: string) => busy === 'test' || busy === 'delay-' + name
  const search = query.trim().toLowerCase()
  const nodes = (selected?.all || [])
    .map(name => data?.proxies[name] || { name, type: 'Unknown' })
    .filter(item => item.name.toLowerCase().includes(search))
  if (sort === 'latency') nodes.sort((left, right) => latencyRank(left) - latencyRank(right))
  if (sort === 'name') nodes.sort((left, right) => left.name.localeCompare(right.name))

  const changeGroup = (name: string) => {
    setGroup(name)
    setQuery('')
  }
  const changeMode = (value: string) => {
    if (value === mode) return
    void operate('mode', async () => {
      await action('mode', { mode: value })
      setMode(value)
      setRouting(current => current && {
        ...current,
        runtime: { ...current.runtime, mode: value },
      })
      changeGroup(defaultGroup(groups, value))
    }, '模式已切换', 'mode')
  }
  const testGroup = () => {
    if (!selected) return
    void operate('test', async () => {
      const results = await action<Record<string, number>>('testGroup', { group, url, timeout })
      const updates = Object.fromEntries(
        (selected.all || []).map(name => [name, results[name] > 0 ? results[name] : null]),
      )
      setDelays(current => ({ ...current, ...updates }))
    }, '代理组测速完成')
  }
  const testNode = (name: string) => {
    void operate('delay-' + name, async () => {
      try {
        const result = await action<{ delay: number }>('testNode', { name, url, timeout })
        setDelays(current => ({ ...current, [name]: result.delay > 0 ? result.delay : null }))
      } catch (cause) {
        setDelays(current => ({ ...current, [name]: null }))
        throw cause
      }
    }, '节点测速完成')
  }

  return (
    <div className="space-y-4">
      <PageTitle
        icon="lucide:wifi"
        actions={
          tab === 'nodes' ? (
            <Button size="sm" icon="lucide:refresh-cw" loading={loading} disabled={!!busy} onClick={() => void load()}>
              刷新
            </Button>
          ) : null
        }
      >
        代理
      </PageTitle>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-divider">
        <Tabs
          ariaLabel="代理页面"
          className="border-none"
          items={[
            { key: 'nodes', label: '代理组与节点', icon: 'lucide:layers-3' },
            { key: 'providers', label: '代理提供者', icon: 'lucide:database' },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab === 'nodes' ? (
          <div className="flex items-center gap-2 pb-2">
            <span className="text-xs font-medium text-muted-foreground">路由模式</span>
            <Segmented
              size="sm"
              ariaLabel="路由模式"
              value={mode}
              options={modeOptions.map(item => ({ ...item, disabled: !data?.running || busyOrLoading }))}
              onChange={changeMode}
            />
          </div>
        ) : null}
      </div>

      {tab === 'providers' ? (
        <section role="tabpanel" aria-label="代理提供者">
          <ProvidersPanel kind="proxies" />
        </section>
      ) : (
        <section role="tabpanel" aria-label="代理组与节点" className="space-y-4">
          {error ? <Callout tone="danger" title="代理读取失败">{error}</Callout> : null}
          {data?.providerError ? (
            <Callout tone="warning" title="提供者节点未能读取">{data.providerError}</Callout>
          ) : null}
          {data?.running ? (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
              <span>{modeHint}</span>
              {routing?.applied === 'off' ? (
                <span className="flex items-center gap-1.5">
                  <Icon icon="lucide:info" className="size-3.5 shrink-0" />
                  {proxyPort ? '未接管系统 · 手动代理 127.0.0.1:' + proxyPort : '未接管系统流量'}
                </span>
              ) : null}
            </div>
          ) : null}

          {selected ? (
            <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
              <Card className="hidden min-w-0 p-3 sm:p-3 lg:block">
                <div className="flex items-baseline justify-between gap-2 px-2 pb-2 pt-1">
                  <h2 className="text-sm font-semibold text-foreground">代理组</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">{groups.length} 组</span>
                </div>
                <div role="group" aria-label="代理组" className="space-y-1">
                  {visibleGroups.map(item => (
                    <button
                      key={item.name}
                      type="button"
                      aria-current={item.name === group ? 'true' : undefined}
                      aria-label={item.name}
                      disabled={busyOrLoading}
                      onClick={() => changeGroup(item.name)}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors',
                        item.name === group
                          ? 'bg-primary-soft text-primary-soft-foreground'
                          : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium" title={item.name}>{item.name}</span>
                        <span className={cn('mt-0.5 block truncate text-xs', item.name === group ? 'text-primary-soft-foreground' : 'text-muted-foreground')} title={item.now}>
                          {item.now || groupTypes[item.type] || item.type}
                        </span>
                      </span>
                      {item.name === group ? <Icon icon="lucide:chevron-right" className="size-4 shrink-0" /> : null}
                    </button>
                  ))}
                </div>
              </Card>

              <Card className="min-w-0">
                <div className="mb-4 lg:hidden">
                  <Field label="代理组">
                    {id => (
                      <SelectMenu
                        id={id}
                        ariaLabel="代理组"
                        value={group}
                        disabled={busyOrLoading}
                        onChange={changeGroup}
                        options={visibleGroups.map(item => ({
                          value: item.name,
                          label: item.name,
                          hint: groupTypes[item.type] || item.type,
                        }))}
                      />
                    )}
                  </Field>
                </div>

                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 lg:flex">
                      <h2 className="min-w-0 text-lg font-semibold text-foreground [overflow-wrap:anywhere]">{selected.name}</h2>
                      <Badge>{groupTypes[selected.type] || selected.type}</Badge>
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs text-muted-foreground">组内当前</span>
                      <span data-current-node className="min-w-0 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{selected.now || '由核心选择'}</span>
                      {currentProxy && !currentProxy.all && (isTesting(currentProxy.name) || delay(currentProxy) !== undefined) ? (
                        <LatencyBadge delay={delay(currentProxy)} testing={isTesting(currentProxy.name)} />
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canReset ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyOrLoading}
                        onClick={() => void operate('reset', () => action('resetGroup', { group }), '已恢复自动选择', 'snapshot')}
                      >
                        恢复自动
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="soft"
                      icon="lucide:activity"
                      loading={busy === 'test'}
                      disabled={busyOrLoading || !selected.all?.length}
                      onClick={testGroup}
                    >
                      全组测速
                    </Button>
                    <Button size="sm" variant="ghost" icon="lucide:sliders-horizontal" disabled={busyOrLoading} onClick={() => setTestSettings(true)}>
                      测速设置
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_7.25rem] items-start gap-2 border-t border-divider pt-4">
                  <Input
                    icon="lucide:search"
                    aria-label="搜索节点"
                    placeholder="搜索节点"
                    className="min-w-0"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                  />
                  <SelectMenu
                    ariaLabel="节点排序"
                    align="right"
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: 'original', label: '配置顺序' },
                      { value: 'latency', label: '延迟优先' },
                      { value: 'name', label: '按名称排序' },
                    ]}
                  />
                </div>
                <div className="my-3 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                  {search ? '匹配 ' + nodes.length + ' / ' : ''}{selected.all?.length || 0} 个节点
                  {!selectable ? ' · 由核心自动选择' : ''}
                </div>
                {nodes.length ? (
                  <ul className="grid gap-2 xl:grid-cols-2" aria-label="节点列表">
                    {nodes.map(proxy => {
                      const current = selected.now === proxy.name
                      const pending = pendingSelection?.group === group && pendingSelection.name === proxy.name
                      const testing = isTesting(proxy.name)
                      return (
                        <li
                          key={proxy.name}
                          aria-busy={pending || testing}
                          className={cn(
                            'flex min-w-0 items-center gap-1.5 rounded-xl border p-2',
                            current ? 'border-primary/40 bg-primary-soft' : 'border-border bg-surface-1',
                            pending && 'border-primary/40',
                          )}
                        >
                          <button
                            type="button"
                            data-proxy-node={proxy.name}
                            aria-label={proxy.name}
                            aria-pressed={current}
                            disabled={!selectable || busyOrLoading || current}
                            onClick={() => void selectNode(proxy.name)}
                            className={cn(
                              'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left',
                              selectable && !current && 'enabled:cursor-pointer enabled:hover:bg-surface-2',
                            )}
                          >
                            <span className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded-full border',
                              current ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                              pending && 'border-primary text-primary',
                            )} aria-hidden="true">
                              {current ? <Icon icon="lucide:check" className="size-3" /> : null}
                              {pending ? <Icon icon="lucide:loader-circle" className="size-3 animate-spin" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium leading-snug text-foreground [overflow-wrap:anywhere]">{proxy.name}</span>
                              <span className={cn('mt-0.5 block truncate text-xs', current ? 'text-primary-soft-foreground' : 'text-muted-foreground')} title={proxy.provider}>
                                {pending ? '切换中' : current ? '当前 · ' + proxy.type : proxy.type}
                                {proxy.provider ? ' · ' + proxy.provider : ''}
                              </span>
                            </span>
                          </button>
                          <span className="shrink-0 tabular-nums"><LatencyBadge delay={delay(proxy)} testing={testing} /></span>
                          <Button
                            size="icon-sm"
                            className="max-sm:size-10"
                            variant="ghost"
                            icon="lucide:activity"
                            aria-label={'测速 ' + proxy.name}
                            title="测速"
                            disabled={busyOrLoading}
                            onClick={() => testNode(proxy.name)}
                          />
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <EmptyState icon="lucide:search" title={search ? '没有匹配节点' : '该代理组没有节点'} />
                )}
              </Card>
            </div>
          ) : (
            <Card>
              <EmptyState
                icon="lucide:wifi"
                title={loading ? '正在读取代理组' : error ? '暂时无法读取代理组' : data?.running ? '没有可用的代理组' : '核心未运行'}
                description={!loading && !error && !data?.running ? '请在主页启动 mihomo 核心。' : undefined}
              />
            </Card>
          )}
        </section>
      )}

      <Modal
        open={testSettings}
        onClose={() => setTestSettings(false)}
        title="测速设置"
        size="sm"
        sheetOnMobile
        footer={<Button variant="primary" type="submit" form="proxy-test-settings">应用</Button>}
      >
        <form
          id="proxy-test-settings"
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault()
            const fields = new FormData(event.currentTarget)
            setUrl(String(fields.get('url')).trim())
            setTimeoutValue(Number(fields.get('timeout')))
            setTestSettings(false)
          }}
        >
          <Field label="测速地址">
            {id => <Input id={id} name="url" type="url" pattern="https?://.+" defaultValue={url} required />}
          </Field>
          <Field label="超时（毫秒）">
            {id => <Input id={id} name="timeout" type="number" min={500} max={20000} defaultValue={timeout} required />}
          </Field>
        </form>
      </Modal>
    </div>
  )
}
