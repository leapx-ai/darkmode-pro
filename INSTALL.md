# 安装指南

## 从源码构建安装

### 前置要求

- Node.js 16+ 
- npm 或 yarn

### 步骤 1：克隆仓库

```bash
git clone https://github.com/yourusername/darkmode-pro.git
cd darkmode-pro
```

### 步骤 2：安装依赖

```bash
npm install
```

### 步骤 3：构建扩展

```bash
# 开发模式（带 source map）
npm run build:dev

# 或生产模式（代码压缩）
npm run build
```

构建完成后，代码会在 `dist/` 目录中。

### 步骤 4：加载到 Chrome

1. 打开 Chrome 扩展管理页：`chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `darkmode-extension/dist` 文件夹

### 步骤 5：固定到工具栏

1. 点击 Chrome 工具栏的「扩展程序」图标（拼图图标）
2. 找到「DarkMode Pro」
3. 点击「固定」图标（图钉）

---

## 开发模式

### 热重载开发

```bash
npm run dev
```

此模式会监听文件变化并自动重新编译。修改源代码后，只需在 Chrome 扩展页面点击刷新按钮即可看到效果。

### 调试技巧

1. **Content Script 调试**
   - 在网页上右键 → 检查
   - 切换到 Sources 面板
   - 找到 `chrome-extension://` 开头的文件

2. **Background Script 调试**
   - 打开 `chrome://extensions/`
   - 找到 DarkMode Pro，点击「Service Worker」

3. **Popup 调试**
   - 右键点击扩展图标
   - 选择「检查弹出内容」

---

## 快捷键设置

默认快捷键：`Alt + Shift + D`

如需修改：
1. 打开 `chrome://extensions/shortcuts`
2. 找到 DarkMode Pro
3. 修改「切换夜间模式」的快捷键

---

## 故障排除

### npm install 失败

```bash
# 清除缓存重试
npm cache clean --force
rm -rf node_modules
npm install
```

### 构建失败

```bash
# 清理后重新构建
npm run clean
npm run build
```

### 扩展不工作

1. 确保已执行 `npm run build` 且 dist/ 目录存在
2. 刷新网页后重试
3. 检查扩展是否已启用（扩展管理页面）
4. 查看 Background Script 控制台是否有错误

### 某些网站显示异常

1. 将该网站添加到排除列表
2. 调整滤镜参数（降低对比度）
3. 向开发者反馈

---

## 打包发布

```bash
# 生成 ZIP 文件
npm run zip
```

输出文件：`releases/darkmode-pro-v1.0.0.zip`

此文件可用于：
- 提交到 Chrome Web Store
- 手动分发安装
