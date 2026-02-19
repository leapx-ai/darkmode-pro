/**
 * DarkMode Engine
 * Single source of truth for content-side dark rendering.
 */

const VisualState = {
  INIT: 'init',
  PENDING: 'pending',
  RESOLVED_ON: 'on',
  RESOLVED_ALREADY_DARK: 'already-dark',
  DISABLED: 'off'
};

const DEFAULT_FILTERS = {
  brightness: 92,
  contrast: 95,
  sepia: 12,
  grayscale: 0
};

const LEGACY_CACHE_PREFIX = 'darkmode_pro_cache_';
const PENDING_CLASS = 'darkmode-pro-pending';

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function parseRGB(color) {
  if (!color || color === 'transparent') return null;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (!match) return null;

  return {
    r: clamp(match[1], 0, 255, 0),
    g: clamp(match[2], 0, 255, 0),
    b: clamp(match[3], 0, 255, 0),
    a: match[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(match[4]) || 0))
  };
}

function luminance(rgb) {
  if (!rgb) return null;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function isTransparent(rgb) {
  return !rgb || rgb.a === 0;
}

function getDomainCandidates(hostname) {
  if (!hostname) return [];

  const normalized = hostname.toLowerCase();
  const candidates = [normalized];

  const labels = normalized.split('.').filter(Boolean);
  for (let i = 1; i < labels.length - 1; i += 1) {
    candidates.push(labels.slice(i).join('.'));
  }

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
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {
    // ignore malformed JSON
  }
  return null;
}

class StateController {
  constructor() {
    this.state = VisualState.INIT;
  }

  transition(next) {
    if (this.state === next) return false;

    if (this.isResolved() && next !== VisualState.DISABLED) {
      return false;
    }

    this.state = next;
    return true;
  }

  isResolved() {
    return this.state === VisualState.RESOLVED_ON ||
      this.state === VisualState.RESOLVED_ALREADY_DARK;
  }

  getState() {
    return this.state;
  }
}

class PersistenceLayer {
  constructor(config) {
    this.config = config;
  }

  _statePrefix() {
    return `${this.config.id}_state_`;
  }

  _legacyPrefix() {
    return LEGACY_CACHE_PREFIX;
  }

  _hostCandidates() {
    return getDomainCandidates(location.hostname);
  }

  _findStateByPrefix(prefix) {
    const candidates = this._hostCandidates();

    for (const candidate of candidates) {
      const found = parseStoredState(localStorage.getItem(`${prefix}${candidate}`));
      if (found) return found;
    }
    return null;
  }

  load() {
    const defaults = {
      enabled: false,
      ...DEFAULT_FILTERS
    };

    try {
      const parsed = this._findStateByPrefix(this._statePrefix());
      if (parsed) {
        return { ...defaults, ...parsed };
      }
    } catch (e) {
      // ignore storage parsing failures
    }

    try {
      const parsed = this._findStateByPrefix(this._legacyPrefix());
      if (parsed && typeof parsed.enabled === 'boolean') {
        return { ...defaults, enabled: parsed.enabled };
      }
    } catch (e) {
      // ignore legacy parsing failures
    }

    return defaults;
  }

  save(state) {
    try {
      const payload = JSON.stringify(state);
      const legacyPayload = JSON.stringify({ enabled: !!state.enabled });
      const candidates = this._hostCandidates();

      for (const candidate of candidates) {
        localStorage.setItem(`${this._statePrefix()}${candidate}`, payload);
        localStorage.setItem(`${this._legacyPrefix()}${candidate}`, legacyPayload);
      }
    } catch (e) {
      // ignore storage write failures
    }
  }
}

class DarkModeEngine {
  constructor(config = {}) {
    this.config = {
      id: config.id || 'darkmode-pro',
      maskId: config.maskId || 'darkmode-pro-mask',
      canvasWhitelist: config.canvasWhitelist || [],
      ...config
    };

    this.stateCtrl = new StateController();
    this.persistence = new PersistenceLayer(this.config);

    this.siteState = this._normalizeState(this.persistence.load());

    this.baseFilter = 'invert(1) hue-rotate(180deg)';
    this.pendingStyleId = `${this.config.id}-pending`;
    this.prebootStyleId = `${this.config.id}-preboot`;
    this.shadowStyleId = `${this.config.id}-shadow`;
    this.toneMaskId = `${this.config.id}-tone-mask`;
    this.pendingPrevMinHeight = null;

    this.observer = null;
    this.resolvingPromise = null;
  }

  bootstrap() {
    this.siteState = this._normalizeState(this.persistence.load());

    if (this.siteState.enabled) {
      this.stateCtrl.transition(VisualState.PENDING);
      this._mountPending();
    } else {
      this.stateCtrl.transition(VisualState.DISABLED);
      this._cleanupVisuals();
    }

    return this;
  }

  async resolve() {
    if (this.resolvingPromise) return this.resolvingPromise;

    this.resolvingPromise = this._resolveInternal().finally(() => {
      this.resolvingPromise = null;
    });

    return this.resolvingPromise;
  }

  async _resolveInternal() {
    if (!this.siteState.enabled) {
      this._applyDisabled();
      return this.stateCtrl.getState();
    }

    await this._waitForDomReady();
    await this._waitForStablePaint();

    const isDark = this._detectAlreadyDark();
    const nextState = isDark
      ? VisualState.RESOLVED_ALREADY_DARK
      : VisualState.RESOLVED_ON;

    this._applyResolved(nextState);
    return nextState;
  }

  async enable() {
    this.siteState.enabled = true;
    this._persist();

    if (!this.stateCtrl.isResolved()) {
      this.stateCtrl.transition(VisualState.PENDING);
      this._mountPending();
      await this.resolve();
      return this;
    }

    const nextState = this._detectAlreadyDark()
      ? VisualState.RESOLVED_ALREADY_DARK
      : VisualState.RESOLVED_ON;

    this._applyResolved(nextState);
    return this;
  }

  disable() {
    this.siteState.enabled = false;
    this._persist();
    this._applyDisabled();
    return this;
  }

  async toggle() {
    if (this.siteState.enabled) {
      this.disable();
      return this;
    }

    return this.enable();
  }

  async setEnabled(enabled) {
    if (enabled) return this.enable();
    this.disable();
    return this;
  }

  update(next = {}) {
    const previousEnabled = this.siteState.enabled;

    this.siteState = this._normalizeState({
      ...this.siteState,
      ...next,
      enabled: previousEnabled
    });

    this._persist();

    if (this.siteState.enabled && this.stateCtrl.isResolved()) {
      this._renderResolved(this.stateCtrl.getState());
    } else if (!this.siteState.enabled) {
      this._cleanupVisuals();
    }

    return this.getSnapshot();
  }

  reset() {
    this.siteState = {
      enabled: false,
      ...DEFAULT_FILTERS
    };
    this._persist();
    this._applyDisabled();
    return this.getSnapshot();
  }

  destroy() {
    this._stopEnhancement();
    this._cleanupVisuals();
    this.stateCtrl.transition(VisualState.DISABLED);
  }

  getState() {
    return this.stateCtrl.getState();
  }

  isResolved() {
    return this.stateCtrl.isResolved();
  }

  isEnabled() {
    return this.siteState.enabled;
  }

  getSnapshot() {
    return {
      enabled: this.siteState.enabled,
      brightness: this.siteState.brightness,
      contrast: this.siteState.contrast,
      sepia: this.siteState.sepia,
      grayscale: this.siteState.grayscale,
      state: this.stateCtrl.getState()
    };
  }

  _normalizeState(raw = {}) {
    return {
      enabled: !!raw.enabled,
      brightness: clamp(raw.brightness, 0, 100, DEFAULT_FILTERS.brightness),
      contrast: clamp(raw.contrast, 50, 200, DEFAULT_FILTERS.contrast),
      sepia: clamp(raw.sepia, 0, 100, DEFAULT_FILTERS.sepia),
      grayscale: clamp(raw.grayscale, 0, 100, DEFAULT_FILTERS.grayscale)
    };
  }

  _persist() {
    this.persistence.save(this.siteState);
  }

  _applyResolved(state) {
    this.stateCtrl.transition(state);
    this._renderResolved(state);

    if (state === VisualState.RESOLVED_ON) {
      this._startEnhancement();
    } else {
      this._stopEnhancement();
    }
  }

  _renderResolved(state) {
    const html = document.documentElement;

    if (state === VisualState.RESOLVED_ON) {
      html.setAttribute('data-darkmode-pro', 'on');
    } else if (state === VisualState.RESOLVED_ALREADY_DARK) {
      html.setAttribute('data-darkmode-pro', 'already-dark');
    } else {
      html.removeAttribute('data-darkmode-pro');
    }

    this._injectCSS(state);
    this._unmountPending();
    this._applyMask(state);
  }

  _applyDisabled() {
    this.stateCtrl.transition(VisualState.DISABLED);
    this._stopEnhancement();
    this._cleanupVisuals();
  }

  _cleanupVisuals() {
    document.documentElement.removeAttribute('data-darkmode-pro');
    this._unmountPending();

    const styleEl = document.getElementById(this.config.id);
    if (styleEl) styleEl.remove();

    const mask = document.getElementById(this.config.maskId);
    if (mask) mask.remove();

    const toneMask = document.getElementById(this.toneMaskId);
    if (toneMask) toneMask.remove();
  }

  _mountPending() {
    const html = document.documentElement;
    if (this.pendingPrevMinHeight === null) {
      this.pendingPrevMinHeight = html.style.minHeight || '';
    }
    html.classList.add(PENDING_CLASS);
    html.style.minHeight = '100vh';

    let styleEl = document.getElementById(this.pendingStyleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = this.pendingStyleId;
      (document.head || document.documentElement).appendChild(styleEl);
    }

    const mediaSelector = this._getMediaSelector();
    styleEl.textContent = `
      html.${PENDING_CLASS} {
        background-color: #fff !important;
        filter: ${this.baseFilter} !important;
      }
      html.${PENDING_CLASS} :is(${mediaSelector}) {
        filter: ${this.baseFilter} !important;
      }
    `;
  }

  _unmountPending() {
    const html = document.documentElement;
    html.classList.remove(PENDING_CLASS);

    const styleEl = document.getElementById(this.pendingStyleId);
    if (styleEl) styleEl.remove();

    const prebootStyle = document.getElementById(this.prebootStyleId);
    if (prebootStyle) prebootStyle.remove();

    if (this.pendingPrevMinHeight !== null) {
      if (this.pendingPrevMinHeight) {
        html.style.minHeight = this.pendingPrevMinHeight;
      } else {
        html.style.removeProperty('min-height');
      }
      this.pendingPrevMinHeight = null;
    }
  }

  _injectCSS(state) {
    let styleEl = document.getElementById(this.config.id);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = this.config.id;
      (document.head || document.documentElement).appendChild(styleEl);
    }

    const mediaSelector = this._getMediaSelector();
    const effectiveFilters = this._getEffectiveRenderFilters();
    const chain = this._getUserFilterChain(effectiveFilters);
    const bodyFilter = `${this.baseFilter}${chain ? ` ${chain}` : ''}`;
    const maskOpacity = Math.max(0, (100 - effectiveFilters.brightness) / 100);

    if (state === VisualState.RESOLVED_ALREADY_DARK) {
      styleEl.textContent = `
        html[data-darkmode-pro="already-dark"] body :is(${mediaSelector}) {
          filter: none !important;
        }
        #${this.config.maskId} {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, ${maskOpacity});
          pointer-events: none;
          z-index: 2147483647;
        }
      `;
      return;
    }

    if (state === VisualState.RESOLVED_ON) {
      styleEl.textContent = `
        html[data-darkmode-pro="on"] {
          background-color: #fff !important;
          filter: ${bodyFilter} !important;
        }
        html[data-darkmode-pro="on"] :is(${mediaSelector}),
        html[data-darkmode-pro="on"] [data-dm-bg-fixed="true"],
        html[data-darkmode-pro="on"] [style*="background-image"] {
          filter: ${this.baseFilter} !important;
          mix-blend-mode: normal !important;
        }
        html[data-darkmode-pro="on"] [data-dm-bg-fixed="true"] :is(img, video, svg, canvas) {
          filter: none !important;
        }
        #${this.config.maskId} {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, ${maskOpacity});
          pointer-events: none;
          z-index: 2147483647;
        }
      `;
      return;
    }

    styleEl.textContent = '';
  }

  _applyMask(state) {
    const effectiveFilters = this._getEffectiveRenderFilters();
    const brightness = effectiveFilters.brightness;
    const shouldAllowOverlay = (
      state === VisualState.RESOLVED_ON ||
      state === VisualState.RESOLVED_ALREADY_DARK
    );
    const shouldShowMask = shouldAllowOverlay && brightness < 100;

    const existing = document.getElementById(this.config.maskId);
    if (!shouldShowMask) {
      if (existing) existing.remove();
    } else {
      const mask = existing || document.createElement('div');
      if (!existing) {
        mask.id = this.config.maskId;
        document.documentElement.appendChild(mask);
      }

      const opacity = Math.max(0, (100 - brightness) / 100);
      mask.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,${opacity});pointer-events:none;z-index:2147483647`;
    }

    const toneExisting = document.getElementById(this.toneMaskId);
    const sepia = effectiveFilters.sepia;
    const shouldShowToneMask = shouldAllowOverlay &&
      sepia > 0 &&
      !this._hasVisibleMediaSurface();

    if (!shouldShowToneMask) {
      if (toneExisting) toneExisting.remove();
      return;
    }

    const toneMask = toneExisting || document.createElement('div');
    if (!toneExisting) {
      toneMask.id = this.toneMaskId;
      document.documentElement.appendChild(toneMask);
    }

    const toneOpacity = this._getSepiaOverlayOpacity(sepia);
    toneMask.style.cssText = `position:fixed;inset:0;background:rgba(255,214,170,${toneOpacity});mix-blend-mode:multiply;pointer-events:none;z-index:2147483646`;
  }

  _getMediaSelector() {
    const skipCanvas = (this.config.canvasWhitelist || []).some((site) => {
      return location.hostname === site || location.hostname.endsWith(`.${site}`);
    });

    return skipCanvas ? 'img, video, svg' : 'img, video, canvas, svg';
  }

  _getUserFilterChain(effectiveFilters = this.siteState) {
    const parts = [];

    if (effectiveFilters.contrast !== 100) {
      parts.push(`contrast(${effectiveFilters.contrast}%)`);
    }
    if (effectiveFilters.grayscale !== 0) {
      parts.push(`grayscale(${effectiveFilters.grayscale}%)`);
    }

    return parts.join(' ');
  }

  _getEffectiveRenderFilters() {
    const hasVisibleMedia = this._hasVisibleMediaSurface();
    if (!hasVisibleMedia) {
      return {
        brightness: this.siteState.brightness,
        contrast: this.siteState.contrast,
        sepia: this.siteState.sepia,
        grayscale: this.siteState.grayscale
      };
    }

    // Keep media colors neutral while preserving stored user settings.
    return {
      brightness: this.siteState.brightness,
      contrast: 100,
      sepia: 0,
      grayscale: 0
    };
  }

  _getSepiaOverlayOpacity(sepia) {
    const clamped = clamp(sepia, 0, 100, 0);
    return Math.min(0.24, (clamped / 100) * 0.24);
  }

  _hasVisibleMediaSurface() {
    const mediaNodes = document.querySelectorAll('video, canvas');

    for (const el of mediaNodes) {
      try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          continue;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width > 48 && rect.height > 48) {
          return true;
        }
      } catch (error) {
        // ignore measurement failures for detached/cross-origin nodes
      }
    }

    return false;
  }

  async _waitForDomReady() {
    if (document.readyState !== 'loading') return;

    await new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }

  async _waitForStablePaint() {
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    if (this._looksLikeSPA()) {
      await this._waitForMeaningfulContent(1200);
    }

    await new Promise((resolve) => setTimeout(resolve, 24));
  }

  _looksLikeSPA() {
    const body = document.body;
    if (!body) return false;

    return Boolean(
      document.getElementById('root') ||
      document.getElementById('app') ||
      document.querySelector('[data-reactroot]') ||
      document.querySelector('[data-v-app]') ||
      document.querySelector('[ng-app]')
    );
  }

  async _waitForMeaningfulContent(maxWaitMs) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      if (this._hasMeaningfulContent()) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }

  _hasMeaningfulContent() {
    const body = document.body;
    if (!body) return false;

    const text = body.innerText ? body.innerText.trim().length : 0;
    if (text > 180) return true;

    const contentNode = body.querySelector('img,video,main,article,section,[class*="content"],[class*="feed"]');
    return !!contentNode;
  }

  _detectAlreadyDark() {
    return this._withoutPendingStyles(() => {
      try {
        const html = document.documentElement;
        const body = document.body;

        const htmlStyle = window.getComputedStyle(html);
        const bodyStyle = body ? window.getComputedStyle(body) : null;

        if (htmlStyle.colorScheme === 'dark' || bodyStyle?.colorScheme === 'dark') {
          return true;
        }

        const attrs = ['data-theme', 'theme', 'data-mode', 'data-color-mode'];
        for (const attr of attrs) {
          const htmlVal = (html.getAttribute(attr) || '').toLowerCase();
          const bodyVal = (body?.getAttribute(attr) || '').toLowerCase();
          if (htmlVal.includes('dark') || bodyVal.includes('dark')) {
            return true;
          }
        }

        const htmlBg = parseRGB(htmlStyle.backgroundColor);
        const bodyBg = parseRGB(bodyStyle?.backgroundColor || '');

        if (isTransparent(htmlBg) && isTransparent(bodyBg)) {
          return false;
        }

        const htmlLum = luminance(htmlBg) ?? 1;
        const bodyLum = luminance(isTransparent(bodyBg) ? htmlBg : bodyBg) ?? htmlLum;
        const textLum = luminance(parseRGB(bodyStyle?.color || ''));

        if (htmlLum < 0.2 && bodyLum < 0.2) {
          return true;
        }

        if (bodyLum < 0.24 && textLum !== null && textLum > 0.72) {
          return true;
        }

        return false;
      } catch (e) {
        return false;
      }
    });
  }

  _withoutPendingStyles(readFn) {
    const html = document.documentElement;
    const hadPendingClass = html.classList.contains(PENDING_CLASS);
    const pendingStyle = document.getElementById(this.pendingStyleId);
    const prevDisabled = pendingStyle ? pendingStyle.disabled : false;

    if (hadPendingClass) {
      html.classList.remove(PENDING_CLASS);
    }
    if (pendingStyle) {
      pendingStyle.disabled = true;
    }

    try {
      return readFn();
    } finally {
      if (pendingStyle) {
        pendingStyle.disabled = prevDisabled;
      }
      if (hadPendingClass) {
        html.classList.add(PENDING_CLASS);
      }
    }
  }

  _startEnhancement() {
    if (this.observer) return;

    this._initBackgroundProtection();
    let visualRefreshPending = false;
    const scheduleVisualRefresh = () => {
      if (visualRefreshPending) return;
      visualRefreshPending = true;

      setTimeout(() => {
        visualRefreshPending = false;
        const state = this.stateCtrl.getState();
        if (state === VisualState.RESOLVED_ON || state === VisualState.RESOLVED_ALREADY_DARK) {
          this._injectCSS(state);
          this._applyMask(state);
        }
      }, 80);
    };

    let scanPending = false;
    const scheduleShadowScan = () => {
      if (scanPending) return;
      scanPending = true;

      const runner = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (cb) => setTimeout(cb, 100);

      runner(() => {
        this._scanShadowDOM(document.body);
        scanPending = false;
      });
    };

    this.observer = new MutationObserver((mutations) => {
      let needsShadowScan = false;
      let needsVisualRefresh = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            this._markBackgroundNode(node);

            if (node.querySelectorAll) {
              node.querySelectorAll('[style], [class]').forEach((el) => {
                this._markBackgroundNode(el);
              });
            }

            if (
              node.matches?.('video, canvas') ||
              node.querySelector?.('video, canvas')
            ) {
              needsVisualRefresh = true;
            }
          }
          needsShadowScan = true;
          needsVisualRefresh = true;
        }

        if (mutation.type === 'attributes') {
          this._markBackgroundNode(mutation.target);
          if (
            mutation.target.matches?.('video, canvas') ||
            mutation.target.querySelector?.('video, canvas')
          ) {
            needsVisualRefresh = true;
          }
        }
      }

      if (needsShadowScan) {
        scheduleShadowScan();
      }
      if (needsVisualRefresh) {
        scheduleVisualRefresh();
      }
    });

    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    scheduleShadowScan();
    scheduleVisualRefresh();
  }

  _stopEnhancement() {
    if (!this.observer) return;
    this.observer.disconnect();
    this.observer = null;
  }

  _initBackgroundProtection() {
    document.querySelectorAll('[style], div, section, article, a, span').forEach((el) => {
      this._markBackgroundNode(el);
    });
  }

  _markBackgroundNode(el) {
    if (!el || el.nodeType !== 1 || el.dataset.dmBgFixed === 'true') {
      return;
    }

    try {
      const isMediaNode = el.matches('video, canvas');
      if (isMediaNode) return;

      const inlineStyle = el.getAttribute('style') || '';
      if (inlineStyle.includes('background-image') && inlineStyle.includes('url(')) {
        if (el.querySelector('video, canvas')) return;
        el.dataset.dmBgFixed = 'true';
        return;
      }

      const computed = window.getComputedStyle(el);
      const bgImage = computed.backgroundImage;
      if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
        if (el.querySelector('video, canvas')) return;
        el.dataset.dmBgFixed = 'true';
      }
    } catch (e) {
      // ignore style lookup failures
    }
  }

  _scanShadowDOM(rootNode) {
    if (!rootNode) return;

    const queue = [rootNode];
    const shadowVisited = new WeakSet();
    let scanned = 0;
    const maxNodes = 600;

    while (queue.length && scanned < maxNodes) {
      const node = queue.shift();
      scanned += 1;

      if (node.shadowRoot && !shadowVisited.has(node.shadowRoot)) {
        shadowVisited.add(node.shadowRoot);
        this._injectShadowStyle(node.shadowRoot);
      }

      if (node.querySelectorAll) {
        node.querySelectorAll('*').forEach((child) => {
          queue.push(child);
        });
      }
    }
  }

  _injectShadowStyle(root) {
    if (root.querySelector(`#${this.shadowStyleId}`)) return;

    const styleEl = document.createElement('style');
    styleEl.id = this.shadowStyleId;
    styleEl.textContent = `
      :is(img, video, svg, canvas) {
        filter: ${this.baseFilter} !important;
      }
      :is([style*="background-image"], [data-dm-bg-fixed="true"]) {
        filter: ${this.baseFilter} !important;
      }
    `;

    root.appendChild(styleEl);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DarkModeEngine, VisualState };
}

if (typeof window !== 'undefined') {
  window.DarkModeEngine = DarkModeEngine;
  window.VisualState = VisualState;
}
