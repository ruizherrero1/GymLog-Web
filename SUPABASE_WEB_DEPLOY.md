# Supabase de GymLog-Web

Proyecto de produccion: `qserywqzvluqfrnyeggz` (`GymApp personal`, region `eu-west-1`).

## Configuracion

```text
NEXT_PUBLIC_SUPABASE_URL=https://qserywqzvluqfrnyeggz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave publicable del proyecto>
NEXT_PUBLIC_APP_URL=https://gym.ramonruizherrero.com
```

La app clasica lleva URL y clave publicable; esto es correcto para Supabase siempre que RLS permanezca activo. Nunca incluyas `service_role`, secretos OAuth ni refresh tokens en el repositorio.

## Migraciones

Aplica en orden todos los ficheros de `supabase/migrations/`. Las migraciones de fiabilidad son aditivas: conservan `gymlog_user_state.data`, crean snapshot previo, añaden revision y rellenan tablas normalizadas.

## Auth y redirecciones

Mantener como URLs autorizadas:

```text
http://127.0.0.1:3001/**
https://gym.ramonruizherrero.com/**
```

Google Health y Drive usan la Edge Function `gymlog-google`. Los tokens permanecen en `gymlog_google_connections`, sin politicas de cliente.

## Comprobaciones posteriores

1. Ejecutar `npm run build`, `npm run lint` y `npm run verify:reliability`.
2. Revisar asesores de seguridad y rendimiento de Supabase.
3. Confirmar que el checksum, sesiones y muestras de pulso no cambian inesperadamente.
4. Probar login, `/status`, `/metrics` y `/backups` con una cuenta real.
