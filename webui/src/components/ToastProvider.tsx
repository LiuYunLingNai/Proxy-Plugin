/**
 * 全局提示（toast）状态容器。
 *
 * 只负责「有哪些提示、什么时候消失」，**不渲染任何东西**——渲染交给 `ToastContainer`。
 * 这样把状态与视图拆开，`ToastContainer` 可以自由换版式而不影响调用方。
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  type: ToastType
  message: string
  /** 毫秒；`0` 表示不自动消失 */
  duration?: number
}

export interface ToastContextValue {
  toasts: Toast[]
  showToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timerMap = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  // 提示 id 用单调递增计数：比 `Date.now() + Math.random()` 更短、且绝无碰撞。
  // 放在 ref 里而不是模块级变量：在渲染期之外自增，React 编译器才能优化本组件
  const seqRef = useRef(0)

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timerMap.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timerMap.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (type: ToastType, message: string, duration = 3000) => {
      const id = (seqRef.current += 1)
      setToasts(prev => [...prev, { id, type, message, duration }])
      if (duration > 0) {
        timerMap.current.set(
          id,
          setTimeout(() => removeToast(id), duration),
        )
      }
    },
    [removeToast],
  )

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用')
  return ctx
}
