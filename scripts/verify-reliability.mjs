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
check(serviceWorker.includes('gymlog-web-v10-20260722-health-routines'), 'La actualizacion de Health y rutinas debe invalidar la cache PWA anterior.');
check(html.includes('id="gymHealthMoreOptions"'), 'Las opciones secundarias de Health deben estar agrupadas en un panel compacto.');
check(html.includes('function healthRecoveryEligible(log)'), 'La recuperacion de FC debe respetar una fecha de inicio.');
check(occurrences(html, 'healthRecoveryEligible(log)') > 1, 'El limite de FC debe aplicarse a contadores y acciones.');
check(reliability.includes('remotePlanVersion !== localPlanVersion'), 'La version del plan debe impedir que reaparezcan rutinas antiguas.');
check(reliability.includes("routine?.timerCompletesWorkout || routine?.id === 'cardio-bike-indoor'"), 'La bicicleta debe poder completarse con el cronometro parado.');
check(reliability.includes('routineTimerState.running || routineTimerValue() <= 0'), 'Solo un cronometro parado y con tiempo debe completar la bicicleta.');
check(reliability.includes('beginQuickReplaceSeriesInput(input)'), 'Los campos de series deben vaciarse al recibir foco.');
check(reliability.includes('input.dataset.quickReplaceValue = input.value'), 'El valor anterior debe conservarse como respaldo.');
check(reliability.includes("if(input.value.trim() === '') input.value = input.dataset.quickReplaceValue || ''"), 'Salir sin escribir debe restaurar el valor anterior.');
check(reliability.includes('.series-input[type="number"]:not(:disabled)'), 'El reemplazo rapido solo debe afectar peso y repeticiones durante el entreno.');
check(reliability.includes('const DEFAULT_MANUAL_REST_SECONDS = 60'), 'El descanso manual debe usar 60 segundos por defecto.');
check(reliability.includes('state?.settings?.manualRestSeconds'), 'El descanso debe leer su duracion desde Ajustes.');
check(reliability.includes('state.settings.manualRestSeconds = value'), 'Ajustes debe guardar la duracion elegida.');
check(reliability.includes('value<MIN_MANUAL_REST_SECONDS || value>MAX_MANUAL_REST_SECONDS'), 'La duracion configurable debe validar sus limites.');
check(reliability.includes('renderRestSettingsPanel();'), 'Ajustes debe mostrar el control del descanso.');
check(reliability.includes('const duration = configuredRestSeconds()'), 'El temporizador debe usar la duracion configurada.');
check(reliability.includes('window.startManualRestTimer = startManualRestTimer'), 'El descanso solo debe comenzar desde su boton manual.');
check(reliability.includes("if(typeof playTimerBeep === 'function') playTimerBeep()"), 'El descanso debe emitir el sonido configurado al terminar.');
check(reliability.includes("const delta = field === 'weight' ? 2.5 : 1"), 'Los ajustes rapidos deben usar 2,5 kg y 1 repeticion.');
check(reliability.includes("wrapper.className = 'gym-series-stepper'"), 'Los ajustes deben integrarse dentro del campo para conservar el ancho movil.');
check(reliability.includes('function undoGymWorkoutAction()'), 'El entreno debe permitir deshacer la ultima accion.');
check(reliability.includes('workoutData = clone(lastWorkoutAction.workoutData)'), 'Deshacer debe restaurar una copia segura del entreno.');
check(reliability.includes("routine?.timerMode === 'stopwatch' || routine?.timerMode === 'countdown'"), 'Las rutinas deben admitir cronometro y cuenta atras.');
check(reliability.includes("const ROUTINE_TIMER_STORAGE_KEY = 'gymlog-routine-timer-v1'"), 'El temporizador de rutina debe poder recuperarse al volver a la app.');
check(reliability.includes('function routineTimerValue(now = Date.now())'), 'El tiempo debe calcularse con marcas temporales para resistir el segundo plano.');
check(reliability.includes('window.toggleRoutineTimer = toggleRoutineTimer'), 'El temporizador solo debe comenzar desde Play.');
check(reliability.includes("if(typeof playTimerBeep === 'function') playTimerBeep()"), 'La cuenta atras debe avisar con el sonido configurado.');
check(reliability.includes("Cronómetro libre (cuenta hacia arriba)"), 'El editor debe ofrecer cronometro libre.');
check(reliability.includes("routine.timerDurationSeconds = timerConfig.duration"), 'El editor debe guardar la duracion de la cuenta atras.');
check(reliability.includes("activeExercises.parentNode.insertBefore(panel,activeExercises)"), 'El temporizador debe quedar visible antes de los ejercicios.');

for(const file of ['public/gymlog-reliability.js','public/gymlog-note-templates.js','public/service-worker.js','scripts/prepare-classic-web.mjs']){
  const result = spawnSync(process.execPath, ['--check', file], { cwd:root, encoding:'utf8' });
  check(result.status === 0, `${file} no supera node --check: ${result.stderr}`);
}

if(failures.length){
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Reliability checks passed: cloud revisions, privacy, PWA, Health recovery and classic templates.');
