// Persiste el conjunto de chats pausados en disco. Si el proceso se cae
// (Docker restart, crash, reinicio manual), un chat que estaba pausado
// SIGUE PAUSADO al volver — crítico en contexto legal: el abogado pausó
// para tomar control humano de un caso sensible y no quiere que el bot
// vuelva a responder solo.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'chats-pausados.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function _cargar() {
  if (!fs.existsSync(FILE)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (err) {
    console.warn('[pausedChats] No puedo leer estado, empiezo de cero:', err.message);
    return new Set();
  }
}

class PersistedSet {
  constructor() {
    this._set = _cargar();
  }
  has(v) { return this._set.has(v); }
  add(v) {
    if (this._set.has(v)) return this;
    this._set.add(v);
    this._persist();
    return this;
  }
  delete(v) {
    const ok = this._set.delete(v);
    if (ok) this._persist();
    return ok;
  }
  values() { return this._set.values(); }
  [Symbol.iterator]() { return this._set[Symbol.iterator](); }
  get size() { return this._set.size; }

  _persist() {
    try {
      // Escritura atómica: tmp + rename.
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...this._set]), 'utf8');
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.error('[pausedChats] Error persistiendo:', err.message);
    }
  }
}

module.exports = { PersistedSet };
