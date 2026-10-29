/**
 * ASPRO — CONTRATOS V2 — FASE 5.2
 * Servicio de Persistencia e Historial de Emisiones de Laboratorio en IndexedDB
 * 
 * Almacena en IndexedDB (localforage) de forma persistente:
 * - Metadatos de la emisión de prueba
 * - DOCX rellenado (binario ArrayBuffer)
 * - PDF generado por Gotenberg (binario ArrayBuffer)
 * - Hash criptográfico SHA-256 verificado sobre los bytes reales
 * - Generación de URLs seguras revocables para descarga inmediata
 */

import localforage from 'localforage';
import { calcularSha256 } from './localContractTemplateService';
import type { SharedSignatureConfig } from '../../components/SharedSignatureBatchModal';

export interface ContractSignatureConfig extends SharedSignatureConfig {
  targetPageResolved?: number;
  pageWidth?: number;
  pageHeight?: number;
  orientation?: 'portrait' | 'landscape';
}

export const SIG_BOX_WIDTH = 120;
export const SIG_BOX_HEIGHT = 50;

/**
 * Crea la configuración inicial de firma por defecto para una nueva emisión contractual
 */
export function crearSignatureConfigInicial(
  pageWidth = 595,
  pageHeight = 842
): SharedSignatureConfig {
  return {
    page: 'last',
    pageNumber: 1,
    posicionX: Math.max(10, Math.min(pageWidth - SIG_BOX_WIDTH - 10, 115)),
    posicionY: Math.max(10, Math.min(pageHeight - SIG_BOX_HEIGHT - 10, 230))
  };
}

/**
 * Resuelve el número real de página (1-based) donde se estampará la firma
 */
export function resolverPaginaObjetivoFirma(
  config: Pick<SharedSignatureConfig, 'page' | 'pageNumber'>,
  totalPages: number
): number {
  const total = Math.max(1, totalPages || 1);
  if (config.page === 'last') {
    return total;
  }
  const spec = Math.max(1, Number(config.pageNumber) || 1);
  return Math.min(spec, total);
}

/**
 * Convierte un clic en coordenadas del navegador (clientX, clientY) sobre el contenedor
 * de la página renderizada (rect) a coordenadas PDF en puntos (origen esquina inferior izquierda),
 * independientemente del nivel de zoom.
 */
export function calcularCoordenadasPdfDesdeClic(params: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  pdfDimensions: { width: number; height: number };
}): { posicionX: number; posicionY: number } {
  const { clientX, clientY, rect, pdfDimensions } = params;
  const docW = pdfDimensions.width || 612;
  const docH = pdfDimensions.height || 792;

  const clickX = clientX - rect.left;
  const clickY = clientY - rect.top;

  const ratioX = Math.max(0, Math.min(1, clickX / Math.max(1, rect.width)));
  const ratioY = Math.max(0, Math.min(1, clickY / Math.max(1, rect.height)));

  let newX = Math.round(ratioX * docW - SIG_BOX_WIDTH / 2);
  let newY = Math.round((1 - ratioY) * docH - SIG_BOX_HEIGHT / 2);

  newX = Math.max(10, Math.min(docW - SIG_BOX_WIDTH - 10, newX));
  newY = Math.max(10, Math.min(docH - SIG_BOX_HEIGHT - 10, newY));

  return { posicionX: newX, posicionY: newY };
}

/**
 * Convierte un desplazamiento de arrastre del ratón/puntero en coordenadas PDF (origen inferior izquierdo),
 * escalando automáticamente según el zoom actual del visor (docW / rect.width, docH / rect.height).
 */
export function calcularCoordenadasPdfDesdeArrastre(params: {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  startSigX: number;
  startSigY: number;
  rect: { width: number; height: number };
  pdfDimensions: { width: number; height: number };
}): { posicionX: number; posicionY: number } {
  const {
    startClientX,
    startClientY,
    currentClientX,
    currentClientY,
    startSigX,
    startSigY,
    rect,
    pdfDimensions
  } = params;

  const docW = pdfDimensions.width || 612;
  const docH = pdfDimensions.height || 792;

  const deltaX = currentClientX - startClientX;
  const deltaY = currentClientY - startClientY;

  const scaleX = docW / Math.max(1, rect.width);
  const scaleY = docH / Math.max(1, rect.height);

  const deltaPdfX = deltaX * scaleX;
  const deltaPdfY = -deltaY * scaleY;

  let newX = Math.round(startSigX + deltaPdfX);
  let newY = Math.round(startSigY + deltaPdfY);

  newX = Math.max(10, Math.min(docW - SIG_BOX_WIDTH - 10, newX));
  newY = Math.max(10, Math.min(docH - SIG_BOX_HEIGHT - 10, newY));

  return { posicionX: newX, posicionY: newY };
}

/**
 * Calcula los porcentajes CSS relativos a la página para posicionar visualmente la caja
 * de firma de forma invariante al nivel de zoom.
 */
export function calcularEstiloCajaFirmaPorcentual(
  sigConfig: Pick<SharedSignatureConfig, 'posicionX' | 'posicionY'>,
  pdfDimensions: { width: number; height: number }
): { width: string; height: string; bottom: string; left: string } {
  const docW = pdfDimensions.width || 612;
  const docH = pdfDimensions.height || 792;

  return {
    width: `${(SIG_BOX_WIDTH / docW) * 100}%`,
    height: `${(SIG_BOX_HEIGHT / docH) * 100}%`,
    bottom: `${(sigConfig.posicionY / docH) * 100}%`,
    left: `${(sigConfig.posicionX / docW) * 100}%`
  };
}

export interface EmisionLaboratorio {
  id: string; // ej. emision_lab_1729482938
  fechaHora: string; // ISO
  fechaInicio?: string; // YYYY-MM-DD (fecha inicial del contrato)
  nombreContrato?: string; // "Contrato + 1er nombre + 1er apellido + DDMM"
  colaboradorId: string;
  colaboradorNombre: string;
  colaboradorPrimerNombre?: string;
  colaboradorPrimerApellido?: string;
  colaboradorRut: string;
  plantillaId: string;
  plantillaNombre: string;
  plantillaVersion: number;
  sueldoBase: number;
  tipoContrato: string;
  canalFirma: 'digital_aspro' | 'fisica_manuscrita';
  signatureConfig?: ContractSignatureConfig;
  pdfSha256: string;
  pageCount: number;
  tamanoDocxBytes: number;
  tamanoPdfBytes: number;
  estado: 'completado' | 'error_conversion';
  errorDetalle?: string;
  esLaboratorio: true; // Marca explícita para diferenciar de producción
  enviadoAFirmaReal: false;
}

/**
 * Genera el nombre estándar del contrato según la nomenclatura oficial:
 * "Contrato + 1er nombre + 1er apellido + DDMM"
 * donde DDMM corresponde al día y mes de la fecha inicial del contrato generado.
 */
export function formatearNombreContrato(params: {
  primerNombre?: string;
  primerApellido?: string;
  colaboradorNombre?: string;
  fechaInicio?: string;
  fechaHoraFallback?: string;
}): string {
  let first = (params.primerNombre || '').trim().split(/\s+/)[0] || '';
  let last = (params.primerApellido || '').trim().split(/\s+/)[0] || '';

  if ((!first || !last) && params.colaboradorNombre) {
    const tokens = params.colaboradorNombre.trim().split(/\s+/).filter(Boolean);
    if (!first && tokens.length > 0) {
      first = tokens[0];
    }
    if (!last) {
      if (tokens.length >= 4) {
        last = tokens[2];
      } else if (tokens.length >= 2) {
        last = tokens[1];
      }
    }
  }

  first = first.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  last = last.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();

  let ddmm = '';
  const rawDate = (params.fechaInicio || '').trim().split('T')[0];
  if (rawDate) {
    const parts = rawDate.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // Formato YYYY-MM-DD
        ddmm = `${parts[2].padStart(2, '0')}${parts[1].padStart(2, '0')}`;
      } else if (parts[2].length === 4) {
        // Formato DD-MM-YYYY
        ddmm = `${parts[0].padStart(2, '0')}${parts[1].padStart(2, '0')}`;
      }
    }
  }

  if (!ddmm) {
    const fallbackDate = params.fechaHoraFallback ? new Date(params.fechaHoraFallback) : new Date();
    const validDate = isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate;
    const dd = String(validDate.getDate()).padStart(2, '0');
    const mm = String(validDate.getMonth() + 1).padStart(2, '0');
    ddmm = `${dd}${mm}`;
  }

  return ['Contrato', first, last, ddmm].filter(Boolean).join(' ');
}

class LocalContractEmissionsService {
  private metadataStore: LocalForage;
  private binaryStore: LocalForage;

  constructor() {
    this.metadataStore = localforage.createInstance({
      name: 'aspro_contratos_v2',
      storeName: 'emisiones_metadata'
    });

    this.binaryStore = localforage.createInstance({
      name: 'aspro_contratos_v2',
      storeName: 'emisiones_binarios'
    });
  }

  /**
   * Guarda una emisión de laboratorio con sus binarios DOCX y PDF en IndexedDB
   */
  public async registrarEmision(params: {
    colaboradorId: string;
    colaboradorNombre: string;
    colaboradorPrimerNombre?: string;
    colaboradorPrimerApellido?: string;
    colaboradorRut: string;
    fechaInicio?: string;
    plantillaId: string;
    plantillaNombre: string;
    plantillaVersion: number;
    sueldoBase: number;
    tipoContrato: string;
    canalFirma: 'digital_aspro' | 'fisica_manuscrita';
    signatureConfig?: ContractSignatureConfig;
    docxBuffer: ArrayBuffer;
    pdfBuffer: ArrayBuffer;
    pageCount: number;
  }): Promise<EmisionLaboratorio> {
    // Validar integridad básica del PDF
    if (!params.pdfBuffer || params.pdfBuffer.byteLength < 500) {
      throw new Error('El archivo PDF generado está vacío o corrupto (menos de 500 bytes).');
    }

    // Verificar cabecera %PDF-
    const headerBytes = new Uint8Array(params.pdfBuffer.slice(0, 5));
    const headerText = String.fromCharCode(...headerBytes);
    if (!headerText.startsWith('%PDF')) {
      throw new Error('El binario retornado no corresponde a un documento PDF válido.');
    }

    // Calcular hash SHA-256 sobre los bytes reales del PDF generado y guardado
    const pdfSha256 = await calcularSha256(params.pdfBuffer);

    const id = `emision_lab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fechaHora = new Date().toISOString();
    const nombreContrato = formatearNombreContrato({
      primerNombre: params.colaboradorPrimerNombre,
      primerApellido: params.colaboradorPrimerApellido,
      colaboradorNombre: params.colaboradorNombre,
      fechaInicio: params.fechaInicio,
      fechaHoraFallback: fechaHora
    });

    const registro: EmisionLaboratorio = {
      id,
      fechaHora,
      fechaInicio: params.fechaInicio,
      nombreContrato,
      colaboradorId: params.colaboradorId,
      colaboradorNombre: params.colaboradorNombre,
      colaboradorPrimerNombre: params.colaboradorPrimerNombre,
      colaboradorPrimerApellido: params.colaboradorPrimerApellido,
      colaboradorRut: params.colaboradorRut,
      plantillaId: params.plantillaId,
      plantillaNombre: params.plantillaNombre,
      plantillaVersion: params.plantillaVersion,
      sueldoBase: params.sueldoBase,
      tipoContrato: params.tipoContrato,
      canalFirma: params.canalFirma,
      signatureConfig: params.canalFirma === 'digital_aspro' ? params.signatureConfig : undefined,
      pdfSha256,
      pageCount: params.pageCount,
      tamanoDocxBytes: params.docxBuffer.byteLength,
      tamanoPdfBytes: params.pdfBuffer.byteLength,
      estado: 'completado',
      esLaboratorio: true,
      enviadoAFirmaReal: false
    };

    // Guardar binarios en IndexedDB
    await this.binaryStore.setItem(`docx_${id}`, params.docxBuffer);
    await this.binaryStore.setItem(`pdf_${id}`, params.pdfBuffer);

    // Guardar metadatos en IndexedDB
    await this.metadataStore.setItem(id, registro);

    return registro;
  }

  /**
   * Actualiza la configuración de posicionamiento de firma asociada a una emisión específica
   */
  public async actualizarSignatureConfigEmision(
    emisionId: string,
    canalFirma: 'digital_aspro' | 'fisica_manuscrita',
    signatureConfig?: ContractSignatureConfig
  ): Promise<EmisionLaboratorio | null> {
    const actual = await this.obtenerEmisionPorId(emisionId);
    if (!actual) return null;

    const actualizado: EmisionLaboratorio = {
      ...actual,
      canalFirma,
      signatureConfig: canalFirma === 'digital_aspro' ? signatureConfig : undefined
    };

    await this.metadataStore.setItem(emisionId, actualizado);
    return actualizado;
  }

  /**
   * Obtiene la lista completa de emisiones registradas localmente (orden descendente)
   */
  public async listarEmisiones(): Promise<EmisionLaboratorio[]> {
    const listado: EmisionLaboratorio[] = [];
    await this.metadataStore.iterate<EmisionLaboratorio, void>((val) => {
      listado.push(val);
    });
    return listado.sort((a, b) => b.fechaHora.localeCompare(a.fechaHora));
  }

  /**
   * Obtiene una emisión por su ID
   */
  public async obtenerEmisionPorId(id: string): Promise<EmisionLaboratorio | null> {
    return (await this.metadataStore.getItem<EmisionLaboratorio>(id)) || null;
  }

  /**
   * Recupera el binario ArrayBuffer de un DOCX o PDF
   */
  public async obtenerBinario(emisionId: string, tipo: 'docx' | 'pdf'): Promise<ArrayBuffer | null> {
    return (await this.binaryStore.getItem<ArrayBuffer>(`${tipo}_${emisionId}`)) || null;
  }

  /**
   * Genera una URL Blob temporal y revocable para descarga o visualización
   */
  public async crearDescarga(
    emisionId: string,
    tipo: 'docx' | 'pdf'
  ): Promise<{ url: string; nombreArchivo: string; revocar: () => void }> {
    const emision = await this.obtenerEmisionPorId(emisionId);
    if (!emision) throw new Error(`Emisión #${emisionId} no encontrada.`);

    const buffer = await this.obtenerBinario(emisionId, tipo);
    if (!buffer) throw new Error(`Archivo binario ${tipo.toUpperCase()} no disponible para la emisión #${emisionId}.`);

    const mime = tipo === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const blob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const nombreBase =
      emision.nombreContrato ||
      formatearNombreContrato({
        primerNombre: emision.colaboradorPrimerNombre,
        primerApellido: emision.colaboradorPrimerApellido,
        colaboradorNombre: emision.colaboradorNombre,
        fechaInicio: emision.fechaInicio,
        fechaHoraFallback: emision.fechaHora
      });
    const ext = tipo === 'pdf' ? 'pdf' : 'docx';
    const nombreArchivo = `${nombreBase}.${ext}`;

    return {
      url,
      nombreArchivo,
      revocar: () => URL.revokeObjectURL(url)
    };
  }

  /**
   * Elimina una emisión del historial y sus binarios
   */
  public async eliminarEmision(emisionId: string): Promise<void> {
    await this.metadataStore.removeItem(emisionId);
    await this.binaryStore.removeItem(`docx_${emisionId}`);
    await this.binaryStore.removeItem(`pdf_${emisionId}`);
  }

  /**
   * Limpia todo el historial de emisiones de laboratorio
   */
  public async limpiarHistorial(): Promise<void> {
    await this.metadataStore.clear();
    await this.binaryStore.clear();
  }
}

export const localContractEmissionsService = new LocalContractEmissionsService();
