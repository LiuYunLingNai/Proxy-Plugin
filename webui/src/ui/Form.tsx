import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon } from '@iconify/react'
import { cn } from './cn'

/* ---------------------------------------------------------------- 基础控件 */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 前置图标（Iconify） */
  icon?: string
  /** 后置图标按钮等插槽 */
  suffix?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function Input({ icon, suffix, className, ref, ...rest }: InputProps) {
  // 不带图标/后缀时直接就是裸 <input>，className 挂在它身上天经地义
  if (!icon && !suffix) {
    return <input ref={ref} className={cn('gb-input', className)} {...rest} />
  }

  // 带图标/后缀时外层多包了一层定位容器。className 描述的是「整个输入框」，
  // 必须挂到**最外层**：否则 `flex-1` / `w-72` 这类布局类会落在内层 <input> 上，
  // 而外层容器没有任何宽度约束，在 flex 行里会被压缩到输入框的默认字符宽（≈20ch）。
  // 内层靠 .gb-input 自带的 w-full 撑满外层即可。
  return (
    <div className={cn('relative flex items-center', className)}>
      {icon ? (
        <Icon
          icon={icon}
          className="pointer-events-none absolute left-3 size-4 text-muted-foreground/70"
        />
      ) : null}
      <input ref={ref} className={cn('gb-input', icon && 'pl-9', suffix && 'pr-10')} {...rest} />
      {suffix ? <div className="absolute right-1.5 flex items-center">{suffix}</div> : null}
    </div>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 是否允许拖拽底部改变高度，默认允许；聊天输入框这类固定版式可传 'none' */
  resize?: 'y' | 'none'
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({ className, resize = 'y', ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={cn('gb-input', resize === 'y' ? 'resize-y' : 'resize-none', className)}
      {...rest}
    />
  )
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>
}

/**
 * 原生下拉框。
 *
 * ⚠️ 注意它**只适合表单里「选项少、不需要控制外观」的场景**：候选项列表由操作系统绘制，
 * CSS 无法触及 —— 高亮条是系统灰、浮层是系统白，深色主题下会白闪。
 *
 * 界面里的筛选器 / 工具栏 / 需要跟主题一致的场合请用 `SelectMenu`。
 * 若确实要保留原生行为（例如超长列表、移动端系统选择器），再用这个。
 */
export function Select({ className, ref, children, ...rest }: SelectProps) {
  return (
    <select ref={ref} className={cn('gb-input', className)} {...rest}>
      {children}
    </select>
  )
}

/* ------------------------------------------------------------------ 表单行 */

export interface FieldProps {
  label?: ReactNode
  /** 字段说明，展示在控件下方 */
  help?: ReactNode
  /** 校验错误，优先于 help 展示 */
  error?: ReactNode
  required?: boolean
  /** 追加在 label 右侧的内容，例如「可选」徽标 */
  hint?: ReactNode
  /** 把控件包在 label 内（用于 checkbox / switch） */
  inline?: boolean
  className?: string
  children: ReactNode | ((id: string) => ReactNode)
}

export function Field({
  label,
  help,
  error,
  required,
  hint,
  inline,
  className,
  children,
}: FieldProps) {
  const id = useId()
  // 只有 children 用函数式渲染时，控件才会真正拿到这个 id；此时 label 才该写 htmlFor，
  // 否则会生成一个指向不存在元素的 `for`——点了没反应，读屏软件也关联不上。
  const controlId = typeof children === 'function' ? id : undefined

  return (
    <div className={cn(inline && 'flex items-start gap-3', className)}>
      {label ? (
        <label
          htmlFor={inline ? undefined : controlId}
          className={cn(
            'gb-label flex items-center gap-1.5',
            inline && 'order-2 mb-0 cursor-pointer text-sm font-normal text-foreground',
          )}
        >
          {label}
          {required ? <span className="text-destructive">*</span> : null}
          {hint ? <span className="text-2xs text-muted-foreground">{hint}</span> : null}
        </label>
      ) : null}

      <div className={cn('min-w-0', inline ? 'order-1 flex items-center pt-0.5' : 'flex-1')}>
        {typeof children === 'function' ? children(id) : children}
        {error ? (
          <p className="gb-help flex items-center gap-1 text-destructive">
            <Icon icon="lucide:circle-alert" className="size-3.5 shrink-0" />
            {error}
          </p>
        ) : help ? (
          <p className="gb-help">{help}</p>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 复选框 */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode
  description?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function Checkbox({ label, description, className, ref, ...rest }: CheckboxProps) {
  const control = (
    <input ref={ref} type="checkbox" className={cn('modern-checkbox', className)} {...rest} />
  )

  if (!label && !description) return control

  return (
    <label className="group flex cursor-pointer items-start gap-2.5">
      <span className="pt-0.5">{control}</span>
      <span className="min-w-0">
        {label ? <span className="block text-sm leading-5 text-foreground">{label}</span> : null}
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

/* -------------------------------------------------------------------- 开关 */

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode
  description?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function Switch({ label, description, className, ref, ...rest }: SwitchProps) {
  // 轨道（可见的胶囊）必须能被点击来切换复选框。
  // 只用 `peer` 把 input 藏在前面是不够的：input 走 `sr-only` 后只有 1×1px，
  // 用户根本点不到；而轨道只是个普通 <span>，没有 label 包裹时点它**不会**触发任何事件。
  // 所以这里始终把「input + 轨道 + 滑块」包在一个 <label> 里，让整块 36×20 区域都成为命中区。
  // 注意必须保证整棵子树里**只有一个** <label>（label 不能嵌套），
  // 因此当外面还有说明文字时，文字也放在同一个 label 内，而不是再包一层。
  const control = (
    <span className="relative inline-flex shrink-0">
      <input ref={ref} type="checkbox" className={cn('peer sr-only', className)} {...rest} />
      <span
        aria-hidden
        className={cn(
          'block h-5 w-9 rounded-full bg-input transition-colors duration-200 ease-out',
          'peer-checked:bg-primary',
          'peer-focus-visible:ring-3 peer-focus-visible:ring-primary/20',
          'peer-disabled:opacity-50',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-e1',
          'transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'peer-checked:translate-x-4',
        )}
      />
    </span>
  )

  if (!label && !description) {
    // 没有文字时也要包 label：这就是「裸开关也能点」的关键。
    return <label className="inline-flex cursor-pointer items-center">{control}</label>
  }

  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="pt-1">{control}</span>
      <span className="min-w-0">
        {label ? <span className="block text-sm leading-5 text-foreground">{label}</span> : null}
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

/* ---------------------------------------------------------------- 表单网格 */

export function FormGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'grid gap-4',
        columns === 1
          ? 'grid-cols-1'
          : columns === 2
            ? 'sm:grid-cols-2'
            : 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** 只读信息行：label / value 两列对齐 */
export function InfoRow({
  label,
  value,
  mono,
  className,
  wrap,
}: {
  label: ReactNode
  value: ReactNode
  mono?: boolean
  className?: string
  wrap?: boolean
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', className)}>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 text-right text-sm font-medium text-foreground',
          wrap ? 'break-all' : 'truncate',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </span>
    </div>
  )
}
