/**
 * 实验配置（Experiment Spec）—— 接线工艺与安全规程训练
 * ------------------------------------------------------------
 * 第四个实验，也是平台方向调整后的旗舰实验。
 *
 * 与前三个实验的本质区别：前三个是"理论验证"（搭电路 → 验证公式），
 * 这一类实验在市场上已经很多；本实验训练的是**操作过程本身** ——
 * 手里拿一根线，怎么拔、怎么接、什么时候必须断电：
 *
 *   场景 = 一台"接错了"的装置：LED 直接怼在 6V 电源上（预接线，无电位器）
 *   任务 = 按规范流程改接：断电 → 拔线 → 串入限流电阻 → 复接 → 通电验证
 *   判分 = 结果判分（图同构）+ 过程判分（带电操作每次 -15，见 procedure.js）
 *
 * 这正是真实实训里最看重、而现有虚拟仿真软件都不做的部分。
 *
 * 本实验也检验了配置化抽象的两个新能力（引擎代码零改动）：
 *   1. 预接线场景：scene.wires 声明"进实验时已接好的线"
 *   2. 预插元件：scene.components[].snap 声明元件初始就插在孔位上
 */

import { DEF_LED } from '../circuit/componentLibrary.js'

const VF = DEF_LED.vf // 1.8 V
const RF = DEF_LED.rf // 20 Ω

export const SPEC = {
  id: 'wiring-craft-training',
  title: '接线工艺与安全规程训练',
  subject: '实训基本功',
  summary:
    '一台接错了的装置：LED 直接连在 6V 电源上。按规范流程把它改对——先断电、再拔线、串入限流电阻、复接、通电验证。带电操作会被扣分。',

  /* 流程骨架沿用老师肯定的五环节，文案按"安全规程"主题改写 */
  steps: ['安全预习', '任务', '电路图', '断电改接', '评分'],

  /*
   * 预置场景：LED 已经插在面包板 F1 行（阳极 F1-10 / 阴极 F1-15），
   * 并且已经被错误地直连到电源两端；电位器 R2 放在旁边还没用上。
   *
   * 孔位坐标（columnX/rowZ 可查 breadboardModel.js）：
   *   F1-10  x=-0.715（铜条组 6~10 列）   F1-15  x=-0.065（铜条组 11~15 列）
   *   LED 两脚间距 0.65 = 5 个列距，中心 x = -0.39, z = 0.13（F1 行）
   */
  scene: {
    components: [
      { defKey: 'vs', pos: { x: -1.3, y: 0.72, z: 0.5 } },
      { defKey: 'led', pos: { x: -0.39, y: 0.62, z: 0.13 }, snap: true },
      { defKey: 'r2', pos: { x: 0.75, y: 0.72, z: -0.55 } },
    ],
    // 错误接线：LED 直接跨接在电源正负极之间（过流 210mA，远超 20mA 额定）
    wires: [
      { from: { comp: 'vs', pin: 'V+' }, to: { hole: 'F1-9' } }, // 阳极所在铜条
      { from: { hole: 'F1-14' }, to: { comp: 'vs', pin: 'V-' } }, // 阴极所在铜条
    ],
  },

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

  /* 仪表：电压表并在 LED 两端，电流表串在 LED 支路（与 LED 实验一致） */
  measurements: {
    voltmeter: { acrossRole: 'led' },
    ammeter: { branchRole: 'led' },
    labels: { volt: '并联在 LED 两端', amp: '串联在 LED 支路中' },
  },

  formulas: {
    uTheory: (p) => {
      const i = Math.max(0, (p.U0 - VF) / (p.R1 + p.R2 + RF))
      return VF + i * RF
    },
    iTheory: (p) => (Math.max(0, p.U0 - VF) / (p.R1 + p.R2 + RF)) * 1000,
  },

  /* 本实验只需 1 组验证数据：改接完成后通电，记录一次 LED 工作点即算验证通过 */
  dataPoints: {
    requiredGroups: 1,
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

  /*
   * 操作规程判分（本实验的核心）：
   * 任何拔线/接线/删线/复接动作发生时，电源输出必须 ≤ 0.5V（已断电），
   * 否则记一次带电操作，扣 15 分并计入报告。
   */
  procedure: {
    powerOffThreshold: 0.5,
    penalty: 15,
  },

  /*
   * 工艺评分表（多维判分，本实验的差异化亮点）：
   * 除了"接得对不对"（图同构）与"是否带电"（规程），再从五个维度评"工艺规不规范"：
   *   safety     安全规程（带电操作 / 过流烧毁）
   *   order      操作顺序（先断电→拔线→改接→检查→通电）
   *   wireColor  线色规范（红正黑负）
   *   technique  手法（捏端头不拽线身）
   *   routing    走线（横平竖直、避免交叉/悬空）
   * wireColor.pin 声明了电源引脚应有的线色语义，供线色判分使用。
   */
  craft: {
    wireColor: {
      pin: {
        'V+': 'pos', // 恒压源正极 → 应接红线
        'V-': 'neg', // 恒压源负极 → 应接黑线
      },
    },
  },

  /*
   * 通电安全检查：LED 支路电流超过 30mA 判过流。
   * 初始错误接线下点「开始计算」就会触发（约 210mA）——
   * 让学生先"烧"一次虚拟 LED，比讲十遍"为什么要限流"更有效。
   */
  safety: {
    maxCurrent: 0.03,
    message:
      'LED 电流达 {i}mA，远超 {max}mA 额定值 —— 真实元件此时已经烧毁！必须先断电，再串入限流电阻 R2',
  },

  hints: {
    notAnalyzed: '先点「开始 / 重新计算」，看看这台接错了的装置会发生什么',
    nextStep: '按规程操作：① 电源调到 0V 断电 → ② 点导线金属端头拔起改接 → ③ 串入 R2 → ④ 调回 6V 验证',
  },

  theory: {
    title: '理论参考',
    rows: (p) => [
      `改接后：I = (U − U_F) / (R2 + R_F) = (${p.U0} − ${VF}) / (R2 + ${RF})`,
      `LED 额定电流 ≤ 20mA → R2 至少约 ${Math.ceil(((p.U0 - VF) / 0.02 - RF) / 10) * 10}Ω`,
    ],
    note: '规程要点：先断电、再改接、检查无误后方可通电',
  },

  content: {
    preview: {
      title: '🦺 安全预习 · 接线工艺与操作规程',
      subtitle: '课前预习 —— 为什么"先断电再动手"是铁律',
      confirmText: '✔ 完成预习',
      html: `
      <div class="kp"><b>训练目的：</b>① 掌握"断电 → 拔线 → 改接 → 检查 → 通电"的标准操作流程；② 学会正确拔插导线（捏住端头、垂直拔出，不拽线身）；③ 理解带电操作的危害。</div>
      <div class="kp"><b>带电操作的危害：</b>带电拔线瞬间可能产生打火、误碰相邻节点造成短路；本装置中 LED 被错误地直接接在 6V 电源上，通电电流约 <b>210mA</b>，是 LED 额定电流（20mA）的十倍 —— 真实元件会立即烧毁。</div>
      <div class="kp"><b>标准流程（五字诀）：</b>断（电源调 0V 断电）→ 拔（拔下错误导线）→ 改（串入限流电阻 R2）→ 查（检查无误）→ 通（调回 +6V 通电验证）。</div>
      <div class="kp"><b>判分规则：</b>本实验<b>既判结果也判过程</b>：最终电路必须正确（图同构判分），且每一次拔线/接线都必须在断电状态下进行 —— 带电操作一次扣 15 分。</div>`,
    },
    task: {
      title: '📝 任务书',
      subtitle: '任务书 · 接线工艺与安全规程训练',
      confirmText: '领取任务 → 查看电路图',
      html: `
      <div class="kp">① 面前是一台<b>接错了</b>的装置：LED 直接连在 6V 电源上，没有限流电阻。可以先点「开始 / 重新计算」看看会发生什么；</div>
      <div class="kp">② <b>断电</b>：选中恒压源，把输出电压调到 <b>0V</b>（低于 0.5V 才算断电）；</div>
      <div class="kp">③ <b>拔线</b>：进入连线模式，点住错误导线的<b>金属端头</b>把它拔起来；</div>
      <div class="kp">④ <b>改接</b>：把电位器 R2 拖到面包板上插稳，用拔下的导线和新增导线把它<b>串入</b>回路：V+ → R2 → LED → V−；</div>
      <div class="kp">⑤ <b>通电验证</b>：检查无误后把电源调回 <b>+6V</b>，点「开始 / 重新计算」，记录 1 组数据确认 LED 正常工作；</div>
      <div class="kp">⑥ 全程<b>禁止带电操作</b>：每次拔/接线都会被系统记录并判分。</div>`,
    },
    schematic: {
      title: '🔧 目标电路图',
      subtitle: '改接目标：恒压源 → R2（限流）→ LED → 回到电源（与 LED 限流回路相同）',
      confirmText: '开始规范操作',
      flashTip: '先断电（电源调 0V）→ 拔线 → 串入 R2 → 复接 → 调回 6V 验证',
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
      <div class="kp" style="margin-top:12px"><b>操作方式：</b>进入连线模式（<b>W</b> 键）后，点导线的<b>金属端头</b>可以把它<b>拔起来拿在手里</b>，再点新孔位复接；点新位置前确认电源已调 0V。</div>
      <div class="kp"><b>提醒：</b>拔线优先点端头小球；想从已占用的孔新引线时，点同一铜条组（同一行连续 5 孔）里的相邻空孔即可，电气上等效。</div>`,
    },
  },

  /* 结果判分：与 LED 限流实验同一份标准答案（拓扑等价即可，换位也算对） */
  grading: {
    requiredTypes: ['RHEO', 'LED'],
    typeNames: { RHEO: '电位器 R2', LED: '发光二极管 LED' },
    messages: {
      okMain: '改接完成：电路与标准限流回路完全等价（图同构匹配成功）',
      okSwapped: '改接完成：R2 与 LED 的串联顺序与图纸相反，但电气完全等效',
      missingSource: '未检测到电源，请检查恒压源接线',
      missingType: '回路中缺少限流电阻 R2 —— 直接给 LED 通电会烧毁元件',
      polarity: '接线拓扑正确，但电源或 LED 极性接反（LED 不会导通）',
      structureMismatch: '改接后的结构不符合目标回路（R2 必须串联在回路中，不能并联）',
    },
    referenceCircuits: [
      {
        name: 'LED 限流：电源 → R2(可调) → LED → 回到电源',
        vertices: [{ id: 'V1' }, { id: 'V2' }, { id: 'V3' }],
        edges: [
          { a: 'V2', b: 'V1', type: 'VSRC', directed: true },
          { a: 'V2', b: 'V3', type: 'RHEO' },
          { a: 'V3', b: 'V1', type: 'LED', directed: true },
        ],
      },
      {
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
