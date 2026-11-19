const path = require('path');
const config = require('./config');
const { listarHuecos, crearCita } = require('./calendario');
const { notificarDerivacion } = require('./notifications');
const baseLegal = require('./baseLegal');
const documentos = require('./documentos');
const audit = require('./audit');

const TOOL_CALENDARIO = [
  {
    name: 'consultar_huecos_calendario',
    description:
      'Consulta los huecos libres en la agenda del despacho para proponer al cliente cuándo puede venir a consulta. Devuelve una lista de huecos (inicio/fin en ISO 8601) de duración igual a la cita estándar del despacho. Úsalo cuando el cliente quiera agendar una cita o pregunte por disponibilidad.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha/hora ISO 8601 desde la que buscar.' },
        hasta: { type: 'string', description: 'Fecha/hora ISO 8601 hasta la que buscar (por defecto +7 días).' },
      },
    },
  },
  {
    name: 'agendar_cita',
    description:
      'Crea una cita en el calendario del despacho. SÓLO invocar cuando el cliente ha confirmado explícitamente el día y hora propuestos, y ha facilitado al menos su nombre y asunto.',
    input_schema: {
      type: 'object',
      properties: {
        inicio: { type: 'string', description: 'Inicio en ISO 8601.' },
        duracion_minutos: { type: 'number', description: `Por defecto ${config.duracionCitaMinutos}.` },
        nombre_cliente: { type: 'string', description: 'Nombre completo.' },
        telefono: { type: 'string', description: 'Si no lo facilita, usa el del propio chat.' },
        asunto: { type: 'string', description: 'Resumen breve (1 frase).' },
      },
      required: ['inicio', 'nombre_cliente', 'asunto'],
    },
  },
];

const TOOL_DERIVAR = {
  name: 'derivar_al_abogado',
  description:
    `Notifica al abogado humano del despacho (${config.abogadoNombre}) que un caso necesita su atención. Úsalo cuando: ` +
    `(a) el cliente lo pide expresamente, (b) hay un plazo legal a punto de vencer, (c) es un asunto penal grave / menores / violencia / detención, (d) el cliente quiere contratar o pedir presupuesto, ` +
    `(e) el caso ya tiene suficiente información para que un humano se haga cargo. Tras invocarla, comunica con naturalidad al cliente que el abogado se va a poner en contacto.`,
  input_schema: {
    type: 'object',
    properties: {
      motivo: { type: 'string', description: 'Etiqueta corta del motivo.' },
      resumen_caso: { type: 'string', description: 'Resumen 3-6 frases para el abogado.' },
      urgencia: { type: 'string', enum: ['alta', 'media', 'baja'] },
    },
    required: ['motivo', 'resumen_caso', 'urgencia'],
  },
};

const TOOL_BASE_LEGAL = [
  {
    name: 'buscar_en_base_legal',
    description:
      'Busca documentos en la base documental archivada del despacho. Útil cuando el cliente pregunta algo sobre un cliente, expediente o normativa archivada. Devuelve los documentos más relevantes con un extracto.',
    input_schema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Palabras clave concretas en español.' },
        max_resultados: { type: 'number', description: 'Máx 10. Por defecto 5.' },
      },
      required: ['consulta'],
    },
  },
  {
    name: 'leer_documento_base_legal',
    description: 'Lee el contenido (paginado) de un documento de la base legal. Usar tras buscar_en_base_legal.',
    input_schema: {
      type: 'object',
      properties: {
        ruta: { type: 'string', description: 'Ruta que devolvió buscar_en_base_legal.' },
        parte: { type: 'number', description: 'Número de fragmento (1 por defecto).' },
      },
      required: ['ruta'],
    },
  },
];

const TOOL_DOCUMENTOS = [
  {
    name: 'crear_documento',
    description:
      'Crea un documento Word (.docx) a partir de contenido en Markdown. Se guarda en local en ' +
      '`data/creado-por-whatsapp/<contacto>/<timestamp>__<titulo>/documento.docx`. ' +
      'Úsalo cuando el cliente pida redactar un documento (contrato, demanda, recurso, dictamen, carta, escrito, modelo, formulario, etc.). ' +
      'Antes de invocarla debes tener: el tipo de documento, los datos esenciales (partes, objeto, fechas) y el contenido completo redactado por ti. ' +
      'Si te faltan datos, NO invoques esta tool: primero pregúntale al cliente lo que falte (de uno en uno) y, una vez tengas todo, redacta el documento Markdown completo (con cabeceras, "EXPONE", "ESTIPULACIONES", firmas, etc. como corresponda) y entonces invoca la tool. ' +
      'Devuelve un `documento_id` que se usa después para exportar a PDF o reenviárselo al cliente.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título descriptivo (ej. "Contrato de arrendamiento - García/López").' },
        tipo: {
          type: 'string',
          description: 'Tipo de documento (contrato, demanda, recurso, dictamen, carta, requerimiento, etc.).',
        },
        contenido_markdown: {
          type: 'string',
          description:
            'Texto completo del documento en Markdown. Usa # para el título principal, ## para secciones, listas, negritas, etc. Debe estar listo para ser el documento final.',
        },
        cliente_nombre: { type: 'string', description: 'Nombre del cliente, si lo conoces.' },
      },
      required: ['titulo', 'contenido_markdown'],
    },
  },
  {
    name: 'exportar_pdf_documento',
    description:
      'Exporta a PDF un documento previamente creado con `crear_documento`. El PDF es la versión final y queda guardado junto al .docx. Úsalo cuando el cliente diga "exporta a pdf", "pásalo a pdf", "dame el pdf" o equivalente.',
    input_schema: {
      type: 'object',
      properties: {
        documento_id: {
          type: 'string',
          description: 'El identificador devuelto por crear_documento. Si el cliente sólo dice "exporta el último", usa `listar_documentos_creados` primero.',
        },
      },
      required: ['documento_id'],
    },
  },
  {
    name: 'listar_documentos_creados',
    description:
      'Lista los documentos ya creados para este cliente (o para uno concreto si pasas el teléfono). Útil cuando el cliente dice "el contrato de antes", "exporta el último", o quieres comprobar si ya redactaste algo.',
    input_schema: {
      type: 'object',
      properties: {
        max: { type: 'number', description: 'Máximo de resultados.' },
        sólo_este_cliente: {
          type: 'boolean',
          description: 'Si true (por defecto), filtra por el contacto actual de WhatsApp.',
        },
      },
    },
  },
  {
    name: 'enviar_documento_al_cliente',
    description:
      'Envía al cliente por WhatsApp un documento que ya has creado. Pregúntale antes en qué formato lo quiere (Word para editarlo, PDF para versión final). El bot se lo manda como adjunto al chat actual.',
    input_schema: {
      type: 'object',
      properties: {
        documento_id: { type: 'string' },
        formato: { type: 'string', enum: ['docx', 'pdf'], description: 'docx (editable) o pdf (final).' },
      },
      required: ['documento_id', 'formato'],
    },
  },
];

function getToolsDisponibles() {
  const tools = [];
  if (config.calendarioDisponible) tools.push(...TOOL_CALENDARIO);
  tools.push(TOOL_DERIVAR);
  if (config.baseLegalDisponible) tools.push(...TOOL_BASE_LEGAL);
  tools.push(...TOOL_DOCUMENTOS);
  return tools;
}

async function ejecutarTool(nombre, input, contexto = {}) {
  switch (nombre) {
    case 'consultar_huecos_calendario':
      return await listarHuecos({ desde: input.desde, hasta: input.hasta });

    case 'agendar_cita':
      return await crearCita({
        inicio: input.inicio,
        duracionMinutos: input.duracion_minutos,
        nombreCliente: input.nombre_cliente,
        telefono: input.telefono || contexto.telefonoChat,
        asunto: input.asunto,
      });

    case 'derivar_al_abogado': {
      const r = await notificarDerivacion({
        motivo: input.motivo,
        resumen: input.resumen_caso,
        urgencia: input.urgencia,
        telefono: contexto.telefonoChat,
        nombreCliente: contexto.nombreChat,
        chatId: contexto.chatId,
      });
      audit.registrar({
        tipo: 'derivacion',
        tel: contexto.telefonoChat,
        nombre: contexto.nombreChat,
        motivo: input.motivo,
        urgencia: input.urgencia,
        resumen: input.resumen_caso,
      });
      return { ok: true, ...r };
    }

    case 'buscar_en_base_legal': {
      const max = Math.min(input.max_resultados || 5, 10);
      const resultados = baseLegal.buscarDocumentos(input.consulta, max);
      return { ok: true, total: resultados.length, resultados };
    }

    case 'leer_documento_base_legal':
      return baseLegal.leerDocumento(input.ruta, input.parte || 1);

    case 'crear_documento': {
      const r = await documentos.crearDocumento({
        titulo: input.titulo,
        tipo: input.tipo,
        contenido_markdown: input.contenido_markdown,
        cliente_nombre: input.cliente_nombre || contexto.nombreChat,
        cliente_telefono: contexto.telefonoChat,
        origen: contexto.origen,
      });
      if (r.ok) {
        audit.registrar({
          tipo: 'documento_creado',
          tel: contexto.telefonoChat,
          nombre: contexto.nombreChat,
          documento_id: r.documento_id,
          titulo: input.titulo,
          tipoDoc: input.tipo,
        });
      }
      return r;
    }

    case 'exportar_pdf_documento': {
      const r = await documentos.exportarPdf({ documento_id: input.documento_id });
      if (r.ok) {
        audit.registrar({
          tipo: 'documento_exportado_pdf',
          tel: contexto.telefonoChat,
          documento_id: r.documento_id,
        });
      }
      return r;
    }

    case 'listar_documentos_creados': {
      const filtro = input.sólo_este_cliente === false ? {} : { cliente_telefono: contexto.telefonoChat };
      return documentos.listarDocumentos({ ...filtro, max: input.max || 10 });
    }

    case 'enviar_documento_al_cliente': {
      if (!contexto.whatsappClient || !contexto.chatId) {
        return { ok: false, error: 'No tengo acceso al cliente de WhatsApp para enviar el archivo.' };
      }
      const formato = input.formato;
      const rutaArchivo = documentos.getDocumentoArchivo(input.documento_id, `documento.${formato}`);
      if (!rutaArchivo) {
        return {
          ok: false,
          error: `Archivo no encontrado para ese documento_id / formato. Comprueba con listar_documentos_creados.`,
        };
      }
      try {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = MessageMedia.fromFilePath(rutaArchivo);
        const info = documentos.getDocumentoMeta(input.documento_id);
        const nombreLimpio = (info?.meta?.titulo || 'documento').replace(/[^a-zA-Z0-9_-\s]/g, '').trim();
        media.filename = `${nombreLimpio || 'documento'}.${formato}`;
        await contexto.whatsappClient.sendMessage(contexto.chatId, media, {
          caption: `Aquí tienes el documento en formato ${formato.toUpperCase()}.`,
        });
        audit.registrar({
          tipo: 'documento_enviado',
          tel: contexto.telefonoChat,
          documento_id: input.documento_id,
          formato,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `No se pudo enviar: ${err.message}` };
      }
    }

    default:
      return { ok: false, error: `Tool desconocida: ${nombre}` };
  }
}

module.exports = { getToolsDisponibles, ejecutarTool };
