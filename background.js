const ALARM_NAME = "speed-nudge";
const WAKE_HISTORY_KEY = "wakeHistory";
const REAL_TEST_HISTORY_KEY = "realTestHistory";
const MONITORING_KEY = "monitoringEnabled";
const FREQUENCY_KEY = "frequencyMinutes";
const STATUS_KEY = "monitorStatus";
const PROBE_FAILURES_KEY = "watchdogConsecutiveFailures";
const INSTALL_DATE_KEY = "installedAt";
const WAKE_ATTEMPTS_KEY = "totalWakeAttempts";
const WAKE_SUCCESSES_KEY = "totalWakeSuccesses";
const MAX_UNINSTALL_URL_LENGTH = 1023;
const DEFAULT_FREQUENCY_MINUTES = 30;
const MIN_FREQUENCY_MINUTES = 5;
const MAX_FREQUENCY_MINUTES = 360;
const FAST_HOME_URL = "https://fast.com/";
const PROBE_URL = "https://fast.com/favicon.ico";
const CONFIG_ENDPOINT = "https://api.fast.com/netflix/speedtest/v2";
const FAST_FALLBACK_TOKEN = "YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm";
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours — rolling window
const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_RTT_THRESHOLD_MS = 3_000;
const PROBE_FAILURE_THRESHOLD = 2;
const MIN_CONNECTIONS = 1;
const MAX_CONNECTIONS = 8;
const MIN_TEST_SECONDS = 5;
const MAX_TEST_SECONDS = 10;
const DOWNLOAD_CHUNK_BYTES = 26_214_400;
const UPLOAD_CHUNK_BYTES = 2_621_440;
const PROBE_DOWNLOAD_BYTES = 128_000;
const PROBE_UPLOAD_BYTES = 64_000;
let measurementInFlight = false;

if (typeof importScripts === "function") {
  try {
    importScripts("analytics-config.js", "analytics.js", "diagnostics.js");
  } catch (err) {
    console.warn("WiFi Hammer analytics/diagnostics failed to load:", err);
  }
}

function sendAnalyticsEvent(name, params) {
  if (typeof trackEvent === "function") {
    void trackEvent(name, params);
  }
}

function logBackgroundDiagnostic(event, details = null, error = null) {
  if (typeof logDiagnostic === "function") {
    void logDiagnostic("background", event, details, error);
  }
}

function categorizeWakeError(error) {
  const msg = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
  if (msg.includes("reach the network") || msg.includes("offline")) return "no_network";
  if (msg.includes("abort") || msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  if (msg.includes("speed test") || msg.includes("fast.com")) return "speedtest_unreachable";
  return "other";
}

function getUninstallConfigUrl() {
  const config = (typeof self !== "undefined" && self.ANALYTICS_CONFIG)
    ? self.ANALYTICS_CONFIG
    : (typeof globalThis !== "undefined" && globalThis.ANALYTICS_CONFIG)
      ? globalThis.ANALYTICS_CONFIG
      : null;
  return config?.UNINSTALL_URL || config?.FEEDBACK_FORM_URL || "";
}

function buildUninstallURL({ baseUrl, version, os, daysInstalled, attempts, successes }) {
  if (!baseUrl || typeof baseUrl !== "string") return "";
  const trimmed = baseUrl.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return "";

  try {
    const url = new URL(trimmed);
    if (version) url.searchParams.set("v", String(version).slice(0, 20));
    if (os) url.searchParams.set("os", String(os).slice(0, 20));
    if (Number.isFinite(daysInstalled)) url.searchParams.set("days", String(Math.max(0, Math.floor(daysInstalled))));
    if (Number.isFinite(attempts)) url.searchParams.set("attempts", String(Math.max(0, Math.floor(attempts))));
    if (Number.isFinite(successes)) url.searchParams.set("successes", String(Math.max(0, Math.floor(successes))));

    let finalUrl = url.toString();
    if (finalUrl.length <= MAX_UNINSTALL_URL_LENGTH) {
      return finalUrl;
    }

    const nonEssentialParams = ["attempts", "successes", "days", "os", "v"];
    for (const p of nonEssentialParams) {
      url.searchParams.delete(p);
      finalUrl = url.toString();
      if (finalUrl.length <= MAX_UNINSTALL_URL_LENGTH) {
        return finalUrl;
      }
    }
    return finalUrl.slice(0, MAX_UNINSTALL_URL_LENGTH);
  } catch {
    return "";
  }
}

async function incrementWakeCounter(key) {
  try {
    const stored = await chrome.storage.local.get(key);
    const current = typeof stored[key] === "number" ? stored[key] : 0;
    await chrome.storage.local.set({ [key]: current + 1 });
  } catch {
    // Fail silently
  }
}

async function syncUninstallURL() {
  if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.setUninstallURL !== "function") {
    return;
  }
  try {
    const baseUrl = getUninstallConfigUrl();
    if (!baseUrl) {
      await chrome.runtime.setUninstallURL("");
      return;
    }

    const stored = await chrome.storage.local.get([INSTALL_DATE_KEY, WAKE_ATTEMPTS_KEY, WAKE_SUCCESSES_KEY]);
    let installedAt = stored[INSTALL_DATE_KEY];
    if (!installedAt || typeof installedAt !== "number") {
      installedAt = Date.now();
      await chrome.storage.local.set({ [INSTALL_DATE_KEY]: installedAt });
    }

    const attempts = typeof stored[WAKE_ATTEMPTS_KEY] === "number" ? stored[WAKE_ATTEMPTS_KEY] : 0;
    const successes = typeof stored[WAKE_SUCCESSES_KEY] === "number" ? stored[WAKE_SUCCESSES_KEY] : 0;
    const daysInstalled = Math.max(0, Math.floor((Date.now() - installedAt) / (1000 * 60 * 60 * 24)));

    let os = "unknown";
    if (typeof chrome.runtime.getPlatformInfo === "function") {
      try {
        const info = await chrome.runtime.getPlatformInfo();
        if (info?.os) os = info.os;
      } catch {
        // ignore
      }
    }

    const manifest = typeof chrome.runtime.getManifest === "function" ? chrome.runtime.getManifest() : null;
    const version = manifest?.version || "unknown";

    const uninstallUrl = buildUninstallURL({
      baseUrl,
      version,
      os,
      daysInstalled,
      attempts,
      successes
    });

    await chrome.runtime.setUninstallURL(uninstallUrl);
  } catch {
    // Fail silently
  }
}

function handleInstalled(details) {
  void ensureAlarm();
  void syncUninstallURL();
  if (details?.reason !== "install") return;

  const manifest = (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getManifest === "function")
    ? chrome.runtime.getManifest()
    : { version: "unknown" };
  sendAnalyticsEvent("extension_installed", {
    reason: details?.reason || "install",
    version: manifest?.version || "unknown",
    previous_version: details?.previousVersion || ""
  });
}

chrome.runtime.onInstalled.addListener(handleInstalled);

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
  void syncUninstallURL();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "setMonitoring") {
    void setMonitoring(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true, enabled: Boolean(message.enabled) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "runNow") {
    void runSpeedNudge({ fullTest: true })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "getMonitoringState") {
    void getMonitoringState()
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "setFrequency") {
    void setFrequency(message.minutes)
      .then((minutes) => sendResponse({ ok: true, minutes }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void runWatchdogCycle().catch((error) => {
      logBackgroundDiagnostic("alarm_handler_error", null, error);
      console.warn("WiFi Hammer alarm handler failed:", error);
    });
  }
});

async function ensureAlarm() {
  const stored = await chrome.storage.local.get([MONITORING_KEY, FREQUENCY_KEY]);
  await chrome.storage.local.set({
    [FREQUENCY_KEY]: normalizeFrequency(stored[FREQUENCY_KEY])
  });
  await setMonitoring(stored[MONITORING_KEY] !== false);
}

async function setMonitoring(enabled) {
  await chrome.storage.local.set({ [MONITORING_KEY]: enabled });
  if (enabled) {
    const frequency = await getFrequency();
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: frequency
    });
  } else {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.storage.local.set({ [PROBE_FAILURES_KEY]: 0 });
  }
}

async function getMonitoringState() {
  const stored = await chrome.storage.local.get([MONITORING_KEY, FREQUENCY_KEY, STATUS_KEY]);
  return {
    enabled: stored[MONITORING_KEY] !== false,
    minutes: normalizeFrequency(stored[FREQUENCY_KEY]),
    status: stored[STATUS_KEY] || null
  };
}

async function getFrequency() {
  const stored = await chrome.storage.local.get(FREQUENCY_KEY);
  return normalizeFrequency(stored[FREQUENCY_KEY]);
}

async function setFrequency(value) {
  const minutes = normalizeFrequency(value);
  if (Number(value) !== minutes || minutes < MIN_FREQUENCY_MINUTES || minutes > MAX_FREQUENCY_MINUTES) {
    throw new Error("Pick a time from 5 minutes to 6 hours.");
  }
  await chrome.storage.local.set({ [FREQUENCY_KEY]: minutes });
  if (await getMonitoringState().then((state) => state.enabled)) {
    await setMonitoring(true);
  }
  return minutes;
}

function shouldTriggerWatchdogHammer({ healthy, consecutiveFailures }) {
  return !healthy && consecutiveFailures >= PROBE_FAILURE_THRESHOLD;
}

async function probeNetwork() {
  const startedAt = performance.now();
  try {
    const response = await fetchWithTimeout(PROBE_URL, {
      cache: "no-store",
      credentials: "omit"
    }, PROBE_TIMEOUT_MS);
    const rttMs = Math.round(performance.now() - startedAt);
    const responseUrl = new URL(response.url || PROBE_URL);
    const isFastHost = responseUrl.hostname === "fast.com" || responseUrl.hostname.endsWith(".fast.com");
    if (!isFastHost) {
      throw new Error("Network probe was redirected.");
    }
    await response.body?.cancel?.();
    return { healthy: rttMs <= PROBE_RTT_THRESHOLD_MS, rttMs };
  } catch (error) {
    return {
      healthy: false,
      rttMs: Math.round(performance.now() - startedAt),
      errorType: categorizeWakeError(error)
    };
  }
}

async function runWatchdogCycle() {
  const state = await getMonitoringState();
  if (!state.enabled) return;

  const probe = await probeNetwork();
  const stored = await chrome.storage.local.get([PROBE_FAILURES_KEY, STATUS_KEY]);
  const previousFailures = Number.isFinite(stored[PROBE_FAILURES_KEY]) ? stored[PROBE_FAILURES_KEY] : 0;
  const consecutiveFailures = probe.healthy ? 0 : previousFailures + 1;
  const now = Date.now();
  const previousStatus = stored[STATUS_KEY] || {};
  await chrome.storage.local.set({
    [PROBE_FAILURES_KEY]: consecutiveFailures,
    [STATUS_KEY]: {
      ...previousStatus,
      lastCheckAt: now,
      lastProbeAt: now,
      lastProbeResult: probe.healthy ? "ok" : "fail",
      lastProbeRttMs: probe.rttMs
    }
  });

  const probeParams = {
    result: probe.healthy ? "ok" : "fail",
    failure_count: consecutiveFailures,
    threshold_ms: PROBE_RTT_THRESHOLD_MS,
    interval_minutes: state.minutes
  };
  if (Number.isFinite(probe.rttMs)) probeParams.rtt_ms = probe.rttMs;
  if (probe.errorType) probeParams.error_type = probe.errorType;
  logBackgroundDiagnostic("network_probe", probeParams);
  sendAnalyticsEvent("network_probe", probeParams);

  if (!shouldTriggerWatchdogHammer({ healthy: probe.healthy, consecutiveFailures })) return;

  const triggerParams = {
    reason: "consecutive_probe_failures",
    consecutive_failures: consecutiveFailures,
    threshold_ms: PROBE_RTT_THRESHOLD_MS,
    interval_minutes: state.minutes
  };
  if (Number.isFinite(probe.rttMs)) triggerParams.rtt_ms = probe.rttMs;
  sendAnalyticsEvent("auto_hammer_triggered", triggerParams);
  sendAnalyticsEvent("auto_hammer_pulse", {
    mode: "watchdog",
    reason: "consecutive_probe_failures",
    consecutive_failures: consecutiveFailures
  });
  await chrome.storage.local.set({ [PROBE_FAILURES_KEY]: 0 });
  await runSpeedNudge({ fullTest: true, trigger: "watchdog" });
}

async function runSpeedNudge({ fullTest = false, trigger } = {}) {
  const wakeTrigger = trigger || (fullTest ? "manual" : "auto");
  if (measurementInFlight) {
    logBackgroundDiagnostic("wake_aborted", { reason: "already_running" });
    sendAnalyticsEvent("wake_failure", {
      trigger: wakeTrigger,
      error_type: "other"
    });
    throw new Error("A wake-up is already running.");
  }
  measurementInFlight = true;
  const startedAt = Date.now();
  logBackgroundDiagnostic("wake_start", { mode: wakeTrigger });
  await incrementWakeCounter(WAKE_ATTEMPTS_KEY);
  try {
    const test = await measureConnection({ fullTest });
    if (!Number.isFinite(test.downloadMbps) || !Number.isFinite(test.uploadMbps)) {
      throw new Error("Could not wake Wi‑Fi this time.");
    }

    await incrementWakeCounter(WAKE_SUCCESSES_KEY);
    await syncUninstallURL();

    const now = Date.now();
    const historyKey = trigger === "watchdog"
      ? WAKE_HISTORY_KEY
      : (fullTest ? REAL_TEST_HISTORY_KEY : WAKE_HISTORY_KEY);
    const stored = await chrome.storage.local.get([historyKey, STATUS_KEY]);
    const history = pruneHistory(stored[historyKey], now);
    history.push([now, roundMbps(test.downloadMbps), roundMbps(test.uploadMbps)]);
    const previous = stored[STATUS_KEY] || {};
    const beforeDownload = Number.isFinite(previous.downloadMbps) ? previous.downloadMbps : null;
    const beforeUpload = Number.isFinite(previous.uploadMbps) ? previous.uploadMbps : null;
    const timeToRecoverMs = Math.max(0, now - startedAt);
    logBackgroundDiagnostic("wake_success", {
      mode: wakeTrigger,
      downloadMbps: roundMbps(test.downloadMbps),
      uploadMbps: roundMbps(test.uploadMbps),
      timeToRecoverMs,
      server: test.server
    });
    sendAnalyticsEvent("wake_success", {
      trigger: wakeTrigger,
      time_to_recover_ms: timeToRecoverMs,
      before_download_mbps: beforeDownload,
      after_download_mbps: roundMbps(test.downloadMbps),
      before_upload_mbps: beforeUpload,
      after_upload_mbps: roundMbps(test.uploadMbps)
    });
    await chrome.storage.local.set({
      [historyKey]: history,
      [STATUS_KEY]: {
        lastAttemptAt: startedAt,
        lastSuccessAt: now,
        lastError: null,
        lastCheckAt: fullTest ? previous.lastCheckAt || null : now,
        lastHammerAt: fullTest ? now : previous.lastHammerAt || null,
        downloadMbps: roundMbps(test.downloadMbps),
        uploadMbps: roundMbps(test.uploadMbps),
        unloadedLatencyMs: test.unloadedLatencyMs,
        loadedLatencyMs: test.loadedLatencyMs,
        downloadBytes: test.downloadBytes,
        uploadBytes: test.uploadBytes,
        server: test.server,
        mode: test.mode
      }
    });
    return history.at(-1);
  } catch (error) {
    const timeToFailMs = Math.max(0, Date.now() - startedAt);
    const errorType = categorizeWakeError(error);
    logBackgroundDiagnostic("wake_failure", {
      mode: wakeTrigger,
      errorType,
      timeToFailMs
    }, error);
    sendAnalyticsEvent("wake_failure", {
      trigger: wakeTrigger,
      error_type: errorType,
      time_to_fail_ms: timeToFailMs
    });
    console.warn("WiFi Hammer speed nudge failed:", error);
    const previous = await chrome.storage.local.get(STATUS_KEY);
    const prior = previous[STATUS_KEY] || {};
    await chrome.storage.local.set({
      [STATUS_KEY]: {
        lastAttemptAt: startedAt,
        lastSuccessAt: prior.lastSuccessAt || null,
        lastCheckAt: prior.lastCheckAt || null,
        lastHammerAt: prior.lastHammerAt || null,
        lastError: error instanceof Error ? error.message : "Wake-up failed."
      }
    });
    await syncUninstallURL();
    throw error;
  } finally {
    measurementInFlight = false;
  }
}

async function measureConnection({ fullTest = false } = {}) {
  const config = await fetchFastConfig();
  const targets = Array.isArray(config.targets) ? config.targets : [];
  if (targets.length === 0) {
    throw new Error("Could not reach the network.");
  }

  let lastError;
  for (const target of targets.slice(0, 3)) {
    try {
      return await measureTarget(target, targets, fullTest);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Network wake-up failed.");
}

async function measureTarget(target, targets, fullTest) {
  const unloadedLatencyMs = await measureLatency(target);
  if (!fullTest) {
    const download = await transferProbe("download", target, PROBE_DOWNLOAD_BYTES);
    const upload = await transferProbe("upload", target, PROBE_UPLOAD_BYTES);
    return {
      downloadMbps: download.mbps,
      uploadMbps: upload.mbps,
      unloadedLatencyMs,
      loadedLatencyMs: null,
      downloadBytes: download.bytes,
      uploadBytes: upload.bytes,
      server: target.name || target.url,
      mode: "probe"
    };
  }
  const download = await measurePhase("download", target, targets, DOWNLOAD_CHUNK_BYTES);
  const [upload, loadedLatencyMs] = await Promise.all([
    measurePhase("upload", target, targets, UPLOAD_CHUNK_BYTES),
    measureLatency(target)
  ]);
  return {
    downloadMbps: download.mbps,
    uploadMbps: upload.mbps,
    unloadedLatencyMs,
    loadedLatencyMs,
    downloadBytes: download.bytes,
    uploadBytes: upload.bytes,
    server: target.name || target.url,
    mode: "full"
  };
}

async function transferProbe(type, target, bytes) {
  const started = performance.now();
  const response = await fetchWithTimeout(rangeUrl(target.url, bytes), {
    method: type === "upload" ? "POST" : "GET",
    body: type === "upload" ? new Uint8Array(bytes) : undefined,
    cache: "no-store",
    credentials: "omit",
    headers: type === "upload" ? { "Content-Type": "application/octet-stream" } : {}
  });
  const data = await response.arrayBuffer();
  const measuredBytes = type === "upload" ? bytes : data.byteLength;
  return {
    bytes: measuredBytes,
    mbps: (measuredBytes * 8) / Math.max((performance.now() - started) / 1000, 0.001) / 1_000_000
  };
}

async function measureLatency(target) {
  const started = performance.now();
  const response = await fetchWithTimeout(rangeUrl(target.url, 0), {
    method: "POST",
    body: new Uint8Array(0),
    cache: "no-store",
    credentials: "omit",
    headers: { "Content-Type": "application/octet-stream" }
  });
  await response.arrayBuffer();
  return Math.round(performance.now() - started);
}

async function measurePhase(type, primaryTarget, targets, chunkBytes) {
  const started = performance.now();
  const stopAt = started + MAX_TEST_SECONDS * 1000;
  const bytesByConnection = Array(MAX_CONNECTIONS).fill(0);
  const controllers = new Set();
  let nextTargetIndex = 0;

  const worker = async (workerIndex) => {
    while (performance.now() < stopAt) {
      const target = targets[(nextTargetIndex++) % Math.min(targets.length, 5)] || primaryTarget;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const url = rangeUrl(target.url, chunkBytes);
        const response = await fetchWithTimeout(url, {
          method: type === "upload" ? "POST" : "GET",
          body: type === "upload" ? new Uint8Array(chunkBytes) : undefined,
          cache: "no-store",
          credentials: "omit",
          headers: type === "upload" ? { "Content-Type": "application/octet-stream" } : {},
          signal: controller.signal
        });
        await readMeasuredBody(type, response, chunkBytes, (byteLength) => {
          bytesByConnection[workerIndex] += byteLength;
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        logBackgroundDiagnostic("worker_conn_reset", { workerIndex, type }, error);
        break;
      } finally {
        controllers.delete(controller);
      }
    }
  };

  const workers = Array.from({ length: MAX_CONNECTIONS }, (_, index) => worker(index));
  
  let elapsed = 0;
  while (elapsed < MAX_TEST_SECONDS) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    elapsed++;
    const currentBytes = bytesByConnection.reduce((sum, value) => sum + value, 0);
    const currentElapsed = Math.max((performance.now() - started) / 1000, 0.001);
    const currentMbps = (currentBytes * 8) / currentElapsed / 1_000_000;
    
    chrome.runtime.sendMessage({
      type: "speedTestProgress",
      phase: type,
      elapsedSeconds: elapsed,
      totalSeconds: MAX_TEST_SECONDS,
      mbps: currentMbps,
      bytes: currentBytes
    }).catch(() => {}); // ignore errors if popup closed
  }

  controllers.forEach((controller) => controller.abort());
  await Promise.allSettled(workers);

  const elapsedSeconds = Math.max((performance.now() - started) / 1000, MIN_TEST_SECONDS);
  const bytes = bytesByConnection.reduce((sum, value) => sum + value, 0);
  if (bytes <= 0) throw new Error("Got no data back from the network.");
  return { mbps: (bytes * 8) / elapsedSeconds / 1_000_000, bytes };
}

async function readMeasuredBody(type, response, chunkBytes, onBytes) {
  if (type === "upload") {
    await response.arrayBuffer();
    onBytes(chunkBytes);
    return chunkBytes;
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const data = await response.arrayBuffer();
    onBytes(data.byteLength);
    return data.byteLength;
  }

  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const byteLength = value?.byteLength || 0;
    if (byteLength <= 0) continue;
    total += byteLength;
    onBytes(byteLength);
  }
  return total;
}

async function fetchFastConfig() {
  let token = null;
  try {
    const homeResponse = await fetchWithTimeout(FAST_HOME_URL, {
      cache: "no-store",
      credentials: "omit"
    });
    const homeHtml = await homeResponse.text();
    const scriptMatch = homeHtml.match(/<script[^>]+src\s*=\s*["'](\/app-[^"']+\.js)["']/i)
      || homeHtml.match(/(\/app-[^"'<>]+\.js)/i);
    if (scriptMatch) {
      const scriptResponse = await fetchWithTimeout(new URL(scriptMatch[1], FAST_HOME_URL), {
        cache: "no-store",
        credentials: "omit"
      });
      const script = await scriptResponse.text();
      const tokenMatch = script.match(/getTestOcasParams\s*:\s*\{[^}]*?token\s*:\s*["']([^"']+)["']/);
      if (tokenMatch) {
        token = tokenMatch[1];
      }
    }
  } catch (err) {
    logBackgroundDiagnostic("fast_scrape_failed", { note: "Falling back to default token" }, err);
  }

  if (!token) {
    token = FAST_FALLBACK_TOKEN;
    logBackgroundDiagnostic("fast_token_fallback", { token: FAST_FALLBACK_TOKEN });
  }

  const configUrl = appendQuery(CONFIG_ENDPOINT, {
    https: "true",
    token,
    urlCount: 5
  });
  try {
    return await fetchJson(configUrl);
  } catch (err) {
    logBackgroundDiagnostic("fast_config_failed", { note: "Speed test endpoint unreachable" }, err);
    throw new Error("Couldn't reach the speed test — check your connection.");
  }
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    cache: "no-store",
    credentials: "omit"
  });
  return response.json();
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const abortFromCaller = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Network failed (${response.status}).`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function appendQuery(url, params) {
  const query = new URLSearchParams(params);
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function rangeUrl(url, bytes) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace("/speedtest", `/speedtest/range/0-${bytes}`);
  return parsed.toString();
}

function pruneHistory(value, now) {
  if (!Array.isArray(value)) return [];
  const cutoff = now - RETENTION_MS;
  return value.filter(
    (point) =>
      Array.isArray(point) &&
      point.length === 3 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]) &&
      Number.isFinite(point[2]) &&
      point[0] >= cutoff &&
      point[0] <= now
  );
}

function roundMbps(value) {
  return Math.round(value * 100) / 100;
}

function normalizeFrequency(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= MIN_FREQUENCY_MINUTES && minutes <= MAX_FREQUENCY_MINUTES
    ? minutes
    : DEFAULT_FREQUENCY_MINUTES;
}
