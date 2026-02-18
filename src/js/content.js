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
    nightModeDefaults: { brightness: 92, contrast: 100, sepia: 0, grayscale: 0 }
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
    document.documentElement.style.cssText = `filter: ${baseFilter} !important; background: #fff !important; min-height: 100vh !important;`;
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
    return `
      /* 基础反转 */
      html[data-darkmode-pro="on"] {
        filter: ${baseFilter} !important;
        background: #fff !important;
        min-height: 100vh !important;
      }
      
      /* CSS兜底：静态图片/视频保护
       * 注意：只选择最终渲染元素，不选容器（如picture/source），避免三重反转
       */
      html[data-darkmode-pro="on"] img,
      html[data-darkmode-pro="on"] video,
      html[data-darkmode-pro="on"] canvas,
      html[data-darkmode-pro="on"] svg {
        filter: ${baseFilter} !important;
      }
      
      /* B站优化：处理视频卡片遮罩层，避免半透明黑变白 */
      html[data-darkmode-pro="on"] .bili-video-card__mask,
      html[data-darkmode-pro="on"] [class*="mask"]:not([class*="mask-icon"]):not([class*="icon"]) {
        filter: ${baseFilter} !important;
      }
      
      /* 亮度遮罩 - 挂载在 html 下避免 body 高度问题 */
      #${CONFIG.maskId} {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
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

  // JS增强：处理动态背景图
  function protectBackgroundImage(el) {
    if (el.dataset.dmBgFixed) return;
    const style = el.getAttribute('style');
    if (style && style.includes('background-image') && style.includes('url')) {
      el.style.filter = baseFilter;
      el.dataset.dmBgFixed = 'true';
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
  function startObserver() {
    if (observer) return;
    
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // 监测新增节点
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              // 检查节点本身
              protectBackgroundImage(node);
              // 检查子节点
              if (node.querySelectorAll) {
                node.querySelectorAll('[style]').forEach(protectBackgroundImage);
              }
            }
          });
        }
        // 监测 style 属性变化
        else if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const target = mutation.target;
          if (target.style.backgroundImage?.includes('url') && !target.dataset.dmBgFixed) {
            target.style.filter = baseFilter;
            target.dataset.dmBgFixed = 'true';
          }
        }
      });
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
    // 清理标记
    document.querySelectorAll('[data-dm-bg-fixed]').forEach(el => {
      delete el.dataset.dmBgFixed;
    });
  }

  // 初始化保护
  function initProtection() {
    // 初始扫描现有元素
    document.querySelectorAll('[style]').forEach(protectBackgroundImage);
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
