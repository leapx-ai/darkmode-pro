/**
 * DarkMode Pro - 后台服务
 * 处理快捷键、标签页管理和全局设置。
 */

const isChromeExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

const STORAGE_KEY = 'darkmode_pro_global';
const LEGACY_DEFAULT_FILTERS = {
  brightness: 100,
  contrast: 100,
  sepia: 0,
  grayscale: 0
};
const EYE_CARE_DEFAULT_FILTERS = {
  brightness: 92,
  contrast: 95,
  sepia: 12,
  grayscale: 0
};
const DEFAULT_SETTINGS = {
  autoFollowSystem: true,
  defaultEnabled: false,
  excludeSites: [],
  globalBrightness: EYE_CARE_DEFAULT_FILTERS.brightness,
  globalContrast: EYE_CARE_DEFAULT_FILTERS.contrast,
  globalSepia: EYE_CARE_DEFAULT_FILTERS.sepia,
  globalGrayscale: EYE_CARE_DEFAULT_FILTERS.grayscale
};

const BLOCKED_SCHEMES = ['chrome://', 'edge://', 'about:', 'devtools://', 'chrome-extension://', 'view-source:'];

function isPageUrlAllowed(url) {
  if (!url) return false;
  return !BLOCKED_SCHEMES.some((scheme) => url.startsWith(scheme));
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (error) {
    return '';
  }
}

function normalizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const excludeSites = Array.isArray(merged.excludeSites) ? merged.excludeSites : [];
  merged.excludeSites = Array.from(
    new Set(
      excludeSites
        .map((host) => (typeof host === 'string' ? host.trim().toLowerCase() : ''))
        .filter(Boolean)
    )
  );
  return merged;
}

function isExcludedHost(hostname, settings) {
  if (!hostname) return false;
  return (settings.excludeSites || []).some((site) => {
    return hostname === site || hostname.endsWith(`.${site}`);
  });
}

function getSettings() {
  if (!chrome.storage?.sync) {
    return Promise.resolve(normalizeSettings(DEFAULT_SETTINGS));
  }

  return new Promise((resolve) => {
    chrome.storage.sync.get(STORAGE_KEY, (result) => {
      resolve(normalizeSettings(result?.[STORAGE_KEY]));
    });
  });
}

function usesLegacyGlobalFilters(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return Number(raw.globalBrightness) === LEGACY_DEFAULT_FILTERS.brightness &&
    Number(raw.globalContrast) === LEGACY_DEFAULT_FILTERS.contrast &&
    Number(raw.globalSepia) === LEGACY_DEFAULT_FILTERS.sepia &&
    Number(raw.globalGrayscale) === LEGACY_DEFAULT_FILTERS.grayscale;
}

function migrateLegacyGlobalDefaults() {
  if (!chrome.storage?.sync) return;

  chrome.storage.sync.get(STORAGE_KEY, (result) => {
    const raw = result?.[STORAGE_KEY];
    if (!usesLegacyGlobalFilters(raw)) return;

    const migrated = normalizeSettings({
      ...raw,
      globalBrightness: EYE_CARE_DEFAULT_FILTERS.brightness,
      globalContrast: EYE_CARE_DEFAULT_FILTERS.contrast,
      globalSepia: EYE_CARE_DEFAULT_FILTERS.sepia,
      globalGrayscale: EYE_CARE_DEFAULT_FILTERS.grayscale
    });

    chrome.storage.sync.set({ [STORAGE_KEY]: migrated }, () => {});
  });
}

function saveSettings(next) {
  if (!chrome.storage?.sync) {
    return Promise.resolve({ success: false, error: 'Storage not available' });
  }

  const normalized = normalizeSettings(next);
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: normalized }, () => {
      resolve({ success: true, settings: normalized });
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      resolve({ success: true, response });
    });
  });
}

function setBadge(tabId, enabled) {
  if (!chrome.action) return;
  chrome.action.setBadgeText({
    tabId,
    text: enabled ? 'ON' : ''
  }).catch(() => {});
  if (enabled) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' }).catch(() => {});
  }
}

const IconManager = {
  setIcon(tabId, enabled) {
    if (!isChromeExtension || !chrome.action) return;

    const iconSet = enabled ? 'icons/icon' : 'icons/icon-gray';
    const paths = {
      16: `${iconSet}16.png`,
      32: `${iconSet}32.png`,
      48: `${iconSet}48.png`,
      128: `${iconSet}128.png`
    };

    chrome.action.setIcon({ tabId, path: paths }).catch(() => {});
  }
};

function setVisualState(tabId, enabled) {
  IconManager.setIcon(tabId, enabled);
  setBadge(tabId, enabled);
}

async function getTab(tabId) {
  if (!chrome.tabs) return null;
  return chrome.tabs.get(tabId).catch(() => null);
}

async function getActiveTab() {
  if (!chrome.tabs) return null;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function excludeTab(tab, excluded) {
  if (!tab || !tab.id || !isPageUrlAllowed(tab.url)) {
    return { success: false, error: 'Unsupported tab' };
  }

  const hostname = getHostname(tab.url);
  if (!hostname) {
    return { success: false, error: 'Invalid hostname' };
  }

  const settings = await getSettings();
  const sites = new Set(settings.excludeSites || []);

  if (excluded) {
    sites.add(hostname);
  } else {
    sites.delete(hostname);
  }

  const saved = await saveSettings({
    ...settings,
    excludeSites: Array.from(sites)
  });

  if (!saved.success) return saved;

  if (excluded) {
    await sendTabMessage(tab.id, {
      action: 'setState',
      data: { enabled: false }
    });
    setVisualState(tab.id, false);
  }

  return {
    success: true,
    excluded,
    hostname
  };
}

const TabManager = {
  async toggle(tabId) {
    const tab = await getTab(tabId);
    if (!tab || !isPageUrlAllowed(tab.url)) {
      return { success: false, error: 'Unsupported tab' };
    }

    const settings = await getSettings();
    const hostname = getHostname(tab.url);
    if (isExcludedHost(hostname, settings)) {
      await sendTabMessage(tabId, {
        action: 'setState',
        data: { enabled: false }
      });
      setVisualState(tabId, false);
      return {
        success: false,
        excluded: true,
        hostname,
        enabled: false
      };
    }

    const result = await sendTabMessage(tabId, { action: 'toggle' });
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const response = result.response || { success: false, error: 'Empty response' };
    if (typeof response.enabled === 'boolean') {
      setVisualState(tabId, response.enabled);
    }
    return response;
  },

  async getState(tabId) {
    const tab = await getTab(tabId);
    if (!tab || !isPageUrlAllowed(tab.url)) {
      return { success: false, error: 'Unsupported tab' };
    }

    const settings = await getSettings();
    const hostname = getHostname(tab.url);
    if (isExcludedHost(hostname, settings)) {
      return {
        success: true,
        enabled: false,
        excluded: true,
        hostname
      };
    }

    const result = await sendTabMessage(tabId, { action: 'getState' });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return result.response || { success: false, error: 'Empty response' };
  },

  async update(tabId, data) {
    const tab = await getTab(tabId);
    if (!tab || !isPageUrlAllowed(tab.url)) {
      return { success: false, error: 'Unsupported tab' };
    }

    const settings = await getSettings();
    const hostname = getHostname(tab.url);
    if (isExcludedHost(hostname, settings)) {
      return {
        success: false,
        excluded: true,
        hostname
      };
    }

    const result = await sendTabMessage(tabId, {
      action: 'updateFilters',
      data
    });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return result.response || { success: false, error: 'Empty response' };
  },

  async reset(tabId) {
    const tab = await getTab(tabId);
    if (!tab || !isPageUrlAllowed(tab.url)) {
      return { success: false, error: 'Unsupported tab' };
    }

    const result = await sendTabMessage(tabId, { action: 'reset' });
    if (!result.success) {
      return { success: false, error: result.error };
    }

    setVisualState(tabId, false);
    return result.response || { success: false, error: 'Empty response' };
  },

  async applyToAll(enabled) {
    if (!chrome.tabs) return { success: false, error: 'Tabs not available' };

    const [tabs, settings] = await Promise.all([
      chrome.tabs.query({}),
      getSettings()
    ]);

    let touched = 0;
    let skippedExcluded = 0;

    for (const tab of tabs) {
      if (!tab.id || !isPageUrlAllowed(tab.url)) continue;

      const hostname = getHostname(tab.url);
      const excluded = enabled && isExcludedHost(hostname, settings);
      if (excluded) {
        skippedExcluded += 1;
        continue;
      }

      const result = await sendTabMessage(tab.id, {
        action: 'setState',
        data: { enabled: !!enabled }
      });
      if (result.success) {
        touched += 1;
        setVisualState(tab.id, !!enabled);
      }
    }

    return { success: true, touched, skippedExcluded };
  }
};

async function refreshTabVisuals(tabId, tabUrl) {
  const tab = tabUrl ? { id: tabId, url: tabUrl } : await getTab(tabId);
  if (!tab || !tab.id || !isPageUrlAllowed(tab.url)) {
    setVisualState(tabId, false);
    return;
  }

  const settings = await getSettings();
  const hostname = getHostname(tab.url);
  if (isExcludedHost(hostname, settings)) {
    setVisualState(tabId, false);
    return;
  }

  const result = await sendTabMessage(tab.id, { action: 'getState' });
  if (result.success && typeof result.response?.enabled === 'boolean') {
    setVisualState(tab.id, result.response.enabled);
  } else {
    setVisualState(tab.id, false);
  }
}

if (isChromeExtension && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' && chrome.storage?.sync) {
      chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
      try {
        chrome.notifications?.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'DarkMode Pro 已安装',
          message: '按 Alt+Shift+D 快速切换夜间模式，或在工具栏点击图标使用。'
        });
      } catch (error) {
        console.log('通知创建失败:', error);
      }
    }

    if (details.reason === 'update') {
      migrateLegacyGlobalDefaults();
    }
  });
}

if (isChromeExtension) {
  migrateLegacyGlobalDefaults();
}

if (isChromeExtension && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-darkmode') return;
    const tab = await getActiveTab();
    if (tab?.id) await TabManager.toggle(tab.id);
  });
}

if (isChromeExtension && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (tab?.id) {
      TabManager.toggle(tab.id);
    }
  });
}

if (isChromeExtension && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      refreshTabVisuals(tabId, tab?.url);
    }
  });
}

if (isChromeExtension && chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    refreshTabVisuals(activeInfo.tabId);
  });
}

if (isChromeExtension && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    (async () => {
      switch (request?.action) {
        case 'toggleCurrent': {
          const tab = await getActiveTab();
          if (!tab?.id) return sendResponse({ success: false, error: 'No active tab' });
          return sendResponse(await TabManager.toggle(tab.id));
        }

        case 'getCurrentState': {
          const tab = await getActiveTab();
          if (!tab?.id) return sendResponse({ success: false, error: 'No active tab' });
          return sendResponse(await TabManager.getState(tab.id));
        }

        case 'updateCurrent': {
          const tab = await getActiveTab();
          if (!tab?.id) return sendResponse({ success: false, error: 'No active tab' });
          return sendResponse(await TabManager.update(tab.id, request?.data || {}));
        }

        case 'resetCurrent': {
          const tab = await getActiveTab();
          if (!tab?.id) return sendResponse({ success: false, error: 'No active tab' });
          return sendResponse(await TabManager.reset(tab.id));
        }

        case 'applyToAllTabs':
          return sendResponse(await TabManager.applyToAll(!!request?.enabled));

        case 'excludeCurrentSite': {
          const tab = await getActiveTab();
          if (!tab?.id) return sendResponse({ success: false, error: 'No active tab' });
          return sendResponse(await excludeTab(tab, true));
        }

        case 'getSettings':
          return sendResponse(await getSettings());

        case 'saveSettings': {
          const saved = await saveSettings(request?.data || DEFAULT_SETTINGS);
          return sendResponse(saved.success ? { success: true } : saved);
        }

        default:
          return sendResponse({ success: false, error: `Unknown action: ${request?.action || 'empty'}` });
      }
    })().catch((error) => {
      sendResponse({ success: false, error: error?.message || String(error) });
    });

    return true;
  });
}

if (isChromeExtension && chrome.contextMenus) {
  const createContextMenus = () => {
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
  };

  if (chrome.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      chrome.contextMenus.removeAll(() => {
        createContextMenus();
      });
    });
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === 'toggleDarkMode') {
      TabManager.toggle(tab.id);
      return;
    }

    if (info.menuItemId === 'excludeSite') {
      excludeTab(tab, true);
      return;
    }

    if (info.menuItemId === 'resetSite') {
      TabManager.reset(tab.id);
    }
  });
}
