import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Icon } from '@iconify/react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'link'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

/** React 19 起 ref 可直接作为普通 prop 传递，无需 forwardRef。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 显示加载态：自动禁用并展示 spinner */
  loading?: boolean
  /** 图标名（Iconify），置于文字前 */
  icon?: string
  /** 图标名（Iconify），置于文字后 */
  iconRight?: string
  /** 图标尺寸，默认 1rem（跟随字号可传 'text-lg' 之类） */
  iconClass?: string
  ref?: Ref<HTMLButtonElement>
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border border-primary/90 bg-primary text-primary-foreground font-semibold shadow-e1 hover:bg-primary/90 hover:shadow-e2 active:translate-y-px',
  secondary:
    'border border-border bg-card text-foreground font-medium shadow-e1 hover:bg-surface-2 hover:border-primary/30 active:translate-y-px',
  ghost: 'text-muted-foreground font-medium hover:bg-surface-2 hover:text-foreground',
  soft: 'bg-primary-soft text-primary-soft-foreground font-medium hover:bg-primary/15',
  danger:
    'border border-destructive/90 bg-destructive text-destructive-foreground font-semibold shadow-e1 hover:bg-destructive/90 active:translate-y-px',
  link: 'text-primary font-medium underline-offset-4 hover:underline px-0',
}

const SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1.5 rounded-md px-2 text-2xs',
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-9 gap-2 rounded-lg px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-sm',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  iconClass,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      className={cn(
        'gb-btn relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-45',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Icon icon="lucide:loader-circle" className={cn('animate-spin', iconClass ?? 'size-4')} />
      ) : icon ? (
        <Icon icon={icon} className={cn('shrink-0', iconClass ?? 'size-4')} />
      ) : null}
      {children}
      {iconRight && !loading ? (
        <Icon icon={iconRight} className={cn('shrink-0', iconClass ?? 'size-4')} />
      ) : null}
    </button>
  )
}

/** 图标按钮：无文字，带无障碍标签 */
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconRight'> {
  label: string
  icon: string
}

export function IconButton({
  label,
  icon,
  size = 'icon',
  variant = 'ghost',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      // 标记出来：弹窗页脚在手机上会让「文字按钮」均分整行，
      // 纯图标按钮必须排除在外，否则会被拉成一个巨大的方块
      data-icon-button=""
      className={cn('text-muted-foreground', className)}
      {...rest}
    >
      <Icon icon={icon} className="size-4" />
    </Button>
  )
}

/** 按钮组：把若干按钮拼接为一段，中间共享边框 */
export function ButtonGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0 [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none',
        '[&>*:not(:first-child)]:-ml-px',
        className,
      )}
    >
      {children}
    </div>
  )
}
