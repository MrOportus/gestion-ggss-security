import { functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { AttendanceShadowRequest, AttendanceShadowResponse } from '../types/phase5d2';

/**
 * Service to interact with the getAttendanceShadowValidated callable.
 * Isolates the logic for creating unique request IDs and mapping common errors.
 */
export class AttendanceShadowService {
  /**
   * Generates a unique request ID to identify a specific query operation logically.
   */
  static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Calls the shadow validation endpoint.
   * 
   * @param params The search filters and pagination cursors.
   * @param requestId A unique ID for this logical request (reused for retries, different for new searches).
   * @returns The parsed response from the backend.
   */
  static async execute(
    params: Omit<AttendanceShadowRequest, 'requestId'>,
    requestId: string
  ): Promise<AttendanceShadowResponse> {
    // PRE-FLIGHT VALIDATIONS
    // The frontend must NEVER request v2_only according to requirements.
    // If a request tries to do so, we block it before it hits the backend.
    if ((params as any).mode === 'v2_only') {
      throw new Error('El modo v2_only no está permitido en esta interfaz.');
    }

    if (import.meta.env.VITE_ENABLE_ATTENDANCE_SHADOW_QA !== 'true') {
      throw new Error('La función de Shadow QA está desactivada.');
    }

    try {
      const getAttendanceShadowValidated = httpsCallable<AttendanceShadowRequest, AttendanceShadowResponse>(
        functions, 
        'getAttendanceShadowValidated'
      );
      
      const requestPayload: AttendanceShadowRequest = {
        ...params,
        requestId,
      };

      const result = await getAttendanceShadowValidated(requestPayload);
      const data = result.data;

      // POST-FLIGHT VALIDATIONS
      // Minimal structural validation of the response to ensure it's not malformed
      if (!data || typeof data !== 'object') {
        throw new Error('Respuesta malformada desde el servidor (no es un objeto).');
      }

      if (!data.legacyResult || !Array.isArray(data.legacyResult.items)) {
        throw new Error('Respuesta malformada desde el servidor (estructura de paginación Legacy inválida).');
      }

      return data;
      
    } catch (error: any) {
      // Re-throw local validation errors immediately
      if (error.message.includes('v2_only') || error.message.includes('malformada')) {
        throw error;
      }

      const code = error?.code || 'unknown';
      let userMessage = 'Ha ocurrido un error inesperado al consultar la asistencia Shadow.';

      switch (code) {
        case 'permission-denied':
          userMessage = 'No tienes autorización para consultar esta información.';
          // Additional checks for specific backend errors inside message
          if (error.message?.includes('attendance_v2_read_disabled')) {
            userMessage = 'La vista Shadow no está habilitada para este usuario o sucursal.';
          } else if (error.message?.includes('cursor_signature_invalid') || error.message?.includes('cursor_actor_mismatch')) {
             userMessage = 'La sesión de paginación expiró o es inválida. Reinicia la consulta.';
          }
          break;
        case 'invalid-argument':
          userMessage = 'Revisa los filtros seleccionados.';
          if (error.message?.includes('invalid_cursor') || error.message?.includes('cursor_expired')) {
            userMessage = 'La sesión de paginación expiró. Reinicia la consulta.';
          } else if (error.message?.includes('request_id_reused')) {
            userMessage = 'La solicitud no puede reutilizarse con filtros distintos. Genera una nueva consulta.';
          }
          break;
        case 'resource-exhausted':
          userMessage = 'La consulta supera los límites permitidos.';
          break;
      }

      // Throw a friendly Error without exposing stack traces to the UI
      console.error('[Shadow QA Debug] Raw Backend Error:', error);
      throw new Error(userMessage);
    }
  }
}
