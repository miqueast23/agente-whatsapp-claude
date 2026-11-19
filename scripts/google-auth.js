// Script de un solo uso para obtener el refresh_token de Google Calendar.
// Ejecuta:  npm run calendario:auth
// Pega el código que te devuelve Google y copia el refresh_token a tu .env.

const readline = require('readline');
const { google } = require('googleapis');
require('dotenv').config();

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en .env.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'urn:ietf:wg:oauth:2.0:oob');

const url = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('\n1) Abre este enlace en el navegador:\n');
console.log(url);
console.log('\n2) Autoriza el acceso a la cuenta de Google del despacho.');
console.log('3) Copia el código que te muestra Google y pégalo aquí.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Código: ', async (codigo) => {
  rl.close();
  try {
    const { tokens } = await oauth2.getToken(codigo.trim());
    console.log('\n[OK] Tokens recibidos.\n');
    if (tokens.refresh_token) {
      console.log('Copia este valor a GOOGLE_REFRESH_TOKEN en tu .env:\n');
      console.log(tokens.refresh_token);
      console.log('');
    } else {
      console.warn('No ha llegado refresh_token. Borra la app en https://myaccount.google.com/permissions y vuelve a ejecutar este script.');
    }
  } catch (err) {
    console.error('Error obteniendo tokens:', err.message);
    process.exit(1);
  }
});
