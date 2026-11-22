import test from "node:test"
import assert from "node:assert/strict"
import { describeRule } from "../webui/src/pages/ruleModel.ts"

test("卡片规则解析保留逻辑表达式中的逗号和策略", () => {
  const raw = "AND,((DOMAIN,example.com),(NETWORK,TCP)),代理组"
  const rule = describeRule(raw)
  assert.equal(rule.type, "AND")
  assert.equal(rule.value, "((DOMAIN,example.com),(NETWORK,TCP))")
  assert.equal(rule.policy, "代理组")
})

test("规则分类识别域名、IP、规则集与 MATCH，并区分 no-resolve", () => {
  assert.equal(describeRule("DOMAIN-SUFFIX,example.com,DIRECT").category, "domain")
  const ip = describeRule("IP-CIDR,10.0.0.0/8,DIRECT,no-resolve")
  assert.equal(ip.category, "ip")
  assert.equal(ip.policy, "DIRECT")
  assert.equal(ip.hasFlag, true)
  assert.equal(describeRule("RULE-SET,local,DIRECT").category, "set")
  const match = describeRule("MATCH,代理组")
  assert.equal(match.policy, "代理组")
  assert.equal(match.value, "所有未匹配流量")
})
