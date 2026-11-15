# GBot Ultra

Bot de administración de grupos de Telegram con Mini App, moderación y planes mediante Telegram Stars. Versión 2.13.0.

- Captcha, antienlaces, antiflood, lista negra, advertencias y registro de moderación.
- Moderación de artículos enriquecidos, bots invitados y ediciones; bloqueos opcionales de Live Photos, historias, spoilers y otros contenidos (Premium).
- Instalación guiada, bandeja de revisiones y respuestas en veinte idiomas, seleccionables desde el menú del grupo.
- Mini App en 20 idiomas, elegidos automáticamente según el cliente de Telegram; inglés si el idioma no está disponible. El idioma compartido de las respuestas del grupo se configura por separado y no cambia el del panel.
- Publicaciones programadas, filtro visual NSFW opcional, notas y automatizaciones.
- Bloqueo de reacciones de todo el grupo y reporte mediante un emoji de reacción, con borrado opcional del mensaje (Pro).
- Poda de miembros inactivos por días de silencio, con vista previa y resultado por miembro (Premium).
- API y servidor MCP para automatizaciones con claves por grupo, ámbitos de lectura y moderación, y límite de peticiones (Ultra).
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

## API y MCP para automatizaciones

La API pública expone un grupo a herramientas externas y requiere el plan Ultra de ese grupo. Las claves se crean en el panel, se guardan cifradas solo como hash y se muestran una sola vez; cada clave tiene sus ámbitos de lectura o moderación y un límite de 60 peticiones por minuto. Las acciones quedan en el registro de moderación del grupo con la clave que las originó. La referencia está en `public/apidocs.html` y se publica en `/apidocs`.

El mismo grupo publica un servidor MCP con transporte Streamable HTTP en `/mcp`, autenticado con la misma clave y limitado por el mismo ámbito. Habla la revisión `2026-07-28` del protocolo y acepta el saludo clásico de los clientes anteriores. Expone `list_members`, `get_stats`, `get_settings`, `list_moderation_log`, `list_admins`, `moderate_user` y `manage_admin`, que aplican el mismo control de permisos y el mismo registro que el panel.

La gestión de administradores por API y MCP está en `/api/v1/admins`: listar administradores con sus permisos y promover o degradar a un miembro. Ninguna promoción puede surpassar los permisos de Telegram de quien creó la clave, y el creador del grupo no se puede promover ni degradar.

## Configuración privada

Guarda claves, identidades de instalación y conexiones de base de datos en `.env` o en un gestor de secretos. Nunca las incluyas en commits, incidencias ni capturas públicas. `.env.example` contiene únicamente valores de ejemplo.

Este repositorio contiene código y migraciones de esquema. No contiene datos de usuarios o grupos, respaldos, registros de producción, credenciales ni el historial de repositorios anteriores.

Consulta [SECURITY.md](SECURITY.md) para el control de publicación.

## Comunidad oficial

[Bot](https://t.me/GroupButlerEsp_bot) · [Grupo](https://t.me/GroupButlerEspGroup) · [Canal de novedades](https://t.me/GroupButlerEs) · [Contacto](https://t.me/webrom_bot). Los enlaces se centralizan en `public/community.json`.

El trabajo de difusión se procesa en el hosting mediante `scripts/run-broadcasts.mjs`, programado una vez por minuto. Sus endpoints requieren la identidad de administración configurada; preparar una audiencia no envía mensajes. Se necesita una vista previa y confirmación antes de encolar. Los resultados inciertos no se reintentan automáticamente y no se activan envíos de pago.
