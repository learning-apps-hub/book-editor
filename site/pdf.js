// Book Editor's PDF export, built in the browser.
// The pages are the Layout preview's own pages (layout.js), laid out once more off screen at full size.
// The browser's line breaks are read back character by character and drawn with pdf-lib at the same places,
// so the PDF shows what the preview shows. Fonts: the same files the preview uses, cut down with HarfBuzz
// (pdf-lib's own subset:true drops most Chinese glyphs) and embedded whole with subset:false.

const VENDOR = new URL('./vendor/', import.meta.url);
const FONTS = new URL('./fonts/', import.meta.url);
// The script's font: the CSS family (fonts.css) and its file. Noto Serif SC/JP/KR are big and not in the public repo
// (step 4 serves them from R2); without the file, a book in that script cannot be exported yet.
export const FONT_FILES = {
  latin: { family: 'BookLatin', file: 'Gelasio-Regular.ttf' },
  han: { family: 'BookHan', file: 'NotoSerifSC-Regular.ttf' },
  kana: { family: 'BookKana', file: 'NotoSerifJP-Regular.ttf' },
  hangul: { family: 'BookHangul', file: 'NotoSerifKR-Regular.ttf' },
};
// Always kept in a subset: a font cut to nothing has no cmap and fontkit refuses it.
const BASE = [...' 0123456789.,:;!?-()·'];
const PX_PT = 0.75, MM_PT = 72 / 25.4;

export class PdfError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

const loaded = {};
function script(name) {
  return loaded[name] ||= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src: new URL(name, VENDOR).href, onload: ok });
    s.onerror = () => { delete loaded[name]; fail(new PdfError('libFail')); };
    document.head.appendChild(s);
  });
}
async function bytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// HarfBuzz hb-subset.wasm (harfbuzzjs 0.4.12): keep only the given characters. A fresh instance per call,
// so a big font's wasm memory is let go afterwards (the method proven on the iPad, tests/pdf-font/).
let hbModule;
async function hbSubset(fontBytes, chars) {
  if (!hbModule) {
    const url = new URL('hb-subset.wasm', VENDOR);
    try { hbModule = await WebAssembly.compileStreaming(fetch(url)); }
    catch { hbModule = await WebAssembly.compile(await bytes(url)); }   // a server that sends the wrong type
  }
  const x = (await WebAssembly.instantiate(hbModule, {})).exports;
  const ptr = x.malloc(fontBytes.length);
  new Uint8Array(x.memory.buffer).set(fontBytes, ptr);
  const blob = x.hb_blob_create(ptr, fontBytes.length, 2, 0, 0), face = x.hb_face_create(blob, 0);
  x.hb_blob_destroy(blob);
  const input = x.hb_subset_input_create_or_fail(), set = x.hb_subset_input_unicode_set(input);
  for (const cp of chars) x.hb_set_add(set, cp);
  const sub = x.hb_subset_or_fail(face, input);
  x.hb_subset_input_destroy(input);
  if (!sub) { x.hb_face_destroy(face); x.free(ptr); throw new PdfError('fontFail'); }
  const rb = x.hb_face_reference_blob(sub), off = x.hb_blob_get_data(rb, 0), len = x.hb_blob_get_length(rb);
  const out = new Uint8Array(x.memory.buffer).slice(off, off + len);
  x.hb_blob_destroy(rb); x.hb_face_destroy(sub); x.hb_face_destroy(face); x.free(ptr);
  return out;
}

const scriptOf = el => el.closest('.han') ? 'han' : el.closest('.kana') ? 'kana' : el.closest('.hangul') ? 'hangul' : 'latin';
function rgba(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r: r / 255, g: g / 255, b: b / 255, a };
}
// A rounded rectangle as an SVG path (y down from its top-left), for pdf-lib's drawSvgPath.
function roundRectPath(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M0 0 H${w} V${h} H0 Z`;
  const k = r * 0.5523;
  return `M${r} 0 H${w - r} C${w - r + k} 0 ${w} ${r - k} ${w} ${r} V${h - r} C${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}`
    + ` H${r} C${r - k} ${h} 0 ${h - r + k} 0 ${h - r} V${r} C0 ${r - k} ${r - k} 0 ${r} 0 Z`;
}

// ---- 1. Lay the pages out off screen, at full size, with the preview's own CSS ----
async function mountPages(data) {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:auto;pointer-events:none;contain:layout style';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${data.css}\n.pg{flex:none;margin:0 0 4mm}.wrap{display:flex;flex-direction:column;align-items:flex-start}</style>`
    + `<div class="wrap">${data.pages.map(p => p.html).join('')}</div>`;
  document.body.appendChild(host);
  await Promise.all([...root.querySelectorAll('img')].map(img => img.getAttribute('src') ? img.decode().catch(() => {}) : null));
  return { host, root, pages: [...root.querySelectorAll('.wrap > .pg')] };
}

// The baseline of a font at a size: the top of a zero-height inline box that sits on it, against the text's own box.
function baselineFinder(root) {
  const probe = document.createElement('div'), cache = new Map();
  probe.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;line-height:normal';
  root.appendChild(probe);
  return (family, size) => {
    const key = family + '|' + size;
    if (!cache.has(key)) {
      probe.style.fontFamily = family; probe.style.fontSize = size;
      probe.innerHTML = '<span>Hg</span><span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
      const [t, b] = probe.children, tr = t.getBoundingClientRect();
      cache.set(key, { ascent: b.getBoundingClientRect().top - tr.top, height: tr.height });
    }
    return cache.get(key);
  };
}

// ---- 2. Read each page back as drawing steps: backgrounds, pictures, rules, words ----
function readPage(pg, baseline, fontsUsed, latinHas) {
  const P = pg.getBoundingClientRect(), ops = [];
  const box = r => ({ x: (r.left - P.left) * PX_PT, y: (r.top - P.top) * PX_PT, w: r.width * PX_PT, h: r.height * PX_PT });
  for (const el of [pg, ...pg.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const bg = rgba(cs.backgroundColor);
    if (bg && bg.a > 0) ops.push({ t: 'rect', ...box(r), radius: parseFloat(cs.borderTopLeftRadius) * PX_PT || 0, colour: bg });
    const bw = parseFloat(cs.borderBottomWidth);
    if (bw > 0 && cs.borderBottomStyle !== 'none') {
      const b = box(r), c = rgba(cs.borderBottomColor);
      if (c && c.a > 0) ops.push({ t: 'line', x1: b.x, x2: b.x + b.w, y: b.y + b.h - bw * PX_PT / 2, width: bw * PX_PT, colour: c });
    }
    if (el.tagName === 'IMG' && el.getAttribute('src') && el.naturalWidth) {
      ops.push({ t: 'img', ...box(r), src: el.currentSrc || el.src, fit: cs.objectFit, radius: parseFloat(cs.borderTopLeftRadius) * PX_PT || 0,
        iw: el.naturalWidth, ih: el.naturalHeight });
    }
  }
  // Words: every character drawn at the very place the browser put it (kerning included), so nothing drifts.
  // Book pages have ligatures off (layout.js), so each character has its own box.
  const walk = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT), range = document.createRange();
  for (let node; (node = walk.nextNode());) {
    const el = node.parentElement, text = node.data;
    if (!text.trim() || !el) continue;
    const cs = getComputedStyle(el), sc = scriptOf(el), colour = rgba(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
    const sizePt = parseFloat(cs.fontSize) * PX_PT, base = baseline(cs.fontFamily, cs.fontSize);
    const clip = el.closest('.body')?.getBoundingClientRect();
    for (let i = 0; i < text.length;) {
      const cp = text.codePointAt(i), n = cp > 0xffff ? 2 : 1, ch = text.slice(i, i + n);
      range.setStart(node, i); range.setEnd(node, i + n); i += n;
      if (/\s/.test(ch)) continue;
      const cr = range.getClientRects()[0];
      if (!cr || !cr.width) continue;
      const mid = (cr.top + cr.bottom) / 2;                       // a glyph box may poke past a tight line height: test its middle
      if (clip && (mid > clip.bottom || mid < clip.top)) continue;  // clipped away on the page too
      // A Latin page cannot draw a character Gelasio lacks; the Chinese font can, when the book has it.
      const font = sc === 'latin' && !latinHas(cp) && fontsUsed.han ? 'han' : sc;
      const y = (cr.top - P.top + base.ascent + (cr.height - base.height) / 2) * PX_PT;
      ops.push({ t: 'text', text: ch, x: (cr.left - P.left) * PX_PT, y, size: sizePt, font, colour });
      (fontsUsed[font] ||= new Set()).add(cp);
    }
  }
  return ops;
}

// ---- 3. Draw the steps on a PDF page (y flips: PDF counts from the bottom) ----
function drawOps(PDFLib, page, ops, dx, H, fonts, images) {
  const { rgb } = PDFLib;
  for (const o of ops) {
    if (o.t === 'rect') {
      page.drawSvgPath(roundRectPath(o.w, o.h, o.radius), { x: dx + o.x, y: H - o.y, color: rgb(o.colour.r, o.colour.g, o.colour.b), opacity: o.colour.a });
    } else if (o.t === 'line') {
      page.drawLine({ start: { x: dx + o.x1, y: H - o.y }, end: { x: dx + o.x2, y: H - o.y }, thickness: o.width, color: rgb(o.colour.r, o.colour.g, o.colour.b), opacity: o.colour.a });
    } else if (o.t === 'img') {
      const img = images.get(o.src);
      if (!img) continue;
      const s = o.fit === 'contain' ? Math.min(o.w / o.iw, o.h / o.ih) : o.fit === 'fill' ? null : Math.max(o.w / o.iw, o.h / o.ih);
      const w = s ? o.iw * s : o.w, h = s ? o.ih * s : o.h, x = dx + o.x + (o.w - w) / 2, top = o.y + (o.h - h) / 2;
      const clipped = o.fit !== 'contain' && (w > o.w + 0.01 || h > o.h + 0.01 || o.radius);
      if (clipped) page.pushOperators(PDFLib.pushGraphicsState(), ...clipPath(PDFLib, dx + o.x, H - o.y - o.h, o.w, o.h, o.radius), PDFLib.clip(), PDFLib.endPath());
      page.drawImage(img, { x, y: H - top - h, width: w, height: h });
      if (clipped) page.pushOperators(PDFLib.popGraphicsState());
    } else if (o.t === 'text') {
      page.drawText(o.text, { x: dx + o.x, y: H - o.y, size: o.size, font: fonts[o.font], color: rgb(o.colour.r, o.colour.g, o.colour.b), opacity: o.colour.a });
    }
  }
}
// A (rounded) rectangle as PDF path operators, x/y = its bottom-left corner in PDF units.
function clipPath(L, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return [L.rectangle(x, y, w, h)];
  const k = r * 0.5523;
  return [L.moveTo(x + r, y), L.lineTo(x + w - r, y), L.appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
    L.lineTo(x + w, y + h - r), L.appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
    L.lineTo(x + r, y + h), L.appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
    L.lineTo(x, y + r), L.appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y), L.closePath()];
}

// A picture for print: the browser's own decoder scales it to 300 dpi at the largest size it is drawn
// (pdf-lib's PNG path decodes and packs pixels in JavaScript, seconds per picture), then it goes in as JPEG.
// A PNG with see-through parts stays PNG so its edges stay clean; a JPEG already small enough goes in as it is.
const DPI = 300;
function pngHasAlpha(b) {
  if (b[25] === 4 || b[25] === 6) return true;                       // grey + alpha, RGBA
  for (let i = 8; i < b.length - 8;) {                              // a palette with a tRNS chunk
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0, type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    i += 12 + len;
  }
  return false;
}
async function embedImage(pdf, src, needPx) {
  const b = await bytes(src), png = b[0] === 0x89 && b[1] === 0x50, jpg = b[0] === 0xff && b[1] === 0xd8;
  const bmp = await createImageBitmap(new Blob([b]));
  const k = Math.min(1, needPx / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  if (jpg && k === 1) { bmp.close(); return pdf.embedJpg(b); }
  const alpha = png && pngHasAlpha(b);
  if (alpha && k === 1) { bmp.close(); return pdf.embedPng(b); }
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
  if (!alpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h); bmp.close();
  const out = await new Promise(ok => c.toBlob(ok, alpha ? 'image/png' : 'image/jpeg', 0.9));
  c.width = c.height = 0;                                            // let the pixels go at once (iPad memory)
  const data = new Uint8Array(await out.arrayBuffer());
  return alpha ? pdf.embedPng(data) : pdf.embedJpg(data);
}

/**
 * Make the PDF for a built layout (`Layout.buildLayout` output).
 * Returns { bytes, pages, ms }. Throws PdfError: 'fontMissing' (detail = the script), 'libFail', 'fontFail'.
 */
export async function makePdf(data, { title = '', onStep: report = () => {} } = {}) {
  const t0 = performance.now(), steps = {};
  let last = t0, lastName = '';
  const onStep = name => { const now = performance.now(); if (lastName) steps[lastName] = Math.round(now - last); last = now; lastName = name; report(name); };
  onStep('prepare');
  await Promise.all([script('pdf-lib.min.js'), script('fontkit.umd.min.js')]);
  const { PDFLib, fontkit } = window;
  // Which scripts the pages need, and their font files (the Chinese file only when a page has Chinese).
  const scripts = new Set(['latin']);
  for (const p of data.pages) for (const m of p.html.matchAll(/class="[^"]*\b(han|kana|hangul)\b/g)) scripts.add(m[1]);
  const files = {};
  await Promise.all([...scripts].map(async sc => {
    try { files[sc] = await bytes(new URL(FONT_FILES[sc].file, FONTS)); }
    catch { throw new PdfError('fontMissing', sc); }
  }));
  // The screen must lay the words out with these very fonts before they are measured.
  await Promise.all([...scripts].map(sc => document.fonts.load(`16px ${FONT_FILES[sc].family}`, sc === 'latin' ? 'Hg' : sc === 'han' ? '狐' : sc === 'kana' ? 'の' : '이')));
  for (const sc of scripts) if (!document.fonts.check(`16px ${FONT_FILES[sc].family}`, sc === 'latin' ? 'Hg' : sc === 'han' ? '狐' : sc === 'kana' ? 'の' : '이')) throw new PdfError('fontMissing', sc);
  const latinFull = fontkit.create(files.latin), latinHas = cp => latinFull.hasGlyphForCodePoint(cp);

  onStep('measure');
  const { host, root, pages } = await mountPages(data);
  await document.fonts.ready;
  let read;
  try {
    const baseline = baselineFinder(root), used = { latin: new Set(), ...(scripts.has('han') ? { han: new Set() } : {}) };
    read = { ops: pages.map(pg => readPage(pg, baseline, used, latinHas)), used };
  } finally { host.remove(); }

  onStep('fonts');
  const pdf = await PDFLib.PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title || 'Book'); pdf.setCreator('Book Editor'); pdf.setProducer('Book Editor (pdf-lib)');
  const fonts = {};
  for (const [sc, set] of Object.entries(read.used)) {
    if (!files[sc]) continue;
    BASE.forEach(ch => set.add(ch.codePointAt(0)));
    fonts[sc] = await pdf.embedFont(await hbSubset(files[sc], set), { subset: false, features: { liga: false, clig: false, dlig: false } });
  }

  onStep('pictures');
  const images = new Map(), need = new Map();
  for (const o of read.ops.flat()) if (o.t === 'img') {
    const s = o.fit === 'contain' ? Math.min(o.w / o.iw, o.h / o.ih) : Math.max(o.w / o.iw, o.h / o.ih);   // drawn pt per picture px
    need.set(o.src, Math.max(need.get(o.src) || 0, Math.ceil(Math.max(o.iw, o.ih) * s / 72 * DPI)));
  }
  for (const [src, px] of need) images.set(src, await embedImage(pdf, src, px).catch(e => { console.warn('picture left out', e); return null; }));

  onStep('pages');
  const W = data.widthMm * MM_PT, H = data.heightMm * MM_PT;
  if (data.sheets) {
    for (const pair of data.sheets) {
      const page = pdf.addPage([2 * W, H]);
      pair.forEach((i, side) => { if (i != null) drawOps(PDFLib, page, read.ops[i], side * W, H, fonts, images); });
    }
  } else {
    for (const ops of read.ops) drawOps(PDFLib, pdf.addPage([W, H]), ops, 0, H, fonts, images);
  }
  onStep('save');
  const out = await pdf.save();
  onStep('');
  return { bytes: out, pages: pdf.getPageCount(), ms: Math.round(performance.now() - t0), steps };
}
