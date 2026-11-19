const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'registro-consultas.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });

function registrar(evento) {
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...evento });
  try {
    fs.appendFileSync(LOG_FILE, linea + '\n', 'utf8');
  } catch (err) {
    console.error('[audit] No he podido escribir al registro:', err.message);
  }
}

function _leerTodos() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const eventos = [];
  for (const linea of content.split('\n')) {
    if (!linea.trim()) continue;
    try { eventos.push(JSON.parse(linea)); } catch (_) {}
  }
  return eventos;
}

function leerUltimos({ max = 200, filtroTel = '', filtroTexto = '' } = {}) {
  const todos = _leerTodos();
  let res = todos;
  if (filtroTel) {
    res = res.filter((e) => (e.tel || '').includes(filtroTel));
  }
  if (filtroTexto) {
    const q = filtroTexto.toLowerCase();
    res = res.filter(
      (e) =>
        (e.contenido || '').toLowerCase().includes(q) ||
        (e.respuesta || '').toLowerCase().includes(q) ||
        (e.nombre || '').toLowerCase().includes(q)
    );
  }
  return res.slice(-max).reverse();
}

function estadisticasPorTelefono() {
  const todos = _leerTodos();
  const porTel = new Map();

  for (const ev of todos) {
    if (!ev.tel) continue;
    if (!porTel.has(ev.tel)) {
      porTel.set(ev.tel, {
        tel: ev.tel,
        nombre: ev.nombre || '',
        primer_contacto: ev.ts,
        ultimo_contacto: ev.ts,
        mensajes: 0,
        tools: new Set(),
        documentos: 0,
        derivado: false,
      });
    }
    const p = porTel.get(ev.tel);
    p.ultimo_contacto = ev.ts;
    if (ev.nombre && !p.nombre) p.nombre = ev.nombre;
    if (ev.tipo === 'mensaje_entrante') p.mensajes++;
    if (ev.tipo === 'documento_creado') p.documentos++;
    if (ev.tools && Array.isArray(ev.tools)) ev.tools.forEach((t) => p.tools.add(t));
    if (ev.tipo === 'derivacion') p.derivado = true;
  }

  return [...porTel.values()]
    .map((p) => ({ ...p, tools: [...p.tools] }))
    .sort((a, b) => b.ultimo_contacto.localeCompare(a.ultimo_contacto));
}

function exportarCsv() {
  const todos = _leerTodos();
  const headers = ['ts', 'tipo', 'tel', 'nombre', 'contenido', 'respuesta', 'tools'];
  const escapeCsv = (s) => {
    if (s == null) return '';
    const v = String(s).replace(/"/g, '""');
    return /[",\n;]/.test(v) ? `"${v}"` : v;
  };
  const filas = todos.map((e) =>
    headers
      .map((h) => {
        if (h === 'tools') return escapeCsv((e.tools || []).join(' '));
        return escapeCsv(e[h]);
      })
      .join(',')
  );
  return [headers.join(','), ...filas].join('\n');
}

module.exports = { registrar, leerUltimos, estadisticasPorTelefono, exportarCsv, LOG_FILE };
