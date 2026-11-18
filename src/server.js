import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';

const config = loadConfig();
const { app, provider } = createRuntime(config);

const server = app.listen(config.port, config.host, async () => {
  console.log(`AI Support Engine escuchando en http://localhost:${config.port}`);
  console.log(`Motor generativo: ${provider.name} (modelo ${provider.model})`);
  const health = await provider.health();
  if (!health.available) {
    console.warn(`Aviso: el motor generativo no está disponible -> ${health.reason}`);
  }
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
