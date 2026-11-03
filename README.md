# GBot Ultra

Bot de administración de grupos de Telegram con Mini App, moderación y planes mediante Telegram Stars. Versión 2.5.1.

- Captcha, antienlaces, antiflood, lista negra, advertencias y registro de moderación.
- Instalación guiada, bandeja de revisiones y respuestas en diez idiomas.
- Publicaciones programadas, filtro visual NSFW opcional, notas y automatizaciones.
- Calidad de reglas con tendencias y revisión manual de falsos positivos (Ultra).
- Reversión de baneos y silencios nuevos con vista previa y permisos comprobados (Pro).
- Asistente de IA opcional, bots con marca propia y Alianzas con revisión local (Ultra).

## Instalación

Requiere Node.js 22 o superior y PostgreSQL. Las migraciones son compatibles con PostgreSQL 10 o superior.

```sh
npm ci
cp .env.example .env
# Completa BOT_TOKEN, DATABASE_URL y la configuración de tu instalación.
npm run db:migrate
npm run build
npm start
```

Con Docker Compose, define `POSTGRES_PASSWORD`, usa `postgres` como host en `DATABASE_URL` y arranca con `docker compose --profile app up -d --build`. El archivo `.env` permanece local y no se copia a la imagen.

Para desarrollo: `npm run dev`. Validación: `npm run typecheck`, `npm test` y `npm run build`.

`WEBAPP_URL` debe ser HTTPS para abrir el panel desde Telegram. En producción utiliza `DEV_MODE=false`. Elige `BOT_MODE=webhook` con `WEBHOOK_URL` y `WEBHOOK_SECRET`, o `polling` para un proceso permanente. Configura una sola instancia receptora por bot. En hosting con procesos suspendibles, usa `SCHEDULER_MODE=external` y programa `scripts/run-cron.mjs` en el hosting; no debe depender de un computador personal.

Los proveedores externos son opcionales y se configuran por variables de entorno. No actives IA ni moderación visual sin revisar su consentimiento y sus límites. Las funciones de Telegram dependen de los permisos concedidos al bot y al administrador.

## Revisión de moderación

En **Mini App → Moderación**, o con `/quality` y `/undo`. Las métricas cubren lista negra, antienlaces, antiflood y bloqueos por contenido; no almacenan el mensaje original y se retienen 30 días. Los falsos positivos se marcan manualmente; no son una estimación automática de precisión.

Solo se pueden deshacer baneos y silencios nuevos con estado previo guardado. La vista previa vence en cinco minutos y se vuelve a comprobar el estado antes de confirmar. No recupera mensajes borrados ni reincorpora usuarios. Los resultados inciertos requieren revisión manual y no se repiten automáticamente. Los baneos globales, CAS y decisiones de Alianzas se gestionan por sus herramientas propias.

## Configuración privada

Guarda claves, identidades de instalación y conexiones de base de datos en `.env` o en un gestor de secretos. Nunca las incluyas en commits, incidencias ni capturas públicas. `.env.example` contiene únicamente valores de ejemplo.

Este repositorio contiene código y migraciones de esquema. No contiene datos de usuarios o grupos, respaldos, registros de producción, credenciales ni el historial de repositorios anteriores.

Consulta [SECURITY.md](SECURITY.md) para el control de publicación.
