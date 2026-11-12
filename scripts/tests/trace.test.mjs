/**
 * trace.test.mjs —— 判分追溯链测试
 * ------------------------------------------------------------
 * 验证「判分可追溯」闭环：
 *   1. buildTrace 能把 pipeline 结果组织成 8 步推理链（含 fingerprint）
 *   2. 追溯链每一步含 stage/summary/detail，顺序正确
 *   3. renderTrace 能渲染成可读文本
 *   4. traceReport（db 层）能按 id 还原追溯链
 */

import { analyzeCircuit } from '../../src/circuit/pipeline.js'
import { buildTrace, renderTrace } from '../../src/circuit/trace.js'
import { computeFingerprint } from '../../src/circuit/fingerprint.js'
import { getExperiment } from '../../src/experiments/index.js'

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  [OK]   ${name}`)
  } else {
    failed++
    console.log(`  [FAIL] ${name}  ${detail}`)
  }
}

const spec = getExperiment('series-voltage-divider')

// 构造一个正确接线的串联分压电路（VSRC + R1固定电阻 + R2电位器 串联）
const components = [
  { id: 'vs', type: 'VSRC', value: 6, pins: [{ name: 'pos' }, { name: 'neg' }] },
  { id: 'r1', type: 'RES', value: 200, pins: [{ name: '1' }, { name: '2' }] },
  { id: 'r2', type: 'RHEO', value: 200, pins: [{ name: '1' }, { name: '2' }] },
]
const nodeOf = new Map([
  ['pin:vs:pos', 'N0'],
  ['pin:vs:neg', 'N2'],
  ['pin:r1:1', 'N0'],
  ['pin:r1:2', 'N1'],
  ['pin:r2:1', 'N1'],
  ['pin:r2:2', 'N2'],
])
const nodes = [
  { id: 'N0', elements: ['pin:vs:pos', 'pin:r1:1'] },
  { id: 'N1', elements: ['pin:r1:2', 'pin:r2:1'] },
  { id: 'N2', elements: ['pin:r2:2', 'pin:vs:neg'] },
]

const analysis = analyzeCircuit({
  spec,
  components,
  nodeOf,
  nodes,
  topo: { nodes, elements: ['pin:vs:pos', 'pin:vs:neg', 'pin:r1:1', 'pin:r1:2', 'pin:r2:1', 'pin:r2:2'] },
  fingerprintFn: computeFingerprint,
})

// ---- 1. pipeline 产出完整判分结果 ----
check('pipeline 返回 wiring.ok=true', analysis.wiring.ok === true, JSON.stringify(analysis.wiring))
check('pipeline 返回 tier', !!analysis.tier && analysis.tier.tier === 'exact', JSON.stringify(analysis.tier))
check('pipeline 返回 fingerprint（64 hex）', /^[0-9a-f]{64}$/.test(analysis.wiring.fingerprint || ''))

// ---- 2. buildTrace 生成 8 步追溯链 ----
const trace = buildTrace(analysis, 100)
check('追溯链共 8 步', trace.length === 8, `实际 ${trace.length}`)
check(
  '阶段顺序正确：拓扑→求解→判定→读数→诊断→档位→得分→审计',
  trace.map((s) => s.stage).join(',') ===
    'topology,solve,wiring,readings,diagnose,tier,score,audit',
  trace.map((s) => s.stage).join(',')
)
check('每步含 stage+summary', trace.every((s) => s.stage && typeof s.summary === 'string'))
check('审计步含指纹', trace[trace.length - 1].stage === 'audit' && !!trace[trace.length - 1].detail.fingerprint)

// ---- 3. 追溯链与判分结果一致 ----
const tierStep = trace.find((s) => s.stage === 'tier')
check('追溯链档位与 pipeline 一致', tierStep.detail.tier === analysis.tier.tier)
const scoreStep = trace.find((s) => s.stage === 'score')
check('追溯链得分正确', scoreStep.detail.score === 100)
const auditStep = trace.find((s) => s.stage === 'audit')
check('追溯链指纹与 pipeline 一致', auditStep.detail.fingerprint === analysis.wiring.fingerprint)

// ---- 4. renderTrace 渲染可读文本 ----
const text = renderTrace(trace)
check('renderTrace 输出多行文本', typeof text === 'string' && text.split('\n').length === 8)
check('renderTrace 含阶段名', text.includes('拓扑识别') && text.includes('审计指纹'))

console.log(`\n追溯链测试：${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
