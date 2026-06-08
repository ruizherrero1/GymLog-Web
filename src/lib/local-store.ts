import { createEmptyGymLogState, normalizeGymLogState } from "./example-data";
import type { GymLogState } from "./types";

const STORAGE_KEY = "gymlog-web-state-v1";

export function loadLocalState(): GymLogState {
  if (typeof window === "undefined") return createEmptyGymLogState();

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeGymLogState(JSON.parse(stored)) : createEmptyGymLogState();
  } catch {
    return createEmptyGymLogState();
  }
}

export function saveLocalState(state: GymLogState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
