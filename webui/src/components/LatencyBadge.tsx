import { Icon } from '@iconify/react'
import { Badge } from '../ui'

export function latencyStatus(delay: number | null | undefined, failed = false) {
  if (failed || delay === null) return { tone: 'danger' as const, label: '失败' }
  if (!Number.isFinite(delay) || !delay || delay <= 0)
    return { tone: 'neutral' as const, label: '未测试' }
  return {
    tone:
      delay < 200 ? ('success' as const) : delay < 500 ? ('warning' as const) : ('danger' as const),
    label: `${delay} ms`,
  }
}

export function LatencyBadge({
  delay,
  failed = false,
  testing = false,
}: {
  delay?: number | null
  failed?: boolean
  testing?: boolean
}) {
  if (testing) {
    return (
      <Badge tone="info" className="whitespace-nowrap">
        <Icon icon="lucide:loader-circle" className="size-3 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        测速中
      </Badge>
    )
  }
  const status = latencyStatus(delay, failed)
  return (
    <Badge tone={status.tone} dot>
      {status.label}
    </Badge>
  )
}
