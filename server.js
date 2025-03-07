const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*', 
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
let isInitializing = false;
let lastAuthAttempt = 0;

// Ruta principal para verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.json({ 
    message: 'API de Backblaze B2 funcionando correctamente',
    status: authToken ? 'authorized' : 'unauthorized',
    serverTime: new Date().toISOString()
  });
});

// Autorización con Backblaze B2
async function authorizeB2() {
  // Prevenir múltiples intentos simultáneos
  if (isInitializing) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!isInitializing) {
          clearInterval(checkInterval);
          resolve(authToken ? { success: true } : { success: false });
        }
      }, 500);
    });
  }

  // Limitar los reintentos (no más de uno cada 30 segundos)
  const now = Date.now();
  if (now - lastAuthAttempt < 30000) {
    return authToken ? { success: true } : { success: false };
  }

  isInitializing = true;
  lastAuthAttempt = now;

  try {
    const keyId = process.env.B2_ACCOUNT_ID || process.env.REACT_APP_B2_ACCOUNT_ID;
    const appKey = process.env.B2_APPLICATION_KEY || process.env.REACT_APP_B2_APPLICATION_KEY;
    
    if (!keyId || !appKey) {
      console.error('Credenciales de Backblaze B2 no configuradas');
      isInitializing = false;
      return { success: false, error: 'Credenciales no configuradas' };
    }
    
    const authString = `${keyId}:${appKey}`;
    const authHeader = Buffer.from(authString).toString('base64');
    
    console.log('Iniciando autorización con Backblaze B2...');
    
    const response = await axios({
      method: 'post',
      url: 'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
      headers: {
        'Authorization': `Basic ${authHeader}`
      },
      timeout: 10000 // Timeout de 10 segundos
    });
    
    authToken = response.data.authorizationToken;
    apiUrl = response.data.apiUrl;
    downloadUrl = response.data.downloadUrl;
    
    console.log('Autorización exitosa con Backblaze B2');
    isInitializing = false;
    return { success: true };
  } catch (error) {
    console.error('Error autorizando con B2:', error.message);
    isInitializing = false;
    return { success: false, error: error.message };
  }
}

// Obtener ID del bucket
async function getBucketId() {
  if (bucketId) return bucketId;
  
  if (!authToken) {
    const authResult = await authorizeB2();
    if (!authResult.success) {
      return null;
    }
  }
  
  try {
    const bucketName = process.env.B2_BUCKET_NAME || process.env.REACT_APP_B2_BUCKET_NAME;
    
    const response = await axios({
      method: 'post',
      url: `${apiUrl}/b2api/v2/b2_list_buckets`,
      headers: {
        'Authorization': authToken
      },
      data: {
        accountId: process.env.B2_ACCOUNT_ID || process.env.REACT_APP_B2_ACCOUNT_ID
      },
      timeout: 10000
    });
    
    const bucket = response.data.buckets.find(b => b.bucketName === bucketName);
    
    if (!bucket) {
      console.error(`Bucket '${bucketName}' no encontrado`);
      return null;
    }
    
    bucketId = bucket.bucketId;
    return bucketId;
  } catch (error) {
    console.error('Error obteniendo ID del bucket:', error.message);
    return null;
  }
}

// Ruta de estado (para verificación de conexión)
app.get('/api/status', async (req, res) => {
  try {
    const authResult = await authorizeB2();
    if (!authResult.success) {
      return res.status(500).json({
        success: false,
        message: `Error de autorización: ${authResult.error}`,
        serverTime: new Date().toISOString()
      });
    }
    
    const bucketId = await getBucketId();
    if (!bucketId) {
      return res.status(500).json({
        success: false,
        message: 'No se pudo obtener el ID del bucket',
        serverTime: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      message: 'Conexión exitosa con Backblaze B2',
      bucketId,
      bucketName: process.env.B2_BUCKET_NAME || process.env.REACT_APP_B2_BUCKET_NAME,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error al conectar con Backblaze B2',
      error: error.message,
      serverTime: new Date().toISOString()
    });
  }
});

// Listar archivos
app.get('/api/files', async (req, res) => {
  try {
    const authResult = await authorizeB2();
    if (!authResult.success) {
      return res.status(500).json({
        success: false,
        message: `Error de autorización: ${authResult.error}`,
        serverTime: new Date().toISOString()
      });
    }
    
    const bucketId = await getBucketId();
    if (!bucketId) {
      return res.status(500).json({
        success: false,
        message: 'No se pudo obtener el ID del bucket',
        serverTime: new Date().toISOString()
      });
    }
    
    const { prefix } = req.query;
    
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
      },
      timeout: 20000
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
    console.error('Error listando archivos:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      serverTime: new Date().toISOString()
    });
  }
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor proxy para Backblaze B2 ejecutándose en puerto ${PORT}`);
  
  // Intento inicial de autorización
  setTimeout(() => {
    authorizeB2()
      .then(result => {
        if (result.success) {
          console.log('Inicialización exitosa con Backblaze B2');
        } else {
          console.log('Fallo en la inicialización inicial, se reintentará con las solicitudes');
        }
      })
      .catch(err => {
        console.error('Error en la inicialización inicial:', err.message);
      });
  }, 3000);
});