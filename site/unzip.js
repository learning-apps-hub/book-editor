// A small .zip reader for adding a book (<Title>.book.zip) to the Library, all in the browser.
// Stored and deflated entries only (what every zip tool writes for these files); no zip64, no encryption.
// Returns Map(path -> () => Promise<Uint8Array>), so only the files that are needed are unpacked.

export class ZipError extends Error {}

const u16 = (d, o) => d.getUint16(o, true), u32 = (d, o) => d.getUint32(o, true);

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') throw new ZipError('old-browser');
  const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), d = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError('not-zip');
  const count = u16(d, eocd + 10), cdOff = u32(d, eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new ZipError('zip64');
  const names = new TextDecoder(), files = new Map();
  for (let i = 0, p = cdOff; i < count; i++) {
    if (u32(d, p) !== 0x02014b50) throw new ZipError('bad-zip');
    const flags = u16(d, p + 8), method = u16(d, p + 10), csize = u32(d, p + 20), usize = u32(d, p + 24);
    const nlen = u16(d, p + 28), xlen = u16(d, p + 30), clen = u16(d, p + 32), local = u32(d, p + 42);
    const name = names.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\.[^/]*$/.test(name)) continue;
    if (flags & 1) throw new ZipError('encrypted');
    if (method !== 0 && method !== 8) throw new ZipError('method');
    files.set(name, async () => {
      if (u32(d, local) !== 0x04034b50) throw new ZipError('bad-zip');
      const start = local + 30 + u16(d, local + 26) + u16(d, local + 28), raw = buf.subarray(start, start + csize);
      const out = method === 0 ? raw.slice() : await inflate(raw);
      if (out.length !== usize) throw new ZipError('bad-zip');
      return out;
    });
  }
  // A zip made by right-clicking a folder holds everything one level down: read from that folder.
  if (!files.has('book.json')) {
    const top = [...files.keys()].find(n => /^[^/]+\/book\.json$/.test(n));
    if (top) {
      const pre = top.slice(0, -'book.json'.length);
      return new Map([...files].filter(([n]) => n.startsWith(pre)).map(([n, f]) => [n.slice(pre.length), f]));
    }
  }
  return files;
}
