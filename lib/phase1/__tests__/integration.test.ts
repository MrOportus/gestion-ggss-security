import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { AssignmentRepository } from '../repositories/assignmentRepository';
import * as fs from 'fs';
import * as path from 'path';
import { getDocs, collection, query, where } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = path.resolve(__dirname, '../../../firestore.phase1.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');
  
  testEnv = await initializeTestEnvironment({
    projectId: `ggss-integ-${Date.now()}`,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Integración - Concurrencia e Idempotencia', () => {

  it('Transacción de Asignación Operacional previene race conditions y duplicados silenciosos', async () => {
    // Usamos el contexto de seguridad desactivado para probar puramente la concurrencia del repo
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const repo = new AssignmentRepository(db as any);

      // Lanzar 3 promesas estrictamente simultáneas intentando crear la misma asignación
      const p1 = repo.createAssignmentAtomically('emp1', 'suc1', '2023-11', 'admin_uid');
      const p2 = repo.createAssignmentAtomically('emp1', 'suc1', '2023-11', 'admin_uid');
      const p3 = repo.createAssignmentAtomically('emp1', 'suc1', '2023-11', 'admin_uid');

      const results = await Promise.allSettled([p1, p2, p3]);

      // 1. Debe haber exactamente 1 promesa resuelta (éxito) y 2 rechazadas (error de duplicidad transaccional)
      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(2);

      // 2. Comprobar físicamente en la BD que solo existe un registro para esa combinación
      const idEsperado = 'assignment_emp1_suc1_2023-11';
      const q = query(collection(db, 'AsignacionesOperacionales'), where('colaboradorId', '==', 'emp1'));
      const snapshot = await getDocs(q);
      
      expect(snapshot.size).toBe(1);
      expect(snapshot.docs[0].id).toBe(idEsperado);
    });
  });

});
