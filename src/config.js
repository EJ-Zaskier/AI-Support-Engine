import { fileURLToPath } from 'node:url';

// Configuración leída de variables de entorno (.env). Las credenciales nunca se
// escriben en el código: OPENAI_API_KEY solo existe en memoria y no se expone.
const SUPPORTED_PROVIDERS = ['ollama', 'openai-compatible'];

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const stripTrailingSlash = (url) => url.replace(/\/+$/, '');

export function loadConfig(env = process.env) {
  const provider = (env.LLM_PROVIDER ?? 'ollama').trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(
      `LLM_PROVIDER inválido: "${provider}". Valores permitidos: ${SUPPORTED_PROVIDERS.join(', ')}`,
    );
  }

  const config = {
    host: env.HOST ?? '127.0.0.1',
    port: toPositiveInt(env.PORT, 3000),
    rateLimitPerMinute: toPositiveInt(env.RATE_LIMIT_PER_MINUTE, 60),
    mlModelPath: env.ML_MODEL_PATH ?? fileURLToPath(new URL('../ml/model.json', import.meta.url)),
    llm: {
      provider,
      timeoutMs: toPositiveInt(env.LLM_TIMEOUT_MS, 60000),
      ollama: {
        baseUrl: stripTrailingSlash(env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'),
        model: env.OLLAMA_MODEL ?? 'qwen2.5:7b',
      },
      openai: {
        baseUrl: stripTrailingSlash(env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'),
        model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
        apiKey: env.OPENAI_API_KEY ?? '',
      },
    },
  };

  if (provider === 'openai-compatible' && !config.llm.openai.apiKey) {
    throw new Error('OPENAI_API_KEY no está configurada (requerida con LLM_PROVIDER=openai-compatible)');
  }

  return Object.freeze(config);
}
