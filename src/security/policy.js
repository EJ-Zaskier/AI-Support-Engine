import { priorityRank } from '../contract.js';
import { detectPromptInjection, detectSecuritySignals, redactSecrets } from './guards.js';

/**
 * Capa de políticas aplicada DESPUÉS de cualquier motor (defensa en profundidad).
 * No cambia la categoría ni redacta la respuesta: solo aplica reglas de seguridad
 * no negociables sobre el resultado.
 *  - Todo lo relacionado con seguridad o con intentos de manipulación => revisión humana.
 *  - Lo CRITICAL => revisión humana.
 *  - Una solicitud SECURITY nunca queda por debajo de HIGH (un atacante no puede
 *    "pedir" prioridad baja).
 *  - Se ocultan posibles secretos que aparezcan en el texto de respuesta.
 */
export function applySafetyPolicy(result, { message }) {
  const reasons = [];
  const securitySignals = detectSecuritySignals(message);
  const injection = detectPromptInjection(message);

  if (result.category === 'SECURITY') reasons.push('category-security');
  if (securitySignals.length > 0) reasons.push(`security-signals:${securitySignals.join(',')}`);
  if (injection.suspected) reasons.push(`prompt-injection:${injection.matches.join(',')}`);
  if (result.priority === 'CRITICAL') reasons.push('critical-priority');

  let { priority } = result;
  if (result.category === 'SECURITY' && priorityRank(priority) < priorityRank('HIGH')) {
    priority = 'HIGH';
    reasons.push('security-priority-floor');
  }

  return {
    result: {
      ...result,
      priority,
      response: redactSecrets(result.response),
      requiresHumanReview: result.requiresHumanReview || reasons.length > 0,
    },
    reasons,
  };
}
