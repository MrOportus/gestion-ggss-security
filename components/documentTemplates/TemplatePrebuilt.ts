/**
 * TemplatePrebuilt.ts
 * Plantillas pre-construidas: Reglamento Interno y Entrega EPP.
 * Se cargan como punto de partida para el admin.
 */
import { DocumentTemplate, TemplateBloque } from '../../types';

const blk = (tipo: TemplateBloque['tipo'], overrides: Partial<TemplateBloque> = {}): TemplateBloque => ({
    id: `pre_${tipo}_${Math.random().toString(36).substring(2, 7)}`,
    tipo,
    orden: 0,
    ...overrides,
});

export const TEMPLATE_REGLAMENTO_INTERNO: Omit<DocumentTemplate, 'id' | 'creadoEn'> = {
    nombre: 'Reglamento Interno de Orden, Higiene y Seguridad',
    tipo: 'Reglamento',
    version: 1,
    estado: 'activo',
    creadoPor: '',
    firmaConfig: { pageType: 'last', posicionX: 72, posicionY: 120 },
    bloques: [
        blk('imagen',           { orden: 0, imageUrl: '', alineacion: 'center', label: 'Logo empresa' }),
        blk('titulo',           { orden: 1, contenido: 'REGLAMENTO INTERNO DE ORDEN, HIGIENE Y SEGURIDAD', alineacion: 'center', negrita: true, fontSize: 16 }),
        blk('subtitulo',        { orden: 2, contenido: 'CONSTANCIA DE RECEPCIÓN Y ACEPTACIÓN', alineacion: 'center', negrita: true, fontSize: 13 }),
        blk('linea',            { orden: 3 }),
        blk('texto',            { orden: 4, contenido: 'Por medio del presente instrumento, declaro haber recibido una copia del Reglamento Interno de Orden, Higiene y Seguridad de la empresa, y me comprometo a leerlo y cumplir íntegramente con sus disposiciones, en conformidad con lo establecido en el Código del Trabajo y demás normativa vigente.', fontSize: 11 }),
        blk('espaciador',       { orden: 5, altura: 12 }),
        blk('campo_automatico', { orden: 6, contenido: 'trabajador.nombre', label: 'Nombre Completo' }),
        blk('campo_automatico', { orden: 7, contenido: 'trabajador.rut', label: 'RUT' }),
        blk('campo_automatico', { orden: 8, contenido: 'trabajador.cargo', label: 'Cargo' }),
        blk('campo_automatico', { orden: 9, contenido: 'trabajador.sucursal', label: 'Lugar de Trabajo' }),
        blk('campo_automatico', { orden: 10, contenido: 'documento.fecha', label: 'Fecha de Entrega' }),
        blk('espaciador',       { orden: 11, altura: 24 }),
        blk('texto',            { orden: 12, contenido: 'El incumplimiento de las disposiciones contenidas en este Reglamento podrá dar origen a las sanciones establecidas en él, sin perjuicio de las acciones legales que procedan.', fontSize: 10, cursiva: true }),
        blk('linea',            { orden: 13 }),
        blk('firma',            { orden: 14, label: 'Firma del Trabajador' }),
        blk('campo_manual',     { orden: 15, etiquetaCampo: 'Aclaración de Firma', requerido: false }),
    ].map((b, i) => ({ ...b, orden: i })),
};

export const TEMPLATE_EPP: Omit<DocumentTemplate, 'id' | 'creadoEn'> = {
    nombre: 'Entrega de Elementos de Protección Personal (EPP)',
    tipo: 'EPP',
    version: 1,
    estado: 'activo',
    creadoPor: '',
    firmaConfig: { pageType: 'last', posicionX: 72, posicionY: 120 },
    bloques: [
        blk('titulo',           { orden: 0, contenido: 'ACTA DE ENTREGA DE EPP', alineacion: 'center', negrita: true, fontSize: 16 }),
        blk('subtitulo',        { orden: 1, contenido: 'Elementos de Protección Personal', alineacion: 'center', fontSize: 13 }),
        blk('linea',            { orden: 2 }),
        blk('texto',            { orden: 3, contenido: 'En conformidad con el D.S. N°594 del Ministerio de Salud y la normativa de seguridad vigente, se hace entrega de los siguientes Elementos de Protección Personal (EPP) al trabajador individualizado a continuación:', fontSize: 11 }),
        blk('espaciador',       { orden: 4, altura: 8 }),
        blk('campo_automatico', { orden: 5, contenido: 'trabajador.nombre', label: 'Nombre Completo' }),
        blk('campo_automatico', { orden: 6, contenido: 'trabajador.rut', label: 'RUT' }),
        blk('campo_automatico', { orden: 7, contenido: 'trabajador.cargo', label: 'Cargo' }),
        blk('campo_automatico', { orden: 8, contenido: 'trabajador.sucursal', label: 'Faena / Sucursal' }),
        blk('linea',            { orden: 9 }),
        blk('subtitulo',        { orden: 10, contenido: 'TALLAS DEL TRABAJADOR', fontSize: 12, negrita: true }),
        blk('campo_automatico', { orden: 11, contenido: 'trabajador.tallePantalon', label: 'Talle Pantalón' }),
        blk('campo_automatico', { orden: 12, contenido: 'trabajador.talleCamisa', label: 'Talle Camisa' }),
        blk('campo_automatico', { orden: 13, contenido: 'trabajador.talleChaqueta', label: 'Talle Chaqueta/Chaleco' }),
        blk('campo_automatico', { orden: 14, contenido: 'trabajador.tallePolar', label: 'Talle Polar' }),
        blk('campo_automatico', { orden: 15, contenido: 'trabajador.talleGeologo', label: 'Talle Geólogo' }),
        blk('campo_automatico', { orden: 16, contenido: 'trabajador.talleCalzado', label: 'Talle Calzado' }),
        blk('linea',            { orden: 17 }),
        blk('subtitulo',        { orden: 18, contenido: 'EPP ENTREGADOS', fontSize: 12, negrita: true }),
        blk('tabla',            { orden: 19, columnas: ['Elemento', 'Cantidad', 'Talla/Especificación', 'Observaciones'], filas: [['Casco de seguridad', '1', 'Estándar', ''], ['Chaleco reflectante', '1', '', ''], ['Guantes de seguridad', '1 par', '', ''], ['Zapatos de seguridad', '1 par', '', ''], ['Lentes de seguridad', '1', 'Transparentes', '']] }),
        blk('espaciador',       { orden: 20, altura: 12 }),
        blk('texto',            { orden: 21, contenido: 'El trabajador declara haber recibido los elementos listados en buen estado y se compromete a utilizarlos correctamente durante su jornada laboral, mantenerlos en buen estado y reportar cualquier deterioro.', fontSize: 10 }),
        blk('campo_automatico', { orden: 22, contenido: 'documento.fecha', label: 'Fecha de Entrega' }),
        blk('linea',            { orden: 23 }),
        blk('firma',            { orden: 24, label: 'Firma del Trabajador — Conforme' }),
    ].map((b, i) => ({ ...b, orden: i })),
};

// ─── Formulario Oficial de Entrega EPP (Formato Imagen) ───────────────────────
// Replica el formato del documento físico: encabezado ISO, datos funcionario,
// dotación personal (número manual), checklist EPP 2 columnas con tallas auto,
// solo firma de RECIBE. Diseñado para caber en 1 sola hoja.
export const TEMPLATE_EPP_OFICIAL: Omit<DocumentTemplate, 'id' | 'creadoEn'> = {
    nombre: 'Formulario Entrega EPP — Formato Oficial (SG-SST)',
    tipo: 'EPP',
    version: 1,
    estado: 'activo',
    creadoPor: '',
    firmaConfig: { pageType: 'last', posicionX: 350, posicionY: 90 },
    bloques: [
        // 1. Encabezado ISO con logo
        blk('encabezado_iso', {
            orden: 0,
            tituloSistema: 'Sistema de Gestión de la Seguridad y Salud en el Trabajo',
            tituloDocumento: 'FORMULARIO DE ENTREGA DE ELEMENTOS DE PROTECCIÓN PERSONAL',
            codigoDocumento: 'SG-SST',
            versionDocumento: '001',
        }),

        // 2. Separador
        blk('espaciador', { orden: 1, altura: 6 }),

        // 3. Sección: Datos del Funcionario
        blk('subtitulo', { orden: 2, contenido: 'DATOS DEL FUNCIONARIO', alineacion: 'center', negrita: true, fontSize: 10 }),
        blk('linea',     { orden: 3 }),

        // Nombre completo + RUT en misma línea (2 campos auto)
        blk('campo_automatico', { orden: 4, contenido: 'trabajador.nombre', label: 'Nombre y Apellidos' }),
        blk('campo_automatico', { orden: 5, contenido: 'trabajador.rut',    label: 'RUT' }),
        blk('campo_automatico', { orden: 6, contenido: 'trabajador.cargo',  label: 'Cargo' }),
        blk('campo_automatico', { orden: 7, contenido: 'trabajador.sucursal', label: 'Proceso (Instalación / Sucursal)' }),
        blk('campo_automatico', { orden: 8, contenido: 'documento.fecha',   label: 'Fecha' }),

        blk('espaciador', { orden: 9, altura: 4 }),

        // 4. Sección: Dotación Personal — ropa con talla desde sistema
        blk('subtitulo', { orden: 10, contenido: 'DOTACIÓN PERSONAL', alineacion: 'center', negrita: true, fontSize: 10 }),
        blk('linea',     { orden: 11 }),
        blk('dotacion_personal', { 
            orden: 12,
            filas_dotacion: [
                { label: 'Zapato',    claveTalla: 'trabajador.talleCalzado' },
                { label: 'Chaqueta',  claveTalla: 'trabajador.talleChaqueta' },
                { label: 'Pantalón',  claveTalla: 'trabajador.tallePantalon' },
                { label: 'Camisa',    claveTalla: 'trabajador.talleCamisa' },
                { label: 'Geólogo',   claveTalla: 'trabajador.talleGeologo' },
            ]
        }),

        blk('espaciador', { orden: 13, altura: 4 }),

        // 5. Sección: Elementos de Protección Personal (checklist 2 columnas)
        blk('subtitulo', { orden: 14, contenido: 'ELEMENTOS DE PROTECCIÓN PERSONAL', alineacion: 'center', negrita: true, fontSize: 10 }),
        blk('linea',     { orden: 15 }),

        // Checklist 2 columnas — izquierda y derecha intercaladas
        // claveTalla enlaza con el campo del trabajador (auto desde sistema, vacío si no existe)
        blk('checklist_2col', {
            orden: 16,
            filas_epp: [
                // Columna izquierda
                { label: 'Camisa Negra con logo Empresa',        claveTalla: 'trabajador.talleCamisa' },
                { label: 'Pantalón cargo color negro',           claveTalla: 'trabajador.tallePantalon' },
                { label: 'Polar color negro',                    claveTalla: 'trabajador.tallePolar' },
                { label: 'Chaqueta roja con logo',               claveTalla: 'trabajador.talleChaqueta' },
                { label: 'Geólogo rojo con logo',                claveTalla: 'trabajador.talleGeologo' },
                { label: 'Gorro Polar' },
                { label: 'Cuello polar' },
                { label: 'Zapato de seguridad',                  claveTalla: 'trabajador.talleCalzado' },
                { label: 'Casco seguridad blanco con logo' },
                { label: 'Lentes de sol filtro UV' },
                // Columna derecha
                { label: 'Protector Auditivo Tipo Orejera' },
                { label: 'Primera Capa' },
                { label: 'Botas Impermeables con Puntera Acero', claveTalla: 'trabajador.talleCalzado' },
                { label: 'Gafas de Seguridad' },
                { label: 'Guantes' },
                { label: 'Chaleco anticorte' },
                { label: 'Chaleco Antibalas' },
                { label: 'Gorro color negro' },
                { label: 'Mascarillas' },
            ],
        }),

        blk('espaciador', { orden: 17, altura: 8 }),

        // 6. Sección: Firma — solo RECIBE
        blk('subtitulo', { orden: 18, contenido: 'FIRMAS', alineacion: 'center', negrita: true, fontSize: 10 }),
        blk('linea',     { orden: 19 }),
        blk('espaciador', { orden: 20, altura: 20 }),
        blk('firma',     { orden: 21, label: 'RECIBE' }),
        blk('campo_automatico', { orden: 22, contenido: 'trabajador.nombre', label: 'Nombre' }),
        blk('campo_automatico', { orden: 23, contenido: 'trabajador.rut',    label: 'RUT' }),
        blk('campo_automatico', { orden: 24, contenido: 'trabajador.cargo',  label: 'Cargo' }),
    ].map((b, i) => ({ ...b, orden: i })),
};

export const PLANTILLAS_PREBUILT = [TEMPLATE_REGLAMENTO_INTERNO, TEMPLATE_EPP, TEMPLATE_EPP_OFICIAL];
