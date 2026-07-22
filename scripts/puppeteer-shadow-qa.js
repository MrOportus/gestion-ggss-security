import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const VIEWPORTS = [
  { name: 'Desktop_1440', width: 1440, height: 900 },
  { name: 'Desktop_1024', width: 1024, height: 768 },
  { name: 'Tablet_768', width: 768, height: 1024 },
  { name: 'Mobile_390', width: 390, height: 844 },
  { name: 'Mobile_360', width: 360, height: 800 }
];

const MOCK_DATA = {
  'sesion_unica': {
    status: 'exact_match',
    comparisonScope: 'full',
    comparisonComplete: true,
    legacyResult: { items: [{ id: 'leg_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }], hasMore: false },
    v2Result: { items: [{ id: 'v2_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }], hasMore: false },
    comparison: { groupsCompared: 1, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'completed', comparisonScope: 'full' }
  },
  'multiturno': {
    status: 'exact_match',
    comparisonScope: 'full',
    comparisonComplete: true,
    legacyResult: { items: [{ id: 'leg_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }], hasMore: false },
    v2Result: { items: [
      { id: 'v2_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T12:00:00Z', status: 'closed' },
      { id: 'v2_2', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T14:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }
    ], hasMore: false },
    comparison: { groupsCompared: 1, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'completed', comparisonScope: 'full' }
  },
  'legacy_overwrite_detected': {
    status: 'legacy_overwrite_detected',
    comparisonScope: 'full',
    comparisonComplete: true,
    legacyResult: { items: [{ id: 'leg_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }], hasMore: false },
    v2Result: { items: [
      { id: 'v2_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T12:00:00Z', status: 'closed' },
      { id: 'v2_2', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T14:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }
    ], hasMore: false },
    comparison: { groupsCompared: 1, groupsDeferred: 0, differencesDetected: true, comparisonStatus: 'completed', comparisonScope: 'full' }
  },
  'comparacion_parcial': {
    status: 'exact_match',
    comparisonScope: 'partial',
    comparisonComplete: false,
    legacyResult: { items: [{ id: 'leg_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }], hasMore: false },
    v2Result: { items: [{ id: 'v2_1', employeeId: '1', employeeName: 'Juan Perez', jornadaDate: '2026-07-22', checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'closed' }], hasMore: false },
    comparison: { groupsCompared: 1, groupsDeferred: 1, differencesDetected: false, comparisonStatus: 'partial', comparisonScope: 'partial' }
  }
};

(async () => {
  console.log('Iniciando Puppeteer para validación de Shadow QA...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Set interceptor for mocking the callable responses
  await page.setRequestInterception(true);
  
  let currentScenario = 'estado_inicial';
  let shouldFail = false;
  let shouldDelay = false;

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

  page.on('request', request => {
    if (request.url().includes('getAttendanceShadowValidated')) {
      if (request.method() === 'OPTIONS') {
        request.respond({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
        return;
      }

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*'
      };

      if (shouldDelay) {
        // Delay for 10 seconds so we can capture loading state, then respond
        setTimeout(() => request.respond({ status: 200, headers: corsHeaders, body: '{"result":{}}' }), 10000);
        return; 
      }
      if (shouldFail) {
        request.respond({
          status: 400,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ error: { message: "Error de prueba generado por Puppeteer para UI" } })
        });
        return;
      }
      
      const mockResponse = MOCK_DATA[currentScenario];
      if (mockResponse) {
        request.respond({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ result: mockResponse })
        });
      } else {
        request.continue();
      }
    } else {
      request.continue();
    }
  });

  const outDir = path.join(process.cwd(), 'capturas_ui');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  for (const vp of VIEWPORTS) {
    await page.setViewport({ width: vp.width, height: vp.height });
    console.log(`\nGenerando capturas para Viewport: ${vp.name}`);

    // Helper to capture
    const capture = async (scenarioName) => {
      const p = path.join(outDir, `${vp.name}_${scenarioName}.png`);
      await page.screenshot({ path: p, fullPage: true });
      console.log(` ✅ ${scenarioName}`);
    };

    // Helper to fill form
    const fillForm = async () => {
      await page.evaluate(() => {
        const select = document.querySelector('#sucursalId');
        if (select && !select.querySelector('option[value="mock-sucursal"]')) {
          const option = document.createElement('option');
          option.value = 'mock-sucursal';
          option.text = 'Mock Sucursal';
          select.appendChild(option);
          select.value = 'mock-sucursal';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    };

    // 1. Estado inicial
    shouldDelay = false; shouldFail = false; currentScenario = 'estado_inicial';
    await page.goto('http://localhost:3002/qa-shadow.html', { waitUntil: 'load' });
    await capture('1_estado_inicial');

    // 2. Loading
    shouldDelay = true;
    await fillForm();
    // Click on search
    await page.$eval('button.bg-indigo-600', b => b.click());
    await new Promise(r => setTimeout(r, 1000));
    await capture('2_loading');

    // 3. Error amigable
    shouldDelay = false; shouldFail = true;
    await page.reload({ waitUntil: 'load' });
    await fillForm();
    await page.$eval('button.bg-indigo-600', b => b.click());
    await new Promise(r => setTimeout(r, 1000));
    await capture('3_error_amigable');

    // 4. Sesión única
    shouldDelay = false; shouldFail = false; currentScenario = 'sesion_unica';
    await page.reload({ waitUntil: 'load' });
    await fillForm();
    await page.$eval('button.bg-indigo-600', b => b.click());
    await new Promise(r => setTimeout(r, 1000));
    await capture('4_sesion_unica');

    // 5. Multiturno
    currentScenario = 'multiturno';
    await page.reload({ waitUntil: 'load' });
    await fillForm();
    await page.$eval('button.bg-indigo-600', b => b.click());
    await new Promise(r => setTimeout(r, 1000));
    await capture('5_multiturno');

    // 6. Legacy Overwrite Detected
    currentScenario = 'legacy_overwrite_detected';
    await page.reload({ waitUntil: 'load' });
    await fillForm();
    await page.$eval('button.bg-indigo-600', b => b.click());
    await new Promise(r => setTimeout(r, 1000));
    await capture('6_legacy_overwrite_detected');

    // 7. Comparación parcial
    currentScenario = 'comparacion_parcial';
    await page.reload({ waitUntil: 'load' });
    await fillForm();
    await page.$eval('button.bg-indigo-600', b => b.click());
    await new Promise(r => setTimeout(r, 1000));
    await capture('7_comparacion_parcial');
  }

  await browser.close();
  console.log('\nValidación visual completada con éxito.');
})();
