import type { HTMLAttributes, ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { cn } from './cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 悬停抬升 + 可点击光标 */
  interactive?: boolean
  /** 顶部柔光装饰（用于重点卡片） */
  accent?: boolean
  /** 无内边距，由子元素自行控制 */
  bare?: boolean
}

export function Card({ interactive, accent, bare, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'glass-card gb-panel relative',
        interactive && 'gb-card-interactive',
        accent && 'gb-panel-accent',
        bare ? 'p-0' : 'p-4 sm:p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  icon,
  actions,
  className,
  children,
  flush,
}: {
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
  /** 去掉底部间距：用于紧贴分隔线的面板头（配合 border-b 使用） */
  flush?: boolean
}) {
  const base = cn(
    flush ? 'mb-0' : 'mb-4',
    'flex items-start justify-between gap-3 max-sm:flex-wrap',
    className,
  )
  if (children) {
    return <div className={base}>{children}</div>
  }
  return (
    <div className={base}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="gb-section-title truncate">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {/*
        操作区：桌面不可压缩地跟在标题右侧；手机上让它独占一行。
        与 PageTitle 同一套约定 —— 这里踩的是同一个坑：actions 上的 shrink-0
        让容器宽度恒等于内容宽度，左侧说明就被挤成一根竖条
        （实测 390px 下「无需改动插件主入口，WebAdapter…」只剩 76.7px 宽、136px 高）。
      */}
      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5 max-sm:w-full max-sm:shrink max-sm:flex-wrap max-sm:justify-start">
          {actions}
        </div>
      ) : null}
    </div>
  )
}

export function CardContent({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('space-y-3', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-4 flex items-center justify-end gap-2 border-t border-divider pt-4',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/** 分区容器：用于把内容切成"带标题的块"，比嵌套卡片更轻 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {title || actions ? (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {typeof title === 'string' ? <h2 className="gb-section-title">{title}</h2> : title}
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** 空态：统一的留白、图标与描述 */
export function EmptyState({
  icon = 'lucide:inbox',
  title,
  description,
  action,
  className,
}: {
  icon?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
        <Icon icon={icon} className="size-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
