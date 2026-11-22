import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { cn } from './cn'

function moveSelection(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  const current = buttons.indexOf(event.currentTarget)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
  buttons[next]?.click()
}

/* ---------------------------------------------------------------- 分段控件 */

export interface SegmentedOption<T extends string = string> {
  value: T
  label: ReactNode
  icon?: string
  disabled?: boolean
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  /**
   * 选项多、文案长时（如 cron 生成器的 5 种字段模式）在窄屏上会顶破容器。
   * 打开后外面套一层横向滚动壳 —— 注意是套在**外层**而不是让控件自己滚动：
   * 滑动指示条用的是百分比宽度，必须让它的包含块等于控件自身宽度才算得准。
   */
  scroll,
  ariaLabel,
}: {
  options: Array<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
  scroll?: boolean
  ariaLabel?: string
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const count = options.length || 1

  const control = (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex items-center rounded-lg border border-border bg-surface-2 p-0.5',
        scroll ? 'min-w-max' : className,
      )}
    >
      {/* 滑动指示器：仅改变 transform，合成器友好 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[6px] bg-card shadow-e1 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: `calc((100% - 0.25rem) / ${count})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onKeyDown={moveSelection}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-1 inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] font-medium transition-colors duration-150',
              size === 'sm' ? 'h-6 px-2.5 text-2xs' : 'h-7 px-3 text-xs',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              opt.disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {opt.icon ? <Icon icon={opt.icon} className="size-3.5 shrink-0" /> : null}
            {opt.label}
          </button>
        )
      })}
    </div>
  )

  if (!scroll) return control

  return (
    <div
      className={cn(
        'max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {control}
    </div>
  )
}

/* -------------------------------------------------------------------- 标签页 */

export interface TabItem {
  key: string
  label: ReactNode
  icon?: string
  badge?: ReactNode
}

export function Tabs({
  items,
  active,
  onChange,
  variant = 'underline',
  className,
  ariaLabel,
}: {
  items: TabItem[]
  active: string
  onChange: (key: string) => void
  variant?: 'underline' | 'pill'
  className?: string
  ariaLabel?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)

  if (variant === 'pill') {
    return (
      <div role="tablist" aria-label={ariaLabel} className={cn('flex flex-wrap items-center gap-1.5', className)}>
        {items.map((item) => {
          const isActive = item.key === active
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onKeyDown={moveSelection}
              onClick={() => onChange(item.key)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-150',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-e1'
                  : 'border border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              {item.icon ? <Icon icon={item.icon} className="size-3.5" /> : null}
              {item.label}
              {item.badge}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-1 overflow-x-auto border-b border-border', className)}
    >
      {items.map((item) => {
        const isActive = item.key === active
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={moveSelection}
            onClick={() => onChange(item.key)}
            className={cn(
              '-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors duration-150',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            {item.icon ? <Icon icon={item.icon} className="size-4" /> : null}
            {item.label}
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ 面包屑 */

export function Breadcrumb({ items }: { items: Array<{ label: ReactNode; onClick?: () => void }> }) {
  return (
    <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-xs">
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <Icon icon="lucide:chevron-right" className="size-3 shrink-0 text-muted-foreground/50" /> : null}
            {isLast || !item.onClick ? (
              <span className={cn('truncate', isLast ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {item.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={item.onClick}
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
