#!/usr/bin/env python3
"""Build the made-up sample book used for development and tests.

Writes the unpacked book (Library layout) to site/samples/lantern-fox/ and packs
_build/The Lantern Fox.book.zip (zips are gitignored). Pictures are plain
placeholders drawn here; the words are made up. Standard library only.

    python3 tools/make_sample.py
"""
import hashlib
import json
import shutil
import struct
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "samples" / "lantern-fox"
BUILD = ROOT / "_build"
EXPORTED = "2026-11-05T12:00:00Z"

LANGS = ["en", "zh", "pl", "fr"]
TITLES = {"en": "The Lantern Fox", "zh": "提灯笼的小狐狸",
          "pl": "Lisek z latarenką", "fr": "Le Renard à la lanterne"}

STORY = [
    {"number": 1,
     "title": {"en": "The Dark Wood", "zh": "黑黑的树林", "pl": "Ciemny las", "fr": "Le Bois sombre"},
     "text": {
         "en": "Once upon a time, at the edge of a dark wood, lived a small fox called Pip.\n\n"
               "Every evening Pip lit a paper lantern and carried it between the trees.",
         "zh": "从前，在一片黑黑的树林边上，住着一只叫皮普的小狐狸。\n\n每天傍晚，皮普都会点亮一盏纸灯笼，提着它在树林里走。",
         "pl": "Dawno temu, na skraju ciemnego lasu, mieszkał mały lisek o imieniu Pip.\n\n"
               "Każdego wieczoru Pip zapalał papierową latarenkę i niósł ją między drzewami.",
         "fr": "Il était une fois, à l'orée d'un bois sombre, un petit renard nommé Pip.\n\n"
               "Chaque soir, Pip allumait une lanterne en papier et la portait entre les arbres."}},
    {"number": 2,
     "title": {"en": "The Lost Hedgehog", "zh": "迷路的小刺猬", "pl": "Zagubiony jeżyk", "fr": "Le Hérisson perdu"},
     "text": {
         "en": "One night Pip heard a tiny sniff. A hedgehog sat alone under a fern.\n\n"
               "“I can't find my way home,” she whispered.",
         "zh": "一天晚上，皮普听见一声小小的抽泣。一只小刺猬独自坐在蕨叶下面。\n\n“我找不到回家的路了。”她小声说。",
         "pl": "Pewnej nocy Pip usłyszał ciche pochlipywanie. Pod paprocią siedział samotny jeżyk.\n\n"
               "„Nie mogę znaleźć drogi do domu” – szepnęła.",
         "fr": "Une nuit, Pip entendit un petit reniflement. Une hérissonne était assise seule sous une fougère.\n\n"
               "« Je ne retrouve plus le chemin de ma maison », murmura-t-elle."}},
    {"number": 3,
     "title": {"en": "The Little Bridge", "zh": "小木桥", "pl": "Mały most", "fr": "Le Petit Pont"},
     "text": {
         "en": "Pip held the lantern high. Together they crossed the little bridge over the stream.\n\n"
               "The water sang, and the light danced on the stones.",
         "zh": "皮普把灯笼举得高高的。他们一起走过小溪上的小木桥。\n\n溪水在唱歌，灯光在石头上跳舞。",
         "pl": "Pip uniósł latarenkę wysoko. Razem przeszli przez mały most nad strumykiem.\n\n"
               "Woda śpiewała, a światło tańczyło na kamieniach.",
         "fr": "Pip leva haut sa lanterne. Ensemble, ils traversèrent le petit pont sur le ruisseau.\n\n"
               "L'eau chantait et la lumière dansait sur les pierres."}},
    {"number": 4,
     "title": {"en": "Home at Last", "zh": "终于到家了", "pl": "Nareszcie w domu", "fr": "Enfin à la maison"},
     "text": {
         "en": "At the top of the hill a round door glowed. “Home!” cried the hedgehog.\n\n"
               "Pip walked back through the wood, and the dark did not seem so dark any more.",
         "zh": "山顶上，一扇圆圆的门亮着光。“到家了！”小刺猬叫道。\n\n皮普穿过树林走回家，黑夜好像不再那么黑了。",
         "pl": "Na szczycie wzgórza świeciły okrągłe drzwi. „Dom!” – zawołał jeżyk.\n\n"
               "Pip wrócił przez las, a ciemność nie wydawała się już taka ciemna.",
         "fr": "En haut de la colline brillait une porte ronde. « Ma maison ! » s'écria la hérissonne.\n\n"
               "Pip rentra à travers le bois, et la nuit ne lui sembla plus si noire."}},
]

# One flat background colour per scene, so placeholders are easy to tell apart.
SCENE_COLOURS = [(38, 52, 92), (46, 94, 78), (52, 86, 128), (120, 70, 50)]
LANTERN = (250, 196, 80)


def png(path: Path, w: int, h: int, bg, dot, grey=False):
    """Write a placeholder PNG: flat background, one round 'lantern', a frame."""
    ch = 1 if grey else 3
    colour_type = 0 if grey else 2
    if grey:
        bg, dot = (bg,), (dot,)
    cx, cy, r = int(w * 0.62), int(h * 0.42), int(min(w, h) * 0.12)
    frame = max(4, w // 100)
    bg_b, dot_b = bytes(bg), bytes(dot)
    edge_b = bytes([0] * ch) if grey else bytes(dot)
    raw = bytearray()
    for y in range(h):
        if y < frame or y >= h - frame:
            row = edge_b * w
        else:
            row = bytearray(bg_b * w)
            row[0:frame * ch] = edge_b * frame
            row[(w - frame) * ch:] = edge_b * frame
            dy = y - cy
            if abs(dy) <= r:
                half = int((r * r - dy * dy) ** 0.5)
                row[(cx - half) * ch:(cx + half) * ch] = dot_b * (2 * half)
            row = bytes(row)
        raw += b"\x00" + row

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, colour_type, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                     + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def fingerprint(story):
    core = [{"number": s["number"], "title": s["title"], "text": s["text"]} for s in story]
    data = json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return "sha256:" + hashlib.sha256(data).hexdigest()


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    pictures = {"colour": {}, "colouring": {}, "small": {}, "covers": {}}
    for s, bg in zip(STORY, SCENE_COLOURS):
        n = s["number"]
        rel = {t: f"pictures/{t}/{n:02d}.png" for t in ("colour", "colouring", "small")}
        png(OUT / rel["colour"], 2000, 1500, bg, LANTERN)
        png(OUT / rel["colouring"], 2000, 1500, 255, 230, grey=True)
        png(OUT / rel["small"], 1000, 1000, bg, LANTERN)
        for t, p in rel.items():
            pictures[t][str(n)] = p
    for side, bg in (("front", (30, 40, 70)), ("back", (70, 40, 30))):
        p = f"pictures/covers/{side}.png"
        png(OUT / p, 1400, 2000, bg, LANTERN)
        pictures["covers"][side] = p

    book = {
        "format": "book-editor-book", "formatVersion": 1,
        "id": "lantern-fox", "bookVersion": 1,
        "fingerprint": fingerprint(STORY), "exported": EXPORTED,
        "languages": LANGS, "titles": TITLES,
        "scenes": len(STORY), "pictures": pictures,
    }
    dump = lambda o: json.dumps(o, ensure_ascii=False, indent=2) + "\n"
    (OUT / "book.json").write_text(dump(book), encoding="utf-8")
    (OUT / "story.json").write_text(dump(STORY), encoding="utf-8")

    files = sorted(p for p in OUT.rglob("*") if p.is_file())
    size = sum(p.stat().st_size for p in files)
    library = {"format": "book-editor-library", "formatVersion": 1, "books": [{
        "id": book["id"], "bookVersion": 1, "titles": TITLES, "languages": LANGS,
        "cover": "lantern-fox/" + pictures["covers"]["front"],
        "shared": EXPORTED, "bytes": size}]}
    (OUT.parent / "library.json").write_text(dump(library), encoding="utf-8")

    BUILD.mkdir(exist_ok=True)
    zpath = BUILD / f"{TITLES['en']}.book.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(OUT).as_posix())
    print(f"{OUT.relative_to(ROOT)}: {len(files)} files, {size // 1024} KB")
    print(f"{zpath.relative_to(ROOT)}: {zpath.stat().st_size // 1024} KB")
    print(book["fingerprint"])


if __name__ == "__main__":
    main()
