const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*', // Esto permitirá conexiones desde cualquier origen, incluyendo GitHub Pages
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: ['application/octet-stream'], limit: '50mb' }));

// Variables para Backblaze
let authToken = null;
let apiUrl = null;
let downloadUrl = null;
let bucketId = null;

// Autorización con Backblaze B2
async function authorizeB2() {
  try {
    const keyId = process.env.B2_ACCOUNT_ID || process.env.REACT_APP_B2_ACCOUNT_ID;
    const appKey = process.env.B2_APPLICATION_KEY || process.env.REACT_APP_B2_APPLICATION_KEY;
    const authString = `${keyId}:${appKey}`;
    const authHeader = Buffer.from(authString).toString('base64');
    
    const response = await axios({
      method: 'post',
      url: 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
      headers: {
        'Authorization': `Basic ${authHeader}`
      }
    });
    
    authToken = response.data.authorizationToken;
    apiUrl = response.data.apiUrl;
    downloadUrl = response.data.downloadUrl;
    
    return response.data;
  } catch (error) {
    console.error('Error autorizando con B2:', error);
    throw error;
  }
}

// Obtener ID del bucket
async function getBucketId() {
  if (bucketId) return bucketId;
  
  if (!authToken) {
    await authorizeB2();
  }
  
  try {
    const response = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_list_buckets`,
      headers: {
        'Authorization': authToken
      },
      data: {
        accountId: process.env.B2_ACCOUNT_ID || process.env.REACT_APP_B2_ACCOUNT_ID
      }
    });
    
    const bucket = response.data.buckets.find(b => b.bucketName === (process.env.B2_BUCKET_NAME || process.env.REACT_APP_B2_BUCKET_NAME));
    
    if (!bucket) {
      throw new Error(`Bucket '${process.env.B2_BUCKET_NAME || process.env.REACT_APP_B2_BUCKET_NAME}' no encontrado`);
    }
    
    bucketId = bucket.bucketId;
    return bucketId;
  } catch (error) {
    console.error('Error obteniendo ID del bucket:', error);
    throw error;
  }
}

// Ruta principal para verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.json({ message: 'API de Backblaze B2 funcionando correctamente' });
});

// Rutas API
app.get('/api/b2/authorize', async (req, res) => {
  try {
    const authData = await authorizeB2();
    res.json(authData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mantén también la versión POST para compatibilidad
app.post('/api/b2/authorize', async (req, res) => {
  try {
    const authData = await authorizeB2();
    res.json(authData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/b2/list-files', async (req, res) => {
  try {
    if (!authToken) {
      await authorizeB2();
    }
    
    const { prefix } = req.body;
    const bucketId = await getBucketId();
    
    const response = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_list_file_names`,
      headers: {
        'Authorization': authToken
      },
      data: {
        bucketId,
        prefix: prefix || '',
        delimiter: '/',
        maxFileCount: 1000
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error listando archivos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/b2/download-file', async (req, res) => {
  try {
    if (!authToken) {
      await authorizeB2();
    }
    
    const { fileName } = req.body;
    
    const fileUrl = `${downloadUrl}/file/${process.env.B2_BUCKET_NAME || process.env.REACT_APP_B2_BUCKET_NAME}/${fileName}`;
    
    const response = await axios({
      method: 'get',
      url: fileUrl,
      headers: {
        'Authorization': authToken
      },
      responseType: 'arraybuffer'
    });
    
    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
  } catch (error) {
    console.error('Error descargando archivo:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/b2/upload-file', async (req, res) => {
  try {
    if (!authToken) {
      await authorizeB2();
    }
    
    const bucketId = await getBucketId();
    
    // Obtener URL de subida
    const getUploadUrl = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_get_upload_url`,
      headers: {
        'Authorization': authToken
      },
      data: {
        bucketId
      }
    });
    
    const { fileName, contentType } = req.query;
    const fileData = req.body;
    
    // Subir archivo
    const uploadResponse = await axios({
      method: 'post',
      url: getUploadUrl.data.uploadUrl,
      headers: {
        'Authorization': getUploadUrl.data.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(fileName),
        'Content-Type': contentType || 'application/octet-stream',
        'X-Bz-Content-Sha1': 'do_not_verify'
      },
      data: fileData
    });
    
    res.json(uploadResponse.data);
  } catch (error) {
    console.error('Error subiendo archivo:', error);
    res.status(500).json({ error: error.message });
  }
});

// NUEVAS RUTAS - INICIO

// Ruta de estado (para verificación de conexión)
app.get('/api/status', async (req, res) => {
  try {
    await authorizeB2();
    const bucketId = await getBucketId();
    res.json({
      success: true,
      message: 'Conexión exitosa con Backblaze B2',
      bucketId,
      bucketName: process.env.B2_BUCKET_NAME || process.env.REACT_APP_B2_BUCKET_NAME
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error al conectar con Backblaze B2',
      error: error.message 
    });
  }
});

// Listar archivos
app.get('/api/files', async (req, res) => {
  try {
    if (!authToken) {
      await authorizeB2();
    }
    
    const { prefix } = req.query;
    const bucketId = await getBucketId();
    
    const response = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_list_file_names`,
      headers: {
        'Authorization': authToken
      },
      data: {
        bucketId,
        prefix: prefix || '',
        delimiter: '/',
        maxFileCount: 1000
      }
    });
    
    // Transformar la respuesta para que coincida con el formato esperado por el frontend
    const files = [];
    
    // Procesar archivos
    if (response.data.files) {
      response.data.files.forEach(file => {
        files.push({
          name: file.fileName.split('/').pop(),
          path: `/${file.fileName}`,
          type: file.contentType,
          size: file.contentLength
        });
      });
    }
    
    // Procesar carpetas
    if (response.data.folders) {
      response.data.folders.forEach(folder => {
        files.push({
          name: folder.split('/').filter(Boolean).pop(),
          path: `/${folder}`,
          type: 'folder',
          isFolder: true
        });
      });
    }
    
    res.json(files);
  } catch (error) {
    console.error('Error listando archivos:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener/descargar archivo
app.get('/api/files/:fileName', async (req, res) => {
  try {
    if (!authToken) {
      await authorizeB2();
    }
    
    const fileName = req.params.fileName;
    
    const fileUrl = `${downloadUrl}/file/${process.env.B2_BUCKET_NAME || process.env.REACT_APP_B2_BUCKET_NAME}/${fileName}`;
    
    const response = await axios({
      method: 'get',
      url: fileUrl,
      headers: {
        'Authorization': authToken
      },
      responseType: 'arraybuffer'
    });
    
    res.set('Content-Type', response.headers['content-type']);
    res.send(response.data);
  } catch (error) {
    console.error('Error descargando archivo:', error);
    res.status(500).json({ error: error.message });
  }
});

// Subir archivo
app.post('/api/files/:fileName', async (req, res) => {
  try {
    if (!authToken) {
      await authorizeB2();
    }
    
    const bucketId = await getBucketId();
    const fileName = req.params.fileName;
    
    // Obtener URL de subida
    const getUploadUrl = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_get_upload_url`,
      headers: {
        'Authorization': authToken
      },
      data: {
        bucketId
      }
    });
    
    // Determinar el tipo de contenido
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    
    // Subir archivo
    const uploadResponse = await axios({
      method: 'post',
      url: getUploadUrl.data.uploadUrl,
      headers: {
        'Authorization': getUploadUrl.data.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(fileName),
        'Content-Type': contentType,
        'X-Bz-Content-Sha1': 'do_not_verify'
      },
      data: req.body
    });
    
    res.json(uploadResponse.data);
  } catch (error) {
    console.error('Error subiendo archivo:', error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar archivo
app.delete('/api/files/:fileName', async (req, res) => {
  try {
    if (!authToken) {
      await authorizeB2();
    }
    
    const fileName = req.params.fileName;
    const bucketId = await getBucketId();
    
    // Primero necesitamos obtener el fileId
    const listResponse = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_list_file_names`,
      headers: {
        'Authorization': authToken
      },
      data: {
        bucketId,
        prefix: fileName,
        maxFileCount: 1
      }
    });
    
    const files = listResponse.data.files;
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    
    const fileId = files[0].fileId;
    
    // Ahora podemos eliminar el archivo
    const deleteResponse = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_delete_file_version`,
      headers: {
        'Authorization': authToken
      },
      data: {
        fileId,
        fileName
      }
    });
    
    res.json(deleteResponse.data);
  } catch (error) {
    console.error('Error eliminando archivo:', error);
    res.status(500).json({ error: error.message });
  }
});

// NUEVAS RUTAS - FIN

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor proxy para Backblaze B2 ejecutándose en puerto ${PORT}`);
});