import type { GymLogState, Routine } from "./types";

export function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createExampleRoutine(): Routine {
  const now = new Date().toISOString();

  return {
    id: "routine-example-full-body",
    name: "Full body de ejemplo",
    description: "Rutina inicial para ver como se registra una sesion.",
    isExample: true,
    createdAt: now,
    updatedAt: now,
    exercises: [
      {
        id: "exercise-example-squat",
        name: "Sentadilla",
        type: "weight",
        defaultSeries: 3,
        defaultReps: 8,
        defaultWeight: 40,
        restSeconds: 120,
      },
      {
        id: "exercise-example-bench",
        name: "Press banca",
        type: "weight",
        defaultSeries: 3,
        defaultReps: 8,
        defaultWeight: 30,
        restSeconds: 120,
      },
      {
        id: "exercise-example-row",
        name: "Remo con mancuerna",
        type: "weight",
        defaultSeries: 3,
        defaultReps: 10,
        defaultWeight: 18,
        restSeconds: 90,
      },
      {
        id: "exercise-example-plank",
        name: "Plancha",
        type: "time",
        defaultSeries: 3,
        defaultReps: 45,
        defaultWeight: 0,
        restSeconds: 60,
      },
    ],
  };
}

export function createEmptyGymLogState(): GymLogState {
  return {
    version: 1,
    routines: [createExampleRoutine()],
    sessions: [],
    bodyWeight: [],
    settings: {
      units: "kg",
      theme: "system",
    },
  };
}

export function normalizeGymLogState(value: unknown): GymLogState {
  const fallback = createEmptyGymLogState();
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as Partial<GymLogState>;
  return {
    version: 1,
    routines: Array.isArray(candidate.routines) && candidate.routines.length
      ? candidate.routines
      : fallback.routines,
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions : [],
    bodyWeight: Array.isArray(candidate.bodyWeight) ? candidate.bodyWeight : [],
    settings: {
      units: "kg",
      theme: candidate.settings?.theme ?? "system",
      lastSyncedAt: candidate.settings?.lastSyncedAt,
    },
  };
}
