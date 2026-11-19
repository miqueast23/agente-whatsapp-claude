const { transcribirAudio } = require('./transcripcion');
const config = require('./config');

const IMAGENES_SOPORTADAS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Defensa anti prompt-injection en el caption: el caption viene del cliente.
// Truncamos a 1000 chars y eliminamos comillas que cierren el wrapper.
function limpiarCaption(s) {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/["']/g, '')
    .slice(0, 1000)
    .trim();
}

// Estimación del tamaño del adjunto ANTES de descargarlo (whatsapp-web.js
// expone size en mensajes de tipo documento/audio/imagen). Si excede,
// no descargamos para no quemar memoria ni factura.
function tamanoEstimado(msg) {
  const s = msg._data?.size ?? msg._data?.filehash?.size;
  return typeof s === 'number' ? s : null;
}

async function procesarMedia(msg) {
  // C4: límite anti-DoS. Estimación previa.
  const sizeHint = tamanoEstimado(msg);
  if (sizeHint && sizeHint > config.media.maxBytes) {
    const mb = (config.media.maxBytes / 1024 / 1024).toFixed(0);
    return {
      paraClaude: `[Adjunto recibido pero rechazado por tamaño (>${mb} MB).]`,
      paraHistorial: `[Adjunto > ${mb} MB rechazado]`,
      aviso: `El archivo que has enviado es demasiado grande para procesarlo aquí (límite ${mb} MB). Si es un PDF de un caso, mejor mándamelo por email o pásamelo en varias partes.`,
    };
  }

  let media;
  try {
    media = await msg.downloadMedia();
  } catch (err) {
    console.error('[media] downloadMedia falló:', err.message);
    return {
      paraClaude: '[adjunto recibido que no he podido descargar]',
      paraHistorial: '[adjunto no descargable]',
      aviso: 'No he podido descargar el archivo. ¿Puedes reenviármelo?',
    };
  }
  if (!media) {
    return {
      paraClaude: msg.body || '[adjunto recibido que no he podido descargar]',
      paraHistorial: '[adjunto no descargable]',
    };
  }

  // Verificación POST-download: el base64 ocupa ~4/3 del binario real.
  const tamRealBytes = Math.floor(((media.data || '').length * 3) / 4);
  if (tamRealBytes > config.media.maxBytes) {
    const mb = (config.media.maxBytes / 1024 / 1024).toFixed(0);
    return {
      paraClaude: `[Adjunto descargado pero excede ${mb} MB; descartado.]`,
      paraHistorial: `[Adjunto > ${mb} MB descartado]`,
      aviso: `El archivo descargado pesa más de ${mb} MB. Reenvíamelo más pequeño o mándalo por email.`,
    };
  }

  const mimetype = (media.mimetype || '').toLowerCase();
  const caption = limpiarCaption(msg.body || '');

  if (mimetype.startsWith('audio/') || msg.type === 'ptt' || msg.type === 'audio') {
    return await procesarAudio(media, caption);
  }

  if (IMAGENES_SOPORTADAS.some((m) => mimetype.startsWith(m))) {
    return procesarImagen(media, caption, mimetype);
  }

  if (mimetype === 'application/pdf') {
    return procesarPdf(media, caption);
  }

  return {
    paraClaude: `[El usuario ha enviado un archivo de tipo ${mimetype || 'desconocido'} que no puedo procesar.${caption ? ' Texto adjunto: ' + caption : ''}]`,
    paraHistorial: `[Archivo no soportado: ${mimetype || 'desconocido'}${caption ? ' — ' + caption : ''}]`,
    aviso: 'He recibido un archivo de un tipo que aún no puedo procesar (vídeos, audios largos en formato raro, etc.). Si quieres, descríbeme lo que contiene y lo vemos.',
  };
}

async function procesarAudio(media, caption) {
  if (!config.transcripcionDisponible) {
    return {
      paraClaude: '[El usuario ha enviado una nota de voz pero la transcripción no está configurada.]',
      paraHistorial: '[Nota de voz no transcrita — transcripción no configurada]',
      aviso: 'He recibido tu nota de voz, pero ahora mismo no tengo configurado el servicio para escucharla. ¿Puedes escribirme lo que querías contarme?',
    };
  }

  try {
    const transcripcion = await transcribirAudio({
      data: media.data,
      mimetype: media.mimetype,
      filename: media.filename,
    });

    if (!transcripcion) {
      return {
        paraClaude: '[Nota de voz recibida pero la transcripción salió vacía.]',
        paraHistorial: '[Nota de voz inaudible]',
        aviso: 'He intentado transcribir tu nota de voz pero no he conseguido entender nada. ¿Puedes repetirla o escribirme el mensaje?',
      };
    }

    const combinado = caption ? `${transcripcion}\n\n(Texto que acompañaba: ${caption})` : transcripcion;
    return {
      paraClaude: `[Nota de voz transcrita] ${combinado}`,
      paraHistorial: `[Nota de voz transcrita] ${combinado}`,
    };
  } catch (err) {
    console.error('[media] Error transcribiendo audio:', err.message);
    return {
      paraClaude: '[Error al transcribir nota de voz]',
      paraHistorial: '[Error al transcribir nota de voz]',
      aviso: 'No he podido procesar tu nota de voz por un error técnico. ¿Puedes escribirme el mensaje?',
    };
  }
}

function procesarImagen(media, caption, mimetype) {
  const bloques = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mimetype, data: media.data },
    },
    {
      type: 'text',
      text: caption
        ? `El usuario ha enviado esta imagen con el siguiente texto: "${caption}"`
        : 'El usuario ha enviado esta imagen sin texto. Descríbele brevemente qué ves y pregúntale qué necesita.',
    },
  ];

  return {
    paraClaude: bloques,
    paraHistorial: `[Imagen adjunta${caption ? ': ' + caption : ''}]`,
  };
}

function procesarPdf(media, caption) {
  const nombre = media.filename || 'documento.pdf';
  const bloques = [
    {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: media.data },
      title: nombre,
    },
    {
      type: 'text',
      text: caption
        ? `El usuario ha enviado este PDF ("${nombre}") con el siguiente texto: "${caption}". Léelo y responde a lo que pide.`
        : `El usuario ha enviado este PDF ("${nombre}") sin texto. Hazle un resumen breve de qué contiene y pregúntale qué quiere hacer con él.`,
    },
  ];

  return {
    paraClaude: bloques,
    paraHistorial: `[PDF adjunto: ${nombre}${caption ? ' — ' + caption : ''}]`,
  };
}

module.exports = { procesarMedia };
