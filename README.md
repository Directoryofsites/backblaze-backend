# Backblaze B2 Backend Proxy

Este servidor actúa como proxy entre la aplicación frontend y Backblaze B2, gestionando las operaciones de almacenamiento de archivos.

## Configuración

1. Crea un archivo `.env` con las siguientes variables:

B2_ACCOUNT_ID=tu_account_id_de_backblaze
B2_APPLICATION_KEY=tu_application_key_de_backblaze
B2_BUCKET_NAME=tu_nombre_de_bucket
PORT=3001

2. Instala las dependencias:

npm install

3. Inicia el servidor:

npm start

## Endpoints API

### Status
- `GET /api/status`: Verifica la conexión con Backblaze B2

### Archivos
- `GET /api/files`: Lista archivos (acepta query param: prefix)
- `GET /api/files/:fileName`: Descarga un archivo
- `POST /api/files/:fileName`: Sube un archivo
- `DELETE /api/files/:fileName`: Elimina un archivo

## Despliegue

Este servidor está configurado para desplegarse en Render.com.

