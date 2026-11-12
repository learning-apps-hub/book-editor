// The reader's identity on this device: a picture (symbol), a colour and an optional nickname.
// It is shown wherever the author would see a name: changes, comments, replies, "Resolved by".
// The colour is the avatar's background and the reader's highlighter (their added words, their comment boxes).
//
// Stored in localStorage `be.me` = { id, symbol, colour, nick? }. `id` is random (not personal); it says which
// marks are this reader's own, so a later change of picture/colour/nickname shows on all of them.
// Older data carries a plain typed name (string) in `by`; it is still read and shown as a name chip.

export const SYMBOLS = ['🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐵', '🐰', '🐱',
  '🐶', '🦉', '🐧', '🐢', '🐝', '🦋', '🐳', '🌻', '🌙', '⭐'];
// Mid-tone colours: readable as a solid avatar background and as a see-through highlighter in light and dark.
export const COLOURS = ['#E5484D', '#F08C2E', '#E2B714', '#46A758', '#12A594', '#3E7BDB', '#6E56CF', '#D6409F', '#A07553', '#8B8D98'];
export const NICK_MAX = 30;

const newId = () => globalThis.crypto?.randomUUID?.() || `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** A clean identity { id, symbol, colour, nick? } or null when it is not a valid one. */
export function clean(x, keepId = true) {
  if (!x || typeof x !== 'object' || !SYMBOLS.includes(x.symbol) || !COLOURS.includes(x.colour)) return null;
  const nick = String(x.nick || '').trim().replace(/\s+/g, ' ').slice(0, NICK_MAX);
  return { id: keepId && typeof x.id === 'string' && x.id ? x.id : newId(), symbol: x.symbol, colour: x.colour, ...(nick ? { nick } : {}) };
}

export function load(store) {
  try { return clean(JSON.parse(store.get('be.me') || 'null')); } catch { return null; }
}
export function save(store, me) { store.set('be.me', JSON.stringify(me)); }

/** What a `by` value shows as: the reader's own marks follow their current identity. */
export function resolve(by, me) {
  if (by && typeof by === 'object') return me && by.id && by.id === me.id ? me : by;
  return by ? String(by) : null;            // older files: a typed name
}
export const isOwn = (by, me, oldName) => !!by && (typeof by === 'object' ? !!me && by.id === me.id : !!oldName && by === oldName);
