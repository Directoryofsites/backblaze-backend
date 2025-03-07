const express = require('express');
const cors = require('cors');
const B2 = require('backblaze-b2');
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

// Variables para Backblaze
let b2Client = null;
let authData = null;

// Ruta principal para verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.json({ 
    message: 'API de Backblaze B2 funcionando correctamente',
    status: authData ? 'authorized' : 'unauthorized',
    serverTime: new Date().toISOString()
  });
});

// Ruta para mostrar variables de entorno (solo para diagnóstico)
app.get('/api/env', (req, res) => {
  const variables = {
    B2_KEY_ID: process.env.B2_KEY_ID ? `${process.env.B2_KEY_ID.substring(0, 4)}...` : 'no definido',
    B2_ACCOUNT_ID: process.env.B2_ACCOUNT_ID ? `${process.env.B2_ACCOUNT_ID.substring(0, 4)}...` : 'no definido',
    B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY ? 'presente' : 'no definido',
    B2_BUCKET_NAME: process.env.B2_BUCKET_NAME
  };
  
  res.json(variables);
});

// Función simple para autorizar
async function authorize() {
  try {
    console.log('Intentando autorización con Backblaze B2...');
    
    // Usar la clave que esté disponible
    const keyId = process.env.B2_KEY_ID || process.env.B2_ACCOUNT_ID;
    const appKey = process.env.B2_APPLICATION_KEY;
    
    if (!keyId || !appKey) {
      console.error('Credenciales no configuradas');
      return false;
    }
    
    // Crear un nuevo cliente cada vez
    b2Client = new B2({
      applicationKeyId: keyId.trim(),
      applicationKey: appKey.trim()
    });
    
    // Intentar autorizar
    const response = await b2Client.authorize();
    authData = response.data;
    
    console.log('Autorización exitosa');
    return true;
  } catch (error) {
    console.error('Error de autorización:', error.message);
    if (error.response) {
      console.error('Detalles:', JSON.stringify(error.response.data));
    }
    return false;
  }
}

// Ruta de prueba simple para autorización
app.get('/api/auth-test', async (req, res) => {
  try {
    const success = await authorize();
    
    if (success) {
      res.json({
        success: true,
        message: 'Autorización exitosa',
        accountId: authData.accountId,
        bucketInfo: authData.allowed
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Error de autorización'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error inesperado',
      error: error.message
    });
  }
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log('Configuración actual:');
  console.log(`- B2_KEY_ID: ${process.env.B2_KEY_ID ? 'configurado' : 'no configurado'}`);
  console.log(`- B2_ACCOUNT_ID: ${process.env.B2_ACCOUNT_ID ? 'configurado' : 'no configurado'}`);
  console.log(`- B2_APPLICATION_KEY: ${process.env.B2_APPLICATION_KEY ? 'configurado' : 'no configurado'}`);
  console.log(`- B2_BUCKET_NAME: ${process.env.B2_BUCKET_NAME || 'no configurado'}`);
});