import { describe, expect, it } from 'vitest';
import {
  calcularResultado,
  crearBorrador,
  fotosDeVisita,
  validarBorrador,
} from '../visitasLogic';
import type { VisitaSupervisorDoc } from '../visitasTypes';

describe('visitasLogic — Validación y Fotografías del Libro de Novedades', () => {
  const baseParams = {
    supervisorUid: 'sup_123',
    sucursalId: 'suc_456',
    sucursalNombre: 'Condominio Demo',
  };

  it('exige responder si se dejó constancia en el libro de novedades', () => {
    const draft = crearBorrador(baseParams);
    draft.libroNovedades.estado = 'ok';
    draft.libroNovedades.dejoConstancia = null;

    const errores = validarBorrador(draft);
    expect(
      errores.some(
        e => e.seccion === 'libroNovedades' && e.mensaje.includes('dejó constancia'),
      ),
    ).toBe(true);
  });

  it('si se dejó constancia (SI), exige obligatoriamente la fotografía de la constancia', () => {
    const draft = crearBorrador(baseParams);
    draft.libroNovedades.estado = 'ok';
    draft.libroNovedades.dejoConstancia = true;
    draft.fotos = []; // Sin fotos

    const errores = validarBorrador(draft);
    expect(
      errores.some(
        e =>
          e.seccion === 'libroNovedades' &&
          e.mensaje.includes('fotografía de la constancia'),
      ),
    ).toBe(true);
  });

  it('si se dejó constancia (SI) y se sube la foto de constancia, la validación de constancia pasa', () => {
    const draft = crearBorrador(baseParams);
    draft.libroNovedades.estado = 'ok';
    draft.libroNovedades.dejoConstancia = true;
    draft.fotos = [
      {
        id: 'foto_const_1',
        dataUrl: 'data:image/jpeg;base64,12345',
        ambito: 'constancia_libro',
        capturadoEn: new Date().toISOString(),
      },
    ];

    const errores = validarBorrador(draft);
    expect(
      errores.some(
        e =>
          e.seccion === 'libroNovedades' &&
          e.mensaje.includes('fotografía de la constancia'),
      ),
    ).toBe(false);
  });

  it('si NO se dejó constancia (NO), no exige la fotografía de la constancia', () => {
    const draft = crearBorrador(baseParams);
    draft.libroNovedades.estado = 'ok';
    draft.libroNovedades.dejoConstancia = false;
    draft.fotos = [];

    const errores = validarBorrador(draft);
    expect(
      errores.some(
        e =>
          e.seccion === 'libroNovedades' &&
          e.mensaje.includes('fotografía de la constancia'),
      ),
    ).toBe(false);
  });

  it('fotosDeVisita clasifica correctamente las fotos de visita, observación, libro y constancia', () => {
    const visitaDoc: VisitaSupervisorDoc = {
      id: 'vis_test_1',
      schemaVersion: 1,
      supervisorUid: 'sup_123',
      supervisorNombre: 'Supervisor Test',
      sucursalId: 'suc_456',
      sucursalNombre: 'Condominio Demo',
      fechaOperacional: '2026-11-09',
      inicioEn: '2026-11-09T10:00:00.000Z',
      terminoEn: '2026-11-09T10:30:00.000Z',
      duracionMin: 30,
      zonaHoraria: 'America/Santiago',
      ubicacion: { estado: 'no_disponible' },
      motivo: 'Visita Programada',
      guardiasDeTurno: 'Guardia 1',
      epp: { completo: true },
      checklist: { plantillaId: 'base', origen: 'global', version: 1, items: [] },
      entrevistaMandante: { realizada: false },
      observaciones: { hay: false },
      novedadRelevante: { hay: false },
      resultado: 'sin_novedades',
      fotosTotal: 4,
      creadoEn: '2026-11-09T10:30:00.000Z',
      fotos: {
        f1: { url: 'https://test/f1.jpg', ambito: 'visita', orden: 0, capturadoEn: '' },
        f2: { url: 'https://test/f2.jpg', ambito: 'observacion', orden: 1, capturadoEn: '' },
        f3: { url: 'https://test/f3.jpg', ambito: 'libro_novedades', orden: 2, capturadoEn: '' },
        f4: { url: 'https://test/f4.jpg', ambito: 'constancia_libro', orden: 3, capturadoEn: '' },
      },
    };

    const categorizadas = fotosDeVisita(visitaDoc);
    expect(categorizadas.visita.length).toBe(1);
    expect(categorizadas.visita[0].id).toBe('f1');
    expect(categorizadas.observacion.length).toBe(1);
    expect(categorizadas.observacion[0].id).toBe('f2');
    expect(categorizadas.libro_novedades.length).toBe(1);
    expect(categorizadas.libro_novedades[0].id).toBe('f3');
    expect(categorizadas.constancia_libro.length).toBe(1);
    expect(categorizadas.constancia_libro[0].id).toBe('f4');
    expect(categorizadas.total).toBe(4);
  });
});

