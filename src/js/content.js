/**
 * DarkMode Pro - 内容脚本
 * 纯 CSS 方案，document_start 时立即执行
 */

(function() {
  'use strict';

  // 防止重复注入
  if (window.__darkModeProInstalled) return;
  window.__darkModeProInstalled = true;

  // ==================== 配置 ====================
  const CONFIG = {
    styleId: 'darkmode-pro-style',
    nativeDarkSites: [
      'github.com', 'youtube.com', 'twitter.com', 'x.com',
      'reddit.com', 'stackoverflow.com', 'discord.com'
    ],
    // 夜间模式优化配置
    nightModeDefaults: {
      brightness: 92,    // 降低亮度，减少刺眼
      contrast: 88,      // 降低对比度，更柔和
      sepia: 20,         // 增加暖色调，减少蓝光
      grayscale: 0       // 保持色彩
    }
  };

  // ==================== 立即执行：防止白屏闪烁 ====================
  // 这段代码在 document_start 时立即运行，HTML 解析前
  const hostname = window.location.hostname.toLowerCase();
  const isNativeDark = CONFIG.nativeDarkSites.some(site => 
    hostname === site || hostname.endsWith('.' + site)
  );

  // 白名单网站直接退出
  if (isNativeDark) return;

  // ==================== 系统夜间模式检测 ====================
  function isSystemNightMode() {
    return window.matchMedia && 
           window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  // 立即检测系统夜间模式
  const isNight = isSystemNightMode();

  // 立即从 storage 读取状态（同步方式尽可能快）
  let isEnabled = false;
  const storageKey = `darkmode_state_${hostname}`;
  
  // 尝试从 localStorage 快速读取（比 chrome.storage 快）
  try {
    const cached = localStorage.getItem('darkmode_pro_cache_' + hostname);
    if (cached) {
      const parsed = JSON.parse(cached);
      isEnabled = parsed.enabled;
    }
  } catch(e) {}

  // 如果启用，立即设置背景（在 CSS 加载前）
  if (isEnabled) {
    // 使用属性选择器标记
    document.documentElement.setAttribute('data-darkmode-pro', 'on');
    // 使用夜间优化配置生成滤镜
    const config = isNight ? CONFIG.nightModeDefaults : { brightness: 100, contrast: 100, sepia: 0, grayscale: 0 };
    const immediateFilter = `invert(1) hue-rotate(180deg) brightness(${config.brightness}%) contrast(${config.contrast}%) sepia(${config.sepia}%) grayscale(${config.grayscale}%)`;
    // 内联样式最快生效 - 确保占满视口
    const htmlStyle = document.documentElement.style;
    htmlStyle.cssText = `filter: ${immediateFilter} !important; background: #fff !important; min-height: 100vh !important;`;
  }

  // ==================== 状态管理 ====================
  // 如果是系统夜间模式，使用优化配置，否则使用默认配置
  const defaultConfig = isNight ? CONFIG.nightModeDefaults : {
    brightness: 100,
    contrast: 100,
    sepia: 0,
    grayscale: 0
  };

  let state = {
    enabled: isEnabled,
    brightness: defaultConfig.brightness,
    contrast: defaultConfig.contrast,
    sepia: defaultConfig.sepia,
    grayscale: defaultConfig.grayscale
  };

  // ==================== CSS 生成器 ====================
  function generateStyles() {
    const { brightness, contrast, sepia, grayscale, enabled } = state;
    
    if (!enabled) return '';
    
    const filter = `invert(1) hue-rotate(180deg) brightness(${brightness}%) contrast(${contrast}%) sepia(${sepia}%) grayscale(${grayscale}%)`;

    return `
      /* DarkMode Pro */
      
      /* 确保 html 和 body 占满整个视口 */
      html[data-darkmode-pro="on"] {
        min-height: 100vh !important;
        height: auto !important;
        background: #fff !important; /* 白色会被反转成黑色 */
      }
      
      html[data-darkmode-pro="on"] body {
        min-height: 100vh !important;
        height: auto !important;
        background: #fff !important;
        margin: 0 !important;
      }
      
      /* 滤镜应用到 html */
      html[data-darkmode-pro="on"] {
        filter: ${filter} !important;
      }
      
      /* 保护媒体元素 */
      html[data-darkmode-pro="on"] img,
      html[data-darkmode-pro="on"] video,
      html[data-darkmode-pro="on"] canvas,
      html[data-darkmode-pro="on"] svg,
      html[data-darkmode-pro="on"] picture {
        filter: ${filter} !important;
      }
      
      /* 保护背景图片 */
      html[data-darkmode-pro="on"] [style*="background-image"] {
        filter: ${filter} !important;
      }
      
      /* iframe */
      html[data-darkmode-pro="on"] iframe {
        filter: ${filter} !important;
        opacity: 0.95;
      }
      
      /* 滚动条 */
      html[data-darkmode-pro="on"] ::-webkit-scrollbar {
        background-color: #1a1a1a !important;
        width: 12px !important;
        height: 12px !important;
      }
      
      html[data-darkmode-pro="on"] ::-webkit-scrollbar-thumb {
        background-color: #444 !important;
        border-radius: 6px !important;
      }
    `;
  }

  // ==================== 样式管理 ====================
  const StyleManager = {
    inject() {
      let styleEl = document.getElementById(CONFIG.styleId);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = CONFIG.styleId;
        // 插入到 head 最前面，确保优先级
        const head = document.head || document.documentElement;
        if (head.firstChild) {
          head.insertBefore(styleEl, head.firstChild);
        } else {
          head.appendChild(styleEl);
        }
      }
      styleEl.textContent = generateStyles();
    },

    remove() {
      const styleEl = document.getElementById(CONFIG.styleId);
      if (styleEl) {
        styleEl.remove();
      }
      document.documentElement.style.cssText = '';
    },

    update() {
      this.inject();
      // 更新内联样式 - 确保占满视口
      if (state.enabled) {
        const { brightness, contrast, sepia, grayscale } = state;
        const filter = `invert(1) hue-rotate(180deg) brightness(${brightness}%) contrast(${contrast}%) sepia(${sepia}%) grayscale(${grayscale}%)`;
        document.documentElement.style.cssText = 
          `filter: ${filter} !important; background: #fff !important; min-height: 100vh !important;`;
      }
    }
  };

  // ==================== 夜间模式控制 ====================
  const DarkMode = {
    enable() {
      document.documentElement.setAttribute('data-darkmode-pro', 'on');
      StyleManager.update();
      // 缓存状态到 localStorage（更快读取）
      try {
        localStorage.setItem('darkmode_pro_cache_' + hostname, JSON.stringify({ enabled: true }));
      } catch(e) {}
    },

    disable() {
      document.documentElement.removeAttribute('data-darkmode-pro');
      StyleManager.remove();
      try {
        localStorage.setItem('darkmode_pro_cache_' + hostname, JSON.stringify({ enabled: false }));
      } catch(e) {}
    },

    toggle() {
      state.enabled = !state.enabled;
      if (state.enabled) {
        this.enable();
      } else {
        this.disable();
      }
      return state;
    }
  };

  // ==================== 消息处理 ====================
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'toggle':
        const result = DarkMode.toggle();
        saveState();
        sendResponse(result);
        break;

      case 'setState':
        state = { ...state, ...request.data };
        if (state.enabled) {
          DarkMode.enable();
        } else {
          DarkMode.disable();
        }
        saveState();
        sendResponse({ success: true });
        break;

      case 'getState':
        sendResponse({ ...state });
        break;

      case 'updateFilters':
        state = { ...state, ...request.data };
        StyleManager.update();
        saveState();
        sendResponse({ success: true });
        break;

      case 'reset':
        // 根据当前系统主题设置默认值
        const resetConfig = isSystemNightMode() ? CONFIG.nightModeDefaults : {
          brightness: 100, contrast: 100, sepia: 0, grayscale: 0
        };
        state = {
          enabled: false,
          brightness: resetConfig.brightness,
          contrast: resetConfig.contrast,
          sepia: resetConfig.sepia,
          grayscale: resetConfig.grayscale
        };
        DarkMode.disable();
        saveState();
        sendResponse({ ...state });
        break;
    }
    return true;
  });

  function saveState() {
    // 保存完整状态，标记为用户自定义
    const dataToSave = { ...state, userCustomized: true };
    chrome.storage.local.set({ [storageKey]: dataToSave });
    try {
      localStorage.setItem('darkmode_pro_cache_' + hostname, JSON.stringify({ enabled: state.enabled }));
    } catch(e) {}
  }

  // ==================== 异步加载完整状态 ====================
  async function init() {
    try {
      const result = await chrome.storage.local.get(storageKey);
      const saved = result[storageKey];
      if (saved) {
        // 如果用户有自定义配置，使用保存的配置
        // 否则保持当前根据系统主题设置的默认值
        if (saved.userCustomized) {
          state = saved;
        }
        if (state.enabled) {
          DarkMode.enable();
        }
      }
    } catch(e) {}
  }

  // 立即注入基础样式
  StyleManager.inject();
  
  // 异步加载完整状态
  init();
})();
