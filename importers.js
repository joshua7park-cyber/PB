"use strict";
/* Importers: turn a Bible file into {meta, b, report}.
   b[book][chapter-1][verse-1] = text ; "" = missing.  Supported: MyBible (.SQLite3), BibleQuote (.zip with bibleqt.ini),
   Bible SuperSearch / app / thiagobodruk JSON, CSV, TXT ("창 1:1 본문", "Gen 1:1<TAB>text"). */
const Importers = (() => {
  const { VC, MYBIBLE, bookIndex, EN } = CANON;
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const decodeEnt = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));

  function cleanMarkup(t, stats) {
    if (!t) return "";
    let s = String(t);
    const before = s.length;
    s = s.replace(/<ruby>\s*([^<]+?)\s*<rt>\s*([^<]+?)\s*<\/rt>\s*<\/ruby>/gi, "{$1|$2}");          /* keep furigana */
    s = s.replace(/<(S|m|f|n|h)>[\s\S]*?<\/\1>/g, "");                                            /* Strong's, morphology, footnotes, notes, headings */
    s = s.replace(/<sup>[\s\S]*?<\/sup>/gi, "");
    s = s.replace(/<(br|pb)\s*\/?>/gi, " ");
    s = s.replace(/<[^>]+>/g, "");
    s = decodeEnt(s).replace(/[​﻿]/g, "").replace(/\s+/g, " ").trim();
    if (stats && s.length !== before) stats.markup++;
    return s;
  }
  function fixQuotes(s, where, fixes) {
    /* a lone closing quote at the very end with no opening one is a conversion leftover */
    const opens = (s.match(/[“‘]/g) || []).length, closes = (s.match(/[”’]/g) || []).length;
    if (/[”]$/.test(s) && closes === 1 && opens === 0 && s.length > 1) { fixes.push({ ...where, what: "끝의 짝 없는 따옴표(”) 삭제" }); return s.slice(0, -1).trim(); }
    return s;
  }

  function build(entries, meta) {
    const st = Array.from({ length: 66 }, () => ({}));
    const fixes = []; let dup = 0;
    for (const e of entries) {
      if (e.b < 0 || e.b > 65 || !(e.c > 0) || !(e.v > 0)) continue;
      const t = fixQuotes(e.t, { b: e.b, c: e.c, v: e.v }, fixes);
      const ch = st[e.b][e.c] || (st[e.b][e.c] = {});
      if (ch[e.v]) { dup++; ch[e.v] += " " + t; } else ch[e.v] = t;
    }
    const b = st.map(bk => { const cs = Object.keys(bk).map(Number); if (!cs.length) return []; const out = []; for (let c = 1; c <= Math.max(...cs); c++) { const vs = bk[c] || {}; const ks = Object.keys(vs).map(Number); const n = ks.length ? Math.max(...ks) : 0; const arr = []; for (let v = 1; v <= n; v++) arr.push(vs[v] || ""); out.push(arr); } return out; });
    return { meta, b, report: verify(b, fixes, dup) };
  }

  /* compare against the standard 66-book / 1,189-chapter / 31,102-verse structure */
  function verify(b, fixes = [], dup = 0) {
    const r = { verses: 0, books: 0, missingBooks: [], chapterDiff: [], missing: [], extra: [], empty: [], fixes, dup };
    for (let bi = 0; bi < 66; bi++) {
      const bk = b[bi] || [];
      if (!bk.length) { r.missingBooks.push(bi); continue; }
      r.books++;
      if (bk.length !== VC[bi].length) r.chapterDiff.push({ b: bi, have: bk.length, std: VC[bi].length });
      const nc = Math.max(bk.length, VC[bi].length);
      for (let c = 1; c <= nc; c++) {
        const ch = bk[c - 1] || []; const std = VC[bi][c - 1] || 0;
        for (let v = 1; v <= Math.max(ch.length, std); v++) {
          const t = ch[v - 1];
          if (t) { r.verses++; if (v > std) r.extra.push({ b: bi, c, v }); }
          else if (v <= std) { if (c <= bk.length) (t === "" && v <= ch.length ? r.empty : r.missing).push({ b: bi, c, v }); }
        }
      }
    }
    r.ok = !r.missingBooks.length && !r.missing.length && !r.empty.length && !r.chapterDiff.length;
    return r;
  }

  function detectLang(sample, hint) {
    const h = (hint || "").toLowerCase();
    if (/^(ko|kor|korean)/.test(h)) return "ko"; if (/^(ja|jpn|japanese)/.test(h)) return "ja";
    if (/^(id|ind|indonesian)/.test(h)) return "id"; if (/^(en|eng|english)/.test(h)) return "en";
    if (/^(he|heb)/.test(h)) return "he"; if (/^(el|grc|gre)/.test(h)) return "el"; if (/^(zh|chi|chinese)/.test(h)) return "zh";
    if (/[가-힣]/.test(sample)) return "ko";
    if (/[぀-ヿ]/.test(sample)) return "ja";
    if (/[֐-׿]/.test(sample)) return "he";
    if (/[Ͱ-Ͽἀ-῿]/.test(sample)) return "el";
    if (/[一-鿿]/.test(sample)) return "zh";
    const w = " " + sample.toLowerCase() + " ";
    const id = (w.match(/ (dan|yang|itu|allah|tuhan|dari|kepada|aku|engkau) /g) || []).length;
    const en = (w.match(/ (the|and|of|god|lord|he|to|that|you) /g) || []).length;
    if (id || en) return id > en ? "id" : "en";
    return "xx";
  }
  /* use a module's own book names only when they are written in the translation's own script */
  const namesFit = (names, lang) => { if (!names) return null; const j = names.filter(Boolean).join(" "); const l = detectLang(j); if (l === lang || ((lang === "en" || lang === "id") && (l === "en" || l === "id"))) return names; return null; };
  const shortFrom = (name, file) => {
    const m = /\(([A-Z0-9\-]{2,8})\)/.exec(name || ""); if (m) return m[1];
    const f = (file || "").replace(/\.[^.]+$/, "").replace(/^[0-9a-f]{8}-/, "");
    if (/niv/i.test(f)) return "NIV";
    return (name || f || "내 번역").slice(0, 18);
  };

  /* ---------- MyBible (.SQLite3) ---------- */
  let SQLp = null;
  const sql = () => SQLp || (SQLp = initSqlJs({ locateFile: f => "lib/" + f }));
  async function myBible(bytes, fileName) {
    const SQL = await sql(); const db = new SQL.Database(bytes);
    const tables = db.exec("select name from sqlite_master where type='table'")[0]?.values.flat() || [];
    if (!tables.includes("verses")) {
      db.close();
      if (tables.includes("commentaries")) throw new Error("이 파일은 각주·주석(commentaries) 모듈이에요. 본문이 든 파일(예: NIV11.SQLite3)을 넣어 주세요.");
      throw new Error("MyBible 본문(verses) 표를 찾지 못했어요.");
    }
    const info = {}; try { for (const [k, v] of db.exec("select name, value from info")[0]?.values || []) info[k] = v; } catch (e) {}
    const stats = { markup: 0 }; const entries = [];
    for (const [bn, c, v, t] of db.exec("select book_number, chapter, verse, text from verses order by book_number, chapter, verse")[0]?.values || []) {
      const b = MYBIBLE.indexOf(Number(bn)); if (b < 0) continue;
      entries.push({ b, c: Number(c), v: Number(v), t: cleanMarkup(t, stats) });
    }
    let names = null; const stories = {};
    try {
      const rows = db.exec("select book_number, long_name from books")[0]?.values || [];
      const nm = Array(66).fill(null); for (const [bn, ln] of rows) { const b = MYBIBLE.indexOf(Number(bn)); if (b >= 0) nm[b] = String(ln).trim(); }
      if (nm.filter(Boolean).length >= 60) names = nm.map((x, i) => x || EN[i]);
    } catch (e) {}
    try { for (const [bn, c, v, t] of db.exec("select book_number, chapter, verse, title from stories")[0]?.values || []) { const b = MYBIBLE.indexOf(Number(bn)); if (b >= 0) stories[b + "." + c + "." + v] = cleanMarkup(t); } } catch (e) {}
    db.close();
    const sample = entries.slice(0, 40).map(e => e.t).join(" ");
    const name = (info.description || fileName || "").replace(/<[^>]+>/g, "").trim();
    const lang = detectLang(sample, info.language);
    const meta = { name, short: shortFrom(name, fileName), lang, names: namesFit(names, lang), stories, src: fileName, lic: (info.detailed_info || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300), format: "MyBible" };
    const res = build(entries, meta); res.report.markup = stats.markup; return res;
  }

  /* ---------- BibleQuote (.zip with bibleqt.ini + .htm) ---------- */
  function decodeBytes(u8, enc) {
    if (enc) { try { return new TextDecoder(enc).decode(u8); } catch (e) {} }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (e) {}
    for (const e of ["euc-kr", "shift_jis", "windows-1251", "windows-1252"]) { try { return new TextDecoder(e).decode(u8); } catch (x) {} }
    return new TextDecoder().decode(u8);
  }
  async function bibleQuote(zipBytes, fileName) {
    const zip = await JSZip.loadAsync(zipBytes);
    const iniFile = Object.values(zip.files).find(f => /(^|\/)bibleqt\.ini$/i.test(f.name));
    if (!iniFile) throw new Error("zip 안에 bibleqt.ini가 없어요. BibleQuote 형식이 아닌 것 같아요.");
    const base = iniFile.name.replace(/[^/]*$/, "");
    const iniRaw = await iniFile.async("uint8array");
    let ini = decodeBytes(iniRaw);
    const encM = /DefaultEncoding\s*=\s*([\w\-]+)/i.exec(ini); if (encM && !/utf/i.test(encM[1])) ini = decodeBytes(iniRaw, encM[1]);
    const get = (k) => { const m = new RegExp("^\\s*" + k + "\\s*=\\s*(.*)$", "im").exec(ini); return m ? m[1].trim() : ""; };
    const chSign = get("ChapterSign") || "<h4>", vSign = get("VerseSign") || "<p>";
    const books = []; let cur = null;
    for (const line of ini.split(/\r?\n/)) {
      const m = /^\s*(PathName|FullName|ShortName|ChapterQty)\s*=\s*(.*)$/i.exec(line); if (!m) continue;
      const k = m[1].toLowerCase();
      if (k === "pathname") { cur = { path: m[2].trim() }; books.push(cur); } else if (cur) cur[k] = m[2].trim();
    }
    const stats = { markup: 0 }; const entries = []; const names = Array(66).fill(null); const unmatched = [];
    const ordered = books.length === 66;
    for (let i = 0; i < books.length; i++) {
      const bk = books[i];
      let b = ordered ? i : -1;
      if (!ordered) { for (const cand of [bk.fullname, ...(bk.shortname || "").split(/\s+/)]) { const x = bookIndex(cand || ""); if (x >= 0) { b = x; break; } } }
      if (b < 0) { unmatched.push(bk.fullname || bk.path); continue; }
      names[b] = bk.fullname || null;
      const f = zip.file(base + bk.path) || Object.values(zip.files).find(z => z.name.toLowerCase().endsWith("/" + bk.path.toLowerCase()) || z.name.toLowerCase() === bk.path.toLowerCase());
      if (!f) { unmatched.push(bk.path); continue; }
      const html = decodeBytes(await f.async("uint8array"), encM && !/utf/i.test(encM[1]) ? encM[1] : undefined);
      const chParts = html.split(new RegExp(chSign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).slice(1);
      chParts.forEach((part, ci) => {
        const vParts = part.split(new RegExp(vSign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).slice(1);
        let seq = 0;
        for (const vp of vParts) {
          const sup = /<sup>\s*(\d+)\s*<\/sup>/i.exec(vp);
          let raw = vp, v;
          if (sup) { v = Number(sup[1]); raw = vp.replace(sup[0], ""); }
          else { const m = /^\s*(?:<[^>]+>\s*)*(\d+)[\s.]/.exec(vp.replace(/<[^>]+>/g, " ")); v = m ? Number(m[1]) : seq + 1; if (m) raw = vp.replace(/^\s*(?:<[^>]+>\s*)*\d+[\s.]/, ""); }
          seq = v;
          const t = cleanMarkup(raw, stats); if (t) entries.push({ b, c: ci + 1, v, t });
        }
      });
    }
    const sample = entries.slice(0, 40).map(e => e.t).join(" ");
    const name = get("BibleName") || fileName;
    const lang = detectLang(sample, get("Language"));
    const meta = { name, short: get("BibleShortName") || shortFrom(name, fileName), lang, names: names.filter(Boolean).length >= 60 ? namesFit(names.map((x, i) => x || EN[i]), lang) : null, src: fileName, lic: get("Copyright"), format: "BibleQuote" };
    const res = build(entries, meta); res.report.markup = stats.markup; res.report.unmatched = unmatched; return res;
  }

  /* ---------- JSON ---------- */
  function json(text, fileName) {
    const j = JSON.parse(text.replace(/^﻿/, ""));
    const stats = { markup: 0 }; const entries = []; let meta = { src: fileName, format: "JSON" };
    if (j && Array.isArray(j.verses)) {                     /* Bible SuperSearch */
      for (const v of j.verses) entries.push({ b: Number(v.book) - 1, c: Number(v.chapter), v: Number(v.verse), t: cleanMarkup(v.text, stats) });
      const m = j.metadata || {};
      meta = { ...meta, name: m.name || fileName, short: m.shortname || shortFrom(m.name, fileName), lang: detectLang(entries.slice(0, 40).map(e => e.t).join(" "), m.lang_short || m.lang), lic: String(m.copyright_statement || "").replace(/\s+/g, " ").slice(0, 300) };
    } else {
      const books = Array.isArray(j) ? j.map(x => x.chapters || x) : (j.b || null);
      if (!books) throw new Error("JSON 구조를 알아보지 못했어요.");
      books.forEach((bk, b) => (bk || []).forEach((ch, ci) => (ch || []).forEach((t, vi) => { if (t) entries.push({ b, c: ci + 1, v: vi + 1, t: cleanMarkup(t, stats) }); })));
      meta = { ...meta, name: (j.meta && j.meta.name) || fileName, short: shortFrom((j.meta && j.meta.name) || "", fileName), lang: detectLang(entries.slice(0, 40).map(e => e.t).join(" "), j.meta && j.meta.lang) };
    }
    const res = build(entries, meta); res.report.markup = stats.markup; return res;
  }

  /* ---------- CSV / TXT ---------- */
  function text(t, fileName) {
    t = t.replace(/^﻿/, ""); const lines = t.split(/\r?\n/); const entries = []; const stats = { markup: 0 }; let skipped = 0;
    const csvSplit = (line) => { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === "," || ch === "\t") { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
    const head = csvSplit(lines[0] || "").map(s => s.trim().toLowerCase());
    const col = (names) => head.findIndex(h => names.includes(h));
    const ib = col(["book", "성경", "권", "권번호", "book_number", "b"]), ic = col(["chapter", "장", "c"]), iv = col(["verse", "절", "v"]), it = col(["text", "본문", "t"]);
    if (ib >= 0 && ic >= 0 && iv >= 0 && it >= 0) {
      for (const line of lines.slice(1)) { if (!line.trim()) continue; const f = csvSplit(line); let b = /^\d+$/.test(f[ib]) ? Number(f[ib]) - 1 : bookIndex(f[ib]); if (b < 0) { skipped++; continue; } entries.push({ b, c: Number(f[ic]), v: Number(f[iv]), t: cleanMarkup(f[it], stats) }); }
    } else {
      for (const line of lines) {
        const m = /^\s*(\d?\s*[^\d\t:]+?)\s*(\d+)\s*[:장章.]\s*(\d+)\s*(?:절|節)?[\t ,]+(.+)$/.exec(line);
        if (!m) { if (line.trim()) skipped++; continue; }
        const b = bookIndex(m[1]); if (b < 0) { skipped++; continue; }
        entries.push({ b, c: Number(m[2]), v: Number(m[3]), t: cleanMarkup(m[4], stats) });
      }
    }
    const meta = { name: fileName.replace(/\.[^.]+$/, ""), short: shortFrom("", fileName), lang: detectLang(entries.slice(0, 40).map(e => e.t).join(" ")), src: fileName, format: "TXT/CSV" };
    const res = build(entries, meta); res.report.markup = stats.markup; res.report.skippedLines = skipped; return res;
  }

  async function importFile(file) {
    const name = file.name; const lower = name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 16));
    if (head.startsWith("SQLite format 3")) return myBible(bytes, name);
    if (head.startsWith("PK")) return bibleQuote(bytes, name);
    const txt = decodeBytes(bytes);
    if (/\.json$/.test(lower) || /^\s*[\[{]/.test(txt)) return json(txt, name);
    return text(txt, name);
  }
  return { importFile, verify, cleanMarkup, detectLang };
})();
