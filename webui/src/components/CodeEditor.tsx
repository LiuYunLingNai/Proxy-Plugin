/**
 * 代码编辑器 —— textarea + 语法高亮叠加层。
 *
 * 为什么不用 CodeMirror / Monaco：产物是提交进仓库的构建产物，且这里的场景是
 * 「看一眼配置、改两笔」，不需要完整 IDE。所以用经典的「透明 textarea 叠在高亮层上」
 * 方案：光标、选择、输入法、撤销栈全部沿用浏览器原生行为，我们只负责画颜色。
 *
 * 必须保持一致的四个量（否则光标与文字会错位）：
 *   字号 / 行高 24px / 内边距 py-4 px-4 / white-space 与 word-wrap
 * 统一走下面这几个常量，不要在别处硬编码。
 * 字号是响应式的（窄屏 16px、桌面 13px），但**行高恒为 24px**，所以换字号不会错位。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react'
import { Icon } from '@iconify/react'
import { Badge, Button, Checkbox, IconButton, Input, cn } from '../ui'
import { escapeHtml, highlight, hasGrammar, LANGUAGE_LABELS } from '../lib/highlight'

/* ------------------------------------------------------------------ 常量 */

/**
 * 字号在窄屏抬到 16px：iOS Safari 聚焦 font-size < 16px 的输入控件会**自动放大整页**，
 * 编辑器是铺满视口的，一放大底部保存按钮直接飞出屏幕。
 * 行高由 leading-6 锁死 24px（= LINE_PX），所以放大字号**不会**影响
 * 「光标 / 高亮层 / 行号槽」三者按行对齐 —— 它们的位置只由行高决定。
 */
const FONT_CLASS = 'font-mono text-[16px] leading-6 sm:text-[13px]'
const PAD_CLASS = 'px-4 py-4'
/** leading-6 = 1.5rem = 24px，行号槽与滚动定位都依赖它 */
const LINE_PX = 24

/** 超过这个字符数就不再做高亮（只做转义），避免超大日志把主线程卡住 */
const HIGHLIGHT_LIMIT = 300_000
/** 超过这个体积直接只读，避免 textarea 本身卡死 */
const READONLY_LIMIT = 2_000_000

/**
 * 超过这个行数就不再逐行测量折行。测量是 O(行数) 次 Range.getClientRects()，
 * 大文件上每次输入都跑一遍会拖慢打字。超限时退回「一行一个行号」，
 * 代价是开启自动换行后行号会与折行错位 —— 这是刻意的性能取舍。
 */
const MEASURE_LINE_LIMIT = 4000

/** 各语言的行注释符（Ctrl+/ 用） */
const LINE_COMMENT: Record<string, string> = {
  javascript: '//', typescript: '//', java: '//', c: '//', cpp: '//', csharp: '//',
  go: '//', rust: '//', php: '//', dart: '//', swift: '//', scala: '//',
  python: '#', ruby: '#', shell: '#', yaml: '#', toml: '#', ini: '#', r: '#',
  perl: '#', julia: '#', nix: '#', dockerfile: '#', makefile: '#',
  lua: '--', sql: '--',
  batch: 'rem ',
}

/** 这些字符会自动补一个配对的收尾符 */
const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }
/** 这些收尾符在光标右侧已存在时按下去应当「跳过」而不是再插一个 */
const CLOSERS = new Set([')', ']', '}', '"', "'", '`'])
/** 上一行以这些字符结尾时，回车要多缩进一级 */
const INDENT_TRIGGERS = /[{([]$|:\s*$/

/* ------------------------------------------------------------------ 查找替换 */
type Match = { start: number; end: number; line: number }
type FindOptions = { caseSensitive: boolean; regex: boolean; wholeWord: boolean }

function buildRegex(keyword: string, opts: FindOptions): RegExp | null {
  if (!keyword) return null
  let source = opts.regex ? keyword : keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (opts.wholeWord && !opts.regex) source = `\\b${source}\\b`
  try {
    return new RegExp(source, opts.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

function findMatches(text: string, keyword: string, opts: FindOptions): Match[] {
  const re = buildRegex(keyword, opts)
  if (!re) return []
  const out: Match[] = []
  let m: RegExpExecArray | null
  let guard = 0
  let line = 1
  let lineOffset = 0
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    for (; lineOffset < m.index; lineOffset++) {
      if (text[lineOffset] === '\n') line++
    }
    out.push({ start: m.index, end: m.index + m[0].length, line })
    if (++guard > 20000) break
  }
  return out
}

/* ------------------------------------------------------------------ 组件 */

export type CodeEditorProps = {
  value: string
  onChange: (next: string) => void
  onSave?: () => void
  lang: string
  /** 外部传入的只读（例如二进制嗅探判定为不可编辑） */
  readOnly?: boolean
  /** 打开时自动聚焦并定位到第 N 行 */
  initialLine?: number
  ariaLabel?: string
}

export function CodeEditor({ value, onChange, onSave, lang, readOnly = false, initialLine, ariaLabel }: CodeEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const codeRef = useRef<HTMLElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const [showFind, setShowFind] = useState(false)
  const [showGoto, setShowGoto] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [replacement, setReplacement] = useState('')
  const [opts, setOpts] = useState<FindOptions>({ caseSensitive: false, regex: false, wholeWord: false })
  const [matchIndex, setMatchIndex] = useState(0)
  const [cursor, setCursor] = useState({ line: 1, col: 1, selected: 0 })
  const [indentSize, setIndentSize] = useState(2)
  const [useTab, setUseTab] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [notice, setNotice] = useState('')

  // 撤销栈放在 ref 里：改 state 会触发重渲染并把 effect 搅乱
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const lastPushRef = useRef(0)
  const [stackVersion, setStackVersion] = useState(0)
  /**
   * 输入法组合中（拼音 / 日文 / 韩文，也包括不少 IME 的「英文模式」）。
   * 组合期间浏览器的 value 只是输入法缓冲区，不是用户确认过的内容：
   * 此时既不能改文本（见 keyDown 里的提前返回），也不该往撤销栈里压 ——
   * 否则一个中文词会压出十几个「撤销点」。
   */
  const composingRef = useRef(false)

  const tooBigToRead = value.length > READONLY_LIMIT
  const editable = !readOnly && !tooBigToRead
  const highlightOff = value.length > HIGHLIGHT_LIMIT

  const lines = useMemo(() => value.split('\n'), [value])
  const indentUnit = useTab ? '\t' : ' '.repeat(indentSize)

  /* ------------------------------------------------- 折行测量（行号槽对齐用）

   * 行号槽是按「逻辑行」渲染的（一行一个 24px 格子），但正文层开了自动换行后
   * 会把一个逻辑行折成多个视觉行 —— 不测的话，行号从第一个折行处开始就整体错位：
   * 手机上同一逻辑行会被标成 34、35 两行，桌面（不折行）却是 34。
   * 所以这里量出「每个逻辑行实际占几个视觉行」，行号槽按它给高度。
   *
   * 直接量 <pre> 里已经渲染好的文本（不另建镜像 DOM）：
   * Range.getClientRects() 一次返回该行所有视觉行的矩形，按 top 归并即为行数。
   */
  const [rowSpans, setRowSpans] = useState<number[] | null>(null)
  /** 上次测量时的「内容总高 + 逻辑行数」。两者都没变 = 折行方式没变，可跳过逐行测量 */
  const measuredRef = useRef({ height: -1, lines: -1 })

  const measureRowSpans = useCallback(() => {
    const code = codeRef.current
    const pre = preRef.current
    if (!code || !pre) return
    if (!wrap || lines.length > MEASURE_LINE_LIMIT) {
      measuredRef.current = { height: -1, lines: -1 }
      setRowSpans((prev) => (prev === null ? prev : null))
      return
    }
    // 廉价短路：折行方式没变就不用重新逐行量（打字改字符不会改变总高）
    const height = pre.scrollHeight
    if (height === measuredRef.current.height && lines.length === measuredRef.current.lines) return
    measuredRef.current = { height, lines: lines.length }

    // 建「全局字符偏移 → (文本节点, 节点内偏移)」索引，才能按逻辑行取 Range
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    const nodes: Array<{ node: Text; start: number }> = []
    let total = 0
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      nodes.push({ node: n, start: total })
      total += n.data.length
    }
    if (nodes.length === 0) return

    const locate = (offset: number): [Text, number] => {
      let lo = 0
      let hi = nodes.length - 1
      let found = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (nodes[mid].start <= offset) {
          found = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      const hit = nodes[found]
      return [hit.node, Math.min(Math.max(offset - hit.start, 0), hit.node.data.length)]
    }

    const range = document.createRange()
    const spans: number[] = []
    let cursor = 0
    for (const line of lines) {
      const start = cursor
      const end = cursor + line.length
      cursor = end + 1 // 跳过换行符
      // 空行没有文本节点可量，但一定占一个视觉行
      if (line.length === 0) {
        spans.push(1)
        continue
      }
      const [sn, so] = locate(start)
      const [en, eo] = locate(end)
      try {
        range.setStart(sn, so)
        range.setEnd(en, eo)
      } catch {
        spans.push(1)
        continue
      }
      // 同一个视觉行可能被拆成多个 rect（高亮 token 跨 span），按 top 归并
      const rects = range.getClientRects()
      const tops: number[] = []
      for (let i = 0; i < rects.length; i++) {
        const top = rects[i].top
        if (!tops.some((t) => Math.abs(t - top) < 2)) tops.push(top)
      }
      spans.push(Math.max(1, tops.length))
    }
    setRowSpans((prev) =>
      prev && prev.length === spans.length && prev.every((v, i) => v === spans[i]) ? prev : spans,
    )
  }, [lines, wrap])

  const measureRef = useRef(measureRowSpans)
  useEffect(() => {
    measureRef.current = measureRowSpans
  }, [measureRowSpans])

  // 正文 DOM 在这次 commit 里已经换好，这里量才准（在 paint 之前完成，行号不会闪一下）。
  // 依赖只用 measureRowSpans：它随 value / wrap 变化，覆盖了所有会改变折行的情形
  // （lang 只换颜色不换折行，短路掉即可）。
  useLayoutEffect(() => {
    measureRowSpans()
  }, [measureRowSpans])

  // 容器宽度变了折行会变。pre 是 absolute inset-0，改行号槽高度不会反过来触发它
  useEffect(() => {
    const pre = preRef.current
    if (!pre || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      measuredRef.current = { height: -1, lines: -1 }
      measureRef.current()
    })
    ro.observe(pre)
    return () => ro.disconnect()
  }, [])

  /** 每个逻辑行的顶边 y（已计入折行），滚动定位必须用它而不是 lineNo × LINE_PX */
  const lineTops = useMemo(() => {
    const tops = new Array<number>(lines.length)
    let acc = 0
    for (let i = 0; i < lines.length; i++) {
      tops[i] = acc
      acc += (rowSpans?.[i] ?? 1) * LINE_PX
    }
    return tops
  }, [lines.length, rowSpans])

  /** 高亮层 HTML。超大文件退化为纯转义，保证不卡。 */
  const html = useMemo(() => {
    if (highlightOff || !hasGrammar(lang)) return escapeHtml(value)
    return highlight(value, lang)
  }, [value, lang, highlightOff])

  const matches = useMemo(
    () => (showFind ? findMatches(value, keyword, opts) : []),
    [showFind, value, keyword, opts],
  )
  const matchLines = useMemo(() => new Set(matches.map((m) => m.line)), [matches])

  /* ---------------------------------------------------------- 光标 / 滚动 */

  const syncCursor = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const upto = value.slice(0, ta.selectionStart)
    const lastBreak = upto.lastIndexOf('\n')
    setCursor({
      line: upto.split('\n').length,
      col: ta.selectionStart - lastBreak,
      selected: ta.selectionEnd - ta.selectionStart,
    })
  }, [value])

  useEffect(() => {
    syncCursor()
  }, [syncCursor])

  const syncScroll = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop
    }
  }, [])

  const onScroll = (_e: UIEvent<HTMLTextAreaElement>) => syncScroll()

  /** 把光标定位到某行，并让它大致落在视口 1/3 处 */
  const scrollToLine = useCallback((lineNo: number) => {
    const ta = taRef.current
    if (!ta) return
    requestAnimationFrame(() => {
      ta.scrollTop = Math.max(0, (lineTops[lineNo - 1] ?? 0) - ta.clientHeight / 3)
      syncScroll()
    })
  }, [lineTops, syncScroll])

  useEffect(() => {
    const ta = taRef.current
    if (!ta || !initialLine) return
    ta.focus({ preventScroll: true })
    if (initialLine && initialLine > 0) {
      const idx = lines.slice(0, initialLine - 1).join('\n').length + (initialLine > 1 ? 1 : 0)
      ta.setSelectionRange(idx, idx)
      scrollToLine(initialLine)
      syncCursor()
    }
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------------------------------------- 撤销 / 重做 */

  /** 带合并窗口的输入：600ms 内的连续输入合并成一次撤销点 */
  const applyChange = useCallback(
    (next: string) => {
      if (!editable) return
      const now = Date.now()
      // 组合中的中间态不入栈（撤销点由 compositionstart 压一次，见下面的 onCompositionStart）
      if (!composingRef.current && now - lastPushRef.current > 600) {
        undoRef.current.push(value)
        if (undoRef.current.length > 300) undoRef.current.shift()
        redoRef.current = []
        setStackVersion((v) => v + 1)
      }
      lastPushRef.current = now
      onChange(next)
    },
    [onChange, value, editable],
  )

  const doUndo = useCallback(() => {
    if (!editable) return
    const prev = undoRef.current.pop()
    if (prev === undefined) return
    redoRef.current.push(value)
    lastPushRef.current = 0
    setStackVersion((v) => v + 1)
    onChange(prev)
  }, [onChange, value, editable])

  const doRedo = useCallback(() => {
    if (!editable) return
    const next = redoRef.current.pop()
    if (next === undefined) return
    undoRef.current.push(value)
    lastPushRef.current = 0
    setStackVersion((v) => v + 1)
    onChange(next)
  }, [onChange, value, editable])

  const canUndo = undoRef.current.length > 0
  const canRedo = redoRef.current.length > 0
  void stackVersion

  /* ---------------------------------------------------------- 编辑增强 */

  /** 替换选区并恢复光标（必须等 React 把新 value 写回 DOM 之后） */
  const replaceRange = useCallback(
    (start: number, end: number, insert: string, selStart: number, selEnd: number) => {
      applyChange(value.slice(0, start) + insert + value.slice(end))
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (!ta) return
        ta.setSelectionRange(selStart, selEnd)
        syncCursor()
      })
    },
    [applyChange, syncCursor, value],
  )

  /** 选中区域跨多行时，整块缩进/反缩进 */
  const indentBlock = useCallback(
    (outdent: boolean) => {
      const ta = taRef.current
      if (!ta) return
      const { selectionStart: s, selectionEnd: e } = ta
      const blockStart = value.lastIndexOf('\n', s - 1) + 1
      const blockEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e)
      const block = value.slice(blockStart, blockEnd)
      const rows = block.split('\n')
      const next = rows
        .map((row) => {
          if (outdent) {
            if (row.startsWith(indentUnit)) return row.slice(indentUnit.length)
            if (row.startsWith(' ')) return row.replace(/^ {1,4}/, '')
            return row
          }
          return indentUnit + row
        })
        .join('\n')
      const delta = next.length - block.length
      applyChange(value.slice(0, blockStart) + next + value.slice(blockEnd))
      requestAnimationFrame(() => {
        const el = taRef.current
        if (!el) return
        el.setSelectionRange(s + (outdent ? Math.max(delta, -(e - s)) : indentUnit.length), e + delta)
        syncCursor()
      })
    },
    [applyChange, indentUnit, syncCursor, value],
  )

  /** Ctrl+/ 用行注释符切换注释（整块操作，所有行都加或都去） */
  const toggleComment = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const marker = LINE_COMMENT[lang] ?? '//'
    const { selectionStart: s, selectionEnd: e } = ta
    const blockStart = value.lastIndexOf('\n', s - 1) + 1
    const found = value.indexOf('\n', e)
    const blockEnd = found === -1 ? value.length : found
    const rows = value.slice(blockStart, blockEnd).split('\n')
    const meaningful = rows.filter((r) => r.trim().length > 0)
    const allCommented = meaningful.length > 0 && meaningful.every((r) => r.trimStart().startsWith(marker.trim()))
    const next = rows
      .map((row) => {
        if (allCommented) {
          const idx = row.indexOf(marker.trim())
          const afterMarker = idx + marker.trim().length
          return idx === -1 ? row : row.slice(0, idx) + row.slice(afterMarker + (row[afterMarker] === ' ' ? 1 : 0))
        }
        if (row.trim().length === 0) return row
        const indent = row.match(/^\s*/)?.[0] ?? ''
        return `${indent}${marker.trim()} ${row.slice(indent.length)}`
      })
      .join('\n')
    applyChange(value.slice(0, blockStart) + next + value.slice(blockEnd))
    requestAnimationFrame(() => {
      taRef.current?.setSelectionRange(blockStart, blockStart + next.length)
    })
  }, [applyChange, lang, value])

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey
    const ta = e.currentTarget

    /**
     * —— 输入法组合态：什么都不做，直接放行。
     *
     * 组合期间 `value` 里躺着的是输入法缓冲区（拼音字母 / 候选），回车是「上屏」、
     * 空格是「选字」、Tab 是「翻页」—— 它们都只是输入法的内部按键。
     * 这里的自动配对 / Tab 缩进 / 回车缩进一旦 `preventDefault()` 并自行改写文本，
     * 就会把正在组合的内容冲掉，还会让输入法卡在组合态：之后敲的字母全被吞进
     * 不可见的缓冲区，表现为「打不出英文和标点，必须先用鼠标点一下编辑区才能继续」。
     * （`keyCode === 229` 是部分 IME 只更新 keyCode、不打 isComposing 的兼容路径。）
     * 编辑器里组合态的判定标准动作就是「整体让路」，CodeMirror / Monaco 同样处理。
     */
    if (e.nativeEvent.isComposing || e.keyCode === 229) return

    // —— 快捷键
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (editable) onSave?.()
      return
    }
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      setShowFind(true)
      return
    }
    if (mod && e.key.toLowerCase() === 'h') {
      e.preventDefault()
      setShowFind(true)
      return
    }
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      setShowGoto(true)
      return
    }
    if (mod && e.key === '/') {
      e.preventDefault()
      if (editable) toggleComment()
      return
    }
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault()
      doUndo()
      return
    }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault()
      doRedo()
      return
    }

    if (!editable) return

    // —— 自动配对
    if (PAIRS[e.key] || CLOSERS.has(e.key)) {
      const { selectionStart: s, selectionEnd: end } = ta
      // 右半边已在光标右侧 → 跳过它，不再插入
      if (CLOSERS.has(e.key) && value[s] === e.key && s === end) {
        e.preventDefault()
        ta.setSelectionRange(s + 1, s + 1)
        syncCursor()
        return
      }
      if (PAIRS[e.key]) {
        e.preventDefault()
        if (s !== end) {
          // 有选区 → 包裹
          replaceRange(s, end, e.key + value.slice(s, end) + PAIRS[e.key], s + 1, end + 1)
        } else {
          replaceRange(s, s, e.key + PAIRS[e.key], s + 1, s + 1)
        }
        return
      }
    }

    // —— Tab / Shift+Tab
    if (e.key === 'Tab') {
      e.preventDefault()
      const { selectionStart: s, selectionEnd: end } = ta
      const multiLine = value.slice(s, end).includes('\n')
      if (multiLine) {
        indentBlock(e.shiftKey)
      } else if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', s - 1) + 1
        const prefix = value.slice(lineStart, s)
        const removable = indentUnit === '\t' ? (prefix.startsWith('\t') ? 1 : 0) : Math.min(indentSize, prefix.match(/ *$/)?.[0].length ?? 0)
        if (removable > 0) replaceRange(s - removable, s, '', s - removable, s - removable)
      } else {
        replaceRange(s, end, indentUnit, s + indentUnit.length, s + indentUnit.length)
      }
      return
    }

    // —— 回车自动缩进
    if (e.key === 'Enter') {
      const { selectionStart: s, selectionEnd: end } = ta
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const currentLine = value.slice(lineStart, s)
      const indent = currentLine.match(/^\s*/)?.[0] ?? ''
      const opensBlock = INDENT_TRIGGERS.test(currentLine.trimEnd())
      const nextIndent = opensBlock ? indent + indentUnit : indent
      // 光标正好夹在成对括号中间时，回车应当「展开」而不是平铺
      const between = /[({[]$/.test(currentLine) && /^\s*[)\]}[\]]/.test(value.slice(s))
      e.preventDefault()
      if (between) {
        const inner = indent + indentUnit
        replaceRange(s, end, `\n${inner}\n${indent}`, s + 1 + inner.length, s + 1 + inner.length)
      } else {
        replaceRange(s, end, `\n${nextIndent}`, s + 1 + nextIndent.length, s + 1 + nextIndent.length)
      }
      return
    }
  }

  const onChangeText = (e: ChangeEvent<HTMLTextAreaElement>) => {
    applyChange(e.target.value)
    // onChange 之后再读 selectionStart 才准
    requestAnimationFrame(syncCursor)
  }

  /* ---------------------------------------------------------- 查找操作 */

  const focusMatch = useCallback(
    (index: number, focusEditor = true) => {
      const ta = taRef.current
      if (!ta || matches.length === 0) return
      const safe = ((index % matches.length) + matches.length) % matches.length
      const m = matches[safe]
      setMatchIndex(safe)
      if (focusEditor) ta.focus({ preventScroll: true })
      ta.setSelectionRange(m.start, m.end)
      scrollToLine(m.line)
      syncCursor()
    },
    [matches, scrollToLine, syncCursor],
  )

  const replaceCurrent = () => {
    const ta = taRef.current
    if (!ta || matches.length === 0) return
    const m = matches[matchIndex] ?? matches[0]
    replaceRange(m.start, m.end, replacement, m.start + replacement.length, m.start + replacement.length)
    setNotice(`已替换 1 处`)
  }

  const replaceAll = () => {
    if (matches.length === 0) return
    // 从后往前替换，前面的下标才不会失效
    let out = value
    for (let i = matches.length - 1; i >= 0; i--) {
      out = out.slice(0, matches[i].start) + replacement + out.slice(matches[i].end)
    }
    applyChange(out)
    setNotice(`已替换 ${matches.length} 处`)
  }

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 1800)
    return () => clearTimeout(t)
  }, [notice])

  // 查找词变化时回到第一个匹配
  useEffect(() => {
    if (showFind && matches.length > 0) focusMatch(0, false)
    else setMatchIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, opts.caseSensitive, opts.regex, opts.wholeWord])

  const gutterWidth = Math.max(46, String(lines.length).length * 9 + 24)
  const wrapClass = wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {showFind ? (
        <div className="shrink-0 border-b border-divider bg-card px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                // 输入法组合中的回车 = 「上屏」，不是「跳到下一个匹配」（同 keyDown 里的说明）
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') focusMatch(e.shiftKey ? matchIndex - 1 : matchIndex + 1)
                if (e.key === 'Escape') setShowFind(false)
              }}
              icon="lucide:search"
              aria-label="查找配置内容"
              placeholder="查找…（Enter 下一个 / Shift+Enter 上一个）"
              className="w-full font-mono text-xs sm:w-72"
            />
            <Badge tone={matches.length > 0 ? 'info' : 'warning'}>
              {keyword ? (matches.length > 0 ? `${matchIndex + 1} / ${matches.length}` : '无匹配') : '—'}
            </Badge>
            <IconButton size="icon-sm" label="上一个" icon="lucide:chevron-up" disabled={matches.length === 0} onClick={() => focusMatch(matchIndex - 1)} />
            <IconButton size="icon-sm" label="下一个" icon="lucide:chevron-down" disabled={matches.length === 0} onClick={() => focusMatch(matchIndex + 1)} />
            <Checkbox checked={opts.caseSensitive} onChange={(e) => setOpts((o) => ({ ...o, caseSensitive: e.target.checked }))} label="区分大小写" />
            <Checkbox checked={opts.wholeWord} onChange={(e) => setOpts((o) => ({ ...o, wholeWord: e.target.checked }))} label="全词" />
            <Checkbox checked={opts.regex} onChange={(e) => setOpts((o) => ({ ...o, regex: e.target.checked }))} label="正则" />
            <div className="ml-auto flex items-center gap-1">
              {notice ? <Badge tone="success">{notice}</Badge> : null}
              <IconButton size="icon-sm" label="关闭查找" icon="lucide:x" onClick={() => setShowFind(false)} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              icon="lucide:replace"
              aria-label="替换配置内容"
              placeholder="替换为…"
              className="w-full font-mono text-xs sm:w-72"
            />
            <Button size="xs" variant="secondary" disabled={!editable || matches.length === 0} onClick={replaceCurrent}>
              替换
            </Button>
            <Button size="xs" variant="soft" disabled={!editable || matches.length === 0} onClick={replaceAll}>
              全部替换（{matches.length}）
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 行号槽 */}
        <div
          ref={gutterRef}
          aria-hidden
          style={{ width: gutterWidth }}
          className="shrink-0 select-none overflow-hidden border-r border-divider bg-surface-3"
        >
          <div className={cn(PAD_CLASS)}>
            {lines.map((_, i) => {
              const isCurrent = cursor.line === i + 1
              const hit = matchLines.has(i + 1)
              // 折行时一个逻辑行占多个视觉行：格子跟着变高，数字仍落在第一行
              const rows = wrap ? (rowSpans?.[i] ?? 1) : 1
              return (
                <div
                  key={i}
                  style={{ height: LINE_PX * rows, lineHeight: `${LINE_PX}px` }}
                  className={cn(
                    'pr-3 text-right font-mono text-xs',
                    isCurrent
                      ? 'bg-primary-soft font-medium text-primary'
                      : hit
                        ? 'bg-warning-soft text-warning'
                        : 'text-muted-foreground/60',
                  )}
                >
                  {i + 1}
                </div>
              )
            })}
          </div>
        </div>

        {/* 编辑区：高亮层垫底，透明 textarea 在上 */}
        <div className="relative min-w-0 flex-1">
          <pre
            ref={preRef}
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 m-0 overflow-hidden text-foreground',
              FONT_CLASS,
              PAD_CLASS,
              wrapClass,
            )}
          >
            <code ref={codeRef} dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
          <textarea
            ref={taRef}
            value={value}
            onChange={onChangeText}
            onKeyDown={keyDown}
            onScroll={onScroll}
            onSelect={syncCursor}
            onClick={syncCursor}
            onKeyUp={syncCursor}
            // 组合期不做任何文本改写（见 keyDown 的提前返回）；撤销点上给整个词压一次，
            // 而不是给每个拼音字母压一次
            onCompositionStart={() => {
              composingRef.current = true
              undoRef.current.push(value)
              if (undoRef.current.length > 300) undoRef.current.shift()
              redoRef.current = []
              setStackVersion((v) => v + 1)
            }}
            onCompositionEnd={() => {
              composingRef.current = false
              // 归零合并窗口：上屏之后敲的字符单独算一步撤销，别和刚打好的词粘在一起
              lastPushRef.current = 0
            }}
            readOnly={!editable}
            spellCheck={false}
            wrap={wrap ? 'soft' : 'off'}
            style={{ tabSize: useTab ? undefined : indentSize }}
            className={cn(
              'absolute inset-0 size-full resize-none overflow-auto border-0 bg-transparent',
              'text-transparent caret-primary outline-none selection:bg-primary/25',
              FONT_CLASS,
              PAD_CLASS,
              wrapClass,
              !editable && 'cursor-not-allowed',
            )}
            aria-label={ariaLabel ?? `代码编辑器（${LANGUAGE_LABELS[lang] ?? lang}）`}
            placeholder={editable ? '' : '该文件已开启只读（体积过大或类型不可编辑）'}
          />

          {showGoto ? (
            <div className="absolute right-4 top-3 z-20 flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 shadow-e3">
              <Icon icon="lucide:corner-down-right" className="size-3.5 text-muted-foreground" />
              <input
                autoFocus
                type="number"
                min={1}
                max={lines.length}
                defaultValue={cursor.line}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowGoto(false)
                    taRef.current?.focus()
                  }
                  if (e.key === 'Enter') {
                    const n = Math.min(Math.max(1, Number(e.currentTarget.value) || 1), lines.length)
                    const idx = lines.slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0)
                    const ta = taRef.current
                    if (ta) {
                      ta.focus()
                      ta.setSelectionRange(idx, idx)
                      scrollToLine(n)
                      syncCursor()
                    }
                    setShowGoto(false)
                  }
                }}
                className="w-20 bg-transparent font-mono text-xs text-foreground outline-none"
                placeholder="行号"
                aria-label="跳转行号"
              />
              <span className="font-mono text-2xs text-muted-foreground">/ {lines.length}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* 状态栏：窄屏只留光标位置与操作按钮，语言/字符数这类信息让位给编辑区高度 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-divider bg-surface-2/60 px-2 py-1 text-2xs text-muted-foreground sm:px-3 sm:py-1.5">
        <span className="font-mono">
          行 <span className="text-foreground">{cursor.line}</span> / 列{' '}
          <span className="text-foreground">{cursor.col}</span>
          {cursor.selected > 0 ? ` · 选中 ${cursor.selected}` : ''}
        </span>
        <span className="hidden font-mono sm:inline">{LANGUAGE_LABELS[lang] ?? lang}</span>
        <span className="hidden font-mono sm:inline">{value.length.toLocaleString()} 字符</span>
        {highlightOff ? <span className="text-warning">文件过大，已关闭语法高亮</span> : null}
        {tooBigToRead ? <span className="text-warning">文件过大，已切换为只读</span> : null}

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {/* 缩进方式属于「设一次就不动」的偏好，手机上收起来 */}
          <button
            type="button"
            onClick={() => setUseTab((v) => !v)}
            className="hidden rounded px-1.5 py-0.5 font-mono transition-colors hover:bg-surface-3 hover:text-foreground sm:inline"
            title="切换缩进方式"
          >
            {useTab ? 'Tab' : `空格 × ${indentSize}`}
          </button>
          {!useTab ? (
            <button
              type="button"
              onClick={() => setIndentSize((n) => (n === 2 ? 4 : n === 4 ? 8 : 2))}
              className="hidden rounded px-1.5 py-0.5 transition-colors hover:bg-surface-3 hover:text-foreground sm:inline"
              title="切换缩进宽度"
            >
              {indentSize}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-surface-3 hover:text-foreground"
            title="切换自动换行"
          >
            {wrap ? '自动换行' : '不换行'}
          </button>
          <span className="flex items-center gap-0.5">
            <IconButton size="icon-sm" label="撤销 (Ctrl+Z)" icon="lucide:undo-2" disabled={!canUndo || !editable} onClick={doUndo} />
            <IconButton size="icon-sm" label="重做 (Ctrl+Y)" icon="lucide:redo-2" disabled={!canRedo || !editable} onClick={doRedo} />
            <IconButton size="icon-sm" label="查找替换 (Ctrl+F)" icon="lucide:search" onClick={() => setShowFind((v) => !v)} />
            <IconButton size="icon-sm" label="跳转到行 (Ctrl+G)" icon="lucide:corner-down-right" onClick={() => setShowGoto((v) => !v)} />
          </span>
        </div>
      </div>
    </div>
  )
}
