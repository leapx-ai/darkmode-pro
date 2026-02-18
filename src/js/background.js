/**
 * DarkMode Pro - 后台服务
 * 处理快捷键、标签页管理和全局设置
 */

// ==================== 配置常量 ====================
const STORAGE_KEY = 'darkmode_pro_global';
const DEFAULT_SETTINGS = {
  autoFollowSystem: true,
  defaultEnabled: false,
  excludeSites: [],
  globalBrightness: 100,
  globalContrast: 100,
  globalSepia: 0,
  globalGrayscale: 0
};

// ==================== 图标管理 ====================
const IconManager = {
  setIcon(tabId, enabled) {
    const iconSet = enabled ? 'icons/icon' : 'icons/icon-gray';
    const paths = {
      16: `${iconSet}16.png`,
      32: `${iconSet}32.png`,
      48: `${iconSet}48.png`,
      128: `${iconSet}128.png`
    };
    
    chrome.action.setIcon({
      tabId: tabId,
      path: paths
    }).catch(() => {
      // 忽略错误（如标签页已关闭）
    });
  }
};

// ==================== 标签页管理 ====================
const TabManager = {
  // 切换指定标签页的夜间模式
  async toggle(tabId) {
    try {
      // 检查标签页是否有效
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
        return;
      }

      // 实际切换
      chrome.tabs.sendMessage(tabId, { action: 'toggle' }, (response) => {
        if (chrome.runtime.lastError) {
          // 内容脚本未加载（白名单网站或刷新中），静默处理
          console.log('TabManager.toggle: 内容脚本不可用', chrome.runtime.lastError.message);
          return;
        }
        
        if (response) {
          IconManager.setIcon(tabId, response.enabled);
          // 更新徽章
          chrome.action.setBadgeText({
            tabId: tabId,
            text: response.enabled ? 'ON' : ''
          });
          chrome.action.setBadgeBackgroundColor({
            color: '#4CAF50'
          });
        }
      });
    } catch (error) {
      console.log('TabManager.toggle error:', error);
    }
  },

  // 应用到所有标签页
  async applyToAll(enabled) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'setState', 
          data: { enabled } 
        }, (response) => {
          if (chrome.runtime.lastError) {
            // 内容脚本未加载，跳过
            return;
          }
          if (response) {
            IconManager.setIcon(tab.id, enabled);
          }
        });
      }
    }
  }
};

// ==================== 事件监听 ====================

// 扩展安装/更新
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装，设置默认配置
    chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    
    // 显示欢迎通知
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'DarkMode Pro 已安装',
      message: '按 Alt+Shift+D 快速切换夜间模式，或在工具栏点击图标使用。'
    });
  }
});

// 快捷键命令
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-darkmode') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        TabManager.toggle(tabs[0].id);
      }
    });
  }
});

// 工具栏图标点击
chrome.action.onClicked.addListener((tab) => {
  TabManager.toggle(tab.id);
});

// 标签页更新时恢复状态
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // 恢复图标状态
    chrome.tabs.sendMessage(tabId, { action: 'getState' }, (response) => {
      if (chrome.runtime.lastError) {
        // 内容脚本未加载，静默处理
        return;
      }
      if (response) {
        IconManager.setIcon(tabId, response.enabled);
        chrome.action.setBadgeText({
          tabId: tabId,
          text: response.enabled ? 'ON' : ''
        });
      }
    });
  }
});

// 标签页切换时更新图标
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.sendMessage(activeInfo.tabId, { action: 'getState' }, (response) => {
    if (chrome.runtime.lastError) {
      // 内容脚本未加载，重置图标
      IconManager.setIcon(activeInfo.tabId, false);
      chrome.action.setBadgeText({ tabId: activeInfo.tabId, text: '' });
      return;
    }
    if (response) {
      IconManager.setIcon(activeInfo.tabId, response.enabled);
      chrome.action.setBadgeText({
        tabId: activeInfo.tabId,
        text: response.enabled ? 'ON' : ''
      });
    }
  });
});

// 处理来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'toggleCurrent':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message });
              return;
            }
            if (response) {
              IconManager.setIcon(tabs[0].id, response.enabled);
              chrome.action.setBadgeText({
                tabId: tabs[0].id,
                text: response.enabled ? 'ON' : ''
              });
            }
            sendResponse(response);
          });
        }
      });
      return true;

    case 'getCurrentState':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'getState' }, (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message });
              return;
            }
            sendResponse(response);
          });
        } else {
          sendResponse(null);
        }
      });
      return true;

    case 'updateCurrent':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { 
            action: 'updateFilters', 
            data: request.data 
          }, (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message });
              return;
            }
            sendResponse(response);
          });
        }
      });
      return true;

    case 'resetCurrent':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'reset' }, (response) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message });
              return;
            }
            IconManager.setIcon(tabs[0].id, false);
            chrome.action.setBadgeText({ tabId: tabs[0].id, text: '' });
            sendResponse(response);
          });
        }
      });
      return true;

    case 'applyToAllTabs':
      TabManager.applyToAll(request.enabled);
      sendResponse({ success: true });
      return true;

    case 'getSettings':
      chrome.storage.sync.get(STORAGE_KEY, (result) => {
        sendResponse(result[STORAGE_KEY] || DEFAULT_SETTINGS);
      });
      return true;

    case 'saveSettings':
      chrome.storage.sync.set({ [STORAGE_KEY]: request.data }, () => {
        sendResponse({ success: true });
      });
      return true;
  }
});

// 上下文菜单（右键菜单）
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'toggleDarkMode',
    title: '切换夜间模式',
    contexts: ['page']
  });
  
  chrome.contextMenus.create({
    id: 'separator1',
    type: 'separator',
    contexts: ['page']
  });
  
  chrome.contextMenus.create({
    id: 'excludeSite',
    title: '在当前网站禁用',
    contexts: ['page']
  });
  
  chrome.contextMenus.create({
    id: 'resetSite',
    title: '重置当前网站设置',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'toggleDarkMode':
      TabManager.toggle(tab.id);
      break;
    case 'excludeSite':
      const hostname = new URL(tab.url).hostname;
      chrome.storage.sync.get(STORAGE_KEY, (result) => {
        const settings = result[STORAGE_KEY] || DEFAULT_SETTINGS;
        if (!settings.excludeSites.includes(hostname)) {
          settings.excludeSites.push(hostname);
          chrome.storage.sync.set({ [STORAGE_KEY]: settings });
        }
      });
      break;
    case 'resetSite':
      const siteHostname = new URL(tab.url).hostname;
      chrome.storage.local.remove(`darkmode_state_${siteHostname}`);
      break;
  }
});
