import { useEffect, useMemo, useRef, useState } from 'react'
import { action, cachedLocal, readLocal } from '../api/client'
import { PageTitle } from '../components/PageTitle'
import { useToast } from '../components/ToastProvider'
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  SelectMenu,
  Textarea,
  Switch,
  Tabs,
} from '../ui'
import { ProvidersPanel } from './ProvidersPanel'
import { describeRule, editableRuleTypes, type RuleCategory } from './ruleModel'

type RuleData = {
  rules: string[]
  providers: string[]
  groups: string[]
  source: string
  available: boolean
}
type Editor = {
  index: number | null
  type: string
  value: string
  policy: string
  position: number
  flag: boolean
  raw: string
  advanced: boolean
}
const categories: { id: RuleCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'domain', label: '域名' },
  { id: 'ip', label: 'IP' },
  { id: 'set', label: '规则集' },
  { id: 'other', label: '其它' },
]

export function RulesPage() {
  const { showToast } = useToast()
  const [data, setData] = useState<RuleData | null>(() => cachedLocal<RuleData>('rules') || null)
  const [rules, setRules] = useState<string[]>(() => cachedLocal<RuleData>('rules')?.rules || [])
  const [loading, setLoading] = useState(() => !cachedLocal('rules'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [category, setCategory] = useState<RuleCategory>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [bulk, setBulk] = useState<string | null>(null)
  const [confirmReload, setConfirmReload] = useState(false)
  const [runtimeRules, setRuntimeRules] = useState<
    { index: number; extra?: { disabled: boolean; hitCount: number; missCount: number } }[]
  >([])
  const [ruleBusy, setRuleBusy] = useState(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const dirty = !!data && JSON.stringify(data.rules) !== JSON.stringify(rules)

  const reload = async () => {
    const requestRevision = revision.current
    setLoading(true)
    try {
      const result = await readLocal<RuleData>('rules')
      if (!mounted.current || requestRevision !== revision.current) return
      setData(result)
      setRules(result.rules)
      setPage(1)
      setError('')
      void action<{ rules: typeof runtimeRules }>('runtimeRules', { saved: true }).then(runtime => {
        if (mounted.current && requestRevision === revision.current) setRuntimeRules(runtime.rules)
      }).catch(() => {
        if (mounted.current && requestRevision === revision.current) setRuntimeRules([])
      })
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '读取失败')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }
  const editRules = (next: string[]) => {
    revision.current++
    setRules(next)
  }
  useEffect(() => {
    mounted.current = true
    void reload()
    return () => {
      mounted.current = false
      revision.current++
    }
  }, [])

  const matching = useMemo(
    () =>
      rules
        .map((raw, index) => ({ raw, index, ...describeRule(raw) }))
        .filter(
          rule =>
            (category === 'all' || rule.category === category) &&
            rule.raw.toLowerCase().includes(query.toLowerCase()),
        ),
    [rules, category, query],
  )
  const maxPage = Math.max(1, Math.ceil(matching.length / 60))
  const currentPage = Math.min(page, maxPage)
  const visible = matching.slice((currentPage - 1) * 60, currentPage * 60)

  const openEditor = (index: number | null) => {
    const raw = index === null ? '' : rules[index]
    const parsed = describeRule(raw)
    setEditor({
      index,
      type: index === null ? 'DOMAIN-SUFFIX' : parsed.type,
      value: index === null || parsed.type === 'MATCH' ? '' : parsed.value,
      policy: parsed.policy || 'DIRECT',
      position: index === null ? 1 : index + 1,
      flag: parsed.hasFlag,
      raw,
      advanced: index !== null && !editableRuleTypes.includes(parsed.type),
    })
  }
  const updateRule = () => {
    if (!editor) return
    const raw = editor.advanced
      ? editor.raw.trim()
      : [
          editor.type,
          ...(editor.type === 'MATCH' ? [] : [editor.value.trim()]),
          editor.policy.trim(),
          ...(editor.flag ? ['no-resolve'] : []),
        ].join(',')
    if (
      !raw ||
      /[\r\n\0]/.test(raw) ||
      (!editor.advanced &&
        (!editor.policy.trim() || (editor.type !== 'MATCH' && !editor.value.trim())))
    ) {
      showToast('error', '请填写完整规则，每条规则只占一行')
      return
    }
    if (
      !Number.isInteger(editor.position) ||
      editor.position < 1 ||
      editor.position > rules.length + (editor.index === null ? 1 : 0)
    ) {
      showToast('error', '规则位置超出列表范围')
      return
    }
    const next = rules.filter((_, index) => index !== editor.index)
    next.splice(editor.position - 1, 0, raw)
    editRules(next)
    setEditor(null)
  }
  const save = async () => {
    revision.current++
    setSaving(true)
    try {
      const result = await action<{ running: boolean }>('saveRules', { rules })
      setData(current => (current ? { ...current, rules: [...rules] } : current))
      setRuntimeRules([])
      showToast('success', result.running ? '规则已校验并应用，核心已重启' : '规则已校验并保存')
    } catch (cause) {
      showToast('error', cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }
  const policies = [...new Set(['DIRECT', 'REJECT', ...(data?.groups || [])])]

  return (
    <div className="space-y-5">
      <PageTitle icon="lucide:list-filter">规则</PageTitle>
      {error ? (
        <Callout tone="danger" title="规则加载失败">
          {error}
        </Callout>
      ) : null}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{data?.source || '规则列表'}</p>
            <p className="mt-1 text-2xl font-semibold">
              {loading && !data ? '—' : rules.length}
              <span className="ml-2 text-sm font-normal text-muted-foreground">条规则</span>
            </p>
            {dirty ? (
              <p role="status" className="mt-2 text-xs text-primary">
                修改尚未应用
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {dirty ? (
              <Button
                variant="primary"
                size="sm"
                icon="lucide:save"
                loading={saving}
                disabled={!rules.length}
                onClick={() => void save()}
              >
                保存并应用
              </Button>
            ) : null}
            <Button
              variant={dirty ? 'secondary' : 'primary'}
              size="sm"
              icon="lucide:plus"
              disabled={!data?.available || saving}
              onClick={() => openEditor(null)}
            >
              添加规则
            </Button>
            <Button
              size="sm"
              icon="lucide:refresh-cw"
              loading={loading}
              disabled={saving}
              onClick={() => (dirty ? setConfirmReload(true) : void reload())}
            >
              刷新规则
            </Button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Tabs
            ariaLabel="规则分类"
            items={categories.map(item => ({ key: item.id, label: item.label }))}
            active={category}
            onChange={key => {
              setCategory(key as RuleCategory)
              setPage(1)
            }}
          />
          <div className="flex w-full min-w-0 basis-full items-center gap-2 sm:max-w-md sm:flex-1 sm:basis-64">
            <Input
              icon="lucide:search"
              aria-label="搜索规则"
              placeholder="搜索规则类型、内容或策略"
              className="min-w-0 flex-1"
              value={query}
              onChange={event => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
            <Button
              size="icon-sm"
              icon="lucide:file-pen-line"
              aria-label="批量编辑"
              title="批量编辑"
              disabled={!data?.available || saving}
              onClick={() => setBulk(rules.join('\n'))}
            />
          </div>
        </div>
      </Card>

      {visible.length ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-label="规则列表">
          {visible.map(rule => (
            <Card key={rule.index} className="min-w-0" data-rule-index={rule.index}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {rule.index + 1}
                    </span>
                    <Badge tone="info">{rule.type}</Badge>
                    {rule.hasFlag ? <Badge>no-resolve</Badge> : null}
                  </div>
                  <p className="mt-3 break-all text-sm font-semibold leading-6">{rule.value}</p>
                  {rule.policy ? (
                    <p className="mt-1 break-all text-xs font-medium text-primary">{rule.policy}</p>
                  ) : null}
                  {!dirty && runtimeRules.find(item => item.index === rule.index)?.extra ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      命中{' '}
                      {runtimeRules.find(item => item.index === rule.index)?.extra?.hitCount ?? 0}{' '}
                      次
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {!dirty && runtimeRules.find(item => item.index === rule.index)?.extra ? (
                    <Switch
                      aria-label={`启用第 ${rule.index + 1} 条规则`}
                      checked={
                        !runtimeRules.find(item => item.index === rule.index)?.extra?.disabled
                      }
                      disabled={saving || ruleBusy}
                      onChange={async event => {
                        const disabled = !event.target.checked
                        setRuleBusy(true)
                        try {
                          await action('disableRule', { index: rule.index, disabled })
                          setRuntimeRules(current =>
                            current.map(item =>
                              item.index === rule.index
                                ? { ...item, extra: { ...item.extra!, disabled } }
                                : item,
                            ),
                          )
                        } catch (cause) {
                          showToast('error', cause instanceof Error ? cause.message : '启停失败')
                        } finally {
                          setRuleBusy(false)
                        }
                      }}
                    />
                  ) : null}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    icon="lucide:pencil"
                    aria-label={`编辑第 ${rule.index + 1} 条规则`}
                    title="编辑规则"
                    disabled={saving}
                    onClick={() => openEditor(rule.index)}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    icon="lucide:trash-2"
                    aria-label={`删除第 ${rule.index + 1} 条规则`}
                    title="删除规则"
                    disabled={saving}
                    onClick={() =>
                      editRules(rules.filter((_, index) => index !== rule.index))
                    }
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="lucide:list-filter"
          title={
            loading && !data ? '正在读取规则' : data?.available ? '没有匹配的规则' : '尚未下载配置'
          }
          description={data?.available ? '调整分类或搜索内容。' : '请先更新订阅或导入本地配置。'}
        />
      )}
      {maxPage > 1 ? (
        <div className="flex items-center justify-center gap-4">
          <Button size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {maxPage}
          </span>
          <Button
            size="sm"
            disabled={currentPage === maxPage}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
          </Button>
        </div>
      ) : null}
      {data?.available ? (
        <p className="text-xs leading-6 text-muted-foreground">
          规则按原序号从上到下匹配。保存前由 mihomo
          校验，运行中的核心会重启应用。订阅更新会使用订阅原始规则。
        </p>
      ) : null}

      <ProvidersPanel kind="rules" />
      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.index === null ? '添加规则' : '编辑规则'}
        size="lg"
        footer={
          <>
            <Button onClick={() => setEditor(null)}>取消</Button>
            <Button variant="primary" onClick={updateRule}>
              确定修改
            </Button>
          </>
        }
      >
        {editor ? (
          <div className="space-y-5">
            <div className="flex gap-2">
              <Button
                size="sm"
                aria-pressed={!editor.advanced}
                variant={!editor.advanced ? 'soft' : 'ghost'}
                disabled={!editableRuleTypes.includes(editor.type)}
                onClick={() => setEditor({ ...editor, advanced: false })}
              >
                表单编辑
              </Button>
              <Button
                size="sm"
                aria-pressed={editor.advanced}
                variant={editor.advanced ? 'soft' : 'ghost'}
                onClick={() =>
                  setEditor({
                    ...editor,
                    advanced: true,
                    raw: editor.advanced
                      ? editor.raw
                      : [
                          editor.type,
                          ...(editor.type === 'MATCH' ? [] : [editor.value]),
                          editor.policy,
                          ...(editor.flag ? ['no-resolve'] : []),
                        ].join(','),
                  })
                }
              >
                完整规则
              </Button>
            </div>
            {editor.advanced ? (
              <Field label="完整规则" help="逻辑规则及高级类型可以在这里原样编辑。">
                {controlId => (
                  <Textarea
                    id={controlId}
                    rows={5}
                    className="font-mono text-sm leading-6"
                    value={editor.raw}
                    onChange={event => setEditor({ ...editor, raw: event.target.value })}
                  />
                )}
              </Field>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="类型">
                  {controlId => (
                    <SelectMenu
                      id={controlId}
                      ariaLabel="规则类型"
                      value={editor.type}
                      onChange={value => setEditor({ ...editor, type: value })}
                      options={editableRuleTypes.map(type => ({ value: type, label: type }))}
                    />
                  )}
                </Field>
                <Field label="策略">
                  {controlId => (
                    <Input
                      id={controlId}
                      list="rule-policies"
                      value={editor.policy}
                      onChange={event => setEditor({ ...editor, policy: event.target.value })}
                    />
                  )}
                </Field>
                {editor.type !== 'MATCH' ? (
                  <Field label="匹配内容" className="sm:col-span-2">
                    {controlId => (
                      <Input
                        id={controlId}
                        data-autofocus
                        value={editor.value}
                        onChange={event => setEditor({ ...editor, value: event.target.value })}
                        placeholder={editor.type === 'IP-CIDR' ? '192.168.0.0/16' : 'example.com'}
                      />
                    )}
                  </Field>
                ) : null}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editor.flag}
                    onChange={event => setEditor({ ...editor, flag: event.target.checked })}
                  />
                  no-resolve
                </label>
                <datalist id="rule-policies">
                  {policies.map(policy => (
                    <option key={policy} value={policy} />
                  ))}
                </datalist>
              </div>
            )}
            <Field
              label="匹配顺序"
              help={`输入 1–${rules.length + (editor.index === null ? 1 : 0)}，越靠前越先匹配。`}
            >
              {controlId => (
                <Input
                  id={controlId}
                  type="number"
                  min={1}
                  max={rules.length + (editor.index === null ? 1 : 0)}
                  value={editor.position}
                  onChange={event => setEditor({ ...editor, position: Number(event.target.value) })}
                />
              )}
            </Field>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={bulk !== null}
        onClose={() => setBulk(null)}
        title="批量编辑规则"
        size="xl"
        fullOnMobile
        footer={
          <>
            <Button onClick={() => setBulk(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                editRules(
                  (bulk || '')
                    .split(/\r?\n/)
                    .map(rule => rule.trim())
                    .filter(Boolean),
                )
                setBulk(null)
                setPage(1)
              }}
            >
              确定修改
            </Button>
          </>
        }
      >
        <Field label="规则内容" help="每行一条，保持原有匹配顺序。">
          {controlId => (
            <Textarea
              id={controlId}
              rows={18}
              className="font-mono text-sm leading-6"
              value={bulk || ''}
              onChange={event => setBulk(event.target.value)}
            />
          )}
        </Field>
      </Modal>
      <ConfirmDialog
        open={confirmReload}
        title="刷新规则"
        description="当前未保存的修改将被替换。"
        onClose={() => setConfirmReload(false)}
        onConfirm={() => {
          setConfirmReload(false)
          void reload()
        }}
      />
    </div>
  )
}
