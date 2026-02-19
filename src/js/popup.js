/**
 * DarkMode Pro - Popup 交互逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
  const EYE_CARE_DEFAULT_FILTERS = {
    brightness: 92,
    contrast: 95,
    sepia: 12,
    grayscale: 0
  };

  // ==================== DOM 元素 ====================
  const elements = {
    powerBtn: document.getElementById('powerBtn'),
    statusText: document.getElementById('statusText'),
    applyAllBtn: document.getElementById('applyAllBtn'),
    resetBtn: document.getElementById('resetBtn'),
    excludeBtn: document.getElementById('excludeBtn'),
    resetFiltersBtn: document.getElementById('resetFiltersBtn'),
    
    brightnessSlider: document.getElementById('brightnessSlider'),
    contrastSlider: document.getElementById('contrastSlider'),
    sepiaSlider: document.getElementById('sepiaSlider'),
    grayscaleSlider: document.getElementById('grayscaleSlider'),
    
    brightnessValue: document.getElementById('brightnessValue'),
    contrastValue: document.getElementById('contrastValue'),
    sepiaValue: document.getElementById('sepiaValue'),
    grayscaleValue: document.getElementById('grayscaleValue'),
    
    autoFollowSystem: document.getElementById('autoFollowSystem'),
    siteName: document.getElementById('siteName'),
    menuBtn: document.getElementById('menuBtn'),
    githubLink: document.getElementById('githubLink'),
    helpLink: document.getElementById('helpLink')
  };

  // ==================== 状态管理 ====================
  let currentState = {
    enabled: false,
    brightness: EYE_CARE_DEFAULT_FILTERS.brightness,
    contrast: EYE_CARE_DEFAULT_FILTERS.contrast,
    sepia: EYE_CARE_DEFAULT_FILTERS.sepia,
    grayscale: EYE_CARE_DEFAULT_FILTERS.grayscale
  };
  let isExcludedSite = false;

  let currentTab = null;

  // ==================== 工具函数 ====================
  const Utils = {
    // 更新 UI 状态
    updateUI() {
      elements.powerBtn.disabled = isExcludedSite;

      // 更新电源按钮
      if (isExcludedSite) {
        elements.powerBtn.classList.remove('active');
        elements.statusText.textContent = '已排除';
        elements.statusText.classList.remove('active');
      } else if (currentState.enabled) {
        elements.powerBtn.classList.add('active');
        elements.statusText.textContent = '已开启';
        elements.statusText.classList.add('active');
      } else {
        elements.powerBtn.classList.remove('active');
        elements.statusText.textContent = '已关闭';
        elements.statusText.classList.remove('active');
      }

      // 更新滑块
      elements.brightnessSlider.value = currentState.brightness;
      elements.contrastSlider.value = currentState.contrast;
      elements.sepiaSlider.value = currentState.sepia;
      elements.grayscaleSlider.value = currentState.grayscale;

      // 更新数值显示
      elements.brightnessValue.textContent = `${currentState.brightness}%`;
      elements.contrastValue.textContent = `${currentState.contrast}%`;
      elements.sepiaValue.textContent = `${currentState.sepia}%`;
      elements.grayscaleValue.textContent = `${currentState.grayscale}%`;
    },

    // 显示临时提示
    showTooltip(message, duration = 2000) {
      const tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      tooltip.textContent = message;
      tooltip.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--accent);
        color: #fff;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
        z-index: 1000;
        animation: fadeInUp 0.3s ease;
      `;
      document.body.appendChild(tooltip);

      setTimeout(() => {
        tooltip.style.animation = 'fadeOutDown 0.3s ease';
        setTimeout(() => tooltip.remove(), 300);
      }, duration);
    }
  };

  // ==================== 初始化 ====================
  async function init() {
    try {
      // 获取当前标签页
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTab = tabs[0];

      if (currentTab) {
        // 更新网站名称显示
        try {
          const url = new URL(currentTab.url);
          elements.siteName.textContent = url.hostname;
        } catch {
          elements.siteName.textContent = '当前页面';
        }

        // 获取当前状态
        const state = await chrome.runtime.sendMessage({ action: 'getCurrentState' });
        if (state && !state.error) {
          isExcludedSite = !!state.excluded;
          currentState = {
            ...currentState,
            ...state,
            enabled: isExcludedSite ? false : !!state.enabled
          };
          Utils.updateUI();
        }
      }

      // 加载设置
      const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (settings) {
        elements.autoFollowSystem.checked = settings.autoFollowSystem;
      }
    } catch (error) {
      console.error('初始化失败:', error);
    }
  }

  // ==================== 事件监听 ====================

  // 电源按钮 - 切换夜间模式
  elements.powerBtn.addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'toggleCurrent' });
      if (result?.excluded) {
        isExcludedSite = true;
        currentState.enabled = false;
        Utils.updateUI();
        Utils.showTooltip('当前网站在排除列表中');
        return;
      }

      if (result && !result.error) {
        isExcludedSite = false;
        currentState.enabled = result.enabled;
        Utils.updateUI();
      }
    } catch (error) {
      console.error('切换失败:', error);
      Utils.showTooltip('切换失败，请刷新页面后重试');
    }
  });

  // 应用到所有标签页
  elements.applyAllBtn.addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'applyToAllTabs', 
        enabled: currentState.enabled 
      });
      if (result?.success) {
        if (result.skippedExcluded > 0) {
          Utils.showTooltip(`已应用，跳过 ${result.skippedExcluded} 个排除站点`);
        } else {
          Utils.showTooltip('已应用到所有标签页');
        }
      }
    } catch (error) {
      console.error('应用失败:', error);
    }
  });

  // 重置按钮
  elements.resetBtn.addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'resetCurrent' });
      if (result) {
        currentState = result;
        Utils.updateUI();
        Utils.showTooltip('已重置为默认设置');
      }
    } catch (error) {
      console.error('重置失败:', error);
    }
  });

  // 排除网站
  elements.excludeBtn.addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'excludeCurrentSite' });
      if (result?.success) {
        isExcludedSite = true;
        currentState.enabled = false;
        Utils.updateUI();
        Utils.showTooltip(`已将 ${result.hostname} 添加到排除列表`);
      }
    } catch (error) {
      console.error('排除失败:', error);
    }
  });

  // 重置滤镜
  elements.resetFiltersBtn.addEventListener('click', async () => {
    currentState.brightness = EYE_CARE_DEFAULT_FILTERS.brightness;
    currentState.contrast = EYE_CARE_DEFAULT_FILTERS.contrast;
    currentState.sepia = EYE_CARE_DEFAULT_FILTERS.sepia;
    currentState.grayscale = EYE_CARE_DEFAULT_FILTERS.grayscale;
    
    await updateFilters();
    Utils.showTooltip('滤镜已重置');
  });

  // 滑块变化 - 亮度
  elements.brightnessSlider.addEventListener('input', async (e) => {
    currentState.brightness = parseInt(e.target.value);
    elements.brightnessValue.textContent = `${currentState.brightness}%`;
    await updateFilters();
  });

  // 滑块变化 - 对比度
  elements.contrastSlider.addEventListener('input', async (e) => {
    currentState.contrast = parseInt(e.target.value);
    elements.contrastValue.textContent = `${currentState.contrast}%`;
    await updateFilters();
  });

  // 滑块变化 - 暖色调
  elements.sepiaSlider.addEventListener('input', async (e) => {
    currentState.sepia = parseInt(e.target.value);
    elements.sepiaValue.textContent = `${currentState.sepia}%`;
    await updateFilters();
  });

  // 滑块变化 - 灰度
  elements.grayscaleSlider.addEventListener('input', async (e) => {
    currentState.grayscale = parseInt(e.target.value);
    elements.grayscaleValue.textContent = `${currentState.grayscale}%`;
    await updateFilters();
  });

  // 更新滤镜
  async function updateFilters() {
    if (isExcludedSite) return;

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'updateCurrent', 
        data: {
          brightness: currentState.brightness,
          contrast: currentState.contrast,
          sepia: currentState.sepia,
          grayscale: currentState.grayscale
        }
      });
      if (result?.excluded) {
        isExcludedSite = true;
        currentState.enabled = false;
        Utils.updateUI();
        Utils.showTooltip('当前网站在排除列表中');
      }
    } catch (error) {
      console.error('更新滤镜失败:', error);
    }
  }

  // 自动跟随系统主题
  elements.autoFollowSystem.addEventListener('change', async (e) => {
    try {
      const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (settings) {
        settings.autoFollowSystem = e.target.checked;
        await chrome.runtime.sendMessage({ 
          action: 'saveSettings', 
          data: settings 
        });
        Utils.showTooltip(e.target.checked ? '已开启自动跟随' : '已关闭自动跟随');
      }
    } catch (error) {
      console.error('保存设置失败:', error);
    }
  });

  // 菜单按钮
  elements.menuBtn.addEventListener('click', () => {
    Utils.showTooltip('更多功能开发中...');
  });

  // GitHub 链接
  elements.githubLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/leapx-ai/darkmode-pro' });
  });

  // 帮助链接
  elements.helpLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/leapx-ai/darkmode-pro#readme' });
  });

  // ==================== 添加 CSS 动画 ====================
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
    @keyframes fadeOutDown {
      from {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      to {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
      }
    }
  `;
  document.head.appendChild(style);

  // ==================== 启动 ====================
  await init();
});
