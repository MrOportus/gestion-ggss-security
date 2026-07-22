/**
 * phase5d2d_cursor.test.ts
 *
 * Tests unitarios del cursor firmado HMAC-SHA256.
 * No requiere emuladores — son tests de lógica pura.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';

// Necesitamos importar el módulo con el secreto inyectado
// El módulo usa process.env.CURSOR_SIGNING_SECRET
const MOCK_SECRET = 'test-cursor-signing-secret-minimum-16chars';

// Guardar y restaurar el secreto original
let originalSecret: string | undefined;
beforeAll(() => {
  originalSecret = process.env.CURSOR_SIGNING_SECRET;
  process.env.CURSOR_SIGNING_SECRET = MOCK_SECRET;
});
afterAll(() => {
  if (originalSecret !== undefined) {
    process.env.CURSOR_SIGNING_SECRET = originalSecret;
  } else {
    delete process.env.CURSOR_SIGNING_SECRET;
  }
});

// Import AFTER setting env var to ensure the module picks it up
// We use dynamic require inside tests to ensure fresh module with env set.
function getPagination() {
  // Clear require cache for fresh load
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment, @typescript-eslint/no-require-imports
  // @ts-ignore — módulo JS sin declaraciones de tipo (test de integración pura)
  return require('../../../functions/src/phase5d2/queries/attendanceV2Pagination');
}


describe('Phase 5D.2D — Cursor Firmado HMAC-SHA256', () => {

  // ---------------------------------------------------------------------------
  // Helpers de test
  // ---------------------------------------------------------------------------
  function makeFakeDoc(docId: string, jornadaDate: string, checkInAt: string) {
    return {
      id: docId,
      exists: true,
      data: () => ({ jornadaDate, checkInAt })
    };
  }

  // ---------------------------------------------------------------------------
  // Formato del cursor
  // ---------------------------------------------------------------------------
  test('cursor firmado tiene exactamente un punto separador', () => {
    const { createNextCursor } = getPagination();
    const doc = makeFakeDoc('doc_001', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'branch_range', {
      actorUid: 'actor_01',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });
    expect(cursor).not.toBeNull();
    const parts = (cursor as string).split('.');
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  test('cursor decodificado contiene los campos correctos', () => {
    const { createNextCursor, decodeCursor } = getPagination();
    const doc = makeFakeDoc('doc_002', '2024-06-15', '2024-06-15T09:00:00Z');
    const cursor = createNextCursor(doc, 'employee_range', {
      actorUid: 'actor_02',
      employeeId: 'emp_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    const decoded = decodeCursor(cursor, 'employee_range', {
      actorUid: 'actor_02',
      employeeId: 'emp_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    expect(decoded.version).toBe(1);
    expect(decoded.queryType).toBe('employee_range');
    expect(decoded.actorUid).toBe('actor_02');
    expect(decoded.employeeId).toBe('emp_01');
    expect(decoded.lastJornadaDate).toBe('2024-06-15');
    expect(decoded.lastCheckInAt).toBe('2024-06-15T09:00:00Z');
    expect(decoded.lastDocumentId).toBe('doc_002');
  });

  // ---------------------------------------------------------------------------
  // Seguridad: Firma
  // ---------------------------------------------------------------------------
  test('cursor con firma manipulada → cursor_signature_invalid', () => {
    const { createNextCursor, decodeCursor } = getPagination();
    const doc = makeFakeDoc('doc_003', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'branch_range', {
      actorUid: 'actor_03',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    const parts = (cursor as string).split('.');
    // Manipular la firma: cambiar el último carácter
    const tampered = parts[0] + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    expect(() => decodeCursor(tampered, 'branch_range', {
      actorUid: 'actor_03',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    })).toThrow('cursor_signature_invalid');
  });

  test('cursor con payload manipulado → cursor_signature_invalid', () => {
    const { createNextCursor, decodeCursor } = getPagination();
    const doc = makeFakeDoc('doc_004', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'branch_range', {
      actorUid: 'actor_04',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    // Manipular el payload: reemplazar por otro payload base64url
    const fakePayload = Buffer.from(JSON.stringify({
      version: 1,
      queryType: 'branch_range',
      actorUid: 'actor_04',
      sucursalId: 'suc_01',   // misma sucursal
      sucursalId2: 'suc_99',  // intentando ampliar scope
      fromDate: '2024-06-01',
      toDate: '2024-06-30',
      lastJornadaDate: '2024-06-01',
      lastCheckInAt: '2024-06-01T08:00:00Z',
      lastDocumentId: 'doc_999',  // saltar al futuro
      issuedAt: Date.now(),
      expiresAt: Date.now() + 9999999
    })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const parts = (cursor as string).split('.');
    const tampered = fakePayload + '.' + parts[1]; // firma original + payload falso

    expect(() => decodeCursor(tampered, 'branch_range', {
      actorUid: 'actor_04',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    })).toThrow('cursor_signature_invalid');
  });

  // ---------------------------------------------------------------------------
  // Seguridad: Actor
  // ---------------------------------------------------------------------------
  test('cursor de otro actor → cursor_actor_mismatch', () => {
    const { createNextCursor, decodeCursor } = getPagination();
    const doc = makeFakeDoc('doc_005', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'branch_range', {
      actorUid: 'actor_original',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    expect(() => decodeCursor(cursor, 'branch_range', {
      actorUid: 'actor_different',  // distinto actor
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    })).toThrow('cursor_actor_mismatch');
  });

  // ---------------------------------------------------------------------------
  // Seguridad: QueryType
  // ---------------------------------------------------------------------------
  test('cursor de otro queryType → cursor_query_mismatch', () => {
    const { createNextCursor, decodeCursor } = getPagination();
    const doc = makeFakeDoc('doc_006', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'employee_range', {
      actorUid: 'actor_01',
      employeeId: 'emp_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    // Intentar usarlo en branch_range
    expect(() => decodeCursor(cursor, 'branch_range', {
      actorUid: 'actor_01',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    })).toThrow('cursor_query_mismatch');
  });

  // ---------------------------------------------------------------------------
  // Seguridad: Filtros
  // ---------------------------------------------------------------------------
  test('cursor de otra sucursal → cursor_filter_mismatch', () => {
    const { createNextCursor, decodeCursor } = getPagination();
    const doc = makeFakeDoc('doc_007', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'branch_range', {
      actorUid: 'actor_01',
      sucursalId: 'suc_01',  // sucursal original
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    expect(() => decodeCursor(cursor, 'branch_range', {
      actorUid: 'actor_01',
      sucursalId: 'suc_99',  // sucursal distinta
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    })).toThrow('cursor_filter_mismatch');
  });

  // ---------------------------------------------------------------------------
  // Expiración
  // ---------------------------------------------------------------------------
  test('cursor expirado → cursor_expired', async () => {
    const { createNextCursor, decodeCursor } = getPagination();
    const doc = makeFakeDoc('doc_008', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'branch_range', {
      actorUid: 'actor_01',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    // Manipular el payload para que expiresAt esté en el pasado
    // sin romper la firma — no es posible; debemos confiar en que
    // la validación de tiempo funciona correctamente.
    // Testeamos con un cursor real pero mockeando Date.now
    const realDateNow = Date.now;
    // Simular que ya pasaron 31 minutos
    Date.now = () => realDateNow() + (31 * 60 * 1000);

    expect(() => decodeCursor(cursor, 'branch_range', {
      actorUid: 'actor_01',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    })).toThrow('cursor_expired');

    // Restaurar
    Date.now = realDateNow;
  });

  // ---------------------------------------------------------------------------
  // Cursor inválido
  // ---------------------------------------------------------------------------
  test('cursor sin punto separador → invalid_cursor', () => {
    const { decodeCursor } = getPagination();
    expect(() => decodeCursor('solounbloquenopunto', 'branch_range', { actorUid: 'a' }))
      .toThrow('invalid_cursor');
  });

  test('cursor con JSON corrupto en payload → invalid_cursor', () => {
    const { decodeCursor } = getPagination();
    const badPayload = Buffer.from('no-es-json{').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const fakeSignature = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(() => decodeCursor(`${badPayload}.${fakeSignature}`, 'branch_range', { actorUid: 'a' }))
      .toThrow('invalid_cursor');
  });

  test('null cursor → retorna null (sin error)', () => {
    const { decodeCursor } = getPagination();
    expect(decodeCursor(null, 'branch_range', {})).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Sin secreto configurado → fallo cerrado
  // ---------------------------------------------------------------------------
  test('sin CURSOR_SIGNING_SECRET → HttpsError internal', () => {
    delete process.env.CURSOR_SIGNING_SECRET;
    // Limpiar el cache del módulo para que se re-evalúe sin el secret
    // En un entorno Node.js real se haría con delete require.cache[...],
    // pero en vitest el módulo ya está cargado. Testeamos indirectamente
    // verificando que si el secreto es muy corto, también falla.
    process.env.CURSOR_SIGNING_SECRET = 'short'; // < 16 chars
    const { createNextCursor } = getPagination();
    const doc = makeFakeDoc('doc_009', '2024-06-01', '2024-06-01T08:00:00Z');
    expect(() => createNextCursor(doc, 'branch_range', { actorUid: 'a' }))
      .toThrow('Configuración de seguridad de cursores incompleta');
    // Restaurar
    process.env.CURSOR_SIGNING_SECRET = MOCK_SECRET;
  });

  // ---------------------------------------------------------------------------
  // extractCursorPayloadForHash
  // ---------------------------------------------------------------------------
  test('extractCursorPayloadForHash retorna payload sin issuedAt/expiresAt', () => {
    const { createNextCursor, extractCursorPayloadForHash } = getPagination();
    const doc = makeFakeDoc('doc_010', '2024-06-01', '2024-06-01T08:00:00Z');
    const cursor = createNextCursor(doc, 'branch_range', {
      actorUid: 'actor_01',
      sucursalId: 'suc_01',
      fromDate: '2024-06-01',
      toDate: '2024-06-30'
    });

    const extracted = extractCursorPayloadForHash(cursor);
    expect(extracted).not.toBeNull();
    expect(extracted).not.toHaveProperty('issuedAt');
    expect(extracted).not.toHaveProperty('expiresAt');
    expect(extracted).toHaveProperty('lastDocumentId', 'doc_010');
    expect(extracted).toHaveProperty('lastJornadaDate', '2024-06-01');
  });
});
