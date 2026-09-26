const HISTORY_KEY = "wakeHistory";
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours — matches the chart window
const SVG_NS = "http://www.w3.org/2000/svg";
const RANGE_LABELS = {
  daily: "Last 24 hours"
};

let history = [];
let selectedRange = "daily";
let monitoringEnabled = true;

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
  const val = mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2);
  const phaseName = phase === "download" ? "Downloading" : "Uploading";
  
  setControlStatus(`${phaseName}... (${remaining}s)`);
  
  const elementId = phase === "download" ? "download-value" : "upload-value";
  const el = document.getElementById(elementId);
  if (el) {
    el.innerHTML = `${val} <span class="metric-unit">Mbps</span>`;
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
    setControlStatus("Can't see status");
  }
}

async function updateFrequency(event) {
  const minutes = Number(event.target.value);
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
  if (!window.confirm("This can eat a lot of your data. Still check speed?")) return;
  button.setAttribute("aria-busy", "true");
  document.body.classList.add("hammering");
  setControlStatus("Checking speed...");
  try {
    const response = await sendMessage({ type: "runNow" });
    if (!response?.ok) throw new Error(response?.error || "The real speed test failed.");
    renderHealth({ lastSuccessAt: response.result[0], lastError: null, mode: "full" });
    setControlStatus("Done just now");
  } catch (error) {
    console.error("Real speed test failed:", error);
    setControlStatus("Speed test failed");
  } finally {
    button.removeAttribute("aria-busy");
    document.body.classList.remove("hammering");
  }
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
  } else if (history.length > 0) {
    pill.dataset.state = "ready";
    pill.setAttribute("aria-label", "Monitoring active");
  } else {
    pill.dataset.state = "empty";
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
    if (healthText) healthText.textContent = `Last try failed: ${status.lastError}`;
    health.dataset.state = "error";
  } else if (status.lastSuccessAt) {
    const kind = status.mode === "full" ? "Last speed test" : "Last check";
    if (healthText) healthText.textContent = `${kind} · ${formatTimestamp(status.lastSuccessAt)}`;
    health.dataset.state = "ok";
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
  document.getElementById("download-value").innerHTML = latest
    ? `${formatNumber(latest[1])} <span class="metric-unit">Mbps</span>`
    : `<span class="metric-empty">—</span><span class="metric-unit">Mbps</span>`;
  document.getElementById("upload-value").innerHTML = latest
    ? `${formatNumber(latest[2])} <span class="metric-unit">Mbps</span>`
    : `<span class="metric-empty">—</span><span class="metric-unit">Mbps</span>`;
  document.getElementById("range-label").textContent = RANGE_LABELS[selectedRange];
  const pill = document.getElementById("status");
  const pillText = document.getElementById("status-text");
  if (monitoringEnabled) {
    const isTesting = document.getElementById("run-now").getAttribute("aria-busy") === "true";
    pill.dataset.state = latest ? "ready" : "empty";
    pill.setAttribute("aria-label", latest ? "WiFi checks are on" : "No checks yet");
    if (pillText && !isTesting) pillText.textContent = latest ? "On" : "Waiting";
  }
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
    empty.textContent = "Waiting for the first wake-up";
    chart.append(empty);
    chart.setAttribute("aria-label", "Nothing in the last 24 hours");
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
  chart.setAttribute("aria-label", `${points.length} checks. Latest download ${formatNumber(points.at(-1)[1])} Mbps, upload ${formatNumber(points.at(-1)[2])} Mbps.`);
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
