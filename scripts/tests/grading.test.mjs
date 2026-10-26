/**
 * 判分逻辑单元测试：验证「判分标准配置化」之后两份实验仍然判得对。
 *
 * 直接构造电气图（components + nodeOf），不经过 3D 场景，
 * 因此结果完全确定，可重复。
 */

import { evaluateWiring } from '../src/circuit/graphMatch.js'
import { SPEC as series } from '../src/experiments/series-voltage-divider.js'
import { SPEC as parallel } from '../src/experiments/parallel-current-divider.js'

const PIN = (id, name) => `pin:${id}:${name}`

/** 由「元件 + 引脚→节点」描述生成 evaluateWiring 需要的入参 */
function circuit(defs) {
  const nodeOf = new Map()
  const components = defs.map((d) => {
    const pins = d.pins.map((n) => ({ name: n }))
    d.pins.forEach((n, i) => nodeOf.set(PIN(d.id, n), d.nodes[i]))
    return { id: d.id, type: d.type, value: d.value, pins }
  })
  return { components, nodeOf }
}

const pin2 = (a, b) => [a, b]

/* ---------------- 各种接法 ---------------- */
const SERIES_OK = circuit([
  { id: 'vs', type: 'VSRC', pins: pin2('V+', 'V-'), nodes: ['n2', 'n1'] },
  { id: 'r1', type: 'RES', value: 200, pins: pin2('a', 'b'), nodes: ['n2', 'n3'] },
  { id: 'r2', type: 'RHEO', value: 470, pins: pin2('a', 'b'), nodes: ['n3', 'n1'] },
])

const SERIES_SWAPPED = circuit([
  { id: 'vs', type: 'VSRC', pins: pin2('V+', 'V-'), nodes: ['n2', 'n1'] },
  { id: 'r2', type: 'RHEO', value: 470, pins: pin2('a', 'b'), nodes: ['n2', 'n3'] },
  { id: 'r1', type: 'RES', value: 200, pins: pin2('a', 'b'), nodes: ['n3', 'n1'] },
])

const PARALLEL_OK = circuit([
  { id: 'vs', type: 'VSRC', pins: pin2('V+', 'V-'), nodes: ['P', 'N'] },
  { id: 'r1', type: 'RES', value: 200, pins: pin2('a', 'b'), nodes: ['P', 'N'] },
  { id: 'r2', type: 'RHEO', value: 470, pins: pin2('a', 'b'), nodes: ['P', 'N'] },
])

const SERIES_BAD_R = circuit([
  { id: 'vs', type: 'VSRC', pins: pin2('V+', 'V-'), nodes: ['n2', 'n1'] },
  { id: 'r1', type: 'RES', value: 100, pins: pin2('a', 'b'), nodes: ['n2', 'n3'] },
  { id: 'r2', type: 'RHEO', value: 470, pins: pin2('a', 'b'), nodes: ['n3', 'n1'] },
])

const PARALLEL_MISSING_R2 = circuit([
  { id: 'vs', type: 'VSRC', pins: pin2('V+', 'V-'), nodes: ['P', 'N'] },
  { id: 'r1', type: 'RES', value: 200, pins: pin2('a', 'b'), nodes: ['P', 'N'] },
])

const NO_SOURCE = circuit([
  { id: 'r1', type: 'RES', value: 200, pins: pin2('a', 'b'), nodes: ['P', 'N'] },
  { id: 'r2', type: 'RHEO', value: 470, pins: pin2('a', 'b'), nodes: ['P', 'N'] },
])

function judge(spec, ckt) {
  const g = spec.grading
  return evaluateWiring({
    components: ckt.components,
    nodeOf: ckt.nodeOf,
    target: g.referenceCircuits,
    requiredTypes: g.requiredTypes,
    typeNames: g.typeNames,
    messages: g.messages,
  })
}

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  [OK]   ' + name) }
  else { fail++; console.log('  [FAIL] ' + name + (detail ? '  ' + detail : '')) }
}

console.log('=== A. 串联实验的标准 ===')
{
  const r = judge(series, SERIES_OK)
  check('正确串联判为通过', r.ok === true, JSON.stringify(r.message))
  check('提示语是串联版', r.message === series.grading.messages.okMain, r.message)
}
{
  const r = judge(series, SERIES_SWAPPED)
  check('R1/R2 换位判为等价通过', r.ok === true, r.message)
  check('用第二条标准答案（换位）', r.message === series.grading.messages.okSwapped, r.message)
}
{
  const r = judge(series, PARALLEL_OK)
  check('并联接法在串联实验里判为不通过', r.ok === false, r.message)
  check('提示"没有构成串联回路"',
    r.message === series.grading.messages.parallelInsteadOfSeries, r.message)
}
{
  const r = judge(series, SERIES_BAD_R)
  check('R1 阻值不符判为不通过', r.ok === false, r.message)
  check('提示含正确阻值 200', r.message.includes('200'), r.message)
}

console.log('\n=== B. 并联实验的标准 ===')
{
  const r = judge(parallel, PARALLEL_OK)
  check('正确并联判为通过', r.ok === true, r.message)
  check('提示语是并联版', r.message === parallel.grading.messages.okMain, r.message)
}
{
  const r = judge(parallel, SERIES_OK)
  check('串联接法在并联实验里判为不通过', r.ok === false, r.message)
  check('提示"不符合标准并联回路"',
    r.message === parallel.grading.messages.structureMismatch, r.message)
}
{
  const r = judge(parallel, PARALLEL_MISSING_R2)
  check('缺 R2 判为不通过', r.ok === false, r.message)
  check('提示缺少电位器 R2', r.message.includes('电位器 R2'), r.message)
}

console.log('\n=== C. 通用检查 ===')
{
  const r = judge(series, NO_SOURCE)
  check('无电源时给专门提示', r.ok === false && r.message.includes('未检测到电源'), r.message)
}
{
  // 同一份接线（并联），交给两份实验的配置去判，结论应当相反
  const bySeries = judge(series, PARALLEL_OK)
  const byParallel = judge(parallel, PARALLEL_OK)
  check('同一接法：串联实验判否、并联实验判通过',
    bySeries.ok === false && byParallel.ok === true,
    `串联=${bySeries.ok} 并联=${byParallel.ok}`)
}

console.log('\n========== 通过 ' + pass + '，失败 ' + fail + ' ==========')
process.exit(fail === 0 ? 0 : 1)
