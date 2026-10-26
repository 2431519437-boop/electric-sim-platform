# 3D 电工电子虚拟仿真实训平台

基于 **Vue 3 + Vite + Three.js** 的电路仿真教学平台，包含自研的**并查集拓扑识别**与**直流电路求解算法**。

## 快速开始

```bash
npm install
npm run dev      # 开发模式，默认 http://localhost:5173
npm run build    # 生产构建
npm run preview  # 预览构建产物
```

**环境要求**：Node.js ≥ 18（推荐 20 / 22）、npm ≥ 9。

**国内网络**下载依赖较慢时：`npm install --registry=https://registry.npmmirror.com`。
若 npm 全局缓存目录无写权限，可改用项目内缓存：
`npm install --cache ./.npm-cache --registry=https://registry.npmmirror.com`。

打开页面会自动弹出「实验预习」引导，依次点击「完成预习 → 领取任务 → 开始自主连线」进入 3D 场景。

## 自检脚本（无需浏览器）

```bash
node scripts/check-core.mjs        # 校验：并查集拓扑 / 网表 / 节点电压法 / 短路检测
node scripts/check-components.mjs  # 校验：5 类元件几何 / 引脚世界坐标 / 孔位磁吸
```

两个脚本都会打印关键中间结果并与理论值比对（例如 6V、200Ω + 470Ω 时 U₂ = 4.209V、I = 8.955mA），
最后输出 ✅ 表示通过。

## 功能对照

### 一、基础 3D 场景与元件
| 功能 | 实现位置 |
|---|---|
| 3D 渲染（面包板、电阻、电源、LED、电位器、开关） | `src/circuit/componentLibrary.js` |
| 相机自由视角：左键旋转、右键平移、滚轮缩放 | `src/components/sceneEngine.js` → `_init()` |
| 元件拖拽：左键拖动元件 | `sceneEngine.js` → `_onPointerDown/_onPointerMove` |
| 元件旋转：右键拖动或滚轮旋转元件 | `sceneEngine.js` → `_onPointerMove` / `_onWheel` |
| 孔位磁吸：靠近孔位松手自动吸附对齐 | `src/circuit/pinResolver.js` → `trySnap()` |

### 二、核心自研算法（答辩重点）
| 功能 | 实现位置 |
|---|---|
| **引脚自动识别** —— 3D 空间计算判断引脚插入哪个孔 | `pinResolver.js` → `resolvePins()` |
| **并查集拓扑识别**（创新点 1）—— 识别铜条连通关系，把物理孔位划分成电气节点 | `src/circuit/unionFindTopo.js` → `buildElectricalNodes()` |
| **自动生成网表** —— 把并查集结果转成类 SPICE 网表字符串 | `src/circuit/circuitCore.js` → `generateNetlist()` |
| **电路求解**（创新点 2）—— 节点电压法 + 高斯消元，算出节点电压与支路电流 | `circuitCore.js` → `solveCircuit()` |
| **接线拓扑等价判定**（创新点 3）—— 带标签多重图的**图同构匹配**（VF2 回溯），判定学生接线是否与标准电路电气等价 | `src/circuit/graphMatch.js` → `evaluateWiring()` |

#### 创新点 3 补充说明：为什么用图同构，而不用"逐根导线比对"

学生插的孔位、拉的导线走向千差万别，但在串联电路里：

- R1 与 R2 **互换位置**，测得的 U(R2)、I 完全一致 → 必须判对
- 学生从板子左端接线还是右端接线，走线绕几圈 → 与正确性无关
- 真正要判的是"**电气结构**是否等价"

于是把电路抽象成**带标签的多重图**：

| 图的元素 | 对应物理对象 | 标签 |
|---|---|---|
| 顶点 | 一个电气节点（并查集输出的 N0/N1/…） | 无 |
| 边 | 一个元件 | 类型（VSRC/RES/RHEO/LED）+ 参数；电源、LED 带方向 |

再用回溯法（VF2 思路）在标准答案图与学生电路图之间找**顶点双射**：度数序列剪枝 → 按度数降序逐个映射 → 每对已映射顶点之间的边必须同标签、同数量、同方向。匹配成功即"拓扑等价"，与孔位编号、导线根数完全无关。

判定的六种结论：

1. 完全等价（图同构成功）
2. R1/R2 串联顺序相反，电气等效（匹配到第二标准图）
3. 多接元件（回路里多串了 LED）
4. 回路未闭合（存在度数 1 的悬空端点，会指出是哪个节点）
5. 参数不符（结构对但 R1 不是 200Ω）
6. 并联错接（元件两端落在同一对节点上）

自检：`npm run check:graph`（8 个场景 + 顶点编号无关性验证，9/9 通过）

### 三、导线功能
| 功能 | 实现位置 |
|---|---|
| 导线模式：左上角按钮 或 按 W 键切换 | `ThreeScene.vue` → `toggleMode()` |
| 多种连线：引脚→孔位 / 引脚→引脚 / 孔位→孔位 | `sceneEngine.js` → `_pickEndpoint()` |
| 真实曲线效果：CatmullRom 样条拱起弧线，弧度随距离自适应 | `sceneEngine.js` → `_updateWireGeometry()` |
| 动态跟随：拖动元件时导线橡皮筋式拉伸 | `sceneEngine.js` → `refreshWiresOf()` |
| 颜色轮换：红黑蓝绿黄白六色循环 | `sceneEngine.js` → `WIRE_COLORS` |

### 四、实验流程与 UI
| 功能 | 实现位置 |
|---|---|
| 五步实验流程（预习→任务→电路图→记录数据→评分） | `src/components/LabFlow.vue` + `App.vue` |
| 器件库（点击添加元件） | `src/components/DeviceLibrary.vue` |
| 电压表 / 电流表实时读数 | `src/components/MeterPanel.vue` |
| 计算过程控制台（实时打印，同时输出到 F12） | `src/components/ConsolePanel.vue` |
| 评分报告（得分、星级、实测 vs 理论对比、结论） | `src/components/ReportModal.vue` |

## 算法原理

### 1. 并查集拓扑识别

面包板内部存在多条金属铜条，同一铜条上的插孔电气互通。平台把三类元素纳入并查集：

- `hole:<板ID>:<孔ID>` —— 面包板插孔
- `pin:<元件ID>:<引脚名>` —— 元件引脚
- 导线连接 —— 两端端点合并

**拓扑来源**：
1. 面包板铜条结构（`breadboardModel.js` → `generateHoleGroups()`）
2. 元件引脚插入的孔位（磁吸时记录）
3. 用户绘制的导线

最终每个并查集集合即一个**电气节点 N0, N1, N2...**。

**短路检测**：若电源正极引脚与负极引脚落在同一节点，则判定短路。

### 2. 电路求解（改进节点电压法 MNA）

- **未知量**：各节点电压（除参考地）+ 电压源支路电流
- **电阻元件**：以电导 G = 1/R 进行 stamping
- **LED**：建模为正向压降 Vf + 等效串联电阻 Rf
- **开关**：闭合 0.001Ω / 断开 1e9Ω
- **求解**：高斯消元（部分主元）

输出每个节点电压与每条支路电流，用于仪表读数和 LED 点亮判断。

## 目录结构

```
electric-sim-platform/
├── index.html
├── package.json
├── vite.config.js
├── scripts/                       # 自检脚本（node 直接运行，不需要浏览器）
│   ├── check-core.mjs             # 算法链：拓扑 → 网表 → 求解
│   └── check-components.mjs       # 元件几何 + 引脚磁吸
├── public/models/                 # 预留：可替换为 Blender 导出的 GLB 模型
└── src/
    ├── main.js
    ├── style.css
    ├── App.vue                    # 主入口：流程编排、状态管理、算法调度
    ├── circuit/                   # ★ 算法层
    │   ├── breadboardModel.js     # 面包板几何与铜条拓扑
    │   ├── pinResolver.js         # 引脚识别与孔位磁吸
    │   ├── unionFindTopo.js       # 并查集拓扑识别（创新点 1）
    │   ├── graphMatch.js          # 图同构接线判定（创新点 3）
    │   └── circuitCore.js         # 网表生成 + 电路求解（创新点 2）
    └── components/
        ├── sceneEngine.js         # 3D 场景引擎（非 Vue 逻辑层）
        ├── ThreeScene.vue         # 3D 画布组件
        ├── LabFlow.vue            # 实验流程侧栏
        ├── DeviceLibrary.vue      # 器件库与参数面板
        ├── MeterPanel.vue         # 仪表读数
        ├── ConsolePanel.vue       # 计算过程控制台
        ├── FlowModal.vue          # 通用流程弹窗
        └── ReportModal.vue        # 实验报告
```

## 操作说明

| 操作 | 说明 |
|---|---|
| 左键拖动元件 | 移动元件，靠近孔位松手自动吸附 |
| 右键拖动元件 | 单独旋转该元件 |
| 滚轮（悬停元件上） | 旋转该元件 |
| 左键拖动空白处 | 旋转镜头 |
| 右键拖动空白处 | 平移镜头 |
| 滚轮 | 缩放 |
| 按 `W` 或点左上角按钮 | 切换导线模式 |
| 导线模式下点击引脚/孔位 | 依次点两个端点完成连线 |

## 替换为 Blender 模型

平台当前使用程序化几何保证零外部依赖。若要接入 Blender 导出的 GLB：

1. 将 GLB 放入 `public/models/`
2. 在 `componentLibrary.js` 中把对应 `build()` 改为 `GLTFLoader` 加载
3. **保持 `pins` 的 `offset` 与模型实际引脚位置一致**（决定引脚识别精度）

## 技术栈

- Vue 3.4（Composition API + `<script setup>`）
- Three.js 0.160（WebGL 渲染、OrbitControls、实例化网格）
- Vite 5（构建与热更新）
