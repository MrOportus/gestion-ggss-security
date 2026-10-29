const fs = require('fs');
const path = require('path');
const { 
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, 
    WidthType, AlignmentType, Header, Footer, PageNumber, NumberFormat,
    BorderStyle, HeadingLevel
} = require('docx');

async function createSyntheticContractTemplate() {
    console.log('[Lab] Generando plantilla sintética representativa de contrato de trabajo (4-5 páginas)...');

    const borderConfig = {
        style: BorderStyle.SINGLE,
        size: 1,
        color: 'CCCCCC'
    };

    const doc = new Document({
        styles: {
            default: {
                document: {
                    run: {
                        font: 'Calibri',
                        size: 22, // 11pt
                        color: '222222'
                    },
                    paragraph: {
                        spacing: {
                            line: 276, // 1.15 line spacing
                            after: 140  // ~7pt space after
                        }
                    }
                }
            }
        },
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: 1440,    // 1 inch = 72pt = 1440 twips
                        right: 1440,
                        bottom: 1440,
                        left: 1440
                    }
                }
            },
            headers: {
                default: new Header({
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.RIGHT,
                            children: [
                                new TextRun({
                                    text: "ASPRO SECURITY — CONTRATO INDIVIDUAL DE TRABAJO",
                                    font: "Calibri",
                                    size: 16, // 8pt
                                    color: "777777",
                                    bold: true
                                })
                            ]
                        })
                    ]
                })
            },
            footers: {
                default: new Footer({
                    children: [
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [
                                new TextRun({
                                    text: "Página ",
                                    font: "Calibri",
                                    size: 18,
                                    color: "888888"
                                }),
                                new TextRun({
                                    children: [PageNumber.CURRENT],
                                    font: "Calibri",
                                    size: 18,
                                    color: "888888"
                                }),
                                new TextRun({
                                    text: " de ",
                                    font: "Calibri",
                                    size: 18,
                                    color: "888888"
                                }),
                                new TextRun({
                                    children: [PageNumber.TOTAL_PAGES],
                                    font: "Calibri",
                                    size: 18,
                                    color: "888888"
                                })
                            ]
                        })
                    ]
                })
            },
            children: [
                // PORTADA / TÍTULO PRINCIPAL
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 300, before: 100 },
                    children: [
                        new TextRun({
                            text: "CONTRATO INDIVIDUAL DE TRABAJO A PLAZO FIJO",
                            font: "Calibri",
                            bold: true,
                            size: 28, // 14pt
                            color: "111827"
                        })
                    ]
                }),

                // COMPARECENCIA
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "En Santiago de Chile, entre ",
                        }),
                        new TextRun({
                            text: "GGSS SECURITY SPA",
                            bold: true
                        }),
                        new TextRun({
                            text: ", R.U.T. 76.999.888-K, representada legalmente por don Representante Legal Ficticio, ambos domiciliados para estos efectos en Av. Libertador Bernardo O'Higgins N° 1234, comuna de Santiago, en adelante la \"Empleadora\", y por otra parte el/la trabajador(a) don(ña) "
                        }),
                        new TextRun({
                            text: "{{trabajador.nombre}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: ", Cédula Nacional de Identidad N° "
                        }),
                        new TextRun({
                            text: "{{trabajador.rut}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: ", domiciliado(a) en "
                        }),
                        new TextRun({
                            text: "{{trabajador.direccion}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: ", en adelante el \"Trabajador\", se ha convenido el siguiente contrato de trabajo:"
                        })
                    ]
                }),

                // CLÁUSULA PRIMERA: NATURALEZA DE LOS SERVICIOS
                new Paragraph({
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "PRIMERO: NATURALEZA DE LOS SERVICIOS Y FUNCIONES.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "El Trabajador se compromete a prestar sus servicios como Guardia de Seguridad en las dependencias de la sucursal denominada "
                        }),
                        new TextRun({
                            text: "{{sucursal.nombre}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: ", sin perjuicio de poder ser reasignado a otras instalaciones dentro de la misma región por motivos justificados y con arreglo a la normativa laboral vigente. Sus funciones comprenderán la vigilancia de bienes, control de accesos peatonales y vehiculares, registro de novedades operativas en el libro de servicio y cumplimiento estricto de las directivas de funcionamiento autorizadas por la autoridad fiscalizadora OS-10 de Carabineros de Chile."
                        })
                    ]
                }),

                // CLÁUSULA SEGUNDA: JORNADA Y HORARIOS (CON TABLA)
                new Paragraph({
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "SEGUNDO: JORNADA DE TRABAJO Y SISTEMA DE TURNOS.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "La jornada ordinaria de trabajo convenida corresponde a: "
                        }),
                        new TextRun({
                            text: "{{contrato.jornada}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: ", la cual será distribuida en la siguiente tabla operativa de turnos rotativos conforme a las necesidades de resguardo de la instalación:"
                        })
                    ]
                }),

                // TABLA DE HORARIOS
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    borders: {
                        top: borderConfig,
                        bottom: borderConfig,
                        left: borderConfig,
                        right: borderConfig,
                        insideHorizontal: borderConfig,
                        insideVertical: borderConfig
                    },
                    rows: [
                        new TableRow({
                            children: [
                                new TableCell({
                                    width: { size: 25, type: WidthType.PERCENTAGE },
                                    children: [new Paragraph({ children: [new TextRun({ text: "Turno", bold: true })] })]
                                }),
                                new TableCell({
                                    width: { size: 40, type: WidthType.PERCENTAGE },
                                    children: [new Paragraph({ children: [new TextRun({ text: "Horario de Entrada y Salida", bold: true })] })]
                                }),
                                new TableCell({
                                    width: { size: 35, type: WidthType.PERCENTAGE },
                                    children: [new Paragraph({ children: [new TextRun({ text: "Tiempo de Colación", bold: true })] })]
                                }),
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Turno A (Diurno)" })] })]
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "08:00 hrs a 20:00 hrs" })] })]
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "60 minutos (imputable a jornada)" })] })]
                                }),
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Turno B (Nocturno)" })] })]
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "20:00 hrs a 08:00 hrs" })] })]
                                }),
                                new TableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "60 minutos (imputable a jornada)" })] })]
                                }),
                            ]
                        })
                    ]
                }),

                // CLÁUSULA TERCERA: REMUNERACIÓN
                new Paragraph({
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "TERCERO: REMUNERACIÓN Y ASIGNACIONES.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "La Empleadora pagará al Trabajador un sueldo base mensual correspondiente a la suma de $"
                        }),
                        new TextRun({
                            text: "{{contrato.sueldo}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: " pesos chilenos líquidos, los cuales serán pagados por mes vencido el último día hábil de cada mes calendario mediante transferencia bancaria a la cuenta declarada por el trabajador. Asimismo, las partes acuerdan el pago de anticipo voluntario el día 15 de cada mes conforme a la política interna de la empresa."
                        })
                    ]
                }),

                // SALTO DE PÁGINA 1 -> PÁGINA 2
                new Paragraph({
                    pageBreakBefore: true,
                    spacing: { before: 100, after: 100 },
                    children: [
                        new TextRun({
                            text: "CUARTO: VIGENCIA DEL CONTRATO DE TRABAJO.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "El presente contrato tendrá una duración a plazo fijo, iniciando su vigencia con fecha "
                        }),
                        new TextRun({
                            text: "{{contrato.fechaInicio}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: " y expirando el día "
                        }),
                        new TextRun({
                            text: "{{contrato.fechaTermino}}",
                            bold: true,
                            color: "1D4ED8"
                        }),
                        new TextRun({
                            text: ", fecha en la cual terminará sin necesidad de desahucio ni aviso previo, a menos que las partes acuerden formalmente su prórroga o renovación mediante anexo de contrato respectivo suscrito por ambas partes."
                        })
                    ]
                }),

                // CLÁUSULA EXTENSA QUE SE EXTIENDE A TRAVÉS DE PÁGINAS (QUINTO)
                new Paragraph({
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "QUINTO: DEBERES, OBLIGACIONES Y PROHIBICIONES OPERATIVAS ESPECÍFICAS DE SEGURIDAD PRIVADA.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "Dada la naturaleza crítica de la función de seguridad privada según el Decreto Ley N° 3.607 y su reglamento, el Trabajador se compromete especialmente a dar estricto cumplimiento a las siguientes obligaciones contractuales:"
                        })
                    ]
                }),
                ...[
                    "a) Portar en forma visible durante toda su jornada la credencial de identificación otorgada por la Autoridad Fiscalizadora OS-10 de Carabineros de Chile, manteniéndola vigente y en óptimo estado de conservación.",
                    "b) Vestir de manera impecable el uniforme reglamentario proporcionado por la Empleadora, prohibiéndose expresamente el uso de accesorios o prendas ajenas a la dotación oficial autorizada.",
                    "c) Permanecer en su puesto de vigilancia durante toda la jornada, prohibiéndose el abandono de servicio sin contar con el debido relevo formal registrado en el libro de novedades.",
                    "d) Registrar con exactitud e inmediatez toda incidencia, ingreso no autorizado, daño a instalaciones o contingencia en el aplicativo digital de gestión operativa ASPRO o en la bitácora física de la sucursal.",
                    "e) Prohibición absoluta de ingerir bebidas alcohólicas, estupefacientes o medicamentos que alteren su capacidad psicofísica en el servicio o presentarse a este bajo su influencia.",
                    "f) Prohibición de manipular aparatos celulares o dispositivos multimedia personales en momentos que comprometan la vigilancia efectiva de las áreas asignadas.",
                    "g) Mantener estricta confidencialidad sobre los sistemas de seguridad, claves de acceso, cámaras de televigilancia, rutinas de rondas y protocolos de emergencia de la empresa mandante.",
                    "h) Cumplir y respetar los protocolos de prevención de riesgos y uso obligatorio de Elementos de Protección Personal (EPP) entregados con cargo a la empresa."
                ].map(item => new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { after: 120 },
                    indent: { left: 400 },
                    children: [new TextRun({ text: item })]
                })),

                // SALTO DE PÁGINA 2 -> PÁGINA 3
                new Paragraph({
                    pageBreakBefore: true,
                    spacing: { before: 100, after: 100 },
                    children: [
                        new TextRun({
                            text: "SEXTO: PROPIEDAD INTELECTUAL, CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "El Trabajador se obliga a guardar rigurosa reserva respecto de todos aquellos antecedentes comerciales, operativos, técnicos y de seguridad de la Empleadora y de los clientes mandantes a los que tenga acceso con motivo de sus funciones. La infracción de esta cláusula facultará a la Empleadora para poner término inmediato al contrato de conformidad al artículo 160 N° 1 del Código del Trabajo, sin perjuicio de las acciones civiles y penales pertinentes."
                        })
                    ]
                }),

                new Paragraph({
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "SÉPTIMO: ELEMENTOS DE PROTECCIÓN PERSONAL Y HERRAMIENTAS DE TRABAJO.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "La Empleadora hace entrega al Trabajador de los elementos de seguridad y protección personal correspondientes a su función, tales como calzado de seguridad, uniforme reglamentario, chaleco de alta visibilidad o geólogo, y radio de comunicaciones. El Trabajador declara recibirlos a entera satisfacción y se obliga a velar por su adecuado mantenimiento y conservación."
                        })
                    ]
                }),

                new Paragraph({
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "OCTAVO: DOMICILIO Y JURISDICCIÓN.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "Para todos los efectos legales que deriven del presente contrato, las partes fijan su domicilio en la ciudad y comuna de Santiago y se someten a la competencia de sus Tribunales de Justicia."
                        })
                    ]
                }),

                new Paragraph({
                    spacing: { before: 200, after: 100 },
                    children: [
                        new TextRun({
                            text: "NOVENO: EJEMPLARES Y FIRMA.",
                            bold: true
                        })
                    ]
                }),
                new Paragraph({
                    alignment: AlignmentType.JUSTIFIED,
                    children: [
                        new TextRun({
                            text: "El presente contrato se firma en dos ejemplares de idéntico tenor y fecha, quedando uno en poder de la Empleadora y otro en poder del Trabajador, quien declara expresamente haberlo leído íntegramente y recibir en este acto copia fidedigna del mismo."
                        })
                    ]
                }),

                // SALTO DE PÁGINA 3 -> PÁGINA 4 (BLOQUE DE FIRMAS)
                new Paragraph({
                    pageBreakBefore: true,
                    spacing: { before: 400, after: 300 },
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({
                            text: "CONSTANCIA Y FIRMA DE LAS PARTES",
                            bold: true,
                            size: 24
                        })
                    ]
                }),

                new Paragraph({
                    spacing: { after: 600 },
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun({
                            text: "En testimonio de lo acordado, firman las partes en conformidad:",
                            italics: true
                        })
                    ]
                }),

                // TABLA DE FIRMAS
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    borders: {
                        top: { style: BorderStyle.NONE },
                        bottom: { style: BorderStyle.NONE },
                        left: { style: BorderStyle.NONE },
                        right: { style: BorderStyle.NONE },
                        insideHorizontal: { style: BorderStyle.NONE },
                        insideVertical: { style: BorderStyle.NONE },
                    },
                    rows: [
                        new TableRow({
                            children: [
                                new TableCell({
                                    width: { size: 45, type: WidthType.PERCENTAGE },
                                    children: [
                                        new Paragraph({
                                            spacing: { before: 800 },
                                            alignment: AlignmentType.CENTER,
                                            children: [
                                                new TextRun({ text: "____________________________________", bold: true }),
                                            ]
                                        }),
                                        new Paragraph({
                                            alignment: AlignmentType.CENTER,
                                            children: [
                                                new TextRun({ text: "GGSS SECURITY SPA", bold: true }),
                                            ]
                                        }),
                                        new Paragraph({
                                            alignment: AlignmentType.CENTER,
                                            children: [
                                                new TextRun({ text: "R.U.T. 76.999.888-K\nEMPLEADOR", size: 18 })
                                            ]
                                        })
                                    ]
                                }),
                                new TableCell({
                                    width: { size: 10, type: WidthType.PERCENTAGE },
                                    children: [new Paragraph({})]
                                }),
                                new TableCell({
                                    width: { size: 45, type: WidthType.PERCENTAGE },
                                    children: [
                                        new Paragraph({
                                            spacing: { before: 800 },
                                            alignment: AlignmentType.CENTER,
                                            children: [
                                                new TextRun({ text: "____________________________________", bold: true }),
                                            ]
                                        }),
                                        new Paragraph({
                                            alignment: AlignmentType.CENTER,
                                            children: [
                                                new TextRun({ text: "{{trabajador.nombre}}", bold: true }),
                                            ]
                                        }),
                                        new Paragraph({
                                            alignment: AlignmentType.CENTER,
                                            children: [
                                                new TextRun({ text: "R.U.T. {{trabajador.rut}}\nTRABAJADOR", size: 18 })
                                            ]
                                        })
                                    ]
                                }),
                            ]
                        })
                    ]
                })
            ]
        }]
    });

    const targetPath = path.join(__dirname, 'plantilla_sintetica_contrato.docx');
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(targetPath, buffer);
    console.log(`[Lab] Plantilla sintética creada exitosamente en: ${targetPath} (${buffer.length} bytes)`);
    return targetPath;
}

if (require.main === module) {
    createSyntheticContractTemplate().catch(err => {
        console.error('[Lab] Error creando plantilla:', err);
        process.exit(1);
    });
}

module.exports = { createSyntheticContractTemplate };
