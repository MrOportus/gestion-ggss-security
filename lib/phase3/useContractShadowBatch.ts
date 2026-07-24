import { useEffect, useRef, useState } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { 
  Contrato, 
  ContractEligibilityFeatureFlag,
  ContractShadowDiagnostic 
} from '../../types/phase1';
import { ContractEligibilityService } from './contractEligibilityService';
import { ContractBindingService } from './contractBindingService';

interface ProgramacionDoc {
  id?: string;
  employeeId: string;
  siteId: string | number;
  date: string;
  status: string;
}

interface ShadowBatchParams {
  employeeIds: string[];
  selectedSiteId: string | number;
  firstDay: string; // YYYY-MM-DD
  lastDay: string;  // YYYY-MM-DD
  contratos: Contrato[];
  programmingMap: Record<string, ProgramacionDoc>;
}

export function useContractShadowBatch({
  employeeIds,
  selectedSiteId,
  firstDay,
  lastDay,
  contratos,
  programmingMap
}: ShadowBatchParams) {
  const [featureFlag, setFeatureFlag] = useState<ContractEligibilityFeatureFlag | null>(null);
  
  const sequenceId = useRef(0);
  const cache = useRef<Record<string, boolean>>({});

  // 1. Escuchar el Feature Flag en tiempo real
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'FeatureFlags', 'contractEligibilityV2'), (docSnap) => {
      let data: ContractEligibilityFeatureFlag;
      
      if (docSnap.exists()) {
        data = docSnap.data() as ContractEligibilityFeatureFlag;
      } else {
        data = {
          mode: 'disabled',
          enabled: false,
          canaryBranches: [],
          canaryMonths: [],
          updatedAt: new Date().toISOString(),
          updatedBy: 'system',
          schemaVersion: 1
        };
      }

      setFeatureFlag(data);
    }, (err) => {
      console.error('ShadowBatch: Error leyendo FeatureFlag', err);
    });

    return () => unsub();
  }, [selectedSiteId, firstDay]);

  // 2. Ejecución Debounced del Lote
  useEffect(() => {
    if (!featureFlag?.enabled || featureFlag.mode !== 'shadow') {
      return;
    }

    if (featureFlag.expiresAt && new Date() >= new Date(featureFlag.expiresAt)) {
      console.log('ShadowBatch: Flag expirado defensivamente por tiempo (expiresAt superado).');
      return;
    }

    const seq = ++sequenceId.current;
    
    // Evitar loop si la memoria cambia muy seguido: debounce de 1.5s
    const timeoutId = setTimeout(() => {
      if (seq !== sequenceId.current) return;
      
      runBatch(
        employeeIds,
        selectedSiteId,
        firstDay,
        lastDay,
        contratos,
        programmingMap,
        featureFlag,
        cache.current,
        seq,
        sequenceId
      ).catch(err => {
        // Fall-open total: un error aquí no debe afectar a ShiftManagement
        console.error('ShadowBatch: Excepción no controlada en runBatch', err);
      });
      
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [
    employeeIds,
    selectedSiteId,
    firstDay,
    lastDay,
    contratos,
    programmingMap,
    featureFlag
  ]);

  return { featureFlag };
}

export async function runBatch(
  employeeIds: string[],
  selectedSiteId: string | number,
  firstDay: string,
  lastDay: string,
  contratos: Contrato[],
  programmingMap: Record<string, ProgramacionDoc>,
  featureFlag: ContractEligibilityFeatureFlag,
  cache: Record<string, boolean>,
  currentSeq: number,
  sequenceIdRef: React.MutableRefObject<number>
) {
  // Check cancelación temprana
  if (currentSeq !== sequenceIdRef.current) return;

  const diagnostics: ContractShadowDiagnostic[] = [];
  
  // Generar lista de días en el rango visible
  const dFirst = new Date(firstDay + 'T00:00:00');
  const dLast = new Date(lastDay + 'T00:00:00');
  const days: string[] = [];
  for (let d = new Date(dFirst); d <= dLast; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split('T')[0]);
  }

  // Iterar celdas visibles
  for (const empId of employeeIds) {
    for (const shiftDate of days) {
      if (currentSeq !== sequenceIdRef.current) return; // Cancelar si hubo nueva emisión

      // 1. Determinar Sucursal (Site Resolution)
      // Buscamos si existe en programmingMap
      // Nota: programmingMap keys son `${siteId}_${empId}_${date}`
      let resolvedSiteId = selectedSiteId.toString();
      
      const progKeys = Object.keys(programmingMap);
      const savedProgKey = progKeys.find(k => k.includes(`_${empId}_${shiftDate}`));
      if (savedProgKey && programmingMap[savedProgKey]) {
        resolvedSiteId = programmingMap[savedProgKey].siteId.toString();
      }

      // 2. Evaluación Legacy
      const legacyResult = ContractBindingService.evaluateTurno(
        empId,
        resolvedSiteId,
        shiftDate,
        contratos
      );
      
      // 3. Evaluación Canónica
      const canonicalResult = ContractEligibilityService.evaluateTurno(
        contratos,
        empId,
        resolvedSiteId,
        shiftDate
      );

      // 4. Comparación
      let translatedLegacyStatus = 'sin_contrato';
      switch (legacyResult.estado) {
        case 'compatible': translatedLegacyStatus = 'vigente'; break;
        case 'otra_sucursal': translatedLegacyStatus = 'sucursal_no_coincide'; break;
        case 'sin_contrato': translatedLegacyStatus = 'sin_contrato'; break;
        case 'multiples': translatedLegacyStatus = 'contratos_superpuestos'; break;
        default: translatedLegacyStatus = legacyResult.estado;
      }

      const isMatch = translatedLegacyStatus === canonicalResult.eligibilityStatus;
      let classification: ContractShadowDiagnostic['classification'] = isMatch ? 'match' : 'mismatch';
      let reasonCode = canonicalResult.reasonCode;

      if (!isMatch) {
        if (translatedLegacyStatus === 'vigente' && canonicalResult.eligibilityStatus === 'vencido') {
          classification = 'mismatch';
          reasonCode = 'status_mismatch' as any;
        } else if (canonicalResult.eligibilityStatus === 'contratos_superpuestos') {
          classification = 'mismatch';
          reasonCode = 'overlapping_contracts' as any;
        } else if (translatedLegacyStatus === 'sucursal_no_coincide' && canonicalResult.eligibilityStatus === 'vigente') {
          classification = 'mismatch';
        } else {
          reasonCode = canonicalResult.reasonCode || 'unexpected_difference' as any;
        }
      }

      // 5. Fingerprint
      const fingerprintObj = {
        empId,
        resolvedSiteId,
        shiftDate,
        legacyStatus: legacyResult.estado,
        canonicalStatus: canonicalResult.eligibilityStatus,
        classification,
        engineVersion: featureFlag.schemaVersion || 1
      };
      const fingerprint = btoa(JSON.stringify(fingerprintObj));

      // Solo registramos mismatches para ahorrar escrituras en Etapa C
      if (!isMatch && !cache[fingerprint]) {
        const diagId = `contract_shadow_${empId}_${resolvedSiteId}_${shiftDate}_${featureFlag.schemaVersion || 1}_${fingerprint.substring(0,8)}`;
        
        diagnostics.push({
          id: diagId,
          employeeId: empId,
          sucursalId: resolvedSiteId,
          shiftDate,
          legacyStatus: legacyResult.estado,
          canonicalStatus: canonicalResult.eligibilityStatus,
          classification,
          reasonCode: reasonCode,
          legacySource: 'ContractBindingService',
          canonicalContractId: canonicalResult.contratoId,
          featureMode: featureFlag.mode,
          requestId: diagId,
          createdAt: new Date().toISOString(),
          expiresAt: '', // Lo calcula el backend
          schemaVersion: 1
        });

        cache[fingerprint] = true;
      }
    }
  }

  // 6. Enviar a Backend en lotes
  if (diagnostics.length > 0 && currentSeq === sequenceIdRef.current) {
    const logContractShadowDiagnostic = httpsCallable(functions, 'logContractShadowDiagnostic');
    
    // Concurrency control
    const CHUNK_SIZE = 5;
    for (let i = 0; i < diagnostics.length; i += CHUNK_SIZE) {
      if (currentSeq !== sequenceIdRef.current) break;
      
      const chunk = diagnostics.slice(i, i + CHUNK_SIZE);
      const promises = chunk.map(diag => 
        logContractShadowDiagnostic({
          diagnosticId: diag.id,
          employeeId: diag.employeeId,
          sucursalId: diag.sucursalId,
          shiftDate: diag.shiftDate,
          legacyStatus: diag.legacyStatus,
          canonicalStatus: diag.canonicalStatus,
          classification: diag.classification,
          reasonCode: diag.reasonCode,
          legacySource: diag.legacySource,
          canonicalContractId: diag.canonicalContractId,
          featureMode: diag.featureMode,
          requestId: diag.requestId
        }).catch(err => {
          console.error(`ShadowBatch: Fallo al guardar diag ${diag.id}`, err);
          // Eliminar de caché si falló para poder reintentar
          const fp = btoa(JSON.stringify({
            empId: diag.employeeId,
            resolvedSiteId: diag.sucursalId,
            shiftDate: diag.shiftDate,
            legacyStatus: diag.legacyStatus,
            canonicalStatus: diag.canonicalStatus,
            classification: diag.classification,
            engineVersion: featureFlag.schemaVersion || 1
          }));
          delete cache[fp];
        })
      );

      await Promise.allSettled(promises);
    }
  }
}
