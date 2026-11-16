import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('index.html', 'utf8');
const start = source.indexOf('function packLocalHeartRateSamples(');
const end = source.indexOf('function parseStoredState(){', start);
assert(start >= 0 && end > start, 'No se encontró el códec de almacenamiento local');
const codec = vm.runInNewContext(`${source.slice(start, end)}; ({ serializeLocalState, parseLocalState })`, {
  localStorage:{ setItem(){} }, STORAGE_KEY:'test'
});

const samples = Array.from({ length:51703 }, (_, index) => ({
  bpm:80 + index % 50,
  time:index % 5 === 0 ? '' : new Date(Date.UTC(2025, 0, 1, 9, 0, 0) + index * 1000).toISOString().slice(0, 19) + 'Z'
}));
const state = { workoutLog:[{ id:'synthetic-session', health:{ metrics:{ heartRateSamples:samples } } }] };
const ordinary = JSON.stringify(state);
const compact = codec.serializeLocalState(state);
assert(compact.length < ordinary.length / 3, 'La copia local sigue siendo demasiado grande');
const simulatedStorage = { setItem(_key, value){ if(value.length > 1_000_000) throw new Error('QuotaExceededError'); } };
assert.throws(() => simulatedStorage.setItem('state', ordinary), /QuotaExceededError/);
assert.doesNotThrow(() => simulatedStorage.setItem('state', compact));
assert.deepEqual(JSON.parse(JSON.stringify(codec.parseLocalState(compact))), state, 'La compactación cambió lecturas u horas');
assert.deepEqual(JSON.parse(JSON.stringify(codec.parseLocalState(ordinary))), state, 'El estado antiguo dejó de cargarse');

const unusual = { workoutLog:[{ health:{ metrics:{ heartRateSamples:[{ bpm:90, time:'', source:'other' }] } } }] };
assert.deepEqual(JSON.parse(JSON.stringify(codec.parseLocalState(codec.serializeLocalState(unusual)))), unusual,
  'Una muestra con otros campos perdió información');
console.log(`Almacenamiento local: ${ordinary.length} → ${compact.length} caracteres; lectura exacta y formato antiguo verificados.`);
