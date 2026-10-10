const ALARM_NAME = "speed-nudge";
const WAKE_HISTORY_KEY = "wakeHistory";
const REAL_TEST_HISTORY_KEY = "realTestHistory";
const MONITORING_KEY = "monitoringEnabled";
const FREQUENCY_KEY = "frequencyMinutes";
const STATUS_KEY = "monitorStatus";
const DEFAULT_FREQUENCY_MINUTES = 30;
const MIN_FREQUENCY_MINUTES = 5;
const MAX_FREQUENCY_MINUTES = 360;
const FAST_HOME_URL = "https://fast.com/";
const CONFIG_ENDPOINT = "https://api.fast.com/netflix/speedtest/v2";
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours — rolling window
const REQUEST_TIMEOUT_MS = 60_000;
const MIN_CONNECTIONS = 1;
const MAX_CONNECTIONS = 8;
const MIN_TEST_SECONDS = 5;
const MAX_TEST_SECONDS = 30;
const DOWNLOAD_CHUNK_BYTES = 26_214_400;
const UPLOAD_CHUNK_BYTES = 2_621_440;
const PROBE_DOWNLOAD_BYTES = 128_000;
const PROBE_UPLOAD_BYTES = 64_000;
let measurementInFlight = false;

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
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
    void getMonitoringState().then((state) => {
      if (state.enabled) return runSpeedNudge({ fullTest: false });
    }).catch((error) => {
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

async function runSpeedNudge({ fullTest = false } = {}) {
  if (measurementInFlight) {
    throw new Error("A wake-up is already running.");
  }
  measurementInFlight = true;
  const startedAt = Date.now();
  try {
    const test = await measureConnection({ fullTest });
    if (!Number.isFinite(test.downloadMbps) || !Number.isFinite(test.uploadMbps)) {
      throw new Error("Could not wake Wi‑Fi this time.");
    }

    const now = Date.now();
    const historyKey = fullTest ? REAL_TEST_HISTORY_KEY : WAKE_HISTORY_KEY;
    const stored = await chrome.storage.local.get([historyKey, STATUS_KEY]);
    const history = pruneHistory(stored[historyKey], now);
    history.push([now, roundMbps(test.downloadMbps), roundMbps(test.uploadMbps)]);
    const previous = stored[STATUS_KEY] || {};
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
        throw error;
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
  const homeResponse = await fetchWithTimeout(FAST_HOME_URL, {
    cache: "no-store",
    credentials: "omit"
  });
  const homeHtml = await homeResponse.text();
  const scriptMatch = homeHtml.match(/<script[^>]+src\s*=\s*["'](\/app-[^"']+\.js)["']/i)
    || homeHtml.match(/(\/app-[^"'<>]+\.js)/i);
  if (!scriptMatch) {
    throw new Error("Could not start the wake-up.");
  }

  const scriptResponse = await fetchWithTimeout(new URL(scriptMatch[1], FAST_HOME_URL), {
    cache: "no-store",
    credentials: "omit"
  });
  const script = await scriptResponse.text();
  const tokenMatch = script.match(/getTestOcasParams\s*:\s*\{[^}]*?token\s*:\s*["']([^"']+)["']/);
  if (!tokenMatch) {
    throw new Error("Could not start the wake-up.");
  }

  const configUrl = appendQuery(CONFIG_ENDPOINT, {
    https: "true",
    token: tokenMatch[1],
    urlCount: 5
  });
  return fetchJson(configUrl);
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    cache: "no-store",
    credentials: "omit"
  });
  return response.json();
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
