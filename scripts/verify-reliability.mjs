import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/gymlog-classic.html');
const reliability = read('public/gymlog-reliability.js');
const templates = read('public/gymlog-note-templates.js');
const serviceWorker = read('public/service-worker.js');

const failures = [];
const check = (condition, message) => { if(!condition) failures.push(message); };
const occurrences = (source, value) => source.split(value).length - 1;

check(occurrences(html, '<script src="/gymlog-reliability.js"></script>') === 1, 'El módulo reliability debe cargarse una vez.');
check(occurrences(html, '<script src="/gymlog-note-templates.js"></script>') === 1, 'El catálogo de notas debe cargarse una vez.');
check(html.includes("if('serviceWorker' in navigator"), 'El HTML generado debe registrar el service worker.');
check(!html.includes("if(false && 'serviceWorker'"), 'El service worker no puede quedar desactivado.');
check(html.includes("['Ultimo backup'"), 'El panel rico de seguridad debe conservarse.');
check(!html.includes("['Cuenta web', 'Pendiente de diseno'"), 'No debe reaparecer el estado web obsoleto.');
check(html.includes("'gymlog-ramon-state-v1'"), 'Debe mantenerse la migración localStorage antigua.');
check(!/[A-Z0-9._%+-]+@gmail\.com/i.test(html), "El HTML público no debe contener emails personales.");
check(!/(?:password|contraseña)\s*[:=]\s*(?:\x22|\x27)[^\x22\x27]{4,}(?:\x22|\x27)/i.test(html), "El HTML público no debe contener contraseñas embebidas.");
check((templates.match(/key:'(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|compras)'/g) || []).length === 8, 'Deben existir las 8 plantillas clásicas.');
check(reliability.includes('p_expected_revision:cloudRevision'), 'El guardado debe usar revisión esperada.');
check(reliability.includes("p_snapshot_reason:'automatic-conflict-merge'"), 'Los conflictos deben crear snapshot.');
check(reliability.includes('function revealAppContent()'), 'El arranque debe revelar los paneles de datos.');
check(reliability.includes("getElementById('gymlog-web-boot-cleanup')?.remove()"), 'Debe retirarse el bloqueo visual de arranque.');
check(reliability.includes('refreshCloudUi();'), 'La carga de nube debe refrescar y revelar la interfaz.');
check(serviceWorker.includes('NETWORK_FIRST_PATHS'), 'Los scripts criticos deben usar red primero.');
check(serviceWorker.includes("'/gymlog-reliability.js'"), 'El modulo de sincronizacion debe actualizarse desde red.');
check(reliability.includes('15*60*1000,2*60*60*1000,24*60*60*1000'), 'La recuperación Health debe programar 15 min, 2 h y 24 h.');
check(reliability.includes('calendarHeartRateHtml(log)'), 'El calendario debe incluir el resumen de frecuencia cardiaca.');
check(reliability.includes('const baseShowDayDetail = showDayDetail'), 'El detalle del calendario debe conservar su comportamiento original.');
check(reliability.includes('class="gym-calendar-hr-canvas"'), 'La tarjeta del calendario debe incluir la grafica FC.');
check(reliability.includes("openHeartRateDetails('${escapeAttribute(log.id)}')"), 'La grafica resumida debe abrir el detalle completo.');
check(serviceWorker.includes('gymlog-web-v6-20260721-quick-input'), 'La mejora de inputs debe invalidar la cache PWA anterior.');
check(reliability.includes('beginQuickReplaceSeriesInput(input)'), 'Los campos de series deben vaciarse al recibir foco.');
check(reliability.includes('input.dataset.quickReplaceValue = input.value'), 'El valor anterior debe conservarse como respaldo.');
check(reliability.includes("if(input.value.trim() === '') input.value = input.dataset.quickReplaceValue || ''"), 'Salir sin escribir debe restaurar el valor anterior.');
check(reliability.includes('.series-input[type="number"]:not(:disabled)'), 'El reemplazo rapido solo debe afectar peso y repeticiones durante el entreno.');

for(const file of ['public/gymlog-reliability.js','public/gymlog-note-templates.js','public/service-worker.js','scripts/prepare-classic-web.mjs']){
  const result = spawnSync(process.execPath, ['--check', file], { cwd:root, encoding:'utf8' });
  check(result.status === 0, `${file} no supera node --check: ${result.stderr}`);
}

if(failures.length){
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Reliability checks passed: cloud revisions, privacy, PWA, Health recovery and classic templates.');
