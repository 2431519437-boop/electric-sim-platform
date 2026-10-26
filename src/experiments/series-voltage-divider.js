/**
 * 实验配置（Experiment Spec）—— 串联电路分压规律
 * ------------------------------------------------------------
 * 这是「实验即数据」的第一个样本。目标是验证：把原本散落在
 * App.vue / LabFlow.vue / graphMatch.js 里的实验专属内容抽到这里之后，
 * 引擎是否真的只吃配置就能跑起来。
 *
 * 约定：
 *   - 所有字段都是「数据或纯函数」，不含 UI 逻辑
 *   - 公式里的电压/阻值一律通过 params 传入，不再出现 6、200 这类字面量
 *   - 以后新增实验 = 新增一个同结构的文件，再注册到 index.js
 */

export const SPEC = {
  id: 'series-voltage-divider',
  title: '串联电路分压规律',
  subject: '直流电路',
  summary: '搭一个串联回路，调节电位器观察 R2 两端电压与回路电流的变化，验证分压公式。',

  /* 流程步骤：现有五步，换成别的实验时可以改文字或增减 */
  steps: ['实验预习', '任务', '电路图', '记录数据', '评分'],

  /* 预置元件：进场景时自动摆好的元件与初始位置 */
  scene: {
    components: [
      { defKey: 'vs', pos: { x: -0.75, y: 0.72, z: 0.28 } },
      { defKey: 'r1', pos: { x: 0.2, y: 0.62, z: 0.34 } },
      { defKey: 'r2', pos: { x: 0.3, y: 0.72, z: -0.6 } },
      { defKey: 'led', pos: { x: -0.2, y: 0.7, z: -0.6 } },
    ],
  },

  /* 语义角色：把「电源 / 固定电阻 / 可变电阻」和具体元件类型解耦，
     代码里不再直接写 'RHEO' 这种类型名 */
  roles: {
    source: 'VSRC',
    fixedResistor: 'RES',
    variableResistor: 'RHEO',
  },

  /* 仪表定义：电压表并联在哪个元件两端、电流表串在哪条回路 */
  measurements: {
    voltmeter: { acrossType: 'RHEO' },
    ammeter: { branchType: 'RHEO' },
  },

  /* 理论值：params = { U0, R1, R2 }，由场景里实际元件参数提供 */
  formulas: {
    // R2 两端电压（V）
    uTheory: (p) => (p.R2 === 0 ? 0 : (p.U0 * p.R2) / (p.R1 + p.R2)),
    // 回路电流（mA）
    iTheory: (p) => (p.U0 / (p.R1 + p.R2)) * 1000,
  },

  /* 数据记录：列定义驱动表格表头，不再把 R2/U/I 写死在组件里 */
  dataPoints: {
    requiredGroups: 3,
    // 按哪个字段判重（同一阻值不许重复记录）
    dedupeOn: 'r2',
    columns: [
      { key: 'r2', label: 'R2/Ω' },
      { key: 'u', label: 'U/V' },
      { key: 'i', label: 'I/mA' },
    ],
  },

  /* 计分参数 */
  scoring: {
    base: 100,
    hintPenalty: 10,
    errorPenalty: 5,
    passScore: 60,
  },

  /* 理论参考面板：rows 是随参数生成的公式文字 */
  theory: {
    title: '理论参考',
    rows: (p) => [
      `I = U / (R1 + R2) = ${p.U0} / (${p.R1} + R2)`,
      `U₂ = ${p.U0} · R2 / (${p.R1} + R2)`,
    ],
    note: 'R2 由大到小变化 → I 增大、U₂ 减小',
  },

  /* 教学环节文案：预习 / 任务书 / 电路图。
     html 直接插进 FlowModal 的 v-html，只放展示内容，不放逻辑。 */
  content: {
    preview: {
      title: '📖 实验预习 · 直流电路的安装与测量',
      subtitle: '课前预习 —— 了解实验目的、原理与安全须知',
      confirmText: '✔ 完成预习',
      html: `
      <div class="kp"><b>实验目的：</b>① 掌握在面包板上安装与连接直流电路的方法；② 学会恒压源、电压表、电流表的正确使用；③ 验证串联电路的分压规律与欧姆定律。</div>
      <div class="kp"><b>串联电路特点：</b>电流处处相等 I = U / (R1 + R2)；各电阻电压与阻值成正比，即 U₂ = U × R2 / (R1 + R2)。R2 减小时，回路电流增大，R2 两端电压降低。</div>
      <div class="kp"><b>仪表使用规则：</b>电流表<b>串联</b>接入回路；电压表<b>并联</b>在被测元件两端；均须注意正负极性。</div>
      <div class="kp"><b>安全须知：</b>接线检查确认后方可通电；严禁电源正负极直接短路；调节电位器动作轻缓。</div>`,
    },
    task: {
      title: '📝 实验任务书',
      subtitle: '任务书 · 直流电路的安装与测量',
      confirmText: '领取任务 → 查看电路图',
      html: `
      <div class="kp">① 按实验电路进行安装并接线，完成自主连线，搭建好当前实验电路；</div>
      <div class="kp">② 电源采用恒压源 0~+30V 可调直流电压源，将输出电压调至 <b>+6V</b>；</div>
      <div class="kp">③ R1 取 <b>200Ω</b> 固定电阻，R2 取 <b>470Ω</b> 电位器；</div>
      <div class="kp">④ 调节电位器 R2 令其阻值<b>由大到小</b>变化，将电压表、电流表的读数记入数据表中（不少于 3 组）。</div>`,
    },
    schematic: {
      title: '🔧 实验电路图',
      subtitle: '串联回路：恒压源 → R1 → R2 → 回到电源（电压表并联在 R2 两端）',
      confirmText: '开始自主连线',
      html: `
      <div style="text-align:center">
        <svg width="470" height="215" viewBox="0 0 470 215" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
          <g stroke="#1e293b" stroke-width="2.5" fill="none">
            <line x1="55" y1="55" x2="55" y2="165"/>
            <line x1="55" y1="55" x2="130" y2="55"/>
            <rect x="130" y="43" width="72" height="24" fill="#fff"/>
            <line x1="202" y1="55" x2="290" y2="55"/>
            <line x1="290" y1="55" x2="415" y2="55"/>
            <line x1="415" y1="55" x2="415" y2="92"/>
            <rect x="403" y="92" width="24" height="66" fill="#fff"/>
            <line x1="415" y1="158" x2="415" y2="165"/>
            <line x1="415" y1="165" x2="55" y2="165"/>
            <circle cx="330" cy="120" r="23"/>
            <line x1="330" y1="97" x2="330" y2="55" stroke-dasharray="4 4"/>
            <line x1="330" y1="143" x2="330" y2="165" stroke-dasharray="4 4"/>
          </g>
          <g font-family="Microsoft YaHei" font-size="14" fill="#1e293b" text-anchor="middle">
            <text x="42" y="115" text-anchor="end">+6V</text>
            <text x="166" y="38">R1 200Ω</text>
            <text x="448" y="128">R2 470Ω</text>
            <text x="330" y="125" font-weight="bold">V</text>
            <text x="55" y="42" fill="#dc2626" font-weight="bold">V+</text>
            <text x="55" y="188">V−</text>
          </g>
        </svg>
      </div>
      <div class="kp" style="margin-top:12px"><b>操作方式：</b>点击左上角红色按钮或按 <b>W</b> 键进入导线模式；依次点击两个引脚/孔位即可连线。导线会像现实中一样拱起弧线，拖动元件时自动跟随拉伸。</div>
      <div class="kp"><b>注意：</b>连接完成后点击顶部「开始 / 重新计算」进行电路求解。</div>`,
    },
  },

  /* 判分：标准电路（图同构用）+ 必需元件 + 提示文案。
     换实验时主要就改这一块 —— 标准答案图必须人工构造并验证。 */
  grading: {
    requiredTypes: ['RES', 'RHEO'],
    typeNames: { RES: '固定电阻 R1', RHEO: '电位器 R2' },
    messages: {
      okMain: '接线与标准串联回路完全等价（图同构匹配成功）',
      okSwapped: '接线正确：R1 与 R2 的串联顺序与图纸相反，但电气完全等效',
      parallelInsteadOfSeries: 'R1、R2 与电源并联在同一对节点上，没有构成串联回路',
      structureMismatch: '接线结构不符合标准串联回路（元件连接顺序或并接方式有误）',
      resValueWrong: (cur, ref) => `R1 阻值应为 ${ref}Ω，当前为 ${cur}Ω`,
    },
    referenceCircuits: [
      {
        name: '串联分压：电源 → R1(200Ω) → R2(电位器) → 回到电源',
        vertices: [{ id: 'V1' }, { id: 'V2' }, { id: 'V3' }],
        edges: [
          // 电源边方向 = V+ → V−：V2 接 R1 一侧为 V+，V1 接 R2 一侧为 V−
          { a: 'V2', b: 'V1', type: 'VSRC', directed: true },
          { a: 'V2', b: 'V3', type: 'RES', value: 200, tol: 0.2 },
          { a: 'V3', b: 'V1', type: 'RHEO' },
        ],
      },
      {
        // R2 在前、R1 在后：串联里两电阻互换，测得的 U(R2)、I 完全一样，
        // 拓扑上必须判为等价 —— 这正是图同构比"逐根导线比对"高明的地方
        name: '串联分压（R2 在前）：电源 → R2 → R1 → 回到电源',
        vertices: [{ id: 'V1' }, { id: 'V2' }, { id: 'V3' }],
        edges: [
          { a: 'V2', b: 'V1', type: 'VSRC', directed: true },
          { a: 'V2', b: 'V3', type: 'RHEO' },
          { a: 'V3', b: 'V1', type: 'RES', value: 200, tol: 0.2 },
        ],
      },
    ],
  },
}

export default SPEC
