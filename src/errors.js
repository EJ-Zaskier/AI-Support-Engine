// Errores de la aplicación con un código estable y un mensaje seguro para el cliente.
// Los detalles internos (causa, respuesta cruda del proveedor) solo van a los logs.
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(message = 'El proveedor de IA generativa no está disponible', options = {}) {
    super(message, { status: 503, code: 'MODEL_UNAVAILABLE', ...options });
  }
}

export class ProviderTimeoutError extends AppError {
  constructor(message = 'El modelo tardó demasiado en responder', options = {}) {
    super(message, { status: 504, code: 'MODEL_TIMEOUT', ...options });
  }
}

export class ProviderError extends AppError {
  constructor(message = 'El proveedor de IA generativa devolvió un error', options = {}) {
    super(message, { status: 502, code: 'MODEL_PROVIDER_ERROR', ...options });
  }
}

export class MlModelUnavailableError extends AppError {
  constructor(message = 'El modelo de Machine Learning no está entrenado. Ejecuta: python ml/train.py', options = {}) {
    super(message, { status: 503, code: 'ML_MODEL_UNAVAILABLE', ...options });
  }
}

export class ModelOutputError extends AppError {
  constructor(message = 'El modelo devolvió una respuesta con formato inválido', options = {}) {
    super(message, { status: 502, code: 'MODEL_INVALID_OUTPUT', ...options });
  }
}
