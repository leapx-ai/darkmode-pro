/**
 * DarkMode Pro - Preboot Script
 * Minimal first-frame guard to avoid white flash on reload.
 */

(function () {
  'use strict';

  if (window.self !== window.top) return;
  if (window.__darkModeProPrebootApplied) return;
  window.__darkModeProPrebootApplied = true;

  const CONFIG = {
    id: 'darkmode-pro',
    canvasWhitelist: ['bilibili.com', 'live.bilibili.com', 'douyu.com', 'huya.com', 'twitch.tv']
  };

  function getDomainCandidates(hostname) {
    if (!hostname) return [];
    const normalized = hostname.toLowerCase();
    const candidates = [normalized];

    const labels = normalized.split('.').filter(Boolean);
    for (let i = 1; i < labels.length - 1; i += 1) {
      candidates.push(labels.slice(i).join('.'));
    }

    // Common canonical pair: root <-> www.root
    const withAliases = [];
    for (const candidate of candidates) {
      withAliases.push(candidate);
      if (candidate.startsWith('www.')) {
        withAliases.push(candidate.slice(4));
      } else {
        withAliases.push(`www.${candidate}`);
      }
    }

    return Array.from(new Set(withAliases));
  }

  function parseStoredState(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function findStateByPrefix(prefix, hostname) {
    for (const candidate of getDomainCandidates(hostname.toLowerCase())) {
      const parsed = parseStoredState(localStorage.getItem(`${prefix}${candidate}`));
      if (parsed) return parsed;
    }
    return null;
  }

  function readCachedEnabled() {
    const hostname = location.hostname.toLowerCase();

    try {
      const state = findStateByPrefix(`${CONFIG.id}_state_`, hostname);
      if (state && typeof state.enabled === 'boolean') {
        return state.enabled;
      }
    } catch (error) {
      // ignore storage errors
    }

    try {
      const legacy = findStateByPrefix('darkmode_pro_cache_', hostname);
      if (legacy) {
        return !!legacy.enabled;
      }
    } catch (error) {
      // ignore storage errors
    }

    return false;
  }

  if (!readCachedEnabled()) return;

  const html = document.documentElement;
  if (!html) return;

  const pendingClass = 'darkmode-pro-pending';
  const prebootStyleId = `${CONFIG.id}-preboot`;
  const skipCanvas = CONFIG.canvasWhitelist.some((site) => {
    return location.hostname === site || location.hostname.endsWith(`.${site}`);
  });
  const mediaSelector = skipCanvas ? 'img, video, svg' : 'img, video, canvas, svg';

  html.classList.add(pendingClass);
  html.style.minHeight = '100vh';

  let styleEl = document.getElementById(prebootStyleId);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = prebootStyleId;
    (document.head || html).appendChild(styleEl);
  }

  styleEl.textContent = `
    html.${pendingClass} {
      background-color: #fff !important;
      filter: invert(1) hue-rotate(180deg) !important;
    }
    html.${pendingClass} :is(${mediaSelector}) {
      filter: invert(1) hue-rotate(180deg) !important;
    }
  `;
})();
