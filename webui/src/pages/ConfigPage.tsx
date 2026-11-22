import { useEffect, useRef, useState } from 'react'
import { action, cachedLocal, readLocal } from '../api/client'
import { useToast } from '../components/ToastProvider'
import { PageTitle } from '../components/PageTitle'
import { CodeEditor } from '../components/CodeEditor'
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  SelectMenu,
  Switch,
} from '../ui'

export function ConfigPage() {
  const { showToast } = useToast()
  const [options, setOptions] = useState<Record<string, unknown>>(() => cachedLocal<{ options: Record<string, unknown> }>('coreOptions')?.options || {})
  const [text, setText] = useState(() => cachedLocal<{ content: string }>('configDocument')?.content || '')
  const [source, setSource] = useState(() => cachedLocal<{ source: string }>('configDocument')?.source || '')
  const [documentReady, setDocumentReady] = useState(() => !!cachedLocal('configDocument'))
  const [optionsReady, setOptionsReady] = useState(() => !!cachedLocal('coreOptions'))
  const mounted = useRef(true)
  const textRevision = useRef(0)
  const optionsRevision = useRef(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [dnsName, setDnsName] = useState('example.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsResult, setDnsResult] = useState('')
  const [versions, setVersions] = useState<{ version: string; publishedAt: string }[]>([])
  const [version, setVersion] = useState('')
  const [kernelConfirm, setKernelConfirm] = useState(false)
  const load = async () => {
    const documentRevision = textRevision.current
    const coreRevision = optionsRevision.current
    setError('')
    const failure = (cause: unknown) => {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '加载失败')
    }
    await Promise.all([
      readLocal<{ options: Record<string, unknown> }>('coreOptions').then(config => {
        if (!mounted.current || coreRevision !== optionsRevision.current) return
        setOptions(config.options)
        setOptionsReady(true)
      }).catch(failure),
      readLocal<{ content: string; source: string }>('configDocument').then(document => {
        if (!mounted.current || documentRevision !== textRevision.current) return
        setText(document.content)
        setSource(document.source)
        setDocumentReady(true)
      }).catch(failure),
    ])
  }
  const editText = (value: string) => {
    textRevision.current++
    setText(value)
  }
  const editOptions = (value: Record<string, unknown>) => {
    optionsRevision.current++
    setOptions(value)
  }
  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [])
  const run = async (key: string, method: () => Promise<unknown>, message: string) => {
    if (busy) return
    setBusy(key)
    try {
      await method()
      showToast('success', message)
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="space-y-5">
      <PageTitle icon="lucide:settings-2">配置</PageTitle>
      {error ? (
        <Callout tone="danger" title="配置读取失败">
          {error}
        </Callout>
      ) : null}
      <Card>
        <CardHeader
          title="核心选项"
          actions={
            <Button
              size="sm"
              disabled={!!busy || !optionsReady}
              loading={busy === 'options'}
              onClick={() =>
                void run(
                  'options',
                  () => action('saveCoreOptions', options),
                  '核心选项已保存并应用',
                )
              }
            >
              应用选项
            </Button>
          }
        />
        <fieldset disabled={!!busy || !optionsReady} className="grid gap-5 border-0 p-0 sm:grid-cols-2">
          {[
            ['ipv6', 'IPv6'],
            ['sniffing', '流量嗅探'],
            ['tcp-concurrent', 'TCP 并发'],
          ].map(([key, label]) => (
            <Switch
              key={key}
              label={label}
              checked={options[key] === true}
              onChange={event => editOptions({ ...options, [key]: event.target.checked })}
            />
          ))}
          <Field label="进程匹配">
            {id => (
              <SelectMenu
                id={id}
                ariaLabel="进程匹配"
                disabled={!!busy || !optionsReady}
                value={String(options['find-process-mode'] || 'strict')}
                onChange={value =>
                  editOptions({ ...options, 'find-process-mode': value })
                }
                options={['off', 'strict', 'always'].map(value => ({ value, label: value }))}
              />
            )}
          </Field>
          <Field label="日志等级">
            {id => (
              <SelectMenu
                id={id}
                ariaLabel="日志等级"
                disabled={!!busy || !optionsReady}
                value={String(options['log-level'] || 'info')}
                onChange={value => editOptions({ ...options, 'log-level': value })}
                options={['silent', 'error', 'warning', 'info', 'debug'].map(value => ({ value, label: value }))}
              />
            )}
          </Field>
          <Field label="出站接口" help="留空自动选择">
            {id => (
              <Input
                id={id}
                value={String(options['interface-name'] || '')}
                onChange={event => editOptions({ ...options, 'interface-name': event.target.value })}
              />
            )}
          </Field>
        </fieldset>
      </Card>
      <Card>
        <CardHeader
          title="核心版本"
          actions={
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void run(
                  'versions',
                  async () => {
                    const list =
                      await action<{ version: string; publishedAt: string }[]>('kernelVersions')
                    setVersions(list)
                    setVersion(list[0]?.version || '')
                  },
                  '版本列表已更新',
                )
              }
            >
              检查版本
            </Button>
          }
        />
        {versions.length ? (
          <div className="flex flex-wrap gap-3">
            <SelectMenu
              ariaLabel="核心版本"
              className="w-52"
              value={version}
              disabled={!!busy}
              onChange={setVersion}
              options={versions.map(item => ({ value: item.version, label: item.version }))}
            />
            <Button disabled={!!busy || !version} onClick={() => setKernelConfirm(true)}>
              下载并切换
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            点击检查版本后选择官方发布的核心。下载使用插件镜像设置。
          </p>
        )}
      </Card>
      <Card>
        <CardHeader title="DNS 工具" />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
          <Input
            aria-label="查询域名"
            value={dnsName}
            onChange={event => setDnsName(event.target.value)}
          />
          <SelectMenu
            ariaLabel="DNS 记录类型"
            value={dnsType}
            onChange={setDnsType}
            options={['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'HTTPS', 'SVCB'].map(value => ({ value, label: value }))}
          />
          <Button
            disabled={!!busy}
            onClick={() =>
              void run(
                'dns',
                async () =>
                  setDnsResult(
                    JSON.stringify(
                      await action('dnsQuery', { name: dnsName, type: dnsType }),
                      null,
                      2,
                    ),
                  ),
                'DNS 查询完成',
              )
            }
          >
            查询
          </Button>
        </div>
        {dnsResult ? (
          <pre className="mt-4 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 text-xs whitespace-pre-wrap break-all">
            {dnsResult}
          </pre>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void run('cache', () => action('flushCache', { kind: 'dns' }), 'DNS 缓存已清理')
            }
          >
            清理 DNS 缓存
          </Button>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void run(
                'cache',
                () => action('flushCache', { kind: 'fakeip' }),
                'Fake-IP 缓存已清理',
              )
            }
          >
            清理 Fake-IP
          </Button>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() => void run('geo', () => action('updateGeo'), 'Geo 数据已更新')}
          >
            更新 Geo 数据
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="完整 YAML 配置"
          description={source || (documentReady ? '尚无保存的配置' : '正在读取本地配置…')}
          actions={<Badge>含节点凭据，请妥善保管</Badge>}
        />
        <div className="h-[32rem] min-w-0 overflow-hidden rounded-xl border border-border bg-surface-2">
          <CodeEditor
            ariaLabel="完整配置"
            lang="yaml"
            value={text}
            onChange={editText}
            readOnly={!!busy || !documentReady}
            onSave={() => {
              if (!busy && text) setConfirm(true)
            }}
          />
        </div>
        <Field label="从文件导入" className="mt-4">
          {id => (
            <Input
              id={id}
              type="file"
              accept=".yaml,.yml,text/yaml"
              disabled={!!busy}
              onChange={async event => {
                const file = event.target.files?.[0]
                if (!file) return
                if (file.size > 8 * 1024 * 1024) {
                  showToast('error', '配置超过 8 MiB')
                  return
                }
                editText(await file.text())
                setDocumentReady(true)
              }}
            />
          )}
        </Field>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={!!busy || !text}
            onClick={() =>
              void run(
                'check',
                () => action('checkConfigDocument', { content: text }),
                'mihomo 配置校验通过',
              )
            }
          >
            校验配置
          </Button>
          <Button
            variant="primary"
            disabled={!!busy || !text}
            loading={busy === 'save'}
            onClick={() => setConfirm(true)}
          >
            保存并应用
          </Button>
          <Button
            disabled={!!busy}
            onClick={() =>
              void run(
                'rollback',
                async () => {
                  await action('rollback')
                  await load()
                },
                '已回滚上一配置',
              )
            }
          >
            回滚上一配置
          </Button>
          <Button
            disabled={!!busy}
            onClick={() => {
              const blob = new Blob([text], { type: 'text/yaml' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'mihomo.yaml'
              link.click()
              URL.revokeObjectURL(url)
            }}
          >
            导出
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirm}
        title="应用完整配置"
        description="配置校验通过后会应用到核心，运行中的核心将重启。"
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          void run(
            'save',
            () => action('saveConfigDocument', { content: text }),
            '配置已保存并应用',
          )
        }}
      />
      <ConfirmDialog
        open={kernelConfirm}
        title={`切换到 ${version}`}
        description="下载完成并通过配置校验后应用，运行中的核心将重启。失败时保留上一运行状态。"
        onClose={() => setKernelConfirm(false)}
        onConfirm={() => {
          setKernelConfirm(false)
          void run('switch', () => action('switchKernelVersion', { version }), '核心版本已切换')
        }}
      />
    </div>
  )
}
