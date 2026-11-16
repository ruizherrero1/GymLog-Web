import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('index.html', 'utf8');
const start = source.indexOf('function finishWorkout(){');
const end = source.indexOf('function discardWorkout(){', start);
assert(start >= 0 && end > start);

function runFinish(quota){
  const storage = new Map([['active', '{"workoutData":"synthetic"}']]);
  const localStorage = {
    getItem:key => storage.get(key) ?? null,
    removeItem:key => storage.delete(key),
    setItem(key, value){
      if(value.length > quota) throw new Error('QuotaExceededError');
      storage.set(key, value);
    }
  };
  const fields = {
    finishNote:{ value:'' },
    finishStartedAt:{ value:'2025-01-06T09:00', dataset:{} },
    finishCompletedAt:{ value:'2025-01-06T09:45', dataset:{} }
  };
  const state = { routines:[{ id:'test-routine', name:'Prueba', exercises:[{ id:'test-exercise', name:'Ejercicio', type:'weight' }] }], workoutLog:[] };
  let cleared = false;
  let toast = '';
  const context = {
    Date, Number, Math, Set, String, localStorage, state,
    ACTIVE_WORKOUT_KEY:'active', currentRoutineId:'test-routine', activeExerciseIds:['test-exercise'],
    workoutData:{ 'test-exercise':{ series:[{ reps:10, weight:20, done:true }] } },
    getCurrentWorkoutRoutine:() => state.routines[0], isFreeWorkout:() => false,
    isTemporaryWorkoutExercise:() => false,
    workoutSeriesForLog:() => [{ reps:10, weight:20, done:true }],
    uid:() => 'synthetic-log', isoDate:() => '2025-01-06',
    clearActiveWorkout:() => localStorage.removeItem('active'),
    persistActiveWorkout:() => {},
    save:() => { try{ localStorage.setItem('state', JSON.stringify(state)); return true; }catch{ return false; } },
    leaveCompletedWorkout:() => { cleared = true; localStorage.removeItem('active'); },
    closeModal:() => {}, showToast:value => { toast = value; },
    document:{ getElementById:id => fields[id] },
    syncWorkoutToHealth:undefined
  };
  vm.runInNewContext(source.slice(start, end), context);
  const result = context.finishWorkout();
  return { result, state, storage, cleared, toast };
}

const success = runFinish(10000);
assert.equal(success.state.workoutLog.length, 1);
assert.equal(success.state.workoutLog[0].duration, 45 * 60);
assert.equal(success.state.workoutLog[0].startedAt, new Date('2025-01-06T09:00').toISOString());
assert.equal(success.state.workoutLog[0].completedAt, new Date('2025-01-06T09:45').toISOString());
assert.equal(success.storage.has('active'), false);
assert.equal(success.cleared, true);

const failure = runFinish(10);
assert.equal(failure.state.workoutLog.length, 0);
assert.equal(failure.storage.has('active'), true);
assert.equal(failure.cleared, false);
assert.match(failure.toast, /falta de espacio/);
console.log('Cierre con horas elegidas y conservación del entreno al fallar el guardado verificados.');
