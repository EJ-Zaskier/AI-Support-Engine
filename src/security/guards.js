// Detectores deterministas compartidos por ambos motores.
// No usan IA: son reglas para (1) detectar intentos de manipulación del sistema,
// (2) detectar señales de incidentes de seguridad y (3) ocultar secretos en logs.

/** Minúsculas, sin acentos y con espacios normalizados (para comparar con reglas). */
export function normalizeText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Intentos de "prompt injection": instrucciones dirigidas al sistema en lugar de
// describir un problema de soporte.
const INJECTION_PATTERNS = [
  { id: 'ignore-instructions-es', pattern: /\b(ignora|olvida|omite|descarta|salta)\w*\b.{0,40}\b(instrucciones|reglas|indicaciones|prompt|restricciones)\b/ },
  { id: 'ignore-instructions-en', pattern: /\b(ignore|disregard|forget|bypass)\b.{0,40}\b(instructions|rules|prompt|above|previous)\b/ },
  { id: 'dictated-classification', pattern: /\b(clasifica|marca|categoriza|asigna|pon|responde|devuelve|classify|mark|set)\w*\b.{0,60}\b(como|con|as|to)\b.{0,30}\b(prioridad|categoria|category|priority|low|baja|minima|feature|access|bug|security)\b/ },
  { id: 'field-assignment', pattern: /\b(category|priority|categoria|prioridad|requireshumanreview)\s*[:=]\s*["']?\w+/ },
  { id: 'mode-switch', pattern: /\b(modo|mode)\s+(desarrollador|developer|mantenimiento|maintenance|dios|god|dan|debug|administrador)\b/ },
  { id: 'reveal-secrets', pattern: /\b(revela\w*|muestra\w*|dime|imprime|reveal|show|print|leak)\b.{0,40}\b(prompt|instrucciones|system|api ?keys?|credenciales|secretos?|tokens?|configuracion)\b/ },
  { id: 'role-play', pattern: /\b(actua como|act as|pretend|finge que|a partir de ahora eres|from now on you are)\b/ },
  { id: 'delimiter-breakout', pattern: /<\/?\s*(solicitud|system|instrucciones|instructions)\s*>/ },
];

// Encabezados falsos tipo "SYSTEM:" al inicio de una línea u oración.
// Se evalúa sobre el texto original porque necesita los saltos de línea.
const FAKE_ROLE_HEADER = /(^|[\n.!?]\s*)(system|sistema|assistant|asistente|developer|admin)\s*:/i;

// Señales de posibles incidentes o vulnerabilidades de seguridad.
const SECURITY_SIGNAL_PATTERNS = [
  { id: 'vulnerability', pattern: /\bvulnerab\w*/ },
  { id: 'hacked', pattern: /\b(hacke\w*|hack(ed|eo|ers?)?)\b/ },
  { id: 'injection', pattern: /\b(inyeccion|injection|sqli|xss|csrf|rce)\b/ },
  { id: 'phishing', pattern: /\b(phishing|suplanta\w*)\b/ },
  { id: 'malware', pattern: /\b(malware|ransomware|troyano|virus)\b/ },
  { id: 'data-leak', pattern: /\b(filtra(cion|ron|do|da)|fuga de (datos|informacion)|leak\w*|brecha|breach|exfiltr\w*)\b/ },
  { id: 'unauthorized-access', pattern: /\b(acceso no autorizado|sin (mi )?autorizacion|unauthorized|intrus\w*)\b/ },
  { id: 'account-takeover', pattern: /\b(me robaron|robo de (cuenta|identidad|datos)|cuenta (comprometida|robada|hackeada))\b/ },
  { id: 'fraud', pattern: /\b(fraude|cargos? no reconocidos?|compras? (no autorizadas?|que no hice))\b/ },
  { id: 'attack', pattern: /\b(ataque|attack|ddos|fuerza bruta|brute ?force|exploit\w*)\b/ },
  { id: 'other-users-data', pattern: /\b(datos|facturas|informacion|cuentas|pedidos) de otros (usuarios|clientes)\b/ },
  { id: 'plaintext-secrets', pattern: /\b(contrasenas?|passwords?) en texto plano\b/ },
  { id: 'privilege-escalation', pattern: /\b(cve-\d{4}-\d+|escalamiento de privilegios|privilege escalation)\b/ },
];

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic
  /\bgsk_[A-Za-z0-9]{20,}\b/g, // Groq
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b(password|contrase(?:ñ|n)a|pwd|api[_-]?key|token|secret)\s*[:=]\s*\S+/gi,
];

const matchAll = (normalized, rules) =>
  rules.filter(({ pattern }) => pattern.test(normalized)).map(({ id }) => id);

/** Devuelve { suspected, matches } con los patrones de manipulación encontrados. */
export function detectPromptInjection(text) {
  const matches = matchAll(normalizeText(text), INJECTION_PATTERNS);
  if (FAKE_ROLE_HEADER.test(String(text))) matches.push('fake-role-header');
  return { suspected: matches.length > 0, matches };
}

/** Lista de identificadores de señales de seguridad presentes en el texto. */
export function detectSecuritySignals(text) {
  return matchAll(normalizeText(text), SECURITY_SIGNAL_PATTERNS);
}

/** Reemplaza posibles credenciales por [REDACTED] (para logs y respuestas). */
export function redactSecrets(text) {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[REDACTED]'), String(text));
}
