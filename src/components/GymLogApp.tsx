"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity,
  Check,
  Cloud,
  Download,
  Dumbbell,
  History,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { createEmptyGymLogState, normalizeGymLogState, uid } from "@/lib/example-data";
import { loadLocalState, saveLocalState } from "@/lib/local-store";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { ActiveWorkout, GymLogState, Routine, WorkoutSet } from "@/lib/types";

type Tab = "rutinas" | "entreno" | "historial" | "progreso" | "ajustes";

const tabLabels: Record<Tab, string> = {
  rutinas: "Rutinas",
  entreno: "Entreno",
  historial: "Historial",
  progreso: "Progreso",
  ajustes: "Ajustes",
};

function tabIcon(tab: Tab) {
  switch (tab) {
    case "rutinas":
      return <Dumbbell size={16} />;
    case "entreno":
      return <Play size={16} />;
    case "historial":
      return <History size={16} />;
    case "progreso":
      return <Activity size={16} />;
    case "ajustes":
      return <Settings size={16} />;
  }
}

export function GymLogApp() {
  const [state, setState] = useState<GymLogState>(() => createEmptyGymLogState());
  const [activeTab, setActiveTab] = useState<Tab>("rutinas");
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState("Datos locales listos.");
  const [routineName, setRoutineName] = useState("");
  const [routineDescription, setRoutineDescription] = useState("");
  const [routineLines, setRoutineLines] = useState("Dominadas\nPeso muerto rumano\nPress militar");
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setState(loadLocalState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveLocalState(state);
  }, [state, hydrated]);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) void loadCloudState(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) void loadCloudState(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const stats = useMemo(() => {
    const totalSets = state.sessions.reduce((sum, sessionItem) => sum + sessionItem.sets.length, 0);
    const volume = state.sessions.reduce(
      (sum, sessionItem) =>
        sum +
        sessionItem.sets.reduce(
          (setSum, set) => setSum + (set.done ? set.reps * set.weight : 0),
          0,
        ),
      0,
    );
    const latest = state.sessions
      .slice()
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];

    return {
      sessions: state.sessions.length,
      routines: state.routines.length,
      sets: totalSets,
      volume,
      latest,
    };
  }, [state.sessions, state.routines.length]);

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("es-ES", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      }).format(new Date()),
    [],
  );

  async function loadCloudState(activeSession = session) {
    if (!supabase || !activeSession) return;
    setStatus("Leyendo datos de Supabase...");

    const { data, error } = await supabase
      .from("gymlog_user_state")
      .select("data")
      .eq("user_id", activeSession.user.id)
      .maybeSingle();

    if (error) {
      setStatus(`No se pudo leer Supabase: ${error.message}`);
      return;
    }

    if (data?.data) {
      const remote = normalizeGymLogState(data.data);
      setState(remote);
      saveLocalState(remote);
      setStatus("Datos cargados desde Supabase.");
      return;
    }

    setStatus("Cuenta conectada. Todavia no hay datos remotos.");
  }

  async function saveCloudState() {
    if (!supabase || !session) {
      setStatus("Configura Supabase e inicia sesion para sincronizar.");
      return;
    }

    const nextState = {
      ...state,
      settings: { ...state.settings, lastSyncedAt: new Date().toISOString() },
    };

    const { error } = await supabase.from("gymlog_user_state").upsert({
      user_id: session.user.id,
      data: nextState,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setStatus(`No se pudo guardar en Supabase: ${error.message}`);
      return;
    }

    setState(nextState);
    setStatus("Datos guardados en Supabase.");
  }

  async function signInWithEmail() {
    if (!supabase) return setStatus("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    if (!email.trim()) return setStatus("Introduce un email.");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });

    setStatus(error ? error.message : "Codigo enviado. Revisa el email.");
  }

  async function verifyEmailCode() {
    if (!supabase) return;
    if (!email.trim() || !otp.trim()) return setStatus("Introduce email y codigo.");

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.replace(/\s/g, ""),
      type: "email",
    });

    setStatus(error ? error.message : "Sesion iniciada.");
    if (!error) setOtp("");
  }

  async function signInWithGoogle() {
    if (!supabase) return setStatus("Faltan variables de Supabase.");

    const redirectTo = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) setStatus(error.message);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setStatus("Sesion cerrada. Sigues teniendo la copia local.");
  }

  function addRoutine() {
    const lines = routineLines
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!routineName.trim() || !lines.length) {
      setStatus("Pon nombre y al menos un ejercicio.");
      return;
    }

    const now = new Date().toISOString();
    const routine: Routine = {
      id: uid("routine"),
      name: routineName.trim(),
      description: routineDescription.trim(),
      createdAt: now,
      updatedAt: now,
      exercises: lines.map((line) => ({
        id: uid("exercise"),
        name: line,
        type: "weight",
        defaultSeries: 3,
        defaultReps: 10,
        defaultWeight: 0,
        restSeconds: 90,
      })),
    };

    setState((current) => ({ ...current, routines: [routine, ...current.routines] }));
    setRoutineName("");
    setRoutineDescription("");
    setRoutineLines("Dominadas\nPeso muerto rumano\nPress militar");
    setStatus("Rutina creada.");
  }

  function removeRoutine(id: string) {
    setState((current) => ({
      ...current,
      routines: current.routines.filter((routine) => routine.id !== id),
    }));
    setStatus("Rutina eliminada.");
  }

  function startRoutine(routine: Routine) {
    const sets: WorkoutSet[] = routine.exercises.flatMap((exercise) =>
      Array.from({ length: exercise.defaultSeries }, () => ({
        id: uid("set"),
        exerciseId: exercise.id,
        reps: exercise.defaultReps,
        weight: exercise.defaultWeight,
        done: false,
      })),
    );

    setActiveWorkout({ routine, startedAt: new Date().toISOString(), sets });
    setActiveTab("entreno");
    setStatus(`Entreno iniciado: ${routine.name}.`);
  }

  function updateSet(setId: string, patch: Partial<WorkoutSet>) {
    setActiveWorkout((current) =>
      current
        ? {
            ...current,
            sets: current.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)),
          }
        : current,
    );
  }

  function completeWorkout() {
    if (!activeWorkout) return;

    const completedAt = new Date().toISOString();
    const completedSets = activeWorkout.sets.filter((set) => set.done);
    if (!completedSets.length) {
      setStatus("Marca al menos una serie como hecha.");
      return;
    }

    setState((current) => ({
      ...current,
      sessions: [
        {
          id: uid("session"),
          routineId: activeWorkout.routine.id,
          routineName: activeWorkout.routine.name,
          startedAt: activeWorkout.startedAt,
          completedAt,
          durationSeconds: Math.max(
            60,
            Math.round((new Date(completedAt).getTime() - new Date(activeWorkout.startedAt).getTime()) / 1000),
          ),
          sets: completedSets,
        },
        ...current.sessions,
      ],
    }));
    setActiveWorkout(null);
    setActiveTab("historial");
    setStatus("Entreno guardado.");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `gymlog-web-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  function importJson(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeGymLogState(JSON.parse(String(reader.result)));
        setState(imported);
        setStatus("JSON importado.");
      } catch {
        setStatus("No se pudo importar el JSON.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <div className="brand-mark">
              <Dumbbell size={20} />
            </div>
            <div>
              <div className="brand-title">
                GYM<span>LOG</span>
              </div>
              <div className="brand-subtitle">Tu entrenamiento</div>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="date-badge">{todayLabel}</div>
            <div className={session ? "status good" : "status"}>
              {session ? `Conectado: ${session.user.email}` : "Modo local"}
            </div>
          </div>
        </div>
      </header>

      <section className="container hero">
        <div className="hero-main">
          <div className="section-title">Panel de entrenamiento</div>
          <h1 className="hero-title">Rutinas listas, historial limpio.</h1>
          <p className="hero-copy">{status}</p>
          <div className="quick-stats">
            <span>{stats.routines} rutinas</span>
            <span>{stats.sessions} sesiones</span>
            <span>{stats.sets} series</span>
          </div>
        </div>
        <section className="panel dark">
          <h2 className="panel-title">Estado de cuenta</h2>
          <p className="panel-copy">
            {isSupabaseConfigured
              ? "Supabase configurado. Puedes iniciar sesion y guardar datos remotos."
              : "Supabase pendiente. La app funciona en local y ya esta lista para conectar el proyecto."}
          </p>
          <div className="form-row">
            <div className="field">
              <label>Email</label>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@email.com" />
            </div>
            <div className="toolbar">
              <button className="button accent" onClick={signInWithEmail}>
                <Cloud size={16} /> Enviar codigo
              </button>
              <button className="button" onClick={signInWithGoogle}>
                Google
              </button>
            </div>
            <div className="field">
              <label>Codigo</label>
              <input value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="123456" />
            </div>
            <div className="toolbar">
              <button className="button primary" onClick={verifyEmailCode}>
                Verificar
              </button>
              {session ? (
                <button className="button" onClick={signOut}>
                  <LogOut size={16} /> Salir
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </section>

      <section className="container grid three">
        <div className="panel stat">
          <h2 className="panel-title">Sesiones</h2>
          <div className="stat-value">{stats.sessions}</div>
        </div>
        <div className="panel stat">
          <h2 className="panel-title">Series</h2>
          <div className="stat-value">{stats.sets}</div>
        </div>
        <div className="panel stat">
          <h2 className="panel-title">Volumen</h2>
          <div className="stat-value">{Math.round(stats.volume)} kg</div>
        </div>
      </section>

      <section className="container">
        <nav className="tabs" aria-label="Secciones de GymLog">
          {(Object.keys(tabLabels) as Tab[]).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "tab active" : "tab"}
              onClick={() => setActiveTab(tab)}
            >
              {tabIcon(tab)}
              {tabLabels[tab]}
            </button>
          ))}
        </nav>

        {activeTab === "rutinas" ? (
          <div className="grid two">
            <section className="card-list">
              {state.routines.map((routine) => (
                <article className="routine-card" key={routine.id}>
                  <div className="routine-head">
                    <div>
                      <h2 className="routine-title">{routine.name}</h2>
                      <div className="meta">{routine.description || "Sin descripcion"}</div>
                    </div>
                    <div className="toolbar">
                      <button className="icon-button" title="Empezar rutina" onClick={() => startRoutine(routine)}>
                        <Play size={18} />
                      </button>
                      {!routine.isExample ? (
                        <button className="icon-button" title="Eliminar rutina" onClick={() => removeRoutine(routine.id)}>
                          <Trash2 size={18} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="chips">
                    {routine.exercises.map((exercise) => (
                      <span className="chip" key={exercise.id}>
                        {exercise.name} · {exercise.defaultSeries}x{exercise.defaultReps}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </section>

            <section className="panel">
              <h2 className="panel-title">Crear rutina rapida</h2>
              <p className="panel-copy">Una linea por ejercicio. Luego se podra evolucionar a editor completo.</p>
              <div className="form-row">
                <div className="field">
                  <label>Nombre</label>
                  <input value={routineName} onChange={(event) => setRoutineName(event.target.value)} />
                </div>
                <div className="field">
                  <label>Descripcion</label>
                  <input value={routineDescription} onChange={(event) => setRoutineDescription(event.target.value)} />
                </div>
                <div className="field">
                  <label>Ejercicios</label>
                  <textarea value={routineLines} onChange={(event) => setRoutineLines(event.target.value)} />
                </div>
                <button className="button primary" onClick={addRoutine}>
                  <Plus size={16} /> Crear rutina
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "entreno" ? (
          <section className={activeWorkout ? "panel active-workout" : "panel"}>
            {activeWorkout ? (
              <>
                <div className="toolbar">
                  <div>
                    <h2 className="panel-title">{activeWorkout.routine.name}</h2>
                    <p className="panel-copy">Marca las series hechas y ajusta reps/peso antes de guardar.</p>
                  </div>
                  <button className="button accent" onClick={completeWorkout}>
                    <Save size={16} /> Guardar sesion
                  </button>
                </div>
                <div className="card-list" style={{ marginTop: 16 }}>
                  {activeWorkout.routine.exercises.map((exercise) => (
                    <div key={exercise.id}>
                      <h3 className="routine-title">{exercise.name}</h3>
                      <div className="card-list" style={{ marginTop: 8 }}>
                        {activeWorkout.sets
                          .filter((set) => set.exerciseId === exercise.id)
                          .map((set, index) => (
                            <div className="set-row" key={set.id}>
                              <strong>Serie {index + 1}</strong>
                              <input
                                type="number"
                                min="0"
                                value={set.reps}
                                onChange={(event) => updateSet(set.id, { reps: Number(event.target.value) })}
                                aria-label="Repeticiones"
                              />
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                value={set.weight}
                                onChange={(event) => updateSet(set.id, { weight: Number(event.target.value) })}
                                aria-label="Peso"
                              />
                              <button
                                className={set.done ? "icon-button button primary" : "icon-button"}
                                title="Marcar serie"
                                onClick={() => updateSet(set.id, { done: !set.done })}
                              >
                                <Check size={18} />
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty">Elige una rutina y pulsa empezar.</div>
            )}
          </section>
        ) : null}

        {activeTab === "historial" ? (
          <section className="card-list">
            {state.sessions.length ? (
              state.sessions.map((sessionItem) => (
                <article className="session-card" key={sessionItem.id}>
                  <div className="session-head">
                    <div>
                      <h2 className="session-title">{sessionItem.routineName}</h2>
                      <div className="meta">
                        {new Date(sessionItem.completedAt).toLocaleString("es-ES")} ·{" "}
                        {Math.round(sessionItem.durationSeconds / 60)} min
                      </div>
                    </div>
                    <span className="chip">{sessionItem.sets.length} series</span>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty">
                Historial vacio. La rutina de ejemplo no mete datos falsos en tu progreso.
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "progreso" ? (
          <section className="grid two">
            <article className="panel">
              <h2 className="panel-title">Resumen</h2>
              <p className="panel-copy">
                Ultima sesion: {stats.latest ? stats.latest.routineName : "todavia sin sesiones"}.
              </p>
              <div className="chips">
                <span className="chip">{stats.routines} rutinas</span>
                <span className="chip">{stats.sessions} sesiones</span>
                <span className="chip">{Math.round(stats.volume)} kg movidos</span>
              </div>
            </article>
            <article className="panel">
              <h2 className="panel-title">Siguiente mejora</h2>
              <p className="panel-copy">
                Aqui encajan graficas por ejercicio, marcas personales, peso corporal y tendencias semanales.
              </p>
            </article>
          </section>
        ) : null}

        {activeTab === "ajustes" ? (
          <section className="grid two">
            <article className="panel">
              <h2 className="panel-title">Sincronizacion</h2>
              <p className="panel-copy">{status}</p>
              <div className="toolbar" style={{ marginTop: 14 }}>
                <button className="button primary" onClick={saveCloudState}>
                  <Cloud size={16} /> Guardar nube
                </button>
                <button className="button" onClick={() => void loadCloudState()}>
                  <RefreshCw size={16} /> Leer nube
                </button>
              </div>
            </article>
            <article className="panel">
              <h2 className="panel-title">Copias JSON</h2>
              <p className="panel-copy">
                Exportar e importar sigue disponible aunque Supabase no este configurado.
              </p>
              <div className="toolbar" style={{ marginTop: 14 }}>
                <button className="button" onClick={exportJson}>
                  <Download size={16} /> Exportar
                </button>
                <button className="button" onClick={() => fileRef.current?.click()}>
                  <Upload size={16} /> Importar
                </button>
              </div>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="application/json"
                onChange={(event) => importJson(event.target.files?.[0])}
              />
            </article>
          </section>
        ) : null}
      </section>

      <footer className="container footer-note">
        <Dumbbell size={16} style={{ verticalAlign: "middle" }} /> GymLog-Web es independiente de Gym-app.
        La app original sigue intacta.
      </footer>
    </main>
  );
}
