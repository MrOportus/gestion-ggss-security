/**
 * ASPRO — CONTRATOS V2 — FASE 5.2
 * Servicio de Gestión y Persistencia de Plantillas DOCX en IndexedDB
 * 
 * Gestiona el ciclo de vida de las plantillas Word:
 * - Almacenamiento binario en IndexedDB (localforage)
 * - Versionado inmutable
 * - Detección y validación de variables {{...}} en cuerpo, tablas, encabezados y pies de página
 * - Soporte dual: variables planas de plantillas reales RR.HH. ({{nombre}}, {{rut}}, {{Horario_A}}, etc.)
 *   y variables canónicas con notación de punto ({{trabajador.nombre}}, {{contrato.sueldoBase}}, etc.)
 * - Bloqueo de emisión si existen variables obligatorias no resueltas
 */

import localforage from 'localforage';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const SPACING_ATTRIBUTE_NAMES = [
  'before',
  'beforeLines',
  'beforeAutospacing',
  'after',
  'afterLines',
  'afterAutospacing',
  'line',
  'lineRule'
] as const;

/**
 * Orden de elementos posteriores a <w:spacing> dentro de <w:pPr> según el esquema OpenXML (CT_PPr)
 */
const PPR_ELEMENTS_AFTER_SPACING = new Set([
  'ind',
  'contextualSpacing',
  'mirrorIndents',
  'suppressOverlap',
  'jc',
  'textDirection',
  'textAlignment',
  'textboxTightWrap',
  'outlineLvl',
  'divId',
  'cnfStyle',
  'rPr',
  'sectPr',
  'pPrChange'
]);

interface EstiloWordInfo {
  styleId: string;
  type: string;
  isDefault: boolean;
  basedOn: string | null;
  spacingAttrs: Record<string, string> | null;
}

interface MapaEstilosWord {
  estilos: Map<string, EstiloWordInfo>;
  defaultTableStyleId: string | null;
  defaultParagraphStyleId: string | null;
}

function esElementoWord(node: any, localName: string): boolean {
  if (!node || node.nodeType !== 1) return false;
  if (node.localName === localName) {
    return !node.namespaceURI || node.namespaceURI === WORD_NAMESPACE;
  }
  return node.tagName === `w:${localName}` || node.tagName === localName;
}

function obtenerAtributoWord(el: any, attrLocalName: string): string | null {
  if (!el || typeof el.getAttribute !== 'function') return null;
  const prefixed = el.getAttribute(`w:${attrLocalName}`);
  if (prefixed !== null && prefixed !== '') return prefixed;
  if (typeof el.getAttributeNS === 'function') {
    const nsVal = el.getAttributeNS(WORD_NAMESPACE, attrLocalName);
    if (nsVal !== null && nsVal !== '') return nsVal;
  }
  const plain = el.getAttribute(attrLocalName);
  if (plain !== null && plain !== '') return plain;
  return null;
}

function buscarHijoDirectoWord(parent: any, localName: string): any | null {
  if (!parent || !parent.childNodes) return null;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (esElementoWord(child, localName)) {
      return child;
    }
  }
  return null;
}

function extraerAtributosSpacing(spacingEl: any): Record<string, string> | null {
  if (!spacingEl) return null;
  const attrs: Record<string, string> = {};
  let count = 0;
  for (const attrName of SPACING_ATTRIBUTE_NAMES) {
    const val = obtenerAtributoWord(spacingEl, attrName);
    if (val !== null) {
      attrs[attrName] = val;
      count++;
    }
  }
  return count > 0 ? attrs : null;
}

/**
 * Inspecciona word/styles.xml y construye el mapa de estilos de tabla y de párrafo
 * junto con sus referencias de herencia (<w:basedOn>).
 *
 * Limitación documentada:
 * - Resuelve cadenas completas de herencia <w:basedOn> para el <w:pPr><w:spacing> base
 *   tanto en estilos de tabla como en estilos de párrafo (con protección contra ciclos).
 * - Los formatos condicionales de tabla (<w:tblStylePr w:type="firstRow|lastRow|..."/>)
 *   no se sobreescriben; solo se propaga el <w:pPr><w:spacing> general del estilo de tabla.
 */
function parsearMapaEstilosWord(stylesXmlText: string): MapaEstilosWord {
  const estilos = new Map<string, EstiloWordInfo>();
  let defaultTableStyleId: string | null = null;
  let defaultParagraphStyleId: string | null = null;

  const doc = new DOMParser().parseFromString(stylesXmlText, 'application/xml');
  const root = doc.documentElement;
  if (!root || !root.childNodes) {
    return { estilos, defaultTableStyleId, defaultParagraphStyleId };
  }

  for (let i = 0; i < root.childNodes.length; i++) {
    const node = root.childNodes[i];
    if (!esElementoWord(node, 'style')) continue;

    const styleId = obtenerAtributoWord(node, 'styleId');
    const type = obtenerAtributoWord(node, 'type') || '';
    if (!styleId) continue;

    const defaultAttr = obtenerAtributoWord(node, 'default');
    const isDefault = defaultAttr === '1' || defaultAttr === 'true';

    const basedOnEl = buscarHijoDirectoWord(node, 'basedOn');
    const basedOn = basedOnEl ? obtenerAtributoWord(basedOnEl, 'val') : null;

    const pPrEl = buscarHijoDirectoWord(node, 'pPr');
    const spacingEl = pPrEl ? buscarHijoDirectoWord(pPrEl, 'spacing') : null;
    const spacingAttrs = extraerAtributosSpacing(spacingEl);

    estilos.set(styleId, {
      styleId,
      type,
      isDefault,
      basedOn,
      spacingAttrs
    });

    if (isDefault && type === 'table' && !defaultTableStyleId) {
      defaultTableStyleId = styleId;
    } else if (isDefault && type === 'paragraph' && !defaultParagraphStyleId) {
      defaultParagraphStyleId = styleId;
    }
  }

  return { estilos, defaultTableStyleId, defaultParagraphStyleId };
}

/**
 * Resuelve los atributos <w:spacing> efectivos de un estilo recorriendo su cadena
 * de herencia <w:basedOn> desde el estilo ancestro raíz hasta el estilo derivado.
 */
function resolverSpacingDeEstilo(
  styleId: string | null,
  expectedType: 'table' | 'paragraph',
  mapa: MapaEstilosWord
): Record<string, string> | null {
  const targetId =
    styleId ||
    (expectedType === 'table' ? mapa.defaultTableStyleId : mapa.defaultParagraphStyleId);

  if (!targetId) return null;

  const chain: EstiloWordInfo[] = [];
  const visited = new Set<string>();
  let currentId: string | null = targetId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const info = mapa.estilos.get(currentId);
    if (!info) break;
    chain.unshift(info); // Ancestro primero para que el hijo sobrescriba atributos heredados
    currentId = info.basedOn;
  }

  if (chain.length === 0) return null;

  const merged: Record<string, string> = {};
  let hasAny = false;
  for (const item of chain) {
    if (item.spacingAttrs) {
      for (const [k, v] of Object.entries(item.spacingAttrs)) {
        merged[k] = v;
        hasAny = true;
      }
    }
  }

  return hasAny ? merged : null;
}

/**
 * Crea e inserta un elemento <w:spacing> dentro de <w:pPr> respetando el orden del esquema OpenXML (CT_PPr)
 */
function insertarSpacingEnParrafoWord(
  pElement: any,
  doc: any,
  spacingAttrs: Record<string, string>
): boolean {
  const usePrefix = pElement.tagName && pElement.tagName.startsWith('w:');
  const tagName = (local: string) => (usePrefix ? `w:${local}` : local);
  const attrName = (local: string) => (usePrefix ? `w:${local}` : local);

  let pPr = buscarHijoDirectoWord(pElement, 'pPr');
  if (!pPr) {
    pPr = doc.createElementNS
      ? doc.createElementNS(WORD_NAMESPACE, tagName('pPr'))
      : doc.createElement(tagName('pPr'));
    if (pElement.firstChild) {
      pElement.insertBefore(pPr, pElement.firstChild);
    } else {
      pElement.appendChild(pPr);
    }
  } else {
    // Nunca sobrescribir un <w:spacing> ya definido explícitamente en el párrafo
    const existingSpacing = buscarHijoDirectoWord(pPr, 'spacing');
    if (existingSpacing) {
      return false;
    }
  }

  const spacingEl = doc.createElementNS
    ? doc.createElementNS(WORD_NAMESPACE, tagName('spacing'))
    : doc.createElement(tagName('spacing'));

  for (const key of SPACING_ATTRIBUTE_NAMES) {
    if (key in spacingAttrs) {
      spacingEl.setAttribute(attrName(key), spacingAttrs[key]);
    }
  }

  // Insertar antes del primer elemento posterior según la secuencia CT_PPr de OpenXML
  let referenceNode: any = null;
  if (pPr.childNodes) {
    for (let i = 0; i < pPr.childNodes.length; i++) {
      const child = pPr.childNodes[i];
      if (child && child.nodeType === 1) {
        const local = child.localName || String(child.tagName || '').replace(/^w:/, '');
        if (PPR_ELEMENTS_AFTER_SPACING.has(local)) {
          referenceNode = child;
          break;
        }
      }
    }
  }

  if (referenceNode) {
    pPr.insertBefore(spacingEl, referenceNode);
  } else {
    pPr.appendChild(spacingEl);
  }

  return true;
}

/**
 * Procesa una tabla <w:tbl> y sus celdas <w:tc>:
 * - Aplica el <w:spacing> del estilo de la tabla únicamente a sus párrafos directos que
 *   no tengan <w:spacing> explícito ni un estilo de párrafo con <w:spacing> propio.
 * - Si una celda contiene una tabla anidada (<w:tbl>), la procesa recursivamente con su propio estilo.
 */
function procesarTablaWordDOM(
  tblElement: any,
  doc: any,
  mapaEstilos: MapaEstilosWord
): number {
  let modificados = 0;

  const tblPr = buscarHijoDirectoWord(tblElement, 'tblPr');
  const tblStyleEl = tblPr ? buscarHijoDirectoWord(tblPr, 'tblStyle') : null;
  const tblStyleId = tblStyleEl ? obtenerAtributoWord(tblStyleEl, 'val') : null;

  const tableSpacing = resolverSpacingDeEstilo(tblStyleId, 'table', mapaEstilos);

  const recorrerContenidoCelda = (container: any) => {
    if (!container || !container.childNodes) return;
    for (let i = 0; i < container.childNodes.length; i++) {
      const child = container.childNodes[i];
      if (!child || child.nodeType !== 1) continue;

      if (esElementoWord(child, 'tbl')) {
        // Tabla anidada: evaluar de forma independiente con su propio estilo de tabla
        modificados += procesarTablaWordDOM(child, doc, mapaEstilos);
      } else if (esElementoWord(child, 'p')) {
        if (!tableSpacing) continue;

        const pPr = buscarHijoDirectoWord(child, 'pPr');
        if (pPr && buscarHijoDirectoWord(pPr, 'spacing')) {
          // El párrafo ya tiene espaciado explícito: no tocar
          continue;
        }

        const pStyleEl = pPr ? buscarHijoDirectoWord(pPr, 'pStyle') : null;
        const pStyleId = pStyleEl ? obtenerAtributoWord(pStyleEl, 'val') : null;
        const paraStyleSpacing = resolverSpacingDeEstilo(pStyleId, 'paragraph', mapaEstilos);

        if (paraStyleSpacing !== null) {
          // El estilo de párrafo define su propio <w:spacing> explícito: respetarlo
          continue;
        }

        if (insertarSpacingEnParrafoWord(child, doc, tableSpacing)) {
          modificados++;
        }
      } else if (
        esElementoWord(child, 'sdt') ||
        esElementoWord(child, 'sdtContent') ||
        esElementoWord(child, 'customXml')
      ) {
        recorrerContenidoCelda(child);
      }
    }
  };

  const recorrerFilasYCeldas = (node: any) => {
    if (!node || !node.childNodes) return;
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (!child || child.nodeType !== 1) continue;

      if (esElementoWord(child, 'tr')) {
        recorrerFilasYCeldas(child);
      } else if (esElementoWord(child, 'tc')) {
        recorrerContenidoCelda(child);
      } else if (
        esElementoWord(child, 'sdt') ||
        esElementoWord(child, 'sdtContent') ||
        esElementoWord(child, 'customXml')
      ) {
        recorrerFilasYCeldas(child);
      }
    }
  };

  recorrerFilasYCeldas(tblElement);
  return modificados;
}

/**
 * Recorre el árbol DOM de un archivo XML (ej. word/document.xml) buscando únicamente tablas de nivel superior
 * (las tablas anidadas son delegadas dentro de procesarTablaWordDOM). Nunca modifica párrafos fuera de tablas.
 */
function normalizarTablasEnDocumentoDOM(
  node: any,
  doc: any,
  mapaEstilos: MapaEstilosWord
): number {
  let modificados = 0;
  if (!node || !node.childNodes) return 0;

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (!child || child.nodeType !== 1) continue;

    if (esElementoWord(child, 'tbl')) {
      modificados += procesarTablaWordDOM(child, doc, mapaEstilos);
    } else if (!esElementoWord(child, 'p')) {
      modificados += normalizarTablasEnDocumentoDOM(child, doc, mapaEstilos);
    }
  }

  return modificados;
}

export interface VariableDetectada {
  nombre: string;
  fuente: 'trabajador' | 'contrato' | 'empresa' | 'sucursal' | 'desconocida';
  existeEnAspro: boolean;
  obligatoria: boolean;
  requiereConfiguracion: boolean;
  descripcion: string;
  ejemploValor?: string;
}

export interface PlantillaContractual {
  id: string;
  nombre: string;
  tipoDocumento: 'Contrato' | 'Anexo';
  tipoContrato: 'Plazo Fijo' | 'Indefinido' | 'Obra y Faena' | 'Part-Time';
  version: number;
  archivoNombre: string;
  tamanoBytes: number;
  fechaIncorporacion: string; // ISO
  activa: boolean;
  esEjemploSintetico: boolean; // Identifica plantillas de demostración/ejemplo
  hashSha256: string;
  variablesDetectadas: VariableDetectada[];
  erroresValidacion: string[];
  descripcion?: string;
  plantillaBaseId?: string; // Trazabilidad de versiones anteriores
}

export interface ValidacionVariablesResult {
  validaParaEmision: boolean;
  variablesDetectadas: VariableDetectada[];
  variablesFaltantesObligatorias: string[];
  variablesNoReconocidas: string[];
  erroresSintaxis: string[];
}

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/**
 * Formatea una fecha YYYY-MM-DD o DD/MM/YYYY al formato corto DD/MM/YYYY
 */
export function formatearFechaCorta(fechaStr?: string): string {
  if (!fechaStr) return '';
  const limpia = fechaStr.trim().split('T')[0];
  const partesGuion = limpia.split('-');
  if (partesGuion.length === 3) {
    if (partesGuion[0].length === 4) {
      // YYYY-MM-DD -> DD/MM/YYYY
      return `${partesGuion[2].padStart(2, '0')}/${partesGuion[1].padStart(2, '0')}/${partesGuion[0]}`;
    }
    // DD-MM-YYYY -> DD/MM/YYYY
    return `${partesGuion[0].padStart(2, '0')}/${partesGuion[1].padStart(2, '0')}/${partesGuion[2]}`;
  }
  return limpia;
}

/**
 * Formatea una fecha YYYY-MM-DD o DD/MM/YYYY al formato largo legal en español (ej: "26 de octubre de 2026")
 */
export function formatearFechaLarga(fechaStr?: string): string {
  if (!fechaStr) return '';
  const limpia = fechaStr.trim().split('T')[0];
  const separador = limpia.includes('/') ? '/' : '-';
  const partes = limpia.split(separador);
  if (partes.length !== 3) return limpia;

  let anio = partes[0];
  let mesStr = partes[1];
  let diaStr = partes[2];

  if (partes[0].length <= 2 && partes[2].length === 4) {
    diaStr = partes[0];
    mesStr = partes[1];
    anio = partes[2];
  }

  const mesIndex = parseInt(mesStr, 10) - 1;
  const nombreMes = MESES_ES[mesIndex] || mesStr;
  const diaNum = parseInt(diaStr, 10) || diaStr;

  return `${diaNum} de ${nombreMes} de ${anio}`;
}

// Diccionario Canónico de Variables Soportadas en ASPRO (Notación de Punto + Variables Planas RR.HH.)
export const DICCIONARIO_VARIABLES_ASPRO: Record<string, {
  fuente: VariableDetectada['fuente'];
  obligatoria: boolean;
  requiereConfiguracion: boolean;
  descripcion: string;
  ejemplo: string;
}> = {
  // ─── 1. Variables Planas Reales RR.HH. ASPRO (Plantillas Word Directas) ─────
  'nombre': { fuente: 'trabajador', obligatoria: true, requiereConfiguracion: false, descripcion: 'Nombre completo del colaborador', ejemplo: 'Juan Pérez Silva' },
  'rut': { fuente: 'trabajador', obligatoria: true, requiereConfiguracion: false, descripcion: 'RUT del colaborador', ejemplo: '12.345.678-9' },
  'fecha_nacimiento': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Fecha de nacimiento del colaborador (DD/MM/AAAA)', ejemplo: '14/05/1990' },
  'nacionalidad': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Nacionalidad del colaborador', ejemplo: 'Chilena' },
  'direccion': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Domicilio particular del colaborador', ejemplo: 'Calle Recreo 118, Rancagua' },
  'estado_civil': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Estado civil del colaborador', ejemplo: 'Soltero(a)' },
  'telefono': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Teléfono del colaborador', ejemplo: '+56 9 8765 4321' },
  'salud': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Sistema de salud (Fonasa / Isapre)', ejemplo: 'Fonasa' },
  'afp': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Sistema previsional (AFP)', ejemplo: 'Modelo' },
  'codigo_interno': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Código interno del colaborador en ASPRO', ejemplo: '10' },
  'cargo': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: true, descripcion: 'Cargo contractual asignado', ejemplo: 'Guardia de Seguridad' },
  'email': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Correo electrónico del colaborador', ejemplo: 'colaborador@ggss.cl' },

  'fecha_inicio': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Fecha de inicio del contrato (DD/MM/AAAA)', ejemplo: '26/10/2026' },
  'fecha_inicio_corta': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Fecha de inicio en formato corto (DD/MM/AAAA)', ejemplo: '26/10/2026' },
  'fecha_inicio_larga': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Fecha de inicio en texto legal (ej. 26 de octubre de 2026)', ejemplo: '26 de octubre de 2026' },
  'fecha_termino': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: true, descripcion: 'Fecha de término del contrato o Indefinido', ejemplo: '30/11/2026' },
  'fecha_termino_corta': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: true, descripcion: 'Fecha de término en formato corto (DD/MM/AAAA)', ejemplo: '30/11/2026' },
  'fecha_termino_larga': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: true, descripcion: 'Fecha de término en texto legal', ejemplo: '30 de noviembre de 2026' },
  'sueldo': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Sueldo base contractual pactado', ejemplo: '$553.553' },
  'sueldo_base': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Sueldo base contractual numérico/formateado', ejemplo: '$553.553' },
  'Horario_A': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario A (Diurno) pactado', ejemplo: '08:30 AM a 18:30 PM' },
  'Horario_B': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario B (Nocturno) pactado', ejemplo: '18:00 PM a 09:00 AM' },
  'horarioA': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario A (Diurno) pactado', ejemplo: '08:30 AM a 18:30 PM' },
  'horarioB': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario B (Nocturno) pactado', ejemplo: '18:00 PM a 09:00 AM' },
  'horario_a': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario A (Diurno) pactado', ejemplo: '08:30 AM a 18:30 PM' },
  'horario_b': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario B (Nocturno) pactado', ejemplo: '18:00 PM a 09:00 AM' },
  'jornada': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: true, descripcion: 'Jornada semanal pactada', ejemplo: '45 horas semanales' },
  'tipo_contrato': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: true, descripcion: 'Modalidad o tipo de contrato', ejemplo: 'Obra y Faena' },

  'Sucursal': { fuente: 'sucursal', obligatoria: true, requiereConfiguracion: true, descripcion: 'Nombre de la sucursal o instalación asignada', ejemplo: 'Banco Estado Rancagua' },
  'sucursal': { fuente: 'sucursal', obligatoria: true, requiereConfiguracion: true, descripcion: 'Nombre de la sucursal o instalación asignada', ejemplo: 'Banco Estado Rancagua' },
  'sucursal_name': { fuente: 'sucursal', obligatoria: true, requiereConfiguracion: true, descripcion: 'Nombre de la sucursal o instalación asignada', ejemplo: 'Banco Estado Rancagua' },
  'direccion_sucursal': { fuente: 'sucursal', obligatoria: true, requiereConfiguracion: true, descripcion: 'Dirección física de la sucursal o instalación', ejemplo: 'Paseo Independencia 500, Rancagua' },
  'sucursal_address': { fuente: 'sucursal', obligatoria: true, requiereConfiguracion: true, descripcion: 'Dirección física de la sucursal o instalación', ejemplo: 'Paseo Independencia 500, Rancagua' },
  'empresa': { fuente: 'empresa', obligatoria: true, requiereConfiguracion: false, descripcion: 'Empresa o razón social asociada a la instalación', ejemplo: 'ASPRO SPA' },

  // ─── 2. Variables Canónicas con Notación de Punto (trabajador.*, etc.) ──────
  // Trabajador
  'trabajador.nombre': { fuente: 'trabajador', obligatoria: true, requiereConfiguracion: false, descripcion: 'Nombre completo del colaborador', ejemplo: 'Juan Pérez Silva' },
  'trabajador.rut': { fuente: 'trabajador', obligatoria: true, requiereConfiguracion: false, descripcion: 'RUT formal del colaborador', ejemplo: '12.345.678-9' },
  'trabajador.cargo': { fuente: 'trabajador', obligatoria: true, requiereConfiguracion: false, descripcion: 'Cargo asignado en nómina', ejemplo: 'Guardia de Seguridad' },
  'trabajador.fechaNacimiento': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Fecha de nacimiento del colaborador', ejemplo: '14/05/1990' },
  'trabajador.nacionalidad': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Nacionalidad declarada', ejemplo: 'Chilena' },
  'trabajador.estadoCivil': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Estado civil declarado', ejemplo: 'Soltero(a)' },
  'trabajador.direccion': { fuente: 'trabajador', obligatoria: true, requiereConfiguracion: false, descripcion: 'Domicilio particular', ejemplo: 'Av. Providencia 1234, Santiago' },
  'trabajador.email': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Correo electrónico', ejemplo: 'colaborador@ggss.cl' },
  'trabajador.telefono': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Teléfono de contacto', ejemplo: '+56 9 8765 4321' },
  'trabajador.afp': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Institución previsional (AFP)', ejemplo: 'Modelo' },
  'trabajador.salud': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Institución de salud (Fonasa/Isapre)', ejemplo: 'Fonasa' },
  'trabajador.codigoInterno': { fuente: 'trabajador', obligatoria: false, requiereConfiguracion: false, descripcion: 'Código interno del trabajador', ejemplo: '10' },

  // Empresa
  'empresa.nombre': { fuente: 'empresa', obligatoria: true, requiereConfiguracion: false, descripcion: 'Razón social del empleador', ejemplo: 'GESTIÓN GGSS SECURITY SPA' },
  'empresa.rut': { fuente: 'empresa', obligatoria: true, requiereConfiguracion: false, descripcion: 'RUT del empleador', ejemplo: '76.999.888-K' },
  'empresa.representante': { fuente: 'empresa', obligatoria: true, requiereConfiguracion: false, descripcion: 'Nombre del Representante Legal', ejemplo: 'Representante Legal GGSS' },
  'empresa.direccion': { fuente: 'empresa', obligatoria: true, requiereConfiguracion: false, descripcion: 'Domicilio legal de la empresa', ejemplo: "Av. Libertador Bernardo O'Higgins 1234" },
  'empresa.comuna': { fuente: 'empresa', obligatoria: true, requiereConfiguracion: false, descripcion: 'Comuna sede de la empresa', ejemplo: 'Santiago' },

  // Contrato
  'contrato.tipo': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Modalidad (Plazo Fijo, Indefinido, etc.)', ejemplo: 'Plazo Fijo' },
  'contrato.fechaInicio': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Fecha de ingreso contractual', ejemplo: '2026-11-01' },
  'contrato.fechaInicioCorta': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Fecha de ingreso en formato DD/MM/AAAA', ejemplo: '01/11/2026' },
  'contrato.fechaInicioLarga': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Fecha de ingreso en texto largo', ejemplo: '1 de noviembre de 2026' },
  'contrato.fechaTermino': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: true, descripcion: 'Fecha de vencimiento (exigida en Plazo Fijo)', ejemplo: '2027-01-31' },
  'contrato.cargo': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Cargo pactado en contrato', ejemplo: 'Guardia de Seguridad' },
  'contrato.jornada': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Distribución semanal de jornada', ejemplo: '45 horas semanales' },
  'contrato.horarioA': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario Turno A / Día', ejemplo: '08:30 AM a 18:30 PM' },
  'contrato.horarioB': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Horario Turno B / Noche', ejemplo: '18:00 PM a 09:00 AM' },
  'contrato.sueldo': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Sueldo base pactado en formato CLP', ejemplo: '$550.000' },
  'contrato.sueldoBase': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Sueldo base numérico en pesos', ejemplo: '550000' },
  'contrato.sueldoBaseFormatted': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: true, descripcion: 'Sueldo base formateado en moneda', ejemplo: '$550.000' },
  'contrato.ciudadFirma': { fuente: 'contrato', obligatoria: true, requiereConfiguracion: false, descripcion: 'Ciudad de suscripción', ejemplo: 'Rancagua' },
  'contrato.fechaEmisionTexto': { fuente: 'contrato', obligatoria: false, requiereConfiguracion: false, descripcion: 'Fecha textual de emisión', ejemplo: '28 de octubre de 2026' },

  // Sucursal
  'sucursal.nombre': { fuente: 'sucursal', obligatoria: true, requiereConfiguracion: true, descripcion: 'Nombre de la faena asignada', ejemplo: 'SUCURSAL COSTANERA' },
  'sucursal.direccion': { fuente: 'sucursal', obligatoria: true, requiereConfiguracion: true, descripcion: 'Dirección física de la faena', ejemplo: 'Av. Andrés Bello 2425' },
  'sucursal.comuna': { fuente: 'sucursal', obligatoria: false, requiereConfiguracion: false, descripcion: 'Comuna de la faena', ejemplo: 'Providencia' }
};

/**
 * Busca una variable en DICCIONARIO_VARIABLES_ASPRO de manera exacta o case-insensitive (para etiquetas planas)
 */
function buscarEnDiccionarioAspro(nombreVariable: string) {
  if (DICCIONARIO_VARIABLES_ASPRO[nombreVariable]) {
    return DICCIONARIO_VARIABLES_ASPRO[nombreVariable];
  }
  const lower = nombreVariable.toLowerCase();
  const keyEncontrada = Object.keys(DICCIONARIO_VARIABLES_ASPRO).find(
    k => k.toLowerCase() === lower
  );
  return keyEncontrada ? DICCIONARIO_VARIABLES_ASPRO[keyEncontrada] : undefined;
}

/**
 * Calcula el hash SHA-256 de un ArrayBuffer de forma universal (Browser Crypto Subtle / Node fallback)
 */
export async function calcularSha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const bufferToDigest: ArrayBuffer = data instanceof ArrayBuffer
      ? data
      : (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', bufferToDigest);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback para entornos Node / Vitest
  try {
    const cryptoNode = await import('crypto');
    const nodeBuf = Buffer.isBuffer(data)
      ? data
      : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return cryptoNode.createHash('sha256').update(nodeBuf).digest('hex');
  } catch {
    return 'sha256_mock_' + Date.now();
  }
}

class LocalContractTemplateService {
  private metadataStore: LocalForage;
  private binaryStore: LocalForage;
  private initialized: boolean = false;

  constructor() {
    this.metadataStore = localforage.createInstance({
      name: 'aspro_contratos_v2',
      storeName: 'plantillas_metadata'
    });

    this.binaryStore = localforage.createInstance({
      name: 'aspro_contratos_v2',
      storeName: 'plantillas_binarios'
    });
  }

  /**
   * Inicializa el almacén y si está vacío, incorpora las plantillas de ejemplo sintéticas
   */
  public async inicializar(): Promise<void> {
    if (this.initialized) return;

    try {
      const cantidad = await this.metadataStore.length();
      if (cantidad === 0) {
        await this.cargarPlantillasEjemploBase();
      }
      this.initialized = true;
    } catch (err) {
      console.warn('[LocalContractTemplateService] Error inicializando almacén:', err);
      this.initialized = true;
    }
  }

  /**
   * Semillas de demostración/ejemplo claramente rotuladas
   */
  private async cargarPlantillasEjemploBase(): Promise<void> {
    const demo1: PlantillaContractual = {
      id: 'tpl_sintetica_plazo_fijo_v2',
      nombre: '[EJEMPLO SINTÉTICO] Contrato Plazo Fijo — Guardia de Seguridad (4 págs)',
      tipoDocumento: 'Contrato',
      tipoContrato: 'Plazo Fijo',
      version: 2,
      archivoNombre: 'plantilla_sintetica_contrato.docx',
      tamanoBytes: 37500,
      fechaIncorporacion: new Date().toISOString(),
      activa: true,
      esEjemploSintetico: true,
      hashSha256: 'eb87a11fb6199c87d46c4f82be81b838965027a0862089eb312cb6ecb1bfeb43',
      erroresValidacion: [],
      variablesDetectadas: [
        this.clasificarVariable('trabajador.nombre'),
        this.clasificarVariable('trabajador.rut'),
        this.clasificarVariable('trabajador.direccion'),
        this.clasificarVariable('contrato.tipo'),
        this.clasificarVariable('contrato.fechaInicio'),
        this.clasificarVariable('contrato.fechaTermino'),
        this.clasificarVariable('contrato.sueldo'),
        this.clasificarVariable('contrato.jornada'),
        this.clasificarVariable('contrato.horarioA'),
        this.clasificarVariable('contrato.horarioB'),
        this.clasificarVariable('sucursal.nombre'),
        this.clasificarVariable('sucursal.direccion')
      ],
      descripcion: 'Plantilla de laboratorio de 4 páginas con cláusulas OS-10, confidencialidad y turnos 4x4. Uso exclusivo de pruebas.'
    };

    const demo2: PlantillaContractual = {
      id: 'tpl_sintetica_indefinido_v2',
      nombre: '[EJEMPLO SINTÉTICO] Contrato Indefinido — Personal de Seguridad (4 págs)',
      tipoDocumento: 'Contrato',
      tipoContrato: 'Indefinido',
      version: 2,
      archivoNombre: 'plantilla_sintetica_indefinido.docx',
      tamanoBytes: 36800,
      fechaIncorporacion: new Date().toISOString(),
      activa: true,
      esEjemploSintetico: true,
      hashSha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
      erroresValidacion: [],
      variablesDetectadas: [
        this.clasificarVariable('trabajador.nombre'),
        this.clasificarVariable('trabajador.rut'),
        this.clasificarVariable('trabajador.direccion'),
        this.clasificarVariable('contrato.tipo'),
        this.clasificarVariable('contrato.fechaInicio'),
        this.clasificarVariable('contrato.sueldo'),
        this.clasificarVariable('contrato.jornada'),
        this.clasificarVariable('contrato.horarioA'),
        this.clasificarVariable('contrato.horarioB'),
        this.clasificarVariable('sucursal.nombre'),
        this.clasificarVariable('sucursal.direccion')
      ],
      descripcion: 'Plantilla de laboratorio para relación contractual de duración indefinida.'
    };

    await this.metadataStore.setItem(demo1.id, demo1);
    await this.metadataStore.setItem(demo2.id, demo2);
  }

  /**
   * Inspecciona y valida exhaustivamente un archivo DOCX binario
   * Analiza: documento principal, tablas, encabezados y pies de página
   * Reconstruye párrafos divididos entre fragmentos XML (<w:t>)
   */
  public async inspeccionarYValidarDOCX(
    archivoBuffer: ArrayBuffer
  ): Promise<ValidacionVariablesResult> {
    const variablesSet = new Set<string>();
    const erroresSintaxis: string[] = [];

    let zip: PizZip;
    try {
      zip = new PizZip(archivoBuffer);
    } catch (err: any) {
      throw new Error(`El archivo seleccionado no es un documento Word DOCX válido: ${err.message}`);
    }

    // Verificar que sea un DOCX genuino buscando word/document.xml
    const documentXmlFile = zip.file('word/document.xml');
    if (!documentXmlFile) {
      throw new Error('El archivo no contiene la estructura interna estándar de Microsoft Word (falta word/document.xml).');
    }

    // Archivos XML a inspeccionar: documento principal, tablas (dentro de document), encabezados y pies
    const archivosAInspeccionar: string[] = ['word/document.xml'];
    for (const nombreArchivo in zip.files) {
      if (/^word\/(header|footer)\d+\.xml$/.test(nombreArchivo)) {
        archivosAInspeccionar.push(nombreArchivo);
      }
    }

    // Extracción de variables considerando la fragmentación XML de Word (<w:t>)
    for (const rutaXml of archivosAInspeccionar) {
      const f = zip.file(rutaXml);
      if (!f) continue;
      const xmlTexto = f.asText();

      // Extraer párrafos completos <w:p>...</w:p>
      const parrafos = xmlTexto.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [xmlTexto];

      for (const p of parrafos) {
        // Concatenar todos los textos de runs <w:t> dentro del párrafo para unir fragmentos divididos
        const fragmentosTexto = p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
        const textoParrafoReconstruido = fragmentosTexto
          .map(t => t.replace(/<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>/, ''))
          .join('');

        // Buscar variables {{...}}
        const coincidencias = textoParrafoReconstruido.match(/\{\{([^{}]+)\}\}/g) || [];
        for (const c of coincidencias) {
          const varLimpia = c.replace(/[{}]/g, '').trim();
          if (varLimpia && !varLimpia.startsWith('#') && !varLimpia.startsWith('/') && !varLimpia.startsWith('^')) {
            variablesSet.add(varLimpia);
          }
        }
      }
    }

    // Validación sintáctica formal mediante el constructor de Docxtemplater v3.71+
    // Nota: en docxtemplater v3.37+, pasar `zip` al constructor ejecuta automáticamente
    // la compilación léxica; no se debe invocar `.compile()` para evitar el warning de deprecación.
    try {
      new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        parser: tag => ({ get: () => '' })
      });
    } catch (docxErr: any) {
      if (docxErr.properties && Array.isArray(docxErr.properties.errors)) {
        docxErr.properties.errors.forEach((e: any) => {
          erroresSintaxis.push(`Etiqueta "${e.properties?.context || e.message}": ${e.properties?.explanation || e.message}`);
        });
      } else if (docxErr.properties?.id !== 'filetype_not_identified') {
        erroresSintaxis.push(docxErr.message || 'Error sintáctico al procesar etiquetas del documento.');
      }
    }

    // Clasificar variables detectadas
    const variablesDetectadas: VariableDetectada[] = Array.from(variablesSet)
      .sort()
      .map(v => this.clasificarVariable(v));

    const variablesFaltantesObligatorias: string[] = [];
    const variablesNoReconocidas: string[] = [];

    for (const v of variablesDetectadas) {
      if (!v.existeEnAspro) {
        variablesNoReconocidas.push(v.nombre);
      }
    }

    // Verificar si la plantilla incluye al menos las referencias esenciales de identidad y fecha
    // soportando tanto variables planas RR.HH. ({{nombre}}, {{rut}}, {{fecha_inicio_larga}}) como canónicas ({{trabajador.nombre}}, etc.)
    const lowerVars = new Set(Array.from(variablesSet).map(v => v.toLowerCase()));
    if (!lowerVars.has('trabajador.nombre') && !lowerVars.has('nombre')) {
      variablesFaltantesObligatorias.push('nombre / trabajador.nombre');
    }
    if (!lowerVars.has('trabajador.rut') && !lowerVars.has('rut')) {
      variablesFaltantesObligatorias.push('rut / trabajador.rut');
    }
    if (
      !lowerVars.has('contrato.fechainicio') &&
      !lowerVars.has('fecha_inicio') &&
      !lowerVars.has('fecha_inicio_corta') &&
      !lowerVars.has('fecha_inicio_larga')
    ) {
      variablesFaltantesObligatorias.push('fecha_inicio / contrato.fechaInicio');
    }

    const validaParaEmision = erroresSintaxis.length === 0 && variablesNoReconocidas.length === 0;

    return {
      validaParaEmision,
      variablesDetectadas,
      variablesFaltantesObligatorias,
      variablesNoReconocidas,
      erroresSintaxis
    };
  }

  /**
   * Clasifica una variable frente al diccionario de ASPRO
   */
  public clasificarVariable(nombreVariable: string): VariableDetectada {
    const config = buscarEnDiccionarioAspro(nombreVariable);
    if (config) {
      return {
        nombre: nombreVariable,
        fuente: config.fuente,
        existeEnAspro: true,
        obligatoria: config.obligatoria,
        requiereConfiguracion: config.requiereConfiguracion,
        descripcion: config.descripcion,
        ejemploValor: config.ejemplo
      };
    }

    // Si no está en el diccionario canónico, clasificar como desconocida
    const partes = nombreVariable.split('.');
    const prefijo = partes[0];
    const fuente = (['trabajador', 'contrato', 'empresa', 'sucursal'].includes(prefijo)
      ? prefijo
      : 'desconocida') as VariableDetectada['fuente'];

    return {
      nombre: nombreVariable,
      fuente,
      existeEnAspro: false,
      obligatoria: false,
      requiereConfiguracion: true,
      descripcion: `Variable personalizada o no mapeada en el esquema central de ASPRO (${nombreVariable})`,
      ejemploValor: '---'
    };
  }

  /**
   * Registra y guarda una nueva plantilla DOCX en IndexedDB
   */
  public async guardarPlantillaDOCX(params: {
    nombre: string;
    tipoDocumento: 'Contrato' | 'Anexo';
    tipoContrato: 'Plazo Fijo' | 'Indefinido' | 'Obra y Faena' | 'Part-Time';
    archivoNombre: string;
    archivoBuffer: ArrayBuffer;
    descripcion?: string;
    plantillaBaseId?: string;
  }): Promise<PlantillaContractual> {
    await this.inicializar();

    // Validar tamaño máximo razonable (10 MB)
    const MAX_BYTES = 10 * 1024 * 1024;
    if (params.archivoBuffer.byteLength > MAX_BYTES) {
      throw new Error(`El archivo supera el tamaño máximo permitido de 10 MB (${(params.archivoBuffer.byteLength / 1024 / 1024).toFixed(2)} MB).`);
    }

    // Inspección y validación de variables
    const validacion = await this.inspeccionarYValidarDOCX(params.archivoBuffer);

    // Calcular hash SHA-256
    const hashSha256 = await calcularSha256(params.archivoBuffer);

    // Versionado: calcular siguiente versión si deriva de una plantilla base
    let version = 1;
    if (params.plantillaBaseId) {
      const base = await this.obtenerPlantillaPorId(params.plantillaBaseId);
      if (base) {
        version = base.version + 1;
      }
    }

    const id = `tpl_usr_${Date.now()}_v${version}`;
    const erroresValidacion: string[] = [...validacion.erroresSintaxis];

    if (validacion.variablesNoReconocidas.length > 0) {
      erroresValidacion.push(`Contiene ${validacion.variablesNoReconocidas.length} variable(s) no soportada(s): ${validacion.variablesNoReconocidas.join(', ')}`);
    }

    const nuevaPlantilla: PlantillaContractual = {
      id,
      nombre: params.nombre.trim(),
      tipoDocumento: params.tipoDocumento,
      tipoContrato: params.tipoContrato,
      version,
      archivoNombre: params.archivoNombre,
      tamanoBytes: params.archivoBuffer.byteLength,
      fechaIncorporacion: new Date().toISOString(),
      activa: validacion.validaParaEmision, // Solo se activa automáticamente si no tiene errores
      esEjemploSintetico: false,
      hashSha256,
      variablesDetectadas: validacion.variablesDetectadas,
      erroresValidacion,
      descripcion: params.descripcion,
      plantillaBaseId: params.plantillaBaseId
    };

    // Persistir binario en binaryStore (IndexedDB)
    await this.binaryStore.setItem(id, params.archivoBuffer);

    // Persistir metadatos en metadataStore (IndexedDB)
    await this.metadataStore.setItem(id, nuevaPlantilla);

    return nuevaPlantilla;
  }

  /**
   * Re-evalúa las variables de una plantilla almacenada frente al diccionario vigente
   * (permite actualizar automáticamente plantillas subidas antes de ampliar el diccionario)
   */
  private sincronizarValidacionConDiccionarioActual(p: PlantillaContractual): {
    plantilla: PlantillaContractual;
    modificada: boolean;
  } {
    const varsReclasificadas = (p.variablesDetectadas || []).map(v => this.clasificarVariable(v.nombre));
    const noReconocidas = varsReclasificadas.filter(v => !v.existeEnAspro).map(v => v.nombre);

    // Conservar solo errores sintácticos genuinos, recalculando los de variables no soportadas
    const erroresSintaxisPrevios = (p.erroresValidacion || []).filter(
      e => !e.startsWith('Contiene ') && !e.includes('variable(s) no soportada(s)')
    );
    const nuevosErrores = [...erroresSintaxisPrevios];
    if (noReconocidas.length > 0) {
      nuevosErrores.push(`Contiene ${noReconocidas.length} variable(s) no soportada(s): ${noReconocidas.join(', ')}`);
    }

    const habiaErrorVariables = (p.erroresValidacion || []).length !== nuevosErrores.length;
    const activaActualizada = habiaErrorVariables && nuevosErrores.length === 0 ? true : p.activa;

    if (habiaErrorVariables || p.variablesDetectadas.some((v, idx) => v.existeEnAspro !== varsReclasificadas[idx]?.existeEnAspro)) {
      return {
        modificada: true,
        plantilla: {
          ...p,
          activa: activaActualizada,
          variablesDetectadas: varsReclasificadas,
          erroresValidacion: nuevosErrores
        }
      };
    }

    return { plantilla: p, modificada: false };
  }

  /**
   * Lista todas las plantillas registradas
   */
  public async listarPlantillas(): Promise<PlantillaContractual[]> {
    await this.inicializar();
    const plantillas: PlantillaContractual[] = [];
    const porActualizar: PlantillaContractual[] = [];

    await this.metadataStore.iterate<PlantillaContractual, void>((val) => {
      const { plantilla, modificada } = this.sincronizarValidacionConDiccionarioActual(val);
      plantillas.push(plantilla);
      if (modificada) {
        porActualizar.push(plantilla);
      }
    });

    for (const p of porActualizar) {
      await this.metadataStore.setItem(p.id, p);
    }

    return plantillas.sort((a, b) => b.fechaIncorporacion.localeCompare(a.fechaIncorporacion));
  }

  /**
   * Obtiene las plantillas actualmente activas para emisión
   */
  public async listarPlantillasActivas(): Promise<PlantillaContractual[]> {
    const todas = await this.listarPlantillas();
    return todas.filter(p => p.activa && p.erroresValidacion.length === 0);
  }

  /**
   * Obtiene una plantilla por su ID
   */
  public async obtenerPlantillaPorId(id: string): Promise<PlantillaContractual | null> {
    await this.inicializar();
    const item = await this.metadataStore.getItem<PlantillaContractual>(id);
    if (!item) return null;
    const { plantilla, modificada } = this.sincronizarValidacionConDiccionarioActual(item);
    if (modificada) {
      await this.metadataStore.setItem(id, plantilla);
    }
    return plantilla;
  }

  /**
   * Normaliza en el contenedor ZIP del DOCX el espaciado (<w:spacing>) de los párrafos
   * ubicados dentro de tablas (<w:tbl>) cuyo estilo de tabla (<w:tblStyle>) define un
   * <w:pPr><w:spacing> explícito en word/styles.xml.
   *
   * Corrige la discrepancia OOXML entre Microsoft Word y LibreOffice Writer (Gotenberg):
   * - No modifica párrafos fuera de tablas.
   * - No sobrescribe ningún <w:spacing> ya definido explícitamente en un párrafo.
   * - No altera párrafos cuyo estilo de párrafo (<w:pStyle> o default) defina su propio <w:spacing>.
   * - Respeta los valores exactos y la herencia (<w:basedOn>) del estilo de cada tabla.
   * - Soporta tablas anidadas aplicando el estilo propio de cada tabla.
   *
   * @returns Cantidad total de párrafos normalizados en el documento.
   */
  public normalizarEspaciadoTablasEnZip(zip: PizZip): number {
    const stylesFile = zip.file('word/styles.xml');
    if (!stylesFile) return 0;

    let mapaEstilos: MapaEstilosWord;
    try {
      mapaEstilos = parsearMapaEstilosWord(stylesFile.asText());
    } catch (err) {
      console.warn('[LocalContractTemplateService] No se pudo parsear word/styles.xml para normalización:', err);
      return 0;
    }

    if (mapaEstilos.estilos.size === 0) return 0;

    // Verificar si al menos un estilo de tabla tiene <w:spacing> directo o heredado
    let existeEstiloTablaConSpacing = false;
    for (const info of mapaEstilos.estilos.values()) {
      if (info.type === 'table' && resolverSpacingDeEstilo(info.styleId, 'table', mapaEstilos) !== null) {
        existeEstiloTablaConSpacing = true;
        break;
      }
    }
    if (!existeEstiloTablaConSpacing) return 0;

    const archivosXml: string[] = ['word/document.xml'];
    for (const nombreArchivo in zip.files) {
      if (/^word\/(header|footer)\d+\.xml$/.test(nombreArchivo)) {
        archivosXml.push(nombreArchivo);
      }
    }

    let totalModificados = 0;
    const serializer = new XMLSerializer();

    for (const rutaXml of archivosXml) {
      const xmlFile = zip.file(rutaXml);
      if (!xmlFile) continue;

      try {
        const xmlTexto = xmlFile.asText();
        if (!xmlTexto.includes('<w:tbl') && !xmlTexto.includes(':tbl')) continue;

        const doc = new DOMParser().parseFromString(xmlTexto, 'application/xml');
        if (!doc || !doc.documentElement) continue;

        const modificadosArchivo = normalizarTablasEnDocumentoDOM(doc.documentElement, doc, mapaEstilos);
        if (modificadosArchivo > 0) {
          const nuevoXml = serializer.serializeToString(doc);
          zip.file(rutaXml, nuevoXml);
          totalModificados += modificadosArchivo;
        }
      } catch (err) {
        console.warn(`[LocalContractTemplateService] Error normalizando tablas en ${rutaXml}:`, err);
      }
    }

    return totalModificados;
  }

  /**
   * Recibe un ArrayBuffer DOCX y devuelve una copia en memoria con el espaciado
   * de los párrafos de tablas normalizado según sus estilos OOXML, sin alterar el
   * archivo o buffer original si no requiere cambios.
   */
  public normalizarEspaciadoTablasDOCX(archivoBuffer: ArrayBuffer): ArrayBuffer {
    if (!archivoBuffer || archivoBuffer.byteLength < 100) {
      return archivoBuffer;
    }

    try {
      const zip = new PizZip(archivoBuffer);
      const modificados = this.normalizarEspaciadoTablasEnZip(zip);
      if (modificados > 0) {
        return zip.generate({
          type: 'arraybuffer',
          compression: 'DEFLATE'
        });
      }
      return archivoBuffer;
    } catch (err) {
      console.warn('[LocalContractTemplateService] No se pudo normalizar el binario DOCX:', err);
      return archivoBuffer;
    }
  }

  /**
   * Recupera el ArrayBuffer binario del archivo DOCX.
   * Si es una plantilla sintética y no está en IndexedDB, intenta precargarla desde el directorio público.
   * Por defecto entrega una copia en memoria con el espaciado de tablas normalizado para la emisión,
   * manteniendo intacto el binario original almacenado en IndexedDB.
   */
  public async obtenerBinarioPlantilla(
    id: string,
    opciones?: { normalizarParaEmision?: boolean }
  ): Promise<ArrayBuffer | null> {
    await this.inicializar();
    let buffer = await this.binaryStore.getItem<ArrayBuffer>(id);
    if (!buffer && (id.startsWith('tpl_sintetica_') || id.includes('sintetica'))) {
      try {
        if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
          const res = await window.fetch('/plantillas/plantilla_sintetica_contrato.docx');
          if (res.ok) {
            buffer = await res.arrayBuffer();
            await this.binaryStore.setItem(id, buffer);
          }
        } else {
          const fs = await import('fs');
          const path = await import('path');
          const p = path.resolve('public/plantillas/plantilla_sintetica_contrato.docx');
          if (fs.existsSync(p)) {
            const buf = fs.readFileSync(p);
            buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            await this.binaryStore.setItem(id, buffer);
          }
        }
      } catch (err) {
        console.warn('[LocalContractTemplateService] Fallback de binario sintético falló:', err);
      }
    }
    if (!buffer) return null;

    if (opciones?.normalizarParaEmision === false) {
      return buffer;
    }

    return this.normalizarEspaciadoTablasDOCX(buffer);
  }

  /**
   * Construye el diccionario completo de sustitución compatible con Docxtemplater
   * Incluye simultáneamente:
   * 1) Variables planas de plantillas reales RR.HH. ({{nombre}}, {{rut}}, {{fecha_inicio_larga}}, {{Horario_A}}, {{Sucursal}}, etc.)
   * 2) Variables jerárquicas canónicas ({{trabajador.nombre}}, {{contrato.sueldoBase}}, etc.)
   */
  public generarPayloadSustitucion(contexto: {
    trabajador: {
      nombre: string;
      rut: string;
      cargo?: string;
      fechaNacimiento?: string;
      nacionalidad?: string;
      estadoCivil?: string;
      direccion?: string;
      email?: string;
      telefono?: string;
      afp?: string;
      salud?: string;
      codigoInterno?: string;
    };
    contrato: {
      tipo: string;
      fechaInicio: string;
      fechaTermino?: string;
      cargo: string;
      jornada: string;
      horarioA: string;
      horarioB: string;
      sueldoBase: number;
      ciudadFirma?: string;
      fechaEmisionTexto?: string;
    };
    sucursal?: {
      id?: string;
      nombre?: string;
      direccion?: string;
      comuna?: string;
      empresa?: string;
    };
    empresa?: {
      nombre?: string;
      rut?: string;
      representante?: string;
      direccion?: string;
      comuna?: string;
    };
  }): Record<string, any> {
    const sueldoNum = Number(contexto.contrato.sueldoBase) || 0;
    const sueldoFormatted = '$' + sueldoNum.toLocaleString('es-CL');
    const sueldoSinSigno = sueldoNum.toLocaleString('es-CL');

    const defaultEmpresa = {
      nombre: contexto.sucursal?.empresa || 'GESTIÓN GGSS SECURITY SPA',
      rut: '76.999.888-K',
      representante: 'Representante Legal GGSS',
      direccion: "Av. Libertador Bernardo O'Higgins 1234, Of. 501",
      comuna: 'Santiago'
    };

    const empresaFinal = { ...defaultEmpresa, ...(contexto.empresa || {}) };

    const fechaHoy = new Date().toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const fechaInicioCorta = formatearFechaCorta(contexto.contrato.fechaInicio) || contexto.contrato.fechaInicio || '';
    const fechaInicioLarga = formatearFechaLarga(contexto.contrato.fechaInicio) || fechaHoy;

    const tieneFechaTermino = Boolean(
      contexto.contrato.fechaTermino &&
      contexto.contrato.fechaTermino.trim() !== '' &&
      contexto.contrato.fechaTermino.toLowerCase() !== 'indefinido'
    );
    const fechaTerminoCorta = tieneFechaTermino
      ? formatearFechaCorta(contexto.contrato.fechaTermino)
      : 'Indefinido';
    const fechaTerminoLarga = tieneFechaTermino
      ? formatearFechaLarga(contexto.contrato.fechaTermino)
      : 'Indefinido';

    const fechaNacimientoFormateada = contexto.trabajador.fechaNacimiento
      ? formatearFechaCorta(contexto.trabajador.fechaNacimiento)
      : 'No registrada';

    const trabajadorData = {
      nombre: contexto.trabajador.nombre || '',
      rut: contexto.trabajador.rut || '',
      cargo: contexto.trabajador.cargo || contexto.contrato.cargo || 'Guardia de Seguridad',
      fechaNacimiento: fechaNacimientoFormateada,
      nacionalidad: contexto.trabajador.nacionalidad || 'Chilena',
      estadoCivil: contexto.trabajador.estadoCivil || 'Soltero(a)',
      direccion: contexto.trabajador.direccion || 'Sin registrar',
      email: contexto.trabajador.email || '',
      telefono: contexto.trabajador.telefono || 'Sin registrar',
      afp: contexto.trabajador.afp || 'Modelo',
      salud: contexto.trabajador.salud || 'Fonasa',
      codigoInterno: contexto.trabajador.codigoInterno || '10'
    };

    const sucursalData = {
      nombre: contexto.sucursal?.nombre || 'MULTISITIO GGSS',
      direccion: contexto.sucursal?.direccion || 'Av. General GGSS 100',
      comuna: contexto.sucursal?.comuna || 'Santiago',
      empresa: contexto.sucursal?.empresa || empresaFinal.nombre
    };

    const contratoData = {
      tipo: contexto.contrato.tipo,
      fechaInicio: contexto.contrato.fechaInicio,
      fechaInicioCorta,
      fechaInicioLarga,
      fechaTermino: contexto.contrato.fechaTermino || 'Indefinido',
      cargo: contexto.contrato.cargo || trabajadorData.cargo,
      jornada: contexto.contrato.jornada || '45 horas semanales',
      horarioA: contexto.contrato.horarioA || '08:30 AM a 18:30 PM',
      horarioB: contexto.contrato.horarioB || '18:00 PM a 09:00 AM',
      sueldo: sueldoFormatted,
      sueldoBase: sueldoNum,
      sueldoBaseFormatted: sueldoFormatted,
      ciudadFirma: contexto.contrato.ciudadFirma || 'Rancagua',
      fechaEmisionTexto: contexto.contrato.fechaEmisionTexto || fechaHoy
    };

    return {
      // 1. Objetos jerárquicos canónicos
      trabajador: trabajadorData,
      empresa: empresaFinal,
      contrato: contratoData,
      sucursal: sucursalData,

      // 2. Variables planas directas para plantillas Word de RR.HH. ASPRO
      nombre: trabajadorData.nombre,
      rut: trabajadorData.rut,
      fecha_nacimiento: trabajadorData.fechaNacimiento,
      nacionalidad: trabajadorData.nacionalidad,
      direccion: trabajadorData.direccion,
      estado_civil: trabajadorData.estadoCivil,
      telefono: trabajadorData.telefono,
      salud: trabajadorData.salud,
      afp: trabajadorData.afp,
      codigo_interno: trabajadorData.codigoInterno,
      cargo: contratoData.cargo,
      email: trabajadorData.email,

      fecha_inicio: fechaInicioCorta,
      fecha_inicio_corta: fechaInicioCorta,
      fecha_inicio_larga: fechaInicioLarga,
      fecha_termino: fechaTerminoCorta,
      fecha_termino_corta: fechaTerminoCorta,
      fecha_termino_larga: fechaTerminoLarga,

      sueldo: sueldoSinSigno,
      sueldo_base: sueldoFormatted,
      Horario_A: contratoData.horarioA,
      Horario_B: contratoData.horarioB,
      horarioA: contratoData.horarioA,
      horarioB: contratoData.horarioB,
      horario_a: contratoData.horarioA,
      horario_b: contratoData.horarioB,
      jornada: contratoData.jornada,
      tipo_contrato: contratoData.tipo,

      Sucursal: sucursalData.nombre,
      sucursal_name: sucursalData.nombre,
      direccion_sucursal: sucursalData.direccion,
      sucursal_address: sucursalData.direccion
    };
  }

  /**
   * Resuelve el valor de una etiqueta (plana o con punto) desde el payload de sustitución
   */
  public resolverValorVariable(nombreVariable: string, payloadSustitucion: Record<string, any>): any {
    if (!nombreVariable || !payloadSustitucion) return undefined;
    const clean = nombreVariable.trim();

    // Caso especial: 'empresa' plano vs objeto 'empresa'
    if (clean === 'empresa' && typeof payloadSustitucion.empresa === 'object' && payloadSustitucion.empresa !== null) {
      return payloadSustitucion.sucursal?.empresa || payloadSustitucion.empresa.nombre || 'ASPRO SPA';
    }
    // Caso especial: 'sucursal' plano vs objeto 'sucursal'
    if ((clean === 'sucursal' || clean === 'Sucursal') && typeof payloadSustitucion.sucursal === 'object' && payloadSustitucion.sucursal !== null) {
      return payloadSustitucion.Sucursal || payloadSustitucion.sucursal.nombre || '';
    }

    if (clean in payloadSustitucion) {
      const val = payloadSustitucion[clean];
      if (typeof val !== 'object' || val === null) return val;
    }

    if (!clean.includes('.')) {
      const lower = clean.toLowerCase();
      const foundKey = Object.keys(payloadSustitucion).find(k => k.toLowerCase() === lower);
      if (foundKey) {
        const val = payloadSustitucion[foundKey];
        if (typeof val !== 'object' || val === null) return val;
      }
    }

    return clean.split('.').reduce((acc: any, part: string) => (acc ? acc[part] : undefined), payloadSustitucion as any);
  }

  /**
   * Valida exhaustivamente si el contexto suministrado satisface todas las variables de la plantilla.
   * Si alguna variable obligatoria está vacía o no resuelta, bloquea la emisión con una explicación clara.
   */
  public validarVariablesParaEmision(
    plantilla: PlantillaContractual,
    payloadSustitucion: Record<string, any>
  ): { valida: boolean; errores: string[] } {
    const errores: string[] = [];

    for (const vOriginal of plantilla.variablesDetectadas) {
      const v = this.clasificarVariable(vOriginal.nombre);
      if (!v.existeEnAspro) {
        errores.push(`La variable "{{${v.nombre}}}" no es reconocida por el sistema ASPRO.`);
        continue;
      }

      const valor = this.resolverValorVariable(v.nombre, payloadSustitucion);
      const valorStr = typeof valor === 'string' ? valor.trim() : '';
      const esVariableSueldo = v.nombre.toLowerCase().includes('sueldo');
      const sueldoNumerico = esVariableSueldo
        ? Number(String(valor ?? '').replace(/[^0-9-]/g, ''))
        : 0;

      const estaVacio =
        valor === undefined ||
        valor === null ||
        (typeof valor === 'string' && valorStr === '') ||
        (esVariableSueldo && (!sueldoNumerico || sueldoNumerico <= 0));

      if (v.obligatoria && estaVacio) {
        errores.push(`La variable obligatoria "{{${v.nombre}}}" no tiene un valor válido definido (${v.descripcion}).`);
      }
    }

    return {
      valida: errores.length === 0,
      errores
    };
  }

  /**
   * Activa o desactiva una plantilla
   */
  public async cambiarEstadoPlantilla(id: string, activa: boolean): Promise<PlantillaContractual> {
    const p = await this.obtenerPlantillaPorId(id);
    if (!p) throw new Error(`Plantilla #${id} no encontrada.`);

    if (activa && p.erroresValidacion.length > 0) {
      throw new Error(`No se puede activar la plantilla #${id} porque tiene errores de validación pendientes.`);
    }

    const actualizada: PlantillaContractual = { ...p, activa };
    await this.metadataStore.setItem(id, actualizada);
    return actualizada;
  }

  /**
   * Elimina una plantilla y su binario asociado
   */
  public async eliminarPlantilla(id: string): Promise<void> {
    await this.metadataStore.removeItem(id);
    await this.binaryStore.removeItem(id);
  }

  /**
   * Crea una URL Blob temporal para descargar la plantilla original y la revoca inmediatamente tras su uso
   */
  public async crearDescargaPlantilla(id: string): Promise<{ url: string; nombreArchivo: string; revocar: () => void }> {
    const p = await this.obtenerPlantillaPorId(id);
    if (!p) throw new Error(`Plantilla #${id} no encontrada.`);

    const buffer = await this.obtenerBinarioPlantilla(id, { normalizarParaEmision: false });
    if (!buffer) throw new Error(`Archivo binario para plantilla #${id} no disponible.`);

    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    const url = URL.createObjectURL(blob);
    return {
      url,
      nombreArchivo: p.archivoNombre || `${p.nombre}.docx`,
      revocar: () => URL.revokeObjectURL(url)
    };
  }
}

export const localContractTemplateService = new LocalContractTemplateService();
