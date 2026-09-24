/**
 * TemplatePDFGenerator.ts
 * Genera un PDF desde una DocumentTemplate + datos del trabajador.
 * Usa pdf-lib (ya instalado). Sube a Firebase Storage y retorna la URL.
 * El URL se pasa a addDigitalDocument() del flujo existente. ─── INTOCABLE
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { DocumentTemplate, TemplateBloque, Employee, Site } from '../../types';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../lib/firebase';

export interface WorkerDataForPDF {
    employee: Employee;
    site?: Site;
    manualFields?: Record<string, string>;
    generatedAt?: string;
}

// ─── Resolución de variables {{campo}} ────────────────────────────────────────
export function resolveField(key: string, data: WorkerDataForPDF): string {
    const { employee, site, manualFields } = data;
    const fecha = new Date(data.generatedAt || Date.now()).toLocaleDateString('es-CL', {
        year: 'numeric', month: 'long', day: 'numeric',
    });

    const map: Record<string, string> = {
        'trabajador.nombre': `${employee.firstName || ''} ${employee.lastNamePaterno || ''}`.trim(),
        'trabajador.rut': employee.rut || '',
        'trabajador.cargo': employee.cargo || '',
        'trabajador.email': employee.email || '',
        'trabajador.sucursal': site?.name || '',
        'trabajador.empresa': (site as any)?.empresa || '',
        'trabajador.talleCalzado': (employee as any).talleCalzado || '',
        'trabajador.tallePantalon': (employee as any).tallePantalon || '',
        'trabajador.talleCamisa': (employee as any).talleCamisa || '',
        'trabajador.talleChaqueta': (employee as any).talleChaqueta || '',
        'trabajador.tallePolar': (employee as any).tallePolar || '',
        'trabajador.talleGeologo': (employee as any).talleGeologo || '',
        'documento.fecha': fecha,
    };

    return map[key] ?? (manualFields?.[key] || '');
}

// ─── Función principal de generación ─────────────────────────────────────────
export async function generateTemplatePDF(
    template: DocumentTemplate,
    workerData: WorkerDataForPDF
): Promise<{ pdfBytes: Uint8Array; blob: Blob; pageCount: number; signatureBounds?: { pageIndex: number; x: number; y: number; width: number; height: number; } }> {
    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // Tamaño A4 en puntos (1pt = 1/72 pulgada)
    const PAGE_W = 612; // Carta
    const PAGE_H = 792; // Carta
    const MARGIN = 72;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - 60; // cursor Y desde arriba (pdf-lib: y=0 abajo)

    const newPage = () => {
        currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - 60;
        return currentPage;
    };

    const ensureSpace = (needed: number) => {
        if (y - needed < 60) newPage();
    };

    const resolveText = (contenido: string) => {
        return contenido.replace(/\{\{([\w.]+)\}\}/g, (_, key) => resolveField(key, workerData));
    };

    let sigBounds: { pageIndex: number; x: number; y: number; width: number; height: number; } | undefined;

    for (const bloque of template.bloques.sort((a, b) => a.orden - b.orden)) {
        const font: PDFFont = bloque.negrita ? fontBold : (bloque.cursiva ? fontItalic : fontRegular);
        const color = rgb(0.1, 0.1, 0.1);

        switch (bloque.tipo) {
            case 'encabezado_iso': {
                ensureSpace(80);
                const tableH = 60;
                const topY = y;
                
                // Draw main outer border
                currentPage.drawRectangle({ x: MARGIN, y: topY - tableH, width: CONTENT_W, height: tableH, borderColor: rgb(0,0,0), borderWidth: 1 });
                
                const col1W = CONTENT_W * 0.25;
                const col2W = CONTENT_W * 0.50;
                const col3W = CONTENT_W * 0.25;
                
                // Vertical lines
                currentPage.drawLine({ start: { x: MARGIN + col1W, y: topY }, end: { x: MARGIN + col1W, y: topY - tableH }, thickness: 1, color: rgb(0,0,0) });
                currentPage.drawLine({ start: { x: MARGIN + col1W + col2W, y: topY }, end: { x: MARGIN + col1W + col2W, y: topY - tableH }, thickness: 1, color: rgb(0,0,0) });

                // Col 1: Logo
                const url = bloque.imageUrl || '/logo.png';
                try {
                    const imgRes = await fetch(url);
                    const imgBuf = await imgRes.arrayBuffer();
                    let image;
                    try { image = await pdfDoc.embedPng(imgBuf); } catch { image = await pdfDoc.embedJpg(imgBuf); }
                    
                    const width = bloque.imageWidth || 80;
                    const height = (image.height / image.width) * width;
                    const imgX = MARGIN + (col1W - width) / 2;
                    const imgY = topY - (tableH + height) / 2; // center vertically
                    currentPage.drawImage(image, { x: imgX, y: imgY, width, height });
                } catch (e) {
                    console.error("Error embedding logo in ISO header:", e);
                }

                // Col 2: Titles
                const titSist = bloque.tituloSistema || 'SGSST';
                const titDoc = bloque.tituloDocumento || 'REGLAMENTO INTERNO DE ORDEN HIGIENE Y SEGURIDAD';
                
                // Draw horizontal line in middle of col2
                currentPage.drawLine({ start: { x: MARGIN + col1W, y: topY - 20 }, end: { x: MARGIN + col1W + col2W, y: topY - 20 }, thickness: 1, color: rgb(0,0,0) });
                
                const sysW = fontBold.widthOfTextAtSize(titSist, 11);
                currentPage.drawText(titSist, { x: MARGIN + col1W + (col2W - sysW)/2, y: topY - 14, size: 11, font: fontBold, color });
                
                // Wrap title doc if needed (simplified)
                const docSize = 10;
                const linesDoc = [];
                let curLine = '';
                for (const w of titDoc.split(' ')) {
                    if (fontBold.widthOfTextAtSize(curLine + ' ' + w, docSize) < col2W - 10) curLine += (curLine ? ' ' : '') + w;
                    else { linesDoc.push(curLine); curLine = w; }
                }
                if (curLine) linesDoc.push(curLine);
                
                let docY = topY - 32;
                for (const l of linesDoc) {
                    const lW = fontBold.widthOfTextAtSize(l, docSize);
                    currentPage.drawText(l, { x: MARGIN + col1W + (col2W - lW)/2, y: docY, size: docSize, font: fontBold, color });
                    docY -= 12;
                }

                // Col 3: Metadata rows
                const rowH = tableH / 4;
                for (let i = 1; i < 4; i++) {
                    currentPage.drawLine({ start: { x: MARGIN + col1W + col2W, y: topY - i*rowH }, end: { x: MARGIN + CONTENT_W, y: topY - i*rowH }, thickness: 1, color: rgb(0,0,0) });
                }
                
                const metaProps = [
                    { k: 'Código', v: bloque.codigoDocumento || 'SGST-RE-' },
                    { k: 'Página', v: 'Página 1' },
                    { k: 'Fecha', v: new Date(workerData.generatedAt || Date.now()).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/-/g, '/') },
                    { k: 'Versión', v: bloque.versionDocumento || '01' }
                ];
                
                metaProps.forEach((meta, i) => {
                    const rowYTop = topY - i*rowH;
                    // inner divider
                    currentPage.drawLine({ start: { x: MARGIN + col1W + col2W + 40, y: rowYTop }, end: { x: MARGIN + col1W + col2W + 40, y: rowYTop - rowH }, thickness: 1, color: rgb(0,0,0) });
                    currentPage.drawText(meta.k, { x: MARGIN + col1W + col2W + 4, y: rowYTop - 10, size: 8, font: fontRegular, color });
                    currentPage.drawText(meta.v, { x: MARGIN + col1W + col2W + 44, y: rowYTop - 10, size: 8, font: fontRegular, color });
                });

                y -= tableH + 20;
                break;
            }
            case 'corte': {
                ensureSpace(20);
                y -= 8;
                // Draw scissors icon approximation (or just text)
                currentPage.drawText('✂', { x: MARGIN, y: y - 4, size: 14, font: fontRegular, color });
                // Draw dashed line
                currentPage.drawLine({ start: { x: MARGIN + 16, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.5, 0.5, 0.5), dashArray: [4, 4] });
                y -= 16;
                break;
            }
            case 'titulo': {
                const size = bloque.fontSize || 18;
                const rawText = resolveText(bloque.contenido || '');
                const lines = rawText.split('\n');
                for (const text of lines) {
                    if (!text.trim()) { y -= size * 1.6; continue; }
                    ensureSpace(30);
                    const textW = font.widthOfTextAtSize(text, size);
                    let x = MARGIN;
                    if (bloque.alineacion === 'center') x = (PAGE_W - textW) / 2;
                    else if (bloque.alineacion === 'right') x = PAGE_W - MARGIN - textW;
                    currentPage.drawText(text, { x, y, size, font: fontBold, color });
                    y -= size * 1.6;
                }
                y -= 4; // Extra bottom margin for block
                break;
            }
            case 'subtitulo': {
                const size = bloque.fontSize || 14;
                const rawText = resolveText(bloque.contenido || '');
                const lines = rawText.split('\n');
                for (const text of lines) {
                    if (!text.trim()) { y -= size * 1.6; continue; }
                    ensureSpace(24);
                    const textW = font.widthOfTextAtSize(text, size);
                    let x = MARGIN;
                    if (bloque.alineacion === 'center') x = (PAGE_W - textW) / 2;
                    else if (bloque.alineacion === 'right') x = PAGE_W - MARGIN - textW;
                    currentPage.drawText(text, { x, y, size, font: bloque.negrita ? fontBold : fontRegular, color });
                    y -= size * 1.5;
                }
                y -= 4; // Extra bottom margin for block
                break;
            }
            case 'imagen': {
                ensureSpace(60);
                const url = bloque.imageUrl || '/logo.png';
                try {
                    const imgRes = await fetch(url);
                    const imgBuf = await imgRes.arrayBuffer();
                    
                    let image;
                    try {
                        image = await pdfDoc.embedPng(imgBuf);
                    } catch {
                        image = await pdfDoc.embedJpg(imgBuf);
                    }
                    
                    const width = bloque.imageWidth || 120;
                    const height = (image.height / image.width) * width;
                    ensureSpace(height + 10);
                    
                    let imgX = MARGIN;
                    if (bloque.alineacion === 'center') imgX = MARGIN + (CONTENT_W - width) / 2;
                    else if (bloque.alineacion === 'right') imgX = MARGIN + CONTENT_W - width;
                    
                    y -= height;
                    currentPage.drawImage(image, { x: imgX, y, width, height });
                    y -= 10;
                } catch (e) {
                    console.error("Error embedding image:", e);
                }
                break;
            }
            case 'texto': {
                const size = bloque.fontSize || 11;
                const rawText = resolveText(bloque.contenido || '');
                const lines = rawText.split('\n');
                
                const drawAlignedLine = (text: string, isLastLineOfParagraph: boolean) => {
                    if (!text.trim()) return;
                    ensureSpace(size * 1.6);
                    const textW = font.widthOfTextAtSize(text, size);
                    let x = MARGIN;
                    
                    if (bloque.alineacion === 'center') {
                        x = MARGIN + (CONTENT_W - textW) / 2;
                        currentPage.drawText(text, { x, y, size, font, color });
                    } else if (bloque.alineacion === 'right') {
                        x = MARGIN + CONTENT_W - textW;
                        currentPage.drawText(text, { x, y, size, font, color });
                    } else if (bloque.alineacion === 'justify' && !isLastLineOfParagraph) {
                        const words = text.trim().split(' ');
                        if (words.length > 1) {
                            const wordsW = words.reduce((acc, w) => acc + font.widthOfTextAtSize(w, size), 0);
                            const spaceW = (CONTENT_W - wordsW) / (words.length - 1);
                            let currentX = MARGIN;
                            for (const w of words) {
                                currentPage.drawText(w, { x: currentX, y, size, font, color });
                                currentX += font.widthOfTextAtSize(w, size) + spaceW;
                            }
                        } else {
                            currentPage.drawText(text, { x, y, size, font, color });
                        }
                    } else {
                        // Left or justify last line
                        currentPage.drawText(text, { x, y, size, font, color });
                    }
                    y -= size * 1.6;
                };

                for (const line of lines) {
                    const words = line.split(' ');
                    let currentLine = '';
                    for (const word of words) {
                        const test = currentLine ? currentLine + ' ' + word : word;
                        if (font.widthOfTextAtSize(test, size) > CONTENT_W) {
                            if (currentLine) {
                                drawAlignedLine(currentLine, false);
                            }
                            currentLine = word;
                        } else {
                            currentLine = test;
                        }
                    }
                    if (currentLine) {
                        drawAlignedLine(currentLine, true);
                    }
                }
                y -= size * 0.8;
                break;
            }
            case 'campo_automatico': {
                ensureSpace(24);
                const label = bloque.label || bloque.contenido || 'Campo';
                const value = resolveField(bloque.contenido || '', workerData);
                
                currentPage.drawText(label, { x: MARGIN, y, size: 10, font: fontRegular, color });
                // Línea inferior azul/oscura que cruza hasta el margen derecho
                currentPage.drawLine({ start: { x: MARGIN + 140, y: y - 2 }, end: { x: PAGE_W - MARGIN, y: y - 2 }, thickness: 0.8, color: rgb(0.1, 0.3, 0.8) });
                // Texto sobre la línea
                if (value) {
                    currentPage.drawText(value, { x: MARGIN + 145, y: y + 1, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
                }
                
                y -= 22;
                break;
            }
            case 'campo_manual': {
                ensureSpace(24);
                const label = bloque.etiquetaCampo || 'Campo';
                const value = workerData.manualFields?.[label] || '';
                
                currentPage.drawText(label, { x: MARGIN, y, size: 10, font: fontRegular, color });
                currentPage.drawLine({ start: { x: MARGIN + 140, y: y - 2 }, end: { x: PAGE_W - MARGIN, y: y - 2 }, thickness: 0.8, color: rgb(0.1, 0.3, 0.8) });
                if (value) {
                    currentPage.drawText(value, { x: MARGIN + 145, y: y + 1, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
                }
                
                y -= 22;
                break;
            }
            case 'fecha': {
                ensureSpace(24);
                const label = bloque.label || 'Fecha de entrega';
                const fecha = new Date(workerData.generatedAt || Date.now()).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
                
                currentPage.drawText(label, { x: MARGIN, y, size: 10, font: fontRegular, color });
                currentPage.drawLine({ start: { x: MARGIN + 140, y: y - 2 }, end: { x: PAGE_W - MARGIN, y: y - 2 }, thickness: 0.8, color: rgb(0.1, 0.3, 0.8) });
                currentPage.drawText(fecha, { x: MARGIN + 145, y: y + 1, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
                
                y -= 22;
                break;
            }
            case 'tabla': {
                const cols = bloque.columnas || [];
                const filas = bloque.filas || [];
                if (cols.length === 0) break;
                const colW = CONTENT_W / cols.length;
                const rowH = 16;

                // Cabecera
                ensureSpace(rowH + 4);
                cols.forEach((col, i) => {
                    currentPage.drawRectangle({ x: MARGIN + i * colW, y: y - rowH, width: colW, height: rowH, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5, color: rgb(0.95, 0.95, 0.95) });
                    currentPage.drawText(col, { x: MARGIN + i * colW + 4, y: y - rowH + 4, size: 9, font: fontBold, color });
                });
                y -= rowH;

                // Filas
                for (const fila of filas) {
                    ensureSpace(rowH);
                    fila.forEach((celda, i) => {
                        currentPage.drawRectangle({ x: MARGIN + i * colW, y: y - rowH, width: colW, height: rowH, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
                        currentPage.drawText(celda || '', { x: MARGIN + i * colW + 4, y: y - rowH + 4, size: 9, font: fontRegular, color });
                    });
                    y -= rowH;
                }
                y -= 8;
                break;
            }
            case 'checkbox': {
                ensureSpace(18);
                currentPage.drawRectangle({ x: MARGIN, y: y - 10, width: 10, height: 10, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.8 });
                currentPage.drawText(bloque.contenido || '', { x: MARGIN + 16, y, size: 11, font: fontRegular, color });
                y -= 18;
                break;
            }
            case 'checklist_2col': {
                // Renders EPP items in 2 equal columns with checkbox + label
                // Admin-selected items (eppSeleccionados) get a bold ✓ checkmark drawn inside
                const items = bloque.filas_epp || [];
                if (items.length === 0) break;

                const selected = new Set<number>(bloque.eppSeleccionados || []);
                const colW2 = CONTENT_W / 2;
                const ROW_H = 15;
                const CHECK_SIZE = 8;

                // Split items into two halves
                const half = Math.ceil(items.length / 2);
                const leftCol = items.slice(0, half);
                const rightCol = items.slice(half);
                const rows = Math.max(leftCol.length, rightCol.length);

                ensureSpace(rows * ROW_H + 4);

                for (let i = 0; i < rows; i++) {
                    const rowY = y - i * ROW_H;

                    const renderEppItem = (item: { label: string; claveTalla?: string } | undefined, colX: number, globalIdx: number) => {
                        if (!item) return;
                        const isChecked = selected.has(globalIdx);

                        // Checkbox square — filled green if selected, empty if not
                        currentPage.drawRectangle({
                            x: colX + 2, y: rowY - CHECK_SIZE,
                            width: CHECK_SIZE, height: CHECK_SIZE,
                            borderColor: isChecked ? rgb(0.1, 0.55, 0.2) : rgb(0.4, 0.4, 0.4),
                            borderWidth: isChecked ? 1 : 0.6,
                            color: isChecked ? rgb(0.88, 0.97, 0.88) : undefined,
                        });

                        // ✓ checkmark if selected (drawn with lines to avoid WinAnsi encoding errors)
                        if (isChecked) {
                            // Left part of the checkmark
                            currentPage.drawLine({
                                start: { x: colX + 3.5, y: rowY - CHECK_SIZE + 3.5 },
                                end: { x: colX + 5, y: rowY - CHECK_SIZE + 2 },
                                thickness: 1.2, color: rgb(0.1, 0.55, 0.2),
                            });
                            // Right part of the checkmark
                            currentPage.drawLine({
                                start: { x: colX + 5, y: rowY - CHECK_SIZE + 2 },
                                end: { x: colX + 8.5, y: rowY - CHECK_SIZE + 5.5 },
                                thickness: 1.2, color: rgb(0.1, 0.55, 0.2),
                            });
                        }

                        // Item label (truncated to fit column width)
                        const availW = colW2 - CHECK_SIZE - 10;
                        let labelText = item.label;
                        while (labelText.length > 2 && fontRegular.widthOfTextAtSize(labelText, 8) > availW) {
                            labelText = labelText.slice(0, -1);
                        }
                        currentPage.drawText(labelText, {
                            x: colX + CHECK_SIZE + 6, y: rowY - CHECK_SIZE + 1,
                            size: 8,
                            font: isChecked ? fontBold : fontRegular,
                            color: isChecked ? rgb(0.05, 0.4, 0.1) : color,
                        });
                    };

                    renderEppItem(leftCol[i], MARGIN, i);
                    if (rightCol[i]) renderEppItem(rightCol[i], MARGIN + colW2, half + i);
                }

                y -= rows * ROW_H + 4;
                break;
            }
            case 'dotacion_personal': {
                // Clothing items with auto-talla from worker profile, two per row
                const DOTACION_ITEMS = bloque.filas_dotacion || [];

                const DOT_ROW_H = 18;
                const DOT_CHECK = 9;
                const COL_W = CONTENT_W / 2;
                const TALLA_BOX_W = 36;
                const TALLA_LABEL = 'Talla';

                // Render in 2 columns per row: items pair side by side
                const pairs = Math.ceil(DOTACION_ITEMS.length / 2);
                ensureSpace(pairs * DOT_ROW_H + 4);

                for (let row = 0; row < pairs; row++) {
                    const rowY = y - row * DOT_ROW_H;
                    const leftItem  = DOTACION_ITEMS[row * 2];
                    const rightItem = DOTACION_ITEMS[row * 2 + 1];

                    const dotacionSelected = new Set<number>(bloque.dotacionSeleccionados || []);

                    const renderDotItem = (item: typeof DOTACION_ITEMS[0], colX: number, globalIdx: number) => {
                        const talla = resolveField(item.claveTalla, workerData);
                        const isChecked = dotacionSelected.has(globalIdx);

                        // Item label
                        currentPage.drawText(item.label, {
                            x: colX + 2, y: rowY - DOT_CHECK + 2,
                            size: 9, font: fontRegular, color,
                        });

                        // underline for item mark (e.g. "ok")
                        const labelW = fontRegular.widthOfTextAtSize(item.label, 9);
                        const qtyBoxX = colX + 2 + labelW + 6;
                        const qtyBoxW = 28;
                        currentPage.drawLine({
                            start: { x: qtyBoxX, y: rowY - DOT_CHECK },
                            end:   { x: qtyBoxX + qtyBoxW, y: rowY - DOT_CHECK },
                            thickness: 0.6, color: rgb(0.5, 0.5, 0.5),
                        });

                        // If selected, draw a green checkmark box centered on the line
                        if (isChecked) {
                            const cbSize = 9;
                            const cbX = qtyBoxX + (qtyBoxW - cbSize) / 2;
                            const cbY = rowY - DOT_CHECK; // base of the line
                            
                            // Green filled square
                            currentPage.drawRectangle({
                                x: cbX, y: cbY,
                                width: cbSize, height: cbSize,
                                color: rgb(0.1, 0.7, 0.1),
                            });
                            // White checkmark lines inside the green box
                            currentPage.drawLine({
                                start: { x: cbX + 2, y: cbY + 4 },
                                end: { x: cbX + 4, y: cbY + 2.5 },
                                thickness: 1.5, color: rgb(1, 1, 1),
                            });
                            currentPage.drawLine({
                                start: { x: cbX + 4, y: cbY + 2.5 },
                                end: { x: cbX + 7.5, y: cbY + 6.5 },
                                thickness: 1.5, color: rgb(1, 1, 1),
                            });
                        }

                        // "Talla" label + underline box
                        const tallaLabelW = fontRegular.widthOfTextAtSize(TALLA_LABEL, 8);
                        const tallaStartX = colX + COL_W - TALLA_BOX_W - tallaLabelW - 12;
                        currentPage.drawText(TALLA_LABEL, {
                            x: tallaStartX, y: rowY - DOT_CHECK + 2,
                            size: 8, font: fontRegular, color: rgb(0.5, 0.5, 0.5),
                        });
                        // underline for talla value
                        const boxX = tallaStartX + tallaLabelW + 4;
                        currentPage.drawLine({
                            start: { x: boxX, y: rowY - DOT_CHECK },
                            end:   { x: boxX + TALLA_BOX_W, y: rowY - DOT_CHECK },
                            thickness: 0.6, color: rgb(0.5, 0.5, 0.5),
                        });
                        // Auto-fill talla if available (blue bold)
                        if (talla) {
                            currentPage.drawText(talla, {
                                x: boxX + 2, y: rowY - DOT_CHECK + 2,
                                size: 8.5, font: fontBold, color: rgb(0.1, 0.3, 0.8),
                            });
                        }
                    };

                    renderDotItem(leftItem, MARGIN, row * 2);
                    if (rightItem) renderDotItem(rightItem, MARGIN + COL_W, row * 2 + 1);
                }

                y -= pairs * DOT_ROW_H + 4;
                break;
            }

            case 'firma': {
                ensureSpace(40);
                const labelStr = bloque.label || 'Firma del trabajador';
                
                // Se alinea a la izquierda como un campo de formulario más
                currentPage.drawText(labelStr, { x: MARGIN, y, size: 10, font: fontRegular, color });
                
                // La línea ocupa todo el espacio derecho
                const lineStartX = MARGIN + 140;
                const lineEndX = PAGE_W - MARGIN;
                currentPage.drawLine({ start: { x: lineStartX, y: y - 2 }, end: { x: lineEndX, y: y - 2 }, thickness: 0.8, color: rgb(0.1, 0.3, 0.8) });
                
                // Registramos los bounds de la firma para que DocumentsPage.tsx inserte ahí los trazos azules.
                // Como es una línea completa, podemos poner la caja de firma en el centro de esa línea.
                const sigW = 200;
                const sigH = 40;
                const sigX = lineStartX + ((lineEndX - lineStartX) - sigW) / 2;
                
                sigBounds = {
                    pageIndex: pdfDoc.getPages().indexOf(currentPage),
                    x: sigX,
                    y: y, // The signature line is exactly at y
                    width: sigW,
                    height: sigH
                };

                y -= 24;
                break;
            }
            case 'linea': {
                ensureSpace(24);
                y -= 8; // Extra top margin
                currentPage.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
                y -= 14; // Extra bottom margin
                break;
            }
            case 'espaciador': {
                y -= (bloque.altura || 24) * 0.75; // pt aproximado
                if (y < 60) newPage();
                break;
            }
            default:
                break;
        }
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    return { pdfBytes, blob, pageCount: pdfDoc.getPageCount(), signatureBounds: sigBounds };
}

// ─── Upload a Firebase Storage ────────────────────────────────────────────────
export async function uploadGeneratedPDF(blob: Blob, docId: string): Promise<string> {
    const path = `generated_docs/${docId}.pdf`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, blob, { contentType: 'application/pdf', cacheControl: 'no-cache' });
    return await getDownloadURL(sRef);
}
