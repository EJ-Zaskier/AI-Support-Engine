import { ProviderError, ProviderTimeoutError, ProviderUnavailableError } from '../errors.js';

/**
 * Proveedor para cualquier API compatible con OpenAI Chat Completions
 * (OpenAI, Groq, Gemini, LM Studio...). La API key se lee de OPENAI_API_KEY
 * y solo viaja en la cabecera Authorization: nunca se registra ni se devuelve.
 */
export function createOpenAICompatibleProvider({ baseUrl, model, apiKey, timeoutMs, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');

  async function request(path, init, timeout = timeoutMs) {
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new ProviderTimeoutError(`El proveedor no respondió en ${timeout} ms`, { cause: error });
      }
      throw new ProviderUnavailableError('No se pudo conectar con el proveedor de IA', { cause: error });
    }
  }

  return {
    name: 'openai-compatible',
    model,

    async complete({ system, user }) {
      const res = await request('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 512,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });

      if (res.status === 401 || res.status === 403) {
        // No se incluye la key ni el cuerpo de la respuesta en el error.
        throw new ProviderError('El proveedor rechazó las credenciales configuradas', {
          status: 502,
          code: 'MODEL_AUTH_ERROR',
        });
      }
      if (res.status === 429) {
        throw new ProviderUnavailableError('El proveedor de IA alcanzó su límite de uso. Intente más tarde.');
      }
      if (!res.ok) {
        throw new ProviderError(`El proveedor respondió HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => null);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new ProviderError('El proveedor devolvió una respuesta sin contenido');
      return content;
    },

    async health() {
      try {
        const res = await request('/models', { method: 'GET', headers: {} }, 5000);
        return res.ok ? { available: true } : { available: false, reason: `HTTP ${res.status}` };
      } catch (error) {
        return { available: false, reason: error.message };
      }
    },
  };
}
