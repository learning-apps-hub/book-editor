// My shelf: the user's own copies of Library books, kept only in this browser (IndexedDB).
// Books are ~10–20 MB with pictures, too big for localStorage. Nothing here is ever uploaded.
//
// Stores (database "book-editor", version 1):
//   books  keyPath id      { id, bookVersion, fingerprint, titles, languages, book, story, folder, added, opened,
//                            edits, comments, note, sent, changed }   (see work.js)
//   files  key [id, path]  Blob (pictures, as listed in book.json "pictures")
//   meta   key 'folders'   [folder names, in the order they were made]

const NAME = 'book-editor', VERSION = 1;
let dbp = null;

function db() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(Object.assign(new Error('no IndexedDB'), { name: 'NoStorage' }));
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); dbp = null; };   // a newer tab upgraded: let it
      resolve(d);
    };
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}
const asPromise = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const finished = tx => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || Object.assign(new Error('aborted'), { name: 'AbortError' }));
});
const fileRange = id => IDBKeyRange.bound([id, ''], [id, '￿']);

/** Every picture path a book.json lists (picture types, scene numbers, covers). */
export function picturePaths(book) {
  const out = new Set();
  for (const group of Object.values(book.pictures || {}))
    for (const p of Object.values(group || {})) if (typeof p === 'string' && p) out.add(p);
  return [...out];
}

/** All shelf books (without their pictures) and the folder list. */
export async function list() {
  const d = await db(), tx = d.transaction(['books', 'meta']);
  const [books, folders] = await Promise.all([asPromise(tx.objectStore('books').getAll()), asPromise(tx.objectStore('meta').get('folders'))]);
  return { books, folders: Array.isArray(folders) ? folders : [] };
}

export async function get(id) {
  const d = await db();
  return asPromise(d.transaction('books').objectStore('books').get(id));
}

export async function file(id, path) {
  const d = await db();
  return asPromise(d.transaction('files').objectStore('files').get([id, path]));
}

/**
 * Copy a Library book onto the shelf: book.json, story.json and every picture it lists.
 * Everything is downloaded first and written in one transaction, so a failed or
 * interrupted add never leaves half a book behind.
 */
export async function addFromLibrary(dir, onProgress = () => {}) {
  const getJson = async u => { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
  const [book, story] = await Promise.all([getJson(dir + 'book.json'), getJson(dir + 'story.json')]);
  if (book?.format !== 'book-editor-book') throw new Error('not a book');
  if (book.formatVersion !== 1) throw Object.assign(new Error('too new'), { name: 'TooNew' });
  if (!Array.isArray(story)) throw new Error('story.json is not a list');

  const paths = picturePaths(book), blobs = new Map();
  let done = 0;
  onProgress(0, paths.length);
  const queue = paths.slice();
  const worker = async () => {
    for (let p; (p = queue.shift()) !== undefined;) {
      const r = await fetch(dir + p);
      if (!r.ok) throw new Error(`${r.status} ${p}`);
      blobs.set(p, await r.blob());
      onProgress(++done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, worker));

  const d = await db(), tx = d.transaction(['books', 'files'], 'readwrite');
  const books = tx.objectStore('books'), files = tx.objectStore('files');
  const old = await asPromise(books.get(book.id));
  files.delete(fileRange(book.id));
  for (const [p, b] of blobs) files.put(b, [book.id, p]);
  books.put({
    id: book.id, bookVersion: book.bookVersion, fingerprint: book.fingerprint,
    titles: book.titles, languages: book.languages, book, story,
    folder: old?.folder || '', added: new Date().toISOString(), opened: false,
    bytes: [...blobs.values()].reduce((n, b) => n + b.size, 0),
  });
  await finished(tx);
  askToKeep();
  return book.id;
}

export async function markOpened(id) {
  const d = await db(), tx = d.transaction('books', 'readwrite'), s = tx.objectStore('books');
  const rec = await asPromise(s.get(id));
  if (rec && !rec.opened) { rec.opened = true; s.put(rec); }
  await finished(tx);
}

/**
 * Save the reader's edits, comments, round note, sent state and per-book layout onto the book record.
 * Saves run one after another, so an older save can never land after a newer one.
 */
let saving = Promise.resolve();
export function saveWork(id, work) {
  const run = async () => {
    const d = await db(), tx = d.transaction('books', 'readwrite'), s = tx.objectStore('books');
    const rec = await asPromise(s.get(id));
    if (!rec) throw Object.assign(new Error('book gone'), { name: 'NotFoundError' });
    const changed = new Date().toISOString();
    const { edits, comments, note, sent, layout } = work;
    Object.assign(rec, { edits, comments, note, sent, layout, changed });
    delete rec.editBy;                       // the old field-level "who changed it" (work.js migrate)
    if (!sent) delete rec.sent;
    s.put(rec);
    await finished(tx);
    return changed;
  };
  const p = saving.then(run, run);
  saving = p.catch(() => {});
  return p;
}

/** Move books into a folder ('' = not in a folder). A new folder name is added to the list. */
export async function move(ids, folder) {
  const d = await db(), tx = d.transaction(['books', 'meta'], 'readwrite');
  const books = tx.objectStore('books'), meta = tx.objectStore('meta');
  for (const id of ids) {
    const rec = await asPromise(books.get(id));
    if (rec) { rec.folder = folder; books.put(rec); }
  }
  await tidyFolders(books, meta, folder);
  await finished(tx);
}

/** Remove books and their pictures from this device. The Library copy is untouched. */
export async function remove(ids) {
  const d = await db(), tx = d.transaction(['books', 'files', 'meta'], 'readwrite');
  const books = tx.objectStore('books'), files = tx.objectStore('files');
  for (const id of ids) { books.delete(id); files.delete(fileRange(id)); }
  await tidyFolders(books, tx.objectStore('meta'), '');
  await finished(tx);
}

// Folders exist only while they hold a book: there is no "delete folder" button, and a folder
// is only ever made by moving books into it (Select → Move to → new name).
async function tidyFolders(books, meta, add) {
  const all = await asPromise(books.getAll());
  const used = new Set(all.map(b => b.folder).filter(Boolean));
  let folders = (await asPromise(meta.get('folders'))) || [];
  if (add && !folders.includes(add)) folders.push(add);
  folders = folders.filter(f => used.has(f));
  meta.put(folders, 'folders');
}

// Ask the browser not to clear the shelf when the device is short of space.
// Some browsers answer silently, some never ask; either way the shelf still works.
let asked = false;
function askToKeep() {
  if (asked) return;
  asked = true;
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not offered here */ }
}
