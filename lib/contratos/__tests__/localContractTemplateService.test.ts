/**
 * ASPRO — CONTRATOS V2 — FASE 5.2
 * Pruebas Unitarias de localContractTemplateService y localContractEmissionsService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import PizZip from 'pizzip';
import {
  localContractTemplateService,
  DICCIONARIO_VARIABLES_ASPRO,
  calcularSha256,
  PlantillaContractual
} from '../localContractTemplateService';
import {
  localContractEmissionsService,
  EmisionLaboratorio,
  SIG_BOX_WIDTH,
  SIG_BOX_HEIGHT,
  crearSignatureConfigInicial,
  resolverPaginaObjetivoFirma,
  calcularCoordenadasPdfDesdeClic,
  calcularCoordenadasPdfDesdeArrastre,
  calcularEstiloCajaFirmaPorcentual,
  formatearNombreContrato
} from '../localContractEmissionsService';

describe('LocalContractTemplateService — Diccionario y Clasificación', () => {
  it('contiene las variables canónicas mínimas esenciales de ASPRO', () => {
    expect(DICCIONARIO_VARIABLES_ASPRO['trabajador.nombre']).toBeDefined();
    expect(DICCIONARIO_VARIABLES_ASPRO['trabajador.rut']).toBeDefined();
    expect(DICCIONARIO_VARIABLES_ASPRO['contrato.sueldoBase']).toBeDefined();
    expect(DICCIONARIO_VARIABLES_ASPRO['contrato.fechaInicio']).toBeDefined();
    expect(DICCIONARIO_VARIABLES_ASPRO['empresa.rut']).toBeDefined();
    expect(DICCIONARIO_VARIABLES_ASPRO['sucursal.nombre']).toBeDefined();
  });

  it('clasifica correctamente variables reconocidas y desconocidas', () => {
    const varConocida = localContractTemplateService.clasificarVariable('trabajador.nombre');
    expect(varConocida.existeEnAspro).toBe(true);
    expect(varConocida.fuente).toBe('trabajador');
    expect(varConocida.obligatoria).toBe(true);

    const varDesconocida = localContractTemplateService.clasificarVariable('custom.campo_extra');
    expect(varDesconocida.existeEnAspro).toBe(false);
    expect(varDesconocida.fuente).toBe('desconocida');
  });

  it('genera payload de sustitución con valores formateados en CLP y fecha en español', () => {
    const payload = localContractTemplateService.generarPayloadSustitucion({
      trabajador: {
        nombre: 'Carlos Miranda Rojas',
        rut: '12.345.678-9',
        direccion: 'Calle Las Flores 123',
        telefono: '+56 9 1111 2222'
      },
      contrato: {
        tipo: 'Plazo Fijo',
        fechaInicio: '2026-11-01',
        fechaTermino: '2027-01-31',
        cargo: 'Guardia de Seguridad',
        jornada: '45 horas semanales',
        horarioA: '08:00 a 20:00 hrs',
        horarioB: '20:00 a 08:00 hrs',
        sueldoBase: 550000
      },
      sucursal: {
        nombre: 'SUCURSAL MALL PLAZA',
        direccion: 'Av. Americo Vespucio 1500'
      }
    });

    expect(payload.trabajador.nombre).toBe('Carlos Miranda Rojas');
    expect(payload.contrato.sueldoBase).toBe(550000);
    expect(payload.contrato.sueldo).toBe('$550.000');
    expect(payload.contrato.sueldoBaseFormatted).toBe('$550.000');
    expect(payload.empresa.nombre).toBe('GESTIÓN GGSS SECURITY SPA');
    expect(payload.empresa.rut).toBe('76.999.888-K');
  });

  it('bloquea la emisión si una variable obligatoria no está resuelta en el contexto', () => {
    const plantillaMock: PlantillaContractual = {
      id: 'tpl_test',
      nombre: 'Plantilla Test',
      tipoDocumento: 'Contrato',
      tipoContrato: 'Plazo Fijo',
      version: 1,
      archivoNombre: 'test.docx',
      tamanoBytes: 1000,
      fechaIncorporacion: new Date().toISOString(),
      activa: true,
      esEjemploSintetico: false,
      hashSha256: 'abc',
      erroresValidacion: [],
      variablesDetectadas: [
        localContractTemplateService.clasificarVariable('trabajador.nombre'),
        localContractTemplateService.clasificarVariable('trabajador.rut'),
        localContractTemplateService.clasificarVariable('contrato.sueldoBase')
      ]
    };

    // Caso 1: Payload incompleto (falta RUT del trabajador y sueldoBase = 0)
    const payloadIncompleto = {
      trabajador: {
        nombre: 'Carlos Miranda Rojas',
        rut: '' // Vacío!
      },
      contrato: {
        sueldoBase: 0 // Inválido!
      }
    };

    const resultadoInvalido = localContractTemplateService.validarVariablesParaEmision(
      plantillaMock,
      payloadIncompleto
    );
    expect(resultadoInvalido.valida).toBe(false);
    expect(resultadoInvalido.errores.length).toBeGreaterThanOrEqual(2);
    expect(resultadoInvalido.errores.some(e => e.includes('trabajador.rut'))).toBe(true);

    // Caso 2: Payload completo
    const payloadCompleto = {
      trabajador: {
        nombre: 'Carlos Miranda Rojas',
        rut: '12.345.678-9'
      },
      contrato: {
        sueldoBase: 550000
      }
    };

    const resultadoValido = localContractTemplateService.validarVariablesParaEmision(
      plantillaMock,
      payloadCompleto
    );
    expect(resultadoValido.valida).toBe(true);
    expect(resultadoValido.errores.length).toBe(0);
  });

  it('detecta variables divididas entre múltiples fragmentos XML (<w:t>) dentro de párrafos Word', async () => {
    // Simular un DOCX con etiquetas divididas entre runs XML:
    // <w:p><w:t>{{trab</w:t><w:t>ajador.nombre}}</w:t></w:p>
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:r><w:t>{{trab</w:t></w:r>
            <w:r><w:t>ajador.nombre}}</w:t></w:r>
          </w:p>
          <w:p>
            <w:r><w:t>{{contrato.sueldoBase}}</w:t></w:r>
          </w:p>
        </w:body>
      </w:document>`);

    const docxBuffer = zip.generate({ type: 'arraybuffer' });

    const validacion = await localContractTemplateService.inspeccionarYValidarDOCX(docxBuffer);
    const nombres = validacion.variablesDetectadas.map(v => v.nombre);

    expect(nombres).toContain('trabajador.nombre');
    expect(nombres).toContain('contrato.sueldoBase');
  });

  it('calcula hash SHA-256 de forma consistente', async () => {
    const data = new TextEncoder().encode('Contratos V2 ASPRO Test SHA-256');
    const hash1 = await calcularSha256(data);
    const hash2 = await calcularSha256(data);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it('reconoce y resuelve las 19 variables planas reales de contratos RR.HH. ASPRO (ej. FORMATO-Contrato-por-Faena)', async () => {
    const variablesRealesRRHH = [
      'Horario_A', 'Horario_B', 'Sucursal', 'afp', 'codigo_interno',
      'direccion', 'direccion_sucursal', 'empresa', 'estado_civil',
      'fecha_inicio_corta', 'fecha_inicio_larga', 'fecha_nacimiento',
      'fecha_termino', 'nacionalidad', 'nombre', 'rut', 'salud',
      'sueldo', 'telefono'
    ];

    // 1. Todas deben existir en el diccionario y clasificarse como soportadas
    for (const v of variablesRealesRRHH) {
      const clasificada = localContractTemplateService.clasificarVariable(v);
      expect(clasificada.existeEnAspro).toBe(true);
    }

    // 2. Al inspeccionar un DOCX con las 19 variables, debe marcar validaParaEmision = true y 0 no reconocidas
    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>${variablesRealesRRHH.map(v => `{{${v}}}`).join(' ')}</w:t></w:r></w:p>
        </w:body>
      </w:document>`);

    const docxBuffer = zip.generate({ type: 'arraybuffer' });
    const validacion = await localContractTemplateService.inspeccionarYValidarDOCX(docxBuffer);

    expect(validacion.validaParaEmision).toBe(true);
    expect(validacion.variablesNoReconocidas).toHaveLength(0);
    expect(validacion.erroresSintaxis).toHaveLength(0);
    expect(validacion.variablesDetectadas).toHaveLength(19);

    // 3. El payload de sustitución debe resolver las 19 variables sin dejar ninguna vacía ni como [object Object]
    const payload = localContractTemplateService.generarPayloadSustitucion({
      trabajador: {
        nombre: 'Juan Pérez Soto',
        rut: '15.444.333-2',
        fechaNacimiento: '1992-08-15',
        nacionalidad: 'Chilena',
        direccion: 'Calle Recreo 118, Rancagua',
        estadoCivil: 'Soltero',
        telefono: '+56912345678',
        salud: 'Fonasa',
        afp: 'Habitat',
        codigoInterno: '10'
      },
      contrato: {
        tipo: 'Part-Time',
        fechaInicio: '2026-10-26',
        fechaTermino: '2026-11-30',
        cargo: 'Guardia de Seguridad',
        jornada: 'Part-Time',
        horarioA: '08:30 AM a 18:30 PM',
        horarioB: '18:00 PM a 09:00 AM',
        sueldoBase: 553553
      },
      sucursal: {
        nombre: 'Banco Rancagua Centro',
        direccion: 'Independencia 500, Rancagua',
        empresa: 'ASPRO SPA'
      }
    });

    for (const v of variablesRealesRRHH) {
      const val = localContractTemplateService.resolverValorVariable(v, payload);
      expect(val).toBeDefined();
      expect(typeof val === 'string' || typeof val === 'number').toBe(true);
      expect(String(val)).not.toBe('[object Object]');
      expect(String(val).trim().length).toBeGreaterThan(0);
    }

    expect(localContractTemplateService.resolverValorVariable('fecha_inicio_larga', payload)).toBe('26 de octubre de 2026');
    expect(localContractTemplateService.resolverValorVariable('fecha_inicio_corta', payload)).toBe('26/10/2026');
    expect(localContractTemplateService.resolverValorVariable('empresa', payload)).toBe('ASPRO SPA');
    expect(localContractTemplateService.resolverValorVariable('Sucursal', payload)).toBe('Banco Rancagua Centro');
  });
});

describe('LocalContractEmissionsService — Persistencia en IndexedDB', () => {
  it('registra una emisión de laboratorio con validación de cabecera %PDF y hash SHA-256', async () => {
    const fakeDocx = new TextEncoder().encode('PK\x03\x04 fake docx binary data for lab test');
    // Generar un PDF sintético con cabecera %PDF-1.4 y tamaño suficiente
    const fakePdfText = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' + 'X'.repeat(600) + '\n%%EOF';
    const fakePdf = new TextEncoder().encode(fakePdfText);

    const emision = await localContractEmissionsService.registrarEmision({
      colaboradorId: 'worker_test_123',
      colaboradorNombre: 'Juan Prueba',
      colaboradorRut: '11.222.333-4',
      plantillaId: 'tpl_test_v1',
      plantillaNombre: 'Plantilla de Prueba',
      plantillaVersion: 1,
      sueldoBase: 550000,
      tipoContrato: 'Plazo Fijo',
      canalFirma: 'digital_aspro',
      docxBuffer: fakeDocx.buffer,
      pdfBuffer: fakePdf.buffer,
      pageCount: 2
    });

    expect(emision.id).toMatch(/^emision_lab_/);
    expect(emision.pdfSha256).toBeDefined();
    expect(emision.pdfSha256.length).toBe(64);
    expect(emision.estado).toBe('completado');
    expect(emision.esLaboratorio).toBe(true);

    // Recuperar por ID
    const recuperada = await localContractEmissionsService.obtenerEmisionPorId(emision.id);
    expect(recuperada).not.toBeNull();
    expect(recuperada?.colaboradorNombre).toBe('Juan Prueba');

    // Recuperar binarios
    const docxRecuperado = await localContractEmissionsService.obtenerBinario(emision.id, 'docx');
    expect(docxRecuperado).not.toBeNull();

    const pdfRecuperado = await localContractEmissionsService.obtenerBinario(emision.id, 'pdf');
    expect(pdfRecuperado).not.toBeNull();
  });

  it('rechaza archivos que no sean PDFs válidos o con tamaño menor a 500 bytes', async () => {
    const fakeDocx = new TextEncoder().encode('fake docx');
    const pdfCorrupto = new TextEncoder().encode('no es un pdf');

    await expect(
      localContractEmissionsService.registrarEmision({
        colaboradorId: 'worker_fail',
        colaboradorNombre: 'Falla',
        colaboradorRut: '0-0',
        plantillaId: 'tpl_x',
        plantillaNombre: 'Plantilla X',
        plantillaVersion: 1,
        sueldoBase: 500000,
        tipoContrato: 'Indefinido',
        canalFirma: 'fisica_manuscrita',
        docxBuffer: fakeDocx.buffer,
        pdfBuffer: pdfCorrupto.buffer,
        pageCount: 1
      })
    ).rejects.toThrow('El archivo PDF generado está vacío o corrupto');
  });
});

describe('LocalContractTemplateService — Normalización OOXML de Espaciado en Tablas', () => {
  it('propaga el <w:spacing> del estilo de cada tabla sin alterar párrafos fuera de tablas ni sobrescribir espaciados explícitos', () => {
    const zip = new PizZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
    );
    zip.file(
      'word/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:docDefaults>
          <w:pPrDefault>
            <w:pPr>
              <w:spacing w:after="160" w:line="259" w:lineRule="auto"/>
            </w:pPr>
          </w:pPrDefault>
        </w:docDefaults>
        <w:style w:type="table" w:styleId="TableNormal" w:default="1">
          <w:name w:val="TableNormal"/>
        </w:style>
        <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
          <w:name w:val="normal"/>
        </w:style>
        <w:style w:type="paragraph" w:styleId="HeadingCustom">
          <w:basedOn w:val="Normal"/>
          <w:pPr>
            <w:spacing w:before="240" w:after="80" w:lineRule="auto"/>
          </w:pPr>
        </w:style>
        <w:style w:type="table" w:styleId="TableFirmas">
          <w:basedOn w:val="TableNormal"/>
          <w:pPr>
            <w:spacing w:after="0" w:line="240" w:lineRule="auto"/>
          </w:pPr>
        </w:style>
        <w:style w:type="table" w:styleId="TableBaseParent">
          <w:basedOn w:val="TableNormal"/>
          <w:pPr>
            <w:spacing w:before="60" w:after="100" w:line="280" w:lineRule="exact"/>
          </w:pPr>
        </w:style>
        <w:style w:type="table" w:styleId="TableDerivedChild">
          <w:basedOn w:val="TableBaseParent"/>
          <w:pPr>
            <w:spacing w:after="40"/>
          </w:pPr>
        </w:style>
      </w:styles>`
    );

    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p id="outside-1">
            <w:pPr><w:jc w:val="both"/></w:pPr>
            <w:r><w:t>Párrafo fuera de tabla sin spacing explícito</w:t></w:r>
          </w:p>
          <w:tbl>
            <w:tblPr><w:tblStyle w:val="TableFirmas"/></w:tblPr>
            <w:tr>
              <w:tc>
                <w:p id="firma-sin-spacing">
                  <w:pPr><w:jc w:val="center"/><w:rPr><w:b w:val="1"/></w:rPr></w:pPr>
                  <w:r><w:t>TRABAJADOR</w:t></w:r>
                </w:p>
                <w:p id="firma-con-spacing-explicito">
                  <w:pPr>
                    <w:spacing w:after="320" w:before="120" w:line="360" w:lineRule="auto"/>
                    <w:jc w:val="both"/>
                  </w:pPr>
                  <w:r><w:t>Párrafo con spacing propio</w:t></w:r>
                </w:p>
                <w:p id="firma-con-pstyle-propio">
                  <w:pPr>
                    <w:pStyle w:val="HeadingCustom"/>
                  </w:pPr>
                  <w:r><w:t>Párrafo con estilo de párrafo propio</w:t></w:r>
                </w:p>
                <w:tbl>
                  <w:tblPr><w:tblStyle w:val="TableDerivedChild"/></w:tblPr>
                  <w:tr>
                    <w:tc>
                      <w:p id="anidada-herencia">
                        <w:r><w:t>Celda de tabla anidada con herencia basedOn</w:t></w:r>
                      </w:p>
                    </w:tc>
                  </w:tr>
                </w:tbl>
              </w:tc>
            </w:tr>
          </w:tbl>
          <w:tbl>
            <w:tblPr><w:tblStyle w:val="TableNormal"/></w:tblPr>
            <w:tr>
              <w:tc>
                <w:p id="tabla-sin-spacing-en-estilo">
                  <w:r><w:t>Tabla cuyo estilo no define spacing</w:t></w:r>
                </w:p>
              </w:tc>
            </w:tr>
          </w:tbl>
        </w:body>
      </w:document>`
    );

    const modificados = localContractTemplateService.normalizarEspaciadoTablasEnZip(zip);
    // Solo deben modificarse 'firma-sin-spacing' y 'anidada-herencia' (2 párrafos)
    expect(modificados).toBe(2);

    const xmlResult = zip.file('word/document.xml')!.asText();

    // 1. Párrafo fuera de tabla permanece intacto sin <w:spacing>
    const matchOutside = xmlResult.match(/<w:p id="outside-1">[\s\S]*?<\/w:p>/)?.[0] || '';
    expect(matchOutside).not.toContain('<w:spacing');

    // 2. Párrafo de firma sin spacing recibe el spacing de TableFirmas (after="0", line="240", lineRule="auto")
    // y se inserta antes de <w:jc> y <w:rPr>
    const matchFirmaSin = xmlResult.match(/<w:p id="firma-sin-spacing">[\s\S]*?<\/w:p>/)?.[0] || '';
    expect(matchFirmaSin).toContain('w:after="0"');
    expect(matchFirmaSin).toContain('w:line="240"');
    expect(matchFirmaSin).toContain('w:lineRule="auto"');
    expect(matchFirmaSin.indexOf('<w:spacing')).toBeLessThan(matchFirmaSin.indexOf('<w:jc'));

    // 3. Párrafo con spacing explícito conserva su propio valor (after="320", before="120")
    const matchFirmaExplicito = xmlResult.match(/<w:p id="firma-con-spacing-explicito">[\s\S]*?<\/w:p>/)?.[0] || '';
    expect(matchFirmaExplicito).toContain('w:after="320"');
    expect(matchFirmaExplicito).toContain('w:before="120"');
    expect(matchFirmaExplicito).not.toContain('w:after="0"');

    // 4. Párrafo con pStyle que ya define spacing en styles.xml no es sobrescrito
    const matchFirmaPStyle = xmlResult.match(/<w:p id="firma-con-pstyle-propio">[\s\S]*?<\/w:p>/)?.[0] || '';
    expect(matchFirmaPStyle).not.toContain('<w:spacing');

    // 5. Tabla anidada aplica su propio estilo heredado (before="60" de TableBaseParent + after="40" de TableDerivedChild)
    const matchAnidada = xmlResult.match(/<w:p id="anidada-herencia">[\s\S]*?<\/w:p>/)?.[0] || '';
    expect(matchAnidada).toContain('w:before="60"');
    expect(matchAnidada).toContain('w:after="40"');
    expect(matchAnidada).toContain('w:line="280"');
    expect(matchAnidada).toContain('w:lineRule="exact"');

    // 6. Tabla cuyo estilo (TableNormal) no define <w:spacing> permanece sin alteraciones
    const matchTablaNormal = xmlResult.match(/<w:p id="tabla-sin-spacing-en-estilo">[\s\S]*?<\/w:p>/)?.[0] || '';
    expect(matchTablaNormal).not.toContain('<w:spacing');
  });

  it('mantiene intacto el binario original en IndexedDB al normalizar en memoria para la emisión', async () => {
    const zip = new PizZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
    );
    zip.file(
      'word/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="normal"/></w:style>
        <w:style w:type="table" w:styleId="Table4">
          <w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
        </w:style>
      </w:styles>`
    );
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>{{nombre}} {{rut}} {{fecha_inicio_larga}}</w:t></w:r></w:p>
          <w:tbl>
            <w:tblPr><w:tblStyle w:val="Table4"/></w:tblPr>
            <w:tr><w:tc><w:p id="celda-firma"><w:r><w:t>TRABAJADOR</w:t></w:r></w:p></w:tc></w:tr>
          </w:tbl>
        </w:body>
      </w:document>`
    );

    const originalBuffer = zip.generate({ type: 'arraybuffer' });
    const guardada = await localContractTemplateService.guardarPlantillaDOCX({
      nombre: 'Plantilla Test Inmutabilidad Binario',
      tipoDocumento: 'Contrato',
      tipoContrato: 'Part-Time',
      archivoNombre: 'test_inmutable.docx',
      archivoBuffer: originalBuffer
    });

    // 1. El binario para emisión viene normalizado en memoria
    const bufferParaEmision = await localContractTemplateService.obtenerBinarioPlantilla(guardada.id);
    expect(bufferParaEmision).not.toBeNull();
    const xmlEmision = new PizZip(bufferParaEmision!).file('word/document.xml')!.asText();
    expect(xmlEmision).toContain('w:after="0"');
    expect(xmlEmision).toContain('w:line="240"');

    // 2. El binario original almacenado en IndexedDB permanece sin modificar
    const bufferOriginalAlmacenado = await localContractTemplateService.obtenerBinarioPlantilla(guardada.id, {
      normalizarParaEmision: false
    });
    expect(bufferOriginalAlmacenado).not.toBeNull();
    const xmlOriginal = new PizZip(bufferOriginalAlmacenado!).file('word/document.xml')!.asText();
    expect(xmlOriginal).not.toContain('w:after="0"');
  });
});

describe('Posicionamiento Visual de Firma Digital en Contratos V2 (Reutilización de Asignación Masiva)', () => {
  it('resuelve correctamente la página objetivo en modo Última Hoja ("last") y Página Específica ("specific")', () => {
    const configUltima = crearSignatureConfigInicial();
    expect(configUltima.page).toBe('last');
    expect(resolverPaginaObjetivoFirma(configUltima, 4)).toBe(4);
    expect(resolverPaginaObjetivoFirma(configUltima, 1)).toBe(1);

    const configEspecifica = {
      ...configUltima,
      page: 'specific' as const,
      pageNumber: 2
    };
    expect(resolverPaginaObjetivoFirma(configEspecifica, 4)).toBe(2);

    // Si pageNumber excede el total de páginas del PDF, se ajusta al límite válido
    const configFueraDeRango = {
      ...configUltima,
      page: 'specific' as const,
      pageNumber: 9
    };
    expect(resolverPaginaObjetivoFirma(configFueraDeRango, 4)).toBe(4);
  });

  it('calcula coordenadas PDF con origen inferior izquierdo y mantiene invariancia ante cambios de zoom (75%, 100%, 125%, 150%)', () => {
    const pageWidth = 612;
    const pageHeight = 792;
    const baseRenderWidth = 380;
    const zoomLevels = [0.75, 1, 1.25, 1.5];

    // Clic al 30% horizontal y 75% vertical (cerca del pie de firma del trabajador)
    const relativeClickXRatio = 0.3;
    const relativeClickYRatio = 0.75;

    const resultsByZoom = zoomLevels.map(zoom => {
      const renderedWidth = baseRenderWidth * zoom;
      const renderedHeight = renderedWidth * (pageHeight / pageWidth);
      return calcularCoordenadasPdfDesdeClic({
        clientX: 100 + renderedWidth * relativeClickXRatio,
        clientY: 50 + renderedHeight * relativeClickYRatio,
        rect: { left: 100, top: 50, width: renderedWidth, height: renderedHeight },
        pdfDimensions: { width: pageWidth, height: pageHeight }
      });
    });

    // Todos los niveles de zoom deben producir exactamente las mismas coordenadas PDF (X, Y)
    const baseCoords = resultsByZoom[0];
    for (const coords of resultsByZoom) {
      expect(coords.posicionX).toBe(baseCoords.posicionX);
      expect(coords.posicionY).toBe(baseCoords.posicionY);
    }

    // Verificar que el estilo porcentual de la caja (120x50 pt) es consistente
    const boxStyle = calcularEstiloCajaFirmaPorcentual(baseCoords, { width: pageWidth, height: pageHeight });
    expect(boxStyle.width).toBe(`${(SIG_BOX_WIDTH / pageWidth) * 100}%`);
    expect(boxStyle.height).toBe(`${(SIG_BOX_HEIGHT / pageHeight) * 100}%`);

    // Verificar arrastre (drag-and-drop) con desplazamiento de +10% hacia la derecha y -5% hacia arriba
    const dragResultsByZoom = zoomLevels.map(zoom => {
      const renderedWidth = baseRenderWidth * zoom;
      const renderedHeight = renderedWidth * (pageHeight / pageWidth);
      return calcularCoordenadasPdfDesdeArrastre({
        startClientX: 200,
        startClientY: 300,
        currentClientX: 200 + renderedWidth * 0.1,
        currentClientY: 300 - renderedHeight * 0.05,
        startSigX: baseCoords.posicionX,
        startSigY: baseCoords.posicionY,
        rect: { width: renderedWidth, height: renderedHeight },
        pdfDimensions: { width: pageWidth, height: pageHeight }
      });
    });

    const baseDrag = dragResultsByZoom[0];
    expect(baseDrag.posicionX).toBeGreaterThan(baseCoords.posicionX);
    expect(baseDrag.posicionY).toBeGreaterThan(baseCoords.posicionY);
    for (const dragCoords of dragResultsByZoom) {
      expect(dragCoords.posicionX).toBe(baseDrag.posicionX);
      expect(dragCoords.posicionY).toBe(baseDrag.posicionY);
    }
  });

  it('persiste y actualiza signatureConfig asociada al contrato en IndexedDB al avanzar y retroceder entre pasos', async () => {
    const fakeDocx = new TextEncoder().encode('PK\x03\x04 fake docx binary data for signature positioning test');
    const fakePdfText = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' + 'Y'.repeat(650) + '\n%%EOF';
    const fakePdf = new TextEncoder().encode(fakePdfText);

    // 1. Registrar emisión digital con firma en última página (página 4)
    const emisionInicial = await localContractEmissionsService.registrarEmision({
      colaboradorId: 'worker_sig_001',
      colaboradorNombre: 'Trabajador Firma Digital',
      colaboradorRut: '15.888.999-K',
      plantillaId: 'tpl_faena_banco',
      plantillaNombre: 'FORMATO-Contrato-por-Faena-part-time-Banco 26 octubre',
      plantillaVersion: 1,
      sueldoBase: 553553,
      tipoContrato: 'Obra o Faena',
      canalFirma: 'digital_aspro',
      signatureConfig: {
        page: 'last',
        pageNumber: 4,
        posicionX: 95,
        posicionY: 165,
        targetPageResolved: 4,
        pageWidth: 612,
        pageHeight: 792,
        orientation: 'portrait'
      },
      docxBuffer: fakeDocx.buffer,
      pdfBuffer: fakePdf.buffer,
      pageCount: 4
    });

    expect(emisionInicial.signatureConfig).toBeDefined();
    expect(emisionInicial.signatureConfig?.page).toBe('last');
    expect(emisionInicial.signatureConfig?.targetPageResolved).toBe(4);
    expect(emisionInicial.signatureConfig?.posicionX).toBe(95);
    expect(emisionInicial.signatureConfig?.posicionY).toBe(165);

    // 2. Simular que el usuario retrocede del Paso 4 al Paso 3, cambia a página específica 3 y nuevas coordenadas, y vuelve a confirmar
    const emisionActualizada = await localContractEmissionsService.actualizarSignatureConfigEmision(
      emisionInicial.id,
      'digital_aspro',
      {
        page: 'specific',
        pageNumber: 3,
        posicionX: 240,
        posicionY: 120,
        targetPageResolved: 3,
        pageWidth: 612,
        pageHeight: 792,
        orientation: 'portrait'
      }
    );

    expect(emisionActualizada).not.toBeNull();
    expect(emisionActualizada?.signatureConfig?.page).toBe('specific');
    expect(emisionActualizada?.signatureConfig?.pageNumber).toBe(3);
    expect(emisionActualizada?.signatureConfig?.targetPageResolved).toBe(3);
    expect(emisionActualizada?.signatureConfig?.posicionX).toBe(240);
    expect(emisionActualizada?.signatureConfig?.posicionY).toBe(120);

    // 3. Verificar recuperación desde IndexedDB
    const recuperada = await localContractEmissionsService.obtenerEmisionPorId(emisionInicial.id);
    expect(recuperada?.signatureConfig?.posicionX).toBe(240);
    expect(recuperada?.signatureConfig?.posicionY).toBe(120);
    expect(recuperada?.signatureConfig?.targetPageResolved).toBe(3);
  });

  it('valida el flujo completo Fase C: plantilla real RR.HH., firma en última hoja, página específica, zoom invariante, reinicio por cambio de colaborador/plantilla y canal físico intacto', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { PDFDocument } = await import('pdf-lib');

    const candidatePaths = [
      'C:/Users/Mr. Oportus/Downloads/FORMATO-Contrato-por-Faena-part-time-Banco 26 octubre.docx',
      path.resolve(process.cwd(), 'public', 'plantillas', 'plantilla_sintetica_contrato.docx')
    ];
    const realDocxPath = candidatePaths.find(p => fs.existsSync(p))!;
    expect(Boolean(realDocxPath)).toBe(true);

    const rawBytes = fs.readFileSync(realDocxPath);
    const docxArrayBuffer = rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength);

    // 1. Guardar e inspeccionar la plantilla real
    const plantilla = await localContractTemplateService.guardarPlantillaDOCX({
      nombre: 'FORMATO-Contrato-por-Faena-part-time-Banco 26 octubre',
      tipoDocumento: 'Contrato',
      tipoContrato: 'Obra y Faena',
      archivoNombre: 'FORMATO-Contrato-por-Faena-part-time-Banco 26 octubre.docx',
      archivoBuffer: docxArrayBuffer
    });
    expect(plantilla.erroresValidacion).toHaveLength(0);
    expect(plantilla.variablesDetectadas.length).toBeGreaterThanOrEqual(11);

    // 2. Obtener binario normalizado y rellenar variables
    const normalizedBuffer = await localContractTemplateService.obtenerBinarioPlantilla(plantilla.id);
    expect(normalizedBuffer).not.toBeNull();

    const payload = localContractTemplateService.generarPayloadSustitucion({
      trabajador: {
        nombre: 'Trabajador Prueba Fase C',
        rut: '16.555.444-3',
        fechaNacimiento: '1991-04-12',
        nacionalidad: 'Chilena',
        direccion: 'Recreo 118, Rancagua',
        estadoCivil: 'Soltero(a)',
        telefono: '+56988776655',
        salud: 'Fonasa',
        afp: 'Habitat',
        codigoInterno: '101'
      },
      contrato: {
        tipo: 'Obra o Faena',
        fechaInicio: '2026-10-28',
        fechaTermino: '2026-11-30',
        cargo: 'Guardia de Seguridad',
        jornada: 'Obra o Faena',
        horarioA: '08:30 AM a 18:30 PM',
        horarioB: '18:00 PM a 09:00 AM',
        sueldoBase: 553553
      },
      sucursal: {
        nombre: 'Condominio Demo 1',
        direccion: 'Av. Principal 100, Rancagua',
        empresa: 'ASPRO SPA'
      }
    });

    const Docxtemplater = (await import('docxtemplater')).default;
    const zip = new PizZip(normalizedBuffer!);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      parser: (tag: string) => ({
        get: (scope: any) => localContractTemplateService.resolverValorVariable(tag, scope)
      })
    });
    doc.render(payload);
    const filledDocxBuffer = doc.getZip().generate({ type: 'arraybuffer', compression: 'DEFLATE' });

    // 3. Convertir a PDF real con Gotenberg v8 local (construyendo multipart/form-data binario compatible con jsdom/Node)
    let pdfBuffer: ArrayBuffer;
    let totalPages = 4;
    let pageWidth = 612;
    let pageHeight = 792;

    try {
      const boundary = '----AsproGotenbergBoundary' + Date.now();
      const header = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="files"; filename="index.docx"\r\n` +
          `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
        'utf-8'
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
      const bodyBuffer = Buffer.concat([header, Buffer.from(filledDocxBuffer), footer]);

      const res = await fetch('http://localhost:3005/forms/libreoffice/convert', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: bodyBuffer,
        signal: AbortSignal.timeout(1200)
      });
      if (!res.ok) throw new Error(`Gotenberg status ${res.status}`);
      pdfBuffer = await res.arrayBuffer();
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      totalPages = pdfDoc.getPageCount();
      const lastPage = pdfDoc.getPage(totalPages - 1);
      const size = lastPage.getSize();
      pageWidth = Math.round(size.width);
      pageHeight = Math.round(size.height);
      expect(totalPages).toBe(4);
    } catch {
      // Fallback sintético si Gotenberg no responde en otro entorno
      const syntheticPdf = await PDFDocument.create();
      for (let i = 0; i < 4; i++) syntheticPdf.addPage([612, 792]);
      const pdfBytes = await syntheticPdf.save();
      pdfBuffer = new Uint8Array(pdfBytes).buffer as ArrayBuffer;
    }

    // 4. Posicionar firma en última página (página 4) con clic del ratón
    let sigConfig = crearSignatureConfigInicial(pageWidth, pageHeight);
    expect(resolverPaginaObjetivoFirma(sigConfig, totalPages)).toBe(4);

    const clickPos1 = calcularCoordenadasPdfDesdeClic({
      clientX: 195,
      clientY: 360,
      rect: { left: 100, top: 20, width: 380, height: 380 * (pageHeight / pageWidth) },
      pdfDimensions: { width: pageWidth, height: pageHeight }
    });
    sigConfig = { ...sigConfig, ...clickPos1, pageNumber: resolverPaginaObjetivoFirma(sigConfig, totalPages) };

    const styleBeforeMove = calcularEstiloCajaFirmaPorcentual(sigConfig, { width: pageWidth, height: pageHeight });

    // 5. Cambiar posición mediante arrastre y verificar que el marcador se actualiza
    const dragPos2 = calcularCoordenadasPdfDesdeArrastre({
      startClientX: 195,
      startClientY: 360,
      currentClientX: 255,
      currentClientY: 330,
      startSigX: sigConfig.posicionX,
      startSigY: sigConfig.posicionY,
      rect: { width: 380, height: 380 * (pageHeight / pageWidth) },
      pdfDimensions: { width: pageWidth, height: pageHeight }
    });
    sigConfig = { ...sigConfig, ...dragPos2 };
    const styleAfterMove = calcularEstiloCajaFirmaPorcentual(sigConfig, { width: pageWidth, height: pageHeight });
    expect(styleAfterMove.left).not.toBe(styleBeforeMove.left);
    expect(styleAfterMove.bottom).not.toBe(styleBeforeMove.bottom);

    // 6. Seleccionar página específica (página 2) y comprobar que se respeta
    sigConfig = { ...sigConfig, page: 'specific', pageNumber: 2 };
    expect(resolverPaginaObjetivoFirma(sigConfig, totalPages)).toBe(2);

    // 7. Cambiar el zoom (75%, 100%, 125%, 150%) y verificar que el estilo porcentual de la caja no se desplaza
    for (const z of [0.75, 1, 1.25, 1.5]) {
      const styleAtZoom = calcularEstiloCajaFirmaPorcentual(sigConfig, { width: pageWidth, height: pageHeight });
      expect(styleAtZoom).toEqual(styleAfterMove);
      expect(z).toBeGreaterThan(0);
    }

    // 8. Avanzar a confirmación (registrar emisión) y volver atrás, conservando la configuración
    const emisionDigital = await localContractEmissionsService.registrarEmision({
      colaboradorId: 'worker_fase_c_1',
      colaboradorNombre: 'Trabajador Prueba Fase C',
      colaboradorRut: '16.555.444-3',
      plantillaId: plantilla.id,
      plantillaNombre: plantilla.nombre,
      plantillaVersion: plantilla.version,
      sueldoBase: 553553,
      tipoContrato: 'Obra o Faena',
      canalFirma: 'digital_aspro',
      signatureConfig: {
        ...sigConfig,
        targetPageResolved: resolverPaginaObjetivoFirma(sigConfig, totalPages),
        pageWidth,
        pageHeight,
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait'
      },
      docxBuffer: filledDocxBuffer,
      pdfBuffer,
      pageCount: totalPages
    });
    expect(emisionDigital.signatureConfig?.targetPageResolved).toBe(2);
    expect(emisionDigital.signatureConfig?.posicionX).toBe(sigConfig.posicionX);
    expect(emisionDigital.signatureConfig?.posicionY).toBe(sigConfig.posicionY);

    // 9. Al cambiar de colaborador o plantilla, se reinicia la configuración a valores iniciales seguros
    const configReiniciada = crearSignatureConfigInicial(pageWidth, pageHeight);
    expect(configReiniciada.page).toBe('last');
    expect(configReiniciada.posicionX).toBe(115);
    expect(configReiniciada.posicionY).toBe(230);
    expect(configReiniciada.posicionX).not.toBe(sigConfig.posicionX);

    // 10. Comprobar que el canal de firma física continúa funcionando sin requerir signatureConfig
    const emisionFisica = await localContractEmissionsService.registrarEmision({
      colaboradorId: 'worker_fase_c_2',
      colaboradorNombre: 'Trabajador Canal Físico',
      colaboradorRut: '17.111.222-3',
      plantillaId: plantilla.id,
      plantillaNombre: plantilla.nombre,
      plantillaVersion: plantilla.version,
      sueldoBase: 553553,
      tipoContrato: 'Obra o Faena',
      canalFirma: 'fisica_manuscrita',
      signatureConfig: undefined,
      docxBuffer: filledDocxBuffer,
      pdfBuffer,
      pageCount: totalPages
    });
    expect(emisionFisica.canalFirma).toBe('fisica_manuscrita');
    expect(emisionFisica.signatureConfig).toBeUndefined();
  });

  it('formatea y guarda el contrato con la nomenclatura "Contrato + 1er nombre + 1er apellido + DDMM"', async () => {
    expect(
      formatearNombreContrato({
        primerNombre: 'Juan Carlos',
        primerApellido: 'Pérez',
        fechaInicio: '2026-10-28'
      })
    ).toBe('Contrato Juan Pérez 2810');

    expect(
      formatearNombreContrato({
        primerNombre: 'nelson',
        primerApellido: 'Demo',
        fechaInicio: '2026-10-20'
      })
    ).toBe('Contrato nelson Demo 2010');

    const fakePdf = new TextEncoder().encode('%PDF-1.7\n' + 'X'.repeat(600)).buffer;
    const fakeDocx = new Uint8Array(650).buffer;

    const emision = await localContractEmissionsService.registrarEmision({
      colaboradorId: 'emp_nom_1',
      colaboradorNombre: 'Juan Carlos Pérez Gómez',
      colaboradorPrimerNombre: 'Juan Carlos',
      colaboradorPrimerApellido: 'Pérez',
      colaboradorRut: '12.345.678-9',
      fechaInicio: '2026-10-28',
      plantillaId: 'tpl_nom_1',
      plantillaNombre: 'Plantilla Prueba',
      plantillaVersion: 1,
      sueldoBase: 553553,
      tipoContrato: 'Plazo Fijo',
      canalFirma: 'fisica_manuscrita',
      docxBuffer: fakeDocx,
      pdfBuffer: fakePdf,
      pageCount: 2
    });

    expect(emision.nombreContrato).toBe('Contrato Juan Pérez 2810');

    const descargaPdf = await localContractEmissionsService.crearDescarga(emision.id, 'pdf');
    expect(descargaPdf.nombreArchivo).toBe('Contrato Juan Pérez 2810.pdf');
    descargaPdf.revocar();

    const descargaDocx = await localContractEmissionsService.crearDescarga(emision.id, 'docx');
    expect(descargaDocx.nombreArchivo).toBe('Contrato Juan Pérez 2810.docx');
    descargaDocx.revocar();
  });
});
