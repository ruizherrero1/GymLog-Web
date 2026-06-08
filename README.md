# GymLog-Web

Aplicacion web independiente de GymLog para usuarios con datos privados por cuenta.

Este repositorio es la base nueva para la version web. El repositorio `ruizherrero1/Gym-app`
queda intacto como app personal original.

## Stack

- Next.js
- TypeScript
- Tailwind CSS
- Supabase Auth
- Supabase Postgres con RLS
- PWA instalable

## Estado inicial

- La app arranca sin historial.
- Incluye una rutina de ejemplo para entender el flujo.
- Funciona en local aunque Supabase no este configurado.
- Cuando Supabase esta configurado, cada usuario puede guardar y cargar su estado privado.

## Desarrollo

```bash
npm install
npm run dev
```

## Variables

Copia `.env.example` a `.env.local` y rellena:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001
```

## Supabase

La migracion inicial esta en:

```text
supabase/migrations/202606080001_gymlog_web_user_state.sql
```

Consulta `SUPABASE_WEB_DEPLOY.md` antes de crear el proyecto.

## Legacy

La copia del HTML/PWA original permanece en el repositorio como referencia de producto.
No modifica ni rompe `ruizherrero1/Gym-app`.
# GymLog Web

Base web independiente para GymLog. Este repo usa su propio proyecto Supabase (`tnuohiyrwnoqsnxyfonn`) y no debe compartir migraciones ni secretos con `ruizherrero1/Gym-app`.

Variables públicas para desarrollo:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tnuohiyrwnoqsnxyfonn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable__hfnlx_lrL6XI05FZyITLA_L6aUzK2A
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001
```

La URL y la publishable key del Supabase nuevo tienen valores por defecto en `src/lib/supabase.ts`, de modo que un deploy en Vercel puede funcionar aunque esas variables no se hayan creado todavía. Las variables siguen teniendo prioridad si se configuran.

La base de datos web se crea con las migraciones nuevas de `supabase/migrations/202606080001_gymlog_web_user_state.sql` y `supabase/migrations/202606080002_gymlog_web_fix_updated_at_search_path.sql`. No ejecutes aquí las migraciones antiguas de Google Health/Drive copiadas desde la app personal.
