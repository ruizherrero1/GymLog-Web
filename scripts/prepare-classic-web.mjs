import fs from "node:fs";

const sourcePath = "index.html";
const targetPath = "public/gymlog-classic.html";

function extractConstObject(source, name) {
  const needle = `const ${name} = `;
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`No se encontro ${name}`);

  const start = source.indexOf("{", index);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let position = start; position < source.length; position += 1) {
    const char = source[position];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: position + 1, text: source.slice(start, position + 1) };
    }
  }

  throw new Error(`No se pudo cerrar ${name}`);
}

function extractConstArray(source, name) {
  const needle = `const ${name} = `;
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`No se encontro ${name}`);

  const start = source.indexOf("[", index);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let position = start; position < source.length; position += 1) {
    const char = source[position];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return { start, end: position + 1, text: source.slice(start, position + 1) };
    }
  }

  throw new Error(`No se pudo cerrar ${name}`);
}

function replaceConstObject(source, name, value) {
  const extracted = extractConstObject(source, name);
  return `${source.slice(0, extracted.start)}${JSON.stringify(value, null, 2)}${source.slice(extracted.end)}`;
}

function replaceConstArray(source, name, value) {
  const extracted = extractConstArray(source, name);
  return `${source.slice(0, extracted.start)}${JSON.stringify(value, null, 2)}${source.slice(extracted.end)}`;
}

function replaceElementInnerById(source, id, replacement = "") {
  const openTagPattern = new RegExp(`<([a-z0-9-]+)\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i");
  const openMatch = openTagPattern.exec(source);
  if (!openMatch) return source;

  const tag = openMatch[1].toLowerCase();
  const openEnd = openMatch.index + openMatch[0].length;
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = openEnd;

  let depth = 1;
  let match;
  while ((match = tagPattern.exec(source))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return `${source.slice(0, openEnd)}${replacement}${source.slice(match.index)}`;
    }
  }

  throw new Error(`No se pudo cerrar el elemento #${id}`);
}

function replaceFunctionBody(source, name, body) {
  const needle = `function ${name}(`;
  const index = source.indexOf(needle);
  if (index < 0) return source;

  const start = source.indexOf("{", index);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let position = start; position < source.length; position += 1) {
    const char = source[position];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return `${source.slice(0, start + 1)}\n${body}\n${source.slice(position)}`;
    }
  }

  throw new Error(`No se pudo cerrar la funcion ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const source = fs.readFileSync(sourcePath, "utf8");
const importedState = Function(`return (${extractConstObject(source, "importedState").text})`)();

const now = new Date().toISOString();
const exampleRoutine = {
  id: "example-full-body-web",
  name: "Full Body de ejemplo",
  desc: "Rutina publica para probar series por peso, tiempo y peso corporal.",
  icon: "🟠",
  exercises: [
    {
      id: "example-squat",
      name: "Sentadilla goblet",
      type: "weight",
      sets: [
        { reps: 10, weight: 16, done: false },
        { reps: 10, weight: 16, done: false },
        { reps: 10, weight: 16, done: false },
      ],
      notes: "Ejemplo de ejercicio con peso externo.",
    },
    {
      id: "example-push-up",
      name: "Flexiones",
      type: "bodyweight",
      sets: [
        { reps: 8, weight: 0, done: false },
        { reps: 8, weight: 0, done: false },
        { reps: 8, weight: 0, done: false },
      ],
      notes: "Ejemplo de peso corporal.",
    },
    {
      id: "example-plank",
      name: "Plancha",
      type: "time",
      sets: [
        { reps: 45, weight: 0, done: false },
        { reps: 45, weight: 0, done: false },
        { reps: 45, weight: 0, done: false },
      ],
      notes: "Ejemplo de ejercicio por tiempo. Usa los segundos como objetivo.",
    },
  ],
  createdAt: now,
  updatedAt: now,
};

const publicState = clone(importedState);
publicState.routines = [exampleRoutine];
publicState.workoutLog = [];
publicState.deletedWorkoutLog = [];
publicState.weightLog = [];
publicState.bodyWeightLog = [];
publicState.notes = {};
publicState.noteSections = [];
publicState.notesSections = [];
publicState.customNotes = [];
publicState.activeWorkout = null;
publicState.settings = {
  ...(publicState.settings || {}),
  notesSections: [],
  notesText: "",
  lastDriveBackup: null,
  driveBackupCount: 0,
  googleHealthConnected: false,
  fitbitConnected: false,
  cloudSyncEnabled: false,
};

let output = source;
output = replaceConstObject(output, "importedState", publicState);
output = replaceConstArray(output, "NOTES_ROUTINE_LINKS", []);
output = replaceConstArray(output, "DEFAULT_NOTES_SECTIONS", []);
output = output.replace(/const DEFAULT_NOTES_TEXT = `[\s\S]*?`;/, "const DEFAULT_NOTES_TEXT = ``;");
output = output.replace("const STORAGE_KEY = 'gymlog-ramon-state-v1';", "const STORAGE_KEY = 'gymlog-web-state-v3';");
output = output.replace("const THEME_KEY = 'gymlog-ramon-theme-v1';", "const THEME_KEY = 'gymlog-web-theme-v3';");
output = output.replace("const IMPORT_VERSION = 'gymlog-ramon-import-v1';", "const IMPORT_VERSION = 'gymlog-web-import-v3';");
output = output.replace("const ACTIVE_WORKOUT_KEY = 'gymlog-ramon-active-workout-v1';", "const ACTIVE_WORKOUT_KEY = 'gymlog-web-active-workout-v3';");
output = output.replace("const LEGACY_STORAGE_KEYS = ['gymlog2-export-1777218631114'];", "const LEGACY_STORAGE_KEYS = [];");
output = output.replace("const LEGACY_THEME_KEYS = ['gymlog-theme-export-1777218631114'];", "const LEGACY_THEME_KEYS = [];");
output = output.replace("const GYMLOG_SUPABASE_URL = 'https://qserywqzvluqfrnyeggz.supabase.co';", "const GYMLOG_SUPABASE_URL = 'https://tnuohiyrwnoqsnxyfonn.supabase.co';");
output = output.replace("const GYMLOG_SUPABASE_KEY = 'sb_publishable_l25PyMak_ttZ9ElV_FilPw_1J8lFZma';", "const GYMLOG_SUPABASE_KEY = 'sb_publishable__hfnlx_lrL6XI05FZyITLA_L6aUzK2A';");
output = output.replace("if('serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)){", "if(false && 'serviceWorker' in navigator && /^https?:$/.test(window.location.protocol)){");
output = output.replace("initializeGymLogCloud();", "// initializeGymLogCloud(); // Disabled in GymLog-Web until web cloud sync is adapted.");
output = output.replace(".replace(/const STORAGE_KEY = '[^']+';/, `const STORAGE_KEY = 'gymlog-ramon-state-v1';`)", ".replace(/const STORAGE_KEY = '[^']+';/, `const STORAGE_KEY = 'gymlog-web-state-v3';`)");
output = output.replace(".replace(/const THEME_KEY = '[^']+';/, `const THEME_KEY = 'gymlog-ramon-theme-v1';`)", ".replace(/const THEME_KEY = '[^']+';/, `const THEME_KEY = 'gymlog-web-theme-v3';`)");
output = output.replace(".replace(/const IMPORT_VERSION = '[^']+';/, `const IMPORT_VERSION = 'gymlog-ramon-import-v1';`)", ".replace(/const IMPORT_VERSION = '[^']+';/, `const IMPORT_VERSION = 'gymlog-web-import-v3';`)");
output = output.replace(/<div class="health-connect-card">[\s\S]*?<div class="backup-card" style="margin-bottom:12px; align-items:stretch">/, `<div class="backup-card" style="margin-bottom:12px; align-items:stretch">
      <div>
        <div class="chart-title" style="margin:0">Cuenta y sincronizacion web</div>
        <div class="backup-copy">Proximamente: iniciar sesion para guardar tus datos privados en la nube y recuperarlos en cualquier dispositivo.</div>
      </div>
    </div>

    <div class="backup-card" style="margin-bottom:12px; align-items:stretch">`);
output = output.replace("Resumen rapido de copias, sincronizacion y sesiones recuperables.", "Resumen rapido de datos locales y sesiones eliminadas.");
output = output.replace("Guarda o restaura todas tus rutinas, historial, peso, progreso, temas y datos de la app.", "Exporta o importa tus datos locales mientras terminamos la sincronizacion web.");
output = output.replace("Exportar HTML completo", "Exportar HTML completo (avanzado)");
output = output.replace("Sincronizar rutinas publicadas", "Recargar ejemplo publicado");
output = output.replace("gymlog-ramon-backup-", "gymlog-web-backup-");
output = output.replace(/<button class="ghost-btn" onclick="resetAllNotesTemplate\(\)">Restaurar plantilla<\/button>/, "");
[
  ["workoutRoutineGrid", ""],
  ["previewContent", ""],
  ["activeName", "Entrenamiento"],
  ["activeSessionPill", ""],
  ["activeExercises", ""],
  ["routinesList", ""],
  ["calGrid", ""],
  ["calDetail", ""],
  ["progressRoutineFilter", "<option value=\"all\">Todas</option>"],
  ["progressExerciseFilter", "<option value=\"all\">Todos</option>"],
  ["progressSummaryList", ""],
  ["progressHeatmap", ""],
  ["progressHeatmapList", ""],
  ["progressRecords", ""],
  ["topRoutines", ""],
  ["topExercises", ""],
  ["logList", ""],
  ["notesSections", ""],
].forEach(([id, replacement]) => {
  output = replaceElementInnerById(output, id, replacement);
});
output = output.replace('onclick="loadDriveBackups()">Actualizar</button>', 'onclick="renderSecurityStatus()">Actualizar</button>');
output = replaceFunctionBody(output, "renderSecurityStatus", `  const grid = document.getElementById('securityStatusGrid');
  if(!grid) return;
  pruneDeletedWorkoutLog();
  const sessionCount = state.workoutLog?.length || 0;
  const trashCount = state.deletedWorkoutLog?.length || 0;
  const items = [
    ['Cuenta web', 'Pendiente de diseno', 'warn'],
    ['Datos locales', sessionCount ? sessionCount + ' sesiones' : 'Sin historial', 'ok'],
    ['Rutinas', (state.routines?.length || 0) + ' disponibles', 'ok'],
    ['Papelera', trashCount ? trashCount + ' recuperables' : 'Vacia', trashCount ? 'warn' : 'ok']
  ];
  grid.innerHTML = items.map(([label,value,cls]) => \`<div class="security-item"><span>\${label}</span><strong class="\${cls}">\${value}</strong></div>\`).join('');`);
output = output.replace(/<body>/, `<body>
<style id="gymlog-web-boot-cleanup">
  #phase-grid, #previewContent, #activeExercises, #routinesList, #logList, #notesContent, #notesSections { visibility: hidden; }
</style>`);
output = output.replace("if(!restoreActiveWorkout()) renderWorkoutGrid();", "if(!restoreActiveWorkout()) renderWorkoutGrid(); document.getElementById('gymlog-web-boot-cleanup')?.remove();");
output = output.replace(/[ \t]+$/gm, "");

fs.writeFileSync(targetPath, output, "utf8");

console.log(`Generated ${targetPath}`);
console.log(`Public routines: ${publicState.routines.length}`);
console.log(`Public workout log: ${publicState.workoutLog.length}`);
