// Re-indexa toda la base documental legal de cero.
// Útil si has cambiado BASE_LEGAL_PATH o has movido muchos archivos.
// Ejecuta:  npm run indexar

const { reindexar } = require('../src/baseLegal');

(async () => {
  const r = await reindexar({ forzar: true });
  console.log('Resultado:', r);
  process.exit(r.ok ? 0 : 1);
})();
