const OpenAI = require('openai').default;
const config = require('./config');

let cliente = null;
function getCliente() {
  if (!cliente && config.openaiApiKey) {
    // I2: maxRetries para 429/503 transitorios de Whisper.
    cliente = new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 4 });
  }
  return cliente;
}

async function transcribirAudio({ data, mimetype, filename }) {
  if (!config.transcripcionDisponible) {
    throw new Error('Transcripción no configurada (falta OPENAI_API_KEY).');
  }

  const buffer = Buffer.from(data, 'base64');
  const ext = mimetypeAExtension(mimetype);
  const nombre = filename || `audio.${ext}`;

  const file = await OpenAI.toFile(buffer, nombre, { type: mimetype });

  const respuesta = await getCliente().audio.transcriptions.create({
    file,
    model: config.whisperModelo,
    language: 'es',
  });

  return respuesta.text?.trim() || '';
}

function mimetypeAExtension(mimetype) {
  if (!mimetype) return 'ogg';
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('mpeg')) return 'mp3';
  if (mimetype.includes('mp4')) return 'm4a';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('webm')) return 'webm';
  return 'ogg';
}

module.exports = { transcribirAudio };
