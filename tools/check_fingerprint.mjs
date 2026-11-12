// Checks an unpacked book against docs/book-file-format.md and recomputes the
// story fingerprint in JavaScript (must equal the one Python wrote).
//   node tools/check_fingerprint.mjs [bookDir] [changes.json]
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || "site/samples/lantern-fox";
const changesPath = process.argv[3] || "docs/examples/lantern-fox.changes.json";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

// Canonical JSON: sorted keys, no spaces, non-ASCII as itself (= Python sort_keys, ensure_ascii=False).
const canon = (v) =>
  Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object"
    ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
    : JSON.stringify(v);

export const fingerprint = (story) =>
  "sha256:" + createHash("sha256")
    .update(canon(story.map((s) => ({ number: s.number, title: s.title, text: s.text }))), "utf8")
    .digest("hex");

const book = read(join(dir, "book.json"));
const story = read(join(dir, "story.json"));
check(book.format === "book-editor-book" && book.formatVersion === 1, "book.json format/version");
check(fingerprint(story) === book.fingerprint, `fingerprint: JS ${fingerprint(story)} != file ${book.fingerprint}`);
check(book.scenes === story.length, "scenes count");
story.forEach((s, i) => {
  check(s.number === i + 1, `scene ${i + 1}: number`);
  for (const lang of book.languages)
    for (const f of ["title", "text"])
      check(typeof s[f]?.[lang] === "string", `scene ${s.number}: ${f}.${lang} missing`);
});
for (const [type, map] of Object.entries(book.pictures))
  for (const [key, p] of Object.entries(map))
    check(existsSync(join(dir, p)), `picture ${type}/${key}: ${p} missing`);

if (existsSync(changesPath)) {
  const c = read(changesPath);
  check(c.format === "book-editor-changes" && c.formatVersion === 1, "changes format/version");
  check(c.book.id === book.id && c.book.fingerprint === book.fingerprint, "changes: book id/fingerprint");
  const now = {};
  for (const ch of c.changes) {
    const s = story[ch.spread - 1];
    check(["title", "text"].includes(ch.field), `change ${ch.spread}: field`);
    check(s?.[ch.field]?.[ch.lang] === ch.was, `change ${ch.spread}/${ch.lang}/${ch.field}: "was" differs from book`);
    if (ch.field === "text") now[ch.spread + "/" + ch.lang] = ch.now;
  }
  for (const cm of c.comments) {
    check(cm.spread >= 1 && cm.spread <= story.length && cm.text, `comment ${cm.spread}: spread/text`);
    if ("quote" in cm) {
      const t = now[cm.spread + "/" + cm.lang] ?? story[cm.spread - 1].text[cm.lang];
      check(t.slice(cm.position, cm.position + cm.quote.length) === cm.quote,
        `comment ${cm.spread}/${cm.lang}: quote not at position ${cm.position}`);
    }
  }
}

if (fail.length) { console.error("FAIL\n- " + fail.join("\n- ")); process.exit(1); }
console.log(`OK ${dir}: ${story.length} scenes, ${book.languages.join("/")}, ${book.fingerprint}`);
