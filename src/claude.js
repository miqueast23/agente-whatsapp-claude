const Anthropic = require('@anthropic-ai/sdk').default;
const config = require('./config');
const { SYSTEM_PROMPT } = require('./prompt');
const { getToolsDisponibles, ejecutarTool } = require('./tools');

// I2: maxRetries con backoff exponencial automático del SDK para 429/503.
const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 4 });

const MAX_ITERACIONES_TOOL = 6;
// I4: era 1024 → contratos/dictámenes se truncaban. Subido a 4096 (≈ 3200 palabras).
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);
const MAX_TOOL_RESULT_BYTES = 50000;

// C13: truncar un JSON serializado por longitud produce JSON inválido que
// Claude no puede parsear y la API rechaza el mensaje. Devolvemos un objeto
// VÁLIDO que indica truncamiento + un preview.
function truncarToolResult(obj) {
  const s = JSON.stringify(obj);
  if (s.length <= MAX_TOOL_RESULT_BYTES) return s;
  return JSON.stringify({
    ok: true,
    truncated: true,
    nota: 'Resultado demasiado grande; se ha truncado. Pide búsquedas más específicas.',
    preview: s.slice(0, 4000),
  });
}

// I3: cache_control también en el último tool. Las tools son estáticas
// por configuración (calendar/base legal on/off), así que la API puede
// cachear el bloque entero entre llamadas y ahorrar ~90% del coste input.
function preparaTools(tools) {
  if (!tools.length) return undefined;
  const t = tools.map((x) => ({ ...x }));
  t[t.length - 1] = { ...t[t.length - 1], cache_control: { type: 'ephemeral' } };
  return t;
}

async function generarRespuesta(messages, contexto = {}) {
  const toolsBase = getToolsDisponibles();
  const tools = preparaTools(toolsBase);

  let mensajes = [...messages];
  let respuesta;
  let usoAcumulado = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const toolsLlamadas = [];
  let alcanzadoTope = false;
  let truncadoMaxTokens = false;

  for (let i = 0; i < MAX_ITERACIONES_TOOL; i++) {
    respuesta = await client.messages.create({
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      ...(tools ? { tools } : {}),
      messages: mensajes,
    });

    sumarUso(usoAcumulado, respuesta.usage);

    // I5: detectar stop_reason='max_tokens'. Si Claude cortó la generación
    // por límite de tokens, marcar para añadir aviso al final.
    if (respuesta.stop_reason === 'max_tokens') {
      truncadoMaxTokens = true;
    }

    if (respuesta.stop_reason !== 'tool_use') break;

    const llamadasTool = respuesta.content.filter((b) => b.type === 'tool_use');
    if (!llamadasTool.length) break;

    const resultados = [];
    for (const llamada of llamadasTool) {
      console.log(`[claude] tool_use: ${llamada.name} ${JSON.stringify(llamada.input).slice(0, 200)}`);
      toolsLlamadas.push(llamada.name);
      try {
        const resultado = await ejecutarTool(llamada.name, llamada.input || {}, contexto);
        resultados.push({
          type: 'tool_result',
          tool_use_id: llamada.id,
          content: truncarToolResult(resultado),
        });
      } catch (err) {
        resultados.push({
          type: 'tool_result',
          tool_use_id: llamada.id,
          content: JSON.stringify({ ok: false, error: err.message }),
          is_error: true,
        });
      }
    }

    mensajes = [
      ...mensajes,
      { role: 'assistant', content: respuesta.content },
      { role: 'user', content: resultados },
    ];

    if (i === MAX_ITERACIONES_TOOL - 1) alcanzadoTope = true;
  }

  // I6: si salimos del bucle con la última respuesta siendo tool_use (loop
  // del modelo), hacemos una llamada final SIN tools para forzar texto.
  // El cliente nunca recibe "Disculpa, no he podido procesar...".
  if (respuesta.stop_reason === 'tool_use' && alcanzadoTope) {
    console.warn('[claude] Tope de iteraciones alcanzado; llamada final sin tools.');
    respuesta = await client.messages.create({
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        ...mensajes,
        { role: 'assistant', content: respuesta.content },
        { role: 'user', content: 'Por favor, resume en español lo que sabes hasta ahora y termina la respuesta sin usar más herramientas.' },
      ],
    });
    sumarUso(usoAcumulado, respuesta.usage);
  }

  let texto = respuesta.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (truncadoMaxTokens && texto) {
    texto += '\n\n[Respuesta truncada por longitud; pídeme la continuación si te interesa.]';
  }

  return { texto, uso: usoAcumulado, tools: toolsLlamadas };
}

function sumarUso(acumulado, u) {
  if (!u) return;
  acumulado.input_tokens += u.input_tokens || 0;
  acumulado.output_tokens += u.output_tokens || 0;
  acumulado.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  acumulado.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
}

module.exports = { generarRespuesta };
