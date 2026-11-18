import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { AnalysisResultSchema, AnalyzeRequestSchema } from './contract.js';
import { AppError } from './errors.js';
import { redactSecrets } from './security/guards.js';
import { applySafetyPolicy } from './security/policy.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const errorBody = (code, message, details) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

const safeLog = (value) => redactSecrets(JSON.stringify(value));

/**
 * Crea la aplicación Express.
 * @param {object} deps
 * @param {{traditional: {analyze: Function}, generative: {analyze: Function}}} deps.engines
 * @param {{name: string, model: string, health: Function}} [deps.provider]
 * @param {{rateLimitPerMinute: number}} deps.config
 */
export function createApp({ engines, provider, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.static(PUBLIC_DIR));
  app.use('/api', express.json({ limit: '10kb' }));

  app.get('/api/health', async (_req, res) => {
    const generative = provider ? await provider.health() : { available: false, reason: 'Sin proveedor' };
    res.json({
      status: 'ok',
      engines: {
        traditional: { available: true },
        generative: { provider: provider?.name, model: provider?.model, ...generative },
      },
    });
  });

  const analyzeLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json(errorBody('RATE_LIMITED', 'Demasiadas solicitudes. Intente de nuevo en un minuto.')),
  });

  app.post('/api/analyze', analyzeLimiter, async (req, res, next) => {
    if (!req.is('application/json')) {
      return res
        .status(415)
        .json(errorBody('UNSUPPORTED_MEDIA_TYPE', 'El Content-Type debe ser application/json'));
    }

    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      }));
      return res.status(400).json(errorBody('VALIDATION_ERROR', 'La solicitud no es válida', details));
    }

    const { message, mode } = parsed.data;
    const startedAt = performance.now();
    try {
      const { result, trace } = await engines[mode].analyze(message);
      const { result: guarded, reasons } = applySafetyPolicy(result, { message });
      // Ambos motores deben cumplir exactamente el mismo contrato de salida.
      const output = AnalysisResultSchema.parse(guarded);

      logger.info(
        safeLog({
          event: 'analyze',
          mode,
          category: output.category,
          priority: output.priority,
          requiresHumanReview: output.requiresHumanReview,
          policy: reasons,
          ms: Math.round(performance.now() - startedAt),
          chars: message.length,
          trace,
        }),
      );
      return res.json(output);
    } catch (error) {
      return next(error);
    }
  });

  app.all('/api/analyze', (_req, res) =>
    res.status(405).set('Allow', 'POST').json(errorBody('METHOD_NOT_ALLOWED', 'Use POST /api/analyze')),
  );

  app.use('/api', (_req, res) => res.status(404).json(errorBody('NOT_FOUND', 'Ruta no encontrada')));

  // Manejador central de errores: mensajes seguros al cliente, detalle solo en logs.
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json(errorBody('INVALID_JSON', 'El cuerpo de la petición no es JSON válido'));
    }
    if (error?.type === 'entity.too.large') {
      return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'El cuerpo de la petición supera 10 KB'));
    }
    if (error instanceof AppError) {
      logger.warn(
        safeLog({
          event: 'engine_error',
          code: error.code,
          message: error.message,
          details: error.details,
          cause: error.cause?.message,
        }),
      );
      return res.status(error.status).json(errorBody(error.code, error.message));
    }
    if (error instanceof ZodError) {
      logger.error(safeLog({ event: 'contract_violation', issues: error.issues }));
      return res
        .status(500)
        .json(errorBody('CONTRACT_VIOLATION', 'El motor produjo una respuesta fuera del contrato'));
    }
    if (error?.status >= 400 && error?.status < 500) {
      return res.status(error.status).json(errorBody('BAD_REQUEST', 'Petición inválida'));
    }
    logger.error(safeLog({ event: 'unhandled_error', message: error?.message }));
    return res.status(500).json(errorBody('INTERNAL_ERROR', 'Ocurrió un error interno. Intente de nuevo.'));
  });

  return app;
}
