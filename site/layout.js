// Book Editor's browser-native layout engine.
// Pure functions only: the UI owns DOM measurement and persistence.

export const BODY_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
export const PAGE_CHOICES = [
  ['a4p', 'A4 portrait', 210, 297],
  ['a4l', 'A4 landscape', 297, 210],
  ['169', 'Widescreen 16:9', 297, 167.1],
  ['43', 'Tablet 4:3', 240, 180],
];
export const SHEET_CHOICES = [PAGE_CHOICES[1], ['a3l', 'A3 landscape', 420, 297]];
export const TARGETS = [
  ['tv', 'targetTv'],
  ['a5', 'targetA5'],
  ['custom', 'targetCustom'],
  ['changes', 'targetChanges'],
];

const clamp = (n, lo, hi, fallback = hi) => Number.isFinite(+n) ? Math.min(hi, Math.max(lo, +n)) : fallback;
const round = n => Math.round(n * 10) / 10;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const style = o => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

export function scriptFor(code) {
  if (/^zh(?:-|$)/i.test(code)) return 'han';
  if (/^ja(?:-|$)/i.test(code)) return 'kana';
  if (/^ko(?:-|$)/i.test(code)) return 'hangul';
  return 'latin';
}

export function mergePatch(base, patch) {
  const out = structuredClone(base || {});
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === null) delete out[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = mergePatch(out[key] || {}, value);
    else out[key] = structuredClone(value);
  }
  return out;
}

export function defaultsFor(target, book) {
  const all = [...(book.languages || [])];
  const common = {
    languages: target === 'a5' ? all.slice(0, 3) : all,
    language_pages: 'together', body_pt: 14,
    pictures: { main: 'colour', small: 'small' },
    covers: { front: 'colour', back: 'colour' },
    picture_size: 1, picture_sizes: {},
  };
  if (target === 'tv') return { ...common, page: { w: 297, h: 167.1 }, arrangement: 'one_page', picture_width: 'half', pictures: { main: 'colour', small: 'none' } };
  if (target === 'a5') return { ...common, page: { w: 297, h: 210 }, arrangement: 'booklet', body_pt: 12 };
  return { ...common, page: { w: 210, h: 297 }, arrangement: 'facing', picture_width: 'half' };
}

export function normaliseSettings(book, target, saved = {}) {
  const st = mergePatch(defaultsFor(target, book), saved);
  const all = book.languages || [], max = target === 'a5' ? 3 : Infinity;
  st.languages = [...new Set((st.languages || []).filter(x => all.includes(x)))].slice(0, max);
  if (!st.languages.length) st.languages = all.slice(0, max);
  st.body_pt = clamp(st.body_pt, 8, 24, 14);
  st.language_pages = st.language_pages === 'separate' ? 'separate' : 'together';
  st.arrangement = ['facing', 'picture_page', 'one_page', 'booklet'].includes(st.arrangement) ? st.arrangement : 'facing';
  st.picture_width = st.picture_width === 'fit' ? 'fit' : 'half';
  st.picture_size = clamp(st.picture_size, 0.5, 1, 1);
  st.picture_sizes = Object.fromEntries(Object.entries(st.picture_sizes || {}).filter(([k]) => /^\d+$/.test(k)).map(([k, v]) => [k, clamp(v, 0.5, 1, 1)]));
  st.pictures = mergePatch({ main: 'colour', small: 'small' }, st.pictures);
  st.covers = mergePatch({ front: 'colour', back: 'colour' }, st.covers);
  const p = st.page || {};
  st.page = { w: clamp(p.w, 100, 500, 210), h: clamp(p.h, 100, 500, 297) };
  return st;
}

export function onePageFrame(W, H, pictureWidth = 'half', artRatio = 0.75, size = 1) {
  size = clamp(size, 0.5, 1, 1);
  const frame = { x: 8.5, y: 8.5, w: round(W - 17), h: round(H - 25) };
  if (pictureWidth === 'fit') {
    let fh = H - 17, fw = Math.min(fh * artRatio, W * 0.6);
    fh = Math.min(fh, fw / artRatio);
    Object.assign(frame, { w: round(fw * size), h: round(fh * size) });
    frame.y = round((H - frame.h) / 2);
    return [frame, round(frame.x + frame.w + 8)];
  }
  const half = W / 2 * size, bw = half - 17, bh = frame.h * size;
  frame.w = round(Math.min(bw, bh * artRatio));
  frame.h = round(Math.min(bh, bw / artRatio));
  frame.x = round(8.5 + (bw - frame.w) / 2);
  frame.y = round(8.5 + (H - 25 - frame.h) / 2);
  return [frame, round(half + 11)];
}

export function columns(languages, x0, x1, perPage) {
  const gap = 5.5;
  const mid = perPage === 3 && languages.length >= 3 ? languages[Math.floor(perPage / 2)] : null;
  const weights = mid?.script === 'han' ? [56.5, 64, 56.5] : Array(perPage).fill(1);
  const avail = x1 - x0 - gap * (perPage - 1), sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(w => round(avail * w / sum));
  return { xs: widths.map((_, i) => round(x0 + widths.slice(0, i).reduce((a, b) => a + b, 0) + gap * i)), widths };
}

export function geometry({ languages, W, H, arrangement, pictureWidth = 'half', artRatio = 0.75, pictureSize = 1 }) {
  let frame = { x: 8.5, y: 8.5, w: round(W - 17), h: round(H - 25) }, x0 = 11;
  if (arrangement === 'one_page') [frame, x0] = onePageFrame(W, H, pictureWidth, artRatio, pictureSize);
  else if (arrangement === 'picture_page') frame = { x: 0, y: 0, w: W, h: H };
  const { xs, widths } = columns(languages, x0, W - 11, languages.length);
  return { frame, xs, widths, textTop: 30, textBottom: round(H - 15.5), pageNumberY: round(H - 10) };
}

export function bookletSides(n) {
  const last = Math.ceil(n / 4) * 4 - 1, at = i => i < n ? i : null, out = [];
  for (let k = 0; k < (last + 1) / 4; k++) out.push([at(last - 2 * k), at(2 * k)], [at(2 * k + 1), at(last - 1 - 2 * k)]);
  return out;
}

const words = {
  belongs: { en: 'This book belongs to', zh: '这本书属于', pl: 'Ta książka należy do', fr: 'Ce livre appartient à', de: 'Dieses Buch gehört', es: 'Este libro pertenece a', ko: '이 책의 주인은', ja: 'このほんの もちぬし' },
  end: { en: 'The End', zh: '完', pl: 'Koniec', fr: 'Fin', de: 'Ende', es: 'Fin', ko: '끝', ja: 'おしまい' },
};
const word = (key, code) => words[key][code] || words[key].en;
const picture = (book, kind, key) => book.pictures?.[kind]?.[String(key)] || '';
const image = (urls, path) => path ? (urls[path] || path) : '';

function pageCss(W, H, bodyPt) {
  return `
.pg{width:${W}mm;height:${H}mm;position:relative;overflow:hidden;background:#fff;color:#342D28;font-family:Literata,Georgia,serif;box-sizing:border-box}
.full{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.frame{position:absolute;object-fit:cover;border-radius:1.5mm}
.cover-panel{position:absolute;left:23%;right:23%;top:4%;padding:3.5mm 2mm;background:rgba(255,255,255,.88);border-radius:7mm;text-align:center}.cover-panel div{line-height:1.25;color:#5B4435}
.label,.title,.body,.pn{position:absolute;margin:0}.label{top:7mm;font-size:10pt;color:#756756}.title{top:10.6mm;font-size:${Math.max(bodyPt + 3, 11)}pt;color:#5B4435;font-weight:400;line-height:1.2}.body{top:30mm;font-size:${bodyPt}pt;overflow:hidden}.body p{margin:0 0 .65em;white-space:pre-wrap}.pn{top:${round(H - 10)}mm;font-size:10.5pt;color:#342D28}.front{display:flex;align-items:center;justify-content:center}.fm{width:78%;text-align:center;color:#5B4435}.fm>div{line-height:1.3;margin:2mm 0}.rule{height:14mm;border-bottom:.35mm solid #756756}.mid{position:absolute;left:19%;top:25%;width:62%;height:50%;object-fit:contain}.vignette{position:absolute;object-fit:contain}.the-end{position:absolute;left:0;right:0;bottom:8mm;text-align:center;color:#5B4435}
.han{font-family:'Noto Serif SC','Songti SC',serif}.kana{font-family:'Noto Serif JP','Hiragino Mincho ProN',serif}.hangul{font-family:'Noto Serif KR','AppleMyungjo',serif;word-break:keep-all}`;
}

function titleLines(book, languages, meta, scale = 1) {
  return languages.map((l, i) => book.titles?.[l.code] ? `<div class="${l.script}" lang="${esc(l.code)}" style="font-size:${round((i ? 26 : 36) * scale)}pt">${esc(book.titles[l.code])}</div>` : '').join('');
}

function frontPage(kind, languages, book, meta, W) {
  if (kind === 'belongs') return `<div class="pg front"><div class="fm">${languages.map(l => `<div class="${l.script}" lang="${esc(l.code)}" style="font-size:17pt">${esc(word('belongs', l.code))}</div>`).join('')}<div class="rule"></div></div></div>`;
  if (kind === 'title') return `<div class="pg front"><div class="fm">${titleLines(book, languages, meta, Math.min(1, W / 210))}</div></div>`;
  return `<div class="pg front"><div class="fm">${languages.map(l => `<div class="${l.script}" lang="${esc(l.code)}" style="font-size:27pt">${esc(word('end', l.code))}</div>`).join('')}</div></div>`;
}

function textMarkup({ page, languages, geo, W, H, bodyPt, art, urls, frame, small, end }) {
  const out = [`<div class="pg text" data-spread="${page.spread}">`];
  if (art) out.push(`<img class="frame" src="${esc(image(urls, art))}" alt="" style="${style({ left: frame.x + 'mm', top: frame.y + 'mm', width: frame.w + 'mm', height: frame.h + 'mm' })}">`);
  languages.forEach((l, i) => {
    const x = geo.xs[i], w = geo.widths[i], line = l.script === 'han' || l.script === 'kana' || l.script === 'hangul' ? 1.42 : 1.2;
    const pos = `left:${x}mm;width:${w}mm`;
    const paras = String(page.text?.[l.code] || '').split('\n').map(t => `<p>${esc(t)}</p>`).join('');
    out.push(`<h2 class="title ${l.script}" lang="${esc(l.code)}" style="${pos}">${esc(page.title?.[l.code] || '')}</h2>`);
    out.push(`<div class="body ${l.script}" lang="${esc(l.code)}" data-lang="${esc(l.code)}" data-spread="${page.spread}" style="${pos};top:${geo.textTop}mm;height:${round(geo.textBottom - geo.textTop)}mm;line-height:${line}"><div class="flow">${paras}</div></div>`);
  });
  if (small) {
    const i = Math.max(0, languages.length - 1), x = geo.xs[i], w = geo.widths[i], h = Math.min(38, H * .15);
    out.push(`<img class="vignette" src="${esc(image(urls, small))}" alt="" style="left:${x}mm;top:${round(H - h - 18)}mm;width:${w}mm;height:${round(h)}mm">`);
  }
  if (end) out.push(`<div class="the-end">${languages.map(l => `<span class="${l.script}" lang="${esc(l.code)}">${esc(word('end', l.code))}</span>`).join(' · ')}</div>`);
  out.push(`<div class="pn" style="left:${round(W - 21)}mm">${page.no}</div></div>`);
  return out.join('');
}

export function buildLayout({ book, story, settings, urls = {}, languageMeta = {} }) {
  const selected = settings.languages.map(code => ({ code, script: scriptFor(code), label: languageMeta[code] || code }));
  let W = settings.page.w, H = settings.page.h, sheet = null;
  if (settings.arrangement === 'booklet') { sheet = { w: Math.max(W, H), h: Math.min(W, H) }; W = round(sheet.w / 2); H = sheet.h; }
  const artRatio = 0.75, groups = settings.language_pages === 'separate' ? selected.map(x => [x]) : [selected];
  const mainKind = settings.pictures.main, hasMain = mainKind !== 'none';
  const baseGeo = g => geometry({ languages: g, W, H, arrangement: settings.arrangement === 'booklet' ? 'facing' : settings.arrangement, pictureWidth: settings.picture_width, artRatio, pictureSize: settings.picture_size });
  const pages = [];
  const add = (kind, spread, html, extra = {}) => pages.push({ kind, spread, html, no: pages.length, ...extra });
  const coverPath = settings.covers.front === 'line' ? (book.pictures?.lineart?.front || book.pictures?.covers?.front) : book.pictures?.covers?.front;
  add('cover', 0, `<div class="pg cover"><img class="full" src="${esc(image(urls, coverPath))}" alt=""><div class="cover-panel">${titleLines(book, selected, languageMeta, Math.min(1, W / 210))}</div></div>`);
  if (settings.arrangement === 'booklet') {
    add('belongs', 0, frontPage('belongs', selected, book, languageMeta, W));
    add('title', 0, frontPage('title', selected, book, languageMeta, W));
  }
  for (const scene of story) {
    const n = scene.number, main = mainKind === 'colouring' ? picture(book, 'colouring', n) : picture(book, 'colour', n);
    const art = hasMain ? main : '', small = settings.pictures.small === 'small' ? picture(book, 'small', n) : '';
    const artPage = () => {
      const g = geometry({ languages: groups[0], W, H, arrangement: settings.arrangement === 'picture_page' ? 'picture_page' : 'facing', artRatio });
      const cls = settings.arrangement === 'picture_page' ? 'pg art whole' : 'pg art';
      return `<div class="${cls}"><img class="frame" src="${esc(image(urls, art))}" alt="" style="left:${g.frame.x}mm;top:${g.frame.y}mm;width:${g.frame.w}mm;height:${g.frame.h}mm"><div class="pn" style="left:17mm">${pages.length}</div></div>`;
    };
    if (settings.arrangement !== 'one_page' && art) add('art', n, artPage());
    groups.forEach((group, gi) => {
      if (gi && settings.arrangement === 'booklet' && art) add('art', n, artPage());
      const own = settings.picture_sizes?.[n] ?? settings.picture_size;
      const geo = geometry({ languages: group, W, H, arrangement: settings.arrangement === 'one_page' && art ? 'one_page' : 'facing', pictureWidth: settings.picture_width, artRatio, pictureSize: own });
      const p = { ...scene, spread: n, no: pages.length };
      const html = textMarkup({ page: p, languages: group, geo, W, H, bodyPt: settings.body_pt, art: settings.arrangement === 'one_page' ? art : '', urls, frame: geo.frame, small: gi === groups.length - 1 ? small : '', end: false });
      add('text', n, html, { languages: group.map(x => x.code) });
    });
  }
  if (settings.arrangement === 'booklet') {
    const withBack = pages.length + 1;
    if (withBack % 4 === 0 && pages.at(-1)?.kind === 'text') {
      const end = `<div class="the-end">${selected.map(l => `<span class="${l.script}" lang="${esc(l.code)}">${esc(word('end', l.code))}</span>`).join(' · ')}</div>`;
      pages.at(-1).html = pages.at(-1).html.replace(/(<div class="pn"[^>]*>.*<\/div>)<\/div>$/, `${end}$1</div>`);
    } else if (withBack % 4 === 2) {
      const p = picture(book, 'small', story.at(-1)?.number);
      add('extra', 0, `<div class="pg extra">${p ? `<img class="mid" src="${esc(image(urls, p))}" alt="">` : ''}</div>`);
      add('end', 0, frontPage('end', selected, book, languageMeta, W));
    } else {
      add('end', 0, frontPage('end', selected, book, languageMeta, W));
      while ((pages.length + 1) % 4) add('blank', 0, '<div class="pg blank"></div>');
    }
  }
  const backPath = settings.covers.back === 'line' ? (book.pictures?.lineart?.back || book.pictures?.covers?.back) : book.pictures?.covers?.back;
  add('back', -1, `<div class="pg back"><img class="full" src="${esc(image(urls, backPath))}" alt=""></div>`);
  pages.forEach((p, i) => { p.no = i; p.html = p.html.replace(/(<div class="pn"[^>]*>)[^<]*(<\/div>)/, `$1${i}$2`); });
  const missingTitles = story.map(s => ({ spread: s.number, languages: selected.filter(l => !String(s.title?.[l.code] || '').trim()).map(l => l.code) })).filter(x => x.languages.length);
  return { widthMm: W, heightMm: H, sheet, pages, sheets: sheet ? bookletSides(pages.length) : null, css: pageCss(W, H, settings.body_pt), missingTitles };
}

