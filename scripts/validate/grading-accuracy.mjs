/**
 * 判分正确率验证（可复现）
 * ------------------------------------------------------------
 * 目的：把「自检」升级成「验证」。
 *   - 程序化构造 N 组接线，每组的期望结论由构造方式唯一确定（ground truth by construction）
 *   - 随机化节点编号、元件顺序、无极性元件的引脚顺序 → 检验判分与"编号/顺序"无关
 *   - 统计准确率、分族明细、误判清单，输出可放进作品说明书的 Markdown 报告
 *
 * 随机数用固定种子，任何人重跑都能得到完全一致的结果。
 *
 * 运行： node scripts/validate/grading-accuracy.mjs [--out docs/判分验证报告.md]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { evaluateWiring } from '../../src/circuit/graphMatch.js'
import { getExperiment } from '../../src/experiments/index.js'

const SERIES = 'series-voltage-divider'
const PARALLEL = 'parallel-current-divider'

/* ---------------- 可复现随机数 ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const SEED = 20261027
let rand = mulberry32(SEED)

const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const PIN = (id, name) => `pin:${id}:${name}`

/**
 * 由「逻辑节点 + 元件边」生成 evaluateWiring 的入参。
 * 逻辑节点会被随机改名，无极性元件的引脚顺序随机交换 —— 这两者都不该影响结论。
 */
function build({ edges }) {
  const logicalNodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))]
  // 随机改名：N7、nq3 这种，模拟并查集输出的任意编号
  const label = new Map(
    logicalNodes.map((k) => [k, `N${Math.floor(rand() * 900 + 100)}_${k}`])
  )

  const comps = shuffle(edges).map((e, i) => {
    const id = e.compId || `C${i + 1}`
    // 电源有方向，引脚顺序不能动；电阻/LED 两端无极性语义，可以随机交换
    const flip = e.type !== 'VSRC' && rand() < 0.5
    const p0 = flip ? 'p2' : 'p1'
    const p1 = flip ? 'p1' : 'p2'
    const n0 = flip ? e.to : e.from
    const n1 = flip ? e.from : e.to
    return {
      comp: { id, type: e.type, value: e.value, pins: [{ name: p0 }, { name: p1 }] },
      n0,
      n1,
    }
  })

  const components = comps.map((c) => c.comp)
  const nodeOf = new Map()
  for (const c of comps) {
    nodeOf.set(PIN(c.comp.id, c.comp.pins[0].name), label.get(c.n0))
    nodeOf.set(PIN(c.comp.id, c.comp.pins[1].name), label.get(c.n1))
  }
  return { components, nodeOf }
}

/* ---------------- 用例族 ---------------- */
/* 每族返回 { edges, expectOk, expectPolarity, note } */

const FAMILIES = [
  /* ===== 串联实验 ===== */
  {
    exp: SERIES,
    name: '正确串联',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'm' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'm', to: 'n' },
      ],
      expectOk: true,
    }),
  },
  {
    exp: SERIES,
    name: '正确串联（R1/R2 顺序相反）',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'p', to: 'm' },
        { compId: 'R1', type: 'RES', value: 200, from: 'm', to: 'n' },
      ],
      expectOk: true,
    }),
  },
  {
    exp: SERIES,
    name: '少接一根线（存在悬空端）',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'm' },
        // R2 只接一端，另一端悬空
        { compId: 'R2', type: 'RHEO', value: 470, from: 'm', to: 'x' },
      ],
      expectOk: false,
    }),
  },
  {
    exp: SERIES,
    name: '多串了一个 LED',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'm' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'm', to: 'l' },
        { compId: 'LED1', type: 'LED', from: 'l', to: 'n' },
      ],
      expectOk: false,
    }),
  },
  {
    exp: SERIES,
    name: 'R1 阻值不符',
    count: 25,
    make: () => {
      // 落在容差带外：[40,140] 或 [280,900]
      const bad = rand() < 0.5
        ? Math.round(40 + rand() * 100)
        : Math.round(280 + rand() * 620)
      return {
        edges: [
          { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
          { compId: 'R1', type: 'RES', value: bad, from: 'p', to: 'm' },
          { compId: 'R2', type: 'RHEO', value: 470, from: 'm', to: 'n' },
        ],
        expectOk: false,
        note: `R1=${bad}Ω`,
      }
    },
  },
  {
    exp: SERIES,
    name: '接成并联（结构错）',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'n' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'p', to: 'n' },
      ],
      expectOk: false,
    }),
  },
  {
    exp: SERIES,
    name: '电源极性接反（等价于 R1/R2 换位）',
    count: 25,
    make: () => ({
      edges: [
        // a=负极侧：把电源接反。串联回路里电压/电流幅值不变，
        // 且该图与「R1/R2 换位」的标准答案同构，故应判通过
        { compId: 'VS1', type: 'VSRC', from: 'n', to: 'p' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'm' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'm', to: 'n' },
      ],
      expectOk: true,
      note: '对称性吸收：与 REF_SERIES_SWAPPED 同构',
    }),
  },
  {
    exp: SERIES,
    name: '缺少可变电阻',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'n' },
      ],
      expectOk: false,
    }),
  },

  /* ===== 并联实验 ===== */
  {
    exp: PARALLEL,
    name: '正确并联',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'n' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'p', to: 'n' },
      ],
      expectOk: true,
    }),
  },
  {
    exp: PARALLEL,
    name: '接成串联（结构错）',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'm' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'm', to: 'n' },
      ],
      expectOk: false,
    }),
  },
  {
    exp: PARALLEL,
    name: '并联多接一个 LED',
    count: 25,
    make: () => ({
      edges: [
        { compId: 'VS1', type: 'VSRC', from: 'p', to: 'n' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'n' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'p', to: 'n' },
        { compId: 'LED1', type: 'LED', from: 'p', to: 'n' },
      ],
      expectOk: false,
    }),
  },
  {
    exp: PARALLEL,
    name: '电源极性接反（等价于两节点互换）',
    count: 25,
    make: () => ({
      edges: [
        // 并联只有两个电气节点，接反电源 = 交换两个节点的标号，
        // 属于同一张图的自同构，故应判通过
        { compId: 'VS1', type: 'VSRC', from: 'n', to: 'p' },
        { compId: 'R1', type: 'RES', value: 200, from: 'p', to: 'n' },
        { compId: 'R2', type: 'RHEO', value: 470, from: 'p', to: 'n' },
      ],
      expectOk: true,
      note: '两节点图自同构吸收',
    }),
  },
]

/* ---------------- 执行 ---------------- */
const results = []
const misses = []

for (const fam of FAMILIES) {
  const spec = getExperiment(fam.exp)
  const g = spec.grading
  let hit = 0
  for (let i = 0; i < fam.count; i++) {
    const c = fam.make()
    const { components, nodeOf } = build(c)
    const r = evaluateWiring({
      components,
      nodeOf,
      target: g.referenceCircuits,
      requiredTypes: g.requiredTypes,
      typeNames: g.typeNames,
      messages: g.messages,
    })

    const okRight = r.ok === c.expectOk
    const polRight =
      c.expectPolarity === undefined ? true : r.polarityReversed === c.expectPolarity
    const pass = okRight && polRight
    if (pass) hit += 1
    else {
      misses.push({
        family: fam.name,
        expectOk: c.expectOk,
        gotOk: r.ok,
        expectPolarity: c.expectPolarity,
        gotPolarity: r.polarityReversed,
        message: r.message,
        note: c.note || '',
      })
    }
    results.push({ family: fam.name, exp: fam.exp, pass })
  }
  const total = fam.count
  console.log(
    `${hit === total ? '✓' : '✗'} ${fam.name.padEnd(28, ' ')} ${hit}/${total}  ${
      ((hit / total) * 100).toFixed(1)
    }%`
  )
}

const total = results.length
const passed = results.filter((r) => r.pass).length
const accuracy = (passed / total) * 100

/* ---------------- 机制验证：极性检测是否真的能触发 ---------------- */
/*
 * 串联/并联两个实验的标准答案都存在对称性，会把"电源接反"吸收成等价接法，
 * 因此极性检测在这两个实验里不会触发（这不是缺陷，见报告第 6 节）。
 * 这里用一份含方向性元件（LED）的非对称标准答案，验证该检测确实有效。
 */
const CUSTOM = {
  referenceCircuits: [
    {
      name: '自定义：VSRC + RES + LED 串联',
      vertices: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { type: 'VSRC', a: 'A', b: 'C', directed: true },
        { type: 'RES', value: 200, a: 'A', b: 'B' },
        { type: 'LED', a: 'B', b: 'C', directed: true },
      ],
    },
  ],
  requiredTypes: ['RES', 'LED'],
  typeNames: { RES: '固定电阻', LED: '发光二极管' },
  messages: {},
}

const mech = []
{
  const mk = (srcFrom, srcTo) => {
    const components = [
      { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
      { id: 'R1', type: 'RES', value: 200, pins: [{ name: 'p1' }, { name: 'p2' }] },
      { id: 'LED1', type: 'LED', pins: [{ name: 'p1' }, { name: 'p2' }] },
    ]
    const nodeOf = new Map([
      [PIN('VS1', 'p1'), srcFrom],
      [PIN('VS1', 'p2'), srcTo],
      [PIN('R1', 'p1'), 'A'],
      [PIN('R1', 'p2'), 'B'],
      [PIN('LED1', 'p1'), 'B'],
      [PIN('LED1', 'p2'), 'C'],
    ])
    return { components, nodeOf }
  }

  const run = (c) =>
    evaluateWiring({
      components: c.components,
      nodeOf: c.nodeOf,
      target: CUSTOM.referenceCircuits,
      requiredTypes: CUSTOM.requiredTypes,
      typeNames: CUSTOM.typeNames,
      messages: CUSTOM.messages,
    })

  const good = run(mk('A', 'C'))
  mech.push({ name: '方向完全正确 → 应判通过', got: good.ok === true, detail: good.message })

  const rev = run(mk('C', 'A'))
  mech.push({
    name: '仅电源接反 → 应判不通过且报极性反',
    got: rev.ok === false && rev.polarityReversed === true,
    detail: `ok=${rev.ok} polarityReversed=${rev.polarityReversed} | ${rev.message}`,
  })

  const noLed = run({
    components: [
      { id: 'VS1', type: 'VSRC', value: 6, pins: [{ name: 'p1' }, { name: 'p2' }] },
      { id: 'R1', type: 'RES', value: 200, pins: [{ name: 'p1' }, { name: 'p2' }] },
    ],
    nodeOf: new Map([
      [PIN('VS1', 'p1'), 'A'],
      [PIN('VS1', 'p2'), 'C'],
      [PIN('R1', 'p1'), 'A'],
      [PIN('R1', 'p2'), 'C'],
    ]),
  })
  mech.push({
    name: '缺 LED → 应报缺少元件',
    got: noLed.ok === false,
    detail: noLed.message,
  })
}

for (const m of mech) {
  console.log(`${m.got ? '✓' : '✗'} [机制] ${m.name}  ${m.detail}`)
}
const mechFailed = mech.filter((m) => !m.got).length

console.log(`\n合计 ${total} 组，正确 ${passed} 组，准确率 ${accuracy.toFixed(2)}%`)
if (misses.length) {
  console.log('\n误判明细：')
  for (const m of misses.slice(0, 10)) {
    console.log(`  [${m.family}] 期望 ok=${m.expectOk} 实际 ok=${m.gotOk} | ${m.message} ${m.note}`)
  }
}
if (mechFailed) console.log(`\n机制验证失败 ${mechFailed} 项`)

/* ---------------- 输出报告 ---------------- */
const outIdx = process.argv.indexOf('--out')
const outPath = outIdx > -1 ? process.argv[outIdx + 1] : null

if (outPath) {
  const famRows = FAMILIES.map((fam) => {
    const rs = results.filter((r) => r.family === fam.name)
    const ok = rs.filter((r) => r.pass).length
    return `| ${fam.name} | ${fam.exp === SERIES ? '串联' : '并联'} | ${rs.length} | ${ok} | ${(
      (ok / rs.length) * 100
    ).toFixed(1)}% |`
  }).join('\n')

  const md = `# 判分正确率验证报告

> 自动生成：\`node scripts/validate/grading-accuracy.mjs\`
> 随机种子：\`${SEED}\`（固定种子，重跑结果一致）
> 生成时间：${new Date().toISOString()}
> 被测函数：\`src/circuit/graphMatch.js\` → \`evaluateWiring()\`

## 1. 验证方法

不依赖任何人工标注，**期望结论由电路构造方式唯一确定**：

- 「正确串联」这一族，构造时就是按标准答案连的，因此期望 \`ok=true\`；
- 「R1 阻值不符」这一族，R1 取在容差带外的随机值，因此期望 \`ok=false\`；
- 以此类推。构造意图即 ground truth。

每组用例还会随机化三件事，用于检验判分对"与电气无关的差异"是否免疫：

1. **电气节点编号**（模拟并查集输出的任意编号）
2. **元件在数组中的顺序**
3. **无极性元件（电阻/可变电阻/LED）的引脚顺序**

## 2. 总体结果

| 指标 | 数值 |
|---|---|
| 用例总数 | ${total} |
| 判分正确 | ${passed} |
| **准确率** | **${accuracy.toFixed(2)}%** |
| 误判数 | ${misses.length} |

## 3. 分族明细

| 用例族 | 所属实验 | 用例数 | 判对 | 准确率 |
|---|---|---|---|---|
${famRows}

## 4. 误判明细

${
  misses.length === 0
    ? '无。全部用例的判定与构造意图一致。'
    : misses
        .slice(0, 20)
        .map(
          (m) =>
            `- **${m.family}**：期望 \`ok=${m.expectOk}\`，实际 \`ok=${m.gotOk}\`，判分说明「${m.message}」${
              m.note ? `（${m.note}）` : ''
            }`
        )
        .join('\n')
}

## 5. 极性检测机制验证

串联/并联两个实验的标准答案存在对称性（见第 6 节），会把"电源接反"吸收为等价接法。
为证明**极性检测本身有效**，另用一份含方向性元件（LED）的非对称标准答案单独验证：

| 用例 | 期望 | 实际 | 结果 |
|---|---|---|---|
${mech
  .map((m) => `| ${m.name} | — | ${m.detail} | ${m.got ? '✓ 通过' : '✗ 失败'} |`)
  .join('\n')}

结论：方向比对逻辑（\`edgesCompatible\` 中对 \`directed\` 参考边比较端点朝向）工作正常，
在非对称拓扑中能准确报出「电源极性接反」。

## 6. 一个必须说明的设计取舍：为什么"极性接反"判通过

验证过程中发现：**在两个现有实验里，把电源接反会被判为通过**。这不是缺陷，而是拓扑等价：

| 实验 | 现象 | 原因 |
|---|---|---|
| 串联分压 | 接反后与「R1/R2 换位」的标准答案同构 | 串联回路互换两个电阻的位置，电压电流幅值完全相同；接反电源等价于该互换 |
| 并联分流 | 接反后是同一张两节点图的自同构 | 并联只有两个电气节点，接反 = 交换节点标号，边集合不变 |

因此按平台既定的判定原则「**电气等价即通过**」，判通过是自洽的。

**这个取舍的边界**：只有当标准答案含**方向性元件**（LED、二极管、电解电容）时，
极性接反才无法被对称性吸收，才会被单独报出（第 5 节已验证该机制可用）。

若教学上要求"必须按图纸正接"，正确做法不是在图同构里加特例，而是：
1. 在标准答案中加入 LED 等方向性元件（本平台场景内已预置 LED，扩展即可）；
2. 或把"仪表正负极性"单独作为一项检查（与拓扑判定解耦）。

## 7. 判定口径说明

| 结论 | 判定依据 |
|---|---|
| 通过 | 学生电路与标准答案图**图同构**（顶点双射、边同标签、电源方向一致） |
| 不通过 - 缺元件 | 回路连通分量中缺少必需类型 |
| 不通过 - 未闭合 | 存在度数 < 2 的悬空端，或边数不足 |
| 不通过 - 多接 | 连通分量中存在标准答案没有的元件类型 |
| 不通过 - 参数错 | 结构匹配但元件参数超出容差（标准值 ± 容差） |
| 不通过 - 极性反 | 放开方向后能匹配，说明拓扑对但电源接反 |
| 不通过 - 结构错 | 以上均不成立（如串联接成并联） |
`
  const dir = path.dirname(outPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(outPath, md, 'utf8')
  console.log(`\n报告已写入：${outPath}`)
}

process.exit(misses.length === 0 && mechFailed === 0 ? 0 : 1)
