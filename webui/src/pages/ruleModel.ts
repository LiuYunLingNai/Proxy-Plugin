export type RuleCategory = 'all' | 'domain' | 'ip' | 'set' | 'other'

export function describeRule(raw: string) {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '(') depth++
    if (raw[index] === ')') depth--
    if (raw[index] === ',' && depth === 0) {
      parts.push(raw.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(raw.slice(start).trim())
  const type = parts[0] || 'UNKNOWN'
  const hasFlag = parts.at(-1)?.toLowerCase() === 'no-resolve'
  const policyIndex = parts.length - (hasFlag ? 2 : 1)
  const policy = policyIndex > 0 ? parts[policyIndex] : ''
  const value = parts.slice(1, policyIndex).join(',')
  const category: RuleCategory =
    type.startsWith('DOMAIN') || type === 'GEOSITE'
      ? 'domain'
      : type.includes('IP') || type === 'GEOIP'
        ? 'ip'
        : type === 'RULE-SET'
          ? 'set'
          : 'other'
  return {
    type,
    value: value || (type === 'MATCH' ? '所有未匹配流量' : raw),
    policy,
    category,
    hasFlag,
  }
}

export const editableRuleTypes = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'IP-CIDR6',
  'GEOIP',
  'GEOSITE',
  'RULE-SET',
  'MATCH',
]
