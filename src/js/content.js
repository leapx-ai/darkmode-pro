/**
 * DarkMode Pro - Content Script
 * 三层分离架构：CSS兜底 + JS增强 + 遮罩亮度
 */

(function() {
  'use strict';

  if (window.__darkModeProInstalled) return;
  window.__darkModeProInstalled = true;

  const CONFIG = {
    styleId: 'darkmode-pro-style',
    maskId: 'darkmode-pro-mask',
    whitelist: ['github.com', 'youtube.com', 'twitter.com', 'x.com', 'reddit.com', 'stackoverflow.com', 'discord.com'],
    nightModeDefaults: { brightness: 92, contrast: 100, sepia: 0, grayscale: 0 },
    // 【Canvas 白名单】弹幕/游戏场景：不反转 Canvas 保持原色
    canvasWhitelist: ['bilibili.com', 'live.bilibili.com', 'douyu.com', 'huya.com', 'twitch.tv']
  };

  const hostname = window.location.hostname.toLowerCase();
  if (CONFIG.whitelist.some(site => hostname === site || hostname.endsWith('.' + site))) return;

  const storageKey = `darkmode_state_${hostname}`;
  const baseFilter = 'invert(1) hue-rotate(180deg)';
  
  let state = {
    enabled: false,
    brightness: 100,
    contrast: 100,
    sepia: 0,
    grayscale: 0
  };

  // ==================== 立即执行：防止白屏闪烁 ====================
  // 这段代码在 document_start 时立即运行，HTML 解析前
  let isEnabled = false;
  
  // 尝试从 localStorage 快速读取（比 chrome.storage 快）
  try {
    const cached = localStorage.getItem('darkmode_pro_cache_' + hostname);
    if (cached) {
      const parsed = JSON.parse(cached);
      isEnabled = parsed.enabled;
      state.enabled = isEnabled;
    }
  } catch(e) {}

  // 如果启用，立即设置滤镜（在 CSS 加载前）
  if (isEnabled) {
    document.documentElement.setAttribute('data-darkmode-pro', 'on');
    // 【优化】移除强制 background，让浏览器按原色阶反转，保留层次感
    document.documentElement.style.cssText = `filter: ${baseFilter} !important; min-height: 100vh !important;`;
  }

  // ==================== 检测深色背景 ====================
  function isAlreadyDark() {
    try {
      const html = document.documentElement;
      const body = document.body;
      
      // 检查 html 和 body 的背景色
      const htmlBg = window.getComputedStyle(html).backgroundColor;
      const bodyBg = body ? window.getComputedStyle(body).backgroundColor : 'rgba(0,0,0,0)';
      
      // 解析颜色并计算亮度
      const getLuminance = (color) => {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return 1; // 默认认为浅色
        const [r, g, b] = match.slice(1).map(Number);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      };
      
      const htmlLum = getLuminance(htmlBg);
      const bodyLum = getLuminance(bodyBg);
      
      // 如果 html 或 body 背景是深色，认为是深色页面
      return htmlLum < 0.3 || bodyLum < 0.3;
    } catch (e) {
      return false; // 出错时默认按浅色处理
    }
  }

  // 生成 CSS（兜底层）
  function generateCSS() {
    const maskOpacity = (100 - state.brightness) / 100;
    
    // 【Canvas 白名单】弹幕/游戏站点不反转 Canvas
    const skipCanvas = CONFIG.canvasWhitelist.some(site => 
      hostname === site || hostname.endsWith('.' + site)
    );
    const mediaSelector = skipCanvas 
      ? ':is(img, video, svg)' 
      : ':is(img, video, canvas, svg)';
    
    return `
      /* 【优化】基础反转：移除 background: #fff，保留原色阶层次感 */
      html[data-darkmode-pro="on"] {
        filter: ${baseFilter} !important;
        min-height: 100vh !important;
      }
      
      /* 【优化】媒体保护：:is() 简化选择器，提升性能 */
      html[data-darkmode-pro="on"] ${mediaSelector} {
        filter: ${baseFilter} !important;
        mix-blend-mode: normal !important;
      }
      
      /* 【优化】遮罩处理：更精准，避免误伤小图标 */
      html[data-darkmode-pro="on"] :is([class*="mask"], [class*="gradient"], [class*="overlay"]):not(i, span, a, svg) {
        filter: ${baseFilter} !important;
        pointer-events: none !important;
      }
      
      /* 【优化】亮度遮罩：inset: 0 替代 top/left/width/height */
      #${CONFIG.maskId} {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, ${maskOpacity});
        pointer-events: none;
        z-index: 2147483647;
      }
    `;
  }

  // 注入 CSS
  function injectCSS() {
    let styleEl = document.getElementById(CONFIG.styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = CONFIG.styleId;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = generateCSS();
  }

  // 移除 CSS
  function removeCSS() {
    const styleEl = document.getElementById(CONFIG.styleId);
    if (styleEl) styleEl.remove();
  }

  // JS增强：处理动态背景图（内联样式）
  function protectBackgroundImage(el) {
    if (el.dataset.dmBgFixed) return;
    const style = el.getAttribute('style');
    if (style && style.includes('background-image') && style.includes('url')) {
      el.style.filter = baseFilter;
      el.dataset.dmBgFixed = 'true';
    }
  }

  // 【增强】检测外部 CSS 设置的背景图（Vue/React class 切换场景）
  const computedBgChecked = new WeakSet();
  function checkExternalBackgroundImage(el) {
    if (computedBgChecked.has(el)) return;
    
    try {
      const computed = window.getComputedStyle(el);
      const bgImage = computed.backgroundImage;
      
      // 有背景图但不是内联设置的
      if (bgImage && bgImage.includes('url') && bgImage !== 'none' && !el.dataset.dmBgFixed) {
        // 进一步检查：元素有实际尺寸且可见
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50 && computed.visibility !== 'hidden') {
          el.style.filter = baseFilter;
          el.dataset.dmBgFixed = 'true';
          computedBgChecked.add(el);
        }
      }
    } catch (e) {
      // 某些元素可能无法访问计算样式（跨域 iframe 等）
    }
  }

  // 【优化】Shadow DOM 注入：精简核心逻辑，仅处理明确媒体元素
  function injectShadowStyles(root) {
    if (root.querySelector(`#${CONFIG.styleId}-shadow`)) return;
    
    const styleEl = document.createElement('style');
    styleEl.id = `${CONFIG.styleId}-shadow`;
    styleEl.textContent = `
      /* 仅处理最明确的媒体元素 */
      :is(img, video, svg) {
        filter: ${baseFilter} !important;
      }
      /* 解决 Shadow DOM 内部背景图 */
      [style*="background-image"] {
        filter: ${baseFilter} !important;
      }
    `;
    root.appendChild(styleEl);
  }

  // 【优化】递归扫描 Shadow DOM（BFS 队列，WeakSet 防重入）
  const shadowScanned = new WeakSet();
  function scanShadowDOM(node) {
    if (shadowScanned.has(node)) return;
    shadowScanned.add(node);
    
    const queue = [node];
    let count = 0;
    const MAX_SCAN = 500; // 适度限制
    
    while (queue.length > 0 && count < MAX_SCAN) {
      const current = queue.shift();
      count++;
      
      if (current.shadowRoot && !shadowScanned.has(current.shadowRoot)) {
        shadowScanned.add(current.shadowRoot);
        injectShadowStyles(current.shadowRoot);
      }
      
      if (current.querySelectorAll) {
        current.querySelectorAll('*').forEach(el => {
          if (!shadowScanned.has(el)) queue.push(el);
        });
      }
    }
  }

  // 应用遮罩到 documentElement
  function applyMask() {
    let mask = document.getElementById(CONFIG.maskId);
    if (!mask) {
      mask = document.createElement('div');
      mask.id = CONFIG.maskId;
      document.documentElement.appendChild(mask);
    }
    mask.style.background = `rgba(0, 0, 0, ${(100 - state.brightness) / 100})`;
  }

  function removeMask() {
    const mask = document.getElementById(CONFIG.maskId);
    if (mask) mask.remove();
  }

  // MutationObserver - 精准监测背景图
  let observer = null;
  let scanPending = false;
  
  // 【优化】异步扫描调度：requestIdleCallback 避免阻塞渲染
  function scheduleScan() {
    if (scanPending) return;
    scanPending = true;
    
    // 优先使用 requestIdleCallback，不支持则退化到 setTimeout
    const runner = typeof requestIdleCallback !== 'undefined' 
      ? requestIdleCallback 
      : (cb) => setTimeout(cb, 100);
    
    runner(() => {
      scanShadowDOM(document.body);
      initProtection();
      scanPending = false;
    });
  }
  
  function startObserver() {
    if (observer) return;
    
    observer = new MutationObserver((mutations) => {
      let needsScan = false;
      
      mutations.forEach((mutation) => {
        // childList 变化 - 标记需要扫描，批量处理
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          needsScan = true;
        }
        // 仅针对内联 style 变化进行快速处理
        else if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          protectBackgroundImage(mutation.target);
        }
      });
      
      if (needsScan) scheduleScan();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    // 【优化】重置扫描状态
    scanPending = false;
    // 清理标记
    document.querySelectorAll('[data-dm-bg-fixed]').forEach(el => {
      delete el.dataset.dmBgFixed;
    });
  }

  // 初始化保护
  function initProtection() {
    // 初始扫描现有元素（内联样式）
    document.querySelectorAll('[style]').forEach(protectBackgroundImage);
    
    // 【增强】扫描常见可能使用背景图的元素（外部 CSS）
    document.querySelectorAll('div, section, article, a, span').forEach(el => {
      checkExternalBackgroundImage(el);
    });
  }

  // 启用
  function enable() {
    // 先设置状态，确保状态一致性
    state.enabled = true;
    
    // 检测深色背景，仅作记录，不阻止启用（用户可能想强制开启）
    if (isAlreadyDark()) {
      console.log('DarkMode Pro: 检测到页面已经是深色背景');
    }
    
    document.documentElement.setAttribute('data-darkmode-pro', 'on');
    injectCSS();
    initProtection();
    scanShadowDOM(document.body); // 扫描现有 Shadow DOM
    applyMask();
    startObserver();
  }

  // 禁用
  function disable() {
    state.enabled = false;
    document.documentElement.removeAttribute('data-darkmode-pro');
    removeCSS();
    removeMask();
    stopObserver();
    // 清理动态添加的滤镜
    document.querySelectorAll('[style*="filter"]').forEach(el => {
      if (el.dataset.dmBgFixed) {
        el.style.filter = '';
        delete el.dataset.dmBgFixed;
      }
    });
  }

  function toggle() {
    state.enabled ? disable() : enable();
    saveState();
    return state;
  }

  function update() {
    if (state.enabled) {
      injectCSS();
      applyMask();
    }
    saveState();
  }

  function saveState() {
    chrome.storage.local.set({ [storageKey]: { ...state, userCustomized: true } });
    try {
      localStorage.setItem('darkmode_pro_cache_' + hostname, JSON.stringify({ enabled: state.enabled }));
    } catch(e) {}
  }

  async function loadState() {
    try {
      const result = await chrome.storage.local.get(storageKey);
      const saved = result[storageKey];
      if (saved) {
        state = saved;
      } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        state.enabled = true;
        state.brightness = CONFIG.nightModeDefaults.brightness;
      }
    } catch(e) {}
  }

  // 消息处理
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'toggle':
        sendResponse(toggle());
        break;
      case 'getState':
        sendResponse({ ...state });
        break;
      case 'setState':
        state = { ...state, ...request.data };
        state.enabled ? enable() : disable();
        saveState();
        sendResponse({ success: true });
        break;
      case 'updateFilters':
        state = { ...state, ...request.data };
        update();
        sendResponse({ success: true });
        break;
      case 'reset':
        const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const defaults = isSystemDark ? CONFIG.nightModeDefaults : { brightness: 100, contrast: 100, sepia: 0, grayscale: 0 };
        state = { enabled: false, ...defaults };
        disable();
        saveState();
        sendResponse({ ...state });
        break;
    }
    return true;
  });

  // 初始化
  async function init() {
    await loadState();
    if (state.enabled) enable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
