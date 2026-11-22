import { Icon } from '@iconify/react'
import { useToast, type Toast } from './ToastProvider'
import { cn } from '../ui/cn'

type ToastTone = {
  icon: string
  label: string
  ring: string
  bar: string
  iconColor: string
}

const TONES: Record<string, ToastTone> = {
  success: {
    icon: 'lucide:circle-check',
    label: '成功',
    ring: 'border-success/25 bg-success-soft',
    bar: 'bg-success',
    iconColor: 'text-success',
  },
  error: {
    icon: 'lucide:circle-x',
    label: '错误',
    ring: 'border-destructive/25 bg-destructive-soft',
    bar: 'bg-destructive',
    iconColor: 'text-destructive',
  },
  warning: {
    icon: 'lucide:triangle-alert',
    label: '警告',
    ring: 'border-warning/25 bg-warning-soft',
    bar: 'bg-warning',
    iconColor: 'text-warning',
  },
  info: {
    icon: 'lucide:info',
    label: '提示',
    ring: 'border-info/25 bg-info-soft',
    bar: 'bg-info',
    iconColor: 'text-info',
  },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const tone = TONES[toast.type as string] ?? TONES.info

  return (
    <div
      role="status"
      className="glass-card w-full overflow-hidden p-0 shadow-e3 sm:w-[min(22rem,calc(100vw-2rem))]"
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg border',
            tone.ring,
          )}
        >
          <Icon icon={tone.icon} className={cn('size-4', tone.iconColor)} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tone.label}
            </span>
          </div>
          <p className="mt-0.5 break-words text-sm leading-relaxed text-foreground">
            {toast.message}
          </p>
        </div>

        <button
          type="button"
          aria-label="关闭提示"
          onClick={() => onDismiss(toast.id)}
          className="-mr-0.5 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Icon icon="lucide:x" className="size-3.5" />
        </button>
      </div>

      {toast.duration && toast.duration > 0 ? (
        <div className="h-0.5 w-full overflow-hidden bg-muted">
          <div
            className={cn('h-full animate-toast-progress', tone.bar)}
            style={{ animationDuration: `${toast.duration}ms` }}
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * 全局提示容器。
 * 位置固定在右下角堆叠，避免与顶部工具条、命令面板发生遮挡。
 */
export function ToastContainer() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 left-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-9999 flex flex-col-reverse gap-2.5 sm:right-4 sm:left-auto sm:bottom-4">
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto animate-slide-in">
          <ToastItem toast={toast} onDismiss={removeToast} />
        </div>
      ))}
    </div>
  )
}
