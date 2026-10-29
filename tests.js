const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("background.js", "utf8");
const context = {
  chrome: {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} },
      setUninstallURL: async () => {},
      getPlatformInfo: async () => ({ os: "mac" }),
      getManifest: () => ({ version: "1.0.5" })
    },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: { addListener() {} } },
    storage: { local: { get: async () => ({}), set: async () => {} } }
  },
  console,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  AbortController,
  performance
};
vm.runInNewContext(`${source}\nthis.testPrune = pruneHistory; this.testFrequency = normalizeFrequency; this.testRange = rangeUrl; this.testHistoryKeys = { wake: WAKE_HISTORY_KEY, real: REAL_TEST_HISTORY_KEY }; this.testReadMeasuredBody = readMeasuredBody; this.testCategorizeWakeError = categorizeWakeError; this.testBuildUninstallURL = buildUninstallURL; this.testSyncUninstallURL = syncUninstallURL; this.testInstallKeys = { date: INSTALL_DATE_KEY, attempts: WAKE_ATTEMPTS_KEY, successes: WAKE_SUCCESSES_KEY };`, context);

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

if (context.testCategorizeWakeError(new Error("A wake-up is already running.")) !== "already_running") {
  throw new Error("Error categorization failed for already_running");
}
if (context.testCategorizeWakeError(new Error("Could not reach the network.")) !== "offline") {
  throw new Error("Error categorization failed for offline");
}
if (context.testCategorizeWakeError(new Error("Network wake-up failed.")) !== "probe_failed") {
  throw new Error("Error categorization failed for probe_failed");
}
if (context.testCategorizeWakeError(new Error("The operation timed out")) !== "timeout") {
  throw new Error("Error categorization failed for timeout");
}
if (context.testCategorizeWakeError(new Error("Could not wake Wi‑Fi this time.")) !== "invalid_speed") {
  throw new Error("Error categorization failed for invalid_speed");
}

const analytics = require("./analytics.js");
if (!analytics.isUrlOrIp("https://fast.com/app.js") || !analytics.isUrlOrIp("http://192.168.1.1/test") || !analytics.isUrlOrIp("10.0.0.1")) {
  throw new Error("isUrlOrIp failed to flag URLs or IPs");
}
if (analytics.isUrlOrIp("manual") || analytics.isUrlOrIp("timeout") || analytics.isUrlOrIp("1.0.5")) {
  throw new Error("isUrlOrIp falsely flagged valid event params");
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
  version: "1.0.5",
  os: "mac",
  daysInstalled: 3,
  attempts: 15,
  successes: 12
});
const parsedUninstallUrl = new URL(testUninstallUrl);
if (parsedUninstallUrl.searchParams.get("v") !== "1.0.5") throw new Error("Uninstall URL version param mismatch");
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
        }
      },
      runtime: {
        getPlatformInfo: async () => ({ os: "mac" })
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
  mockContext.fetch = async (url, opts) => {
    capturedUrl = url;
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
  if (!capturedPayload || capturedPayload.client_id !== "test-uuid-1234") {
    throw new Error("Payload missing client_id");
  }
  const event = capturedPayload.events[0];
  if (event.name !== "hammer_clicked") throw new Error("Event name mismatch");
  if (event.params.os !== "mac") throw new Error("OS was not attached to event params");
  if (event.params.trigger !== "manual") throw new Error("Event param trigger mismatch");
  if (event.params.forbidden_url !== undefined) throw new Error("Forbidden URL was not stripped from event params");
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
        getManifest: () => ({ version: "1.0.5" })
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
  if (u1.searchParams.get("v") !== "1.0.5") throw new Error("Version mismatch in setUninstallURL");
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

Promise.all([
  assertDownloadCountsBytesBeforeBodyFinishes(),
  assertAnalyticsStorageAndSend(),
  assertUninstallURLSync(),
  assertDiagnosticsLogger()
])
  .then(() => console.log("All tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
