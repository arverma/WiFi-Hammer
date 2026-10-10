const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("background.js", "utf8");
const context = {
  chrome: {
    runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} } },
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
vm.runInNewContext(`${source}\nthis.testPrune = pruneHistory; this.testFrequency = normalizeFrequency; this.testRange = rangeUrl; this.testHistoryKeys = { wake: WAKE_HISTORY_KEY, real: REAL_TEST_HISTORY_KEY }; this.testReadMeasuredBody = readMeasuredBody;`, context);

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

assertDownloadCountsBytesBeforeBodyFinishes()
  .then(() => console.log("All tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
