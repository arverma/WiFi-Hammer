# WiFi Hammer

A Chrome extension that wakes a stuck Wi‑Fi connection with one click, so you don't have to walk to the router and restart it. Built for sticky Airtel and Jio connections, and useful on any broadband.

**Learn more:** [WiFi Hammer project page](https://arverma.dev/projects/wifi-hammer/) | [Install from Chrome Web Store](https://chromewebstore.google.com/detail/wifi-hammer-fix-airteljio/dbphaafiokokiaocpcnfakompafjoddj)

## How it works

Stuck Wi‑Fi is usually an idle link, not a broken router. WiFi Hammer sends real traffic through the connection to wake it up, using Fast.com's test servers.

| | Auto hammer | Hammer Hard |
|---|---|---|
| Trigger | A cheap check every 5 min to 6 hr (default 30 min), first run 1 min after enabling | You click it, then confirm with a second tap |
| Traffic | One tiny Fast.com request; it hard-hammers only after two failed checks | A full speed test: up to 10 s down and 10 s up, up to 8 connections |
| Data used | Usually only the small response body | Can be a lot. On a limited plan, use it sparingly |
| Speeds shown | Only after an automatic recovery | Real speeds |
| In the 24-hour chart | Automatic recoveries | No |

## Features

- **Hammer Hard:** one big button, with a confirm step so it can't be hit by accident. Progress shows at the top while it runs.
- **Auto hammer:** checks the network every 5 min to 6 hr (you choose) and only runs the heavier wake after two consecutive unhealthy checks. It can be paused or resumed at any time and is on by default.
- **Last 24 hours chart:** download and upload from auto hammers, kept for 24 hours.
- **Status line:** shows the time of the last wake (auto or Hammer Hard), or live progress while one is running. A failed wake shows its error.
- **Why this works panel:** a short explanation, plus a Diagnostics view with a local log of recent events (last 50) for troubleshooting.
- **Rating prompt:** after a few successful wakes, a small banner asks for a Chrome Web Store review. It can be dismissed for good.

## Install for development

1. Copy `analytics-config.example.js` to `analytics-config.js`. Fill in your GA4 values, or set `MEASUREMENT_ID` and `API_SECRET` to empty strings to switch analytics off (the example's placeholders are not empty, so replace them).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Reload the extension after changing the source.

To inspect the background worker, use the **service worker** link on the extension card. `popup.html` must be loaded as part of the extension: opening it as a `file://` page has no extension APIs.

## Build and test

```sh
make check     # syntax checks, unit tests, manifest limits
make package   # runs check, then writes dist/wifi-hammer-<version>.zip
```

The zip contains the popup, service worker, analytics and diagnostics scripts, icons, the hammer image and the bundled Inter font. It leaves out tests, the Makefile and this README. The checks also enforce the Web Store limits: manifest v3, name up to 45 characters, description up to 132, and all four icon sizes present.

`analytics-config.js` holds real credentials and is git-ignored. Never commit it.

## Privacy and permissions

**Stays on your device** (`chrome.storage.local`): your settings, the wake history behind the chart, and the diagnostics log. None of it is uploaded in bulk.

**Network traffic:**
- **Fast.com and Netflix Open Connect:** the speed-test servers used for waking and measuring.
- **Google Analytics:** WiFi Hammer sends anonymous usage events (no URLs, IPs, or personal data) to Google Analytics to help improve the extension. Events cover popup usage, network probes, automatic recovery decisions, pressing Hammer Hard, turning auto wake on or off, changing the interval, wake success or failure, and the rating prompt. They include anonymous before/after speed readings in Mbps, probe results and timing, your parsed operating system (`os`), parsed Chrome version (`chrome_version`), the extension version, and a random ID generated on your device that isn't linked to you. It never sends raw user-agent strings, SSIDs, visited URLs, or IP addresses.
- **Uninstall feedback:** after uninstalling, you land on an optional feedback form. The link carries the extension version, operating system, days installed and wake counts.

**Permissions:** `alarms` for the schedule, `storage` for local data, and host access limited to `fast.com` and `nflxvideo.net`. Analytics needs no host permission.

Fast.com's API is undocumented and may change. If it does, the extension shows the failure and records nothing made up. The watchdog uses only an already-permitted Fast.com request and does not add a host permission.

This extension does not make your plan faster. It only wakes a stuck connection.

## WiFi connected but no internet?

If WiFi shows connected but pages will not load on Airtel, Jio, or any broadband, check the lights on your router first, restart it if needed, then try WiFi Hammer. For detailed step by step troubleshooting, see the guide at [arverma.dev/guides/wifi-connected-no-internet](https://arverma.dev/guides/wifi-connected-no-internet/).

## Common questions

**Does it make my internet faster?**
No. WiFi Hammer only wakes a stuck connection. It does not speed up your plan or improve signal strength.

**Does it use data?**
Auto hammer uses tiny requests (a few kilobytes). Hammer Hard runs a full speed test and can use several megabytes depending on your connection speed. On a limited plan, use Hammer Hard sparingly.

**Is it safe?**
Yes. Host access is limited to fast.com and nflxvideo.net (Netflix's test servers). The extension has no access to other sites you visit.

**What does it send to Google Analytics?**
WiFi Hammer sends anonymous usage events (button presses, probe results, speeds in Mbps, extension version, parsed OS and Chrome version, a random device ID). It does not send URLs, IP addresses, SSIDs, or personal data. See the Privacy and permissions section above for full details.

## About the author

Built by [Aman Ranjan Verma](https://arverma.dev), senior data engineer. More projects at [arverma.dev](https://arverma.dev) and [@100pebhari](https://x.com/100pebhari) on X.
