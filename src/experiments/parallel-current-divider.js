/**
 * 实验配置 —— 并联电路分流规律
 * ------------------------------------------------------------
 * 第二份实验，用来验证「加实验 = 加一份配置」这件事是否成立。
 * 与串联实验的关键差异：
 *   - 标准答案图从「3 节点链」变成「2 节点三边并联」
 *   - 理论公式：并联电压等于电源电压；支路电流 I = U / R
 *   - 电路图换成并联示意
 * 代码侧除注册外不应再有任何改动 —— 改了说明抽象还不够。
 */

export const SPEC = {
  id: 'parallel-current-divider',
  title: '并联电路分流规律',
  subject: '直流电路',
  summary: '把 R1、R2 并接在电源两端，验证各支路电压相等，并观察 R2 变化如何影响支路电流。',

  steps: ['实验预习', '任务', '电路图', '记录数据', '评分'],

  scene: {
    components: [
      { defKey: 'vs', pos: { x: -0.8, y: 0.72, z: 0.3 } },
      { defKey: 'r1', pos: { x: 0.35, y: 0.62, z: -0.5 } },
      { defKey: 'r2', pos: { x: 0.35, y: 0.72, z: 0.55 } },
    ],
  },

  roles: {
    source: 'VSRC',
    fixedResistor: 'RES',
    variableResistor: 'RHEO',
  },

  measurements: {
    voltmeter: { acrossType: 'RHEO' },
    ammeter: { branchType: 'RHEO' },
  },

  formulas: {
    // 并联：各支路电压相等，等于电源电压
    uTheory: (p) => p.U0,
    // R2 支路电流（mA）
    iTheory: (p) => (p.R2 === 0 ? 0 : (p.U0 / p.R2) * 1000),
  },

  dataPoints: {
    requiredGroups: 3,
    dedupeOn: 'r2',
    columns: [
      { key: 'r2', label: 'R2/Ω' },
      { key: 'u', label: 'U/V' },
      { key: 'i', label: 'I₂/mA' },
    ],
  },

  scoring: {
    base: 100,
    hintPenalty: 10,
    errorPenalty: 5,
    passScore: 60,
  },

  theory: {
    title: '理论参考',
    rows: (p) => [
      `U = U₁ = U₂ = ${p.U0} V（并联各支路电压相等）`,
      `I₂ = U / R2 = ${p.U0} / R2`,
    ],
    note: 'R2 减小时，I₂ 增大；干路电流 I = I₁ + I₂',
  },

  content: {
    preview: {
      title: '📖 实验预习 · 并联电路的分流规律',
      subtitle: '课前预习 —— 了解并联特点与仪表接法',
      confirmText: '✔ 完成预习',
      html: `
      <div class="kp"><b>实验目的：</b>① 掌握并联电路的连接方法；② 验证并联电路"各支路电压相等"；③ 验证并联分流规律 I = I₁ + I₂。</div>
      <div class="kp"><b>并联电路特点：</b>各支路两端电压相等且等于电源电压，即 U₁ = U₂ = U；干路电流等于各支路电流之和，I = I₁ + I₂。支路电阻越小，分得的电流越大。</div>
      <div class="kp"><b>仪表使用规则：</b>电流表<b>串联</b>在待测支路中；电压表<b>并联</b>在并联组合两端；均须注意正负极性。</div>
      <div class="kp"><b>安全须知：</b>接线检查确认后方可通电；严禁电源正负极直接短路。</div>`,
    },
    task: {
      title: '📝 实验任务书',
      subtitle: '任务书 · 并联电路的分流规律',
      confirmText: '领取任务 → 查看电路图',
      html: `
      <div class="kp">① 按实验电路在面包板上搭出<b>两条并联支路</b>：R1 一条、R2 一条；</div>
      <div class="kp">② 电源采用恒压源，将输出电压调至 <b>+6V</b>；</div>
      <div class="kp">③ R1 取 <b>200Ω</b> 固定电阻，R2 取 <b>470Ω</b> 电位器；</div>
      <div class="kp">④ 调节电位器 R2 令其阻值<b>由大到小</b>变化，把电压表与电流表读数记入数据表（不少于 3 组）。</div>`,
    },
    schematic: {
      title: '🔧 实验电路图',
      subtitle: '并联回路：R1 与 R2 并接在电源两端（电压表并联、电流表串在 R2 支路）',
      confirmText: '开始自主连线',
      html: `
      <div style="text-align:center">
        <svg width="470" height="215" viewBox="0 0 470 215" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
          <g stroke="#1e293b" stroke-width="2.5" fill="none">
            <line x1="90" y1="50" x2="90" y2="78"/>
            <line x1="90" y1="132" x2="90" y2="170"/>
            <rect x="78" y="78" width="24" height="54" fill="#fff"/>
            <line x1="90" y1="50" x2="400" y2="50"/>
            <rect x="194" y="38" width="72" height="24" fill="#fff"/>
            <line x1="90" y1="170" x2="400" y2="170"/>
            <rect x="194" y="158" width="72" height="24" fill="#fff"/>
            <line x1="400" y1="50" x2="400" y2="170"/>
            <circle cx="330" cy="110" r="23"/>
            <line x1="330" y1="50" x2="330" y2="87" stroke-dasharray="4 4"/>
            <line x1="330" y1="133" x2="330" y2="170" stroke-dasharray="4 4"/>
          </g>
          <g font-family="Microsoft YaHei" font-size="14" fill="#1e293b" text-anchor="middle">
            <text x="64" y="110" font-weight="bold">+6V</text>
            <text x="230" y="30">R1 200Ω</text>
            <text x="230" y="200">R2 470Ω</text>
            <text x="330" y="115" font-weight="bold">V</text>
            <text x="418" y="62">U₁</text>
            <text x="418" y="182">U₂</text>
          </g>
        </svg>
      </div>
      <div class="kp" style="margin-top:12px"><b>操作方式：</b>点击左上角红色按钮或按 <b>W</b> 键进入导线模式；两条支路要分别从电源两端引出，不能串成一条线。</div>
      <div class="kp"><b>注意：</b>连接完成后点击顶部「开始 / 重新计算」进行电路求解。</div>`,
    },
  },

  grading: {
    requiredTypes: ['RES', 'RHEO'],
    typeNames: { RES: '固定电阻 R1', RHEO: '电位器 R2' },
    messages: {
      okMain: '接线与标准并联回路完全等价（图同构匹配成功）',
      structureMismatch: '接线结构不符合标准并联回路（R1、R2 应各自并接在电源两端）',
      resValueWrong: (cur, ref) => `R1 阻值应为 ${ref}Ω，当前为 ${cur}Ω`,
    },
    referenceCircuits: [
      {
        // 并联的标准图非常简单：只有两个节点，电源/R1/R2 三条边都接在同一对节点上
        name: '并联分流：电源两端同时并接 R1(200Ω) 与 R2(电位器)',
        vertices: [{ id: 'P' }, { id: 'N' }],
        edges: [
          { a: 'P', b: 'N', type: 'VSRC', directed: true },
          { a: 'P', b: 'N', type: 'RES', value: 200, tol: 0.2 },
          { a: 'P', b: 'N', type: 'RHEO' },
        ],
      },
    ],
  },
}

export default SPEC
