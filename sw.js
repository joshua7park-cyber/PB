/* Parallel Bible — offline cache. Everything the app needs is stored on the phone at install time. */
const CACHE = "pb-202610241223";
const CORE = ["./", "index.html", "m.css", "m.js", "canon.js", "furigana.js", "manifest.webmanifest", "lib/jszip.min.js", "fonts/NanumMyeongjo-Regular.woff2", "fonts/NanumMyeongjo-Bold.woff2", "icons/apple-touch-icon.png", "icons/icon-192.png", "data/versions/kor_krv.json", "data/versions/eng_bsb.json", "data/versions/jpn_kougo.json", "data/versions/ind_ayt.json", "data/bible-readings.json", "data/versions/eng_kjv.json", "data/versions/eng_web.json", "data/versions/jpn_bungo.json", "icons/icon-512.png", "importers.js", "lib/dict/base.dat.gz", "lib/dict/cc.dat.gz", "lib/dict/check.dat.gz", "lib/dict/tid.dat.gz", "lib/dict/tid_map.dat.gz", "lib/dict/tid_pos.dat.gz", "lib/dict/unk.dat.gz", "lib/dict/unk_char.dat.gz", "lib/dict/unk_compat.dat.gz", "lib/dict/unk_invoke.dat.gz", "lib/dict/unk_map.dat.gz", "lib/dict/unk_pos.dat.gz", "lib/kuromoji.js", "lib/sql-wasm.js", "lib/sql-wasm.wasm"];          /* opened right away, needed offline */
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const tell = async (m) => { for (const cl of await self.clients.matchAll({ includeUncontrolled: true })) cl.postMessage(m); };
    for (let i = 0; i < CORE.length; i += 4) {   /* small batches: gentler on the phone, and the page can show progress */
      const part = CORE.slice(i, i + 4);
      const need = []; for (const u of part) if (!(await c.match(u))) need.push(u);
      if (need.length) await c.addAll(need);
      await tell({ type: "progress", done: Math.min(i + 4, CORE.length), total: CORE.length });
    }
    await tell({ type: "ready", total: CORE.length });
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true }); if (hit) return hit;
    try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
    catch (err) { if (req.mode === "navigate") { const home = await c.match("./index.html"); if (home) return home; } throw err; }
  })());
});
