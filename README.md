# GymLog-Web

Aplicacion personal de GymLog publicada en `https://gym.ramonruizherrero.com`, con datos privados, Google Health/Fitbit y backups de Google Drive.

## Arquitectura

La ruta `/` sirve `public/gymlog-classic.html`, generado desde `index.html` por `scripts/prepare-classic-web.mjs`. La logica nueva y aislada de fiabilidad, Health y PWA vive en `public/gymlog-reliability.js`. No edites a mano el HTML generado.

El proyecto Supabase dedicado es `qserywqzvluqfrnyeggz`. No uses el proyecto compartido antiguo para GymLog.

## Desarrollo

```bash
npm install
npm run dev
```

Configura `.env.local` con la URL y la clave publicable del proyecto dedicado. Nunca uses una clave `service_role` en el navegador.

## Validacion

```bash
npm run build
npm run lint
npm run verify:reliability
```

Las pruebas verifican privacidad del HTML, PWA, revision de nube, recuperacion Health y las plantillas clasicas.

## Datos

`gymlog_user_state` sigue conservando el JSON completo. Las migraciones añaden snapshots inmutables, control de revision y tablas normalizadas para sesiones, ejercicios, series, peso y pulso sin eliminar el formato recuperable. Consulta `docs/ARCHITECTURE.md`.
