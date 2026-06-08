# Arquitectura de GymLog-Web

## Repositorios

- `ruizherrero1/Gym-app`: app personal original. No se modifica desde este trabajo.
- `ruizherrero1/GymLog-Web`: nueva app web multiusuario.
- `ruizherrero1/Web`: portal publico que enlaza a GymLog-Web.

## Datos

El MVP usa una tabla `gymlog_user_state` con un JSON por usuario.

Motivo:

- permite migrar desde el estado JSON actual de la PWA;
- reduce riesgo en la primera version web;
- mantiene aislamiento por usuario con RLS;
- deja abierta una futura normalizacion por tablas.

## Supabase

Debe ser un proyecto nuevo para no interferir con la app personal.

La politica RLS exige:

```sql
user_id = auth.uid()
```

De este modo cada usuario solo puede leer, crear y actualizar su propio estado.

## Google Drive

No se usa como base de datos principal. Puede volver como backup opcional:

- exportar JSON a Drive;
- restaurar copia;
- conservar ultimas copias.

La integracion Google Health/Fitbit de la app original queda para una fase posterior.
