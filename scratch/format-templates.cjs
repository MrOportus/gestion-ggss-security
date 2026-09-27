const fs = require('fs');
const data = JSON.parse(fs.readFileSync('scratch/templates.json'));
const reg = data.find(t => t.tipo === 'Reglamento');
const epp = data.find(t => t.tipo === 'EPP');

function formatBlocks(blocks) {
  return blocks.map(b => {
    let type = b.tipo;
    let overrides = { ...b };
    delete overrides.id;
    delete overrides.tipo;
    delete overrides.orden;
    // remove empty strings if any, except for label/contenido depending on type
    Object.keys(overrides).forEach(k => {
      if (overrides[k] === '' && k !== 'contenido' && k !== 'imageUrl') delete overrides[k];
    });
    return `        blk('${type}', ${JSON.stringify(overrides)}),`;
  }).join('\n');
}

let regStr = `export const TEMPLATE_REGLAMENTO_INTERNO: Omit<DocumentTemplate, 'id' | 'creadoEn'> = {
    nombre: '${reg.nombre}',
    tipo: '${reg.tipo}',
    version: ${reg.version},
    estado: 'activo',
    creadoPor: '',
    firmaConfig: ${JSON.stringify(reg.firmaConfig)},
    bloques: [
${formatBlocks(reg.bloques)}
    ].map((b, i) => ({ ...b, orden: i })),
};`;

let eppStr = `export const TEMPLATE_EPP_OFICIAL: Omit<DocumentTemplate, 'id' | 'creadoEn'> = {
    nombre: '${epp.nombre}',
    tipo: '${epp.tipo}',
    version: ${epp.version},
    estado: 'activo',
    creadoPor: '',
    firmaConfig: ${JSON.stringify(epp.firmaConfig)},
    bloques: [
${formatBlocks(epp.bloques)}
    ].map((b, i) => ({ ...b, orden: i })),
};`;

fs.writeFileSync('scratch/replacements.txt', regStr + '\n\n' + eppStr);
