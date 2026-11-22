/**
 * 下拉选择器（自定义弹层）。
 *
 * 为什么不直接用原生 `<select>`：它的**候选项列表由操作系统渲染**，
 * CSS 完全管不到 —— 高亮条是系统灰、浮层是系统白，在深色主题下还会白闪，
 * 与设计系统格格不入。
 *
 * 这里用 button + portal 弹层自己画一份，因此：
 * - 配色/圆角/阴影/动效全部走 token，深浅色自动一致；
 * - 弹层挂在 body 上并用 fixed 定位，塞进 Card / Modal / Drawer 都不会被裁切或压住；
 * - 空间不够时自动向上翻转；
 * - 键盘可达：↑↓ / Home / End / Enter / Esc / Tab，并带首字母快速定位。
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'
import { cn } from './cn'

export interface SelectOption {
  value: string
  label: ReactNode
  /** 右侧灰色副标题，例如适配器类型 */
  hint?: ReactNode
  disabled?: boolean
}

export interface SelectMenuProps {
  id?: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** 触发器前置图标 */
  icon?: string
  /** value 为空时的占位文案 */
  placeholder?: string
  /** 弹层水平对齐锚点，默认左对齐 */
  align?: 'left' | 'right'
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
  /** 无候选项时的提示 */
  emptyText?: string
  ariaLabel?: string
}

/** 触发器尺寸：sm 用于分页栏这类紧凑场景 */
const SIZE_CLASS: Record<NonNullable<SelectMenuProps['size']>, string> = {
  sm: 'h-7 w-auto gap-1 pr-1.5 pl-1.5 text-xs',
  md: 'h-9 w-full gap-2 pr-2 pl-3 text-sm',
}

const GAP = 6
const MAX_LIST_H = 272
/** 弹层与视口边缘的最小留白：手机上不留白会贴死边框，甚至被刘海遮住 */
const VIEWPORT_MARGIN = 8

interface LayerStyle {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

export function SelectMenu({
  value,
  onChange,
  options,
  icon,
  placeholder = '请选择',
  align = 'left',
  size = 'md',
  className,
  disabled,
  emptyText = '暂无可选项',
  ariaLabel,
  id,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false)
  const [layer, setLayer] = useState<LayerStyle | null>(null)
  /** 键盘高亮项（与「已选中项」是两个概念） */
  const [active, setActive] = useState(0)
  const [mounted, setMounted] = useState(false)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeBuffer = useRef({ text: '', at: 0 })
  const listId = useId()

  useEffect(() => setMounted(true), [])

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  /** 可键盘停留的下标（跳过 disabled） */
  const step = useCallback(
    (from: number, dir: 1 | -1) => {
      const n = options.length
      if (!n) return -1
      let i = from
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n
        if (!options[i]?.disabled) return i
      }
      return from
    },
    [options],
  )

  /** 测量触发器与弹层，决定朝上还是朝下，并把弹层钳制在视口内 */
  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const maxWidth = Math.max(120, vw - VIEWPORT_MARGIN * 2)
    // 触发器多宽，弹层就多宽（但绝不超过视口）；内容更长时靠 maxWidth 触发内部截断
    const width = Math.min(Math.max(r.width, 120), maxWidth)
    const listH = Math.min(listRef.current?.offsetHeight ?? MAX_LIST_H, MAX_LIST_H)
    const below = vh - r.bottom - GAP
    const above = r.top - GAP
    const up = below < listH && above > below

    // 一律改用 left 定位（原来的 right 锚点算不出钳制后的位置）
    const rawLeft = align === 'right' ? r.right - width : r.left
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, vw - VIEWPORT_MARGIN - width))

    setLayer({
      left,
      top: up ? undefined : r.bottom + GAP,
      bottom: up ? vh - r.top + GAP : undefined,
      width,
      // 竖屏矮手机上 272px 可能比可视高度还大
      maxHeight: Math.max(0, Math.min(MAX_LIST_H, (up ? above : below) - VIEWPORT_MARGIN)),
    })
  }, [align])

  // 打开时定位；期间跟随滚动 / 尺寸变化（capture 才能捕获内部滚动容器）
  useEffect(() => {
    if (!open) return
    place()
    // 二次测量：首帧拿到列表真实高度后再决定翻转，避免边缘抖动
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  // 点外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 高亮项滚进可视区
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openMenu = (dir: 1 | -1 = 1) => {
    if (disabled) return
    const start = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : step(-1, dir)
    setActive(start < 0 ? 0 : start)
    setOpen(true)
  }

  const commit = (v: string) => {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu(e.key === 'ArrowUp' ? -1 : 1)
      }
      return
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        e.stopPropagation() // 别把 Modal 一起关掉
        setOpen(false)
        return
      case 'Tab':
        setOpen(false)
        return
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => step(i, 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => step(i, -1))
        return
      case 'Home':
        e.preventDefault()
        setActive(step(-1, 1))
        return
      case 'End':
        e.preventDefault()
        setActive(step(options.length, -1))
        return
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const opt = options[active]
        if (opt && !opt.disabled) commit(opt.value)
        return
      }
      default:
        break
    }

    // 首字母快速定位（连续按键 600ms 内累积成前缀）
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      const buf = now - typeBuffer.current.at < 600 ? typeBuffer.current.text + e.key : e.key
      typeBuffer.current = { text: buf, at: now }
      const lower = buf.toLowerCase()
      const hit = options.findIndex(
        (o) => !o.disabled && typeof o.label === 'string' && o.label.toLowerCase().startsWith(lower),
      )
      if (hit >= 0) setActive(hit)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'gb-input flex items-center',
          SIZE_CLASS[size],
          'disabled:cursor-not-allowed',
          className,
        )}
      >
        {icon ? <Icon icon={icon} className="size-4 shrink-0 text-muted-foreground/70" /> : null}
        <span className={cn('min-w-0 flex-1 truncate text-left', !selected && 'text-muted-foreground/70')}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          icon="lucide:chevron-down"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {mounted && open && layer
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              aria-labelledby={!ariaLabel ? id : undefined}
              tabIndex={-1}
              style={{
                left: layer.left,
                top: layer.top,
                bottom: layer.bottom,
                width: layer.width,
                maxHeight: layer.maxHeight,
              }}
              className="gb-modal-in fixed z-120 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 shadow-e4"
            >
              {options.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
              ) : (
                options.map((opt, i) => {
                  const isSelected = opt.value === value
                  const isActive = i === active
                  return (
                    <div
                      key={opt.value}
                      id={`${listId}-${i}`}
                      data-idx={i}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={opt.disabled || undefined}
                      onMouseEnter={() => !opt.disabled && setActive(i)}
                      onClick={() => !opt.disabled && commit(opt.value)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                        opt.disabled && 'pointer-events-none opacity-45',
                        isActive && !opt.disabled && 'bg-surface-2',
                        isSelected ? 'font-medium text-primary' : 'text-foreground',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {opt.hint ? (
                        <span className="shrink-0 text-2xs text-muted-foreground">{opt.hint}</span>
                      ) : null}
                      <Icon
                        icon="lucide:check"
                        className={cn('size-4 shrink-0 text-primary', !isSelected && 'invisible')}
                      />
                    </div>
                  )
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
