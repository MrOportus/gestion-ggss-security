/**
 * lib/phase4/transferService.ts
 * Fase 4 — Wrapper del lado frontend para las callables de traslado.
 *
 * Utiliza httpsCallable del SDK de Firebase v10.
 * La autoridad final de detección de conflictos está en el backend.
 * Este módulo solo invoca las callables y mapea los resultados.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import type {
  TransferRequest,
  TransferResult,
  RevertTransferRequest,
  RevertTransferResult,
} from '../../types/phase4';

// ─────────────────────────────────────────────────────────────────────────────
// Instancia de callables
// ─────────────────────────────────────────────────────────────────────────────

function getFunctionsInstance() {
  return getFunctions(undefined, 'us-central1');
}

// ─────────────────────────────────────────────────────────────────────────────
// transferShifts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoca la callable `transferScheduledShifts` en el backend.
 *
 * @param payload - TransferRequest con todos los parámetros del traslado.
 * @returns TransferResult con el resultado completo de cada turno.
 * @throws Error si la callable retorna un HttpsError.
 */
export async function transferShifts(payload: TransferRequest): Promise<TransferResult> {
  const functions = getFunctionsInstance();
  const callable = httpsCallable<TransferRequest, TransferResult>(
    functions,
    'transferScheduledShifts'
  );

  const result = await callable(payload);
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// revertTransfer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoca la callable `revertShiftTransfer` en el backend.
 *
 * @param payload - RevertTransferRequest con el turnoOrigenId y motivo.
 * @returns RevertTransferResult con el estado de la reversión.
 * @throws Error si la callable retorna un HttpsError.
 */
export async function revertTransfer(
  payload: RevertTransferRequest
): Promise<RevertTransferResult> {
  const functions = getFunctionsInstance();
  const callable = httpsCallable<RevertTransferRequest, RevertTransferResult>(
    functions,
    'revertShiftTransfer'
  );

  const result = await callable(payload);
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generador de operationRequestId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera un ID estable para una operación de traslado.
 * Basado en: colaboradorId + sucursalDestino + fechas + timestamp.
 * El cliente genera este ID antes de llamar a la callable para garantizar idempotencia.
 */
export function generateOperationRequestId(
  colaboradorId: string,
  sucursalDestinoId: string | number,
  fechas: string[],
  tipoOperacion: string
): string {
  const fechaStr = fechas.sort().join('_');
  const ts = Date.now();
  return `op_${colaboradorId}_${sucursalDestinoId}_${tipoOperacion}_${fechaStr}_${ts}`;
}
