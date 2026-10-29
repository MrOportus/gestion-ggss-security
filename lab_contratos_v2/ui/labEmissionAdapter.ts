/**
 * Adaptador de laboratorio para conectar ContractEmissionModalV2 con la Cloud Function de prueba
 */
import { EmissionPayload, EmissionResult } from './ContractEmissionModalV2';

export async function invokeLabEmission(payload: EmissionPayload): Promise<EmissionResult> {
  // Simulación de llamada a Cloud Function en laboratorio
  // En producción:
  // const fn = httpsCallable(functions, 'emitirContratoV2');
  // const res = await fn(payload);
  // return res.data;

  const res = await fetch('http://localhost:3001/api/emitirContratoV2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth: { uid: 'admin_session_user', role: 'admin', email: 'admin@ggss-security.cl' },
      data: payload
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Error en servicio de emisión');
  }

  return await res.json();
}
