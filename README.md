# Wake Your Wi-Fi

Airtel and Jio WiFi gets slow, so you turn the router off and on. It works. You don't have to keep doing that. Hammer hard and leave the router on.

## The problem

You know this move. WiFi gets stuck, you switch the router off, wait, switch it on, and the page opens. It works, but you are doing it again and again.

## What you get

- Hammer Hard, or let it hammer every few minutes. Same wake-up, no walk to the router. New installs do this every 30 minutes. You can pause anytime.
- A simple look at the last 24 hours: was WiFi ok, or was it lazy? You also see the last success or error, on this laptop only.
- A real speed test when you want the actual speed. Those numbers stay off the daily chart.

The regular check is small, about 192 KB. It is not a speed test. Hammer Hard can use a lot of data. On a limited plan, that can finish your data.

## Install for development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this folder.
4. Reload the extension after source changes.

The service worker can be inspected from the extension card. The first scheduled run is one minute after monitoring is enabled; later runs use the selected interval.

For a Chrome Web Store archive, run `make package`. That writes `dist/wifi-hammer-<version>.zip` with `manifest.json` at the archive root. The zip includes the popup, service worker, icons, hammer image, and the bundled Inter font. It leaves out tests, the Makefile, and this README.

## Privacy and permissions

Measurements and status are stored in `chrome.storage.local` and are not sent to a project server. Wake-pulse rows use `wakeHistory`; real-test rows use `realTestHistory` and are not included in the wake-pulse chart. Network traffic goes to Fast.com and the returned Netflix Open Connect edge target. The extension needs `alarms`, `storage`, and narrowly scoped Fast.com/edge host permissions.

Fast.com’s API is an undocumented implementation detail and may change. If it changes, the extension surfaces the failure and records no fabricated measurement.

## Validation

Run:

```sh
make check
make package
```

The extension must still be loaded as an unpacked extension for browser-level verification; opening `popup.html` as a `file://` page does not provide Chrome extension APIs.
