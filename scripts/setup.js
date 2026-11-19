// Asistente de configuración interactivo.
// Ejecuta:  npm run setup
//
// Te pide los datos esenciales por terminal (la API key NO pasa por chat
// ni por logs) y te genera el .env listo para arrancar. Antes de guardar,
// valida que la API key de Anthropic funciona con una llamada real.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ENV_EXAMPLE = path.join(__dirname, '..', '.env.example');

function preguntar(rl, texto, { secreto = false, porDefecto = '' } = {}) {
  return new Promise((resolve) => {
    const prompt = porDefecto ? `${texto} [${porDefecto}]: ` : `${texto}: `;
    if (!secreto) {
      rl.question(prompt, (resp) => resolve(resp.trim() || porDefecto));
      return;
    }
    // Modo "secreto": ocultamos lo que se teclea
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(prompt);
    const onData = (char) => {
      char = char.toString();
      switch (char) {
        case '\n':
        case '\r':
        case '':
          stdin.removeListener('data', onData);
          stdin.setRawMode && stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          break;
        case '':
          process.exit(1);
        default:
          stdout.write('*');
          break;
      }
    };
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buffer = '';
    const realOnData = (char) => {
      const c = char.toString();
      if (c === '\n' || c === '\r' || c === '') {
        stdin.removeListener('data', realOnData);
        stdin.setRawMode && stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\n');
        resolve(buffer.trim() || porDefecto);
      } else if (c === '') {
        process.exit(1);
      } else if (c === '' || c === '\b') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        buffer += c;
        stdout.write('*');
      }
    };
    stdin.on('data', realOnData);
  });
}

async function validarApiKey(apiKey) {
  const Anthropic = require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey });
  try {
    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Di "ok"' }],
    });
    const texto = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { ok: true, modelo: r.model, respuesta: texto };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function aplicarReemplazos(plantilla, datos) {
  let out = plantilla;
  for (const [clave, valor] of Object.entries(datos)) {
    const regex = new RegExp(`^${clave}=.*$`, 'm');
    if (regex.test(out)) {
      out = out.replace(regex, `${clave}=${valor}`);
    } else {
      out += `\n${clave}=${valor}\n`;
    }
  }
  return out;
}

(async () => {
  console.log('\n=== Configuración del agente WhatsApp ===\n');

  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.error('No encuentro .env.example. ¿Estás en la carpeta correcta?');
    process.exit(1);
  }

  if (fs.existsSync(ENV_PATH)) {
    console.log('⚠ Ya existe un .env. Voy a sobrescribir los campos esenciales (el resto se mantiene).\n');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('1) API key de Anthropic (sk-ant-api03-…). Sácala en:');
    console.log('   https://console.anthropic.com/settings/keys');
    console.log('   No la verás mientras la tecleas; pégala con clic-derecho.\n');

    let apiKey = '';
    let validacion = null;
    for (let intento = 1; intento <= 3; intento++) {
      apiKey = await preguntar(rl, '   ANTHROPIC_API_KEY', { secreto: true });
      if (!apiKey || !apiKey.startsWith('sk-ant-')) {
        console.log('   ✗ La key debería empezar por "sk-ant-…". Vuelve a intentarlo.\n');
        continue;
      }
      console.log('   Validando con la API de Anthropic…');
      validacion = await validarApiKey(apiKey);
      if (validacion.ok) {
        console.log(`   ✓ La key funciona. Modelo de prueba: ${validacion.modelo}\n`);
        break;
      } else {
        console.log(`   ✗ Anthropic la ha rechazado: ${validacion.error}\n`);
        if (intento === 3) {
          console.error('Demasiados intentos. Aborto.');
          process.exit(1);
        }
      }
    }

    console.log('2) Datos del despacho (puedes dejar los valores por defecto pulsando Enter):\n');
    const despachoNombre = await preguntar(rl, '   DESPACHO_NOMBRE', { porDefecto: 'Vea Legal' });
    const abogadoNombre = await preguntar(rl, '   ABOGADO_NOMBRE', { porDefecto: 'Oscar' });
    const abogadoTelefono = await preguntar(rl, '   ABOGADO_TELEFONO (formato +34...)', { porDefecto: '' });

    console.log('\n3) Acceso al panel web (http://localhost:3000):\n');
    const webUser = await preguntar(rl, '   WEB_USER', { porDefecto: 'admin' });
    let webPass = '';
    while (!webPass || webPass.length < 6 || webPass === 'cambia-esto') {
      webPass = await preguntar(rl, '   WEB_PASS (mínimo 6 caracteres)', { secreto: true });
      if (!webPass || webPass.length < 6 || webPass === 'cambia-esto') {
        console.log('   ✗ Demasiado corta o sin cambiar. Pon algo serio.\n');
      }
    }

    console.log('\n4) Ruta de la base documental legal (opcional, Enter para saltar):\n');
    const baseLegalPath = await preguntar(rl, '   BASE_LEGAL_PATH', {
      porDefecto: 'D:\\Base de datos Legal\\oscar',
    });

    const plantilla = fs.readFileSync(ENV_EXAMPLE, 'utf8');
    const partida = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : plantilla;

    const final = aplicarReemplazos(partida, {
      ANTHROPIC_API_KEY: apiKey,
      DESPACHO_NOMBRE: despachoNombre,
      ABOGADO_NOMBRE: abogadoNombre,
      ABOGADO_TELEFONO: abogadoTelefono,
      WEB_USER: webUser,
      WEB_PASS: webPass,
      BASE_LEGAL_PATH: baseLegalPath,
    });

    fs.writeFileSync(ENV_PATH, final, 'utf8');
    console.log(`\n✓ Listo. He escrito ${ENV_PATH}\n`);
    console.log('Para arrancar el bot:');
    console.log('   npm start');
    console.log('Cuando salga el QR, escanéalo desde el WhatsApp del despacho:');
    console.log('   Ajustes → Dispositivos vinculados → Vincular un dispositivo → Escanear.\n');
  } finally {
    rl.close();
  }
})().catch((err) => {
  console.error('Error en el setup:', err.message || err);
  process.exit(1);
});
