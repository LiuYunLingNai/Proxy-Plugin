import { useEffect } from 'react'
import { Icon, loadIcons } from '@iconify/react'
import { cn } from '../ui'

/** iconify 名称形如 `lucide:blocks`、`mdi:stove`；其余（emoji、普通字符）按字面量渲染 */
const ICONIFY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i

/** 判断是否为 iconify 图标名（供需要区分「图标名」与「字面量」的地方复用） */
export function isIconifyName(icon?: string): boolean {
  return typeof icon === 'string' && ICONIFY_RE.test(icon.trim())
}

/** 已提示过的失效图标，避免同一会话里反复刷屏 */
const warnedIcons = new Set<string>()

/**
 * 图标名不存在时，Iconify 既不抛错也不走 onLoad，只会渲染成一个**空 span**，
 * 界面上就表现为「这一项没有图标」——排查成本很高。
 * （实例：`carbon:database` 看着完全合理，但 carbon 集里只有 `database-redis` 之类。）
 * 这里在名称确实缺失时打一条日志，直接给出「哪个名字错了」，把静默失败变成可排查问题。
 */
function useMissingIconWarning(icon: string | undefined): void {
  useEffect(() => {
    if (!icon || !isIconifyName(icon)) return
    loadIcons([icon], (_loaded, missing) => {
      if (!missing.length || warnedIcons.has(icon)) return
      warnedIcons.add(icon)
      console.warn(
        `[guoba] 图标 "${icon}" 在 Iconify 中不存在，界面会渲染为空白：请检查图标名拼写（可在 https://icon-sets.iconify.design 搜索）。`,
      )
    })
  }, [icon])
}

/**
 * 菜单 / 标题图标。
 *
 * 插件自定义页面（扩展页面）的描述符里 `icon` 允许写任意 emoji，
 * 因此这里对「图标名」与「字面量」分别渲染：
 * - `lucide:blocks` 这类 iconify 名 → 交给 `@iconify/react`；
 * - `📊` 这类 emoji / 文本 → 直接作为文本渲染，避免 iconify 解析失败显示空白。
 */
export function MenuIcon({
  icon,
  className,
  title,
}: {
  icon?: string
  className?: string
  title?: string
}) {
  useMissingIconWarning(icon)

  if (!icon) {
    return <span className={className} />
  }
  if (!isIconifyName(icon)) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center overflow-hidden leading-none',
          className,
        )}
        title={title}
        aria-hidden
      >
        {icon}
      </span>
    )
  }
  return <Icon icon={icon} className={className} />
}
