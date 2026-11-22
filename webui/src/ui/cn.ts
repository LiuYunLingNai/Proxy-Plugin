/**
 * 轻量类名合并工具（等价于 clsx，无额外依赖）。
 * 支持字符串、数字、数组、以及 { className: boolean } 对象形式。
 * 布尔值 / bigint 等非类名值会被忽略，因此 `cond && 'foo'` 可直接传入。
 */
export type ClassValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []

  const walk = (value: ClassValue) => {
    if (value === null || value === undefined || value === false || value === true) return

    if (typeof value === 'string') {
      if (value) out.push(value)
      return
    }

    if (typeof value === 'number') {
      if (Number.isFinite(value)) out.push(String(value))
      return
    }

    if (typeof value === 'bigint') return

    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }

    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) out.push(key)
    }
  }

  for (const input of inputs) walk(input)
  return out.join(' ')
}
