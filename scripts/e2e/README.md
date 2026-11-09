# 端到端测试（需要浏览器）

这三个测试通过 CDP 驱动真实浏览器（无头 Edge/Chrome），验证 3D 交互与实验选择页。
与 `scripts/check-*.mjs` 不同，它们**不能**直接用 node 跑，需要先起服务。

## 前置准备

1. 启动开发服务器（端口必须是 5199）

   ```bash
   npm run dev -- --port 5199 --strictPort
   ```

2. 启动带远程调试的浏览器（端口 9222）

   ```bash
   "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ^
     --headless=new --disable-gpu --remote-debugging-port=9222 ^
     --user-data-dir=%TEMP%\edge-e2e ^
     --window-size=1280,860 http://127.0.0.1:5199/
   ```

## 运行

```bash
node scripts/e2e/picker.test.mjs   # 实验选择页：进入/切换/回退
node scripts/e2e/wires.test.mjs    # 导线选中与单独删除
node scripts/e2e/undo.test.mjs     # 删除导线后撤销
node scripts/e2e/erase.test.mjs    # 三模式切换 + 删除灵敏度（屏幕空间拾取）
node scripts/e2e/hint.test.mjs     # 「使用提示」按实验配置给文案
node scripts/e2e/led.test.mjs      # 第三个实验（LED 限流）装载与数据表
```

## 说明

- `picker.test.mjs` 会自行导航到不同 URL，页面开在哪无所谓。
- `wires.test.mjs` / `undo.test.mjs` 会先导航到
  `?exp=series-voltage-divider`，因为它们按串联实验的元件布局取引脚坐标。
- 若更换了预置元件位置或改成竖屏，引脚投影坐标会变，测试需同步调整。
- 点击优先走 CDP 真实输入管线；若无头环境未投递，会自动回退到合成 PointerEvent，
  输出末尾会标明本次用的是哪种方式。
