'use strict';
/**
 * functions/src/phase4/contractReevalService.js
 * Fase 4 — Reevaluación contractual post-traslado.
 *
 * Reutiliza la misma lógica del trigger onContratoWritten (Fase 3).
 * El traslado NUNCA se bloquea por falta de contrato.
 * Si el resultado ≠ 'compatible', se registra en AuditoriaAcciones.
 *
 * Retorna: { estado, contratoIdAsociado? }
 */

const ESTADOS_VALIDOS_CONTRATO = ['vigente', 'pendiente_firma'];

/**
 * Evalúa el estado contractual de un colaborador para una sucursal y fecha dadas.
 * Misma lógica que ContractBindingService.evaluateTurno() (TypeScript front-end)
 * y que onContratoWritten (Cloud Function Fase 3).
 *
 * @param {string} colaboradorId
 * @param {string} sucursalId
 * @param {string} fecha - YYYY-MM-DD
 * @param {object[]} contratos - Array de documentos de la colección Contratos
 * @returns {{ estado: string, contratoIdAsociado: string|null }}
 */
function evaluateContractForTransfer(colaboradorId, sucursalId, fecha, contratos) {
  if (!fecha) {
    return { estado: 'sin_contrato', contratoIdAsociado: null };
  }

  // Filtrar contratos vigentes que cubren la fecha
  const contratosEnFecha = contratos.filter(c => {
    if (!ESTADOS_VALIDOS_CONTRATO.includes(c.estado)) return false;
    if (fecha < c.fechaInicio) return false;
    if (c.fechaTermino && fecha > c.fechaTermino) return false;
    return true;
  });

  if (contratosEnFecha.length === 0) {
    return { estado: 'sin_contrato', contratoIdAsociado: null };
  }

  const contratosMismaSucursal = contratosEnFecha.filter(
    c => c.sucursalId.toString() === sucursalId.toString()
  );

  if (contratosMismaSucursal.length === 0) {
    return { estado: 'otra_sucursal', contratoIdAsociado: null };
  }

  if (contratosMismaSucursal.length === 1) {
    return { estado: 'compatible', contratoIdAsociado: contratosMismaSucursal[0].id };
  }

  return { estado: 'multiples', contratoIdAsociado: null };
}

/**
 * Ejecuta la reevaluación contractual del turno destino usando el Admin SDK.
 * Escribe el resultado en el documento del turno destino y registra auditoría si corresponde.
 *
 * @param {object} db - Instancia de admin.firestore()
 * @param {object} params
 * @param {string} params.turnoDestinoId
 * @param {string} params.colaboradorId
 * @param {string} params.sucursalDestinoId
 * @param {string} params.fecha
 * @param {string} params.correlationId
 * @param {string} params.usuarioId
 * @param {object} batch - Firestore WriteBatch para incluir las escrituras
 * @returns {Promise<{ estado: string, contratoIdAsociado: string|null, alerta: boolean }>}
 */
async function reevaluarContratoParaDestino(db, params, batch) {
  const { turnoDestinoId, colaboradorId, sucursalDestinoId, fecha, correlationId, usuarioId } = params;

  // 1. Obtener contratos del colaborador
  const contratosSnap = await db.collection('Contratos')
    .where('colaboradorId', '==', colaboradorId)
    .get();

  const contratos = [];
  contratosSnap.forEach(docSnap => contratos.push({ id: docSnap.id, ...docSnap.data() }));

  // 2. Evaluar
  const { estado, contratoIdAsociado } = evaluateContractForTransfer(
    colaboradorId,
    sucursalDestinoId,
    fecha,
    contratos
  );

  // 3. Escribir en el turno destino (vía batch)
  const turnoDestinoRef = db.collection('TurnosProgramados').doc(turnoDestinoId);
  const updateData = {
    estadoContratoVinculado: estado,
    fechaEvaluacionContrato: new Date().toISOString(),
    fuenteEvaluacionContrato: 'transfer_phase4',
  };
  if (contratoIdAsociado) {
    updateData.contratoIdAsociado = contratoIdAsociado;
  }
  batch.update(turnoDestinoRef, updateData);

  // 4. Si no es compatible, registrar alerta en AuditoriaAcciones
  const generaAlerta = estado !== 'compatible';
  if (generaAlerta) {
    const alertaRef = db.collection('AuditoriaAcciones').doc();
    batch.set(alertaRef, {
      id: alertaRef.id,
      accion: 'TRANSFER_CONTRACT_ALERT',
      entidad: 'TurnosProgramados',
      entidadId: turnoDestinoId,
      usuarioId: usuarioId || 'system',
      fecha: new Date().toISOString(),
      motivo: `Reevaluación post-traslado: estado contractual = ${estado}`,
      contextoInfo: {
        colaboradorId,
        sucursalDestinoId,
        fechaTurno: fecha,
        estadoContratoVinculado: estado,
        correlationId,
      },
    });
  }

  return { estado, contratoIdAsociado, alerta: generaAlerta };
}

module.exports = {
  evaluateContractForTransfer,
  reevaluarContratoParaDestino,
};
