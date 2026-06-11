# GymLog-Web

Aplicacion web multiusuario de GymLog, con datos privados por cuenta.

Este repositorio es la base de la version web. El repositorio `ruizherrero1/Gym-app`
queda intacto como app personal original. Usa su propio proyecto Supabase
(`tnuohiyrwnoqsnxyfonn`) y no comparte migraciones ni secretos con la app personal.

## Stack

- Next.js + TypeScript + Tailwind CSS
- Supabase Auth y Postgres con RLS
- PWA instalable

## Como funciona el deploy

La app que ve el usuario es `public/gymlog-classic.html`, un HTML autocontenido que se
sirve en `/` mediante un rewrite de `next.config.ts`. Ese fichero **no se edita a mano**:
lo genera `scripts/prepare-classic-web.mjs` a partir de `index.html` en el paso
`prebuild`. Si algun patron del script deja de coincidir con `index.html`, el build
falla con un error explicito (no genera salida corrupta en silencio).

## Desarrollo

```bash
npm install
npm run dev
```

## Variables

Copia `.env.example` a `.env.local` y rellena:

```text
NEXT_PUBLIC_SUPABASE_URL=https://tnuohiyrwnoqsnxyfonn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable__hfnlx_lrL6XI05FZyITLA_L6aUzK2A
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001
```

La URL y la publishable key tienen valores por defecto en `src/lib/supabase.ts`, de modo
que un deploy en Vercel funciona aunque esas variables no esten configuradas. Las
variables siguen teniendo prioridad si se definen.

## Supabase

La base de datos se crea con las migraciones de `supabase/migrations/`
(`202606080001_gymlog_web_user_state.sql` y
`202606080002_gymlog_web_fix_updated_at_search_path.sql`).

Consulta `SUPABASE_WEB_DEPLOY.md` antes de crear el proyecto.

## Estado inicial

- La app arranca sin historial.
- Incluye una rutina de ejemplo para entender el flujo.
- Funciona en local aunque Supabase no este configurado.
- Con Supabase configurado, cada usuario guarda y carga su estado privado.

## Legacy

`index.html` es la copia del HTML/PWA original, ya sanitizada (sin datos personales) y
usada solo como fuente del build. La migracion progresiva a la app React de `src/` esta
descrita en `docs/ARCHITECTURE.md`.
