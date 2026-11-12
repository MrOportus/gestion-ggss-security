// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { setDoc, doc, updateDoc, arrayUnion } from 'firebase/firestore';

describe('Firestore Rules - /novedades/{docId} evidencias (Caso 4)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-ggss-novedades-evidencias',
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'Colaboradores', 'guardiaAutor'), { role: 'guardia' });
      await setDoc(doc(db, 'Colaboradores', 'otroGuardia'), { role: 'guardia' });
      await setDoc(doc(db, 'Colaboradores', 'mandanteUser'), { role: 'mandante' });
      await setDoc(doc(db, 'Colaboradores', 'adminUser'), { role: 'admin' });

      await setDoc(doc(db, 'novedades', 'nov_1'), {
        id: 'nov_1',
        autorUid: 'guardiaAutor',
        colaboradorId: 'guardiaAutor',
        sucursalId: '1',
        siteId: '1',
        descripcion: 'prueba carga imagen',
        creadoEn: '2026-11-12T13:39:54.492Z',
        estado: 'registrada',
      });

      await setDoc(doc(db, 'novedades', 'nov_con_foto'), {
        id: 'nov_con_foto',
        autorUid: 'guardiaAutor',
        colaboradorId: 'guardiaAutor',
        sucursalId: '1',
        siteId: '1',
        descripcion: 'ya tiene una foto',
        evidencias: ['https://firebasestorage.googleapis.com/foto1.jpg'],
        creadoEn: '2026-11-12T13:39:54.492Z',
        estado: 'registrada',
      });
    });
  });

  it('permite al autor adjuntar la primera evidencia con arrayUnion', async () => {
    const db = testEnv.authenticatedContext('guardiaAutor').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'novedades', 'nov_1'), {
        evidencias: arrayUnion('https://firebasestorage.googleapis.com/foto1.jpg'),
      })
    );
  });

  it('permite al autor agregar una segunda evidencia sin borrar la existente', async () => {
    const db = testEnv.authenticatedContext('guardiaAutor').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'novedades', 'nov_con_foto'), {
        evidencias: arrayUnion('https://firebasestorage.googleapis.com/foto2.jpg'),
      })
    );
  });

  it('rechaza que otro guardia modifique evidencias de una novedad ajena', async () => {
    const db = testEnv.authenticatedContext('otroGuardia').firestore();
    await assertFails(
      updateDoc(doc(db, 'novedades', 'nov_1'), {
        evidencias: arrayUnion('https://firebasestorage.googleapis.com/ajena.jpg'),
      })
    );
  });

  it('rechaza eliminar evidencias existentes', async () => {
    const db = testEnv.authenticatedContext('guardiaAutor').firestore();
    await assertFails(
      updateDoc(doc(db, 'novedades', 'nov_con_foto'), {
        evidencias: [],
      })
    );
  });

  it('rechaza que mandante escriba evidencias incluso si figurara como autor', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'novedades', 'nov_mandante'), {
        id: 'nov_mandante',
        autorUid: 'mandanteUser',
        colaboradorId: 'mandanteUser',
        creadoEn: '2026-11-12T13:39:54.492Z',
      });
    });

    const db = testEnv.authenticatedContext('mandanteUser').firestore();
    await assertFails(
      updateDoc(doc(db, 'novedades', 'nov_mandante'), {
        evidencias: arrayUnion('https://firebasestorage.googleapis.com/foto.jpg'),
      })
    );
  });
});

