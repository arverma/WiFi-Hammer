(function () {
  const DIAGNOSTICS_KEY = "diagnosticsLog";
  const MAX_LOGS = 50;

  async function logDiagnostic(source, event, details = null, error = null) {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        return;
      }
      const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY);
      const existing = Array.isArray(stored[DIAGNOSTICS_KEY]) ? stored[DIAGNOSTICS_KEY] : [];

      const entry = {
        timestamp: Date.now(),
        iso: new Date().toISOString(),
        source: String(source || "unknown"),
        event: String(event || "event"),
        details: details && typeof details === "object" ? details : (details ? { info: details } : null),
        error: error instanceof Error ? error.message : (error ? String(error) : null)
      };

      const updated = existing.concat(entry).slice(-MAX_LOGS);
      await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: updated });
    } catch {
      // Fail silently
    }
  }

  async function getDiagnostics() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        return [];
      }
      const stored = await chrome.storage.local.get(DIAGNOSTICS_KEY);
      return Array.isArray(stored[DIAGNOSTICS_KEY]) ? stored[DIAGNOSTICS_KEY] : [];
    } catch {
      return [];
    }
  }

  async function clearDiagnostics() {
    try {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        return;
      }
      await chrome.storage.local.set({ [DIAGNOSTICS_KEY]: [] });
    } catch {
      // Fail silently
    }
  }

  function formatDiagnosticsReport(logs, systemInfo = {}) {
    const lines = [
      "=== WiFi Hammer Diagnostic Report ===",
      `Generated: ${new Date().toISOString()}`,
      `OS: ${systemInfo.os || "unknown"}`,
      `Platform: ${systemInfo.arch || "unknown"}`,
      `DPI Scaling: ${systemInfo.devicePixelRatio ? `${systemInfo.devicePixelRatio * 100}%` : "unknown"}`,
      `Online: ${systemInfo.onLine !== undefined ? systemInfo.onLine : "unknown"}`,
      `Total Wake Attempts: ${systemInfo.totalWakeAttempts ?? "unknown"}`,
      `Total Wake Successes: ${systemInfo.totalWakeSuccesses ?? "unknown"}`,
      `Monitoring Enabled: ${systemInfo.monitoringEnabled ?? "unknown"}`,
      `Total Log Entries: ${logs.length}`,
      "----------------------------------------"
    ];

    if (logs.length === 0) {
      lines.push("No log events recorded yet.");
    } else {
      logs.forEach((log, index) => {
        const time = log.iso ? log.iso.split("T")[1].replace("Z", "") : new Date(log.timestamp).toLocaleTimeString();
        let detailStr = "";
        if (log.details) {
          try {
            detailStr = ` | ${JSON.stringify(log.details)}`;
          } catch {
            detailStr = ` | ${String(log.details)}`;
          }
        }
        const errStr = log.error ? ` | ERROR: ${log.error}` : "";
        lines.push(`[${String(index + 1).padStart(2, "0")}] ${time} [${log.source}] ${log.event}${detailStr}${errStr}`);
      });
    }

    lines.push("=== End Report ===");
    return lines.join("\n");
  }

  const api = {
    logDiagnostic,
    getDiagnostics,
    clearDiagnostics,
    formatDiagnosticsReport,
    DIAGNOSTICS_KEY,
    MAX_LOGS
  };

  if (typeof self !== "undefined") {
    self.WiFiHammerDiagnostics = api;
    self.logDiagnostic = logDiagnostic;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.WiFiHammerDiagnostics = api;
    globalThis.logDiagnostic = logDiagnostic;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();

