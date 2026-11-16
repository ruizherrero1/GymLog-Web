import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const reliability = fs.readFileSync('public/gymlog-reliability.js', 'utf8');
assert(!html.includes('id="activeRestTimer"'), 'El temporizador antiguo sigue visible');
assert(!html.includes('onclick="jumpToNextExercise()">Siguiente'), 'Siguiente sigue en la barra');
assert(!html.includes('onclick="askFinishWorkout()">Finalizar'), 'Finalizar sigue en la barra');
assert(reliability.includes('id="gymManualRestActions"'), 'Faltan las acciones compactas del temporizador');

const start = reliability.indexOf('function startManualRestTimer(');
const end = reliability.indexOf('function extendManualRestTimer(', start);
assert(start >= 0 && end > start, 'No se encontró la lógica del descanso automático');
const workoutData = { ex:{ series:[{ done:false },{ done:false }] } };
const state = { settings:{ manualRestSeconds:60, autoRestEnabled:false } };
let saves = 0;
let intervals = 0;
const context = {
  state, workoutData, currentRoutineId:'routine-test', window:{}, Date,
  configuredRestSeconds:() => 60, formatRestSeconds:() => '1:00',
  getCurrentPendingSeries:() => workoutData.ex.series.find(series => !series.done) || null,
  primeAudioContext:() => {}, updateWorkoutToolsUi:() => {}, showToast:() => {},
  save:() => { saves += 1; return true; },
  setInterval:() => ++intervals, clearInterval:() => {}, tickManualRestTimer:() => {},
  tickSeries:(exId,idx) => { workoutData[exId].series[idx].done = !workoutData[exId].series[idx].done; },
  toggleAllSeries:exId => {
    const allDone = workoutData[exId].series.every(series => series.done);
    workoutData[exId].series.forEach(series => { series.done = !allDone; });
  }
};
const api = vm.runInNewContext(`let manualRestEndsAt=0, manualRestInterval=null, manualRestWasAuto=false;
  function cancelManualRestTimer(){manualRestEndsAt=0;manualRestWasAuto=false;}
  ${reliability.slice(start,end)}
  ({ tick:tickSeries, toggleAll:toggleAllSeries, toggleAutoRest, startManualRestTimer,
    getEnd:()=>manualRestEndsAt, setEnd:value=>{manualRestEndsAt=value}, isAuto:()=>manualRestWasAuto })`, context);

api.tick('ex',0);
assert.equal(api.getEnd(),0,'Auto estaba activo por defecto');
api.tick('ex',0);
api.toggleAutoRest();
assert.equal(state.settings.autoRestEnabled,true);
assert.equal(saves,1);
api.tick('ex',0);
assert(api.getEnd() > Date.now(),'No arrancó el descanso tras marcar una serie');
assert.equal(api.isAuto(),true);
api.tick('ex',0);
assert.equal(intervals,1,'Desmarcar una serie reinició el descanso');
api.setEnd(Date.now()+1000);
api.tick('ex',0);
assert(api.getEnd() > Date.now()+50_000,'El descanso no se reinició al marcar otra serie');
assert.equal(intervals,2);
api.tick('ex',1);
assert.equal(api.getEnd(),0,'Quedó un descanso automático tras la última serie');
api.toggleAutoRest();
assert.equal(state.settings.autoRestEnabled,false);
assert.equal(saves,2);
console.log('Auto solo inicia con series pendientes; desmarcar, reiniciar y última serie verificados.');
