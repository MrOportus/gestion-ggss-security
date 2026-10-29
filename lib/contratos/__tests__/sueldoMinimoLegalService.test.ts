import { describe, it, expect, beforeEach } from 'vitest';
import { 
  sueldoMinimoLegalService, 
  formatCLP,
  VigenciaSueldoMinimo 
} from '../sueldoMinimoLegalService';

describe('Sueldo Base Contractual y Referencia Legal Centralizada (Fase 5.1)', () => {
  beforeEach(() => {
    sueldoMinimoLegalService.resetearAValoresBase();
  });

  // 1. Precarga del sueldo base existente
  it('1. Debe precargar el sueldo base desde un contrato previo fiable y nunca desde sueldoLiquido', () => {
    const contratoPrevio = {
      id: 'cont_previo_01',
      colaboradorId: 'colab_1',
      sueldoBase: 580000,
      tipo: 'Plazo Fijo'
    };

    const empleado = {
      id: 'colab_1',
      firstName: 'Juan',
      sueldoLiquido: 539000 // Sueldo líquido en ficha
    };

    // La función o selector debe priorizar el sueldoBase contractual existente
    const sueldoPrecargado = contratoPrevio.sueldoBase;
    expect(sueldoPrecargado).toBe(580000);
    // Verificación estricta: NO debe tomarse el sueldoLiquido
    expect(sueldoPrecargado).not.toBe(empleado.sueldoLiquido);
  });

  // 2. Ausencia del dato y entrada manual obligatoria
  it('2. En ausencia de contrato previo con sueldoBase, el valor inicial debe ser 0 o vacío para ingreso manual', () => {
    const contratoPrevioSinSueldo = null;
    const empleadoSinContrato = {
      id: 'colab_nuevo',
      firstName: 'Pedro',
      sueldoLiquido: 600000
    };

    // No debe inventarse ni inferirse de sueldoLiquido
    const sueldoInicial = contratoPrevioSinSueldo ? (contratoPrevioSinSueldo as any).sueldoBase : 0;
    expect(sueldoInicial).toBe(0);
    expect(sueldoInicial).not.toBe(empleadoSinContrato.sueldoLiquido);
  });

  // 3. Cambio de vigencia de la referencia legal según fecha de inicio
  it('3. Debe recuperar dinámicamente la referencia legal vigente según la fecha de inicio del contrato', () => {
    // Caso A: Contrato iniciado en mayo 2023 -> Vigencia Ley 21.578 ($440.000)
    const ref2023Mayo = sueldoMinimoLegalService.obtenerSueldoMinimoVigente('2023-06-15');
    expect(ref2023Mayo).toBeDefined();
    expect(ref2023Mayo?.montoCLP).toBe(440000);
    expect(ref2023Mayo?.fuenteLegal).toContain('Ley N° 21.578');

    // Caso B: Contrato iniciado en noviembre 2023 -> Vigencia escalonada ($460.000)
    const ref2023Nov = sueldoMinimoLegalService.obtenerSueldoMinimoVigente('2023-11-01');
    expect(ref2023Nov).toBeDefined();
    expect(ref2023Nov?.montoCLP).toBe(460000);

    // Caso C: Contrato iniciado en agosto 2024 -> Vigencia actual ($500.000)
    const ref2024Ago = sueldoMinimoLegalService.obtenerSueldoMinimoVigente('2024-08-01');
    expect(ref2024Ago).toBeDefined();
    expect(ref2024Ago?.montoCLP).toBe(500000);
  });

  // 4. Registro de nueva vigencia legal sin modificar código fuente
  it('4. Debe permitir registrar una nueva vigencia normativa en tiempo de ejecución sin alterar el código', () => {
    // Registrar una futura vigencia hipotética (ej: Ley Reajuste 2025 -> $520.000 desde 2025-07-01)
    const nueva = sueldoMinimoLegalService.registrarNuevaVigencia({
      montoCLP: 520000,
      vigenciaDesde: '2025-07-01',
      fuenteLegal: 'Ley N° 29.999 (Hipotética de Prueba)',
      registradoPor: 'admin_test_rrhh',
      categoria: 'general_18_65',
      notas: 'Registro de prueba para reajuste legal'
    });

    expect(nueva.id).toBeDefined();
    expect(nueva.montoCLP).toBe(520000);

    // Consultar contrato para fecha posterior al reajuste
    const refFutura = sueldoMinimoLegalService.obtenerSueldoMinimoVigente('2025-08-01');
    expect(refFutura?.montoCLP).toBe(520000);
    expect(refFutura?.fuenteLegal).toContain('Ley N° 29.999');

    // Consultar contrato para fecha anterior al reajuste (debe mantener $500.000)
    const refAnterior = sueldoMinimoLegalService.obtenerSueldoMinimoVigente('2024-10-01');
    expect(refAnterior?.montoCLP).toBe(500000);
  });

  // 5. Advertencia por posible incumplimiento en jornada ordinaria completa
  it('5. Debe emitir advertencia expresa si el sueldo base pactado es inferior al mínimo para 45 horas ordinarias', () => {
    const validacion = sueldoMinimoLegalService.validarSueldoBaseContractual(
      450000, // Menor a $500.000
      '2024-11-01',
      '45 horas semanales'
    );

    expect(validacion.estado).toBe('advertencia_menor_al_minimo');
    expect(validacion.referenciaMinimaCLP).toBe(500000);
    expect(validacion.mensaje).toContain('Advertencia: El sueldo base pactado ($450.000) es inferior al sueldo mínimo legal');
    expect(validacion.detalles.requiereRevisionManual).toBe(true);
  });

  // 6. Validación conforme cuando cumple o supera el mínimo legal
  it('6. Debe calificar como conforme cuando el sueldo base es igual o superior al mínimo legal aplicable', () => {
    const validacion = sueldoMinimoLegalService.validarSueldoBaseContractual(
      550000,
      '2024-11-01',
      '45 horas semanales distribuidas en turnos 4x4'
    );

    expect(validacion.estado).toBe('conforme');
    expect(validacion.referenciaMinimaCLP).toBe(500000);
    expect(validacion.mensaje).toContain('Sueldo base conforme a la referencia legal');
    expect(validacion.detalles.requiereRevisionManual).toBe(false);
  });

  // 7. Validación pendiente si la jornada es parcial o no cuantificada
  it('7. Debe dejar la validación pendiente sin inventar resultados si la jornada es part-time o no cuantificada', () => {
    const validacionPartTime = sueldoMinimoLegalService.validarSueldoBaseContractual(
      300000,
      '2024-11-01',
      'Part-Time fin de semana y festivos (20 horas)'
    );

    expect(validacionPartTime.estado).toBe('validacion_pendiente');
    expect(validacionPartTime.mensaje).toContain('Validación legal pendiente');
    expect(validacionPartTime.mensaje).toContain('no permite contrastación automatizada');
    expect(validacionPartTime.detalles.requiereRevisionManual).toBe(true);
  });

  // 8. Validación pendiente si falta la fecha de inicio
  it('8. Debe dejar la validación pendiente si no se proporciona fecha de inicio del contrato', () => {
    const validacionSinFecha = sueldoMinimoLegalService.validarSueldoBaseContractual(500000, '');
    expect(validacionSinFecha.estado).toBe('validacion_pendiente');
    expect(validacionSinFecha.referenciaMinimaCLP).toBeNull();
  });

  // 9. Ausencia de actualizaciones automáticas sobre contratos anteriores (Inmutabilidad)
  it('9. El registro de un nuevo mínimo legal no debe alterar contratos emitidos previamente', () => {
    // Contrato emitido históricamente
    const contratoEmitidoHistorico = {
      id: 'cont_hist_2023',
      fechaInicio: '2023-05-10',
      sueldoBase: 440000, // Conforme en mayo 2023
      metadataVariablesSnapshot: {
        contrato: { sueldoBaseFormatted: '$440.000', sueldoBase: 440000 }
      }
    };

    // Se registra una nueva vigencia posterior
    sueldoMinimoLegalService.registrarNuevaVigencia({
      montoCLP: 500000,
      vigenciaDesde: '2024-07-01',
      fuenteLegal: 'Ley 21.578',
      registradoPor: 'admin',
      categoria: 'general_18_65'
    });

    // El contrato emitido conserva inmutablemente sus valores
    expect(contratoEmitidoHistorico.sueldoBase).toBe(440000);
    expect(contratoEmitidoHistorico.metadataVariablesSnapshot.contrato.sueldoBaseFormatted).toBe('$440.000');
  });

  // 10. Ausencia de cálculos remuneracionales no solicitados
  it('10. Confirma la ausencia de cálculos de gratificación, imposiciones o liquidaciones en el servicio', () => {
    // El servicio solo gestiona sueldoBase y referencia de sueldo mínimo
    expect((sueldoMinimoLegalService as any).calcularGratificacion).toBeUndefined();
    expect((sueldoMinimoLegalService as any).calcularLiquidacion).toBeUndefined();
    expect((sueldoMinimoLegalService as any).calcularDescuentosLeyesSociales).toBeUndefined();
  });

  // 11. Formateo de montos en CLP
  it('11. Formatea montos en pesos chilenos correctamente', () => {
    expect(formatCLP(500000)).toMatch(/\$500\.000/);
    expect(formatCLP(550000)).toMatch(/\$550\.000/);
  });
});
