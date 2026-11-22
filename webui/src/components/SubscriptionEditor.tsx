import { useEffect, useState } from 'react'
import { action } from '../api/client'
import { useToast } from './ToastProvider'
import { Button, Callout, Field, Input, Modal, Switch, cn } from '../ui'

type SubscriptionSettings = {
  id: string
  name: string
  url: string
  active: boolean
  userAgent?: string
  autoUpdateHours?: number
  defaults: { userAgent: string; autoUpdateHours: number }
}

export function SubscriptionEditor({
  subscriptionId,
  onClose,
  onBusyChange,
  onSaved,
}: {
  subscriptionId: string | null
  onClose: () => void
  onBusyChange: (busy: boolean) => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [original, setOriginal] = useState<SubscriptionSettings | null>(null)
  const [draft, setDraft] = useState<SubscriptionSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let cancelled = false
    setDraft(null)
    setOriginal(null)
    setError('')
    setVisible(false)
    if (subscriptionId) {
      void action<SubscriptionSettings>('subscriptionSettings', { key: subscriptionId })
        .then(settings => {
          if (cancelled) return
          setOriginal(settings)
          setDraft(settings)
        })
        .catch(cause => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : '读取订阅失败')
        })
    }
    return () => { cancelled = true }
  }, [subscriptionId])

  const downloadChanged = !!draft && !!original &&
    (draft.url.trim() !== original.url || (draft.userAgent?.trim() || undefined) !== original.userAgent)
  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    onBusyChange(true)
    setError('')
    try {
      const result = await action<{ name: string; applied: boolean }>('subscriptionEdit', {
        key: draft.id,
        name: draft.name.trim(),
        url: draft.url.trim(),
        userAgent: draft.userAgent?.trim() || null,
        autoUpdateHours: draft.autoUpdateHours ?? null,
      })
      showToast('success', result.applied ? `${result.name} 已保存并应用` : `${result.name} 设置已保存`)
      onBusyChange(false)
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存订阅失败')
    } finally {
      setSaving(false)
      onBusyChange(false)
    }
  }

  return (
    <Modal
      open={!!subscriptionId}
      title="编辑订阅"
      size="lg"
      onClose={() => { if (!saving) onClose() }}
      footer={
        <>
          <Button disabled={saving} onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!draft?.name.trim() || !draft?.url.trim() || (draft.userAgent !== undefined && !draft.userAgent.trim()) || (draft.autoUpdateHours !== undefined && !Number.isFinite(draft.autoUpdateHours))}
            onClick={() => void save()}
          >
            {downloadChanged ? '保存并更新' : '保存订阅'}
          </Button>
        </>
      }
    >
      {error ? <Callout tone="danger" title="订阅设置未保存">{error}</Callout> : null}
      {!draft && !error ? <p className="text-sm text-muted-foreground">正在读取订阅设置…</p> : null}
      {draft ? (
        <fieldset disabled={saving} className={cn('min-w-0 space-y-5 border-0 p-0', error && 'mt-5')}>
          <Field label="订阅名称">
            {id => <Input id={id} data-autofocus value={draft.name} maxLength={64} onChange={event => setDraft({ ...draft, name: event.target.value })} />}
          </Field>
          <Field label="订阅地址" help="HTTP/HTTPS 的完整 mihomo YAML 订阅地址。">
            {id => (
              <div className="flex min-w-0 gap-2">
                <Input id={id} className="min-w-0 flex-1" type={visible ? 'text' : 'password'} autoComplete="off" value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} />
                <Button size="icon" icon={visible ? 'lucide:eye-off' : 'lucide:eye'} aria-label={visible ? '隐藏订阅地址' : '显示订阅地址'} onClick={() => setVisible(!visible)} />
              </div>
            )}
          </Field>
          <div className="space-y-3">
            <Switch label="User-Agent 使用全局设置" checked={draft.userAgent === undefined} onChange={event => setDraft({ ...draft, userAgent: event.target.checked ? undefined : draft.defaults.userAgent })} />
            <Field label="请求 User-Agent" help={`全局值：${draft.defaults.userAgent}`}>
              {id => <Input id={id} disabled={draft.userAgent === undefined} value={draft.userAgent ?? draft.defaults.userAgent} maxLength={256} onChange={event => setDraft({ ...draft, userAgent: event.target.value })} />}
            </Field>
          </div>
          <div className="space-y-3">
            <Switch label="更新周期使用全局设置" checked={draft.autoUpdateHours === undefined} onChange={event => setDraft({ ...draft, autoUpdateHours: event.target.checked ? undefined : draft.defaults.autoUpdateHours })} />
            <Field label="更新周期（小时）" help={`0 关闭自动更新，支持小数。全局值：${draft.defaults.autoUpdateHours} 小时。`}>
              {id => <Input id={id} type="number" min={0} max={8760} step="any" disabled={draft.autoUpdateHours === undefined} value={draft.autoUpdateHours === undefined ? draft.defaults.autoUpdateHours : Number.isFinite(draft.autoUpdateHours) ? draft.autoUpdateHours : ''} onChange={event => setDraft({ ...draft, autoUpdateHours: event.target.value === '' ? NaN : Number(event.target.value) })} />}
            </Field>
          </div>
          <Callout tone="info">
            修改地址或 User-Agent 会重新下载并校验，当前订阅校验成功后应用到核心。只修改名称或更新周期直接保存。下载或校验失败时保留原配置。
          </Callout>
        </fieldset>
      ) : null}
    </Modal>
  )
}
