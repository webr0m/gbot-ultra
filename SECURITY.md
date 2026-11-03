# Publicación segura

El repositorio contiene código fuente, pruebas ficticias y migraciones de esquema. Las credenciales, identidades de instalación, archivos de despliegue privados, registros y respaldos deben permanecer fuera de Git.

Antes de publicar:

```sh
git config core.hooksPath .githooks
node scripts/check-publication.mjs
gitleaks git --redact --no-banner .
```

El control local revisa el contenido real del índice de Git, incluidos archivos añadidos con `--force`; informa rutas y tipos de hallazgo sin mostrar los valores. Gitleaks revisa también el historial completo. GitHub Actions y GitLab CI repiten los controles de secretos y las pruebas.

Guarda la configuración de cada instalación en `.env` o en un gestor de secretos. Usa datos ficticios en pruebas y ejemplos. No adjuntes tokens, exportaciones, capturas privadas ni archivos de configuración reales a incidencias públicas. Si una credencial llega a publicarse, revócala en el proveedor: borrarla del último commit no elimina la exposición del historial.
