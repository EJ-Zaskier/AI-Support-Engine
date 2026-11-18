import { ProviderError, ProviderTimeoutError, ProviderUnavailableError } from '../errors.js';

/**
 * Proveedor local con Ollama (https://ollama.com). No requiere API key.
 * Usa "format" con JSON Schema para que el modelo genere salida estructurada.
 */
export function createOllamaProvider({ baseUrl, model, timeoutMs, fetchImpl = fetch }) {
  async function request(path, init, timeout = timeoutMs) {
    try {
      return await fetchImpl(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new ProviderTimeoutError(`Ollama no respondió en ${timeout} ms`, { cause: error });
      }
      throw new ProviderUnavailableError(
        'No se pudo conectar con Ollama. Verifica que esté instalado y en ejecución.',
        { cause: error },
      );
    }
  }

  return {
    name: 'ollama',
    model,

    async complete({ system, user, jsonSchema }) {
      const res = await request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: jsonSchema,
          options: { temperature: 0, num_predict: 512 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });

      if (res.status === 404) {
        throw new ProviderUnavailableError(
          `El modelo "${model}" no está descargado en Ollama. Ejecuta: ollama pull ${model}`,
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ProviderError(`Ollama respondió HTTP ${res.status}`, { details: body.slice(0, 300) });
      }

      const data = await res.json().catch(() => null);
      const content = data?.message?.content;
      if (typeof content !== 'string') {
        throw new ProviderError('Ollama devolvió una respuesta sin contenido');
      }
      return content;
    },

    async health() {
      try {
        const res = await request('/api/tags', { method: 'GET' }, 3000);
        if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
        const data = await res.json();
        const installed = (data.models ?? []).map((m) => m.name);
        const modelReady = installed.some((name) => name === model || name === `${model}:latest`);
        return modelReady
          ? { available: true }
          : { available: false, reason: `Modelo "${model}" no descargado (ollama pull ${model})` };
      } catch (error) {
        return { available: false, reason: error.message };
      }
    },
  };
}
