(function () {
  const GA_ENDPOINT = "https://www.google-analytics.com/mp/collect";
  const CLIENT_ID_KEY = "ga_client_id";

  let cachedClientId = null;
  let cachedOS = null;

  function getConfig() {
    if (typeof self !== "undefined" && self.ANALYTICS_CONFIG) {
      return self.ANALYTICS_CONFIG;
    }
    if (typeof globalThis !== "undefined" && globalThis.ANALYTICS_CONFIG) {
      return globalThis.ANALYTICS_CONFIG;
    }
    return null;
  }

  async function getClientId() {
    if (cachedClientId) return cachedClientId;
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const stored = await chrome.storage.local.get(CLIENT_ID_KEY);
        if (stored && typeof stored[CLIENT_ID_KEY] === "string" && stored[CLIENT_ID_KEY]) {
          cachedClientId = stored[CLIENT_ID_KEY];
          return cachedClientId;
        }
      }

      let newId;
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        newId = crypto.randomUUID();
      } else {
        newId = `${Math.floor(Math.random() * 0x7fffffff)}.${Date.now()}`;
      }

      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [CLIENT_ID_KEY]: newId });
      }
      cachedClientId = newId;
      return cachedClientId;
    } catch {
      return null;
    }
  }

  async function getPlatformOS() {
    if (cachedOS) return cachedOS;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getPlatformInfo === "function") {
        const info = await chrome.runtime.getPlatformInfo();
        cachedOS = info?.os || "unknown";
        return cachedOS;
      }
    } catch {
      // Ignore errors when querying platform info
    }
    return "unknown";
  }

  function isUrlOrIp(value) {
    if (typeof value !== "string") return false;
    // Checks for http/https URLs, common domains/paths, and IPv4 addresses
    if (/^https?:\/\//i.test(value)) return true;
    if (/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/.test(value)) return true;
    if (/fast\.com|netflix|nflxvideo/i.test(value)) return true;
    return false;
  }

  function sanitizeParam(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || isUrlOrIp(trimmed)) return null;
      return trimmed.slice(0, 100);
    }
    return null;
  }

  function sanitizeParams(rawParams = {}) {
    const clean = {};
    for (const [key, val] of Object.entries(rawParams)) {
      if (key === "os" || key === "client_id") continue;
      const sanitized = sanitizeParam(val);
      if (sanitized !== null) {
        clean[key] = sanitized;
      }
    }
    return clean;
  }

  async function trackEvent(name, params = {}) {
    try {
      // 1. Silent offline check
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return false;
      }

      // 2. Validate credentials
      const config = getConfig();
      if (!config || !config.MEASUREMENT_ID || !config.API_SECRET) {
        // Silently skip if user hasn't configured credentials yet
        return false;
      }

      const measurementId = String(config.MEASUREMENT_ID).trim();
      const apiSecret = String(config.API_SECRET).trim();
      if (!measurementId.startsWith("G-") || apiSecret.length === 0) {
        return false;
      }

      // 3. Resolve client_id and platform OS
      const clientId = await getClientId();
      if (!clientId) return false;

      const os = await getPlatformOS();

      // 4. Assemble payload with strict privacy guarantees
      const eventParams = {
        os,
        ...sanitizeParams(params)
      };

      const url = `${GA_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
      const payload = {
        client_id: clientId,
        events: [
          {
            name: String(name).slice(0, 40),
            params: eventParams
          }
        ]
      };

      if (typeof fetch === "function") {
        await fetch(url, {
          method: "POST",
          mode: "no-cors",
          body: JSON.stringify(payload)
        });
      }
      return true;
    } catch {
      // Fail silently on network errors or fetch exceptions
      return false;
    }
  }

  const api = {
    trackEvent,
    getClientId,
    getPlatformOS,
    sanitizeParam,
    sanitizeParams,
    isUrlOrIp
  };

  if (typeof self !== "undefined") {
    self.WiFiHammerAnalytics = api;
    self.trackEvent = trackEvent;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.WiFiHammerAnalytics = api;
    globalThis.trackEvent = trackEvent;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();

