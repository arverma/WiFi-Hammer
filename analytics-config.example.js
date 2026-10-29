// ============================================================
// WiFi Hammer — Analytics & Feedback Configuration
// ============================================================
// 1. Copy this file to analytics-config.js  (never commit that copy)
//    cp analytics-config.example.js analytics-config.js
//
// 2. Fill in your values:
//
//    MEASUREMENT_ID — found in GA4 → Admin → Data Streams → Stream details
//    API_SECRET     — GA4 → Admin → Data Streams → Stream details
//                     → "Measurement Protocol API secrets" → Create
//    UNINSTALL_URL  — URL of your uninstall/feedback form (e.g. Google Form)
//
// analytics-config.js is git-ignored; it is only used locally during
// development and is bundled into the extension zip by `make package`.
// ============================================================

const ANALYTICS_CONFIG = {
  MEASUREMENT_ID: "G-XXXXXXXXXX",
  API_SECRET: "YOUR_API_SECRET_HERE",
  UNINSTALL_URL: "https://forms.gle/YOUR_FORM_ID"
};

if (typeof self !== "undefined") {
  self.ANALYTICS_CONFIG = ANALYTICS_CONFIG;
}
if (typeof globalThis !== "undefined") {
  globalThis.ANALYTICS_CONFIG = ANALYTICS_CONFIG;
}
