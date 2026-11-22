import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { cn } from './cn'

/* -------------------------------------------------------------------- 徽标 */

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted-foreground border-border',
  primary: 'bg-primary-soft text-primary-soft-foreground border-primary/20',
  success: 'bg-success-soft text-success-soft-foreground border-success/20',
  warning: 'bg-warning-soft text-warning-soft-foreground border-warning/25',
  danger: 'bg-destructive-soft text-destructive-soft-foreground border-destructive/20',
  info: 'bg-info-soft text-info-soft-foreground border-info/20',
}

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/60',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
}

export interface BadgeProps {
  tone?: Tone
  /** 展示状态圆点 */
  dot?: boolean
  icon?: string
  /** 实心样式 */
  solid?: boolean
  className?: string
  children?: ReactNode
}

const TONE_SOLID: Record<Tone, string> = {
  neutral: 'bg-foreground/80 text-background border-transparent',
  primary: 'bg-primary text-primary-foreground border-transparent',
  success: 'bg-success text-success-foreground border-transparent',
  warning: 'bg-warning text-warning-foreground border-transparent',
  danger: 'bg-destructive text-destructive-foreground border-transparent',
  info: 'bg-info text-info-foreground border-transparent',
}

export function Badge({ tone = 'neutral', dot, icon, solid, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-2xs font-medium leading-4',
        solid ? TONE_SOLID[tone] : TONE_SOFT[tone],
        className,
      )}
    >
      {dot ? (
        <span
          className={cn('size-1.5 rounded-full', solid ? 'bg-current opacity-80' : TONE_DOT[tone])}
        />
      ) : null}
      {icon ? <Icon icon={icon} className="size-3 shrink-0" /> : null}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ 进度条 */

export function Progress({
  value,
  tone = 'primary',
  className,
  barClassName,
}: {
  value: number
  tone?: Tone | 'auto'
  className?: string
  barClassName?: string
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const resolved: Tone =
    tone === 'auto' ? (pct > 90 ? 'danger' : pct > 70 ? 'warning' : 'success') : tone

  return (
    <div
      className={cn('gb-meter', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className={cn(TONE_DOT[resolved], barClassName)} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** 分段进度条：用于「A 占 x%，剩余为 B」这类构成关系 */
export function SegmentedProgress({
  segments,
  className,
}: {
  segments: Array<{ value: number; className: string; title?: string }>
  className?: string
}) {
  return (
    <div className={cn('gb-meter', className)}>
      {segments.map((seg, i) => (
        <span
          key={i}
          title={seg.title}
          className={cn(
            'block h-full',
            seg.className,
            'rounded-none first:rounded-l-full last:rounded-r-full',
          )}
          style={{ width: `${Math.max(0, Math.min(100, seg.value))}%` }}
        />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- 骨架 */

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn('gb-skeleton h-4 w-full', className)} style={style} />
}

export function SkeletonCard({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('glass-card space-y-3 p-5', className)}>
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i % 2 ? 'w-4/5' : 'w-full')} />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- 提示 */

export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  className,
  actions,
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  icon?: string
  className?: string
  actions?: ReactNode
}) {
  const defaultIcon: Record<Tone, string> = {
    neutral: 'lucide:info',
    primary: 'lucide:sparkles',
    success: 'lucide:circle-check',
    warning: 'lucide:triangle-alert',
    danger: 'lucide:circle-x',
    info: 'lucide:info',
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm',
        TONE_SOFT[tone],
        className,
      )}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <Icon icon={icon ?? defaultIcon[tone]} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? (
          <div className={cn('text-xs leading-relaxed', title && 'mt-0.5 opacity-90')}>
            {children}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------------- 加载 */

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
      {label}
    </span>
  )
}

/** 通用加载占位块（页面级） */
export function LoadingBlock({
  label = '加载中…',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div className={cn('flex min-h-[40vh] flex-col items-center justify-center gap-3', className)}>
      <span className="relative flex size-9 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-border border-t-primary" />
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}
