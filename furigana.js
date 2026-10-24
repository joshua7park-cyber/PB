'use strict';
/* Furigana engine: kuromoji readings + a Bible reading dictionary (learned from the public-domain 口語訳 ruby).
   annotate(text) -> text with {漢字|かな} markup over kanji only (okurigana left bare). */
const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;
const KANJI_G = /[㐀-䶿一-鿿豈-﫿々〆ヶ]+/g;

function toHira(s) { return (s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); }
function hasKanji(s) { return KANJI.test(s); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* split surface into kanji / non-kanji runs and align reading to kanji runs */
function align(surface, reading) {
  const parts = [];
  let last = 0; let m; KANJI_G.lastIndex = 0;
  while ((m = KANJI_G.exec(surface))) { if (m.index > last) parts.push({ k: false, s: surface.slice(last, m.index) }); parts.push({ k: true, s: m[0] }); last = m.index + m[0].length; }
  if (last < surface.length) parts.push({ k: false, s: surface.slice(last) });
  const re = new RegExp('^' + parts.map(p => p.k ? '(.+?)' : '(' + escRe(toHira(p.s)) + ')').join('') + '$');
  const mm = toHira(reading).match(re);
  if (!mm) return [{ k: true, s: surface, r: toHira(reading) }];
  return parts.map((p, i) => p.k ? { k: true, s: p.s, r: mm[i + 1] } : { k: false, s: p.s });
}

class Furigana {
  constructor(tokenizer, dict) { const d = dict || {}; this.t = tokenizer; this.uni = d.uni || d; this.bi = d.bi || {}; this.ch = d.ch || {}; this.user = {}; }
  readingOf(tok, prev) {
    const s = tok.surface_form;
    if (this.user[s]) return this.user[s];
    if (prev != null) { const b = this.bi[prev + '\t' + s]; if (b) return b; }
    const o = this.uni[s];
    if (o) return o;
    if (tok.reading && tok.reading !== '*') return toHira(tok.reading);
    /* unknown word: per-kanji readings learned from the ruby corpus */
    let r = '';
    for (const c of s) { if (KANJI.test(c)) { if (!this.ch[c]) return null; r += this.ch[c]; } else r += toHira(c); }
    return r;
  }
  annotate(text) {
    if (!text || !hasKanji(text)) return text;
    let out = ''; let prev = '';
    for (const tok of this.t.tokenize(text)) {
      const s = tok.surface_form; const pv = prev; prev = s;
      if (!hasKanji(s)) { out += s; continue; }
      const r = this.readingOf(tok, pv);
      if (!r || r === toHira(s)) { out += s; continue; }
      for (const p of align(s, r)) out += p.k ? '{' + p.s + '|' + p.r + '}' : p.s;
    }
    return out;
  }
}

/* ---- learning a dictionary from ruby-annotated text ({漢字|かな}) ---- */
function plainAndGold(marked) {
  /* returns plain text and per-char gold reading array (kanji chars inside a ruby span share the span id) */
  let plain = ''; const spans = [];
  const re = /\{([^|{}]+)\|([^{}]+)\}/g; let last = 0; let m;
  while ((m = re.exec(marked))) { plain += marked.slice(last, m.index); spans.push({ start: plain.length, end: plain.length + m[1].length, r: m[2] }); plain += m[1]; last = re.lastIndex; }
  plain += marked.slice(last);
  return { plain, spans };
}
function goldForToken(start, surface, spans) {
  const end = start + surface.length; let r = ''; let pos = start;
  for (const sp of spans) {
    if (sp.end <= start || sp.start >= end) continue;
    if (sp.start < start || sp.end > end) return null; /* ruby crosses token boundary */
  }
  while (pos < end) {
    const sp = spans.find(x => x.start === pos);
    if (sp) { r += sp.r; pos = sp.end; continue; }
    const ch = surface[pos - start];
    if (KANJI.test(ch)) return null; /* kanji without ruby */
    r += toHira(ch); pos++;
  }
  return r;
}
function learn(tokenizer, markedVerses) {
  const stats = {}; const bst = {}; const cst = {};
  for (const mv of markedVerses) {
    const { plain, spans } = plainAndGold(mv);
    for (const sp of spans) if (sp.end - sp.start === 1) { const c = plain[sp.start]; const e = cst[c] || (cst[c] = {}); e[sp.r] = (e[sp.r] || 0) + 1; }
    let pos = 0; let prev = '';
    for (const tok of tokenizer.tokenize(plain)) {
      const s = tok.surface_form; const st = pos; pos += s.length; const pv = prev; prev = s;
      if (!hasKanji(s)) continue;
      const g = goldForToken(st, s, spans); if (!g) continue;
      const k = toHira(tok.reading && tok.reading !== '*' ? tok.reading : '');
      const e = stats[s] || (stats[s] = { n: 0, kuro: k, g: {} });
      e.n++; e.g[g] = (e.g[g] || 0) + 1;
      const bk = pv + '\t' + s; const be = bst[bk] || (bst[bk] = { n: 0, g: {} }); be.n++; be.g[g] = (be.g[g] || 0) + 1;
    }
  }
  const best = (g) => Object.entries(g).sort((a, b) => b[1] - a[1])[0];
  const uni = {};
  for (const s in stats) { const e = stats[s]; const b = best(e.g); if (b[0] !== e.kuro && b[1] / e.n >= 0.6 && b[1] >= 2) uni[s] = b[0]; }
  const bi = {};
  for (const k in bst) {
    const e = bst[k]; const b = best(e.g); const s = k.split('\t')[1];
    const base = uni[s] || (stats[s] && stats[s].kuro);
    if (b[0] !== base && b[1] / e.n >= 0.75 && b[1] >= 2) bi[k] = b[0];
  }
  const ch = {};
  for (const c in cst) ch[c] = best(cst[c])[0];
  return { dict: { uni, bi, ch }, stats };
}
if (typeof module !== "undefined") module.exports = { Furigana, learn, plainAndGold, goldForToken, toHira, align, hasKanji };
if (typeof window !== "undefined") window.FuriganaLib = { Furigana, toHira, align, hasKanji };
