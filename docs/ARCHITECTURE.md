# Arquitectura de GymLog-Web

## Aplicacion principal

`ruizherrero1/GymLog-Web` es la aplicacion mantenida y se publica en `gym.ramonruizherrero.com`. `ruizherrero1/Gym-app` queda como origen historico hasta decidir si se archiva o se hace privado.

La ruta `/` sirve `public/gymlog-classic.html`. El archivo se genera desde `index.html`; las mejoras aisladas de fiabilidad, Health y PWA viven en `public/gymlog-reliability.js`.

## Datos sin perdida

- `gymlog_user_state.data` conserva el JSON completo como fuente recuperable.
- `revision` y `gymlog_save_user_state` impiden sobrescrituras silenciosas entre dispositivos.
- `gymlog_state_snapshots` guarda versiones inmutables antes de restauraciones y conflictos.
- Sesiones, ejercicios, series, pesos y pulso se replican de forma aditiva en tablas normalizadas.
- Las muestras Fitbit sin hora se guardan por `sample_index`; no se inventan timestamps.
- La papelera, los backups JSON de Drive y la cola local del navegador siguen siendo capas adicionales de recuperacion.

## Sincronizacion

Cada cambio se guarda primero en localStorage y queda marcado como pendiente. Supabase recibe el JSON mediante un RPC con revision esperada. Si otro dispositivo cambio la nube, ambas versiones se guardan localmente, se combinan por identificadores y el estado previo queda en snapshot. Los errores se muestran en la app y se registran en `gymlog_sync_events`.

## Google Health, Fitbit y Drive

La Edge Function `gymlog-google` mantiene OAuth y tokens privados. Google Health recibe las sesiones; Fitbit aporta las lecturas disponibles; Drive conserva las ultimas copias JSON. Las metricas pendientes se reintentan a los 15 minutos, 2 horas y 24 horas cuando la PWA tiene conexion.

## PWA

El service worker usa red primero para navegacion, conserva solo el shell local y nunca cachea autenticacion, Supabase ni Google. Las actualizaciones esperan confirmacion del usuario antes de recargar.

## Seguridad

Todas las tablas accesibles por el cliente tienen RLS por `auth.uid()`. Las tablas que guardan tokens OAuth no tienen politicas de cliente y solo las usa la Edge Function. El HTML publico no contiene email ni contrasena.

## Validacion

Antes de desplegar se ejecutan `npm run build`, `npm run lint` y `npm run verify:reliability`. Las migraciones aplicadas se conservan en `supabase/migrations`.
