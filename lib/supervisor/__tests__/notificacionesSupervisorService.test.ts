import { describe, expect, it, vi } from 'vitest';

vi.mock('../../firebase', () => ({
  db: {},
}));

import {
  extractCanonicalKeysFromId,
  getNotificationCanonicalKey,
  isNotificationWithinOperationalWindow,
  isNotifRead,
  NOTIF_MAX_AGE_LEIDA_MS,
  NOTIF_MAX_AGE_NO_VISTA_MS,
  type NotificacionSupervisor,
  resolveOrigenTipo,
} from '../notificacionesSupervisorService';

describe('notificacionesSupervisorService — Deduplicación y Claves Canónicas', () => {
  describe('1. resolveOrigenTipo', () => {
    it('reconoce origenTipo explícito', () => {
      expect(resolveOrigenTipo({ origenTipo: 'ronda' })).toBe('ronda');
      expect(resolveOrigenTipo({ origenTipo: 'novedad' })).toBe('novedad');
      expect(resolveOrigenTipo({ origenTipo: 'visita' })).toBe('visita');
    });

    it('infiere visita a partir de prefijos y vistas', () => {
      expect(resolveOrigenTipo({ id: 'sv_seg123_uid' })).toBe('visita');
      expect(resolveOrigenTipo({ id: 'drv_vis_v99_1' })).toBe('visita');
      expect(resolveOrigenTipo({ tipo: 'visita_seguimiento' })).toBe('visita');
      expect(resolveOrigenTipo({ vista: 'visitas_supervisor' })).toBe('visita');
    });

    it('infiere ronda a partir de prefijos y vistas', () => {
      expect(resolveOrigenTipo({ id: 'drv_rnd_urg_r123' })).toBe('ronda');
      expect(resolveOrigenTipo({ vista: 'rounds' })).toBe('ronda');
    });

    it('defaultea a novedad en caso ambiguo', () => {
      expect(resolveOrigenTipo({ id: 'nu_nov123_uid' })).toBe('novedad');
    });
  });

  describe('2. getNotificationCanonicalKey', () => {
    it('genera la MISMA clave canónica para novedad urgente directa y derivada', () => {
      const directNotif: NotificacionSupervisor = {
        id: 'nu_nov_demo_1_sup123',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: 'Novedad prioridad alta · Condominio demo 1',
        mensaje: 'vehiculo queda mal estacionado',
        origenTipo: 'novedad',
        origenId: 'nov_demo_1',
        vista: 'dashboard',
        creadaPorUid: 'guardia_1',
        creadaPorNombre: 'Guardia Demo',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      const derivedNotif: NotificacionSupervisor = {
        id: 'drv_nov_urg_nov_demo_1',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: '⚠️ Prioridad Alta · Condominio demo 1',
        mensaje: 'vehiculo queda mal estacionado',
        origenTipo: 'novedad',
        origenId: 'nov_demo_1',
        vista: 'dashboard',
        creadaPorUid: 'guardia_1',
        creadaPorNombre: 'Guardia Demo',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      const directKey = getNotificationCanonicalKey(directNotif);
      const derivedKey = getNotificationCanonicalKey(derivedNotif);

      expect(directKey).toBe('novedad:nov_demo_1:novedad_urgente');
      expect(derivedKey).toBe('novedad:nov_demo_1:novedad_urgente');
      expect(directKey).toBe(derivedKey);
    });

    it('genera la misma clave canónica para ronda con novedad urgente directa y derivada', () => {
      const directRnd: NotificacionSupervisor = {
        id: 'nu_rnd_999_sup123',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: 'Ronda con novedad · Sede Norte',
        mensaje: 'Puerta forzada',
        origenTipo: 'ronda',
        origenId: 'rnd_999',
        vista: 'dashboard',
        creadaPorUid: 'guardia_2',
        creadaPorNombre: 'Guardia 2',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      const derivedRnd: NotificacionSupervisor = {
        id: 'drv_rnd_urg_rnd_999',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: '🚨 Ronda con Sospecha · Sede Norte',
        mensaje: 'Puerta forzada',
        origenTipo: 'ronda',
        origenId: 'rnd_999',
        vista: 'dashboard',
        creadaPorUid: 'guardia_2',
        creadaPorNombre: 'Guardia 2',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      expect(getNotificationCanonicalKey(directRnd)).toBe('ronda:rnd_999:novedad_urgente');
      expect(getNotificationCanonicalKey(derivedRnd)).toBe('ronda:rnd_999:novedad_urgente');
    });

    it('las directas de seguimiento o consulta mantienen su ID único para historial', () => {
      const directSeg: NotificacionSupervisor = {
        id: 'sn_seg_abc_uid',
        destinatarioUid: 'uid',
        tipo: 'seguimiento_novedad',
        titulo: 'Seguimiento',
        mensaje: 'Respuesta en hilo',
        origenTipo: 'novedad',
        origenId: 'nov_1',
        vista: 'libro_novedades',
        creadaPorUid: 'admin_1',
        creadaPorNombre: 'Admin',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      expect(getNotificationCanonicalKey(directSeg)).toBe('sn_seg_abc_uid');
    });
  });

  describe('3. extractCanonicalKeysFromId', () => {
    it('extrae clave canónica y alias derivado a partir de un ID directo nu_', () => {
      const keys = extractCanonicalKeysFromId('nu_nov_xyz_sup1');
      expect(keys).toContain('nu_nov_xyz_sup1');
      expect(keys).toContain('novedad:nov_xyz:novedad_urgente');
      expect(keys).toContain('drv_nov_urg_nov_xyz');
    });

    it('extrae clave canónica a partir de un ID derivado drv_nov_urg_', () => {
      const keys = extractCanonicalKeysFromId('drv_nov_urg_nov_xyz');
      expect(keys).toContain('drv_nov_urg_nov_xyz');
      expect(keys).toContain('novedad:nov_xyz:novedad_urgente');
    });
  });

  describe('4. isNotifRead con soporte canónico', () => {
    it('reconoce como leída una notificación directa si se marcó su clave canónica o alias derivado', () => {
      const readSet = new Set<string>(['novedad:nov_123:novedad_urgente']);

      const directItem: NotificacionSupervisor = {
        id: 'nu_nov_123_sup1',
        destinatarioUid: 'sup1',
        tipo: 'novedad_urgente',
        titulo: 'Novedad',
        mensaje: 'Msg',
        origenTipo: 'novedad',
        origenId: 'nov_123',
        vista: 'dashboard',
        creadaPorUid: 'g1',
        creadaPorNombre: 'Guardia',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      expect(isNotifRead('sup1', directItem, readSet)).toBe(true);
    });

    it('reconoce como no leída si no está en el readSet', () => {
      const readSet = new Set<string>();
      const directItem: NotificacionSupervisor = {
        id: 'nu_nov_999_sup1',
        destinatarioUid: 'sup1',
        tipo: 'novedad_urgente',
        titulo: 'Novedad',
        mensaje: 'Msg',
        origenTipo: 'novedad',
        origenId: 'nov_999',
        vista: 'dashboard',
        creadaPorUid: 'g1',
        creadaPorNombre: 'Guardia',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      expect(isNotifRead('sup1', directItem, readSet)).toBe(false);
    });
  });

  describe('5. Lógica de deduplicación ante colisión de directa y derivada', () => {
    it('elimina duplicados dejando únicamente el documento oficial directo cuando ambos coinciden', () => {
      const directNotif: NotificacionSupervisor = {
        id: 'nu_nov_demo_1_sup123',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: 'Novedad prioridad alta · Condominio demo 1',
        mensaje: 'Usuario Demo: vehiculo queda mal estacionado.',
        origenTipo: 'novedad',
        origenId: 'nov_demo_1',
        vista: 'dashboard',
        creadaPorUid: 'guardia_1',
        creadaPorNombre: 'Guardia Demo',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      const derivedNotif: NotificacionSupervisor = {
        id: 'drv_nov_urg_nov_demo_1',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: '⚠️ Prioridad Alta · Condominio demo 1',
        mensaje: 'Usuario Demo: vehiculo queda mal estacionado.',
        origenTipo: 'novedad',
        origenId: 'nov_demo_1',
        vista: 'dashboard',
        creadaPorUid: 'guardia_1',
        creadaPorNombre: 'Guardia Demo',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      // Simular lista combinada (como en el bug original donde ambas llegaban)
      const combined = [derivedNotif, directNotif];
      const byKey = new Map<string, NotificacionSupervisor>();

      combined.forEach((item) => {
        const canonKey = getNotificationCanonicalKey(item);
        const existing = byKey.get(canonKey);
        if (!existing || (existing.id.startsWith('drv_') && !item.id.startsWith('drv_'))) {
          byKey.set(canonKey, item);
        }
      });

      const all = Array.from(byKey.values());
      expect(all.length).toBe(1);
      expect(all[0].id).toBe('nu_nov_demo_1_sup123');
      expect(all[0].titulo).toBe('Novedad prioridad alta · Condominio demo 1');
    });

    it('no alerta dos veces si la derivada alertó y luego llega la directa', () => {
      const knownUnreadIds = new Set<string>();
      const knownUnreadAlertKeys = new Set<string>();

      const derivedNotif: NotificacionSupervisor = {
        id: 'drv_nov_urg_nov_demo_1',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: '⚠️ Prioridad Alta · Condominio demo 1',
        mensaje: 'Usuario Demo: vehiculo queda mal estacionado.',
        origenTipo: 'novedad',
        origenId: 'nov_demo_1',
        vista: 'dashboard',
        creadaPorUid: 'guardia_1',
        creadaPorNombre: 'Guardia Demo',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      // Turno 1: llega la derivada
      const canonKey1 = getNotificationCanonicalKey(derivedNotif);
      const isKnown1 =
        knownUnreadIds.has(derivedNotif.id) || knownUnreadAlertKeys.has(canonKey1);
      expect(isKnown1).toBe(false);

      // Se registra
      knownUnreadIds.add(derivedNotif.id);
      knownUnreadAlertKeys.add(canonKey1);

      // Turno 2: 300ms después llega la directa de Cloud Function
      const directNotif: NotificacionSupervisor = {
        id: 'nu_nov_demo_1_sup123',
        destinatarioUid: 'sup123',
        tipo: 'novedad_urgente',
        titulo: 'Novedad prioridad alta · Condominio demo 1',
        mensaje: 'Usuario Demo: vehiculo queda mal estacionado.',
        origenTipo: 'novedad',
        origenId: 'nov_demo_1',
        vista: 'dashboard',
        creadaPorUid: 'guardia_1',
        creadaPorNombre: 'Guardia Demo',
        leida: false,
        creadoEnISO: '2026-11-08T22:00:00.000Z',
        creadoEnMs: 1794184800000,
      };

      const canonKey2 = getNotificationCanonicalKey(directNotif);
      const isKnown2 =
        knownUnreadIds.has(directNotif.id) || knownUnreadAlertKeys.has(canonKey2);

      // Debe ser reconocida como ya conocida -> CERO alerta sonora duplicada!
      expect(isKnown2).toBe(true);
    });
  });

  describe('6. Ventana Operativa de Notificaciones (24h leídas / máx 36h no vistas)', () => {
    const fixedNow = 1794200000000; // Punto de referencia fijo

    it('acepta notificaciones no vistas de menos de 24 horas', () => {
      const item = {
        creadoEnMs: fixedNow - 2 * 60 * 60 * 1000, // hace 2h
        leida: false,
      };
      expect(isNotificationWithinOperationalWindow(item, fixedNow)).toBe(true);
    });

    it('acepta notificaciones ya leídas de menos de 24 horas', () => {
      const item = {
        creadoEnMs: fixedNow - 12 * 60 * 60 * 1000, // hace 12h
        leida: true,
      };
      expect(isNotificationWithinOperationalWindow(item, fixedNow)).toBe(true);
    });

    it('acepta notificaciones NO vistas de entre 24h y 36h', () => {
      const item = {
        creadoEnMs: fixedNow - 30 * 60 * 60 * 1000, // hace 30h
        leida: false,
      };
      expect(isNotificationWithinOperationalWindow(item, fixedNow)).toBe(true);
    });

    it('rechaza notificaciones ya leídas/vistas de más de 24 horas', () => {
      const item = {
        creadoEnMs: fixedNow - 25 * 60 * 60 * 1000, // hace 25h
        leida: true,
      };
      expect(isNotificationWithinOperationalWindow(item, fixedNow)).toBe(false);
    });

    it('rechaza notificaciones no vistas de más de 36 horas', () => {
      const item = {
        creadoEnMs: fixedNow - 37 * 60 * 60 * 1000, // hace 37h
        leida: false,
      };
      expect(isNotificationWithinOperationalWindow(item, fixedNow)).toBe(false);
    });

    it('rechaza notificaciones antiguas de meses pasados (leídas o no)', () => {
      const itemMesesAtrasUnread = {
        creadoEnMs: fixedNow - 60 * 24 * 60 * 60 * 1000, // hace 60 días
        leida: false,
      };
      const itemMesesAtrasRead = {
        creadoEnMs: fixedNow - 60 * 24 * 60 * 60 * 1000,
        leida: true,
      };
      expect(isNotificationWithinOperationalWindow(itemMesesAtrasUnread, fixedNow)).toBe(false);
      expect(isNotificationWithinOperationalWindow(itemMesesAtrasRead, fixedNow)).toBe(false);
    });

    it('rechaza notificaciones con timestamp nulo, cero o inválido', () => {
      expect(isNotificationWithinOperationalWindow({ creadoEnMs: 0, leida: false }, fixedNow)).toBe(false);
      expect(isNotificationWithinOperationalWindow({ creadoEnMs: -1, leida: false }, fixedNow)).toBe(false);
      expect(isNotificationWithinOperationalWindow({ creadoEnMs: undefined as any, leida: false }, fixedNow)).toBe(false);
    });

    it('acepta notificaciones con leve desfase hacia el futuro', () => {
      const itemFuturo = {
        creadoEnMs: fixedNow + 5000, // 5 segundos en el futuro (desajuste reloj cliente/servidor)
        leida: false,
      };
      expect(isNotificationWithinOperationalWindow(itemFuturo, fixedNow)).toBe(true);
    });
  });
});
