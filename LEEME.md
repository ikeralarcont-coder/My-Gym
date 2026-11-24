# Servidor de avisos de Mi Gym

## 1. Subir archivos a GitHub
En tu repositorio de la app:
- Reemplaza `index.html` y agrega `sw.js` (junto a `index.html`).
- Crea una carpeta `servidor-avisos` con `worker.js` y `wrangler.toml`.

## 2. Crear el servidor en Cloudflare (gratis)
1. Crea una cuenta en dash.cloudflare.com.
2. Ve a **Workers & Pages › Create › Import a repository** y conecta tu GitHub.
3. Elige tu repositorio.
4. Nombre del proyecto: **migym-avisos** (tiene que ser exactamente ese).
5. En **Advanced settings › Root directory** escribe `servidor-avisos`.
6. Deja el comando de deploy como `npx wrangler deploy` y pulsa **Deploy**.
7. Cuando termine, copia la dirección que te da (algo como `https://migym-avisos.TU-USUARIO.workers.dev`).

## 3. Activar en el iPhone
1. Abre Mi Gym desde el icono de la pantalla de inicio (no desde Safari).
2. Perfil › **Aviso al terminar el descanso**.
3. Pega la dirección del paso 2.7 y acepta el permiso de notificaciones.
4. Debe llegarte una notificación de prueba.

Desde ahí, cada vez que marques una serie, el aviso llega cuando termine el descanso, aunque cierres la app o bloquees el teléfono.
