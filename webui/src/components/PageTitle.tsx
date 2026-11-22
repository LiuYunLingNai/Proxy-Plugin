import type { ReactNode } from 'react'
import { cn } from '../ui/cn'
import { MenuIcon } from './MenuIcon'

const PAGE_ICON_MAP: Record<string, string> = {
  欢迎回来: 'lucide:home',
  更新管理: 'lucide:refresh-cw',
  配置管理: 'lucide:sliders-horizontal',
  日志查看: 'lucide:scroll-text',
  插件商城: 'lucide:store',
  插件配置: 'lucide:puzzle',
  数据看板: 'lucide:chart-column',
  数据管理: 'lucide:database',
  编辑喵喵帮助: 'lucide:book-open',
  主题设置: 'lucide:palette',
  关于: 'lucide:info',
  账号管理: 'lucide:user-cog',
  安全中心: 'lucide:shield-check',
  沙盒测试: 'lucide:flask-conical',
  文件管理: 'lucide:folder-tree',
  垃圾清理: 'lucide:trash-2',
  备份还原: 'lucide:archive-restore',
}

export interface PageTitleProps {
  children: ReactNode
  icon?: string
  iconColor?: string
  iconPath?: string
  /** 标题下方的补充说明 */
  description?: ReactNode
  /** 右上角操作区 */
  actions?: ReactNode
  className?: string
}

/**
 * 页面标题区。
 * 采用「图标胶囊 + 标题 / 描述 + 右侧操作」的三段式结构，
 * 让每个页面在视觉上拥有一致的入口层级。
 */
export function PageTitle({
  children,
  icon,
  iconColor,
  iconPath,
  description,
  actions,
  className,
}: PageTitleProps) {
  const title = String(children ?? '')
  const resolvedIcon = icon ?? PAGE_ICON_MAP[title]

  return (
    <header className={cn('mb-5 flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {iconPath ? (
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-card shadow-e1">
            <img src={iconPath} alt="" className="size-6 object-contain" />
          </span>
        ) : resolvedIcon ? (
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary-soft text-primary"
            style={iconColor ? { color: iconColor } : undefined}
          >
            <MenuIcon icon={resolvedIcon} className="size-5" />
          </span>
        ) : null}

        <div className="min-w-0">
          <h1 className="gb-page-title truncate">{children}</h1>
          {/* 手机上说明文字改两行截断：一句话被切成「…」等于没写，
              而这一行往往是「这页怎么用」的唯一说明 */}
          {description ? (
            <p className="gb-page-sub sm:truncate max-sm:line-clamp-2">{description}</p>
          ) : null}
        </div>
      </div>

      {/*
        操作区：桌面上不可压缩地跟在标题右侧；手机上必须让它换行。
        原先这里是 shrink-0 —— flex-shrink:0 让容器宽度恒等于内容宽度，
        内部的 flex-wrap 永远等不到「宽度不够」，于是按钮整排顶出屏幕：
        实测 390px 宽时页面横向溢出 39px，最右边的「保存」直接被切掉。
      */}
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:shrink max-sm:justify-start">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
