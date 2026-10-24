"use strict";
/* Parallel Bible — iPhone edition. Works fully offline once installed to the Home Screen.
   Same data, storage keys and backup format as the Mac / Windows app. */
const { U, VC, KO, KS, EN, JA, ID, CATS, LANGS, bookIndex } = CANON;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const APP_VER = "1.5";

/* ---------- translations that ship with the phone app (all free to share) ---------- */
const BUILTIN = {
  kor_krv:   { name: "개역한글 (1961)", short: "개역한글", lang: "ko", file: "kor_krv", lic: "개역한글 — 저작권 보호기간 만료" },
  eng_bsb:   { name: "Berean Standard Bible", short: "BSB", lang: "en", file: "eng_bsb", lic: "BSB — Public Domain" },
  eng_web:   { name: "World English Bible", short: "WEB", lang: "en", file: "eng_web", lic: "WEB — Public Domain" },
  eng_kjv:   { name: "King James Version", short: "KJV", lang: "en", file: "eng_kjv", lic: "KJV — Public Domain" },
  jpn_kougo: { name: "口語訳 (1955)", short: "口語訳", lang: "ja", file: "jpn_kougo", lic: "口語訳 — Public Domain", names: CANON.JA_KOUGO },
  jpn_bungo: { name: "文語訳", short: "文語訳", lang: "ja", file: "jpn_bungo", lic: "文語訳 — Public Domain", names: CANON.JA_KOUGO },
  ind_ayt:   { name: "Alkitab Yang Terbuka (AYT)", short: "AYT", lang: "id", file: "ind_ayt", lic: "AYT © YLSA — CC BY-NC" }
};
const VERS = {};
for (const k in BUILTIN) VERS[k] = { id: k, builtin: true, ...BUILTIN[k] };

/* ---------- storage (same names as the desktop app, so backups fit both) ---------- */
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const DB = {
  db: null,
  open() { return new Promise(res => { try { const r = indexedDB.open("dayeok-bible", 1); r.onupgradeneeded = () => { r.result.createObjectStore("versions"); r.result.createObjectStore("kv"); }; r.onsuccess = () => { this.db = r.result; res(true); }; r.onerror = () => res(false); } catch (e) { res(false); } }); },
  tx(store, mode, fn) { return new Promise(res => { if (!this.db) return res(null); try { const t = this.db.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : true); t.onerror = () => res(null); } catch (e) { res(null); } }); },
  put(s, k, v) { return this.tx(s, "readwrite", st => st.put(v, k)); },
  get(s, k) { return this.tx(s, "readonly", st => st.get(k)); },
  del(s, k) { return this.tx(s, "readwrite", st => st.delete(k)); }
};
const DEF = { b: 0, c: 1, slots: ["kor_krv", "eng_bsb", "jpn_kougo", "ind_ayt"], hide: [], fs: 17, lh: 1.62, look: "auto", furi: true, names: false, stories: true, heb: true, rate: 1, reader: "all", voices: {}, search: { mode: "all", scope: "all", ver: "all" } };
const S = Object.assign({}, DEF, LS.get("pb-m-state", {}));
const save = () => LS.set("pb-m-state", S);
const MARKS = LS.get("dy2-marks", {});
let SEL = null;

async function loadVersion(id) {
  const v = VERS[id]; if (!v) return null;
  if (v.b) return v; if (v._p) return v._p;
  v._p = (async () => {
    try {
      if (v.builtin) { const r = await fetch("data/versions/" + v.file + ".json"); v.b = (await r.json()).b; }
      else { const rec = await DB.get("versions", id); v.b = rec ? rec.b : []; }
    } catch (e) { v.b = null; v._p = null; toast("이 번역을 아직 받지 못했어요. 인터넷에 연결된 상태에서 한 번 열어 주세요."); }
    return v;
  })();
  return v._p;
}
const chapterArr = (v, b, c) => (v && v.b && v.b[b] && v.b[b][c - 1]) || null;
const langOf = (id) => (VERS[id] && VERS[id].lang) || "xx";
const nVerses = (b, c) => VC[b][c - 1] || 0;
const bookName = (id, b) => { const v = VERS[id]; return (v && v.names && v.names[b]) || (LANGS[langOf(id)] || LANGS.xx).names[b]; };
const activeSlots = () => S.slots.filter(id => VERS[id]);
const shown = () => activeSlots().filter(id => !S.hide.includes(id));
const colorOf = (i) => `var(--r${(i % 6) + 1})`;
const catOf = (b) => CATS.findIndex(([, s, e]) => b >= s && b < e);

/* ---------- furigana (loaded only when a Japanese text has none of its own) ---------- */
const FURI = { engine: null, loading: null, cache: new Map(), user: LS.get("dy2-furi-user", {}) };
const loadScript = (src) => new Promise((res, rej) => { if ($(`script[src="${src}"]`)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
function furiNeeded() { return S.furi && shown().some(id => langOf(id) === "ja" && !VERS[id].hasRuby && !(VERS[id].builtin && id === "jpn_kougo")); }
function loadFuri() {
  if (FURI.engine || FURI.loading) return FURI.loading;
  FURI.loading = (async () => {
    try {
      await loadScript("lib/kuromoji.js");
      const dict = await (await fetch("data/bible-readings.json")).json();
      const tk = await new Promise((res, rej) => kuromoji.builder({ dicPath: "lib/dict/" }).build((e, t) => e ? rej(e) : res(t)));
      FURI.engine = new FuriganaLib.Furigana(tk, dict); FURI.engine.user = FURI.user; render(true);
    } catch (e) { FURI.loading = null; }
  })();
  return FURI.loading;
}
function furiText(id, b, c, v, t) {
  if (!FURI.engine) return t;
  const k = id + "|" + b + "|" + c + "|" + v; let r = FURI.cache.get(k);
  if (r == null) { r = FURI.engine.annotate(t); FURI.cache.set(k, r); } return r;
}
function fmt(t, lang) {
  let s = esc(t);
  s = s.replace(/\{([^|{}]+)\|([^{}]+)\}/g, (m, k, r) => `<ruby>${k}<rt>${FURI.user[k] || r}</rt></ruby>`);
  if (lang === "id") s = s.replace(/\((\d+-\d+[a-z]?)\)/g, S.heb ? '<span class="heb">($1)</span>' : "");
  return s;
}
const plain = (t) => (!t || t === "<range>") ? "" : t.replace(/\{([^|{}]+)\|[^{}]+\}/g, "$1").replace(/\s*\(\d+-\d+[a-z]?\)\s*/g, " ").replace(/\s+/g, " ").trim();

/* ---------- reading view ---------- */
let HITS = null;   /* search pattern to glow in the text */
async function render(keepScroll) {
  applyLook();
  const ids = shown(); const y = scrollY;
  $("#whereT").textContent = `${KO[S.b]} ${S.c}장`;
  $("#whereS").textContent = `${EN[S.b]} ${S.c} · ${JA[S.b]} 第${S.c}章 · ${ID[S.b]} ${S.c}`;
  $("#legend").innerHTML = activeSlots().map((id, i) => `<button class="lg${S.hide.includes(id) ? " off" : ""}" data-lg="${id}" style="--rc:${colorOf(i)}"><i></i>${esc(VERS[id].short)}</button>`).join("");
  if (!VERS[ids[0]] || !VERS[ids[0]].b) $("#list").innerHTML = `<div class="loading">본문을 여는 중…</div>`;
  await Promise.all(ids.map(loadVersion));
  if (furiNeeded() && !FURI.engine) loadFuri();
  let n = nVerses(S.b, S.c); for (const id of ids) { const a = chapterArr(VERS[id], S.b, S.c); if (a) n = Math.max(n, a.length); }
  let h = "";
  for (let v = 1; v <= n; v++) {
    const mk = MARKS[S.b + "." + S.c + "." + v];
    let story = "";
    let body = "";
    for (const id of ids) {
      const i = S.slots.indexOf(id); const lang = langOf(id); const arr = chapterArr(VERS[id], S.b, S.c); let t = arr ? arr[v - 1] : undefined;
      if (!story && S.stories && VERS[id].stories) story = VERS[id].stories[S.b + "." + S.c + "." + v] || "";
      const nm = `<small class="nm">${esc(VERS[id].short)}</small>`;
      if (t === "<range>") { body += `<p class="t empty" style="--rc:${colorOf(i)}">${nm}↑ 앞 절에 함께 번역됨</p>`; continue; }
      if (!t) { body += `<p class="t empty" style="--rc:${colorOf(i)}">${nm}—</p>`; continue; }
      if (lang === "ja" && S.furi && !/\{/.test(t) && FURI.engine) t = furiText(id, S.b, S.c, v, t);
      body += `<p class="t l-${lang}" lang="${lang}" style="--rc:${colorOf(i)}">${nm}${fmt(t, lang)}</p>`;
    }
    h += `<article class="v${mk ? " hl" + mk : ""}${SEL === v ? " sel" : ""}" data-v="${v}"><div class="vh"><span class="vn">${v}</span>${story ? `<span class="story">${esc(story)}</span>` : ""}</div>${body}</article>`;
  }
  const prevOk = S.b > 0 || S.c > 1, nextOk = S.b < 65 || S.c < VC[65].length;
  h += `<div class="chend">${prevOk ? `<button data-step="-1">‹ 이전 장</button>` : ""}${nextOk ? `<button data-step="1">다음 장 ›</button>` : ""}</div>`;
  h += `<div class="credits">${[...new Set(ids.map(id => VERS[id].lic || VERS[id].name))].map(esc).join(" · ")}</div>`;
  $("#list").innerHTML = h;
  if (HITS) glow();
  if (keepScroll) scrollTo(0, y);
  save();
}
function go(b, c, v) {
  S.b = b; S.c = c; SEL = v || null; hideVbar();
  render().then(() => { if (v) { const el = $(`.v[data-v="${v}"]`); if (el) el.scrollIntoView({ block: "center" }); } else scrollTo(0, 0); });
}
function step(d) { let b = S.b, c = S.c + d; if (c < 1) { if (--b < 0) return; c = VC[b].length; } else if (c > VC[b].length) { if (++b > 65) return; c = 1; } HITS = null; go(b, c); }
$("#prev").onclick = () => step(-1); $("#next").onclick = () => step(1);
$("#legend").onclick = e => { const b = e.target.closest("[data-lg]"); if (!b) return; const id = b.dataset.lg; const i = S.hide.indexOf(id); if (i >= 0) S.hide.splice(i, 1); else if (shown().length > 1) S.hide.push(id); render(true); };
$("#list").addEventListener("click", e => {
  const st = e.target.closest("[data-step]"); if (st) { step(+st.dataset.step); return; }
  if (getSelection && !getSelection().isCollapsed) return;   /* the user is selecting text to copy */
  const a = e.target.closest(".v"); if (!a) return;
  const v = +a.dataset.v; if (SEL === v) { SEL = null; a.classList.remove("sel"); hideVbar(); return; }
  $$(".v.sel").forEach(x => x.classList.remove("sel")); SEL = v; a.classList.add("sel"); showVbar(v);
});
/* swipe sideways to turn the chapter */
(function () {
  let x0 = 0, y0 = 0, t0 = 0;
  addEventListener("touchstart", e => { if (!$("#sheet").hidden) return; const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  addEventListener("touchend", e => {
    if (!$("#sheet").hidden || !x0) return; const t = e.changedTouches[0]; const dx = t.clientX - x0, dy = t.clientY - y0; x0 = 0;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 50 && Date.now() - t0 < 600 && getSelection().isCollapsed) step(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* ---------- verse actions ---------- */
function refOf(id, v) { return `${bookName(id, S.b)} ${S.c}:${v}`; }
function showVbar(v) {
  const k = S.b + "." + S.c + "." + v; const cur = MARKS[k] || 0;
  $("#vbar").innerHTML = `<div class="vb-h"><span>${KO[S.b]} ${S.c}:${v}</span><button class="chipbtn" data-x>닫기</button></div>
    <div class="vb-row"><button class="chipbtn pri" data-copy="all">복사 · 모든 번역</button>${shown().map(id => `<button class="chipbtn" data-copy="${id}">${esc(VERS[id].short)}</button>`).join("")}</div>
    <div class="vb-row"><button class="chipbtn" data-say="${v}">▶ 이 절 듣기</button><button class="chipbtn" data-from="${v}">⏩ 여기부터 이어 듣기</button></div>
    <div class="vb-row" style="align-items:center"><span style="font-size:13px;font-weight:600;color:var(--muted);margin:0 6px 0 4px">형광펜</span>${[1, 2, 3, 4].map(n => `<button class="sw h${n}${cur === n ? " on" : ""}" data-hl="${n}" aria-label="형광펜 ${n}"></button>`).join("")}<button class="sw h0" data-hl="0" aria-label="형광펜 지우기">✕</button></div>`;
  $("#vbar").hidden = false; $("#player").hidden = true;
}
function hideVbar() { $("#vbar").hidden = true; if (PLAY.on) $("#player").hidden = false; }
$("#vbar").addEventListener("click", async e => {
  const v = SEL; if (!v) return;
  if (e.target.closest("[data-x]")) { SEL = null; $$(".v.sel").forEach(x => x.classList.remove("sel")); hideVbar(); return; }
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    const which = cp.dataset.copy;
    const txt = which === "all" ? `${KO[S.b]} ${S.c}:${v}\n` + shown().map(id => `[${VERS[id].short}] ${plain((chapterArr(VERS[id], S.b, S.c) || [])[v - 1])}`).join("\n")
      : `${plain((chapterArr(VERS[which], S.b, S.c) || [])[v - 1])}\n(${refOf(which, v)}, ${VERS[which].short})`;
    try { await navigator.clipboard.writeText(txt); toast("📋 복사했어요"); } catch (er) { toast("복사하지 못했어요"); }
    return;
  }
  const hl = e.target.closest("[data-hl]");
  if (hl) { const k = S.b + "." + S.c + "." + v, n = +hl.dataset.hl; if (n) MARKS[k] = n; else delete MARKS[k]; LS.set("dy2-marks", MARKS); const a = $(`.v[data-v="${v}"]`); a.classList.remove("hl1", "hl2", "hl3", "hl4"); if (n) a.classList.add("hl" + n); showVbar(v); return; }
  if (e.target.closest("[data-say]")) { unlockSpeech(); startPlay(v, true); return; }
  if (e.target.closest("[data-from]")) { unlockSpeech(); startPlay(v, false); }
});

/* ---------- bottom sheets ---------- */
function openSheet(html, tall) { $("#sheetBody").innerHTML = html; $("#sheet").classList.toggle("tall", !!tall); $("#sheet").hidden = false; $("#scrim").hidden = false; $("#sheetBody").scrollTop = 0; }
function closeSheet() { $("#sheet").hidden = true; $("#scrim").hidden = true; $$("#tab button").forEach(b => b.classList.remove("on")); }
$("#scrim").onclick = closeSheet;
(function () { let y0 = null; const g = $("#sheet"); g.addEventListener("touchstart", e => { if ($("#sheetBody").scrollTop <= 0 && e.target.closest(".grab,.sh-h")) y0 = e.touches[0].clientY; }, { passive: true }); g.addEventListener("touchend", e => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) closeSheet(); y0 = null; }, { passive: true }); })();
const head = (t) => `<div class="sh-h"><h2>${t}</h2><button class="sh-x" data-close>닫기</button></div>`;
$("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });

/* book & chapter picker */
function bookSheet(pickB) {
  if (pickB == null) {
    const grid = (a, z) => { let x = ""; for (let b = a; b < z; b++) x += `<button class="bk cat${catOf(b)}${b === S.b ? " cur" : ""}" data-b="${b}">${KS[b]}</button>`; return x; };
    openSheet(head("책 고르기") + `<h3 class="sec">구약</h3><div class="bgrid">${grid(0, 39)}</div><h3 class="sec">신약</h3><div class="bgrid">${grid(39, 66)}</div>`, true);
  } else {
    let x = ""; for (let c = 1; c <= VC[pickB].length; c++) x += `<button class="cnum${pickB === S.b && c === S.c ? " cur" : ""}" data-c="${c}">${c}</button>`;
    openSheet(`<div class="sh-h"><button class="back" data-books>‹ 책</button><h2>${KO[pickB]}</h2><button class="sh-x" data-close>닫기</button></div><div class="cgrid" data-pb="${pickB}">${x}</div>`, true);
  }
}
$("#where").onclick = () => bookSheet();
$("#sheet").addEventListener("click", e => {
  const b = e.target.closest(".bk"); if (b) { const n = +b.dataset.b; if (VC[n].length === 1) { closeSheet(); HITS = null; go(n, 1); } else bookSheet(n); return; }
  if (e.target.closest("[data-books]")) { bookSheet(); return; }
  const c = e.target.closest(".cnum"); if (c) { const n = +c.closest(".cgrid").dataset.pb; closeSheet(); HITS = null; go(n, +c.dataset.c); }
});

/* text & look */
function applyLook() {
  const r = document.documentElement;
  r.style.setProperty("--fs", S.fs + "px"); r.style.setProperty("--lh", S.lh);
  if (S.look === "auto") delete r.dataset.look; else r.dataset.look = S.look;
  document.body.classList.toggle("nofuri", !S.furi); document.body.classList.toggle("names", !!S.names);
}
function typeSheet() {
  const seg = (k, items) => `<div class="seg" data-k="${k}">${items.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(S[k]) === String(v)}">${l}</button>`).join("")}</div>`;
  const tog = (k, l) => `<div class="rowx"><label>${l}</label><button class="tog" data-tog="${k}" aria-pressed="${!!S[k]}"></button></div>`;
  openSheet(head("글자 · 화면") + `
    <div class="rowx"><label>글자 크기</label><input type="range" min="13" max="26" step="0.5" value="${S.fs}" data-r="fs"><b>${S.fs}px</b></div>
    <div class="rowx"><label>줄 간격</label><input type="range" min="1.3" max="2.2" step="0.02" value="${S.lh}" data-r="lh"><b>${S.lh}</b></div>
    <h3 class="sec">화면 색</h3>${seg("look", [["auto", "자동"], ["dawn", "새벽"], ["parchment", "양피지"], ["night", "밤"]])}
    <h3 class="sec">표시</h3>${tog("furi", "일본어 후리가나")}${tog("names", "줄마다 번역 이름 보이기")}${tog("stories", "소제목 보기 (있는 번역만)")}${tog("heb", "인도네시아어 히브리 절 번호")}`);
}
$("#sheet").addEventListener("input", e => { const r = e.target.closest("[data-r]"); if (r) { S[r.dataset.r] = +r.value; r.nextElementSibling.textContent = r.dataset.r === "fs" ? S.fs + "px" : S.lh; applyLook(); save(); } });
$("#sheet").addEventListener("click", e => {
  const sg = e.target.closest(".seg[data-k] button"); if (sg && sg.parentElement.dataset.k === "look") { S.look = sg.dataset.v; $$("button", sg.parentElement).forEach(b => b.setAttribute("aria-pressed", String(b === sg))); applyLook(); save(); return; }
  const tg = e.target.closest("[data-tog]"); if (tg) { const k = tg.dataset.tog; S[k] = !S[k]; tg.setAttribute("aria-pressed", String(S[k])); if (k === "furi" && S[k] && furiNeeded()) loadFuri(); render(true); }
});

/* translations: pick, reorder, show/hide */
function versSheet(pickSlot) {
  if (pickSlot != null) {
    const by = {}; for (const id in VERS) (by[langOf(id)] = by[langOf(id)] || []).push(id);
    let x = ""; for (const l in by) { x += `<h3 class="sec">${(LANGS[l] || LANGS.xx).label}</h3>`; for (const id of by[l]) x += `<button class="vopt${S.slots[pickSlot] === id ? " on" : ""}" data-pick="${id}" data-slot="${pickSlot}"><span class="lang">${l.toUpperCase()}</span><span><b>${esc(VERS[id].short)}</b><small>${esc(VERS[id].name)}${VERS[id].builtin ? "" : " · 내 번역"}</small></span></button>`; }
    openSheet(`<div class="sh-h"><button class="back" data-vers>‹ 번역</button><h2>${pickSlot >= S.slots.length ? "번역 추가" : pickSlot + 1 + "번째 번역"}</h2><button class="sh-x" data-close>닫기</button></div>${x}`, true);
    return;
  }
  const ids = activeSlots();
  const rows = ids.map((id, i) => `<div class="slot" style="--rc:${colorOf(i)}"><i></i><button class="nm" data-slotpick="${i}" style="text-align:left"><b>${esc(VERS[id].short)}</b><small>${esc(VERS[id].name)}</small></button><button class="mini" data-up="${i}" ${i ? "" : "disabled"} aria-label="위로">↑</button><button class="mini" data-down="${i}" ${i < ids.length - 1 ? "" : "disabled"} aria-label="아래로">↓</button><button class="mini" data-rm="${i}" ${ids.length > 1 ? "" : "disabled"} aria-label="빼기">✕</button></div>`).join("");
  openSheet(head("번역 고르기") + `<p class="note">이름을 누르면 다른 번역으로 바꿀 수 있어요. 화살표로 순서를 바꾸고, 위쪽 색 이름표를 누르면 잠시 숨길 수 있어요.</p>${rows}${ids.length < 6 ? `<button class="bigbtn sec" data-slotpick="${ids.length}">＋ 번역 추가</button>` : ""}<button class="bigbtn sec" data-tab-go="more">번역 파일 · 백업 불러오기</button>`);
}
$("#sheet").addEventListener("click", e => {
  const sp = e.target.closest("[data-slotpick]"); if (sp) { versSheet(+sp.dataset.slotpick); return; }
  if (e.target.closest("[data-vers]")) { versSheet(); return; }
  const pk = e.target.closest("[data-pick]"); if (pk) { const i = +pk.dataset.slot, id = pk.dataset.pick, j = S.slots.indexOf(id); if (j >= 0 && j !== i) S.slots.splice(j, 1); if (i >= S.slots.length) S.slots.push(id); else S.slots[Math.min(i, S.slots.length - 1)] = id; S.hide = S.hide.filter(x => x !== id); render(true); versSheet(); return; }
  const up = e.target.closest("[data-up]"), dn = e.target.closest("[data-down]"), rm = e.target.closest("[data-rm]");
  if (up || dn) { const i = +(up || dn).dataset[up ? "up" : "down"], j = i + (up ? -1 : 1); [S.slots[i], S.slots[j]] = [S.slots[j], S.slots[i]]; render(true); versSheet(); return; }
  if (rm) { S.slots.splice(+rm.dataset.rm, 1); render(true); versSheet(); return; }
  const tg = e.target.closest("[data-tab-go]"); if (tg) moreSheet();
});

/* ---------- import files & backups ---------- */
const Backup = {
  MARK: "parallel-bible-backup.json",
  async read(f) { const z = await JSZip.loadAsync(f); const m = z.file(this.MARK); return m ? { z, man: JSON.parse(await m.async("string")) } : null; },
  async load(f) {
    let r; try { r = await this.read(f); } catch (e) { r = null; } if (!r) return false;
    const { z, man } = r; const metas = LS.get("dy2-versions", {}); let nv = 0;
    for (const id in (man.versions || {})) {
      if (VERS[id] && VERS[id].builtin) continue;
      const zf = z.file(`versions/${id}.json`); if (!zf) continue;
      const b = JSON.parse(await zf.async("string")); await DB.put("versions", id, { b });
      metas[id] = man.versions[id]; VERS[id] = { ...man.versions[id], id }; nv++;
    }
    LS.set("dy2-versions", metas);
    Object.assign(MARKS, man.marks || {}); LS.set("dy2-marks", MARKS);
    Object.assign(FURI.user, man.furi || {}); LS.set("dy2-furi-user", FURI.user); FURI.cache.clear();
    if (man.state) {
      const sl = (man.state.slots || []).filter(id => VERS[id]); if (sl.length) S.slots = sl.slice(0, 6);
      if (man.state.theme) S.look = man.state.theme === "dawn" ? "auto" : man.state.theme;
      ["furi", "stories", "heb"].forEach(k => { if (k in man.state) S[k] = man.state[k]; });
      S.hide = [];
    }
    save(); await render();
    $("#bkMsg").innerHTML = `<div class="report">✅ 백업을 불러왔어요 (${esc((man.created || "").slice(0, 10))})<br>번역 ${nv}개 · 형광펜 ${Object.keys(man.marks || {}).length}곳 · 후리가나 수정 ${Object.keys(man.furi || {}).length}개</div>`;
    return true;
  },
  async save() {
    const z = new JSZip(); const metas = LS.get("dy2-versions", {});
    const man = { type: "parallel-bible-backup", ver: 1, created: new Date().toISOString(), from: "iPhone", state: { slots: S.slots, theme: S.look === "auto" ? "dawn" : S.look, furi: S.furi, stories: S.stories, heb: S.heb }, marks: MARKS, furi: FURI.user, versions: metas };
    for (const id in metas) { const rec = await DB.get("versions", id); if (rec && rec.b) z.file(`versions/${id}.json`, JSON.stringify(rec.b)); }
    z.file(this.MARK, JSON.stringify(man));
    const blob = await z.generateAsync({ type: "blob", compression: "DEFLATE" });
    const d = new Date(); const name = `ParallelBible-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.zip`;
    const file = new File([blob], name, { type: "application/zip" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
};
async function importFiles(files) {
  const out = $("#bkMsg"); out.innerHTML = `<div class="report">읽는 중…</div>`;
  for (const f of files) {
    try {
      if (/\.(zip|pbak)$/i.test(f.name) && await Backup.load(f)) continue;
      await loadScript("lib/sql-wasm.js"); await loadScript("importers.js");
      const res = await Importers.importFile(f);
      const id = "me_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const hasRuby = res.b.some(bk => bk.some(ch => ch.some(t => /\{[^|{}]+\|[^{}]+\}/.test(t))));
      const meta = { id, name: res.meta.name || f.name, short: res.meta.short || f.name, lang: res.meta.lang, names: res.meta.names || null, stories: res.meta.stories && Object.keys(res.meta.stories).length ? res.meta.stories : null, lic: res.meta.lic ? res.meta.lic.slice(0, 160) : "", src: f.name, format: res.meta.format, report: res.report, hasRuby, added: new Date().toISOString() };
      await DB.put("versions", id, { b: res.b }); const metas = LS.get("dy2-versions", {}); metas[id] = meta; LS.set("dy2-versions", metas); VERS[id] = { ...meta, b: res.b };
      const j = S.slots.findIndex(s => langOf(s) === meta.lang && VERS[s].builtin); if (j >= 0) S.slots[j] = id; else S.slots.push(id);
      const r = res.report || {};
      out.innerHTML = `<div class="report">${r.ok ? "✅" : "⚠️"} <b>${esc(meta.short)}</b> · ${(LANGS[meta.lang] || LANGS.xx).label}<br>${r.books}/66권 · ${(r.verses || 0).toLocaleString()}절 (표준 31,102)${r.ok ? " — 표준과 일치해요" : ` — 빠진 절 ${(r.missing || []).length}곳`}</div>`;
      await render();
    } catch (e) { out.innerHTML = `<div class="report">‘${esc(f.name)}’을(를) 읽지 못했어요: ${esc(e.message || e)}</div>`; }
  }
}
function moreSheet() {
  const mine = Object.values(LS.get("dy2-versions", {}));
  openSheet(head("백업 · 번역 파일") + `
    <p class="note">Mac이나 Windows 앱의 <b>번역 관리 → 백업 파일 만들기</b>로 만든 zip 파일을 아이폰 ‘파일’ 앱에 넣고 아래에서 고르면, 개역개정·NIV·新共同訳·TB와 형광펜, 후리가나 고친 것까지 그대로 옮겨져요. 모두 이 아이폰 안에만 저장돼요.</p>
    <label class="bigbtn">백업 · 번역 파일 고르기<input type="file" id="fileIn" multiple hidden></label>
    <div id="bkMsg"></div>
    <button class="bigbtn sec" id="bkOut">이 아이폰의 백업 만들기</button>
    <h3 class="sec">내 번역 (${mine.length})</h3>
    ${mine.length ? mine.map(m => `<div class="slot"><span class="lang">${esc(m.lang || "").toUpperCase()}</span><span class="nm"><b>${esc(m.short)}</b><small>${esc(m.name)}</small></span><button class="mini" data-delv="${esc(m.id)}" aria-label="지우기">🗑</button></div>`).join("") : `<p class="note">아직 없어요.</p>`}
    <h3 class="sec">이 앱</h3><p class="note">Parallel Bible (by Joshua Park) · 아이폰판 ${APP_VER}<br><span id="stInfo">저장 공간 확인 중…</span><br>${OFF.ready ? "✓ 오프라인 준비 완료 — 인터넷 없이 쓸 수 있어요" : OFF.total ? `오프라인 준비 중… ${OFF.done}/${OFF.total}` : "처음 한 번은 인터넷에 연결된 상태로 열어 두세요."}</p>`, true);
  $("#fileIn").onchange = e => importFiles([...e.target.files]);
  $("#bkOut").onclick = () => Backup.save();
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(es => { const el = $("#stInfo"); if (el) el.textContent = `오프라인 저장: ${(es.usage / 1048576).toFixed(0)}MB 사용 중`; });
}
$("#sheet").addEventListener("click", async e => {
  const d = e.target.closest("[data-delv]"); if (!d) return;
  if (d.dataset.sure !== "1") { d.dataset.sure = "1"; d.textContent = "정말?"; return; }
  const id = d.dataset.delv; await DB.del("versions", id); const m = LS.get("dy2-versions", {}); delete m[id]; LS.set("dy2-versions", m); delete VERS[id];
  S.slots = S.slots.filter(x => x !== id); if (!S.slots.length) S.slots = DEF.slots.slice(); await render(); moreSheet();
});

/* ---------- search ---------- */
const SR = { q: "", hits: [], re: null, book: null, shown: 0 };
const fold = (x) => x.replace(/[À-ɏ]/g, ch => ch.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0) || ch);
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function searchSheet() {
  const o = S.search; const seg = (k, items) => `<div class="seg" data-sk="${k}">${items.map(([v, l]) => `<button data-v="${v}" aria-pressed="${o[k] === v}">${l}</button>`).join("")}</div>`;
  openSheet(`<div class="sh-h"><h2>검색</h2><button class="sh-x" data-close>닫기</button></div>
    <form class="sq" id="sForm"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg><input id="sIn" type="search" enterkeyhint="search" placeholder="낱말 · 문장 · 구절 (요 3:16)" value="${esc(SR.q)}" autocomplete="off"></form>
    <div class="sopts">${seg("mode", [["all", "모든 낱말"], ["phrase", "문장 그대로"], ["any", "하나라도"]])}${seg("scope", [["all", "전체"], ["ot", "구약"], ["nt", "신약"], ["book", "이 책"]])}</div>
    <div id="sOut"></div>`, true);
  drawSearch();
  setTimeout(() => $("#sIn").focus(), 250);
}
$("#srchBtn").onclick = searchSheet;
function parseRef(s) {
  s = s.trim().replace(/[：]/g, ":").replace(/[〜～–—]/g, "-");
  if (!/\d/.test(s) && bookIndex(s) < 0) return null;
  const m = s.match(/^(\d?\s*[^\d:]+?)\s*(\d+)?\s*(?:장|章|편|篇|pasal)?\s*(?:[:.]\s*|\s+)?(\d+)?\s*(?:절|節)?\s*(?:-\s*(\d+))?\s*(?:절|節)?$/i); if (!m) return null;
  let b = bookIndex(m[1]);
  if (b < 0) { const key = m[1].toLowerCase().replace(/[\s.\-]/g, ""); const k2 = Object.keys(CANON.NAMEMAP).find(k => key.length >= 2 && k.startsWith(key)); if (k2) b = CANON.NAMEMAP[k2]; }
  if (b < 0) return null; return { b, c: Math.min(Math.max(1, +(m[2] || 1)), VC[b].length), v: m[3] ? +m[3] : null };
}
async function runSearch(q) {
  q = q.trim(); SR.q = q; SR.book = null; if (!q) { SR.hits = []; drawSearch(); return; }
  const r = parseRef(q); if (r) { closeSheet(); HITS = null; go(r.b, r.c, r.v); return; }
  $("#sOut").innerHTML = `<div class="ssum">찾는 중…</div>`;
  const o = S.search; const ids = shown(); await Promise.all(ids.map(loadVersion));
  const terms = o.mode === "phrase" ? [q] : (q.match(/"[^"]+"|\S+/g) || []).map(x => x.replace(/^"|"$/g, ""));
  const body = (t) => reEsc(fold(t)).replace(/\s+/g, "\\s+");
  const res = terms.map(t => new RegExp(body(t), "iu")); SR.re = new RegExp(terms.map(body).join("|"), "giu");
  const test = (x) => o.mode === "any" ? res.some(r => r.test(x)) : res.every(r => r.test(x));
  const inScope = (b) => o.scope === "ot" ? b < 39 : o.scope === "nt" ? b >= 39 : o.scope === "book" ? b === S.b : true;
  const map = new Map();
  for (const id of ids) {
    const B = VERS[id].b || [];
    for (let b = 0; b < 66; b++) { if (!inScope(b) || !B[b]) continue;
      B[b].forEach((ch, ci) => (ch || []).forEach((t, vi) => { if (!t || t === "<range>") return; const k = /\{/.test(t) ? t.replace(/\{([^|{}]+)\|([^{}]+)\}/g, "$2") : ""; if (test(fold(plain(t))) || (k && test(k))) { const key = b * 1e6 + (ci + 1) * 1e3 + vi + 1; if (!map.has(key)) map.set(key, { b, c: ci + 1, v: vi + 1, id }); } })); }
  }
  SR.hits = [...map.values()].sort((x, y) => x.b - y.b || x.c - y.c || x.v - y.v); drawSearch();
}
function snip(h) { const t = plain((chapterArr(VERS[h.id], h.b, h.c) || [])[h.v - 1]); const f = fold(t); if (!SR.re || f.length !== t.length) return esc(t); let o = "", last = 0; for (const m of f.matchAll(SR.re)) { o += esc(t.slice(last, m.index)) + "<mark>" + esc(t.slice(m.index, m.index + m[0].length)) + "</mark>"; last = m.index + m[0].length; } return o + esc(t.slice(last)); }
function drawSearch(more) {
  const out = $("#sOut"); if (!out) return;
  if (!SR.q) { out.innerHTML = `<p class="note" style="text-align:center;margin-top:30px">낱말이나 문장을 넣고 ‘검색’을 누르세요.<br>예: 사랑 · 믿음 소망 · grace · 愛 · kasih<br>‘요 3:16’처럼 구절을 넣으면 바로 가요.</p>`; return; }
  const L0 = SR.book == null ? SR.hits : SR.hits.filter(h => h.b === SR.book);
  const books = {}; SR.hits.forEach(h => books[h.b] = (books[h.b] || 0) + 1);
  const n1 = Math.min(L0.length, (more ? SR.shown : 0) + 100);
  let h = more ? "" : `<div class="ssum"><b>${SR.hits.length.toLocaleString()}절</b> · 구약 ${SR.hits.filter(x => x.b < 39).length} · 신약 ${SR.hits.filter(x => x.b >= 39).length}</div>
    ${Object.keys(books).length > 1 ? `<div class="sbooks"><button class="sbk all${SR.book == null ? " on" : ""}" data-sb="">전체</button>${Object.keys(books).map(b => `<button class="sbk cat${catOf(+b)}${SR.book === +b ? " on" : ""}" data-sb="${b}">${KS[b]} ${books[b]}</button>`).join("")}</div>` : ""}<div id="sList">`;
  let rows = ""; for (let i = more ? SR.shown : 0; i < n1; i++) { const x = L0[i]; rows += `<button class="res" data-go="${i}"><span class="rref cat${catOf(x.b)}">${KS[x.b]} ${x.c}:${x.v}</span><span class="rt" lang="${langOf(x.id)}">${snip(x)}</span></button>`; }
  if (!L0.length) rows = `<p class="note" style="text-align:center;margin-top:20px">찾지 못했어요. ‘하나라도’로 바꾸거나 철자를 확인해 보세요.</p>`;
  if (more) { $("#sMore") && $("#sMore").remove(); $("#sList").insertAdjacentHTML("beforeend", rows); } else out.innerHTML = h + rows + "</div>";
  SR.shown = n1; if (n1 < L0.length) $("#sList").insertAdjacentHTML("beforeend", `<button class="more" id="sMore">${L0.length - n1}개 더 보기</button>`);
}
$("#sheet").addEventListener("submit", e => { if (e.target.id === "sForm") { e.preventDefault(); $("#sIn").blur(); runSearch($("#sIn").value); } });
$("#sheet").addEventListener("click", e => {
  const sg = e.target.closest(".seg[data-sk] button"); if (sg) { const k = sg.parentElement.dataset.sk; S.search[k] = sg.dataset.v; $$("button", sg.parentElement).forEach(b => b.setAttribute("aria-pressed", String(b === sg))); save(); if (SR.q) runSearch(SR.q); return; }
  const sb = e.target.closest("[data-sb]"); if (sb) { SR.book = sb.dataset.sb === "" ? null : +sb.dataset.sb; drawSearch(); return; }
  if (e.target.closest("#sMore")) { drawSearch(true); return; }
  const g = e.target.closest("[data-go]"); if (g) { const L0 = SR.book == null ? SR.hits : SR.hits.filter(h => h.b === SR.book); const x = L0[+g.dataset.go]; HITS = SR.re; closeSheet(); go(x.b, x.c, x.v); }
});
function glow() {
  for (const p of $$("#list .t")) {
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest("rt,small,.heb") ? 2 : 1 }); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) { const t = n.nodeValue, f = fold(t); if (f.length !== t.length) continue; HITS.lastIndex = 0; if (!HITS.test(f)) continue; HITS.lastIndex = 0; const fr = document.createDocumentFragment(); let last = 0; for (const m of f.matchAll(HITS)) { if (!m[0]) continue; fr.append(t.slice(last, m.index)); const mk = document.createElement("mark"); mk.className = "hit"; mk.textContent = t.slice(m.index, m.index + m[0].length); fr.append(mk); last = m.index + m[0].length; } fr.append(t.slice(last)); n.replaceWith(fr); }
  }
}

/* ---------- listening ---------- */
const PLAY = { on: false, paused: false, token: 0, v: 0 };
function unlockSpeech() { try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch (e) {} }
function voicesFor(lang) { const tts = (LANGS[lang] || LANGS.xx).tts.slice(0, 2); const score = v => (/premium/i.test(v.name) ? 30 : 0) + (/enhanced|고품질|향상/i.test(v.name) ? 20 : 0) + (/siri/i.test(v.name) ? 15 : 0) - (/Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley/i.test(v.name) ? 50 : 0); return speechSynthesis.getVoices().filter(v => v.lang && v.lang.replace("_", "-").slice(0, 2) === tts).sort((a, b) => score(b) - score(a)); }
function voiceFor(lang) { const want = S.voices[lang]; const vs = voicesFor(lang); return (want && vs.find(v => v.name === want)) || vs[0] || null; }
function prepSpeech(t, lang) { t = t.replace(/\(\d+-\d+[a-z]?\)/g, "").replace(/[\[\]{}]/g, ""); if (lang === "en") t = t.replace(/\bLORD\b/g, "Lord").replace(/\bGOD\b/g, "God"); if (lang === "id") t = t.replace(/\bTUHAN\b/g, "Tuhan"); t = t.replace(/\s+/g, " ").trim(); const p = t.split(/(?<=[.!?。！？;；:：])\s*/).filter(x => x.trim()); return p.length ? p : [t]; }
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function speakOne(text, lang, tk) {
  return new Promise(res => {
    const u = new SpeechSynthesisUtterance(text); u.lang = (LANGS[lang] || LANGS.xx).tts; const vo = voiceFor(lang); if (vo) { u.voice = vo; u.lang = vo.lang; } u.rate = S.rate;
    let fin = false; const end = (r) => { if (!fin) { fin = true; clearInterval(ck); res(r); } };
    u.onend = () => end("end"); u.onerror = () => end("err"); speechSynthesis.speak(u);
    const ck = setInterval(() => { if (tk !== PLAY.token) end("cancel"); else if (!speechSynthesis.speaking && !speechSynthesis.pending && !PLAY.paused) end("end"); }, 500);
  });
}
async function speak(t, lang, tk) { for (const p of prepSpeech(t, lang)) { if (tk !== PLAY.token) return "cancel"; if (await speakOne(p, lang, tk) === "cancel") return "cancel"; await wait(160); } return "end"; }
function speakText(id, v, t) { if (langOf(id) === "ja") { const a = /\{/.test(t) ? t : (FURI.engine ? furiText(id, S.b, S.c, v, t) : t); return a.replace(/\{([^|{}]+)\|([^{}]+)\}/g, "$2"); } return plain(t); }
function mark(v) { $$(".v.playing").forEach(x => x.classList.remove("playing")); const a = v && $(`.v[data-v="${v}"]`); if (a) { a.classList.add("playing"); const r = a.getBoundingClientRect(); if (r.top < 90 || r.bottom > innerHeight - 140) a.scrollIntoView({ block: "center", behavior: "smooth" }); } }
async function startPlay(from, only) {
  stopPlay(true); const tk = ++PLAY.token; PLAY.on = true; PLAY.paused = false; drawPlayer();
  const ids = S.reader === "all" ? shown() : [shown()[+S.reader] || shown()[0]];
  let b = S.b, c = S.c, v = from || 1;
  while (tk === PLAY.token) {
    if (b !== S.b || c !== S.c) { S.b = b; S.c = c; SEL = null; await render(); scrollTo(0, 0); }
    const n = nVerses(b, c);
    for (; v <= n && tk === PLAY.token; v++) {
      PLAY.v = v; mark(v); drawPlayer();
      for (const id of ids) { if (tk !== PLAY.token) return; const t = (chapterArr(VERS[id], b, c) || [])[v - 1]; if (!t || t === "<range>") continue; if (await speak(speakText(id, v, t), langOf(id), tk) === "cancel") return; await wait(380); }
      if (only) break;
    }
    if (only || tk !== PLAY.token) break;
    c++; if (c > VC[b].length) { b++; c = 1; } if (b > 65) break; v = 1;
  }
  if (tk === PLAY.token) { PLAY.on = false; mark(null); drawPlayer(); }
}
function stopPlay(quiet) { PLAY.token++; PLAY.on = false; PLAY.paused = false; try { speechSynthesis.cancel(); } catch (e) {} mark(null); if (!quiet) drawPlayer(); }
function drawPlayer() {
  const p = $("#player");
  if (!PLAY.on) { p.hidden = true; return; }
  p.innerHTML = `<button class="pbtn" data-pp aria-label="일시정지/계속">${PLAY.paused ? "▶" : "❚❚"}</button><span class="pinfo">${PLAY.paused ? "일시정지 · " : "듣는 중 · "}${KS[S.b]} ${S.c}:${PLAY.v}</span><button class="pbtn ghost" data-ps aria-label="정지">■</button>`;
  if ($("#vbar").hidden) p.hidden = false;
}
$("#player").addEventListener("click", e => {
  if (e.target.closest("[data-ps]")) { stopPlay(); return; }
  if (e.target.closest("[data-pp]")) { if (PLAY.paused) { speechSynthesis.resume(); PLAY.paused = false; } else { speechSynthesis.pause(); PLAY.paused = true; } drawPlayer(); }
});
function playSheet() {
  const ids = shown(); const langs = [...new Set(ids.map(langOf))];
  const vsel = (l) => { const vs = voicesFor(l); if (!vs.length) return `<p class="note">${(LANGS[l] || LANGS.xx).label}: 목소리가 없어요. 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성에서 받아 주세요.</p>`; const cur = voiceFor(l); return `<div class="rowx"><label>${(LANGS[l] || LANGS.xx).label}</label><select data-voice="${l}" style="flex:1.4;height:36px;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:14px">${vs.map(v => `<option${cur && v.name === cur.name ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>`; };
  openSheet(head("듣기") + `
    <button class="bigbtn" data-play="${SEL || 1}">▶ ${SEL ? `${S.c}:${SEL}절부터` : `${KO[S.b]} ${S.c}장 처음부터`} 이어 듣기</button>
    ${PLAY.on ? `<button class="bigbtn sec" data-stop>■ 멈추기</button>` : ""}
    <h3 class="sec">읽을 번역</h3><div class="seg" data-rd>${[["all", "모두 번갈아"], ...ids.map((id, i) => [String(i), VERS[id].short])].map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(S.reader) === v}">${esc(l)}</button>`).join("")}</div>
    <div class="rowx"><label>빠르기</label><input type="range" min="0.6" max="1.4" step="0.05" value="${S.rate}" data-rate><b>${(+S.rate).toFixed(2)}×</b></div>
    <h3 class="sec">목소리</h3>${langs.map(vsel).join("")}<p class="note">‘향상된’ 목소리를 받으면 훨씬 자연스러워요: 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성.</p>`);
}
$("#sheet").addEventListener("click", e => {
  const p = e.target.closest("[data-play]"); if (p) { unlockSpeech(); closeSheet(); startPlay(+p.dataset.play, false); return; }
  if (e.target.closest("[data-stop]")) { stopPlay(); closeSheet(); return; }
  const rd = e.target.closest("[data-rd] button"); if (rd) { S.reader = rd.dataset.v; $$("button", rd.parentElement).forEach(b => b.setAttribute("aria-pressed", String(b === rd))); save(); }
});
$("#sheet").addEventListener("input", e => { if (e.target.matches("[data-rate]")) { S.rate = +e.target.value; e.target.nextElementSibling.textContent = S.rate.toFixed(2) + "×"; save(); } });
$("#sheet").addEventListener("change", e => { const s = e.target.closest("[data-voice]"); if (s) { S.voices[s.dataset.voice] = s.value; save(); } });

/* ---------- tab bar ---------- */
$("#tab").onclick = e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  $$("#tab button").forEach(x => x.classList.toggle("on", x === b));
  ({ play: playSheet, type: typeSheet, vers: () => versSheet(), more: moreSheet })[b.dataset.tab]();
};

const OFF = { done: 0, total: 0, ready: LS.get("pb-offline", false) };
let toastT = 0;
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 1900); }

/* ---------- start ---------- */
(async function boot() {
  await DB.open();
  const metas = LS.get("dy2-versions", {}); for (const id in metas) VERS[id] = { ...metas[id], id };
  S.slots = S.slots.filter(id => VERS[id]); if (!S.slots.length) S.slots = DEF.slots.slice();
  S.hide = (S.hide || []).filter(id => S.slots.includes(id));
  if ("speechSynthesis" in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; }
  await render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.addEventListener("message", e => {
      const m = e.data || {};
      if (m.type === "progress") { OFF.done = m.done; OFF.total = m.total; if (m.done < m.total) toast(`오프라인 준비 중… ${Math.round(m.done / m.total * 100)}%`); }
      if (m.type === "ready") { OFF.ready = true; LS.set("pb-offline", true); toast("✓ 이제 인터넷 없이도 쓸 수 있어요"); }
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
