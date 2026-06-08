export type ExerciseType = "weight" | "bodyweight" | "time";

export type RoutineExercise = {
  id: string;
  name: string;
  type: ExerciseType;
  defaultSeries: number;
  defaultReps: number;
  defaultWeight: number;
  restSeconds: number;
  notes?: string;
};

export type Routine = {
  id: string;
  name: string;
  description: string;
  isExample?: boolean;
  exercises: RoutineExercise[];
  createdAt: string;
  updatedAt: string;
};

export type WorkoutSet = {
  id: string;
  exerciseId: string;
  reps: number;
  weight: number;
  done: boolean;
};

export type WorkoutSession = {
  id: string;
  routineId: string;
  routineName: string;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  sets: WorkoutSet[];
  notes?: string;
};

export type BodyWeightEntry = {
  id: string;
  date: string;
  weight: number;
};

export type GymLogState = {
  version: 1;
  routines: Routine[];
  sessions: WorkoutSession[];
  bodyWeight: BodyWeightEntry[];
  settings: {
    units: "kg";
    theme: "system" | "dark" | "light";
    lastSyncedAt?: string;
  };
};

export type ActiveWorkout = {
  routine: Routine;
  startedAt: string;
  sets: WorkoutSet[];
};
