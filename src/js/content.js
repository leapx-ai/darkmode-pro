/**
 * DarkMode Pro - Content Script
 * Thin adapter around DarkModeEngine.
 */

const { DarkModeEngine } = require('./darkmode-engine');

(function () {
  'use strict';

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

  function getDomainCandidates(hostname) {
    if (!hostname) return [];
    const normalized = hostname.toLowerCase();
    const candidates = [normalized];
    const labels = normalized.split('.').filter(Boolean);

    for (let i = 1; i < labels.length - 1; i += 1) {
      candidates.push(labels.slice(i).join('.'));
    }

    const aliased = [];
    for (const candidate of candidates) {
      aliased.push(candidate);
      if (candidate.startsWith('www.')) {
        aliased.push(candidate.slice(4));
      } else {
        aliased.push(`www.${candidate}`);
      }
    }

    return Array.from(new Set(aliased));
  }

  function hasPersistedSiteState(prefixes) {
    const candidates = getDomainCandidates(location.hostname);

    for (const prefix of prefixes) {
      for (const candidate of candidates) {
        try {
          const raw = localStorage.getItem(`${prefix}${candidate}`);
          if (raw) return true;
        } catch (error) {
          return false;
        }
      }
    }
    return false;
  }

  function isExcludedSite(excludeSites = []) {
    const hostname = location.hostname.toLowerCase();
    return excludeSites.some((site) => {
      const normalized = String(site || '').trim().toLowerCase();
      if (!normalized) return false;
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  }

  function getGlobalSettings() {
    return new Promise((resolve) => {
      chrome.storage?.sync?.get?.(STORAGE_KEY, (result) => {
        resolve(result?.[STORAGE_KEY] || null);
      });
    });
  }

  function usesLegacyGlobalFilters(settings) {
    if (!settings || typeof settings !== 'object') return false;
    return Number(settings.globalBrightness) === LEGACY_DEFAULT_FILTERS.brightness &&
      Number(settings.globalContrast) === LEGACY_DEFAULT_FILTERS.contrast &&
      Number(settings.globalSepia) === LEGACY_DEFAULT_FILTERS.sepia &&
      Number(settings.globalGrayscale) === LEGACY_DEFAULT_FILTERS.grayscale;
  }

  if (window.__darkModeProInstalled) return;
  if (window.self !== window.top) return;
  window.__darkModeProInstalled = true;

  const engine = new DarkModeEngine({
    id: 'darkmode-pro',
    maskId: 'darkmode-pro-mask',
    canvasWhitelist: ['bilibili.com', 'live.bilibili.com', 'douyu.com', 'huya.com', 'twitch.tv']
  });

  engine.bootstrap();

  const syncGlobalSettings = async () => {
    const settings = await getGlobalSettings();
    if (!settings) return;

    if (isExcludedSite(settings.excludeSites || [])) {
      await engine.setEnabled(false);
      return;
    }

    const hasSiteState = hasPersistedSiteState(['darkmode-pro_state_', 'darkmode_pro_cache_']);
    if (hasSiteState) return;

    const shouldUpgradeLegacy = usesLegacyGlobalFilters(settings);
    const nextFilters = shouldUpgradeLegacy
      ? { ...EYE_CARE_DEFAULT_FILTERS }
      : {
        brightness: settings.globalBrightness,
        contrast: settings.globalContrast,
        sepia: settings.globalSepia,
        grayscale: settings.globalGrayscale
      };
    engine.update(nextFilters);

    const autoBySystem = (
      !!settings.autoFollowSystem &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
    const shouldEnable = !!settings.defaultEnabled || autoBySystem;
    if (shouldEnable) {
      await engine.setEnabled(true);
    }
  };

  const startResolve = () => {
    engine.resolve().catch((error) => {
      console.warn('[DMP] resolve failed:', error);
    });
  };

  startResolve();
  syncGlobalSettings().catch((error) => {
    console.warn('[DMP] sync settings failed:', error);
  });

  const messageHandlers = {
    async toggle() {
      await engine.toggle();
      return engine.getSnapshot();
    },

    async getState() {
      return engine.getSnapshot();
    },

    async setState(request) {
      const enabled = !!request?.data?.enabled;
      await engine.setEnabled(enabled);
      return engine.getSnapshot();
    },

    async updateFilters(request) {
      const snapshot = engine.update(request?.data || {});
      return { success: true, ...snapshot };
    },

    async update(request) {
      const snapshot = engine.update(request?.data || {});
      return { success: true, ...snapshot };
    },

    async reset() {
      return engine.reset();
    }
  };

  chrome.runtime?.onMessage?.addListener((request, _sender, sendResponse) => {
    const action = request?.action;
    const handler = action ? messageHandlers[action] : null;

    if (!handler) {
      sendResponse({ success: false, error: `Unknown action: ${action || 'empty'}` });
      return true;
    }

    Promise.resolve(handler(request))
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error?.message || String(error)
        });
      });

    return true;
  });

})();
