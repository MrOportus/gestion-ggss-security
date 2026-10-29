/**
 * ASPRO — CONTRATOS V2
 * Servicio y Referencia Legal Centralizada de Sueldo Mínimo
 * 
 * Gestiona la configuración desacoplada del sueldo mínimo legal en Chile,
 * permitiendo registrar nuevas vigencias normativas sin alterar el código fuente
 * ni modificar automáticamente contratos emitidos previamente.
 */

export interface VigenciaSueldoMinimo {
  id: string;
  montoCLP: number;
  vigenciaDesde: string; // YYYY-MM-DD
  vigenciaHasta?: string | null; // YYYY-MM-DD o null si vigente indefinido
  fuenteLegal: string; // ej: "Ley N° 21.578, D.O. 30/05/2023"
  registradoEn: string; // ISO Timestamp
  registradoPor: string; // UID del usuario que registró
  categoria: 'general_18_65' | 'menores_18_mayores_65' | 'fines_no_remuneracionales';
  notas?: string;
}

export interface ConfiguracionSueldoMinimo {
  version: number;
  vigencias: VigenciaSueldoMinimo[];
  actualizadoEn: string;
  actualizadoPor: string;
}

export type EstadoValidacionSueldo = 'conforme' | 'advertencia_menor_al_minimo' | 'validacion_pendiente';

export interface ValidacionSueldoBaseResult {
  estado: EstadoValidacionSueldo;
  sueldoBaseIngresado: number;
  referenciaMinimaCLP: number | null;
  vigenciaAplicable: VigenciaSueldoMinimo | null;
  mensaje: string;
  detalles: {
    jornadaEvaluada?: string;
    esJornadaCompletaIdentificada: boolean;
    requiereRevisionManual: boolean;
  };
}

/**
 * Registro histórico oficial de vigencias del Sueldo Mínimo Legal en Chile.
 * Fuente: Ministerio del Trabajo y Previsión Social / Dirección del Trabajo.
 */
const VIGENCIAS_HISTORICAS_BASE: VigenciaSueldoMinimo[] = [
  {
    id: 'imm_ley21578_2024_07',
    montoCLP: 500000,
    vigenciaDesde: '2024-07-01',
    vigenciaHasta: null,
    fuenteLegal: 'Ley N° 21.578, Art. 1° letra c) (D.O. 30/05/2023)',
    registradoEn: '2024-07-01T00:00:00.000Z',
    registradoPor: 'sistema_referencia_legal',
    categoria: 'general_18_65',
    notas: 'Ingreso Mínimo Mensual para trabajadores mayores de 18 y hasta 65 años de edad.'
  },
  {
    id: 'imm_ley21578_2023_09',
    montoCLP: 460000,
    vigenciaDesde: '2023-09-01',
    vigenciaHasta: '2024-06-30',
    fuenteLegal: 'Ley N° 21.578, Art. 1° letra b) (D.O. 30/05/2023)',
    registradoEn: '2023-09-01T00:00:00.000Z',
    registradoPor: 'sistema_referencia_legal',
    categoria: 'general_18_65',
    notas: 'Reajuste escalonado de 2023.'
  },
  {
    id: 'imm_ley21578_2023_05',
    montoCLP: 440000,
    vigenciaDesde: '2023-05-01',
    vigenciaHasta: '2023-08-31',
    fuenteLegal: 'Ley N° 21.578, Art. 1° letra a) (D.O. 30/05/2023)',
    registradoEn: '2023-05-01T00:00:00.000Z',
    registradoPor: 'sistema_referencia_legal',
    categoria: 'general_18_65',
    notas: 'Inicio de implementación de Ley 21.578.'
  },
  {
    id: 'imm_ley21456_2023_01',
    montoCLP: 410000,
    vigenciaDesde: '2023-01-01',
    vigenciaHasta: '2023-04-30',
    fuenteLegal: 'Ley N° 21.456, Art. 1° (D.O. 28/05/2022)',
    registradoEn: '2023-01-01T00:00:00.000Z',
    registradoPor: 'sistema_referencia_legal',
    categoria: 'general_18_65',
    notas: 'Reajuste por variación de IPC.'
  }
];

class SueldoMinimoLegalService {
  // Almacén en memoria configurable (local/desacoplado)
  private vigencias: VigenciaSueldoMinimo[] = [...VIGENCIAS_HISTORICAS_BASE];
  private version: number = 1;
  private storageKey = 'aspro_config_sueldo_minimo_v1';
  private sueldoBasePreconfiguradoKey = 'aspro_sueldo_base_preconfigurado_v2';
  private sueldoBasePreconfigurado: number = 500000;

  constructor() {
    this.cargarConfiguracionLocal();
  }

  private cargarConfiguracionLocal(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const guardado = window.localStorage.getItem(this.storageKey);
        if (guardado) {
          const parsed = JSON.parse(guardado) as ConfiguracionSueldoMinimo;
          if (Array.isArray(parsed.vigencias) && parsed.vigencias.length > 0) {
            this.vigencias = parsed.vigencias;
            this.version = parsed.version || 1;
          }
        }
        const sueldoGuardado = window.localStorage.getItem(this.sueldoBasePreconfiguradoKey);
        if (sueldoGuardado) {
          const num = Number(sueldoGuardado);
          if (!isNaN(num) && num > 0) {
            this.sueldoBasePreconfigurado = Math.round(num);
          }
        } else {
          const vigente = this.obtenerSueldoMinimoVigente();
          if (vigente && vigente.montoCLP > 0) {
            this.sueldoBasePreconfigurado = vigente.montoCLP;
          }
        }
      } catch (err) {
        console.warn('[SueldoMinimoLegalService] No se pudo cargar configuración local:', err);
      }
    }
  }

  /**
   * Obtiene el Sueldo Base preconfigurado permanentemente para precargar en nuevos contratos
   */
  public obtenerSueldoBasePreconfigurado(): number {
    if (typeof window !== 'undefined' && window.localStorage) {
      const guardado = window.localStorage.getItem(this.sueldoBasePreconfiguradoKey);
      if (guardado) {
        const num = Number(guardado);
        if (!isNaN(num) && num > 0) {
          this.sueldoBasePreconfigurado = Math.round(num);
          return this.sueldoBasePreconfigurado;
        }
      }
    }
    return this.sueldoBasePreconfigurado;
  }

  /**
   * Guarda de forma permanente el Sueldo Base preconfigurado para todas las futuras emisiones
   */
  public guardarSueldoBasePreconfigurado(montoCLP: number, usuarioUid: string = 'admin_rrhh'): number {
    const limpio = Math.round(Number(montoCLP) || 0);
    if (limpio <= 0) {
      throw new Error('El sueldo base preconfigurado debe ser mayor a $0 CLP.');
    }
    this.sueldoBasePreconfigurado = limpio;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(this.sueldoBasePreconfiguradoKey, String(limpio));
      } catch (err) {
        console.warn('[SueldoMinimoLegalService] Error guardando sueldo base preconfigurado:', err);
      }
    }
    // Actualizar también la vigencia actual de referencia para mantener coherencia visual
    const hoy = new Date().toISOString().split('T')[0];
    const vigenteActual = this.obtenerSueldoMinimoVigente(hoy);
    if (vigenteActual) {
      vigenteActual.montoCLP = limpio;
      this.guardarConfiguracionLocal(usuarioUid);
    }
    return this.sueldoBasePreconfigurado;
  }

  private guardarConfiguracionLocal(usuarioUid: string): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const config: ConfiguracionSueldoMinimo = {
          version: this.version + 1,
          vigencias: this.vigencias,
          actualizadoEn: new Date().toISOString(),
          actualizadoPor: usuarioUid
        };
        window.localStorage.setItem(this.storageKey, JSON.stringify(config));
        this.version = config.version;
      } catch (err) {
        console.warn('[SueldoMinimoLegalService] No se pudo persistir configuración local:', err);
      }
    }
  }

  /**
   * Obtiene la vigencia legal aplicable para una fecha de referencia contractual específica.
   * Si no se especifica fecha, se asume la fecha actual del sistema.
   */
  public obtenerSueldoMinimoVigente(
    fechaReferencia?: string,
    categoria: VigenciaSueldoMinimo['categoria'] = 'general_18_65'
  ): VigenciaSueldoMinimo | null {
    const refDate = fechaReferencia || new Date().toISOString().split('T')[0];

    const candidatas = this.vigencias
      .filter(v => v.categoria === categoria && v.vigenciaDesde <= refDate)
      .filter(v => !v.vigenciaHasta || v.vigenciaHasta >= refDate)
      .sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde));

    if (candidatas.length > 0) {
      return candidatas[0];
    }

    // Si no coincide por rango cerrado, retornar la última anterior
    const anteriores = this.vigencias
      .filter(v => v.categoria === categoria && v.vigenciaDesde <= refDate)
      .sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde));

    return anteriores.length > 0 ? anteriores[0] : null;
  }

  /**
   * Registra una nueva vigencia legal del sueldo mínimo sin necesidad de modificar el código fuente.
   * Ajusta de forma ordenada las fechas de término de las vigencias precedentes.
   */
  public registrarNuevaVigencia(
    datos: Omit<VigenciaSueldoMinimo, 'id' | 'registradoEn' | 'categoria'> & {
      categoria?: VigenciaSueldoMinimo['categoria'];
    }
  ): VigenciaSueldoMinimo {
    if (!datos.montoCLP || datos.montoCLP <= 0) {
      throw new Error('El monto en CLP del sueldo mínimo debe ser un número positivo.');
    }
    if (!datos.vigenciaDesde || !/^\d{4}-\d{2}-\d{2}$/.test(datos.vigenciaDesde)) {
      throw new Error('La fecha vigenciaDesde debe tener formato YYYY-MM-DD.');
    }
    if (!datos.fuenteLegal || datos.fuenteLegal.trim() === '') {
      throw new Error('Debe especificarse la fuente legal oficial (ej. número de Ley o Decreto).');
    }

    const nuevaId = `imm_manual_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const nuevaVigencia: VigenciaSueldoMinimo = {
      id: nuevaId,
      montoCLP: Math.round(datos.montoCLP),
      vigenciaDesde: datos.vigenciaDesde,
      vigenciaHasta: datos.vigenciaHasta || null,
      fuenteLegal: datos.fuenteLegal.trim(),
      registradoEn: nowIso,
      registradoPor: datos.registradoPor || 'admin_desconocido',
      categoria: datos.categoria || 'general_18_65',
      notas: datos.notas || undefined
    };

    // Cerrar la vigencia anterior inmediata si no tenía fecha de término
    this.vigencias = this.vigencias.map(v => {
      if (v.categoria === nuevaVigencia.categoria && v.vigenciaDesde < nuevaVigencia.vigenciaDesde && !v.vigenciaHasta) {
        // Calcular día anterior
        const d = new Date(nuevaVigencia.vigenciaDesde + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        const diaAnterior = d.toISOString().split('T')[0];
        return { ...v, vigenciaHasta: diaAnterior };
      }
      return v;
    });

    this.vigencias.unshift(nuevaVigencia);
    this.guardarConfiguracionLocal(nuevaVigencia.registradoPor);

    return nuevaVigencia;
  }

  /**
   * Obtiene el listado completo de vigencias históricas registradas.
   */
  public listarHistorialVigencias(): VigenciaSueldoMinimo[] {
    return [...this.vigencias].sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde));
  }

  /**
   * Restablece la configuración a los valores oficiales base (útil para pruebas y reset).
   */
  public resetearAValoresBase(): void {
    this.vigencias = VIGENCIAS_HISTORICAS_BASE.map(v => ({ ...v }));
    this.sueldoBasePreconfigurado = 500000;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.storageKey);
      window.localStorage.removeItem(this.sueldoBasePreconfiguradoKey);
    }
  }

  /**
   * Valida el sueldo base contractual frente a la referencia legal aplicable.
   * Emite una advertencia sin bloquear la emisión ni inventar resultados si los datos son insuficientes.
   */
  public validarSueldoBaseContractual(
    sueldoBase: number,
    fechaInicioContrato?: string,
    jornadaTexto?: string
  ): ValidacionSueldoBaseResult {
    const base = Number(sueldoBase) || 0;

    if (!fechaInicioContrato) {
      return {
        estado: 'validacion_pendiente',
        sueldoBaseIngresado: base,
        referenciaMinimaCLP: null,
        vigenciaAplicable: null,
        mensaje: 'Validación pendiente: Ingrese la fecha de inicio del contrato para determinar la referencia legal aplicable.',
        detalles: {
          jornadaEvaluada: jornadaTexto,
          esJornadaCompletaIdentificada: false,
          requiereRevisionManual: true
        }
      };
    }

    const vigencia = this.obtenerSueldoMinimoVigente(fechaInicioContrato);
    if (!vigencia) {
      return {
        estado: 'validacion_pendiente',
        sueldoBaseIngresado: base,
        referenciaMinimaCLP: null,
        vigenciaAplicable: null,
        mensaje: `Validación pendiente: No se dispone de referencia de sueldo mínimo legal registrada para la fecha ${fechaInicioContrato}.`,
        detalles: {
          jornadaEvaluada: jornadaTexto,
          esJornadaCompletaIdentificada: false,
          requiereRevisionManual: true
        }
      };
    }

    const jornadaLimpia = (jornadaTexto || '').toLowerCase().trim();

    // Detección cautelosa de jornada ordinaria completa
    const esJornada45 = jornadaLimpia.includes('45');
    const esJornada44 = jornadaLimpia.includes('44');
    const esJornada40 = jornadaLimpia.includes('40');
    const esCompleta = esJornada45 || esJornada44 || esJornada40 || jornadaLimpia.includes('completa');
    const esPartTime = jornadaLimpia.includes('part-time') || jornadaLimpia.includes('parcial') || jornadaLimpia.includes('20') || jornadaLimpia.includes('30');

    // Si la jornada no está claramente definida o es parcial, la validación queda pendiente de revisión manual
    if (!esCompleta || esPartTime || !jornadaTexto) {
      return {
        estado: 'validacion_pendiente',
        sueldoBaseIngresado: base,
        referenciaMinimaCLP: vigencia.montoCLP,
        vigenciaAplicable: vigencia,
        mensaje: `Validación legal pendiente: La jornada pactada ("${jornadaTexto || 'No especificada'}") no permite contrastación automatizada frente al mínimo ordinario de $${vigencia.montoCLP.toLocaleString('es-CL')}. Verifique manualmente la proporcionalidad horaria antes de emitir.`,
        detalles: {
          jornadaEvaluada: jornadaTexto,
          esJornadaCompletaIdentificada: false,
          requiereRevisionManual: true
        }
      };
    }

    // Para jornada ordinaria completa:
    if (base >= vigencia.montoCLP) {
      return {
        estado: 'conforme',
        sueldoBaseIngresado: base,
        referenciaMinimaCLP: vigencia.montoCLP,
        vigenciaAplicable: vigencia,
        mensaje: `Sueldo base conforme a la referencia legal ($${vigencia.montoCLP.toLocaleString('es-CL')} vigente desde ${vigencia.vigenciaDesde} según ${vigencia.fuenteLegal}).`,
        detalles: {
          jornadaEvaluada: jornadaTexto,
          esJornadaCompletaIdentificada: true,
          requiereRevisionManual: false
        }
      };
    }

    // Si es inferior: emitir advertencia expresa sin bloquear
    return {
      estado: 'advertencia_menor_al_minimo',
      sueldoBaseIngresado: base,
      referenciaMinimaCLP: vigencia.montoCLP,
      vigenciaAplicable: vigencia,
      mensaje: `Advertencia: El sueldo base pactado ($${base.toLocaleString('es-CL')}) es inferior al sueldo mínimo legal de referencia ($${vigencia.montoCLP.toLocaleString('es-CL')} vigente desde ${vigencia.vigenciaDesde} según ${vigencia.fuenteLegal}). Verifique si aplica jornada parcial, asignación especial o condición particular antes de emitir.`,
      detalles: {
        jornadaEvaluada: jornadaTexto,
        esJornadaCompletaIdentificada: true,
        requiereRevisionManual: true
      }
    };
  }
}

// Instancia singleton para la aplicación cliente
export const sueldoMinimoLegalService = new SueldoMinimoLegalService();

/**
 * Formateador de moneda en pesos chilenos para inserción textual en interfaz y plantilla Word.
 */
export function formatCLP(monto: number): string {
  return `$${Math.round(Number(monto) || 0).toLocaleString('es-CL')}`;
}
