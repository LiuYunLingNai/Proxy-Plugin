import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { cn } from './cn'

export type StatTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const TONE_ICON: Record<StatTone, string> = {
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-destructive-soft text-destructive',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-3 text-muted-foreground',
}

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** 单位或次级说明，紧跟数值显示 */
  unit?: ReactNode
  icon?: string
  tone?: StatTone
  /** 环比/同比等变化描述 */
  delta?: {
    value: ReactNode
    direction?: 'up' | 'down' | 'flat'
    tone?: 'auto' | 'positive' | 'negative'
  }
  /** 底部补充说明 */
  hint?: ReactNode
  /** 右侧插槽（例如迷你趋势图） */
  chart?: ReactNode
  loading?: boolean
  className?: string
}

export function StatCard({
  label,
  value,
  unit,
  icon,
  tone = 'primary',
  delta,
  hint,
  chart,
  loading,
  className,
}: StatCardProps) {
  const deltaTone =
    delta?.tone === 'auto' || delta?.tone === undefined
      ? delta?.direction === 'up'
        ? 'text-success'
        : delta?.direction === 'down'
          ? 'text-destructive'
          : 'text-muted-foreground'
      : delta.tone === 'positive'
        ? 'text-success'
        : 'text-destructive'

  return (
    <div className={cn('glass-card gb-panel group relative overflow-hidden p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {icon ? (
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-md',
                  TONE_ICON[tone],
                )}
              >
                <Icon icon={icon} className="size-3.5" />
              </span>
            ) : null}
            <span className="truncate">{label}</span>
          </p>

          <div className="mt-2.5 flex items-baseline gap-1.5">
            {loading ? (
              <span className="gb-skeleton inline-block h-7 w-16" />
            ) : (
              <span className="num text-2xl font-semibold leading-none tracking-tight text-foreground">
                {value}
              </span>
            )}
            {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
          </div>

          {delta || hint ? (
            <div className="mt-2 flex items-center gap-2 text-2xs">
              {delta ? (
                <span className={cn('inline-flex items-center gap-0.5 font-medium', deltaTone)}>
                  {delta.direction && delta.direction !== 'flat' ? (
                    <Icon
                      icon={
                        delta.direction === 'up' ? 'lucide:trending-up' : 'lucide:trending-down'
                      }
                      className="size-3"
                    />
                  ) : null}
                  {delta.value}
                </span>
              ) : null}
              {hint ? <span className="truncate text-muted-foreground">{hint}</span> : null}
            </div>
          ) : null}
        </div>

        {chart ? <div className="shrink-0">{chart}</div> : null}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- 迷你图表 */

export function Sparkline({
  data,
  className,
  tone = 'primary',
  height = 32,
}: {
  data: number[]
  className?: string
  tone?: StatTone
  height?: number
}) {
  if (!data.length) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const span = max - min || 1
  const w = 100
  const step = data.length > 1 ? w / (data.length - 1) : w

  const points = data.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / span) * (height - 6) - 3
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const stroke: Record<StatTone, string> = {
    primary: 'hsl(var(--primary))',
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    danger: 'hsl(var(--destructive))',
    info: 'hsl(var(--info))',
    neutral: 'hsl(var(--muted-foreground))',
  }

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={cn('w-24 overflow-visible', className)}
      style={{ height }}
      aria-hidden
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke[tone]}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** 环形指标：用于「已用 xx%」这类单值占比 */
export function RadialGauge({
  value,
  size = 72,
  thickness = 6,
  tone = 'primary',
  children,
}: {
  value: number
  size?: number
  thickness?: number
  tone?: StatTone
  children?: ReactNode
}) {
  const pct = Math.max(0, Math.min(100, value))
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r

  const stroke: Record<StatTone, string> = {
    primary: 'hsl(var(--primary))',
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    danger: 'hsl(var(--destructive))',
    info: 'hsl(var(--info))',
    neutral: 'hsl(var(--muted-foreground))',
  }

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={stroke[tone]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? (
          <span className="num text-sm font-semibold text-foreground">{Math.round(pct)}%</span>
        )}
      </div>
    </div>
  )
}
