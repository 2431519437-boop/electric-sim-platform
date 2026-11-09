/**
 * 实验配置（Experiment Spec）—— LED 限流电阻的选择
 * ------------------------------------------------------------
 * 这是第三个实验，也是检验「实验即数据」这套抽象的第一块试金石。
 *
 * 它与前两个实验的关键差异：
 *   1. 元件组合不同：没有固定电阻 R1，只有「恒压源 + 可调电阻 R2 + LED」
 *   2. 必须包含方向性元件 LED —— 前两个实验里 LED 属于"多接的元件"，
 *      这里反过来是必需元件，因此电源/LED 接反才会真正被判出来
 *   3. 被测对象不同：电压表测 LED 两端（≈ 正向压降），不再是测 R2
 *
 * 若这套配置能不改引擎代码就跑起来，说明抽象是成立的。
 */

import { DEF_LED } from '../circuit/componentLibrary.js'

// LED 的正向压降与等效串联电阻：直接取自元件库，避免两处数值漂移
const VF = DEF_LED.vf // 1.8 V
const RF = DEF_LED.rf // 20 Ω

export const SPEC = {
  id: 'led-current-limiting',
  title: 'LED 限流电阻的选择',
  subject: '直流电路',
  summary:
    '把 LED 串进回路，调节可调电阻改变工作电流，观察 LED 两端电压与电流的关系，理解限流电阻的作用。',

  steps: ['实验预习', '任务', '电路图', '记录数据', '评分'],

  /* 预置元件：注意没有固定电阻 R1 */
  scene: {
    components: [
      { defKey: 'vs', pos: { x: -0.75, y: 0.72, z: 0.28 } },
      { defKey: 'r2', pos: { x: 0.2, y: 0.72, z: -0.6 } },
      { defKey: 'led', pos: { x: 0.35, y: 0.7, z: 0.34 } },
    ],
  },

  /* 语义角色：fixedResistor 仍然声明（引擎会按 0Ω 处理缺失），
     真正必需的是「可调电阻」和「LED」 */
  roles: {
    source: 'VSRC',
    fixedResistor: 'RES',
    variableResistor: 'RHEO',
    led: 'LED',
  },

  power: {
    requiredSourceV: 6,
    tolerance: 0.2,
  },

  /* 仪表：电压表并在 LED 两端，电流表串在 LED 支路 */
  measurements: {
    voltmeter: { acrossRole: 'led' },
    ammeter: { branchRole: 'led' },
    labels: { volt: '并联在 LED 两端', amp: '串联在 LED 支路中' },
  },

  /* 理论值：LED 用「正向压降 + 等效串联电阻」建模，与求解器一致 */
  formulas: {
    // LED 两端电压（V）
    uTheory: (p) => {
      const i = Math.max(0, (p.U0 - VF) / (p.R1 + p.R2 + RF))
      return VF + i * RF
    },
    // 回路电流（mA）
    iTheory: (p) => (Math.max(0, p.U0 - VF) / (p.R1 + p.R2 + RF)) * 1000,
  },

  dataPoints: {
    requiredGroups: 3,
    dedupeOn: 'r2',
    columns: [
      { key: 'r2', label: 'R2/Ω' },
      { key: 'i', label: 'I/mA' },
      { key: 'uled', label: 'U_LED/V' },
    ],
    read: ({ variable, volt, current }) => ({
      r2: variable,
      i: Number((current * 1000).toFixed(2)),
      uled: Number(volt.toFixed(2)),
    }),
  },

  scoring: {
    base: 100,
    hintPenalty: 10,
    errorPenalty: 5,
    passScore: 60,
  },

  hints: {
    notAnalyzed: '先点「开始 / 重新计算」让系统分析一次电路',
    nextStep: '接线已完整，请点「开始 / 重新计算」，并把电源调至 +6V',
  },

  theory: {
    title: '理论参考',
    rows: (p) => [
      `I = (U − U_F) / (R2 + R_F) = (${p.U0} − ${VF}) / (R2 + ${RF})`,
      `U_LED = U_F + I · R_F ≈ ${VF} V（导通后基本不变）`,
    ],
    note: 'R2 减小 → 电流 I 增大；R2 过小会使 LED 电流超出额定值',
  },

  content: {
    preview: {
      title: '📖 实验预习 · LED 与限流电阻',
      subtitle: '课前预习 —— 了解 LED 的伏安特性与限流的意义',
      confirmText: '✔ 完成预习',
      html: `
      <div class="kp"><b>实验目的：</b>① 了解发光二极管（LED）的正向导通特性；② 理解限流电阻的作用；③ 验证 LED 回路电流的计算方法。</div>
      <div class="kp"><b>为什么要限流：</b>LED 导通后两端电压几乎固定在正向压降 U_F（本平台取 ${VF}V），
      回路电流完全由外接电阻决定：I = (U − U_F) / R。若不加限流电阻，电流会迅速增大而烧毁 LED。</div>
      <div class="kp"><b>LED 的极性：</b>LED 是<b>有方向</b>的元件 —— 长脚（阳极）接高电位、短脚（阴极）接低电位才会导通。
      接反时 LED 不亮，回路也没有电流。</div>
      <div class="kp"><b>仪表使用规则：</b>电流表<b>串联</b>接入回路；电压表<b>并联</b>在 LED 两端；均须注意正负极性。</div>
      <div class="kp"><b>安全须知：</b>接线检查确认后方可通电；严禁电源正负极直接短路；调节可调电阻动作轻缓。</div>`,
    },
    task: {
      title: '📝 实验任务书',
      subtitle: '任务书 · LED 限流电阻的选择',
      confirmText: '领取任务 → 查看电路图',
      html: `
      <div class="kp">① 按实验电路进行安装并接线，完成自主连线，把恒压源、可调电阻 R2 与 LED 串成一个回路；</div>
      <div class="kp">② 电源调至 <b>+6V</b>；R2 使用 <b>470Ω</b> 电位器作为可调限流电阻；</div>
      <div class="kp">③ <b>本实验不安装固定电阻 R1</b>：限流全部由可调电阻 R2 承担，请注意 R2 不可调到过小；</div>
      <div class="kp">④ 注意 LED <b>极性</b>：阳极朝电源正极一侧，阴极朝负极一侧；</div>
      <div class="kp">⑤ 调节 R2 令其阻值<b>由大到小</b>变化，记录电流表读数与 LED 两端电压（不少于 3 组）；</div>
      <div class="kp">⑥ 观察：随着 R2 减小，电流如何变化？LED 两端电压是否明显变化？</div>`,
    },
    schematic: {
      title: '🔧 实验电路图',
      subtitle: 'LED 限流回路：恒压源 → R2（可调）→ LED → 回到电源（电压表并联在 LED 两端）',
      confirmText: '开始自主连线',
      flashTip: '电源+ → R2 → LED（阳极朝上）→ 电源−',
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
            <line x1="415" y1="158" x2="415" y2="165"/>
            <line x1="415" y1="165" x2="55" y2="165"/>
            <circle cx="330" cy="120" r="23"/>
            <line x1="330" y1="97" x2="330" y2="55" stroke-dasharray="4 4"/>
            <line x1="330" y1="143" x2="330" y2="165" stroke-dasharray="4 4"/>
          </g>
          <g stroke="#1e293b" stroke-width="2.5" fill="none">
            <line x1="403" y1="125" x2="427" y2="125"/>
            <polygon points="403,102 403,148 427,125" fill="#e2e8f0"/>
            <line x1="430" y1="98" x2="443" y2="85"/>
            <polygon points="443,85 434,88 440,94" fill="#1e293b"/>
            <line x1="436" y1="92" x2="449" y2="79"/>
            <polygon points="449,79 440,82 446,88" fill="#1e293b"/>
          </g>
          <g font-family="Microsoft YaHei" font-size="14" fill="#1e293b" text-anchor="middle">
            <text x="42" y="115" text-anchor="end">+6V</text>
            <text x="166" y="38">R2 470Ω</text>
            <text x="340" y="205" font-size="13">LED（阳极朝上）</text>
            <text x="330" y="125" font-weight="bold">V</text>
            <text x="55" y="42" fill="#dc2626" font-weight="bold">V+</text>
            <text x="55" y="188">V−</text>
          </g>
        </svg>
      </div>
      <div class="kp" style="margin-top:12px"><b>操作方式：</b>点击左上角「🔌 连线」按钮或按 <b>W</b> 键进入连线模式；依次点击两个引脚/孔位即可连线。</div>
      <div class="kp"><b>注意：</b>LED 有极性，接反会导致回路不导通。连接完成后点击顶部「开始 / 重新计算」进行电路求解。</div>`,
    },
  },

  /* 判分：标准答案里 LED 是必需元件且带方向 —— 这是与前两个实验最大的不同 */
  grading: {
    requiredTypes: ['RHEO', 'LED'],
    typeNames: { RHEO: '电位器 R2', LED: '发光二极管 LED' },
    messages: {
      okMain: '接线与标准 LED 限流回路完全等价（图同构匹配成功）',
      okSwapped: '接线正确：R2 与 LED 的串联顺序与图纸相反，但电气完全等效',
      parallelInsteadOfSeries: 'R2、LED 与电源并联在同一对节点上，没有构成串联回路',
      structureMismatch: '接线结构不符合标准回路（元件连接顺序或并接方式有误）',
      polarity: '接线拓扑正确，但电源或 LED 极性接反（LED 不会导通）',
    },
    referenceCircuits: [
      {
        name: 'LED 限流：电源 → R2(可调) → LED → 回到电源',
        vertices: [{ id: 'V1' }, { id: 'V2' }, { id: 'V3' }],
        edges: [
          // 电源边方向 = V+ → V−：V2 为高电位侧
          { a: 'V2', b: 'V1', type: 'VSRC', directed: true },
          { a: 'V2', b: 'V3', type: 'RHEO' },
          // LED 方向 = 阳极 → 阴极：阳极接 R2 一侧，阴极回电源负极
          { a: 'V3', b: 'V1', type: 'LED', directed: true },
        ],
      },
      {
        // 串联回路里 R2 与 LED 互换位置，电流完全相同 —— 必须判为等价
        name: 'LED 限流（R2 在后）：电源 → LED → R2 → 回到电源',
        vertices: [{ id: 'V1' }, { id: 'V2' }, { id: 'V3' }],
        edges: [
          { a: 'V2', b: 'V1', type: 'VSRC', directed: true },
          { a: 'V2', b: 'V3', type: 'LED', directed: true },
          { a: 'V3', b: 'V1', type: 'RHEO' },
        ],
      },
    ],
  },
}

export default SPEC
