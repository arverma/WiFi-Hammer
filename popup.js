const HISTORY_KEY = "wakeHistory";
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours — matches the chart window
const SVG_NS = "http://www.w3.org/2000/svg";
const RANGE_LABELS = {
  daily: "Last 24 hours"
};
const STATUS_FLASH_MS = 4000;
const MIN_PROGRESS_MBPS = 0.1;
const RATING_STATE_KEY = "ratingPromptState";
const WAKE_SUCCESSES_KEY = "totalWakeSuccesses";
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const CWS_REVIEWS_URL = "https://chromewebstore.google.com/detail/wifi-hammer/dbphaafiokokiaocpcnfakompafjoddj/reviews";

let history = [];
let selectedRange = "daily";
let monitoringEnabled = true;
let lastPulseAt = 0;
let statusFlash = null;
let statusFlashTimer = null;

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("toggle-monitoring").addEventListener("click", toggleMonitoring);
    document.getElementById("run-now").addEventListener("click", runNow);
    document.getElementById("frequency").addEventListener("change", updateFrequency);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes[HISTORY_KEY] || changes.monitorStatus || changes.monitoringEnabled || changes.frequencyMinutes)) {
        void loadHistory();
        void loadMonitoringState();
      }
    });
    const aboutPanel = document.getElementById("about-dialog");
    document.getElementById("about-button").addEventListener("click", () => {
      aboutPanel.removeAttribute("hidden");
    });
    document.getElementById("close-about").addEventListener("click", () => {
      aboutPanel.setAttribute("hidden", "");
    });

    const rateBtn = document.getElementById("rating-rate-btn");
    if (rateBtn) rateBtn.addEventListener("click", handleRateClicked);

    const neverBtn = document.getElementById("rating-never-btn");
    if (neverBtn) neverBtn.addEventListener("click", handleNeverClicked);

    const closeRatingBtn = document.getElementById("rating-close");
    if (closeRatingBtn) closeRatingBtn.addEventListener("click", handleDismissClicked);

    const openDiagBtn = document.getElementById("open-diagnostics");
    if (openDiagBtn) openDiagBtn.addEventListener("click", openDiagnostics);

    const closeDiagBtn = document.getElementById("close-diagnostics");
    if (closeDiagBtn) closeDiagBtn.addEventListener("click", closeDiagnostics);

    const copyDiagBtn = document.getElementById("diagnostics-copy");
    if (copyDiagBtn) copyDiagBtn.addEventListener("click", copyDiagnostics);

    const clearDiagBtn = document.getElementById("diagnostics-clear");
    if (clearDiagBtn) clearDiagBtn.addEventListener("click", clearDiagnosticsLogs);

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "speedTestProgress") {
        handleSpeedTestProgress(message);
      }
    });

    void initialize();
  });
}

function handleSpeedTestProgress(progress) {
  const { phase, elapsedSeconds, totalSeconds, mbps } = progress;
  const remaining = Math.max(0, totalSeconds - elapsedSeconds);
  setControlStatus(`Waking Wi‑Fi… (${remaining}s)`);

  const elementId = phase === "download" ? "download-value" : "upload-value";
  const el = document.getElementById(elementId);
  if (!el) return;

  if (mbps >= MIN_PROGRESS_MBPS) {
    const val = mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2);
    el.innerHTML = `${val} <span class="metric-unit">Mbps</span>`;
    return;
  }

  const latest = history[history.length - 1];
  const known = latest ? latest[phase === "download" ? 1 : 2] : null;
  if (Number.isFinite(known)) {
    el.innerHTML = `${formatNumber(known)} <span class="metric-unit">Mbps</span><span class="metric-checking">checking…</span>`;
  } else {
    el.innerHTML = `<span class="metric-empty">—</span><span class="metric-unit">Mbps</span><span class="metric-checking">checking…</span>`;
  }
}

function sendAnalyticsEvent(name, params) {
  if (typeof trackEvent === "function") {
    void trackEvent(name, params);
  }
}

function shouldShowRatingPrompt({ successes, dismissedForever, lastPromptedAt, now = Date.now() }) {
  if (dismissedForever) return false;
  if (typeof successes !== "number" || successes < 3) return false;
  if (lastPromptedAt && (now - lastPromptedAt) < FOURTEEN_DAYS_MS) return false;
  return true;
}

async function checkAndShowRatingPrompt() {
  const banner = document.getElementById("rating-banner");
  if (!banner) return;

  try {
    const stored = await chrome.storage.local.get([
      RATING_STATE_KEY,
      WAKE_SUCCESSES_KEY,
      HISTORY_KEY
    ]);
    const state = stored[RATING_STATE_KEY] || {};
    const rawSuccesses = stored[WAKE_SUCCESSES_KEY];
    const wakeHistory = stored[HISTORY_KEY];
    const successes = typeof rawSuccesses === "number"
      ? rawSuccesses
      : (Array.isArray(wakeHistory) ? wakeHistory.length : 0);

    const now = Date.now();
    if (!shouldShowRatingPrompt({
      successes,
      dismissedForever: Boolean(state.dismissedForever),
      lastPromptedAt: state.lastPromptedAt,
      now
    })) {
      return;
    }

    banner.removeAttribute("hidden");
    await chrome.storage.local.set({
      [RATING_STATE_KEY]: {
        ...state,
        lastPromptedAt: now
      }
    });
    sendAnalyticsEvent("rating_prompt_shown");
  } catch (err) {
    console.warn("WiFi Hammer rating prompt check failed:", err);
  }
}

async function handleRateClicked() {
  const banner = document.getElementById("rating-banner");
  if (banner) banner.setAttribute("hidden", "");

  try {
    const stored = await chrome.storage.local.get(RATING_STATE_KEY);
    const state = stored[RATING_STATE_KEY] || {};
    await chrome.storage.local.set({
      [RATING_STATE_KEY]: {
        ...state,
        dismissedForever: true,
        ratedAt: Date.now()
      }
    });
  } catch {
    // Ignore
  }

  sendAnalyticsEvent("rating_prompt_clicked");

  if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function") {
    chrome.tabs.create({ url: CWS_REVIEWS_URL });
  } else {
    window.open(CWS_REVIEWS_URL, "_blank");
  }
}

async function handleNeverClicked() {
  const banner = document.getElementById("rating-banner");
  if (banner) banner.setAttribute("hidden", "");

  try {
    const stored = await chrome.storage.local.get(RATING_STATE_KEY);
    const state = stored[RATING_STATE_KEY] || {};
    await chrome.storage.local.set({
      [RATING_STATE_KEY]: {
        ...state,
        dismissedForever: true,
        dismissedAt: Date.now()
      }
    });
  } catch {
    // Ignore
  }

  sendAnalyticsEvent("rating_prompt_dismissed", { reason: "dont_ask_again" });
}

function handleDismissClicked() {
  const banner = document.getElementById("rating-banner");
  if (banner) banner.setAttribute("hidden", "");
  sendAnalyticsEvent("rating_prompt_dismissed", { reason: "close" });
}

async function initialize() {
  sendAnalyticsEvent("popup_opened");
  await Promise.all([loadHistory(), loadMonitoringState()]);
  void checkAndShowRatingPrompt();
}

async function loadHistory() {
  try {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    history = normalizeHistory(stored[HISTORY_KEY], Date.now());
    render();
  } catch (error) {
    console.error("Unable to load speed history:", error);
    renderEmpty("History is temporarily unavailable.");
  }
}

async function loadMonitoringState() {
  try {
    const response = await sendMessage({ type: "getMonitoringState" });
    if (!response?.ok) throw new Error(response?.error || "Unable to read monitoring state.");
    monitoringEnabled = response.enabled;
    document.getElementById("frequency").value = String(response.minutes);
    renderControls();
    renderHealth(response.status);
  } catch (error) {
    console.error("Unable to load monitoring state:", error);
    setControlStatus("Couldn't load status");
  }
}

async function updateFrequency(event) {
  const minutes = Number(event.target.value);
  clearStatusFlash();
  try {
    const response = await sendMessage({ type: "setFrequency", minutes });
    if (!response?.ok) throw new Error(response?.error || "Unable to update frequency.");
    flashStatus(`Every ${formatFrequency(response.minutes)}`);
  } catch (error) {
    console.error("Unable to update frequency:", error);
    setControlStatus("Pick another time");
    await loadMonitoringState();
  }
}

async function toggleMonitoring() {
  const button = document.getElementById("toggle-monitoring");
  button.setAttribute("aria-busy", "true");
  clearStatusFlash();
  try {
    const response = await sendMessage({ type: "setMonitoring", enabled: !monitoringEnabled });
    if (!response?.ok) throw new Error(response?.error || "Unable to update monitoring.");
    monitoringEnabled = response.enabled;
    sendAnalyticsEvent("auto_hammer_toggled", {
      enabled: monitoringEnabled ? "on" : "off"
    });
    renderControls();
  } catch (error) {
    console.error("Unable to update monitoring:", error);
    setControlStatus("Could not update");
  } finally {
    button.removeAttribute("aria-busy");
  }
}

let confirmTimeout = null;

function logPopupDiagnostic(event, details = null, error = null) {
  if (typeof logDiagnostic === "function") {
    void logDiagnostic("popup", event, details, error);
  }
}

async function runNow() {
  const button = document.getElementById("run-now");
  const label = document.getElementById("run-now-label");

  // On Windows Chrome, window.confirm() causes the popup to lose window focus and unload.
  // Instead, use an inline confirmation state directly on the button.
  if (!button.classList.contains("confirming")) {
    button.classList.add("confirming");
    if (label) label.textContent = "Confirm Hammer?";
    setControlStatus("Tap again to confirm");
    logPopupDiagnostic("hammer_click_unconfirmed");

    if (confirmTimeout) clearTimeout(confirmTimeout);
    confirmTimeout = setTimeout(() => {
      button.classList.remove("confirming");
      if (label) label.textContent = "Hammer Hard";
      applyIdleStatus();
      confirmTimeout = null;
    }, 4000);
    return;
  }

  if (confirmTimeout) {
    clearTimeout(confirmTimeout);
    confirmTimeout = null;
  }
  button.classList.remove("confirming");

  sendAnalyticsEvent("hammer_clicked", { trigger: "manual" });
  logPopupDiagnostic("hammer_confirmed");
  clearStatusFlash();
  button.setAttribute("aria-busy", "true");
  if (label) label.textContent = "Hammering…";
  document.body.classList.add("hammering");
  setControlStatus("Waking Wi‑Fi…");
  showCheckingMetrics();
  try {
    const response = await sendMessage({ type: "runNow" });
    if (!response?.ok) throw new Error(response?.error || "Could not wake Wi‑Fi.");
    await loadMonitoringState();
    flashStatus("Wi‑Fi awake");
    void checkAndShowRatingPrompt();
  } catch (error) {
    console.error("Hammer Hard failed:", error);
    logPopupDiagnostic("hammer_failed", null, error);
    setControlStatus("Couldn't wake Wi‑Fi");
  } finally {
    button.removeAttribute("aria-busy");
    if (label) label.textContent = "Hammer Hard";
    document.body.classList.remove("hammering");
  }
}

function showCheckingMetrics() {
  const latest = history[history.length - 1];
  ["download-value", "upload-value"].forEach((id, index) => {
    const el = document.getElementById(id);
    if (!el) return;
    const known = latest ? latest[index + 1] : null;
    if (Number.isFinite(known)) {
      el.innerHTML = `${formatNumber(known)} <span class="metric-unit">Mbps</span><span class="metric-checking">checking…</span>`;
    } else {
      el.innerHTML = `<span class="metric-empty">—</span><span class="metric-unit">Mbps</span><span class="metric-checking">checking…</span>`;
    }
  });
}

function flashStatus(message) {
  clearStatusFlash();
  statusFlash = message;
  setControlStatus(message);
  statusFlashTimer = setTimeout(() => {
    statusFlash = null;
    statusFlashTimer = null;
    applyIdleStatus();
  }, STATUS_FLASH_MS);
}

function clearStatusFlash() {
  if (statusFlashTimer) {
    clearTimeout(statusFlashTimer);
    statusFlashTimer = null;
  }
  statusFlash = null;
}

function applyIdleStatus() {
  const pillText = document.getElementById("status-text");
  if (!pillText) return;
  if (!monitoringEnabled) {
    pillText.textContent = "Paused";
    return;
  }
  const isTesting = document.getElementById("run-now").getAttribute("aria-busy") === "true";
  if (isTesting || statusFlash) return;
  pillText.textContent = lastPulseAt ? `Last pulse · ${formatTimestamp(lastPulseAt)}` : "No pulse yet";
}

function renderControls() {
  const toggle = document.getElementById("toggle-monitoring");
  const iconPath = document.querySelector("#toggle-icon path");
  if (iconPath) {
    iconPath.setAttribute("d", monitoringEnabled
      ? "M4 3h2v10H4zM10 3h2v10h-2z"
      : "M5 3.5v9l7-4.5z");
  }
  document.getElementById("toggle-label").textContent = monitoringEnabled ? "Pause" : "Resume";
  const toggleName = monitoringEnabled ? "Pause monitoring" : "Resume monitoring";
  toggle.setAttribute("aria-label", toggleName);
  toggle.title = toggleName;
  toggle.setAttribute("aria-pressed", String(monitoringEnabled));
  toggle.classList.toggle("active", monitoringEnabled);
  const pill = document.getElementById("status");
  if (!monitoringEnabled) {
    pill.dataset.state = "paused";
    pill.setAttribute("aria-label", "Monitoring paused");
    if (!statusFlash) setControlStatus("Paused");
  } else if (history.length > 0) {
    pill.dataset.state = "ready";
    pill.setAttribute("aria-label", "Wi‑Fi wakes are on");
  } else {
    pill.dataset.state = "empty";
    pill.setAttribute("aria-label", "No wakes yet");
  }
}

function setControlStatus(message) {
  const el = document.getElementById("status-text");
  if (el) el.textContent = message;
}

function renderHealth(status) {
  const health = document.getElementById("health");
  const healthText = document.getElementById("health-text");
  if (!status) {
    lastPulseAt = 0;
    if (healthText) healthText.textContent = "";
    health.dataset.state = "";
  } else if (status.lastError) {
    if (healthText) healthText.textContent = `Last wake failed: ${status.lastError}`;
    health.dataset.state = "error";
  } else {
    const checkAt = status.lastCheckAt || (status.mode === "probe" ? status.lastSuccessAt : null);
    const hammerAt = status.lastHammerAt || (status.mode === "full" ? status.lastSuccessAt : null);
    const lastPulse = Math.max(0, checkAt || 0, hammerAt || 0);
    lastPulseAt = lastPulse;
    if (healthText) healthText.textContent = "";
    health.dataset.state = "";
  }
  applyIdleStatus();
}

function formatFrequency(minutes) {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const NO_RECEIVER_PATTERN = /Receiving end does not exist|message port closed before a response/i;
const SEND_RETRY_DELAYS_MS = [150, 400, 900];

// The MV3 service worker can be asleep or still starting when the popup opens
// (or after an extension update/reload). The first message wakes it, so retry
// briefly instead of surfacing "Receiving end does not exist" to the user.
async function sendMessageWithRetry(send, message, delays = SEND_RETRY_DELAYS_MS) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send(message);
    } catch (error) {
      if (attempt >= delays.length || !NO_RECEIVER_PATTERN.test(String(error?.message || error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

function sendMessage(message) {
  return sendMessageWithRetry((m) => chrome.runtime.sendMessage(m), message);
}

function render() {
  const latest = history[history.length - 1];
  const isEmpty = !latest;
  const isTesting = document.getElementById("run-now").getAttribute("aria-busy") === "true";
  if (!isTesting) {
    document.getElementById("download-value").innerHTML = latest
      ? `${formatNumber(latest[1])} <span class="metric-unit">Mbps</span>`
      : `<span class="metric-empty">—</span><span class="metric-unit">Mbps</span>`;
    document.getElementById("upload-value").innerHTML = latest
      ? `${formatNumber(latest[2])} <span class="metric-unit">Mbps</span>`
      : `<span class="metric-empty">—</span><span class="metric-unit">Mbps</span>`;
  }
  document.getElementById("range-label").textContent = RANGE_LABELS[selectedRange];
  const subtitle = document.getElementById("chart-subtitle");
  if (subtitle) {
    subtitle.title = "The watchdog sends a tiny request and only hammers after two failed checks. Hammer Hard runs a full speed test.";
    subtitle.textContent = isEmpty
      ? "Call lagging? Hit Hammer Hard — no walk to the router."
      : "Auto wake checks quietly and only hammers after two failed checks.";
  }
  const ispHint = document.getElementById("isp-hint");
  if (ispHint) {
    if (isEmpty) ispHint.removeAttribute("hidden");
    else ispHint.setAttribute("hidden", "");
  }
  const pill = document.getElementById("status");
  if (monitoringEnabled) {
    pill.dataset.state = latest ? "ready" : "empty";
    pill.setAttribute("aria-label", latest ? "Wi‑Fi wakes are on" : "No wakes yet");
  }
  applyIdleStatus();
  drawChart(selectPoints(history));
}

function drawChart(points) {
  const chart = document.getElementById("chart");
  chart.replaceChildren();
  if (points.length === 0) {
    const empty = document.createElementNS(SVG_NS, "text");
    empty.setAttribute("x", "180");
    empty.setAttribute("y", "72");
    empty.setAttribute("text-anchor", "middle");
    empty.setAttribute("class", "axis-label");
    empty.textContent = "No wakes yet — first one runs soon";
    chart.append(empty);
    chart.setAttribute("aria-label", "No wakes in the last 24 hours");
    return;
  }

  const width = 340;
  const height = 132;
  const pad = { top: 8, right: 8, bottom: 24, left: 34 };
  const values = points.flatMap((point) => [point[1], point[2]]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const spread = Math.max(max - min, 1);
  const x = (index) => pad.left + (index / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / spread) * (height - pad.top - pad.bottom);

  [0, .5, 1].forEach((fraction) => {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", pad.left);
    line.setAttribute("x2", width - pad.right);
    line.setAttribute("y1", y(min + spread * fraction));
    line.setAttribute("y2", y(min + spread * fraction));
    line.setAttribute("class", "gridline");
    chart.append(line);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", pad.left - 5);
    label.setAttribute("y", y(min + spread * fraction) + 3);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "axis-label");
    label.textContent = `${formatAxisValue(min + spread * fraction)}`;
    chart.append(label);
  });

  const downloadPath = toPath(points, (point) => [x(points.indexOf(point)), y(point[1])]);
  const uploadPath = toPath(points, (point) => [x(points.indexOf(point)), y(point[2])]);
  chart.append(pathElement(downloadPath, "line-download"));
  chart.append(pathElement(uploadPath, "line-upload"));
  [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .filter((index, position, values) => values.indexOf(index) === position)
    .forEach((index) => {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", x(index));
      label.setAttribute("y", height - 3);
      label.setAttribute("text-anchor", index === 0 ? "start" : index === points.length - 1 ? "end" : "middle");
      label.setAttribute("class", "axis-label");
      label.textContent = formatAxisTime(points[index][0]);
      chart.append(label);
    });
  chart.setAttribute("aria-label", `${points.length} wakes. Latest download ${formatNumber(points.at(-1)[1])} Mbps, upload ${formatNumber(points.at(-1)[2])} Mbps.`);
}

function formatAxisValue(value) {
  return value >= 100 ? `${Math.round(value)}` : value.toFixed(1);
}

function formatAxisTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function selectPoints(points) {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  return points.filter((point) => point[0] >= cutoff);
}

function normalizeHistory(value, now) {
  if (!Array.isArray(value)) return [];
  const cutoff = now - RETENTION_MS;
  return value
    .filter((point) => Array.isArray(point) && point.length === 3)
    .map((point) => point.map(Number))
    .filter(([timestamp, download, upload]) =>
      Number.isFinite(timestamp) && Number.isFinite(download) && Number.isFinite(upload) &&
      timestamp >= cutoff && timestamp <= now && download >= 0 && upload >= 0
    )
    .sort((a, b) => a[0] - b[0]);
}

function toPath(points, getCoordinates) {
  return points.map((point, index) => {
    const [x, y] = getCoordinates(point);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function pathElement(d, className) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", className);
  return path;
}

function average(points, index) {
  return points.reduce((sum, point) => sum + point[index], 0) / points.length;
}

function formatNumber(value) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function renderEmpty(message) {
  history = [];
  const chart = document.getElementById("chart");
  chart.replaceChildren();
  const empty = document.createElementNS(SVG_NS, "text");
  empty.setAttribute("x", "180");
  empty.setAttribute("y", "72");
  empty.setAttribute("text-anchor", "middle");
  empty.setAttribute("class", "axis-label");
  empty.textContent = message;
  chart.append(empty);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function openDiagnostics() {
  const panel = document.getElementById("diagnostics-dialog");
  if (!panel) return;
  panel.removeAttribute("hidden");
  await renderDiagnostics();
}

function closeDiagnostics() {
  const panel = document.getElementById("diagnostics-dialog");
  if (panel) panel.setAttribute("hidden", "");
}

async function renderDiagnostics() {
  const metaContainer = document.getElementById("diagnostics-meta");
  const logBox = document.getElementById("diagnostics-log-box");
  if (!metaContainer || !logBox) return;

  let os = "unknown";
  let arch = "unknown";
  if (typeof chrome !== "undefined" && chrome.runtime?.getPlatformInfo) {
    try {
      const info = await chrome.runtime.getPlatformInfo();
      if (info) {
        os = info.os || "unknown";
        arch = info.arch || "unknown";
      }
    } catch {
      // ignore
    }
  }

  const stored = await chrome.storage.local.get([
    "totalWakeAttempts",
    "totalWakeSuccesses",
    "monitoringEnabled",
    "frequencyMinutes"
  ]);

  const attempts = stored.totalWakeAttempts ?? 0;
  const successes = stored.totalWakeSuccesses ?? 0;
  const scaling = typeof window !== "undefined" && window.devicePixelRatio ? `${Math.round(window.devicePixelRatio * 100)}%` : "100%";
  const online = typeof navigator !== "undefined" && navigator.onLine ? "Online" : "Offline";

  metaContainer.innerHTML = `
    <div class="diagnostics-meta-item"><span class="diagnostics-meta-label">OS:</span>${escapeHtml(os)} (${escapeHtml(arch)})</div>
    <div class="diagnostics-meta-item"><span class="diagnostics-meta-label">DPI Scaling:</span>${escapeHtml(scaling)}</div>
    <div class="diagnostics-meta-item"><span class="diagnostics-meta-label">Network:</span>${escapeHtml(online)}</div>
    <div class="diagnostics-meta-item"><span class="diagnostics-meta-label">Wakes:</span>${attempts} tries / ${successes} ok</div>
  `;

  const logs = (typeof WiFiHammerDiagnostics !== "undefined")
    ? await WiFiHammerDiagnostics.getDiagnostics()
    : [];

  if (logs.length === 0) {
    logBox.innerHTML = '<div style="color:#666;padding:8px 0;">No events logged yet. Trigger a wake or pulse to view events.</div>';
    return;
  }

  const entriesHtml = logs.slice().reverse().map((log) => {
    const isError = Boolean(log.error || log.event.includes("failed"));
    const isSuccess = log.event.includes("success");
    const cls = isError ? "diagnostics-log-entry error" : isSuccess ? "diagnostics-log-entry success" : "diagnostics-log-entry";
    const time = log.iso ? log.iso.split("T")[1].replace("Z", "") : new Date(log.timestamp).toLocaleTimeString();
    let detailText = "";
    if (log.details) {
      try {
        detailText = ` ${JSON.stringify(log.details)}`;
      } catch {
        detailText = ` ${String(log.details)}`;
      }
    }
    const errText = log.error ? ` [ERROR: ${log.error}]` : "";
    return `<div class="${cls}">[${escapeHtml(time)}] [${escapeHtml(log.source)}] <strong>${escapeHtml(log.event)}</strong>${escapeHtml(detailText)}${escapeHtml(errText)}</div>`;
  }).join("");

  logBox.innerHTML = entriesHtml;
}

async function copyDiagnostics() {
  const copyBtn = document.getElementById("diagnostics-copy");
  try {
    let os = "unknown";
    let arch = "unknown";
    if (typeof chrome !== "undefined" && chrome.runtime?.getPlatformInfo) {
      try {
        const info = await chrome.runtime.getPlatformInfo();
        if (info) {
          os = info.os;
          arch = info.arch;
        }
      } catch {
        // ignore
      }
    }

    const stored = await chrome.storage.local.get([
      "totalWakeAttempts",
      "totalWakeSuccesses",
      "monitoringEnabled"
    ]);

    const systemInfo = {
      os,
      arch,
      devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      onLine: typeof navigator !== "undefined" ? navigator.onLine : true,
      totalWakeAttempts: stored.totalWakeAttempts,
      totalWakeSuccesses: stored.totalWakeSuccesses,
      monitoringEnabled: stored.monitoringEnabled
    };

    const logs = (typeof WiFiHammerDiagnostics !== "undefined")
      ? await WiFiHammerDiagnostics.getDiagnostics()
      : [];

    const report = (typeof WiFiHammerDiagnostics !== "undefined")
      ? WiFiHammerDiagnostics.formatDiagnosticsReport(logs, systemInfo)
      : JSON.stringify({ systemInfo, logs }, null, 2);

    await navigator.clipboard.writeText(report);
    if (copyBtn) {
      const orig = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = orig; }, 2000);
    }
  } catch (err) {
    console.error("Failed to copy diagnostics report:", err);
  }
}

async function clearDiagnosticsLogs() {
  if (typeof WiFiHammerDiagnostics !== "undefined") {
    await WiFiHammerDiagnostics.clearDiagnostics();
  }
  await renderDiagnostics();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    shouldShowRatingPrompt,
    CWS_REVIEWS_URL,
    sendMessageWithRetry,
    RATING_STATE_KEY,
    FOURTEEN_DAYS_MS
  };
}
