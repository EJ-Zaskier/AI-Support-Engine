import { z } from 'zod';

// Contrato compartido por la API y por ambos motores.
export const CATEGORIES = Object.freeze(['ACCESS', 'BUG', 'FEATURE', 'SECURITY']);
export const PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const MODES = Object.freeze(['traditional', 'generative']);

export const MESSAGE_MIN_LENGTH = 3;
export const MESSAGE_MAX_LENGTH = 2000;
export const RESPONSE_MAX_LENGTH = 1200;

// Caracteres de control (excepto salto de línea y tabulador) que no aportan nada
// a una solicitud de soporte y pueden usarse para ofuscar ataques.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const priorityRank = (priority) => PRIORITIES.indexOf(priority);

// ---------- Entrada: POST /api/analyze ----------
export const AnalyzeRequestSchema = z
  .object({
    message: z
      .string({
        required_error: 'El campo "message" es obligatorio',
        invalid_type_error: 'El campo "message" debe ser texto',
      })
      .transform((value) => value.replace(CONTROL_CHARS, '').trim())
      .pipe(
        z
          .string()
          .min(MESSAGE_MIN_LENGTH, `El mensaje debe tener al menos ${MESSAGE_MIN_LENGTH} caracteres`)
          .max(MESSAGE_MAX_LENGTH, `El mensaje no puede superar ${MESSAGE_MAX_LENGTH} caracteres`),
      ),
    mode: z.enum(MODES, {
      errorMap: () => ({ message: 'El campo "mode" debe ser "traditional" o "generative"' }),
    }),
  })
  .strict('La petición contiene campos no permitidos');

// ---------- Salida: mismo contrato para ambos motores ----------
export const AnalysisResultSchema = z
  .object({
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES),
    response: z.string().trim().min(10).max(RESPONSE_MAX_LENGTH),
    requiresHumanReview: z.boolean(),
    mode: z.enum(MODES),
  })
  .strict();

// Lo que debe devolver el modelo generativo (el campo "mode" lo agrega el servidor).
export const ModelOutputSchema = AnalysisResultSchema.omit({ mode: true });

// El mismo esquema en formato JSON Schema: se envía al proveedor (Ollama "format")
// para que el modelo genere JSON con esta estructura.
export const MODEL_OUTPUT_JSON_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...CATEGORIES] },
    priority: { type: 'string', enum: [...PRIORITIES] },
    response: { type: 'string' },
    requiresHumanReview: { type: 'boolean' },
  },
  required: ['category', 'priority', 'response', 'requiresHumanReview'],
  additionalProperties: false,
});
