const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONVERSACIONES_FILE = path.join(DATA_DIR, 'conversaciones.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function cargar() {
  if (!fs.existsSync(CONVERSACIONES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONVERSACIONES_FILE, 'utf8'));
  } catch (err) {
    console.error('[storage] Error leyendo conversaciones, empiezo de cero:', err.message);
    return {};
  }
}

function guardar(data) {
  // I12: escritura atómica vía tmp + rename. Si el proceso se cae a mitad
  // de la escritura el archivo final NO queda corrupto (sólo persiste el
  // tmp incompleto que se ignora en el próximo arranque).
  const tmp = CONVERSACIONES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, CONVERSACIONES_FILE);
}

const conversaciones = cargar();

function obtenerHistorial(chatId) {
  return conversaciones[chatId]?.mensajes || [];
}

function añadirMensaje(chatId, rol, contenido) {
  if (!conversaciones[chatId]) {
    conversaciones[chatId] = { creado: new Date().toISOString(), mensajes: [] };
  }
  conversaciones[chatId].mensajes.push({ role: rol, content: contenido });
  conversaciones[chatId].actualizado = new Date().toISOString();

  const limite = config.historialMaxMensajes * 2;
  if (conversaciones[chatId].mensajes.length > limite) {
    conversaciones[chatId].mensajes = conversaciones[chatId].mensajes.slice(-limite);
  }

  guardar(conversaciones);
}

function reiniciarChat(chatId) {
  delete conversaciones[chatId];
  guardar(conversaciones);
}

module.exports = { obtenerHistorial, añadirMensaje, reiniciarChat };
