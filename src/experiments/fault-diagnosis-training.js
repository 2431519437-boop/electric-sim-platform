/**
 * 实验配置（Experiment Spec）—— 故障排查与排除训练
 * ------------------------------------------------------------
 * 第五个实验，也是「工艺实训系列」的第二块拼图。
 *
 * 与「接线工艺训练」（断电改接）的分工：
 *   接线工艺 = 训练"怎么正确地把线接好"（操作规程）
 *   故障排查 = 训练"怎么从现象定位并排除故障"（诊断能力）
 *
 * 场景 = 一台"看似接好、实则带病"的装置：电源 / 可调电阻 / LED 都插上了，
 *        但存在故障（LED 极性接反）。学生要先"通电观察现象"，再用诊断提示
 *        定位故障、排除故障、恢复正确回路。
 *
 * 判分 = 结果判分（图同构）+ 过程判分（工艺评分表：是否先断电再修、线色、手法）
 *
 * 复用能力（引擎代码零改动）：
 *   1. diagnose.js 诊断式判分 —— 故障排查实验的"诊断提示"直接来自它
 *   2. craftGrade.js 工艺评分表 —— 修故障同样要遵守操作规程
 *   3. scene.wires / scene.components[].snap —— 预接线 + 预插元件
 */

import { DEF_LED } from '../circuit/componentLibrary.js'

const VF = DEF_LED.vf // 1.8 V
const RF = DEF_LED.rf // 20 Ω

export const SPEC = {
  id: 'fault-diagnosis-training',
  title: '故障排查与排除训练',
  subject: '实训基本功',
  summary:
    '一台"看似接好、实则带病"的装置：LED 极性接反导致不亮。先通电观察现象，再定位故障、断电检修、恢复正确回路。',

  /* 流程骨架沿用老师肯定的五环节，文案按"故障排查"主题改写 */
  steps: ['现象观察', '任务', '故障定位', '断电检修', '评分'],

  /*
   * 预置场景：电源 / R2 / LED 都已插上并接线，但 LED 极性接反（阳极接低电位）。
   * 学生先"开始计算"会看到 LED 不亮、电流为 0，诊断为极性反接。
   *
   * 孔位坐标说明见 wiring-craft-training.js。
   */
  scene: {
    components: [
      { defKey: 'vs', pos: { x: -1.3, y: 0.72, z: 0.5 } },
      { defKey: 'r2', pos: { x: 0.75, y: 0.72, z: -0.55 }, snap: true },
      { defKey: 'led', pos: { x: -0.39, y: 0.62, z: 0.13 }, snap: true },
    ],
    // 故障接线：电源正极 → R2 → LED 阴极（错！应接阳极）→ 回电源负极
    // 即 LED 反接，回路无正向电流，LED 不亮。
    wires: [
      { from: { comp: 'vs', pin: 'V+' }, to: { hole: 'F1-9' } },
      { from: { hole: 'F1-14' }, to: { comp: 'vs', pin: 'V-' } },
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

  /* 仪表：电压表并在 LED 两端，电流表串在 LED 支路 */
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

  /* 修故障同样要遵守"先断电再动手"的铁律 */
  procedure: {
    powerOffThreshold: 0.5,
    penalty: 15,
  },

  /* 工艺评分表：与接线工艺训练共用同一套多维判分 */
  craft: {
    wireColor: {
      pin: {
        'V+': 'pos',
        'V-': 'neg',
      },
    },
  },

  safety: {
    maxCurrent: 0.03,
    message:
      'LED 电流达 {i}mA，远超 {max}mA 额定值 —— 真实元件此时已经烧毁！',
  },

  hints: {
    notAnalyzed: '先点「开始 / 重新计算」，观察这台装置的故障现象',
    nextStep: '看诊断提示定位故障 → 断电 → 拔起 LED 对调两脚 → 复接 → 通电验证',
  },

  theory: {
    title: '故障排查要点',
    rows: (p) => [
      `正常时：I = (U − U_F) / (R2 + R_F) = (${p.U0} − ${VF}) / (R2 + ${RF})`,
      `排查顺序：先看现象（灯亮不亮）→ 再查方向（LED 极性）→ 再查回路（是否闭合）`,
    ],
    note: '故障排查铁律：先断电、再检修、确认无误后方可通电',
  },

  content: {
    preview: {
      title: '🔍 现象观察 · 故障排查训练',
      subtitle: '课前预习 —— 从"灯不亮"到"定位故障"的诊断思路',
      confirmText: '✔ 完成预习',
      html: `
      <div class="kp"><b>训练目的：</b>① 掌握"观察现象 → 定位故障 → 断电检修 → 通电验证"的排故流程；② 学会用仪表读数与系统诊断定位故障原因；③ 理解 LED 极性与回路闭合的重要性。</div>
      <div class="kp"><b>常见故障现象与原因：</b>灯不亮 → LED 极性反接 / 回路未闭合 / 限流电阻开路；灯很亮 → 缺少限流电阻（过流）；灯闪烁 → 接触不良（导线未插紧）。</div>
      <div class="kp"><b>排查口诀：</b>一看（现象）二量（仪表）三想（电路原理）四查（逐个元件）五改（断电检修）。</div>
      <div class="kp"><b>判分规则：</b>本实验既判<b>是否修对</b>（图同构），也判<b>检修过程</b>（是否带电操作、线色、手法）——先断电再动手是铁律。</div>`,
    },
    task: {
      title: '📝 任务书',
      subtitle: '任务书 · 故障排查与排除训练',
      confirmText: '领取任务 → 查看电路图',
      html: `
      <div class="kp">① 面前是一台<b>看似接好、实则带病</b>的装置：先点「开始 / 重新计算」通电观察现象；</div>
      <div class="kp">② <b>看现象</b>：LED 亮不亮？电流表读数是多少？</div>
      <div class="kp">③ <b>定位故障</b>：查看系统诊断提示，判断故障原因（提示：LED 极性反接）；</div>
      <div class="kp">④ <b>断电</b>：把电源调至 <b>0V</b>（低于 0.5V 才算断电）；</div>
      <div class="kp">⑤ <b>检修</b>：拔起 LED，对调两脚重新插好（阳极接高电位）；</div>
      <div class="kp">⑥ <b>通电验证</b>：调回 <b>+6V</b>，重新计算，确认 LED 正常点亮、记录 1 组数据。</div>`,
    },
    schematic: {
      title: '🔧 目标电路图',
      subtitle: '检修目标：恒压源 → R2（限流）→ LED（阳极朝上）→ 回到电源',
      confirmText: '开始故障排查',
      flashTip: '先观察现象 → 定位故障 → 断电 → 对调 LED 两脚 → 通电验证',
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
      <div class="kp" style="margin-top:12px"><b>操作方式：</b>进入连线模式（<b>W</b> 键），点导线的<b>金属端头</b>可拔起改接；拔起元件引脚需先断电。</div>
      <div class="kp"><b>提醒：</b>检修前务必断电（电源调 0V）；对调 LED 两脚时注意阳极（长脚/无平边）接高电位。</div>`,
    },
  },

  /* 结果判分：修对后应等于标准 LED 限流回路（拓扑等价即可） */
  grading: {
    requiredTypes: ['RHEO', 'LED'],
    typeNames: { RHEO: '电位器 R2', LED: '发光二极管 LED' },
    messages: {
      okMain: '故障排除：电路已恢复为标准限流回路（图同构匹配成功）',
      okSwapped: '故障排除：R2 与 LED 的串联顺序与图纸相反，但电气完全等效',
      missingSource: '未检测到电源，请检查恒压源接线',
      missingType: '回路中缺少限流电阻 R2 —— 直接给 LED 通电会烧毁元件',
      polarity: 'LED 极性仍未纠正（LED 不会导通）',
      structureMismatch: '检修后的结构不符合目标回路（R2 必须串联在回路中）',
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
