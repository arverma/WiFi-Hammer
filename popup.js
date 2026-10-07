const HISTORY_KEY = "wakeHistory";
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours — matches the chart window
const SVG_NS = "http://www.w3.org/2000/svg";
const RANGE_LABELS = {
  daily: "Last 24 hours"
};
const STATUS_FLASH_MS = 4000;
const MIN_PROGRESS_MBPS = 0.1;

let history = [];
let selectedRange = "daily";
let monitoringEnabled = true;
let statusFlash = null;
let statusFlashTimer = null;

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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "speedTestProgress") {
      handleSpeedTestProgress(message);
    }
  });

  void initialize();
});

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

async function initialize() {
  await Promise.all([loadHistory(), loadMonitoringState()]);
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
    setControlStatus(`Every ${formatFrequency(response.minutes)}`);
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
    renderControls();
  } catch (error) {
    console.error("Unable to update monitoring:", error);
    setControlStatus("Could not update");
  } finally {
    button.removeAttribute("aria-busy");
  }
}

async function runNow() {
  const button = document.getElementById("run-now");
  const label = document.getElementById("run-now-label");
  if (!window.confirm("Hammer Hard uses more data. Wake Wi‑Fi hard now?")) return;
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
  } catch (error) {
    console.error("Hammer Hard failed:", error);
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
  pillText.textContent = history.length > 0 ? "Ready" : "Starting…";
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
  toggle.setAttribute("aria-label", monitoringEnabled ? "Pause monitoring" : "Resume monitoring");
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
    if (healthText) healthText.textContent = "";
    health.dataset.state = "";
  } else if (status.lastError) {
    if (healthText) healthText.textContent = `Last wake failed: ${status.lastError}`;
    health.dataset.state = "error";
  } else {
    const parts = [];
    const checkAt = status.lastCheckAt || (status.mode === "probe" ? status.lastSuccessAt : null);
    const hammerAt = status.lastHammerAt || (status.mode === "full" ? status.lastSuccessAt : null);
    if (checkAt) parts.push(`Last auto wake · ${formatTimestamp(checkAt)}`);
    if (hammerAt) parts.push(`Last Hammer Hard · ${formatTimestamp(hammerAt)}`);
    if (healthText) healthText.textContent = parts.join(" · ");
    health.dataset.state = parts.length ? "ok" : "";
  }
}

function formatFrequency(minutes) {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
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
    subtitle.textContent = isEmpty
      ? "Call lagging? Hit Hammer Hard — no walk to the router."
      : "Auto wake keeps Wi‑Fi lively. Hammer Hard wakes it when stuck.";
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
