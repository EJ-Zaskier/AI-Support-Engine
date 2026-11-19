import { PRIORITIES, priorityRank } from '../contract.js';
import { normalizeText } from '../security/guards.js';
import { pickResponse } from './responses.js';

/*
 * Motor tradicional (IA simbólica / sistema experto basado en reglas).
 *
 * 1. Normaliza el texto (minúsculas, sin acentos).
 * 2. Cada categoría tiene reglas con peso: patrones de palabras clave.
 *    Si una palabra clave aparece negada ("no es un problema de seguridad"),
 *    la regla no suma.
 * 3. Gana la categoría con más puntos (empate: SECURITY > ACCESS > BUG > FEATURE,
 *    priorizando el caso más riesgoso).
 * 4. La prioridad parte de un valor base por categoría y se ajusta con reglas de
 *    impacto (crítico, alto, bajo).
 * 5. La respuesta es una plantilla predeterminada según categoría y prioridad.
 *
 * No usa ningún modelo generativo.
 */

const rule = (id, pattern, weight) => ({ id, weight, regex: new RegExp(pattern.source, 'g') });

const CATEGORY_RULES = {
  SECURITY: [
    rule('vulnerability', /\bvulnerab\w*/, 5),
    rule('hacked', /\b(hacke\w*|hack(ed|eo|ers?)?)\b/, 5),
    rule('injection', /\b(inyeccion|injection|sqli|xss|csrf|rce)\b/, 5),
    rule('phishing', /\b(phishing|suplanta\w*|correo (raro|sospechoso|falso|fraudulento))\b/, 4),
    rule('credential-request', /\b(pidiendo|piden|pidiendome|solicitando) (mi|tu|su|mis|sus) (contrasena|password|clave|datos)\b/, 4),
    rule('malware', /\b(malware|ransomware|troyano|virus)\b/, 5),
    rule('data-leak', /\b(filtra(cion|ron|do|da)|fuga de (datos|informacion)|leak\w*|brecha|breach|exfiltr\w*)\b/, 5),
    rule('unauthorized-access', /\b(acceso no autorizado|unauthorized|intrus\w*|accedio a la base de datos)\b/, 5),
    rule('account-takeover', /\b(me robaron|robo de (cuenta|identidad|datos)|cuenta (comprometida|robada|hackeada))\b/, 6),
    rule('fraud', /\b(fraude|cargos? no reconocidos?|compras? (no autorizadas?|que no hice))\b/, 4),
    rule('attack', /\b(ataque|attack|ddos|fuerza bruta|brute ?force|exploit\w*)\b/, 4),
    rule('other-users-data', /\b(datos|facturas|informacion|cuentas|pedidos) de otros (usuarios|clientes)\b/, 5),
    rule('security-word', /\b(seguridad|security|cifrado|encryption|texto plano|plain ?text)\b/, 2),
    rule('privilege-escalation', /\b(cve-\d{4}-\d+|escalamiento de privilegios|privilege escalation)\b/, 6),
  ],
  ACCESS: [
    rule('login', /\b(iniciar sesion|inicio de sesion|log ?in|sign ?in|loguearme|logearme)\b/, 4),
    rule('password', /\b(contrasena|password|clave)\b/, 3),
    rule('cannot-enter', /\b(no puedo|no me deja|imposible) (entrar|acceder|ingresar)\b/, 4),
    rule('account-locked', /\b(cuenta (bloqueada|suspendida|desactivada)|bloquearon mi cuenta|locked out)\b/, 5),
    rule('access-word', /\b(acceso|acceder|access|ingresar|autenticacion|authentication|2fa|mfa|doble factor|codigo de verificacion|otp)\b/, 2),
    rule('credentials', /\b(usuario|credenciales|credentials|permisos?|permission)\b/, 1),
    rule('recovery', /\b(recuperar|restablecer|reset)\w*\b/, 2),
  ],
  BUG: [
    rule('error-word', /\b(error|errores|falla\w*|fallo|bug|defecto)\b/, 3),
    rule('malfunction', /\b(se cierra|se congela|se traba|crash\w*|se cae|caid[oa]|no carga|no funciona|no responde|deja de funcionar|pantalla en blanco|timeout)\b/, 4),
    rule('http-error', /\b(500|502|503|504)\b/, 3),
    rule('slow', /\b(lento|lentitud|tarda mucho|slow)\b/, 2),
    rule('exception', /\b(excepcion|exception|stack ?trace|null|undefined)\b/, 3),
    rule('visual-glitch', /\b(se ve (rar[oa]|mal|extran[oa])|desconfigurad\w*|descuadrad\w*|roto|broken)\b/, 2),
    rule('data-loss', /\b(perd\w* (datos|informacion|lo que|mi trabajo)|se borr\w*)\b/, 3),
  ],
  FEATURE: [
    rule('wish', /\b(seria (bueno|genial|util|ideal)|me gustaria|nos gustaria|would be nice)\b/, 4),
    rule('suggestion', /\b(sugerencia|sugiero|sugerir|propuesta|propongo|idea)\b/, 4),
    rule('new-feature', /\b(nueva (funcion|funcionalidad|opcion|caracteristica)|feature|mejora|agregar|anadir|integracion|integrar)\b/, 3),
    rule('could-you-add', /\b(podrian|puedan|pueden) (agregar|anadir|incluir|implementar|hacer que)\b/, 4),
    rule('we-want', /\b(necesitamos|quisiera|quiero|queremos) (que|poder|una|un|la opcion)\b/, 2),
  ],
};

const TIE_BREAK_ORDER = ['SECURITY', 'ACCESS', 'BUG', 'FEATURE'];

const BASE_PRIORITY = { SECURITY: 'HIGH', ACCESS: 'MEDIUM', BUG: 'MEDIUM', FEATURE: 'LOW' };

const CRITICAL_RULES = {
  common: [
    /\b(produccion|production)\b.{0,40}\b(caid[oa]s?|abajo|down|no funciona)\b/,
    /\b(caid[oa]s?|cayo|down)\b.{0,40}\b(produccion|production)\b/,
    /\b(todos los|ningun|ninguno de los|ninguna de las|todas las) (usuarios?|clientes?|personas|empresas|tiendas|sucursales)\b/,
    /\b(sistema|plataforma|servidor|servicio|sitio|aplicacion|pagos?|cobros?) (completo |entero )?(esta |se )?(totalmente |completamente )?(caid[oa]|cayo|abajo|down|fuera de servicio)\b/,
    /\b(perdida (masiva|total)|perdimos (todos )?los datos|base de datos (borrada|eliminada|corrupta))\b/,
  ],
  SECURITY: [
    /\b(ahora mismo|en este momento|en curso|activamente|estan? (descargando|robando|accediendo|usando))\b/,
    /\b(robaron|comprometid[oa]s?|filtra(ron|do|da|cion)|exfiltr\w*|ransomware|secuestr\w*)\b/,
    /\b(como|de|con privilegios de) (administrador|admin|root|superusuario)\b/,
    /\b(compras?|cargos?|transferencias?) (con mi tarjeta|no autorizad\w*|que no hice|no reconocid\w*)\b/,
  ],
};

const HIGH_RULES = [
  /\b(urgente|urgencia|asap|lo antes posible|de inmediato|inmediatamente)\b/,
  /\ben (\d+|una|un|media) (hora|horas|minutos?)\b/,
  /\b(perd\w* (datos|informacion|lo que|mi trabajo|todo)|se borr\w*)\b/,
  /\b(no puedo trabajar|bloquead[oa]s?|bloquearon|detenid[oa]|nos impide|impide)\b/,
  /\b(varios|muchos|todos mis|varias|muchas) (usuarios|clientes|empleados|companeros|personas)\b/,
  /\b(pagos?|cobros?|facturacion|ventas|nomina)\b/,
  /\b(se cierra|crash\w*|se congela|pantalla en blanco)\b/,
];

const LOW_RULES = [
  /\b(cuando puedan|sin prisa|no es urgente|no urge|cuando tengan tiempo|detalle|cosmetic\w*|menor)\b/,
  /\b(se ve (rar[oa]|mal|extran[oa])|colou?r(es)?|tipografia|typo|ortografia|desalinead\w*)\b/,
  /\b(seria (bueno|genial|util|ideal)|me gustaria|sugerencia|sugiero)\b/,
];

// Negación del tema: "no es un problema de X", "ni de X", "no tiene que ver con X".
// Se evalúa sobre el fragmento anterior a la palabra clave, dentro de la misma frase.
const TOPIC_NEGATION = /\b(no es|no son|no se trata de|no tiene que ver con|nada que ver con|ni de|ni es|is not|isn't|not an?)\b(\s+\S+){0,3}\s*$/;

function isNegated(text, index) {
  const before = text.slice(Math.max(0, index - 50), index);
  const clause = before.split(/[.,;:!?]/).pop();
  return TOPIC_NEGATION.test(clause);
}

const toGlobal = (regex) => new RegExp(regex.source, 'g');

function firstUnnegatedMatch(text, regex) {
  for (const match of text.matchAll(toGlobal(regex))) {
    if (!isNegated(text, match.index)) return match[0];
  }
  return null;
}

function scoreCategories(text) {
  const scores = { SECURITY: 0, ACCESS: 0, BUG: 0, FEATURE: 0 };
  const matchedRules = [];
  const negatedRules = [];

  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    for (const { id, regex, weight } of rules) {
      let counted = false;
      for (const match of text.matchAll(regex)) {
        if (isNegated(text, match.index)) {
          negatedRules.push(`${category}.${id}`);
          continue;
        }
        if (!counted) {
          scores[category] += weight;
          matchedRules.push(`${category}.${id}("${match[0]}")`);
          counted = true;
        }
      }
    }
  }
  return { scores, matchedRules, negatedRules };
}

function pickCategory(scores) {
  const ranked = [...TIE_BREAK_ORDER].sort((a, b) => scores[b] - scores[a]);
  const [top, second] = ranked;
  const topScore = scores[top];
  const margin = topScore - scores[second];

  if (topScore === 0) {
    // Sin evidencia: se registra como posible falla y se pide revisión humana.
    return { category: 'BUG', confidence: 'none' };
  }
  const confidence = topScore < 3 || margin < 2 ? 'low' : 'high';
  return { category: top, confidence };
}

function computePriority(category, text) {
  const criticalRules = [...CRITICAL_RULES.common, ...(CRITICAL_RULES[category] ?? [])];
  const critical = criticalRules.map((r) => firstUnnegatedMatch(text, r)).filter(Boolean);
  if (critical.length > 0) {
    return { priority: 'CRITICAL', signals: critical.map((s) => `critical("${s}")`) };
  }

  let rank = priorityRank(BASE_PRIORITY[category]);
  const high = HIGH_RULES.map((r) => firstUnnegatedMatch(text, r)).filter(Boolean);
  const low = LOW_RULES.map((r) => text.match(r)?.[0]).filter(Boolean);

  if (high.length > 0) rank = Math.min(rank + 1, priorityRank('HIGH'));
  else if (low.length > 0) rank = Math.max(rank - 1, priorityRank('LOW'));

  if (category === 'SECURITY') rank = Math.max(rank, priorityRank('HIGH'));

  return {
    priority: PRIORITIES[rank],
    signals: [...high.map((s) => `high("${s}")`), ...low.map((s) => `low("${s}")`)],
  };
}

export function classifyTraditional(message) {
  const text = normalizeText(message);
  const { scores, matchedRules, negatedRules } = scoreCategories(text);
  const { category, confidence } = pickCategory(scores);
  const { priority, signals } = computePriority(category, text);

  const result = {
    category,
    priority,
    response: pickResponse(category, priority),
    requiresHumanReview: category === 'SECURITY' || confidence !== 'high',
    mode: 'traditional',
  };

  return {
    result,
    trace: { scores, matchedRules, negatedRules, prioritySignals: signals, confidence },
  };
}

export function createTraditionalEngine() {
  return {
    name: 'traditional',
    async analyze(message) {
      return classifyTraditional(message);
    },
  };
}
