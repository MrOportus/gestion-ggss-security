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
    nombre: 'Reglamento interno prueba',
    tipo: 'Reglamento',
    version: 1,
    estado: 'activo',
    creadoPor: '',
    firmaConfig: {"pageType":"last","posicionX":246,"posicionY":90},
    bloques: [
        blk('encabezado_iso', {"alineacion":"left","imageWidth":60,"contenido":"","negrita":false,"fontSize":12}),
        blk('linea', {"alineacion":"left","negrita":false,"contenido":"","fontSize":12}),
        blk('subtitulo', {"contenido":"FORMULARIO RECEPCIÓN DEL REGLAMENTO INTERNO DE ORDEN, \nHIGIENE Y SEGURIDAD, ART. 67º DE LA LEY Nº 16.744, TITULO III DEL \nCÓDIGO DEL TRABAJO, D.F.L. N° 1","fontSize":14,"alineacion":"center","negrita":true}),
        blk('espaciador', {"altura":6,"negrita":false,"alineacion":"left","contenido":"","fontSize":12}),
        blk('texto', {"negrita":false,"alineacion":"center","fontSize":12,"contenido":"Declaro haber recibido en forma gratuita una copia del reglamento interno de orden, \nhigiene y seguridad de la empresa ASPRO SPA, de acuerdo a lo establecido en el \nArt. 156° inciso 2 del código del trabajo, Art. 14 del decreto supremo Nº 40 de 1969 \ndel ministerio del trabajo y previsión social, publicado en el diario oficial del 07 de \nmarzo de 1969 como reglamento de la ley 16.744 de 1968. \nAsumo mi responsabilidad de dar lectura a su contenido y dar cumplimiento a las \nobligaciones, prohibiciones, normas de orden, higiene y seguridad que en él están \nescritas, como así también a las disposiciones y procedimientos que en forma \nposterior se emitan y/o modifiquen y que formen parte de este reglamento o que \nexpresamente lo indique."}),
        blk('linea', {"negrita":false,"fontSize":12,"alineacion":"left","contenido":""}),
        blk('campo_automatico', {"alineacion":"left","negrita":false,"label":"Nombre Completo","fontSize":12,"contenido":"trabajador.nombre"}),
        blk('campo_automatico', {"alineacion":"left","negrita":false,"contenido":"trabajador.rut","fontSize":12,"label":"RUT"}),
        blk('campo_automatico', {"alineacion":"left","negrita":false,"contenido":"trabajador.sucursal","fontSize":12,"label":"Sucursal / Faena"}),
        blk('campo_automatico', {"negrita":false,"label":"Cargo","contenido":"trabajador.cargo","alineacion":"left","fontSize":12}),
        blk('fecha', {"alineacion":"left","negrita":false,"contenido":"","fontSize":12}),
        blk('linea', {"fontSize":12,"alineacion":"left","negrita":false,"contenido":""}),
        blk('espaciador', {"fontSize":12,"alineacion":"left","altura":30,"contenido":"","negrita":false}),
        blk('firma', {"alineacion":"left","negrita":false,"contenido":"","fontSize":12}),
        blk('espaciador', {"fontSize":12,"negrita":false,"contenido":"","alineacion":"left"}),
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
    version: 2,
    estado: 'activo',
    creadoPor: '',
    firmaConfig: {"pageType":"last","posicionX":350,"posicionY":90},
    bloques: [
        blk('encabezado_iso', {"tituloSistema":"EPP","tituloDocumento":"FORMULARIO DE ENTREGA DE ELEMENTOS DE PROTECCIÓN PERSONAL","codigoDocumento":"SG-SST","versionDocumento":"001","imageWidth":65}),
        blk('espaciador', {"altura":6}),
        blk('subtitulo', {"fontSize":10,"contenido":"DATOS DEL FUNCIONARIO","negrita":true,"alineacion":"center"}),
        blk('linea', {}),
        blk('campo_automatico', {"label":"Nombre y Apellidos","contenido":"trabajador.nombre"}),
        blk('campo_automatico', {"label":"RUT","contenido":"trabajador.rut"}),
        blk('campo_automatico', {"label":"Cargo","contenido":"trabajador.cargo"}),
        blk('campo_automatico', {"label":"Proceso (Instalación / Sucursal)","contenido":"trabajador.sucursal"}),
        blk('campo_automatico', {"label":"Fecha","contenido":"documento.fecha"}),
        blk('espaciador', {"altura":4}),
        blk('subtitulo', {"contenido":"DOTACIÓN PERSONAL","negrita":true,"alineacion":"center","fontSize":10}),
        blk('linea', {}),
        blk('dotacion_personal', {"filas_dotacion":[{"claveTalla":"trabajador.talleCalzado","label":"Zapato"},{"label":"Chaqueta","claveTalla":"trabajador.talleChaqueta"},{"label":"Pantalón","claveTalla":"trabajador.tallePantalon"},{"label":"Camisa","claveTalla":"trabajador.talleCamisa"},{"claveTalla":"trabajador.talleGeologo","label":"Geólogo"}]}),
        blk('espaciador', {"altura":4}),
        blk('subtitulo', {"contenido":"ELEMENTOS DE PROTECCIÓN PERSONAL","alineacion":"center","negrita":true,"fontSize":10}),
        blk('linea', {}),
        blk('checklist_2col', {"filas_epp":[{"label":"Camisa Negra con logo Empresa","claveTalla":"trabajador.talleCamisa"},{"claveTalla":"trabajador.tallePantalon","label":"Pantalón cargo color negro"},{"label":"Polar color negro","claveTalla":"trabajador.tallePolar"},{"label":"Chaqueta roja con logo","claveTalla":"trabajador.talleChaqueta"},{"claveTalla":"trabajador.talleGeologo","label":"Geólogo rojo con logo"},{"label":"Gorro Polar"},{"label":"Cuello polar"},{"label":"Zapato de seguridad","claveTalla":"trabajador.talleCalzado"},{"label":"Casco seguridad blanco con logo"},{"label":"Lentes de sol filtro UV"},{"label":"Protector Auditivo Tipo Orejera"},{"label":"Primera Capa"},{"label":"Botas Impermeables con Puntera Acero","claveTalla":"trabajador.talleCalzado"},{"label":"Gafas de Seguridad"},{"label":"Guantes"},{"label":"Chaleco anticorte"},{"label":"Chaleco Antibalas"},{"label":"Gorro color negro"},{"label":"Mascarillas"}]}),
        blk('espaciador', {"altura":8}),
        blk('subtitulo', {"alineacion":"center","contenido":"FIRMAS","fontSize":10,"negrita":true}),
        blk('linea', {}),
        blk('espaciador', {"altura":35}),
        blk('firma', {"label":"RECIBE"}),
    ].map((b, i) => ({ ...b, orden: i })),
};


export const PLANTILLAS_PREBUILT = [TEMPLATE_REGLAMENTO_INTERNO, TEMPLATE_EPP, TEMPLATE_EPP_OFICIAL];
