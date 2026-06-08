# Supabase para GymLog-Web

Este despliegue es nuevo e independiente del flujo privado antiguo de `Gym-app`.

## Objetivo

- Cualquier usuario puede iniciar sesion.
- Cada usuario tiene su propio estado privado en Supabase.
- La app tambien funciona en local si Supabase aun no esta configurado.
- Google Drive queda para una fase posterior como backup opcional, no como base de datos principal.

## Pasos

1. Crear un proyecto nuevo en Supabase para `GymLog-Web`.
2. En Authentication, activar Email OTP.
3. Opcionalmente activar Google como proveedor OAuth.
4. Ejecutar la migracion:

```sql
supabase/migrations/202606080001_gymlog_web_user_state.sql
```

5. Configurar variables en Vercel o en `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=https://gym.ramonruizherrero.com
```

6. En Supabase Auth, anadir redirect URLs:

```text
http://127.0.0.1:3001/**
https://gym.ramonruizherrero.com/**
```

## Nota sobre Gym-app

No reutilices el proyecto Supabase privado anterior si quieres mantener tu app personal separada.
`Gym-app` puede seguir usando sus funciones y backups actuales. `GymLog-Web` debe tener su propio proyecto, claves y migraciones.
# Supabase nuevo configurado

Proyecto web: `tnuohiyrwnoqsnxyfonn`

URL pública:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tnuohiyrwnoqsnxyfonn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable__hfnlx_lrL6XI05FZyITLA_L6aUzK2A
```

La app acepta también `NEXT_PUBLIC_SUPABASE_ANON_KEY` como compatibilidad, pero para este proyecto nuevo queda preferida `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

La URL y la publishable key tambien estan definidas como valores por defecto en `src/lib/supabase.ts`, por lo que Vercel puede compilar sin configurar variables manualmente. Aun asi, si quieres poder rotarlas desde el panel sin tocar codigo, configura esas mismas variables en Vercel.

No uses aquí claves `service_role`, ni ejecutes migraciones antiguas de `Gym-app`. Para `GymLog-Web` solo hacen falta las migraciones nuevas `202606080001_gymlog_web_user_state.sql` y `202606080002_gymlog_web_fix_updated_at_search_path.sql`.
