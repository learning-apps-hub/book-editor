# Book Editor file formats — version 1

Two files pass between the author's production app and Book Editor:

| File | Direction | What it holds |
|---|---|---|
| `<Title>.book.zip` | author → Book Editor | the book: words in every language + pictures |
| `<Title>.changes.json` | Book Editor → author | only what the reader changed, and their comments |

The same book contents also sit **unpacked** in the Library (see the end of this file).
Layout designs and fonts are part of the app, never part of a book file.

## Words on screen vs names in the files

Book Editor calls one picture and its words a **scene** (it may run onto 2–3 printed
pages). The files keep the author app's names: a scene is a `number` in `story.json`
and a `spread` in the changes file. "Scene" is screen wording only.

Language codes are short lowercase codes: `en`, `zh`, `pl`, `fr`, …

---

## 1. The book file: `<Title>.book.zip`

```
book.json
story.json
pictures/colour/      full scene pictures, about 2000 px wide, JPEG
pictures/colouring/   full scene pictures for colouring in, greyscale PNG
pictures/small/       small pictures, about 1000 px, PNG
pictures/covers/      front and back cover
```

Only picked and confirmed pictures are included. A picture type the author did not
export is simply absent. The app reads picture paths from `book.json`, never by guessing
file names, so `.jpg` and `.png` are both accepted for any type.

### `book.json`

```json
{
  "format": "book-editor-book",
  "formatVersion": 1,
  "id": "lantern-fox",
  "bookVersion": 1,
  "fingerprint": "sha256:9f0c…",
  "exported": "2026-11-05T12:00:00Z",
  "languages": ["en", "zh", "pl", "fr"],
  "titles": { "en": "The Lantern Fox", "zh": "提灯笼的小狐狸", "pl": "Lisek z latarenką", "fr": "Le Renard à la lanterne" },
  "scenes": 4,
  "pictures": {
    "colour":    { "1": "pictures/colour/01.jpg", "2": "pictures/colour/02.jpg" },
    "colouring": { "1": "pictures/colouring/01.png" },
    "small":     { "1": "pictures/small/01.png" },
    "covers":    { "front": "pictures/covers/front.jpg", "back": "pictures/covers/back.jpg" }
  }
}
```

| Field | Meaning |
|---|---|
| `format`, `formatVersion` | always `"book-editor-book"` and `1` for this version. A newer version the app does not know is refused with a calm message. |
| `id` | the book's stable id from the author app. Never changes for the same book. |
| `bookVersion` | goes up by one each time the author updates the book in the Library. |
| `fingerprint` | identifies the exact words exported (see below). Book Editor only copies it into the changes file. |
| `exported` | UTC time of the export, ISO 8601. |
| `languages` | the book's languages, in the author's order. The first is the book's main language. |
| `titles` | book title per language. |
| `scenes` | number of entries in `story.json`. |
| `pictures` | per picture type, a map of scene `number` (as a string) → path inside the zip. `covers` uses `front` / `back`. Picture types present = the keys of this object. |

There is **no starting layout**: the Library reader always opens in the app's own
reader look.

### `story.json`

A plain JSON list, one entry per scene, in scene order. The same shape as the author
app's `page-text.json`:

```json
[
  { "number": 1,
    "title": { "en": "The Dark Wood", "zh": "黑黑的树林", "pl": "Ciemny las", "fr": "Le Bois sombre" },
    "text":  { "en": "Once upon a time…", "zh": "从前……", "pl": "Dawno temu…", "fr": "Il était une fois…" } }
]
```

- `number` starts at 1 and has no gaps.
- `title` and `text` have a key for every language in `book.json` `languages`. A missing
  translation is an empty string `""`, not a missing key.
- Paragraphs in `text` are separated by a blank line (`"\n\n"`).
- The author app may keep extra fields per entry. Book Editor ignores them and leaves
  them out of the fingerprint.

### The fingerprint

`"sha256:"` + the lowercase hex SHA-256 of `story.json` reduced to `number`, `title` and
`text` per entry, written as canonical JSON: keys sorted, no spaces (`,` and `:`
separators), non-ASCII characters written as themselves, UTF-8 bytes.

Python:

```python
core = [{"number": s["number"], "title": s["title"], "text": s["text"]} for s in story]
data = json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
fingerprint = "sha256:" + hashlib.sha256(data).hexdigest()
```

`tools/check_fingerprint.mjs` computes the same value in JavaScript and is run against the
sample book to prove both agree.

---

## 2. The changes file: `<Title>.changes.json`

What a reader sends back. One file per book (sending back several books makes several
files). No names, no pictures, a few KB.

```json
{
  "format": "book-editor-changes",
  "formatVersion": 1,
  "book": { "id": "lantern-fox", "bookVersion": 1, "fingerprint": "sha256:9f0c…" },
  "saved": "2026-11-06T09:30:00Z",
  "changes": [
    { "spread": 2, "lang": "en", "field": "text",  "was": "…old words…", "now": "…new words…" },
    { "spread": 3, "lang": "pl", "field": "title", "was": "Most", "now": "Mostek" }
  ],
  "comments": [
    { "spread": 1, "lang": "en", "quote": "dark wood", "position": 31, "text": "Too scary for little ones?" },
    { "spread": 4, "text": "Lovely ending." }
  ],
  "layout": { "target": "a5-booklet", "settings": { } }
}
```

| Field | Meaning |
|---|---|
| `format`, `formatVersion` | always `"book-editor-changes"` and `1`. |
| `book` | copied from the book's `book.json`: `id`, `bookVersion`, `fingerprint`. The author app uses the fingerprint to see whether its words moved on since the export. |
| `saved` | UTC time the file was made. |
| `changes` | at most one entry per scene + language + field. `field` is `"title"` or `"text"`. `was` = the words in the book file, `now` = the reader's words. Whole field, not a diff. A field the reader changed and then changed back is left out. |
| `comments` | either **on selected words**: `spread`, `lang`, `quote` (the exact selected words), `position` (character index where `quote` starts in that scene's `text` in that language, counted on the reader's version, i.e. after the reader's own change if there is one), `text`; or **on the whole scene**: `spread`, `text` only. Comments on selected words are on the scene text, not the title. |
| `layout` | optional: the export target and settings the reader last picked. The author app may ignore it. |

Character positions are counted in UTF-16 code units (JavaScript string index). `quote`
is the source of truth; `position` only tells repeated quotes apart. If they disagree
the author app looks for `quote` nearest to `position`.

Lists may be empty. A changes file with nothing in `changes` or `comments` is not sent.

---

## 3. The Library (unpacked)

The Library holds the same contents unpacked, one folder per book, served by the app's
own address at `/library/`:

```
library.json
<id>/book.json
<id>/story.json
<id>/pictures/…
```

`library.json`:

```json
{
  "format": "book-editor-library",
  "formatVersion": 1,
  "books": [
    { "id": "lantern-fox", "bookVersion": 1, "titles": { "en": "The Lantern Fox" },
      "languages": ["en", "zh", "pl", "fr"], "cover": "lantern-fox/pictures/covers/front.jpg",
      "shared": "2026-11-05T12:00:00Z", "bytes": 14200000 }
  ]
}
```

`bytes` is the total size of the book's folder, so the app can say how much room adding
it to My shelf takes.

## Versions

A reader that meets a `formatVersion` it does not know stops and says so. Adding new
optional fields does not change the version; renaming or removing a field does.
