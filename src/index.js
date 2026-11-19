const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const config = require('./config');
const { generarRespuesta } = require('./claude');
const { obtenerHistorial, añadirMensaje, reiniciarChat } = require('./storage');
const { procesarMedia } = require('./media');
const baseLegal = require('./baseLegal');
const reminders = require('./reminders');
const webPanel = require('./webPanel');
const audit = require('./audit');
const documentos = require('./documentos');
const { PersistedSet } = require('./pausedChats');
const retention = require('./retention');

const COMANDOS = {
  '/reset': 'Reinicia la conversación.',
  '/pausa': 'Pausa al asistente en este chat.',
  '/reanudar': 'Reanuda al asistente en este chat.',
  '/ayuda': 'Muestra los comandos disponibles.',
};

// Persistente en data/chats-pausados.json: sobrevive a reinicios de Docker / crashes.
const chatsPausados = new PersistedSet();

// Handlers globales: que un error no controlado no tumbe el proceso.
// Loguear con stack y seguir; Docker reinicia si es realmente fatal.
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: config.puppeteerExecutablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('\n[whatsapp] Escanea este QR (Ajustes → Dispositivos vinculados):\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('[whatsapp] Autenticado correctamente.'));
client.on('auth_failure', (m) => console.error('[whatsapp] Fallo de autenticación:', m));
client.on('disconnected', (r) => console.warn('[whatsapp] Desconectado:', r));

client.on('ready', () => {
  console.log(`[whatsapp] Cliente listo. Modelo: ${config.model}. Despacho: ${config.despachoNombre}.`);
  console.log(
    `[whatsapp] Capacidades → transcripción: ${config.transcripcionDisponible ? 'sí' : 'no'} | ` +
      `calendario: ${config.calendarioDisponible ? 'sí' : 'no'} | ` +
      `base legal: ${config.baseLegalDisponible ? 'sí' : 'no'} | ` +
      `slack: ${config.slackDisponible ? 'sí' : 'no'} | ` +
      `email: ${config.emailDisponible ? 'sí' : 'no'}`
  );

  reminders.iniciar(client);
  retention.iniciar(); // Purga RGPD diaria a las 03:00.

  if (config.baseLegalDisponible) {
    baseLegal.reindexar().catch((e) => console.error('[base-legal] Error en indexación:', e));
  }
});

client.on('message', async (msg) => {
  try {
    if (msg.fromMe) return;
    if (msg.isStatus) return;

    const chat = await msg.getChat();
    if (config.soloPrivados && chat.isGroup) return;

    const chatId = chat.id._serialized;
    const texto = (msg.body || '').trim();
    const telefonoChat = (msg.from || '').replace('@c.us', '');
    // Defensa anti prompt-injection: el notifyName es controlado por el
    // cliente. Truncar y filtrar saltos y corchetes que podrían cerrar
    // el bloque [Contacto WhatsApp: ...] del prompt.
    const nombreChat = String(msg._data?.notifyName || '')
      .replace(/[\r\n\[\]<>{}]/g, ' ')
      .slice(0, 40)
      .trim();

    if (texto.startsWith('/')) {
      await manejarComando(msg, chat, chatId, texto);
      audit.registrar({ tipo: 'comando', tel: telefonoChat, nombre: nombreChat, contenido: texto });
      return;
    }
    if (chatsPausados.has(chatId)) return;

    let paraClaude;
    let paraHistorial;
    let aviso;
    let origen = 'texto';

    if (msg.hasMedia) {
      const r = await procesarMedia(msg);
      paraClaude = r.paraClaude;
      paraHistorial = r.paraHistorial;
      aviso = r.aviso;
      if ((msg.type || '').toLowerCase() === 'ptt' || (msg.type || '').toLowerCase() === 'audio') origen = 'voz';
      else if ((msg.type || '').toLowerCase() === 'image') origen = 'imagen';
      else if ((msg.type || '').toLowerCase() === 'document') origen = 'pdf';
      else origen = 'media';
    } else if (texto) {
      paraClaude = texto;
      paraHistorial = texto;
    } else {
      return;
    }

    if (aviso) {
      await msg.reply(aviso);
      audit.registrar({
        tipo: 'mensaje_entrante',
        tel: telefonoChat,
        nombre: nombreChat,
        origen,
        contenido: paraHistorial,
        respuesta: aviso,
      });
      return;
    }

    await chat.sendStateTyping();

    const historial = obtenerHistorial(chatId);

    let contentClaude = paraClaude;
    let contentHistorial = paraHistorial;

    if (historial.length === 0) {
      const meta = `[Contacto WhatsApp: ${nombreChat || 'sin nombre'}${telefonoChat ? `, tel +${telefonoChat}` : ''}]\n\n`;
      if (typeof contentClaude === 'string') {
        contentClaude = meta + contentClaude;
      } else if (Array.isArray(contentClaude)) {
        contentClaude = [{ type: 'text', text: meta }, ...contentClaude];
      }
      contentHistorial = meta + contentHistorial;
    }

    const mensajes = [...historial, { role: 'user', content: contentClaude }];

    const toolsLlamadas = [];
    const { texto: respuesta, uso, tools: toolsUsadas } = await generarRespuesta(mensajes, {
      chatId,
      telefonoChat,
      nombreChat,
      origen,
      whatsappClient: client,
      onToolUse: (n) => toolsLlamadas.push(n),
    });

    if (!respuesta) {
      await msg.reply('Disculpa, no he podido procesar tu mensaje. ¿Puedes reformularlo?');
      return;
    }

    añadirMensaje(chatId, 'user', contentHistorial);
    añadirMensaje(chatId, 'assistant', respuesta);
    await msg.reply(respuesta);

    audit.registrar({
      tipo: 'mensaje_entrante',
      tel: telefonoChat,
      nombre: nombreChat,
      origen,
      contenido: typeof paraHistorial === 'string' ? paraHistorial.slice(0, 500) : '[multimodal]',
      respuesta: respuesta.slice(0, 500),
      tools: toolsUsadas || toolsLlamadas,
      uso,
    });

    if (uso) {
      console.log(
        `[claude] chat=${chatId} in=${uso.input_tokens} out=${uso.output_tokens} cache_r=${uso.cache_read_input_tokens} cache_c=${uso.cache_creation_input_tokens}`
      );
    }
  } catch (err) {
    console.error('[handler] Error procesando mensaje:', err);
    try {
      await msg.reply('Ha ocurrido un error técnico. Vuelve a intentarlo en un momento o escribe /reset si el problema persiste.');
    } catch (_) {}
  }
});

async function manejarComando(msg, chat, chatId, texto) {
  const comando = texto.toLowerCase().split(/\s+/)[0];
  switch (comando) {
    case '/reset':
      reiniciarChat(chatId);
      await msg.reply('He reiniciado nuestra conversación. ¿En qué puedo ayudarte?');
      break;
    case '/pausa':
      chatsPausados.add(chatId);
      await msg.reply('Asistente pausado. Escribe /reanudar para volver a activarme.');
      break;
    case '/reanudar':
      chatsPausados.delete(chatId);
      await msg.reply('Asistente reanudado.');
      break;
    case '/ayuda': {
      const lista = Object.entries(COMANDOS).map(([c, d]) => `${c} — ${d}`).join('\n');
      await msg.reply(`Comandos disponibles:\n\n${lista}`);
      break;
    }
    default:
      await msg.reply('Comando no reconocido. Escribe /ayuda para ver los disponibles.');
  }
}

if (config.webPanel.activado) {
  webPanel.iniciar({ chatsPausados });
}

process.on('SIGINT', async () => {
  console.log('\n[whatsapp] Cerrando...');
  try { await documentos.cerrarBrowser(); } catch (_) {}
  try { await client.destroy(); } catch (_) {}
  process.exit(0);
});

console.log('[whatsapp] Iniciando cliente...');
client.initialize();
