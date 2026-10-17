/* Builds levels off the main thread so generating a long level never stalls a frame. */
importScripts('levels.js');

self.onmessage = (e) => {
  const n = e.data.n;
  try {
    self.postMessage({ n, lv: self.WHG.generateLevel(n) });
  } catch (err) {
    self.postMessage({ n, error: String(err && err.message || err) });
  }
};
