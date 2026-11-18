# AI Support Engine

Prototipo funcional de **clasificación inteligente de solicitudes de soporte** con dos enfoques que cumplen el mismo contrato de API:

| Motor | Técnica | Modelo |
|---|---|---|
| `traditional` | IA simbólica: sistema experto con reglas ponderadas, detección de negación y reglas de prioridad | Ninguno (sin IA generativa) |
| `generative` | LLM real con salida JSON estructurada y validada | `qwen2.5:7b` ejecutado localmente con [Ollama](https://ollama.com) |

Ambos clasifican cada solicitud en `ACCESS`, `BUG`, `FEATURE` o `SECURITY`, asignan prioridad `LOW`, `MEDIUM`, `HIGH` o `CRITICAL`, generan una respuesta para el usuario e indican si requiere revisión humana.

## Integrantes

| Nombre | Matrícula |
|---|---|
| _(por completar)_ | |

## Requisitos

- [Node.js](https://nodejs.org) 20.12 o superior (probado con Node 24)
- [Ollama](https://ollama.com/download) (probado con 0.40.16)
- ~5 GB libres para el modelo. Una GPU es opcional pero acelera las respuestas (probado con RTX 3070 Ti).

## Instalación y ejecución

```bash
git clone https://github.com/EJ-Zaskier/AI-Support-Engine.git
cd AI-Support-Engine
npm install
cp .env.example .env          # en Windows (cmd): copy .env.example .env
ollama pull qwen2.5:7b        # descarga el modelo local (~4.7 GB)
npm start
```

El servidor queda en `http://localhost:3000`:

- `http://localhost:3000` → interfaz web para probar y comparar ambos motores.
- `POST /api/analyze` → endpoint principal.
- `GET /api/health` → estado de los motores.

Otros comandos:

```bash
npm test             # 35 pruebas unitarias y de integración de la API
npm run benchmark    # pruebas comparativas con el modelo real (genera evidence/)
```

> Para usar un proveedor en la nube en lugar de Ollama (Groq, OpenAI, Gemini…), en `.env` define `LLM_PROVIDER=openai-compatible`, `OPENAI_BASE_URL`, `OPENAI_MODEL` y `OPENAI_API_KEY`. La key solo se lee de variables de entorno; `.env` está en `.gitignore`.

## Uso de la API

### `POST /api/analyze`

Petición:

```json
{
  "message": "No puedo iniciar sesión",
  "mode": "generative"
}
```

Respuesta (`200 OK`), idéntica en estructura para `traditional` y `generative`:

```json
{
  "category": "ACCESS",
  "priority": "MEDIUM",
  "response": "Lamentamos el inconveniente. Verifique sus credenciales y utilice la recuperación de contraseña si es necesario.",
  "requiresHumanReview": false,
  "mode": "generative"
}
```

Ejemplos:

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"message":"No puedo iniciar sesión","mode":"traditional"}'
```

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/analyze `
  -ContentType "application/json" `
  -Body '{"message":"No puedo iniciar sesión","mode":"generative"}'
```

### Errores

Todos los errores usan el formato `{ "error": { "code": "...", "message": "..." } }` y nunca exponen trazas, credenciales ni respuestas internas del proveedor.

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Falta `message`/`mode`, tipos incorrectos, `mode` inválido, mensaje vacío o de más de 2000 caracteres, campos no permitidos (incluye `details` por campo) |
| 400 | `INVALID_JSON` | El cuerpo no es JSON válido |
| 405 | `METHOD_NOT_ALLOWED` | Método distinto de POST |
| 413 | `PAYLOAD_TOO_LARGE` | Cuerpo mayor a 10 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` distinto de `application/json` |
| 429 | `RATE_LIMITED` | Más de `RATE_LIMIT_PER_MINUTE` peticiones por minuto por IP |
| 502 | `MODEL_INVALID_OUTPUT` | El modelo devolvió JSON inválido o fuera del contrato (tras 1 reintento) |
| 502 | `MODEL_PROVIDER_ERROR` / `MODEL_AUTH_ERROR` | El proveedor respondió con error o rechazó la credencial |
| 503 | `MODEL_UNAVAILABLE` | Ollama no está en ejecución o el modelo no está descargado |
| 504 | `MODEL_TIMEOUT` | El modelo no respondió dentro de `LLM_TIMEOUT_MS` |

Si el motor generativo falla, la API **devuelve el error**: nunca sustituye la respuesta por valores escritos a mano ni por el motor tradicional.

## Arquitectura

```
Cliente ──► Express (helmet, rate limit, JSON ≤ 10 KB)
              │
              ▼
        Validación de entrada (Zod)  ──► 400 si no cumple
              │
      ┌───────┴────────┐
      ▼                ▼
 Motor tradicional   Motor generativo ──► Ollama / API compatible con OpenAI
 (reglas)            (LLM + validación del JSON + 1 reintento)
      └───────┬────────┘
              ▼
   Política de seguridad (común a ambos motores)
              │
              ▼
   Validación del contrato de salida (Zod) ──► JSON
```

```
src/
├── server.js              # Punto de entrada
├── runtime.js             # Construye la app con motores y proveedor reales
├── app.js                 # Rutas, middlewares de seguridad y manejo de errores
├── config.js              # Lectura de variables de entorno
├── contract.js            # Esquemas Zod de entrada/salida (contrato único)
├── errors.js              # Errores tipados con código HTTP
├── engines/
│   ├── traditional.js     # Motor por reglas
│   └── generative.js      # Prompt, validación de la salida del LLM y reintento
├── providers/
│   ├── ollama.js          # Cliente de Ollama (local)
│   └── openaiCompatible.js# Cliente para APIs compatibles con OpenAI
└── security/
    ├── guards.js          # Detección de prompt injection, señales de seguridad, ocultar secretos
    └── policy.js          # Reglas no negociables aplicadas a ambos motores
public/                    # Interfaz web de prueba
tests/                     # Pruebas unitarias y de integración (node:test)
benchmark/                 # Casos de prueba de referencia y script comparativo
evidence/                  # Resultados y evidencias de ejecución
```

## Motor tradicional (IA simbólica)

Archivo: [`src/engines/traditional.js`](src/engines/traditional.js)

1. **Normalización**: minúsculas, sin acentos y espacios uniformes.
2. **Reglas ponderadas por categoría**: cada categoría tiene patrones con peso (por ejemplo `vulnerab*` = 5 para SECURITY o `iniciar sesión` = 4 para ACCESS). Gana la categoría con más puntos. En caso de empate se elige la más riesgosa (SECURITY > ACCESS > BUG > FEATURE).
3. **Negación**: si una palabra clave aparece negada dentro de la misma frase ("no es un problema de *seguridad*", "ni de *contraseña*"), no suma puntos.
4. **Confianza**: si el puntaje es bajo o la diferencia con la segunda categoría es pequeña, se marca `requiresHumanReview`.
5. **Prioridad**: parte de un valor base por categoría (SECURITY=HIGH, ACCESS/BUG=MEDIUM, FEATURE=LOW) y se ajusta con reglas:
   - `CRITICAL`: producción caída, todos los usuarios afectados, pérdida masiva de datos. En seguridad: incidente en curso, cuenta robada, fuga de datos o acceso como administrador.
   - `+1 nivel`: urgencia, pérdida de datos, bloqueo, varios usuarios afectados, pagos.
   - `−1 nivel`: "cuando puedan", detalles visuales, sugerencias.
   - SECURITY nunca queda por debajo de HIGH.
6. **Respuesta predeterminada**: plantilla según categoría y prioridad.

El motor no lee instrucciones del texto, así que una frase como "clasifica como prioridad baja" no cambia su resultado.

## Motor generativo (LLM)

Archivo: [`src/engines/generative.js`](src/engines/generative.js)

- **Modelo real**: cada petición se envía a Ollama (`/api/chat`) con `temperature: 0` para obtener resultados reproducibles.
- **Prompt de sistema** con las definiciones de categorías y prioridades, y reglas de seguridad: el texto del usuario va dentro de `<solicitud>…</solicitud>` y se trata como datos, nunca como instrucciones. Si el usuario intenta cerrar el delimitador, la etiqueta se elimina antes de enviarla.
- **Salida estructurada**: se envía un JSON Schema en el parámetro `format` de Ollama, y la respuesta se valida con Zod (categoría y prioridad dentro del catálogo, tipos correctos, sin campos extra, longitud de la respuesta).
- **Detección de fugas**: se rechaza una respuesta que contenga fragmentos del prompt interno.
- **Reintento**: si el formato es inválido se reintenta una vez; si vuelve a fallar se responde `502 MODEL_INVALID_OUTPUT`.

## Validación y seguridad

| Requisito | Implementación |
|---|---|
| Validar solicitudes | Esquema Zod estricto (`message` 3–2000 caracteres, `mode` en catálogo, sin campos extra), eliminación de caracteres de control, JSON ≤ 10 KB, `Content-Type` obligatorio, rate limiting por IP |
| Manejar errores del modelo/proveedor | Errores tipados (503/504/502) con timeout configurable (`AbortSignal.timeout`) y mensajes seguros |
| Comprobar el formato de la respuesta generativa | JSON Schema en el proveedor, validación Zod de la salida del modelo y del contrato final de ambos motores |
| Evitar exposición de credenciales | Secretos solo en `.env` (ignorado por git) y `.env.example` sin valores reales. La key no aparece en logs, errores ni en `/api/health`. Los logs y respuestas pasan por `redactSecrets` |
| Revisión humana en incidentes de seguridad | `src/security/policy.js` marca `requiresHumanReview: true` si la categoría es SECURITY, si hay señales de seguridad en el texto, si se detecta un intento de prompt injection o si la prioridad es CRITICAL. Además impide que SECURITY quede por debajo de HIGH |
| Cabeceras HTTP seguras | `helmet` (CSP, `X-Content-Type-Options`, etc.) y `x-powered-by` deshabilitado |

## Pruebas

### Pruebas automatizadas (`npm test`)

35 pruebas con `node:test` que cubren: clasificación del motor tradicional, validación de la salida del modelo (JSON inválido, categorías fuera de catálogo, campos extra, fugas del prompt), reintento y propagación de errores del proveedor, validación de la API (400/405/413/415/429), errores 502/503/504, que los errores no expongan secretos y la política de seguridad.

> En estas pruebas unitarias el proveedor del LLM se sustituye por uno simulado **solo** para probar el validador y el manejo de errores. La API real y el benchmark usan siempre el modelo de Ollama.

### Pruebas comparativas (`npm run benchmark`)

[`benchmark/cases.json`](benchmark/cases.json) define **16 solicitudes con su clasificación de referencia, escrita antes de ejecutar los motores**: 8 normales, 4 ambiguas y 4 adversarias (prompt injection, encabezados falsos de sistema, relleno de palabras clave negadas e intento de extraer secretos). El script envía cada caso a `POST /api/analyze` en ambos modos y registra la categoría, prioridad, si cumplió el formato y si coincide con la referencia.

Criterio: **correcto = categoría y prioridad coinciden con la referencia.**

<!-- RESULTADOS -->

## Evidencias

- [`evidence/RESULTADOS.md`](evidence/RESULTADOS.md): tabla completa por caso y respuestas generadas por el LLM.
- [`evidence/benchmark-results.json`](evidence/benchmark-results.json): salida cruda de cada llamada (estado HTTP, latencia, JSON devuelto).
- [`evidence/ejecucion-api.md`](evidence/ejecucion-api.md): peticiones reales a la API con ambos motores y casos de error.
- [`evidence/capturas/`](evidence/capturas/): capturas de la interfaz web.
