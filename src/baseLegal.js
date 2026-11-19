const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'base-legal-index.json');

const EXTENSIONES_SOPORTADAS = ['.pdf', '.docx', '.txt', '.md'];

let indice = { documentos: [], actualizado: null, ruta: '' };
let bm25 = null;
let indexandoEnCurso = false;

if (fs.existsSync(INDEX_FILE)) {
  try {
    indice = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    bm25 = construirBM25(indice.documentos);
    console.log(`[base-legal] Índice cargado: ${indice.documentos.length} documentos.`);
  } catch (err) {
    console.warn('[base-legal] Índice corrupto, ignorando:', err.message);
  }
}

function guardarIndice() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indice, null, 0), 'utf8');
}

function* recorrerCarpeta(dir) {
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[base-legal] No puedo leer ${dir}: ${err.message}`);
    return;
  }
  for (const entrada of entradas) {
    const full = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      yield* recorrerCarpeta(full);
    } else if (entrada.isFile()) {
      const ext = path.extname(entrada.name).toLowerCase();
      if (EXTENSIONES_SOPORTADAS.includes(ext)) {
        yield full;
      }
    }
  }
}

async function extraerTexto(ruta) {
  const ext = path.extname(ruta).toLowerCase();
  const buf = fs.readFileSync(ruta);

  if (ext === '.pdf') {
    const pdf = require('pdf-parse');
    const data = await pdf(buf);
    return data.text || '';
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value || '';
  }
  if (ext === '.txt' || ext === '.md') {
    return buf.toString('utf8');
  }
  return '';
}

async function reindexar({ forzar = false } = {}) {
  if (!config.baseLegalDisponible) {
    console.log('[base-legal] BASE_LEGAL_PATH no está configurado.');
    return { ok: false, motivo: 'no_configurado' };
  }
  if (indexandoEnCurso) {
    return { ok: false, motivo: 'ya_en_curso' };
  }
  if (!fs.existsSync(config.baseLegal.path)) {
    console.warn(`[base-legal] Ruta no existe: ${config.baseLegal.path}`);
    return { ok: false, motivo: 'ruta_inexistente' };
  }

  indexandoEnCurso = true;
  console.log(`[base-legal] Indexando ${config.baseLegal.path}...`);

  const previo = new Map(indice.documentos.map((d) => [d.ruta, d]));
  const nuevos = [];
  let procesados = 0;
  let reutilizados = 0;
  let errores = 0;

  for (const ruta of recorrerCarpeta(config.baseLegal.path)) {
    let stat;
    try { stat = fs.statSync(ruta); } catch { continue; }
    const mtime = stat.mtimeMs;
    const size = stat.size;

    const existente = previo.get(ruta);
    if (!forzar && existente && existente.mtime === mtime && existente.size === size) {
      nuevos.push(existente);
      reutilizados++;
      continue;
    }

    if (size > 100 * 1024 * 1024) {
      console.warn(`[base-legal] Salto archivo >100MB: ${ruta}`);
      continue;
    }

    try {
      let texto = await extraerTexto(ruta);
      texto = texto.replace(/\s+/g, ' ').trim();
      if (!texto) {
        errores++;
        continue;
      }
      if (texto.length > config.baseLegal.maxCharsPorDoc) {
        texto = texto.slice(0, config.baseLegal.maxCharsPorDoc);
      }
      nuevos.push({
        ruta,
        nombre: path.basename(ruta),
        carpeta: path.relative(config.baseLegal.path, path.dirname(ruta)),
        ext: path.extname(ruta).toLowerCase(),
        mtime,
        size,
        texto,
      });
      procesados++;
      if (procesados % 10 === 0) {
        console.log(`[base-legal] Procesados ${procesados} (reutilizados ${reutilizados}, errores ${errores})...`);
      }
    } catch (err) {
      console.warn(`[base-legal] Error en ${ruta}: ${err.message}`);
      errores++;
    }
  }

  indice = {
    documentos: nuevos,
    actualizado: new Date().toISOString(),
    ruta: config.baseLegal.path,
  };
  guardarIndice();
  bm25 = construirBM25(indice.documentos);
  indexandoEnCurso = false;

  console.log(
    `[base-legal] Indexación lista: ${nuevos.length} docs (nuevos ${procesados}, reutilizados ${reutilizados}, errores ${errores}).`
  );
  return { ok: true, total: nuevos.length, procesados, reutilizados, errores };
}

function tokenizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function construirBM25(documentos) {
  if (!documentos.length) return null;
  const docs = documentos.map((d, i) => ({
    id: i,
    tokens: tokenizar(`${d.nombre} ${d.carpeta} ${d.texto}`),
  }));
  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.tokens.length, 0) / N;
  const df = new Map();
  docs.forEach((d) => {
    new Set(d.tokens).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });
  const tfPorDoc = docs.map((d) => {
    const tf = new Map();
    d.tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { id: d.id, tf, len: d.tokens.length };
  });
  return { tfPorDoc, df, N, avgLen, k1: 1.5, b: 0.75 };
}

function buscarDocumentos(query, k = 5) {
  if (!bm25) return [];
  const tokens = tokenizar(query);
  if (!tokens.length) return [];

  const resultados = bm25.tfPorDoc.map(({ id, tf, len }) => {
    let score = 0;
    for (const t of tokens) {
      const f = tf.get(t);
      if (!f) continue;
      const dfT = bm25.df.get(t) || 0;
      const idf = Math.log((bm25.N - dfT + 0.5) / (dfT + 0.5) + 1);
      const num = f * (bm25.k1 + 1);
      const den = f + bm25.k1 * (1 - bm25.b + bm25.b * (len / bm25.avgLen));
      score += idf * (num / den);
    }
    return { id, score };
  });

  return resultados
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => {
      const doc = indice.documentos[r.id];
      return {
        ruta: doc.ruta,
        nombre: doc.nombre,
        carpeta: doc.carpeta,
        score: Number(r.score.toFixed(3)),
        extracto: extraerSnippet(doc.texto, tokens),
      };
    });
}

function extraerSnippet(texto, tokens) {
  const idx = texto.toLowerCase().indexOf(tokens[0]);
  if (idx === -1) return texto.slice(0, 400) + (texto.length > 400 ? '…' : '');
  const inicio = Math.max(0, idx - 150);
  const fin = Math.min(texto.length, idx + 350);
  return (inicio > 0 ? '…' : '') + texto.slice(inicio, fin) + (fin < texto.length ? '…' : '');
}

function leerDocumento(ruta, parte = 1, charsPorParte = 30000) {
  const doc = indice.documentos.find((d) => d.ruta === ruta);
  if (!doc) {
    return { ok: false, error: `Documento no encontrado en el índice: ${ruta}` };
  }
  const inicio = (parte - 1) * charsPorParte;
  const fin = inicio + charsPorParte;
  const fragmento = doc.texto.slice(inicio, fin);
  const totalPartes = Math.ceil(doc.texto.length / charsPorParte);
  return {
    ok: true,
    nombre: doc.nombre,
    carpeta: doc.carpeta,
    parte,
    total_partes: totalPartes,
    contenido: fragmento,
    truncado_por_archivo: doc.texto.length >= config.baseLegal.maxCharsPorDoc,
  };
}

function listarDocumentos({ filtroCarpeta = '', max = 50 } = {}) {
  return indice.documentos
    .filter((d) => !filtroCarpeta || d.carpeta.toLowerCase().includes(filtroCarpeta.toLowerCase()))
    .slice(0, max)
    .map((d) => ({ ruta: d.ruta, nombre: d.nombre, carpeta: d.carpeta }));
}

function estadoIndice() {
  return {
    documentos: indice.documentos.length,
    actualizado: indice.actualizado,
    ruta: indice.ruta || config.baseLegal.path,
    indexando: indexandoEnCurso,
  };
}

module.exports = {
  reindexar,
  buscarDocumentos,
  leerDocumento,
  listarDocumentos,
  estadoIndice,
};
