// Respuestas predeterminadas compartidas por los motores no generativos
// (tradicional y Machine Learning): plantilla según categoría y prioridad.
export const RESPONSES = Object.freeze({
  ACCESS: {
    default:
      'Lamentamos el inconveniente para acceder a su cuenta. Verifique que su usuario y contraseña sean correctos y utilice la opción "¿Olvidó su contraseña?" para restablecerla. Si el problema continúa, nuestro equipo le ayudará a recuperar el acceso.',
    HIGH: 'Lamentamos que no pueda acceder a su cuenta. Su caso fue priorizado: un agente revisará el estado de su cuenta a la brevedad. Mientras tanto, puede intentar restablecer su contraseña con la opción "¿Olvidó su contraseña?".',
    CRITICAL:
      'Detectamos que el problema de acceso afecta la operación. El caso fue escalado de inmediato y un agente revisará las cuentas afectadas con prioridad crítica.',
  },
  BUG: {
    default:
      'Gracias por reportar esta falla. El incidente quedó registrado y el equipo técnico lo está analizando. Para agilizar la solución, comparta los pasos para reproducirlo, capturas de pantalla y la hora aproximada en que ocurrió.',
    CRITICAL:
      'Detectamos que la falla reportada tiene un impacto crítico. El incidente fue escalado de inmediato al equipo de guardia y le mantendremos informado sobre el restablecimiento del servicio.',
  },
  FEATURE: {
    default:
      'Gracias por su sugerencia. Registramos la solicitud de nueva funcionalidad y será evaluada por el equipo de producto en la próxima planificación. Le notificaremos cualquier avance.',
  },
  SECURITY: {
    default:
      'Gracias por reportar este posible problema de seguridad. El caso fue escalado al equipo de seguridad para revisión humana. Por favor no comparta contraseñas ni datos sensibles por este medio; un especialista le contactará a la brevedad.',
    CRITICAL:
      'Su reporte fue clasificado como un incidente de seguridad crítico y se escaló de inmediato al equipo de respuesta a incidentes. Le recomendamos cambiar sus contraseñas y no compartir información sensible por este medio; un especialista le contactará con prioridad.',
  },
});

export function pickResponse(category, priority) {
  const templates = RESPONSES[category];
  return templates[priority] ?? templates.default;
}
