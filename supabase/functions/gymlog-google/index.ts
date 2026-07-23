const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GOOGLE_REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI")!;
const GYMLOG_APP_URL = Deno.env.get("GYMLOG_APP_URL")!;
const GYMLOG_OWNER_EMAIL = (Deno.env.get("GYMLOG_OWNER_EMAIL") || "").toLowerCase();
const GYMLOG_DRIVE_PARENT_FOLDER_ID = Deno.env.get("GYMLOG_DRIVE_PARENT_FOLDER_ID") || "";
const GYMLOG_BACKUP_PREFIX = "gymlog-ramon-backup-";
const GYMLOG_BACKUP_KEEP = 5;
const GOOGLE_HEALTH_BASE = "https://health.googleapis.com/v4/users/me/dataTypes";
const HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
].join(" ");
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type WorkoutSession = {
  localId: string;
  name: string;
  type: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  utcOffset?: string;
  rpe?: number | null;
  note?: string;
  totalSets?: number;
  completedSets?: number;
  totalReps?: number;
  totalVolumeKg?: number;
  maxHeartRate?: number | null;
  exercises?: Array<{
    name: string;
    completedSets?: number;
    totalSets?: number;
    totalReps?: number;
    topWeightKg?: number;
    durationSeconds?: number;
  }>;
};
type AppUser = {
  id: string;
  email?: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url, ...cors } });
}
function actionFromRequest(req: Request): string {
  const pieces = new URL(req.url).pathname.split("/").filter(Boolean);
  return pieces[pieces.length - 1] === "gymlog-google" ? "" : pieces[pieces.length - 1];
}
function stableDataPointName(session: WorkoutSession): string {
  const id = `gymlog-${session.localId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
  return `users/me/dataTypes/exercise/dataPoints/${id}`;
}
function toSeconds(value?: number): string {
  return `${Math.max(0, Math.round(value || 0))}s`;
}
function normalizeExerciseType(value?: string): string {
  const type = String(value || "").toUpperCase();
  return ["BIKING", "STRENGTH_TRAINING", "BODY_WEIGHT", "CALISTHENICS"].includes(type) ? type : "STRENGTH_TRAINING";
}
function cleanText(value: unknown, limit = 500): string {
  const flattened = String(value || "")
    .replaceAll(String.fromCharCode(10), " ")
    .replaceAll(String.fromCharCode(13), " ")
    .replaceAll(String.fromCharCode(9), " ");
  return flattened.split(" ").filter(Boolean).join(" ").trim().slice(0, limit);
}
function exerciseNotes(session: WorkoutSession, metrics?: Record<string, unknown>): string {
  const lines = ["Registrado desde GymLog."];
  if (session.completedSets || session.totalSets) lines.push(`Series: ${Math.max(0, Number(session.completedSets) || 0)}/${Math.max(0, Number(session.totalSets) || 0)}.`);
  if (session.totalReps) lines.push(`Repeticiones: ${Math.max(0, Math.round(session.totalReps))}.`);
  if (session.totalVolumeKg) lines.push(`Volumen: ${Math.round(session.totalVolumeKg)} kg.`);
  if (Number.isFinite(Number(session.rpe))) lines.push(`Esfuerzo percibido (RPE): ${Math.min(10, Math.max(1, Math.round(Number(session.rpe))))}/10.`);
  if (Number.isFinite(Number(metrics?.maxHeartRate)) && Number(metrics?.maxHeartRate) >= 40) lines.push(`FC maxima: ${Math.round(Number(metrics?.maxHeartRate))} bpm.`);
  const exerciseNames = (session.exercises || []).map((item) => cleanText(item.name, 60)).filter(Boolean);
  if (exerciseNames.length) lines.push(`Ejercicios: ${exerciseNames.slice(0, 12).join(", ")}.`);
  if (cleanText(session.note, 240)) lines.push(`Nota: ${cleanText(session.note, 240)}`);
  return lines.join(String.fromCharCode(10)).slice(0, 1000);
}
function sampleTime(sample: { time?: string }): number {
  const value = Date.parse(sample.time || "");
  return Number.isFinite(value) ? value : 0;
}
function computedHeartRateZones(samples: Array<{ bpm: number; time: string }>, maxHeartRate?: number | null): Record<string, string> | null {
  const max = Number(maxHeartRate);
  const timed = samples.filter((sample) => sampleTime(sample) > 0).sort((a, b) => sampleTime(a) - sampleTime(b));
  if (!Number.isFinite(max) || max < 100 || timed.length < 2) return null;
  const totals = { light: 0, moderate: 0, vigorous: 0, peak: 0 };
  for (let index = 0; index < timed.length - 1; index += 1) {
    const seconds = Math.min(60, Math.max(0, (sampleTime(timed[index + 1]) - sampleTime(timed[index])) / 1000));
    const ratio = timed[index].bpm / max;
    if (ratio >= 0.9) totals.peak += seconds;
    else if (ratio >= 0.8) totals.vigorous += seconds;
    else if (ratio >= 0.7) totals.moderate += seconds;
    else if (ratio >= 0.6) totals.light += seconds;
  }
  if (!Object.values(totals).some((value) => value > 0)) return null;
  return { lightTime: toSeconds(totals.light), moderateTime: toSeconds(totals.moderate), vigorousTime: toSeconds(totals.vigorous), peakTime: toSeconds(totals.peak) };
}
function exercisePointBody(session: WorkoutSession, metrics: Record<string, unknown> = {}, existingSummary: Record<string, unknown> = {}) {
  const summary: Record<string, unknown> = { ...existingSummary };
  const average = Number(metrics.averageHeartRate);
  const calories = Number(metrics.calories);
  const activeZoneMinutes = Number(metrics.activeZoneMinutes);
  if (Number.isFinite(average) && average >= 40) summary.averageHeartRateBeatsPerMinute = String(Math.round(average));
  if (Number.isFinite(calories) && calories > 0) summary.caloriesKcal = calories;
  if (Number.isFinite(activeZoneMinutes) && activeZoneMinutes > 0) summary.activeZoneMinutes = String(Math.round(activeZoneMinutes));
  if (metrics.heartRateZoneDurations) summary.heartRateZoneDurations = metrics.heartRateZoneDurations;
  return {
    name: stableDataPointName(session),
    exercise: {
      interval: { startTime: session.startTime, startUtcOffset: session.utcOffset || "0s", endTime: session.endTime, endUtcOffset: session.utcOffset || "0s" },
      exerciseType: normalizeExerciseType(session.type),
      displayName: `GymLog - ${cleanText(session.name, 90) || "Entrenamiento"}`,
      activeDuration: toSeconds(session.durationSeconds),
      metricsSummary: summary,
      notes: exerciseNotes(session, metrics),
      exerciseEvents: [
        { eventTime: session.startTime, eventUtcOffset: session.utcOffset || "0s", exerciseEventType: "START" },
        { eventTime: session.endTime, eventUtcOffset: session.utcOffset || "0s", exerciseEventType: "STOP" },
      ],
    },
  };
}

function dbQuery(params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return query.toString() ? `?${query}` : "";
}
async function dbRequest(table: string, query: Record<string, string> = {}, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${dbQuery(query)}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.hint || data?.error_description || `Base de datos: ${response.status}`;
    throw new Error(message);
  }
  return data;
}
async function authenticatedUser(req: Request): Promise<AppUser> {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Error("Falta iniciar sesion en GymLog.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization },
  });
  const user = await response.json().catch(() => null) as AppUser | null;
  if (!response.ok || !user?.id) throw new Error("Sesion de GymLog no valida.");
  if (GYMLOG_OWNER_EMAIL && (user.email || "").toLowerCase() !== GYMLOG_OWNER_EMAIL) {
    throw new Error("Esta integracion es privada.");
  }
  return user;
}

async function readConnection(userId: string) {
  const rows = await dbRequest("gymlog_google_connections", {
    select: "*",
    user_id: `eq.${userId}`,
    limit: "1",
  }, { method: "GET" }) as Array<Record<string, unknown>>;
  return rows?.[0] || null;
}

async function exchangeToken(params: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Google no pudo conceder acceso.");
  return data;
}

async function healthAccessTokenFor(userId: string): Promise<{ token: string; connection: Record<string, unknown> }> {
  const connection = await readConnection(userId);
  if (!connection?.google_health_refresh_token) throw new Error("Vuelve a conectar Google Health.");
  try {
    const token = await exchangeToken(new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: String(connection.google_health_refresh_token),
      grant_type: "refresh_token",
    }));
    return { token: token.access_token, connection };
  } catch (_error) {
    throw new Error("La conexion de Google Health ha caducado. Pulsa Reconectar Google Health.");
  }
}

async function driveAccessTokenFor(userId: string): Promise<{ token: string; connection: Record<string, unknown> }> {
  const connection = await readConnection(userId);
  if (!connection?.google_refresh_token) throw new Error("Google Drive no esta conectado.");
  try {
    const token = await exchangeToken(new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: String(connection.google_refresh_token),
      grant_type: "refresh_token",
    }));
    return { token: token.access_token, connection };
  } catch (_error) {
    throw new Error("La conexion de Google Drive ha caducado. Pulsa Reconectar Google Drive.");
  }
}

async function googleRequest(accessToken: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error_description || `Google API: ${response.status}`);
  return data;
}

function backupFileName(reason = "auto"): string {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");
  const safeReason = reason.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 24) || "auto";
  return `${GYMLOG_BACKUP_PREFIX}${stamp}-${safeReason}.json`;
}

function backupMetaFromState(backupState: unknown, reason = "auto") {
  const state = backupState as Record<string, unknown> | null;
  const workoutLog = Array.isArray(state?.workoutLog) ? state.workoutLog as Array<Record<string, unknown>> : [];
  const weightLog = Array.isArray(state?.weightLog) ? state.weightLog as Array<Record<string, unknown>> : [];
  const latestWorkoutDate = workoutLog
    .map((log) => String(log.completedAt || log.date || ""))
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  return {
    gymLogBackup: "true",
    createdAt: new Date().toISOString(),
    reason,
    sessionCount: String(workoutLog.length),
    weightCount: String(weightLog.length),
    latestWorkoutDate,
  };
}

async function listDriveBackupsWithToken(accessToken: string) {
  const query = [
    "trashed = false",
    "mimeType = 'application/json'",
    `name contains '${GYMLOG_BACKUP_PREFIX.slice(0, -1)}'`,
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    pageSize: "1000",
    orderBy: "createdTime desc",
    fields: "files(id,name,createdTime,modifiedTime,webViewLink,size,appProperties)",
  });
  const data = await googleRequest(accessToken, `https://www.googleapis.com/drive/v3/files?${params}`);
  const files = Array.isArray(data.files) ? data.files as Array<Record<string, unknown>> : [];
  return files.sort((a, b) => {
    const aTime = String((a.appProperties as Record<string, unknown> | undefined)?.createdAt || a.createdTime || "");
    const bTime = String((b.appProperties as Record<string, unknown> | undefined)?.createdAt || b.createdTime || "");
    return bTime.localeCompare(aTime);
  });
}

async function listDriveBackups(user: AppUser) {
  const { token } = await driveAccessTokenFor(user.id);
  return await listDriveBackupsWithToken(token);
}

async function rotateDriveBackups(accessToken: string) {
  const backups = await listDriveBackupsWithToken(accessToken);
  const stale = backups.slice(GYMLOG_BACKUP_KEEP);
  await Promise.all(stale.map((file) => fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch((error) => console.warn("No se pudo borrar backup antiguo", file.id, error))));
  return backups.slice(0, GYMLOG_BACKUP_KEEP);
}

async function beginAuthorization(user: AppUser, body: Record<string, unknown>) {
  const state = crypto.randomUUID();
  const proposedReturnTo = typeof body.returnTo === "string" ? body.returnTo : "";
  const allowedReturnTo = proposedReturnTo.startsWith("https://gym.ramonruizherrero.com/") ||
    proposedReturnTo.startsWith("https://ruizherrero1.github.io/") ||
    proposedReturnTo.startsWith("http://localhost:4173/") ||
    proposedReturnTo.startsWith("http://127.0.0.1:4173/");
  const returnTo = allowedReturnTo ? proposedReturnTo : GYMLOG_APP_URL;
  const purpose = body.purpose === "drive" ? "drive" : "health";
  const storedReturnTo = new URL(returnTo);
  storedReturnTo.searchParams.set("_gymlog_oauth", purpose);
  await dbRequest("gymlog_oauth_states", {}, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
    state,
    user_id: user.id,
    return_to: storedReturnTo.toString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
  });
  const query = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: purpose === "drive" ? DRIVE_SCOPES : HEALTH_SCOPES,
    access_type: "offline",
    include_granted_scopes: "false",
    prompt: "consent",
    state,
  });
  return { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
}

async function oauthCallback(url: URL) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new Error("Respuesta OAuth incompleta.");
  const pendingRows = await dbRequest("gymlog_oauth_states", {
    select: "*",
    state: `eq.${state}`,
    limit: "1",
  }, { method: "GET" }) as Array<Record<string, string>>;
  const pending = pendingRows?.[0];
  if (!pending || new Date(pending.expires_at).getTime() < Date.now()) throw new Error("Autorizacion caducada.");
  const destination = new URL(pending.return_to || GYMLOG_APP_URL);
  const purpose = destination.searchParams.get("_gymlog_oauth") === "drive" ? "drive" : "health";
  destination.searchParams.delete("_gymlog_oauth");
  const tokens = await exchangeToken(new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code,
    redirect_uri: GOOGLE_REDIRECT_URI,
    grant_type: "authorization_code",
  }));
  if (!tokens.refresh_token) throw new Error("Google no devolvio permiso permanente. Vuelve a conectar.");
  await dbRequest("gymlog_google_connections", { user_id: `eq.${pending.user_id}` }, {
    method: "PATCH",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(purpose === "drive" ? {
      google_refresh_token: tokens.refresh_token,
      google_scopes: tokens.scope || DRIVE_SCOPES,
      updated_at: new Date().toISOString(),
    } : {
      google_health_refresh_token: tokens.refresh_token,
      google_scopes: tokens.scope || HEALTH_SCOPES,
      updated_at: new Date().toISOString(),
    }),
  });
  await dbRequest("gymlog_oauth_states", { state: `eq.${state}` }, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  destination.searchParams.set(purpose === "drive" ? "google_drive" : "google_health", "connected");
  return redirect(destination.toString());
}

async function createExercise(user: AppUser, session: WorkoutSession) {
  const storedRows = await dbRequest("gymlog_synced_sessions", {
    select: "google_data_point_name",
    user_id: `eq.${user.id}`,
    local_id: `eq.${session.localId}`,
    limit: "1",
  }, { method: "GET" }) as Array<{ google_data_point_name?: string }>;
  if (storedRows?.[0]?.google_data_point_name) return storedRows[0].google_data_point_name;
  const { token } = await healthAccessTokenFor(user.id);
  const pointName = stableDataPointName(session);
  const exercisePoint = exercisePointBody(session);
  try {
    await googleRequest(token, `${GOOGLE_HEALTH_BASE}/exercise/dataPoints`, { method: "POST", body: JSON.stringify(exercisePoint) });
  } catch (error) {
    if (!String(error).includes("already exists") && !String(error).includes("409")) throw error;
  }
  await dbRequest("gymlog_synced_sessions", { on_conflict: "user_id,local_id" }, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: user.id,
      local_id: session.localId,
      google_data_point_name: pointName,
      synced_at: new Date().toISOString(),
    }),
  });
  return pointName;
}

async function metricsForSession(user: AppUser, session: WorkoutSession, pointName: string) {
  const { token } = await healthAccessTokenFor(user.id);
  let exercise: Record<string, unknown> = {};
  try {
    const point = await googleRequest(token, `https://health.googleapis.com/v4/${pointName}`);
    exercise = point.exercise || {};
  } catch (_error) {
    // Creation may still be settling; raw heart rate can nevertheless be queried.
  }
  const filter = `heart_rate.sample_time.physical_time >= "${session.startTime}" AND heart_rate.sample_time.physical_time < "${session.endTime}"`;
  let points: Array<Record<string, unknown>> = [];
  let metricsError = "";
  try {
    const heartRates = await googleRequest(token, `${GOOGLE_HEALTH_BASE}/heart-rate/dataPoints?filter=${encodeURIComponent(filter)}&pageSize=10000`);
    points = heartRates.dataPoints || [];
  } catch (error) {
    metricsError = error instanceof Error ? error.message : "No se pudo leer la frecuencia cardiaca.";
    points = [];
  }
  const heartRateSamples = points.map((point) => {
    const heartRate = point.heartRate as Record<string, unknown> | undefined;
    return heartRate ? {
      bpm: Number(heartRate.beatsPerMinute || 0),
      time: (heartRate.sampleTime as Record<string, unknown> | undefined)?.physicalTime ||
        (heartRate.sampleTime as Record<string, unknown> | undefined)?.time || "",
    } : null;
  }).filter((point) => point && point.bpm) as Array<{ bpm: number; time: string }>;
  const values = heartRateSamples.map((point) => point.bpm);
  const summary = (exercise.metricsSummary || {}) as Record<string, unknown>;
  const calculatedZones = computedHeartRateZones(heartRateSamples, session.maxHeartRate);
  const metrics = {
    averageHeartRate: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number(summary.averageHeartRateBeatsPerMinute || 0) || null,
    maxHeartRate: values.length ? Math.max(...values) : null,
    calories: Number(summary.caloriesKcal || 0) || null,
    activeZoneMinutes: Number(summary.activeZoneMinutes || 0) || null,
    heartRateZoneDurations: summary.heartRateZoneDurations || calculatedZones,
    heartRateSamples,
  };
  let googleSummaryUpdated = false;
  let googleSummaryError = "";
  try {
    await googleRequest(token, `https://health.googleapis.com/v4/${pointName}`, {
      method: "PATCH",
      body: JSON.stringify(exercisePointBody(session, metrics, summary)),
    });
    googleSummaryUpdated = true;
  } catch (error) {
    googleSummaryError = error instanceof Error ? error.message : "No se pudo completar el resumen en Google Health.";
  }
  return { health: { metrics }, metricsPending: !heartRateSamples.length, metricsError, googleSummaryUpdated, googleSummaryError };
}

async function saveDriveBackup(user: AppUser, backupState: unknown, options: Record<string, unknown> = {}) {
  const { token } = await driveAccessTokenFor(user.id);
  const content = JSON.stringify(backupState, null, 2);
  const reason = typeof options.reason === "string" ? options.reason : "auto";
  const providedMeta = (options.meta && typeof options.meta === "object" ? options.meta : {}) as Record<string, unknown>;
  const metadata: Record<string, unknown> = {
    name: backupFileName(reason),
    mimeType: "application/json",
    appProperties: { ...backupMetaFromState(backupState, reason), ...providedMeta },
  };
  if (GYMLOG_DRIVE_PARENT_FOLDER_ID) metadata.parents = [GYMLOG_DRIVE_PARENT_FOLDER_ID];
  const boundary = `gymlog_${crypto.randomUUID()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const path = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,webViewLink,size,appProperties";
  let response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok && GYMLOG_DRIVE_PARENT_FOLDER_ID) {
    delete metadata.parents;
    const fallbackBody = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    response = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: fallbackBody,
    });
  }
  const file = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(file.error?.message || "No se pudo guardar el backup de Drive.");
  await dbRequest("gymlog_google_connections", { user_id: `eq.${user.id}` }, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      backup_file_id: file.id,
      backup_file_url: file.webViewLink,
      updated_at: new Date().toISOString(),
    }),
  });
  const retainedBackups = await rotateDriveBackups(token);
  return { ...file, retainedBackups };
}

async function readDriveBackup(user: AppUser, fileId: string) {
  const { token } = await driveAccessTokenFor(user.id);
  const backups = await listDriveBackupsWithToken(token);
  const file = backups.find((item) => item.id === fileId);
  if (!file) throw new Error("Backup no encontrado en Drive.");
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  if (!response.ok) {
    const data = JSON.parse(text || "{}");
    throw new Error(data.error?.message || "No se pudo leer el backup de Drive.");
  }
  return { file, backupState: JSON.parse(text) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const action = actionFromRequest(req);
    if (action === "ping") return json({ ok: true, function: "gymlog-google" });
    if (req.method === "GET" && action === "callback") return await oauthCallback(url);
    const user = await authenticatedUser(req);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (action === "status") {
      const connection = await readConnection(user.id);
      return json({
        connected: !!connection?.google_health_refresh_token,
        driveConnected: !!connection?.google_refresh_token,
      });
    }
    if (action === "authorize") return json(await beginAuthorization(user, body));
    if (action === "backups") return json({ backups: await listDriveBackups(user), keep: GYMLOG_BACKUP_KEEP });
    if (action === "backup-file") {
      if (!body.fileId) return json({ error: "Falta el backup a restaurar." }, 400);
      return json(await readDriveBackup(user, String(body.fileId)));
    }
    if (action === "backup") return json({
      backup: await saveDriveBackup(user, body.backupState, {
        reason: body.reason,
        meta: body.backupMeta,
      }),
      backups: await listDriveBackups(user),
      keep: GYMLOG_BACKUP_KEEP,
    });
    if (action === "sync") {
      const session = body.session as WorkoutSession;
      if (!session?.localId || !session.startTime || !session.endTime) return json({ error: "Sesion incompleta." }, 400);
      const remoteDataPointId = await createExercise(user, session);
      const metrics = await metricsForSession(user, session, remoteDataPointId);
      const backup = body.backupState ? await saveDriveBackup(user, body.backupState, { meta: body.backupMeta }) : null;
      return json({ remoteDataPointId, ...metrics, backup });
    }
    if (action === "metrics") {
      const session = body.session as WorkoutSession;
      if (!body.remoteDataPointId) return json({ error: "Falta el identificador remoto de la sesion." }, 400);
      const remoteDataPointId = String(body.remoteDataPointId);
      return json({ remoteDataPointId, ...(await metricsForSession(user, session, remoteDataPointId)) });
    }
    return json({ error: "Ruta no encontrada." }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Error inesperado." }, 500);
  }
});
