# DarkMode Pro - 架构说明

## DarkMode Engine (DME) - 可复用的视觉状态机

### 核心设计原则

**❌ 传统夜间模式的问题**
```
toggle() → apply css → 修 bug → 再修 bug
```
命令式、非确定性、状态混乱

**✅ DarkMode Engine 的正确抽象**
```
INIT
  ↓
PENDING (预反转兜底)
  ↓
RESOLVED (ON | ALREADY_DARK | OFF)  ← 一次性决断，永不回退
  ↓
STABLE
```

### 状态机定义

```javascript
const VisualState = {
  INIT: 'init',                    // 脚本尚未介入
  PENDING: 'pending',              // document_start 兜底态（预反转）
  RESOLVED_ON: 'on',               // 确认反转
  RESOLVED_ALREADY_DARK: 'already-dark',  // 确认避让
  DISABLED: 'off'                  // 明确关闭
}
```

**铁律：**
1. 状态只前进，不回退
2. RESOLVED 只发生一次
3. PENDING 只做首帧兜底，最终样式以 RESOLVED_* 为准

### 架构分层

```
DarkModeEngine
├── State Machine        // 状态控制器（唯一真源）
├── Bootstrap Layer      // document_start 兜底（preboot + pending）
├── Resolver             // isAlreadyDark 判定
├── Style Layer          // CSS 注入（filter 在 html）
├── Mask Layer           // 亮度遮罩
└── Enhancement Layer    // Observer / Shadow DOM（延迟启动）
```

### 核心 API

```javascript
const engine = new DarkModeEngine({
  id: 'darkmode-pro',
  brightness: 100,
  canvasWhitelist: ['bilibili.com']
});

// 1. document_start 时调用
engine.bootstrap();

// 2. DOM ready 后一次性决断
await engine.resolve();

// 3. 手动控制
engine.enable();
engine.disable();
engine.toggle();

// 4. 更新配置
engine.update({ brightness: 80 });
```

### 渲染流程

```
document_start
    ↓
preboot.js → 读取 localStorage 快速缓存（enabled）→ 注入 pending 样式
    ↓
bootstrap() → 进入 PENDING，保持首帧兜底
    ↓
resolve() → DOM ready + 双 rAF 稳态后执行 isAlreadyDark() 判定
    ↓
    ├─→ 白站 → RESOLVED_ON → html filter: invert()
    │
    └─→ 暗黑站 → RESOLVED_ALREADY_DARK → 无 filter
    ↓
requestAnimationFrame x2 → 启动 Enhancement Layer
```

### 关键技术决策

#### 1. 在 html 层统一反转（配合媒体二次反转）
```css
html[data-darkmode-pro="on"] {
  filter: invert(1) hue-rotate(180deg);
}
```
原因：实现简单、兼容面广，并能与 preboot 的首帧兜底保持同构。

#### 2. pending 状态兜底
document_start 使用 `darkmode-pro-pending` + 预反转样式，避免刷新瞬间白屏：
```css
html.darkmode-pro-pending {
  background-color: #fff !important;
  filter: invert(1) hue-rotate(180deg) !important;
}
```
说明：兜底背景用 `#fff`，在整体反转后变为黑底，避免出现灰白底闪烁。

#### 3. 原子切换
```javascript
// ❌ 之前：中途可能撤销
toggle() → apply filter → setTimeout判定 → 可能撤销 → 闪烁

// ✅ 之后：一次性决断
resolve() → 判定 → applyState() → 不再修改
```

#### 4. 延迟 Enhancement
Observer 和 Shadow DOM 扫描延迟到首屏后：
```javascript
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    startObserver();
  });
});
```

#### 5. 刷新过程不主动清除视觉样式
不在 `beforeunload` 阶段执行 `engine.destroy()`，避免刷新时出现「黑 -> 白 -> 黑」的瞬时闪烁。

### 可移植性

这个 Engine 可以移植到：
- Chrome Extension (当前)
- Userscript (Tampermonkey)
- Web SDK (npm 包)
- Electron Preload
- iframe 内部

### 文件结构

```
src/
├── js/
│   ├── darkmode-engine.js    # 独立引擎（可复用）
│   ├── content.js            # Chrome 扩展入口
│   ├── background.js         # Service Worker
│   └── popup.js             # 弹出页
├── css/
│   └── popup.css
└── manifest.json
```

### 调试

```javascript
// 查看当前状态
engine.getState()  // 'pending' | 'on' | 'already-dark' | 'off'

// 监听状态变化
engine.onChange((prev, next) => {
  console.log(`${prev} -> ${next}`);
});
```
