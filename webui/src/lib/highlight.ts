/**
 * 轻量语法高亮器 —— **零依赖**（不引 highlight.js / Prism / CodeMirror）。
 *
 * 设计取向：文件管理器里的编辑器只是「看一眼、改两笔」，不需要完整词法分析。
 * 所以用一组 sticky 正则按优先级扫描，命中即产出 `<span class="hl-xxx">`。
 * 每条语法末尾都有单字符兜底规则，保证主循环的迭代次数等于 token 数而不是字符数，
 * 因此大文件也不会退化成逐字符慢扫。
 *
 * 输出的是 HTML 字符串，供编辑器叠加层用 `<pre>` 渲染。
 * token 配色在 `src/index.css` 里以 `--hl-*` 变量定义，跟随明暗主题。
 *
 * 本文件零依赖、纯函数，可被 Node 直接加载做回归（见 `.preview/check-highlight.mjs`）。
 */

export type TokenClass =
  | 'hl-comment'
  | 'hl-string'
  | 'hl-number'
  | 'hl-keyword'
  | 'hl-builtin'
  | 'hl-func'
  | 'hl-tag'
  | 'hl-attr'
  | 'hl-punct'
  | 'hl-meta'

type Rule = { cls: TokenClass | null; re: RegExp }

/** 生成一条 sticky 规则（sticky 保证「只在当前位置」匹配，扫描必须靠它） */
function R(cls: TokenClass | null, source: string, flags = ''): Rule {
  return { cls, re: new RegExp(source, `${flags}y`) }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** 高亮层是 `<pre>` 里的文本节点，只需转义 & < > */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c)
}

/* ------------------------------------------------------------------ 关键字表 */

/** 关键字用空格分隔的紧凑写法，取值时再 split */
const KEYWORDS: Record<string, string> = {
  javascript:
    'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch this throw try typeof var void while with yield enum type declare readonly namespace abstract',
  typescript:
    'as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let namespace new of package private protected public readonly return satisfies set static super switch this throw try type typeof var void while with yield abstract any boolean number object string symbol unknown never',
  python:
    'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls None True False',
  go:
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 string bool byte rune error any make new len cap append copy delete panic recover',
  rust:
    'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while Some None Ok Err true false',
  java:
    'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits true false null',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while NULL true false',
  cpp:
    'alignas alignof auto break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator override private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while true false',
  csharp:
    'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield',
  php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null',
  ruby:
    'alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require attr_accessor attr_reader attr_writer puts',
  shell:
    'if then else elif fi case esac for while until do done in function return exit break continue local export readonly declare unset shift source alias echo set eval exec trap test',
  batch:
    'if else for in do goto call set echo off on errorlevel exist not defined rem pause exit copy move del md rd cd dir type rem start',
  powershell:
    'function param if else elseif foreach for while do switch return break continue try catch finally throw begin process end filter class enum using namespace trap exit echo write-host set new',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while self require print pairs ipairs',
  perl: 'and cmp continue do else elsif eq for foreach ge given goto grep gt if last le local lt m map my ne next no not or our package print q qq qr qw qx redo require return say sort split state sub tr unless until use when while xor',
  r: 'break else FALSE for function if Inf NA NaN next NULL repeat return TRUE while library require print c list data.frame',
  dart: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield',
  swift:
    'associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator override private protocol public repeat rethrows return self static struct subscript super switch throw throws true try typealias var where while any some',
  scala: 'abstract case catch class def do else extends false final finally for forSome if implicit import lazy match new null object override package private protected return sealed super this throw trait try true type val var while with yield given using enum export',
  julia: 'abstract type baremodule begin break catch const continue do else elseif end export false finally for function global if import in isa let local macro module quote return struct true try using while mutable where',
  nix: 'let in with rec inherit if then else assert or import builtins true false null derivation',
  makefile:
    'ifeq ifneq ifdef ifndef else endif include export unexport define endef override VPATH PHONY all clean install test',
}

/** 内建 / 常量表（与关键字分开，配色不同） */
const BUILTINS: Record<string, string> = {
  javascript:
    'Array Boolean Date Error Function JSON Math Number Object Promise Proxy Reflect RegExp Set Map WeakMap WeakSet Symbol String Symbol undefined NaN Infinity console window document globalThis process require module exports localStorage sessionStorage fetch setTimeout setInterval clearTimeout clearInterval',
  typescript:
    'Array Boolean Date Error Function JSON Math Number Object Promise Proxy Reflect RegExp Set Map WeakMap WeakSet Symbol String undefined NaN Infinity console window document globalThis process Record Partial Readonly Pick Omit Exclude Extract Awaited',
  python:
    'abs all any ascii bin bool bytes callable chr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max min next object oct open ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip __name__ __init__',
  go: 'append cap close complex copy delete imag len make new panic print println real recover',
  rust: 'Box Vec String Option Result Some None Ok Err println format vec panic assert',
  shell:
    'PATH HOME USER PWD OLDPWD SHELL LANG TERM IFS RANDOM SECONDS BASH_SOURCE BASH_LINENO',
  powershell: 'Write-Host Write-Output Get-ChildItem Set-Location Join-Path Test-Path New-Item Remove-Item $env $null $true $false $_ $args',
  lua: 'print pairs ipairs type tostring tonumber table string math io os require',
}

/* ------------------------------------------------------------------ 通用代码语法 */

type CodeDef = {
  /** 行注释前缀，空格分隔多种（如 `// #`） */
  line?: string
  /** 块注释起止 */
  block?: [string, string]
  /** 允许的字符串引号（默认 `"'`） */
  quotes?: string
  /** 是否支持反引号模板串 */
  template?: boolean
  /** 是否支持正则字面量（JS 系） */
  regexLiteral?: boolean
  keywordKey?: string
}

function buildCode(def: CodeDef): Rule[] {
  const rules: Rule[] = []

  if (def.block) {
    const [open, close] = def.block.map(escapeRe)
    rules.push(R('hl-comment', `${open}[\\s\\S]*?(?:${close}|$)`))
  }
  if (def.line) {
    const prefixes = def.line.split(/\s+/).filter(Boolean).map(escapeRe).join('|')
    rules.push(R('hl-comment', `(?:${prefixes})[^\\n]*`))
  }

  const quotes = def.quotes ?? `"'`
  const alternatives: string[] = []
  for (const q of quotes) {
    const e = escapeRe(q)
    alternatives.push(`${e}(?:\\\\[\\s\\S]|[^\\\\${e}\\n])*${e}?`)
  }
  // 模板串允许跨行
  if (def.template) alternatives.push('`(?:\\\\[\\s\\S]|[^\\\\`])*`?')
  rules.push(R('hl-string', alternatives.join('|')))

  if (def.regexLiteral) {
    // 简化的正则字面量：/.../ 后跟 flags，且不在注释里（注释已先匹配）
    rules.push(R('hl-string', '\\/(?:\\\\[\\s\\S]|[^\\\\/\\n\\[]|\\[(?:\\\\[\\s\\S]|[^\\\\\\]])*\\])+\\/[gimsuy]*'))
  }

  rules.push(R('hl-number', '\\b(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?n?)\\b'))

  const kw = KEYWORDS[def.keywordKey ?? 'javascript'] ?? ''
  if (kw) {
    rules.push(R('hl-keyword', `\\b(?:${kw.trim().split(/\s+/).map(escapeRe).join('|')})\\b`, 'i'))
  }
  const bi = BUILTINS[def.keywordKey ?? 'javascript'] ?? ''
  if (bi) {
    rules.push(R('hl-builtin', `\\b(?:${bi.trim().split(/\s+/).map(escapeRe).join('|')})\\b`))
  }

  // 函数调用 / 定义：标识符紧跟 (
  rules.push(R('hl-func', '[A-Za-z_$][\\w$]*(?=\\s*\\()'))
  // 其它标识符（不高亮）
  rules.push(R(null, '[A-Za-z_$][\\w$]*'))
  rules.push(R(null, '\\s+'))
  rules.push(R('hl-punct', '.'))
  return rules
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ------------------------------------------------------------------ 各语言语法 */

/** 标记语言：HTML / XML / Vue / Svelte */
function buildMarkup(): Rule[] {
  return [
    R('hl-comment', '<!--[\\s\\S]*?(?:-->|$)'),
    R('hl-meta', '<!DOCTYPE[^>]*>', 'i'),
    R('hl-meta', '<\\?[\\s\\S]*?\\?>'),
    R('hl-meta', '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>'),
    // 标签名
    R('hl-tag', '</?[A-Za-z][\\w:.-]*'),
    // 先吞掉空白：属性名规则是从「属性名首字符」开始匹配的，前面的空格必须先被消耗
    R(null, '\\s+'),
    // 属性名（后面跟 =）
    R('hl-attr', '[A-Za-z_:][\\w:.-]*(?=\\s*=)'),
    // 属性值
    R('hl-string', '"[^"]*"?|\'[^\']*\'?'),
    // 标签收尾
    R('hl-tag', '/?>'),
    // 实体
    R('hl-number', '&#?\\w+;'),
    R(null, '[^<&"]+'),
    R('hl-punct', '.'),
  ]
}

function buildJson(): Rule[] {
  return [
    // 键
    R('hl-attr', '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)'),
    R('hl-string', '"(?:\\\\.|[^"\\\\])*"'),
    R('hl-keyword', '\\b(?:true|false|null)\\b'),
    R('hl-number', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'),
    R(null, '\\s+'),
    R('hl-punct', '.'),
  ]
}

function buildCss(): Rule[] {
  return [
    R('hl-comment', '/\\*[\\s\\S]*?(?:\\*/|$)'),
    R('hl-string', '"[^"\\n]*"?|\'[^\\n]*\'?'),
    R('hl-meta', '@[\\w-]+'),
    // 颜色 / 长度等数值
    R('hl-number', '#[0-9a-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|ch|ex|vmin|vmax)?\\b'),
    // 变量
    R('hl-builtin', '--[\\w-]+|\\$[\\w-]+|@[\\w-]+'),
    // 属性名
    R('hl-attr', '[A-Za-z-]+(?=\\s*:)'),
    // 伪类 / 类名 / id
    R('hl-func', '::?[\\w-]+'),
    R('hl-tag', '\\.[\\w-]+|#[\\w-]+'),
    R(null, '\\s+'),
    R('hl-punct', '.'),
  ]
}

function buildShell(kind: 'shell' | 'batch' | 'powershell'): Rule[] {
  const rules: Rule[] = []
  if (kind === 'batch') rules.push(R('hl-comment', '(?:^|\\s)(?:rem|::)[^\\n]*', 'i'))
  else if (kind === 'powershell') rules.push(R('hl-comment', '#[^\\n]*|<#[\\s\\S]*?(?:#>|$)'))
  else rules.push(R('hl-comment', '#[^\\n]*'))

  rules.push(R('hl-string', '"(?:\\\\.|[^"\\\\])*"?|\'(?:[^\']|\'\')*\'?'))
  if (kind === 'batch') rules.push(R('hl-builtin', '%[\\w~-]+%|%%?[0-9a-zA-Z]'))
  if (kind === 'powershell') rules.push(R('hl-builtin', '\\$[\\w:]+'))
  else if (kind === 'shell') rules.push(R('hl-builtin', '\\$\\{[^}]*\\}|\\$[\\w@*#?$!-]+'))
  rules.push(R('hl-meta', '(?<=^|\\s)(?:-[a-zA-Z]|--[\\w-]+)(?=\\s|$)'))

  const kw = (KEYWORDS[kind] ?? '').trim().split(/\s+/)
  if (kw.length > 0 && kw[0]) {
    rules.push(R('hl-keyword', `\\b(?:${kw.map(escapeRe).join('|')})\\b`, 'i'))
  }
  rules.push(R(null, '\\s+'))
  rules.push(R('hl-punct', '.'))
  return rules
}

function buildYaml(): Rule[] {
  return [
    R('hl-comment', '#[^\\n]*'),
    R('hl-attr', '^[ \\t-]*[\\w.$@/-]+(?=\\s*:)', 'm'),
    R('hl-meta', '^---$|^\\.\\.\\.$', 'm'),
    R('hl-builtin', '[&*][\\w-]+|<<(?=\\s*:)'),
    R('hl-string', '"(?:\\\\.|[^"\\\\])*"?|\'[^\']*\'?'),
    R('hl-keyword', '\\b(?:true|false|null|yes|no|on|off|~)\\b', 'i'),
    R('hl-number', '\\b\\d+(?:\\.\\d+)?\\b'),
    R(null, '\\s+'),
    R('hl-punct', '.'),
  ]
}

function buildIni(): Rule[] {
  return [
    R('hl-comment', '^[ \\t]*[#;][^\\n]*', 'm'),
    R('hl-meta', '^[ \\t]*\\[[^\\]\\n]*\\]', 'm'),
    R('hl-attr', '^[ \\t]*[\\w.$"\'-]+(?=\\s*[=:])', 'm'),
    R('hl-string', '"(?:\\\\.|[^"\\\\])*"?|\'[^\']*\'?'),
    R('hl-keyword', '\\b(?:true|false|null|yes|no|on|off)\\b', 'i'),
    R('hl-number', '\\b\\d+(?:\\.\\d+)?\\b'),
    R('hl-builtin', '\\$[\\w.]+|\\$\\{[^}]*\\}'),
    R(null, '\\s+'),
    R('hl-punct', '.'),
  ]
}

function buildSql(): Rule[] {
  return [
    R('hl-comment', '--[^\\n]*|#[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)'),
    R('hl-string', "'(?:''|[^'\\\\])*'?|\"(?:\"\"|[^\"])*\"?|`[^`]*`?"),
    R('hl-number', '\\b\\d+(?:\\.\\d+)?\\b'),
    R(
      'hl-keyword',
      '\\b(?:select|from|where|insert|into|values|update|set|delete|create|table|alter|drop|index|view|join|left|right|inner|outer|on|group|by|order|having|limit|offset|union|all|distinct|as|and|or|not|null|is|in|exists|between|like|case|when|then|else|end|primary|key|foreign|references|default|unique|constraint|auto_increment|begin|commit|rollback|transaction|if|replace|truncate|grant|revoke|declare|cursor|procedure|function|trigger|returns|int|integer|varchar|char|text|date|datetime|timestamp|boolean|decimal|float|double|blob|json)\\b',
      'i',
    ),
    R('hl-builtin', '\\b(?:count|sum|avg|min|max|now|coalesce|nullif|cast|convert|concat|substring|trim|upper|lower|length|round|abs)\\b', 'i'),
    R('hl-func', '[A-Za-z_][\\w$]*(?=\\s*\\()'),
    R(null, '\\s+'),
    R('hl-punct', '.'),
  ]
}

function buildMarkdown(): Rule[] {
  return [
    R('hl-string', '^```[\\s\\S]*?(?:^```|$)', 'm'),
    R('hl-string', '`[^`\\n]+`'),
    R('hl-meta', '^#{1,6}[ \\t][^\\n]*', 'm'),
    R('hl-comment', '^>[^\\n]*', 'm'),
    R('hl-meta', '^[ \\t]*(?:[-*+]|\\d+\\.)[ \\t]', 'm'),
    R('hl-meta', '^[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*$', 'm'),
    R('hl-builtin', '!?\\[[^\\]]*\\]\\([^)\\s]*(?:\\s+"[^"]*")?\\)'),
    R('hl-keyword', '\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__'),
    R('hl-attr', '(?:\\*[^*\\n]+\\*|_[^_\\n]+_)'),
    R('hl-tag', '<[^>\\n]+>'),
    R('hl-string', '^[ \\t]*\\|[^\\n]*', 'm'),
    R(null, '[^`#>*_\\[!<|\\n]+'),
    R(null, '\\n'),
    R('hl-punct', '.'),
  ]
}

function buildCsv(): Rule[] {
  return [
    R('hl-string', '"[^"\\n]*"?'),
    R('hl-number', '\\b\\d+(?:\\.\\d+)?\\b'),
    R('hl-punct', '[,;\\t]'),
    R(null, '[^,;\\t\\n"]+'),
    R(null, '\\n'),
    R('hl-punct', '.'),
  ]
}

/** 纯文本：只有兜底 */
function buildPlain(): Rule[] {
  return [R(null, '[^]+')]
}

/* ------------------------------------------------------------------ 语法注册表 */

const GRAMMARS: Record<string, Rule[]> = {
  plaintext: buildPlain(),
  csv: buildCsv(),

  json: buildJson(),

  javascript: buildCode({ line: '//', block: ['/*', '*/'], template: true, regexLiteral: true, keywordKey: 'javascript' }),
  typescript: buildCode({ line: '//', block: ['/*', '*/'], template: true, regexLiteral: true, keywordKey: 'typescript' }),
  java: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'java' }),
  c: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'c' }),
  cpp: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'cpp' }),
  csharp: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'csharp' }),
  go: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'go' }),
  rust: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'rust' }),
  php: buildCode({ line: '// #', block: ['/*', '*/'], keywordKey: 'php' }),
  ruby: buildCode({ line: '#', keywordKey: 'ruby' }),
  lua: buildCode({ line: '--', block: ['--[[', ']]'], keywordKey: 'lua' }),
  perl: buildCode({ line: '#', keywordKey: 'perl' }),
  r: buildCode({ line: '#', keywordKey: 'r' }),
  dart: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'dart' }),
  swift: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'swift' }),
  scala: buildCode({ line: '//', block: ['/*', '*/'], keywordKey: 'scala' }),
  julia: buildCode({ line: '#', block: ['#=', '=#'], keywordKey: 'julia' }),
  nix: buildCode({ line: '#', block: ['/*', '*/'], keywordKey: 'nix' }),
  python: buildCode({ line: '#', quotes: `"'`, keywordKey: 'python' }),

  html: buildMarkup(),
  xml: buildMarkup(),
  vue: buildMarkup(),
  svelte: buildMarkup(),

  css: buildCss(),
  scss: buildCss(),
  less: buildCss(),

  shell: buildShell('shell'),
  batch: buildShell('batch'),
  powershell: buildShell('powershell'),

  yaml: buildYaml(),
  toml: buildIni(),
  ini: buildIni(),

  sql: buildSql(),
  markdown: buildMarkdown(),

  dockerfile: [
    R('hl-comment', '#[^\\n]*'),
    R('hl-keyword', '^[ \\t]*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|AS)\\b', 'im'),
    R('hl-string', '"[^"\\n]*"?|\'[^\\n]*\'?'),
    R('hl-builtin', '\\$\\{[^}]*\\}|\\$[\\w]+'),
    R('hl-meta', '--[\\w-]+'),
    R(null, '\\s+'),
    R('hl-punct', '.'),
  ],

  makefile: [
    R('hl-comment', '#[^\\n]*'),
    R('hl-attr', '^[A-Za-z_][\\w.-]*(?=\\s*[:?+]?=)', 'm'),
    R('hl-meta', '^[\\w./%$-]+(?=\\s*:)', 'm'),
    R('hl-keyword', '^[ \\t]*(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|export|unexport|define|endef|override|vpath)\\b', 'im'),
    R('hl-number', '\\d+(?:\\.\\d+)?'),
    R(null, '\\s+'),
    R('hl-punct', '.'),
  ],
}

/* ------------------------------------------------------------------ 对外接口 */

/** 语言 id → 显示名 */
export const LANGUAGE_LABELS: Record<string, string> = {
  plaintext: '纯文本',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  xml: 'XML',
  vue: 'Vue',
  svelte: 'Svelte',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  python: 'Python',
  shell: 'Shell',
  batch: 'Batch',
  powershell: 'PowerShell',
  yaml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  sql: 'SQL',
  markdown: 'Markdown',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  csv: 'CSV',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  lua: 'Lua',
  perl: 'Perl',
  r: 'R',
  dart: 'Dart',
  swift: 'Swift',
  scala: 'Scala',
  julia: 'Julia',
  nix: 'Nix',
}

/** 有没有该语言的专门语法（没有就退回纯文本） */
export function hasGrammar(lang: string): boolean {
  return Object.prototype.hasOwnProperty.call(GRAMMARS, lang)
}

/**
 * 高亮源码 → HTML 片段。
 * 调用方负责把它塞进 `<pre>`（用 `dangerouslySetInnerHTML`）。
 */
export function highlight(code: string, lang: string): string {
  const rules = GRAMMARS[lang] ?? GRAMMARS.plaintext
  let out = ''
  let i = 0
  const len = code.length

  while (i < len) {
    let matched = false
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r]
      rule.re.lastIndex = i
      const m = rule.re.exec(code)
      if (m && m[0].length > 0) {
        const text = m[0]
        out += rule.cls ? `<span class="${rule.cls}">${escapeHtml(text)}</span>` : escapeHtml(text)
        i += text.length
        matched = true
        break
      }
    }
    if (!matched) {
      // 理论上不会走到这里（每条语法都有兜底规则），保险起见逐字符前进
      out += escapeHtml(code[i])
      i++
    }
  }
  return out
}
