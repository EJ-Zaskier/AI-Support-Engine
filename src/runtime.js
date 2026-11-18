import { createApp } from './app.js';
import { createGenerativeEngine } from './engines/generative.js';
import { createTraditionalEngine } from './engines/traditional.js';
import { createProvider } from './providers/index.js';

/** Construye la app con los motores y el proveedor reales según la configuración. */
export function createRuntime(config, { logger = console } = {}) {
  const provider = createProvider(config.llm);
  const engines = {
    traditional: createTraditionalEngine(),
    generative: createGenerativeEngine({ provider }),
  };
  const app = createApp({ engines, provider, config, logger });
  return { app, provider, engines };
}
