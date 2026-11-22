import { useEffect, useState } from 'react'
import { action } from '../api/client'
import { useToast } from '../components/ToastProvider'
import { Button, Callout, Field, Input, Modal, SelectMenu, Switch, Textarea } from '../ui'

type Settings = {
  core: {
    path: string
    version: string
    mixedPort: number
    controllerPort: number
    autoStart: boolean
    windowsElevate: boolean
  }
  tun: { stack: string; strictRoute: boolean }
  system: { linuxDesktop: string; bypass: string }
  download: { mirrors: string[]; timeoutSeconds: number }
  subscription: { autoUpdateHours: number; userAgent: string }
  health: { restartAttempts: number }
  webui: { enabled: boolean; mountToYunzai: boolean; host: string; port: number; publicUrl: string }
}

export function SettingsPanel({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [mirrors, setMirrors] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSettings(null)
    setError('')
    void action<Settings>('settings')
      .then(value => {
        if (cancelled) return
        setSettings(value)
        setMirrors(value.download.mirrors.map(url => url || 'direct').join('\n'))
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '加载设置失败')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const save = async () => {
    if (!settings || saving) return
    setSaving(true)
    try {
      await action('saveSettings', {
        'core.path': settings.core.path,
        'core.version': settings.core.version,
        'core.mixedPort': settings.core.mixedPort,
        'core.controllerPort': settings.core.controllerPort,
        'core.autoStart': settings.core.autoStart,
        'core.windowsElevate': settings.core.windowsElevate,
        'tun.stack': settings.tun.stack,
        'tun.strictRoute': settings.tun.strictRoute,
        'system.linuxDesktop': settings.system.linuxDesktop,
        'system.bypass': settings.system.bypass,
        'download.mirrors': mirrors
          .split('\n')
          .map(value => value.trim())
          .filter(Boolean)
          .map(value => (value === 'direct' ? '' : value)),
        'download.timeoutSeconds': settings.download.timeoutSeconds,
        'subscription.autoUpdateHours': settings.subscription.autoUpdateHours,
        'subscription.userAgent': settings.subscription.userAgent,
        'health.restartAttempts': settings.health.restartAttempts,
        'webui.enabled': settings.webui.enabled,
        'webui.mountToYunzai': settings.webui.mountToYunzai,
        'webui.host': settings.webui.host,
        'webui.port': settings.webui.port,
        'webui.publicUrl': settings.webui.publicUrl.trim(),
      })
      showToast('success', '设置已保存；WebUI 服务设置重启云崽生效，代理端口与 TUN 设置重启核心生效')
      onSaved()
      onClose()
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="插件设置"
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!settings}
            onClick={() => void save()}
          >
            保存设置
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!settings && !error ? <p className="text-sm text-muted-foreground">正在加载设置…</p> : null}
      {settings ? (
        <fieldset disabled={saving} className="grid min-w-0 gap-5 border-0 p-0 sm:grid-cols-2">
          <div className="min-w-0 space-y-5 rounded-xl border border-border bg-surface-2 p-4 sm:col-span-2">
            <div>
              <h3 className="text-sm font-semibold">WebUI 服务</h3>
              <p className="mt-1 text-xs text-muted-foreground">配置页面的监听方式与访问地址。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Switch
                label="启用 WebUI"
                checked={settings.webui.enabled}
                onChange={event => setSettings({ ...settings, webui: { ...settings.webui, enabled: event.target.checked } })}
              />
              <Switch
                label="挂载到云崽 HTTP 服务"
                checked={settings.webui.mountToYunzai}
                disabled={!settings.webui.enabled}
                onChange={event => setSettings({ ...settings, webui: { ...settings.webui, mountToYunzai: event.target.checked } })}
              />
              <Field label="WebUI 独立监听地址" help="127.0.0.1 仅本机；0.0.0.0 允许其他设备访问。">
                {id => <Input id={id} value={settings.webui.host} disabled={!settings.webui.enabled || settings.webui.mountToYunzai} onChange={event => setSettings({ ...settings, webui: { ...settings.webui, host: event.target.value } })} />}
              </Field>
              <Field label="WebUI 独立端口" help="挂载模式沿用云崽端口。">
                {id => <Input id={id} type="number" min={1024} max={65535} value={settings.webui.port} disabled={!settings.webui.enabled || settings.webui.mountToYunzai} onChange={event => setSettings({ ...settings, webui: { ...settings.webui, port: Number(event.target.value) } })} />}
              </Field>
              <Field label="WebUI 访问地址" className="sm:col-span-2" help="可选，用于生成链接；不含 /proxy-plugin/。留空使用默认地址。">
                {id => <Input id={id} value={settings.webui.publicUrl} disabled={!settings.webui.enabled} placeholder="http://192.168.1.10:19100" onChange={event => setSettings({ ...settings, webui: { ...settings.webui, publicUrl: event.target.value } })} />}
              </Field>
            </div>
            <Callout tone="info">
              服务设置保存后重启云崽生效。重新发送 #代理web 获取链接。独立模式默认地址为本机地址，其他设备访问时填写可访问的 IP 或域名。
            </Callout>
          </div>
          <Field label="核心路径" className="sm:col-span-2" help="留空自动下载 mihomo">
            {controlId => (
              <Input
                id={controlId}
                value={settings.core.path}
                onChange={event =>
                  setSettings({ ...settings, core: { ...settings.core, path: event.target.value } })
                }
              />
            )}
          </Field>
          <Field label="核心下载版本">
            {controlId => (
              <Input
                id={controlId}
                value={settings.core.version}
                onChange={event =>
                  setSettings({
                    ...settings,
                    core: { ...settings.core, version: event.target.value },
                  })
                }
              />
            )}
          </Field>
          <Field label="下载超时（秒）">
            {controlId => (
              <Input
                id={controlId}
                type="number"
                min={5}
                max={300}
                value={settings.download.timeoutSeconds}
                onChange={event =>
                  setSettings({
                    ...settings,
                    download: { ...settings.download, timeoutSeconds: Number(event.target.value) },
                  })
                }
              />
            )}
          </Field>
          <Field
            label="GitHub 下载源"
            className="sm:col-span-2"
            help="每行一个镜像前缀，以 / 结尾。direct 表示直连，按行顺序尝试。"
          >
            {controlId => (
              <Textarea
                id={controlId}
                rows={3}
                value={mirrors}
                onChange={event => setMirrors(event.target.value)}
                placeholder={'https://gh-proxy.com/\nhttps://ghfast.top/\ndirect'}
              />
            )}
          </Field>
          <Field label="代理端口">
            {controlId => (
              <Input
                id={controlId}
                type="number"
                min={1024}
                max={65535}
                value={settings.core.mixedPort}
                onChange={event =>
                  setSettings({
                    ...settings,
                    core: { ...settings.core, mixedPort: Number(event.target.value) },
                  })
                }
              />
            )}
          </Field>
          <Field label="控制端口">
            {controlId => (
              <Input
                id={controlId}
                type="number"
                min={1024}
                max={65535}
                value={settings.core.controllerPort}
                onChange={event =>
                  setSettings({
                    ...settings,
                    core: { ...settings.core, controllerPort: Number(event.target.value) },
                  })
                }
              />
            )}
          </Field>
          <Switch
            label="插件加载后自动启动"
            checked={settings.core.autoStart}
            onChange={event =>
              setSettings({
                ...settings,
                core: { ...settings.core, autoStart: event.target.checked },
              })
            }
          />
          <Switch
            label="Windows 核心 UAC 提权"
            checked={settings.core.windowsElevate}
            onChange={event =>
              setSettings({
                ...settings,
                core: { ...settings.core, windowsElevate: event.target.checked },
              })
            }
          />
          <Field label="TUN 协议栈">
            {controlId => (
              <SelectMenu
                id={controlId}
                ariaLabel="TUN 协议栈"
                disabled={saving}
                value={settings.tun.stack}
                onChange={value =>
                  setSettings({ ...settings, tun: { ...settings.tun, stack: value } })
                }
                options={['system', 'gvisor', 'mixed'].map(value => ({ value, label: value }))}
              />
            )}
          </Field>
          <div className="self-center">
            <Switch
              label="TUN 严格路由"
              checked={settings.tun.strictRoute}
              onChange={event =>
                setSettings({
                  ...settings,
                  tun: { ...settings.tun, strictRoute: event.target.checked },
                })
              }
            />
          </div>
          <Field label="Linux 桌面环境">
            {controlId => (
              <SelectMenu
                id={controlId}
                ariaLabel="Linux 桌面环境"
                disabled={saving}
                value={settings.system.linuxDesktop}
                onChange={value =>
                  setSettings({
                    ...settings,
                    system: { ...settings.system, linuxDesktop: value },
                  })
                }
                options={[
                  { value: 'auto', label: '自动检测' },
                  { value: 'gnome', label: 'GNOME' },
                  { value: 'kde', label: 'KDE' },
                ]}
              />
            )}
          </Field>
          <Field label="订阅更新周期（小时）" help="0 表示关闭">
            {controlId => (
              <Input
                id={controlId}
                type="number"
                min={0}
                max={8760}
                value={settings.subscription.autoUpdateHours}
                onChange={event =>
                  setSettings({
                    ...settings,
                    subscription: { ...settings.subscription, autoUpdateHours: Number(event.target.value) },
                  })
                }
              />
            )}
          </Field>
          <Field label="订阅默认 User-Agent" help="未设置独立 User-Agent 的订阅使用此值。">
            {controlId => (
              <Input
                id={controlId}
                value={settings.subscription.userAgent}
                maxLength={256}
                onChange={event => setSettings({ ...settings, subscription: { ...settings.subscription, userAgent: event.target.value } })}
              />
            )}
          </Field>
          <Field label="系统代理绕过列表" className="sm:col-span-2">
            {controlId => (
              <Input
                id={controlId}
                value={settings.system.bypass}
                onChange={event =>
                  setSettings({
                    ...settings,
                    system: { ...settings.system, bypass: event.target.value },
                  })
                }
              />
            )}
          </Field>
          <Field label="异常重试次数">
            {controlId => (
              <Input
                id={controlId}
                type="number"
                min={0}
                max={5}
                value={settings.health.restartAttempts}
                onChange={event =>
                  setSettings({
                    ...settings,
                    health: { restartAttempts: Number(event.target.value) },
                  })
                }
              />
            )}
          </Field>
        </fieldset>
      ) : null}
    </Modal>
  )
}
