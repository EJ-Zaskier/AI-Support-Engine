import { createOllamaProvider } from './ollama.js';
import { createOpenAICompatibleProvider } from './openaiCompatible.js';

export function createProvider(llmConfig) {
  const { provider, timeoutMs } = llmConfig;
  if (provider === 'ollama') {
    return createOllamaProvider({ ...llmConfig.ollama, timeoutMs });
  }
  if (provider === 'openai-compatible') {
    return createOpenAICompatibleProvider({ ...llmConfig.openai, timeoutMs });
  }
  throw new Error(`Proveedor no soportado: ${provider}`);
}
