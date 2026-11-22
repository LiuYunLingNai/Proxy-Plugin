import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { cn } from './cn'
import { Button, type ButtonProps } from './Button'

/* 多个弹窗叠加时只锁一次滚动 */
let lockCount = 0
function lockScroll() {
  lockCount += 1
  if (lockCount === 1) {
    document.documentElement.style.overflow = 'hidden'
  }
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.documentElement.style.overflow = ''
  }
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  icon?: string
  /** 底部操作区 */
  footer?: ReactNode
  /** 尺寸预设 */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** 面板最大宽度（px）。给出时以它为准（内联样式优先于 `size` 预设） */
  width?: number
  /** 点击遮罩不关闭 */
  persistent?: boolean
  /** 移动端从底部弹出 */
  sheetOnMobile?: boolean
  /**
   * 移动端铺满整个视口（去掉圆角与边距）。
   * 给「内容本身就是一块工作区」的弹窗用 —— 代码编辑器、长日志、SQL 编辑器、
   * cron 生成器这类，小屏上每一条像素都很贵，居中对话框会浪费掉上下各一大截。
   */
  fullOnMobile?: boolean
  className?: string
  bodyClassName?: string
  /** 页脚附加类名 */
  footerClassName?: string
  children?: ReactNode
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-[min(96vw,80rem)]',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  footer,
  size = 'md',
  width,
  persistent,
  sheetOnMobile,
  fullOnMobile,
  className,
  bodyClassName,
  footerClassName,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  /**
   * `onClose` 几乎总是内联箭头（`onClose={() => setX(null)}`），父组件每渲染一次就换一个身份。
   * 它以前直接进下面 effect 的依赖，于是「父组件一渲染 → 清理 + 重跑」：
   *   1. 反复 unlock / lock 了 `<html>` 的滚动锁；
   *   2. 在 rAF 里重新聚焦一次，**把正文输入框的焦点抢到弹窗头部的「关闭」按钮上**。
   * 编辑器是重灾区 —— 它每敲一个字符就 setState 一次，于是「打一个字，焦点就跑掉，
   * 必须再用鼠标点回编辑区」。所以把「调谁」放进 ref，让 effect 只随 open 变化。
   */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const close = useCallback(() => {
    if (!persistent) onCloseRef.current()
  }, [persistent])

  useEffect(() => {
    if (!open) return
    lockScroll()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      unlockScroll()
    }
  }, [open, close])

  /**
   * 打开后把焦点移入面板 —— 只在「打开」这一刻做一次，跟随 open 而不是跟随父组件的渲染次数。
   *
   * 落点也修了：以前取的是面板里 DOM 顺序最靠前的可聚焦元素，而那**永远**是头部的「关闭」按钮。
   * 焦点落在关闭按钮上，等于「随便敲一下回车/空格就把弹窗关了」，对键盘用户反而是个坑。
   * 现在只认正文里的输入控件（或显式标记 `data-autofocus` 的元素）；纯确认类弹窗没有输入控件，
   * 就不抢焦点，保持原有交互。
   */
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      const target =
        panel?.querySelector<HTMLElement>('[data-autofocus]') ||
        panel?.querySelector<HTMLElement>('textarea, input:not([type="hidden"]), select')
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className={cn(
        // 间距交给 .gb-overlay（@layer components）：手机上贴边、桌面才留四周呼吸感
        'gb-overlay gb-overlay-in fixed inset-0 z-100 flex justify-center bg-black/45 backdrop-blur-[2px]',
        sheetOnMobile ? 'items-end sm:items-center' : 'items-center',
      )}
      onMouseDown={e => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'glass-card gb-modal-in gb-modal-panel flex w-full flex-col overflow-hidden shadow-e4',
          'rounded-2xl',
          sheetOnMobile && 'max-sm:rounded-b-none',
          // 铺满：高度/圆角用工具类（工具类层级高于组件类），头部安全区在 CSS 里补
          fullOnMobile &&
            'gb-modal-panel--full max-sm:h-full max-sm:max-h-none max-sm:rounded-none',
          SIZE[size],
          className,
        )}
        style={width ? { maxWidth: width } : undefined}
      >
        {/* 底部弹出的抓手条：纯装饰，给「可以下滑关闭」的暗示。
            不可关闭（persistent）的弹窗不画它 —— 画了却滑不动更让人困惑。 */}
        {sheetOnMobile && !persistent ? <span aria-hidden className="gb-modal-grabber" /> : null}

        {title || description || icon ? (
          <header className="gb-modal-header flex shrink-0 items-start gap-3 border-b border-divider">
            {icon ? (
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon icon={icon} className="size-4" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
              ) : null}
              {description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="关闭"
              // 手机上给足触摸热区（44px 是通行下限），桌面收回紧凑尺寸
              className="-mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:-mr-1 sm:size-8"
            >
              <Icon icon="lucide:x" className="size-4" />
            </button>
          </header>
        ) : null}

        <div
          className={cn(
            'gb-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain',
            bodyClassName,
          )}
        >
          {children}
        </div>

        {footer ? (
          <footer
            className={cn(
              'gb-modal-footer shrink-0 border-t border-divider bg-surface-2/60',
              footerClassName,
            )}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------------------------------------- 确认对话框 */

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  tone?: 'primary' | 'danger'
  icon?: string
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  tone = 'primary',
  icon,
  loading,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      // 手机上统一走底部弹出：确认类对话框在拇指热区里，够得着
      sheetOnMobile
      title={title}
      description={description}
      icon={icon ?? (tone === 'danger' ? 'lucide:triangle-alert' : 'lucide:circle-help')}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            loading={loading}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </>
      }
    />
  )
}

/** 弹窗底部快捷按钮，统一尺寸 */
export function ModalActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-2 max-sm:w-full', className)}>
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- 侧滑抽屉 */

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  icon?: string
  /** 底部固定操作区 */
  footer?: ReactNode
  /** 侧别，默认右侧 */
  side?: 'right' | 'left'
  /** 宽度预设 */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

const DRAWER_SIZE: Record<NonNullable<DrawerProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-xl',
}

/**
 * 侧滑抽屉。
 * 与 Modal 共用滚动锁与 Esc 语义，差别只在弹出方向与「占满整个视口高度」，
 * 适合承载字段较多的设置表单——纵向空间比对话框充裕得多。
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  icon,
  footer,
  side = 'right',
  size = 'md',
  className,
  bodyClassName,
  children,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const titleId = useId()

  useEffect(() => setMounted(true), [])

  // 同 Modal：onClose 多是内联箭头，放进依赖会让「父组件一渲染就重跑 effect」
  // （反复开关滚动锁 + 把焦点抢到抽屉里第一个可聚焦元素上）。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    lockScroll()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      } else if (e.key === 'Tab') {
        const panel = panelRef.current
        const controls = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (!panel?.contains(document.activeElement) || document.activeElement === panel || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first)?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      unlockScroll()
      previousFocus?.focus({ preventScroll: true })
    }
  }, [open])

  // 焦点只在「打开」那一刻进抽屉，且只认正文里的输入控件（见 Modal 里的同名说明）
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          '[data-autofocus], textarea, input:not([type="hidden"]), select',
        )
        ?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="gb-overlay gb-overlay-in fixed inset-0 z-100 flex p-0 bg-black/45 backdrop-blur-[2px]"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'glass-card flex h-full w-full flex-col overflow-hidden shadow-e4',
          // 手机上本来就是整屏抽屉；桌面才收成一条侧板
          'rounded-none sm:my-3 sm:h-auto sm:max-h-[calc(100dvh-1.5rem)] sm:rounded-2xl',
          side === 'right' ? 'ml-auto sm:mr-3' : 'mr-auto sm:ml-3',
          DRAWER_SIZE[size],
          className,
        )}
      >
        {title || description || icon ? (
          <header className="gb-modal-header flex shrink-0 items-start gap-3 border-b border-divider">
            {icon ? (
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon icon={icon} className="size-4" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 id={titleId} className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
              ) : null}
              {description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="-mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:-mr-1 sm:size-8"
            >
              <Icon icon="lucide:x" className="size-4" />
            </button>
          </header>
        ) : null}

        <div
          className={cn(
            'gb-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain',
            bodyClassName,
          )}
        >
          {children}
        </div>

        {footer ? (
          <footer className="gb-modal-footer shrink-0 border-t border-divider bg-surface-2/60">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

export type ModalButtonProps = ButtonProps
