'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_NOTES = 500;
const MAX_TEXT = 2000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function checkSignal(signal) {
  if (signal?.aborted) throw new Error('Die Notizanfrage wurde abgebrochen.');
}
function objectArgs(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Ungültige Notizparameter.');
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Ungültige Seitengröße oder Position.');
  return value;
}

/** The host supplies this module's own data directory after activation. */
exports.activate = async ({ moduleId, dataDirectory }) => {
  if (moduleId !== 'sample-notes' || typeof dataDirectory !== 'string' || !path.isAbsolute(dataDirectory)) throw new Error('Das Notizmodul benötigt seinen eigenen lokalen Datenspeicher.');
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(dataDirectory, 'notes.json');
  let queue = Promise.resolve();
  const serialize = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };

  async function read(signal) {
    checkSignal(signal);
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Der Notizspeicher ist zu groß oder ungültig.');
      const notes = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      checkSignal(signal);
      if (!Array.isArray(notes) || notes.length > MAX_NOTES || notes.some(note => !note || typeof note.id !== 'string' || note.id.length > 100 || typeof note.text !== 'string' || !note.text.trim() || note.text.length > MAX_TEXT || typeof note.createdAt !== 'string' || !Number.isFinite(Date.parse(note.createdAt)))) throw new Error('Der Notizspeicher enthält ungültige Daten.');
      return notes.map(({ id, text, createdAt }) => ({ id, text, createdAt }));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    } finally { await handle?.close(); }
  }

  async function write(notes, signal) {
    const temporary = path.join(dataDirectory, `.notes-${randomUUID()}.tmp`);
    let handle;
    try {
      checkSignal(signal);
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(notes, null, 2) + '\n', 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      checkSignal(signal);
      await fs.rename(temporary, file);
    } finally {
      await handle?.close();
      await fs.rm(temporary, { force: true });
    }
  }

  return {
    tools: {
      'sample-notes.list': async (args = {}, { signal } = {}) => {
        objectArgs(args, ['query', 'offset', 'limit']);
        if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 120)) throw new Error('Der Suchtext darf höchstens 120 Zeichen enthalten.');
        const offset = integer(args.offset, 0, 0, MAX_NOTES);
        const limit = integer(args.limit, 20, 1, 50);
        return serialize(async () => {
          const query = (args.query ?? '').trim().toLocaleLowerCase('de-DE');
          const all = (await read(signal)).filter(note => !query || note.text.toLocaleLowerCase('de-DE').includes(query)).reverse();
          const notes = [];
          for (const note of all.slice(offset, offset + limit)) {
            if (Buffer.byteLength(JSON.stringify([...notes, note]), 'utf8') > 24 * 1024) break;
            notes.push(note);
          }
          const hasMore = offset + notes.length < all.length;
          return { notes, total: all.length, hasMore, ...(hasMore ? { nextOffset: offset + notes.length } : {}) };
        });
      },
      'sample-notes.add': async (args, { signal } = {}) => {
        objectArgs(args, ['text']);
        if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > MAX_TEXT) throw new Error('Eine Notiz benötigt 1 bis 2000 Zeichen.');
        const text = args.text.trim();
        return serialize(async () => {
          const notes = await read(signal);
          if (notes.length >= MAX_NOTES) throw new Error('Der Beispielspeicher ist auf 500 Notizen begrenzt.');
          const note = { id: randomUUID(), text, createdAt: new Date().toISOString() };
          await write([...notes, note], signal);
          return { note };
        });
      }
    },
    dispose: async () => { await queue; }
  };
};
