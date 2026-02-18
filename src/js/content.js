/**
 * DarkMode Pro - Content Script
 * 三层架构：基础反转 + 媒体保护 + 遮罩亮度
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

  // 检测元素是否有背景图片
  function hasBackgroundImage(el) {
    if (el.nodeType !== 1) return false;
    const style = el.getAttribute('style') || '';
    return style.includes('background-image') || style.includes('backgroundImage');
  }

  // 应用保护滤镜到元素
  function protectElement(el) {
    if (!el || el.dataset.dmProtected) return;
    
    const tag = el.tagName.toLowerCase();
    const needsProtection = 
      tag === 'img' || 
      tag === 'video' || 
      tag === 'canvas' || 
      tag === 'svg' || 
      tag === 'picture' ||
      tag === 'source' ||
      hasBackgroundImage(el);
    
    if (needsProtection) {
      el.style.filter = baseFilter;
      el.dataset.dmProtected = 'true';
    }
  }

  // 保护所有相关元素
  function protectAll() {
    if (!state.enabled) return;
    document.querySelectorAll('img, video, canvas, svg, picture, source').forEach(protectElement);
    // 检查所有有 style 属性的元素
    document.querySelectorAll('[style]').forEach(protectElement);
  }

  // 遮罩层透明度
  function getMaskOpacity() {
    return (100 - state.brightness) / 100;
  }

  // 注入样式
  function injectStyles() {
    let styleEl = document.getElementById(CONFIG.styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = CONFIG.styleId;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    
    const maskOpacity = getMaskOpacity();
    styleEl.textContent = `
      html[data-darkmode-pro="on"] {
        filter: ${baseFilter} !important;
        background: #fff !important;
        min-height: 100vh !important;
      }
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

  // 遮罩层
  function applyMask() {
    let mask = document.getElementById(CONFIG.maskId);
    if (!mask) {
      mask = document.createElement('div');
      mask.id = CONFIG.maskId;
      document.body.appendChild(mask);
    }
    mask.style.background = `rgba(0, 0, 0, ${getMaskOpacity()})`;
  }

  function removeMask() {
    const mask = document.getElementById(CONFIG.maskId);
    if (mask) mask.remove();
  }

  function removeStyles() {
    const styleEl = document.getElementById(CONFIG.styleId);
    if (styleEl) styleEl.remove();
    document.querySelectorAll('[data-dm-protected]').forEach(el => {
      el.style.filter = '';
      delete el.dataset.dmProtected;
    });
  }

  // 启用
  function enable() {
    state.enabled = true;
    document.documentElement.setAttribute('data-darkmode-pro', 'on');
    injectStyles();
    protectAll();
    if (document.body) applyMask();
    startObserver();
  }

  // 禁用
  function disable() {
    state.enabled = false;
    document.documentElement.removeAttribute('data-darkmode-pro');
    removeStyles();
    removeMask();
    stopObserver();
  }

  // MutationObserver
  let observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            protectElement(node);
            if (node.querySelectorAll) {
              node.querySelectorAll('img, video, canvas, svg, picture, source, [style]').forEach(protectElement);
            }
          }
        });
      });
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function toggle() {
    state.enabled ? disable() : enable();
    saveState();
    return state;
  }

  function update() {
    if (state.enabled) {
      injectStyles();
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
