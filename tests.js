const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("background.js", "utf8");
if (source.includes('"wake_failed"')) throw new Error("wake_failed typo is still present");
const installationEvents = [];
const context = {
  chrome: {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} },
      setUninstallURL: async () => {},
      getPlatformInfo: async () => ({ os: "mac" }),
      getBrowserInfo: async () => ({ browser: "Chrome", version: "131.0.6778.86" }),
      getManifest: () => ({ version: "1.0.7" })
    },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener() {} } },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} }
    }
  },
  console,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  AbortController,
  performance,
  trackEvent: (name, params) => installationEvents.push({ name, params })
};
vm.runInNewContext(`${source}\nthis.testPrune = pruneHistory; this.testFrequency = normalizeFrequency; this.testRange = rangeUrl; this.testHistoryKeys = { wake: WAKE_HISTORY_KEY, real: REAL_TEST_HISTORY_KEY }; this.testReadMeasuredBody = readMeasuredBody; this.testCategorizeWakeError = categorizeWakeError; this.testBuildUninstallURL = buildUninstallURL; this.testSyncUninstallURL = syncUninstallURL; this.testHandleInstalled = handleInstalled; this.testProbeNetwork = probeNetwork; this.testFetchFastConfig = fetchFastConfig; this.testShouldTriggerWatchdogHammer = shouldTriggerWatchdogHammer; this.testSetMonitoring = setMonitoring; this.testRunWatchdogCycle = runWatchdogCycle; this.testEnsureAlarm = ensureAlarm; this.testProbeFailuresKey = PROBE_FAILURES_KEY; this.testMonitoringKey = MONITORING_KEY; this.testAlarmName = ALARM_NAME; this.testInstallKeys = { date: INSTALL_DATE_KEY, attempts: WAKE_ATTEMPTS_KEY, successes: WAKE_SUCCESSES_KEY };`, context);

context.testHandleInstalled({ reason: "install" });
context.testHandleInstalled({ reason: "update", previousVersion: "1.0.5" });
context.testHandleInstalled({ reason: "chrome_update" });
if (installationEvents.length !== 1 || installationEvents[0].name !== "extension_installed") {
  throw new Error("extension_installed was not limited to fresh installs");
}

for (const file of ["background.js", "popup.js", "analytics.js", "popup.html"]) {
  if (fs.readFileSync(file, "utf8").includes("wake_failed")) {
    throw new Error(`wake_failed typo is still present in ${file}`);
  }
}

const now = 1_000_000_000;
const retained = context.testPrune([
  [now - 31 * 86400000, 1, 1],
  [now - 86400000, 20, 5],
  ["invalid", 2, 2],
  [now + 1, 2, 2]
], now);
if (retained.length !== 1 || retained[0][1] !== 20) throw new Error("TTL pruning failed");
if (context.testFrequency(4) !== 30 || context.testFrequency(361) !== 30 || context.testFrequency(60) !== 60) {
  throw new Error("Frequency normalization failed");
}
const ranged = context.testRange("https://edge.example/speedtest?a=1", 26214400);
if (!ranged.includes("/speedtest/range/0-26214400?a=1")) throw new Error("Range URL construction failed");
if (context.testHistoryKeys.wake !== "wakeHistory" || context.testHistoryKeys.real !== "realTestHistory") {
  throw new Error("History keys are not separated");
}

if (context.testCategorizeWakeError(new Error("A wake-up is already running.")) !== "other") {
  throw new Error("Error categorization failed for other");
}
if (context.testCategorizeWakeError(new Error("Could not reach the network.")) !== "no_network") {
  throw new Error("Error categorization failed for no_network");
}
if (context.testCategorizeWakeError(new Error("Couldn't reach the speed test — check your connection.")) !== "speedtest_unreachable") {
  throw new Error("Error categorization failed for speedtest_unreachable");
}
if (context.testCategorizeWakeError(new Error("The operation timed out")) !== "timeout") {
  throw new Error("Error categorization failed for timeout");
}
if (context.testCategorizeWakeError(new Error("Could not wake Wi‑Fi this time.")) !== "other") {
  throw new Error("Error categorization failed for other");
}

const analytics = require("./analytics.js");
if (analytics.EVENT_PARAMS_DEFAULTS.engagement_time_msec !== 100) {
  throw new Error("Analytics engagement default is not 100ms");
}
if (!analytics.isUrlOrIp("https://fast.com/app.js") || !analytics.isUrlOrIp("http://192.168.1.1/test") || !analytics.isUrlOrIp("10.0.0.1")) {
  throw new Error("isUrlOrIp failed to flag URLs or IPs");
}
if (analytics.isUrlOrIp("manual") || analytics.isUrlOrIp("timeout") || analytics.isUrlOrIp("1.0.5")) {
  throw new Error("isUrlOrIp falsely flagged valid event params");
}
if (JSON.parse(fs.readFileSync("manifest.json", "utf8")).version !== "1.0.7") {
  throw new Error("Manifest version is not 1.0.7");
}
const popupCss = fs.readFileSync("popup.css", "utf8");
if (!popupCss.includes("body.hammering:not(:hover)") || !popupCss.includes("body.hammering:not(:hover) .btn-speed-test[aria-busy=\"true\"] img")) {
  throw new Error("Hammering animation is not gated by popup hover state");
}

const sanitized = analytics.sanitizeParams({
  trigger: "manual",
  leak_url: "https://fast.com/secret",
  leak_ip: "192.168.0.1",
  duration_ms: 1250,
  active: true,
  null_val: null
});
if (sanitized.trigger !== "manual" || sanitized.leak_url || sanitized.leak_ip || sanitized.duration_ms !== 1250 || sanitized.active !== "true" || sanitized.null_val !== undefined) {
  throw new Error("sanitizeParams failed to strip URLs/IPs or properly sanitize values");
}

const testUninstallUrl = context.testBuildUninstallURL({
  baseUrl: "https://forms.gle/eXVFdDdEfMxhKnqp6",
  version: "1.0.7",
  os: "mac",
  daysInstalled: 3,
  attempts: 15,
  successes: 12
});
const parsedUninstallUrl = new URL(testUninstallUrl);
if (parsedUninstallUrl.searchParams.get("v") !== "1.0.7") throw new Error("Uninstall URL version param mismatch");
if (parsedUninstallUrl.searchParams.get("os") !== "mac") throw new Error("Uninstall URL os param mismatch");
if (parsedUninstallUrl.searchParams.get("days") !== "3") throw new Error("Uninstall URL days param mismatch");
if (parsedUninstallUrl.searchParams.get("attempts") !== "15") throw new Error("Uninstall URL attempts param mismatch");
if (parsedUninstallUrl.searchParams.get("successes") !== "12") throw new Error("Uninstall URL successes param mismatch");
if (testUninstallUrl.length > 1023) throw new Error("Uninstall URL exceeds 1023 characters");

if (context.testBuildUninstallURL({ baseUrl: "" }) !== "") throw new Error("Expected empty string for empty URL");
if (context.testBuildUninstallURL({ baseUrl: "invalid://url" }) !== "") throw new Error("Expected empty string for non-http/https URL");

const longBase = "https://example.com/feedback?" + "a".repeat(1015);
const clampedUrl = context.testBuildUninstallURL({
  baseUrl: longBase,
  version: "1.0.5",
  os: "mac",
  daysInstalled: 5,
  attempts: 10,
  successes: 10
});
if (clampedUrl.length > 1023) throw new Error("Failed to clamp long URL under 1024 characters");

const popup = require("./popup.js");
const DAY_MS = 86_400_000;
(async () => {
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls < 3) throw new Error("Could not establish connection. Receiving end does not exist."); return { ok: true }; };
  const res = await popup.sendMessageWithRetry(flaky, {}, [1, 1, 1]);
  if (!res.ok || calls !== 3) throw new Error("sendMessageWithRetry did not retry a sleeping service worker");
  let other = 0;
  try { await popup.sendMessageWithRetry(async () => { other += 1; throw new Error("boom"); }, {}, [1, 1]); } catch {}
  if (other !== 1) throw new Error("sendMessageWithRetry retried a non-connection error");
})().catch((e) => { console.error(e); process.exitCode = 1; });
const testNow = 1_000_000_000_000;

if (popup.shouldShowRatingPrompt({ successes: 0, dismissedForever: false, lastPromptedAt: null, now: testNow })) {
  throw new Error("Rating prompt showed with 0 successes");
}
if (popup.shouldShowRatingPrompt({ successes: 2, dismissedForever: false, lastPromptedAt: null, now: testNow })) {
  throw new Error("Rating prompt showed with 2 successes");
}
if (!popup.shouldShowRatingPrompt({ successes: 3, dismissedForever: false, lastPromptedAt: null, now: testNow })) {
  throw new Error("Rating prompt failed to show with 3 successes");
}
if (!popup.shouldShowRatingPrompt({ successes: 10, dismissedForever: false, lastPromptedAt: null, now: testNow })) {
  throw new Error("Rating prompt failed to show with 10 successes");
}
if (popup.shouldShowRatingPrompt({ successes: 5, dismissedForever: true, lastPromptedAt: null, now: testNow })) {
  throw new Error("Rating prompt showed when dismissed forever");
}
if (popup.shouldShowRatingPrompt({ successes: 5, dismissedForever: false, lastPromptedAt: testNow - 13 * DAY_MS, now: testNow })) {
  throw new Error("Rating prompt showed within 14 days of last prompt");
}
if (!popup.shouldShowRatingPrompt({ successes: 5, dismissedForever: false, lastPromptedAt: testNow - 14 * DAY_MS, now: testNow })) {
  throw new Error("Rating prompt failed to re-show after 14 days");
}
if (popup.CWS_REVIEWS_URL !== "https://chromewebstore.google.com/detail/wifi-hammer/dbphaafiokokiaocpcnfakompafjoddj/reviews") {
  throw new Error("Rating URL mismatch");
}

async function assertDownloadCountsBytesBeforeBodyFinishes() {
  let arrayBufferCalled = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const response = {
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            if (reads === 1) return { done: false, value: new Uint8Array(250_000) };
            await gate;
            return { done: true };
          }
        };
      }
    },
    arrayBuffer() {
      arrayBufferCalled = true;
      return Promise.resolve(new ArrayBuffer(26_214_400));
    }
  };
  let reported = 0;
  const pending = context.testReadMeasuredBody("download", response, 26_214_400, (byteLength) => {
    reported += byteLength;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (arrayBufferCalled) throw new Error("Download progress waited to buffer the whole response");
  if (reported !== 250_000) throw new Error(`Download bytes were not counted as they arrived (got ${reported})`);
  release();
  const total = await pending;
  if (total !== 250_000) throw new Error(`Download byte total mismatch (got ${total})`);
}

async function assertAnalyticsStorageAndSend() {
  const store = {};
  const mockContext = {
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: store[key] }),
          set: async (items) => Object.assign(store, items)
        },
        session: {
          get: async (key) => ({ [key]: store[key] }),
          set: async (items) => Object.assign(store, items)
        }
      },
      runtime: {
        getPlatformInfo: async () => ({ os: "mac" }),
        getBrowserInfo: async () => ({ browser: "Chrome", version: "131.0.6778.86" })
      }
    },
    crypto: {
      randomUUID: () => "test-uuid-1234"
    },
    navigator: { onLine: true },
    fetch: async () => ({ ok: true, status: 204 }),
    ANALYTICS_CONFIG: {
      MEASUREMENT_ID: "G-TEST12345",
      API_SECRET: "test-secret"
    }
  };
  mockContext.self = mockContext;
  mockContext.globalThis = mockContext;

  const analyticsSource = fs.readFileSync("analytics.js", "utf8");
  vm.runInNewContext(analyticsSource, mockContext);

  const clientId1 = await mockContext.WiFiHammerAnalytics.getClientId();
  if (clientId1 !== "test-uuid-1234") throw new Error("Client ID generation failed");
  if (store.ga_client_id !== "test-uuid-1234") throw new Error("Client ID was not stored in chrome.storage.local");

  const clientId2 = await mockContext.WiFiHammerAnalytics.getClientId();
  if (clientId2 !== "test-uuid-1234") throw new Error("Client ID was not cached/reused");

  const os = await mockContext.WiFiHammerAnalytics.getPlatformOS();
  if (os !== "mac") throw new Error("getPlatformOS failed");
  const chromeVersion = await mockContext.WiFiHammerAnalytics.getChromeVersion();
  if (chromeVersion !== "131.0.6778.86") throw new Error("getChromeVersion failed");

  mockContext.navigator.onLine = false;
  let fetchCalled = false;
  mockContext.fetch = async () => { fetchCalled = true; };
  const offlineResult = await mockContext.WiFiHammerAnalytics.trackEvent("test_event");
  if (offlineResult !== false || fetchCalled) throw new Error("trackEvent failed to silently no-op when offline");

  mockContext.navigator.onLine = true;
  mockContext.ANALYTICS_CONFIG.API_SECRET = "";
  const noSecretResult = await mockContext.WiFiHammerAnalytics.trackEvent("test_event");
  if (noSecretResult !== false || fetchCalled) throw new Error("trackEvent failed to silently no-op with blank API_SECRET");

  mockContext.ANALYTICS_CONFIG.API_SECRET = "valid_secret";
  let capturedPayload = null;
  let capturedUrl = null;
  let capturedOptions = null;
  mockContext.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedOptions = opts;
    capturedPayload = JSON.parse(opts.body);
    return { ok: true, status: 204 };
  };
  const successResult = await mockContext.WiFiHammerAnalytics.trackEvent("hammer_clicked", {
    trigger: "manual",
    forbidden_url: "https://fast.com/leak"
  });
  if (!successResult) throw new Error("trackEvent failed to send when credentials are valid");
  if (!capturedUrl.includes("measurement_id=G-TEST12345") || !capturedUrl.includes("api_secret=valid_secret")) {
    throw new Error("URL query parameters missing measurement_id or api_secret");
  }
  if (capturedOptions.mode !== "no-cors") throw new Error("Analytics fetch mode changed from no-cors");
  if (!capturedPayload || capturedPayload.client_id !== "test-uuid-1234") {
    throw new Error("Payload missing client_id");
  }
  const event = capturedPayload.events[0];
  if (event.name !== "hammer_clicked") throw new Error("Event name mismatch");
  if (event.params.os !== "mac") throw new Error("OS was not attached to event params");
  if (event.params.chrome_version !== "131.0.6778.86") throw new Error("Chrome version was not attached to event params");
  if (!Number.isFinite(event.params.session_id)) throw new Error("Session ID was not attached to event params");
  if (event.params.engagement_time_msec !== 100) throw new Error("Default engagement time was not attached to event params");
  if (event.params.trigger !== "manual") throw new Error("Event param trigger mismatch");
  if (event.params.forbidden_url !== undefined) throw new Error("Forbidden URL was not stripped from event params");
  if (!store.ga_session || store.ga_session.id !== event.params.session_id) {
    throw new Error("Session ID was not stored in chrome.storage.session");
  }

  if (mockContext.fetch === undefined || !capturedPayload) throw new Error("Analytics request was not captured");
}

async function assertWatchdogProbe() {
  let cancelled = false;
  let nowMs = 1000;
  context.performance = { now: () => nowMs };
  context.fetch = async (url, options) => {
    if (url !== "https://fast.com/favicon.ico" || options.cache !== "no-store" || options.credentials !== "omit") {
      throw new Error("Watchdog probe request was not configured correctly");
    }
    nowMs += 50;
    return {
      ok: true,
      type: "basic",
      url,
      body: { cancel: async () => { cancelled = true; } }
    };
  };
  const probe = await context.testProbeNetwork();
  if (!probe.healthy || !Number.isFinite(probe.rttMs) || !cancelled) {
    throw new Error("Watchdog probe did not measure a successful response");
  }
  if (context.testShouldTriggerWatchdogHammer({ healthy: false, consecutiveFailures: 1 })) {
    throw new Error("Watchdog hammered after one failed probe");
  }
  if (!context.testShouldTriggerWatchdogHammer({ healthy: false, consecutiveFailures: 2 })) {
    throw new Error("Watchdog did not hammer after two failed probes");
  }

  // Opaque (no-cors) responses still count elapsed RTT as a success path.
  cancelled = false;
  nowMs = 2000;
  context.fetch = async (url) => {
    nowMs += 80;
    return {
      ok: false,
      status: 0,
      type: "opaque",
      url: "",
      body: { cancel: async () => { cancelled = true; } }
    };
  };
  const opaque = await context.testProbeNetwork();
  if (!opaque.healthy || opaque.rttMs < 80 || !cancelled) {
    throw new Error("Opaque probe response was not treated as a timed success");
  }

  // Timeout / abort → failure
  context.fetch = async (_url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (options.signal?.aborted) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    throw new Error("The operation timed out");
  };
  // Force immediate abort by using a tiny timeout path: emulate abort via throwing AbortError
  context.fetch = async () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  };
  const timedOut = await context.testProbeNetwork();
  if (timedOut.healthy || timedOut.errorType !== "timeout") {
    throw new Error("Probe timeout/abort was not counted as a failure");
  }

  // Network error → failure
  context.fetch = async () => {
    throw new Error("Failed to fetch");
  };
  const netErr = await context.testProbeNetwork();
  if (netErr.healthy || !netErr.errorType) {
    throw new Error("Probe network error was not counted as a failure");
  }

  // Slow-but-ok response over RTT threshold → unhealthy
  nowMs = 5000;
  context.fetch = async (url) => {
    nowMs += 3500;
    return {
      ok: true,
      type: "basic",
      url: url || "https://fast.com/favicon.ico",
      body: { cancel: async () => {} }
    };
  };
  const slow = await context.testProbeNetwork();
  if (slow.healthy || slow.rttMs < 3000) {
    throw new Error("Slow successful probe was not marked unhealthy");
  }
}

function createWatchdogHarness({ analytics = false } = {}) {
  const store = { local: {}, session: {} };
  const alarms = new Map();
  const alarmListeners = [];
  const installedListeners = [];
  const analyticsEvents = [];
  let fetchImpl = async () => {
    throw new Error("fetch not stubbed");
  };
  let nowMs = 1_000;

  const chromeMock = {
    runtime: {
      onInstalled: {
        addListener(fn) {
          installedListeners.push(fn);
        }
      },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} },
      sendMessage: async () => {},
      setUninstallURL: async () => {},
      getPlatformInfo: async () => ({ os: "mac" }),
      getBrowserInfo: async () => ({ browser: "Chrome", version: "131.0.6778.86" }),
      getManifest: () => ({ version: "1.0.7" })
    },
    alarms: {
      create: async (name, info) => {
        alarms.set(name, info || {});
      },
      clear: async (name) => {
        const existed = alarms.has(name);
        alarms.delete(name);
        return existed;
      },
      onAlarm: {
        addListener(fn) {
          alarmListeners.push(fn);
        }
      }
    },
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return { ...store.local };
          if (typeof keys === "string") return { [keys]: store.local[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) out[k] = store.local[k];
            return out;
          }
          const out = { ...keys };
          for (const k of Object.keys(keys)) {
            if (k in store.local) out[k] = store.local[k];
          }
          return out;
        },
        set: async (items) => Object.assign(store.local, items)
      },
      session: {
        get: async (keys) => {
          if (typeof keys === "string") return { [keys]: store.session[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) out[k] = store.session[k];
            return out;
          }
          return {};
        },
        set: async (items) => Object.assign(store.session, items)
      }
    }
  };

  const mockContext = {
    chrome: chromeMock,
    console: {
      ...console,
      warn() {},
      log() {}
    },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    AbortController,
    performance: { now: () => nowMs },
    crypto: { randomUUID: () => "watchdog-test-uuid" },
    navigator: { onLine: true },
    Date,
    fetch: (...args) => fetchImpl(...args),
    ANALYTICS_CONFIG: analytics
      ? { MEASUREMENT_ID: "G-TEST12345", API_SECRET: "test-secret" }
      : { MEASUREMENT_ID: "", API_SECRET: "" },
    trackEvent: (name, params) => analyticsEvents.push({ name, params })
  };
  mockContext.self = mockContext;
  mockContext.globalThis = mockContext;

  if (analytics) {
    const analyticsSource = fs.readFileSync("analytics.js", "utf8");
    vm.runInNewContext(analyticsSource, mockContext);
    mockContext.trackEvent = (name, params) => mockContext.WiFiHammerAnalytics.trackEvent(name, params);
  }

  const bgSource = fs.readFileSync("background.js", "utf8");
  vm.runInNewContext(
    `${bgSource}
this.testSetMonitoring = setMonitoring;
this.testRunWatchdogCycle = runWatchdogCycle;
this.testEnsureAlarm = ensureAlarm;
this.testHandleInstalled = handleInstalled;
this.testProbeNetwork = probeNetwork;
this.testFetchFastConfig = fetchFastConfig;
this.testProbeFailuresKey = PROBE_FAILURES_KEY;
this.testMonitoringKey = MONITORING_KEY;
this.testAlarmName = ALARM_NAME;
this.testShouldTriggerWatchdogHammer = shouldTriggerWatchdogHammer;`,
    mockContext
  );

  return {
    ctx: mockContext,
    store,
    alarms,
    alarmListeners,
    installedListeners,
    analyticsEvents,
    setFetch(fn) {
      fetchImpl = fn;
    },
    advance(ms) {
      nowMs += ms;
    },
    setNow(ms) {
      nowMs = ms;
    }
  };
}

async function assertWatchdogLifecycleAndCounting() {
  const h = createWatchdogHarness();
  const failKey = h.ctx.testProbeFailuresKey;
  const monKey = h.ctx.testMonitoringKey;
  const alarmName = h.ctx.testAlarmName;
  let hammerFetches = 0;
  let probeFetches = 0;

  const probeOk = () => {
    h.advance(40);
    return {
      ok: true,
      type: "basic",
      url: "https://fast.com/favicon.ico",
      body: { cancel: async () => {} }
    };
  };
  const probeFail = () => {
    throw new Error("Failed to fetch");
  };

  // Seed prior failures, then a successful probe resets to 0 (1a).
  h.store.local[monKey] = true;
  h.store.local[failKey] = 5;
  h.setFetch(async (url) => {
    if (String(url).includes("favicon.ico")) {
      probeFetches += 1;
      return probeOk();
    }
    throw new Error("unexpected fetch " + url);
  });
  await h.ctx.testRunWatchdogCycle();
  if (h.store.local[failKey] !== 0) {
    throw new Error("Successful probe did not reset consecutive failures to 0");
  }

  // Turning auto-hammer off clears alarm + failure count; no probes while off (1b).
  h.store.local[failKey] = 2;
  await h.ctx.testSetMonitoring(true);
  if (!h.alarms.has(alarmName)) throw new Error("Enabling monitoring did not create the watchdog alarm");
  probeFetches = 0;
  await h.ctx.testSetMonitoring(false);
  if (h.alarms.has(alarmName)) throw new Error("Disabling monitoring did not clear the watchdog alarm");
  if (h.store.local[failKey] !== 0) throw new Error("Disabling monitoring did not clear failure count");
  await h.ctx.testRunWatchdogCycle();
  if (probeFetches !== 0) throw new Error("Probe ran while auto-hammer was off");

  // Turning back on starts from 0 — one failure does not hammer (1b).
  hammerFetches = 0;
  await h.ctx.testSetMonitoring(true);
  h.setFetch(async (url) => {
    const u = String(url);
    if (u.includes("favicon.ico")) {
      probeFetches += 1;
      return probeFail();
    }
    hammerFetches += 1;
    throw new Error("offline");
  });
  probeFetches = 0;
  await h.ctx.testRunWatchdogCycle();
  if (h.store.local[failKey] !== 1) throw new Error("Expected failure count 1 after first fail");
  if (hammerFetches !== 0) throw new Error("Hammered immediately after re-enabling on first failure");

  // Pause mid-probe must not record failures.
  h.store.local[failKey] = 0;
  let releaseProbe;
  const probeGate = new Promise((resolve) => {
    releaseProbe = resolve;
  });
  h.setFetch(async (url) => {
    if (String(url).includes("favicon.ico")) {
      await probeGate;
      throw new Error("Failed to fetch");
    }
    throw new Error("unexpected");
  });
  const midProbe = h.ctx.testRunWatchdogCycle();
  await h.ctx.testSetMonitoring(false);
  releaseProbe();
  await midProbe;
  if (h.store.local[failKey] !== 0) {
    throw new Error("Paused mid-probe still recorded a failure count");
  }

  // Two consecutive failures trigger hammer; count resets; next hammer needs two new failures (1a, 1e).
  await h.ctx.testSetMonitoring(true);
  h.store.local[failKey] = 0;
  let hammers = 0;
  // Return an empty target list so the hard wake fails immediately (no 90s recovery loop).
  const failingHardWakeFetch = async (url) => {
    const u = String(url);
    if (u.includes("favicon.ico")) {
      throw new Error("Failed to fetch");
    }
    hammers += 1;
    if (u.includes("api.fast.com")) {
      return { ok: true, json: async () => ({ targets: [] }) };
    }
    return { ok: true, text: async () => "<html></html>" };
  };
  h.setFetch(failingHardWakeFetch);
  await h.ctx.testRunWatchdogCycle();
  if (h.store.local[failKey] !== 1 || hammers !== 0) {
    throw new Error("First consecutive failure should not hammer");
  }
  try {
    await h.ctx.testRunWatchdogCycle();
  } catch {
    // Hard wake is stubbed to fail; failure count is reset before it runs.
  }
  if (hammers < 1) throw new Error("Second consecutive failure did not trigger a watchdog hammer");
  if (h.store.local[failKey] !== 0) {
    throw new Error("Watchdog hammer did not reset consecutive failures to 0");
  }
  hammers = 0;
  await h.ctx.testRunWatchdogCycle();
  if (h.store.local[failKey] !== 1 || hammers !== 0) {
    throw new Error("After reset, a single new failure must not hammer again");
  }
  try {
    await h.ctx.testRunWatchdogCycle();
  } catch {
    // expected hard-wake failure
  }
  if (hammers < 1) throw new Error("Two new consecutive failures did not hammer again");
  if (h.store.local[failKey] !== 0) {
    throw new Error("Second hammer did not reset failure count");
  }
}

async function assertWatchdogUpgradeFrom106() {
  const h = createWatchdogHarness();
  // 1.0.6 with auto-hammer on: monitoringEnabled true (or unset → defaults on).
  h.store.local[h.ctx.testMonitoringKey] = true;
  h.store.local.frequencyMinutes = 30;
  // Pretend an old scheduled pulse alarm exists under the same name.
  h.alarms.set(h.ctx.testAlarmName, { periodInMinutes: 30, legacy: true });

  let probeOnly = 0;
  let hardWake = 0;
  h.setFetch(async (url) => {
    const u = String(url);
    if (u.includes("favicon.ico")) {
      probeOnly += 1;
      h.advance(30);
      return {
        ok: true,
        type: "basic",
        url: "https://fast.com/favicon.ico",
        body: { cancel: async () => {} }
      };
    }
    hardWake += 1;
    throw new Error("unexpected hard wake");
  });

  await h.ctx.testHandleInstalled({ reason: "update", previousVersion: "1.0.6" });
  // ensureAlarm is fire-and-forget inside handleInstalled; wait a tick.
  await new Promise((r) => setTimeout(r, 20));

  if (h.store.local[h.ctx.testMonitoringKey] !== true) {
    throw new Error("Upgrade from 1.0.6 did not keep auto-hammer on");
  }
  const alarm = h.alarms.get(h.ctx.testAlarmName);
  if (!alarm || alarm.legacy) {
    throw new Error("Upgrade did not re-register the watchdog alarm");
  }
  if (typeof alarm.periodInMinutes !== "number") {
    throw new Error("Watchdog alarm missing periodInMinutes");
  }

  if (h.alarmListeners.length < 1) {
    throw new Error("Alarm listener was not registered");
  }
  await h.alarmListeners[0]({ name: h.ctx.testAlarmName });
  await new Promise((r) => setTimeout(r, 20));
  if (probeOnly < 1) throw new Error("Post-upgrade alarm did not run a watchdog probe");
  if (hardWake !== 0) throw new Error("Post-upgrade alarm still ran a scheduled hard pulse");
}

async function assertWatchdogAnalyticsEvents() {
  const h = createWatchdogHarness({ analytics: true });
  const captured = [];
  h.setFetch(async (url, opts) => {
    if (String(url).includes("google-analytics.com")) {
      captured.push(JSON.parse(opts.body));
      return { ok: true, status: 204 };
    }
    if (String(url).includes("favicon.ico")) {
      h.advance(40);
      throw new Error("Failed to fetch");
    }
    if (String(url).includes("api.fast.com")) {
      return { ok: true, json: async () => ({ targets: [] }) };
    }
    return { ok: true, text: async () => "<html></html>" };
  });

  await h.ctx.testSetMonitoring(true);
  h.store.local[h.ctx.testProbeFailuresKey] = 0;

  await h.ctx.testRunWatchdogCycle();
  try {
    await h.ctx.testRunWatchdogCycle();
  } catch {
    // hard wake stubbed to fail
  }

  // Allow analytics promises to settle.
  await new Promise((r) => setTimeout(r, 50));

  const flatEvents = captured.flatMap((payload) => payload.events || []);
  const probeEvents = flatEvents.filter((e) => e.name === "network_probe");
  const triggerEvents = flatEvents.filter((e) => e.name === "auto_hammer_triggered");
  if (probeEvents.length < 2) throw new Error("Expected network_probe GA4 events");
  if (triggerEvents.length < 1) throw new Error("Expected auto_hammer_triggered GA4 event");

  for (const event of [...probeEvents, ...triggerEvents]) {
    const p = event.params || {};
    if (!Number.isFinite(p.session_id)) {
      throw new Error(`${event.name} missing session_id`);
    }
    if (p.engagement_time_msec !== 100) {
      throw new Error(`${event.name} missing engagement_time_msec`);
    }
    if (p.os !== "mac") throw new Error(`${event.name} missing os`);
    if (p.chrome_version !== "131.0.6778.86") {
      throw new Error(`${event.name} missing chrome_version`);
    }
  }
}

async function assertUninstallURLSync() {
  const store = {};
  let setUninstallURLCalledWith = null;
  const mockContext = {
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            if (Array.isArray(keys)) {
              const res = {};
              for (const k of keys) res[k] = store[k];
              return res;
            }
            return { [keys]: store[keys] };
          },
          set: async (items) => Object.assign(store, items)
        }
      },
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} },
        setUninstallURL: async (u) => { setUninstallURLCalledWith = u; },
        getPlatformInfo: async () => ({ os: "mac" }),
        getManifest: () => ({ version: "1.0.7" })
      },
      alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener() {} } }
    },
    ANALYTICS_CONFIG: {
      UNINSTALL_URL: "https://forms.gle/test-feedback"
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    AbortController,
    performance,
    Date
  };
  mockContext.self = mockContext;
  mockContext.globalThis = mockContext;

  const bgSource = fs.readFileSync("background.js", "utf8");
  vm.runInNewContext(`${bgSource}\nthis.testSync = syncUninstallURL; this.testIncrement = incrementWakeCounter;`, mockContext);

  await mockContext.testSync();
  if (typeof store.installedAt !== "number") throw new Error("installedAt was not set on sync");
  if (!setUninstallURLCalledWith || !setUninstallURLCalledWith.includes("https://forms.gle/test-feedback")) {
    throw new Error("setUninstallURL was not called with the configured URL");
  }
  const u1 = new URL(setUninstallURLCalledWith);
  if (u1.searchParams.get("v") !== "1.0.7") throw new Error("Version mismatch in setUninstallURL");
  if (u1.searchParams.get("attempts") !== "0") throw new Error("Initial attempts should be 0");
  if (u1.searchParams.get("successes") !== "0") throw new Error("Initial successes should be 0");

  await mockContext.testIncrement("totalWakeAttempts");
  await mockContext.testIncrement("totalWakeSuccesses");
  await mockContext.testSync();
  const u2 = new URL(setUninstallURLCalledWith);
  if (u2.searchParams.get("attempts") !== "1") throw new Error("Attempts counter not updated in setUninstallURL");
  if (u2.searchParams.get("successes") !== "1") throw new Error("Successes counter not updated in setUninstallURL");
}

const diagnostics = require("./diagnostics.js");

async function assertDiagnosticsLogger() {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (items) => Object.assign(store, items)
      }
    }
  };

  await diagnostics.clearDiagnostics();
  if (store.diagnosticsLog && store.diagnosticsLog.length !== 0) {
    throw new Error("clearDiagnostics failed to empty store");
  }

  for (let i = 1; i <= 55; i++) {
    await diagnostics.logDiagnostic("test_source", `event_${i}`, { count: i });
  }

  const logs = await diagnostics.getDiagnostics();
  if (logs.length !== 50) {
    throw new Error(`Expected exactly 50 capped logs, got ${logs.length}`);
  }
  if (logs[0].event !== "event_6") {
    throw new Error(`Expected oldest event to be event_6, got ${logs[0].event}`);
  }
  if (logs[logs.length - 1].event !== "event_55") {
    throw new Error(`Expected newest event to be event_55, got ${logs[logs.length - 1].event}`);
  }

  const report = diagnostics.formatDiagnosticsReport(logs, { os: "win", arch: "x86-64", devicePixelRatio: 1.5, onLine: true });
  if (!report.includes("=== WiFi Hammer Diagnostic Report ===") || !report.includes("OS: win") || !report.includes("150%")) {
    throw new Error("Diagnostic report formatting failed");
  }

  delete global.chrome;
}

async function assertFetchFastConfigRecovery() {
  // Dedicated harness so this does not race other tests that stub shared context.fetch.
  const h = createWatchdogHarness();
  let configCalls = 0;
  h.setFetch(async (url) => {
    const u = String(url);
    if (!u.includes("api.fast.com")) throw new Error("offline");
    configCalls += 1;
    if (configCalls < 4) throw new Error("offline");
    return { ok: true, json: async () => ({ targets: [{ url: "https://x/speedtest" }] }) };
  });

  const config = await h.ctx.testFetchFastConfig({ recoveryWindowMs: 5000, retryDelayMs: 1 });
  if (configCalls !== 4 || config.targets.length !== 1) {
    throw new Error("fetchFastConfig did not retry until recovery");
  }

  h.setFetch(async () => {
    throw new Error("offline");
  });
  let failed = false;
  try {
    await h.ctx.testFetchFastConfig({ recoveryWindowMs: 20, retryDelayMs: 5 });
  } catch (e) {
    failed = /speed test/.test(e.message);
  }
  if (!failed) throw new Error("fetchFastConfig should fail after the recovery window");
}

Promise.all([
  assertDownloadCountsBytesBeforeBodyFinishes(),
  assertAnalyticsStorageAndSend(),
  assertWatchdogProbe(),
  assertWatchdogLifecycleAndCounting(),
  assertWatchdogUpgradeFrom106(),
  assertWatchdogAnalyticsEvents(),
  assertFetchFastConfigRecovery(),
  assertUninstallURLSync(),
  assertDiagnosticsLogger()
])
  .then(() => console.log("All tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
