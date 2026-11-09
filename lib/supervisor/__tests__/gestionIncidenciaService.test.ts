import { describe, expect, it, vi } from 'vitest';

vi.mock('../../firebase', () => ({
  db: {},
}));

import {
  buildParentGestionUpdatePayload,
  buildSiteIdVariants,
  chunkArray,
  isSiteAllowedForSupervisor,
  mapNovedadToAlertaItem,
  mapRoundToAlertaItem,
  normalizeSiteId,
  parseGestionSupervisorResumen,
  validateRegistrarGestionInput,
} from '../gestionIncidenciaService';
import type { GuardRound } from '../../../types';

describe('gestionIncidenciaService — Complemento Técnico & Dashboard Supervisor', () => {
  describe('1. Compatibilidad con registros históricos sin nuevos campos', () => {
    it('procesa rondas históricas sin campo gestionSupervisor sin lanzar errores', () => {
      const legacyRound: GuardRound = {
        id: 'round_hist_1',
        workerId: 'w_1',
        workerName: 'Juan Pérez',
        siteId: '17123456',
        siteName: 'Condominio Terrazas de Kennedy',
        startTime: '2026-10-01T22:00:00.000Z',
        endTime: '2026-10-01T22:30:00.000Z',
        startLocation: { lat: -33.4, lng: -70.5 },
        status: 'COMPLETED',
        result: 'CON_NOVEDAD',
        notes: 'Portón peatonal con cerradura suelta',
        evidences: [],
        path: [],
      };

      const alerta = mapRoundToAlertaItem(legacyRound);
      expect(alerta).not.toBeNull();
      expect(alerta?.clasificacion).toBe('ronda_novedad');
      expect(alerta?.gestionSupervisor).toBeNull();
      expect(alerta?.estadoOriginal).toBe('COMPLETADA');
      expect(alerta?.originalRound).toBe(legacyRound);
    });

    it('procesa novedades históricas sin campo gestionSupervisor sin errores', () => {
      const legacyNovedad = {
        id: 'nov_hist_1',
        sucursalId: 17123456,
        sucursalNombre: 'Planta Sermisur',
        autorUid: 'w_2',
        autorNombre: 'Claudia Sánchez',
        prioridad: 'critica',
        estado: 'registrada',
        descripcion: 'Activación de alarma perimetral sector norte',
        fechaHoraEvento: '2026-10-02T03:15:00.000Z',
      };

      const alerta = mapNovedadToAlertaItem(legacyNovedad);
      expect(alerta).not.toBeNull();
      expect(alerta?.clasificacion).toBe('novedad_critica');
      expect(alerta?.gestionSupervisor).toBeNull();
      expect(alerta?.siteId).toBe('17123456');
      expect(alerta?.estadoOriginal).toBe('REGISTRADA');
    });

    it('extrae fotosUrls de novedades con evidencias como array de URLs o fotos', () => {
      const novConFotos = {
        id: 'nov_fotos_1',
        sucursalId: 10,
        prioridad: 'alta',
        descripcion: 'Vehículo mal estacionado',
        evidencias: ['https://storage.googleapis.com/evidencia1.jpg', 'https://storage.googleapis.com/evidencia2.jpg'],
      };
      const alerta = mapNovedadToAlertaItem(novConFotos);
      expect(alerta?.fotosUrls).toEqual([
        'https://storage.googleapis.com/evidencia1.jpg',
        'https://storage.googleapis.com/evidencia2.jpg',
      ]);
    });

    it('ignora rondas SIN_NOVEDAD y novedades de prioridad informativa o media', () => {
      const normalRound: GuardRound = {
        id: 'r_ok',
        workerId: 'w_1',
        workerName: 'Guardia',
        siteId: '10',
        siteName: 'Sede 10',
        startTime: '2026-11-01T00:00:00Z',
        startLocation: { lat: -33.4, lng: -70.5 },
        status: 'COMPLETED',
        result: 'SIN_NOVEDAD',
        evidences: [],
        path: [],
      };
      expect(mapRoundToAlertaItem(normalRound)).toBeNull();

      const infoNov = {
        id: 'n_info',
        sucursalId: '10',
        prioridad: 'informativa',
        descripcion: 'Ingreso visita normal',
      };
      expect(mapNovedadToAlertaItem(infoNov)).toBeNull();
    });
  });

  describe('2. Protección de registros originales (Complemento Técnico #2)', () => {
    it('buildParentGestionUpdatePayload solo contiene la clave gestionSupervisor y nunca altera estados originales', () => {
      const fakeServerTimestamp = { _methodName: 'serverTimestamp' };
      const payload = buildParentGestionUpdatePayload(
        {
          origenTipo: 'ronda',
          origenId: 'round_123',
          siteId: 17123456,
          siteName: 'Terrazas',
          fueSolucionado: 'no',
          medidasTomadas: 'Se aisló la zona y se notificó a mantención',
          observaciones: 'Pendiente visita técnico eléctrico',
          motivoNoSolucionado: 'Requiere repuesto especializado',
          requiereIntervencionJefatura: true,
          supervisorUid: 'sup_1',
          supervisorNombre: 'Supervisor Norte',
          supervisorRole: 'supervisor',
          assignedSites: [17123456],
        },
        'gest_test_1',
        fakeServerTimestamp,
      );

      // Verificar que ninguna clave original de Rondas o Novedades esté en el payload de actualización
      const affectedKeys = Object.keys(payload);
      expect(affectedKeys).toEqual(['gestionSupervisor']);
      expect(affectedKeys).not.toContain('result');
      expect(affectedKeys).not.toContain('status');
      expect(affectedKeys).not.toContain('estado');
      expect(affectedKeys).not.toContain('prioridad');
      expect(affectedKeys).not.toContain('requiereSeguimiento');
      expect(affectedKeys).not.toContain('seguimientos');
      expect(affectedKeys).not.toContain('evidencias');

      expect(payload.gestionSupervisor).toEqual({
        ultimaGestionId: 'gest_test_1',
        tipoRegistro: 'gestion_supervisor',
        fueSolucionado: 'no',
        medidasTomadas: 'Se aisló la zona y se notificó a mantención',
        observaciones: 'Pendiente visita técnico eléctrico',
        motivoNoSolucionado: 'Requiere repuesto especializado',
        requiereIntervencionJefatura: true,
        supervisorUid: 'sup_1',
        supervisorNombre: 'Supervisor Norte',
        ultimoSupervisorUid: 'sup_1',
        ultimoSupervisorNombre: 'Supervisor Norte',
        fechaGestion: fakeServerTimestamp,
      });
    });

    it('marca consultaAdmin.pendienteRespuesta como false cuando el supervisor registra su gestión', () => {
      const fakeServerTimestamp = { _methodName: 'serverTimestamp' };
      const payload = buildParentGestionUpdatePayload(
        {
          origenTipo: 'novedad',
          origenId: 'nov_99',
          siteId: '100',
          fueSolucionado: 'si',
          medidasTomadas: 'Se reparó la tubería con personal de mantención.',
          supervisorUid: 'sup_1',
          supervisorNombre: 'Supervisor Norte',
          supervisorRole: 'supervisor',
          assignedSites: ['100'],
          prevResumen: {
            ultimaGestionId: 'cons_1',
            tipoRegistro: 'consulta_admin',
            fueSolucionado: 'pendiente',
            medidasTomadas: '¿Esto fue resuelto?',
            supervisorUid: 'admin_1',
            supervisorNombre: 'Admin',
            fechaGestion: '2026-11-08T18:00:00Z',
            consultaAdmin: {
              mensaje: '¿Esto fue resuelto?',
              adminUid: 'admin_1',
              adminNombre: 'Admin',
              fechaISO: '2026-11-08T18:00:00Z',
              pendienteRespuesta: true,
            },
          },
        },
        'gest_test_2',
        fakeServerTimestamp,
      );

      expect((payload.gestionSupervisor as any).consultaAdmin).toEqual({
        mensaje: '¿Esto fue resuelto?',
        adminUid: 'admin_1',
        adminNombre: 'Admin',
        fechaISO: '2026-11-08T18:00:00Z',
        pendienteRespuesta: false,
      });
    });
  });

  describe('3. Validaciones de negocio y permisos entre instalaciones (Complemento Técnico #3)', () => {
    it('rechaza gestión cuando medidasTomadas está vacío', () => {
      expect(() =>
        validateRegistrarGestionInput({
          origenTipo: 'novedad',
          origenId: 'nov_1',
          siteId: '100',
          fueSolucionado: 'si',
          medidasTomadas: '   ',
          supervisorUid: 'sup_1',
          supervisorNombre: 'Supervisor',
          supervisorRole: 'supervisor',
          assignedSites: [100],
        }),
      ).toThrow(/Medidas tomadas/i);
    });

    it('rechaza gestión cuando fueSolucionado es "no" pero no se indica motivo', () => {
      expect(() =>
        validateRegistrarGestionInput({
          origenTipo: 'novedad',
          origenId: 'nov_1',
          siteId: '100',
          fueSolucionado: 'no',
          medidasTomadas: 'Revisión en terreno',
          motivoNoSolucionado: '',
          supervisorUid: 'sup_1',
          supervisorNombre: 'Supervisor',
          supervisorRole: 'supervisor',
          assignedSites: [100],
        }),
      ).toThrow(/motivo/i);
    });

    it('impide que un supervisor gestione una instalación que NO tiene asignada', () => {
      expect(() =>
        validateRegistrarGestionInput({
          origenTipo: 'ronda',
          origenId: 'round_99',
          siteId: '99999',
          fueSolucionado: 'si',
          medidasTomadas: 'Intento de gestión en otra sucursal',
          supervisorUid: 'sup_1',
          supervisorNombre: 'Supervisor',
          supervisorRole: 'supervisor',
          assignedSites: [100, 200],
        }),
      ).toThrow(/instalación no asignada/i);
    });

    it('permite a un supervisor gestionar una instalación asignada aunque siteId sea string o number', () => {
      expect(() =>
        validateRegistrarGestionInput({
          origenTipo: 'ronda',
          origenId: 'round_100',
          siteId: '17123456',
          fueSolucionado: 'pendiente',
          medidasTomadas: 'En evaluación con cliente',
          supervisorUid: 'sup_1',
          supervisorNombre: 'Supervisor',
          supervisorRole: 'supervisor',
          assignedSites: [17123456], // number en assignedSites vs string en documento
        }),
      ).not.toThrow();
    });

    it('permite a Administración gestionar cualquier instalación globalmente', () => {
      expect(() =>
        validateRegistrarGestionInput({
          origenTipo: 'novedad',
          origenId: 'nov_global',
          siteId: '88888',
          fueSolucionado: 'si',
          medidasTomadas: 'Resuelto por administración central',
          supervisorUid: 'admin_1',
          supervisorNombre: 'Administrador',
          supervisorRole: 'admin',
          assignedSites: [],
        }),
      ).not.toThrow();
    });
  });

  describe('4. Normalización dual string/number y paginación por bloques (Complemento Técnico #4)', () => {
    it('buildSiteIdVariants genera variantes string y number sin duplicados', () => {
      const variants = buildSiteIdVariants([101, '202', '101', 'site_alpha']);
      expect(variants).toEqual(['101', 101, '202', 202, 'site_alpha']);
    });

    it('isSiteAllowedForSupervisor valida correctamente mezclando tipos string y number', () => {
      expect(isSiteAllowedForSupervisor('17500', [17500, 18900])).toBe(true);
      expect(isSiteAllowedForSupervisor(17500, ['17500'])).toBe(true);
      expect(isSiteAllowedForSupervisor('99999', [17500, 18900])).toBe(false);
      expect(isSiteAllowedForSupervisor(null, [17500])).toBe(false);
    });

    it('chunkArray divide arreglos grandes en bloques de máximo 30 para Firestore "in"', () => {
      const items = Array.from({ length: 65 }, (_, i) => i + 1);
      const chunks = chunkArray(items, 30);
      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(30);
      expect(chunks[1].length).toBe(30);
      expect(chunks[2].length).toBe(5);
    });

    it('parseGestionSupervisorResumen retorna null si el registro no tiene gestión', () => {
      expect(parseGestionSupervisorResumen(undefined)).toBeNull();
      expect(parseGestionSupervisorResumen(null)).toBeNull();
      expect(parseGestionSupervisorResumen({})).toBeNull();
    });
  });
});
