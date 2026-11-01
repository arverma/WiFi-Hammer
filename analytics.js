(function () {
  const GA_ENDPOINT = "https://www.google-analytics.com/mp/collect";
  const CLIENT_ID_KEY = "ga_client_id";
  const SESSION_KEY = "ga_session";
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  const EVENT_PARAMS_DEFAULTS = {
    engagement_time_msec: 100
  };

  let cachedClientId = null;
  let cachedOS = null;
  let cachedSession = null;
  let sessionPromise = null;

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

  async function getSession() {
    const now = Date.now();
    if (cachedSession && now - cachedSession.lastEventAt < SESSION_TIMEOUT_MS) {
      cachedSession.lastEventAt = now;
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
          await chrome.storage.session.set({ [SESSION_KEY]: cachedSession });
        }
      } catch {
        // Keep the in-memory session if session storage is unavailable.
      }
      return cachedSession;
    }
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
      let stored = {};
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
          stored = await chrome.storage.session.get(SESSION_KEY);
        }
      } catch {
        stored = {};
      }

      const previous = stored?.[SESSION_KEY];
      const session = previous
        && Number.isFinite(previous.id)
        && Number.isFinite(previous.lastEventAt)
        && now - previous.lastEventAt < SESSION_TIMEOUT_MS
        ? { id: previous.id, lastEventAt: now }
        : { id: now, lastEventAt: now };
      cachedSession = session;
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
          await chrome.storage.session.set({ [SESSION_KEY]: session });
        }
      } catch {
        // Keep the in-memory session if session storage is unavailable.
      }
      return session;
    })();

    try {
      return await sessionPromise;
    } finally {
      sessionPromise = null;
    }
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
      const session = await getSession();

      // 4. Assemble payload with strict privacy guarantees
      const eventParams = {
        os,
        session_id: session.id,
        ...EVENT_PARAMS_DEFAULTS,
        ...sanitizeParams(params)
      };
      eventParams.session_id = session.id;
      eventParams.engagement_time_msec = Number.isFinite(params.engagement_time_msec)
        ? params.engagement_time_msec
        : EVENT_PARAMS_DEFAULTS.engagement_time_msec;

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
    getSession,
    EVENT_PARAMS_DEFAULTS,
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
