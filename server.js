const express = require('express');
const cors = require('cors');
const B2 = require('backblaze-b2');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configurar multer para manejar subidas de archivos
const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 } // Límite de 100MB
});

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

// Función para obtener ID del bucket
async function getBucketId() {
  // Si ya tenemos los datos de autenticación y el bucket ID está allí, úsalo
  if (authData && authData.allowed && authData.allowed.bucketId) {
    return authData.allowed.bucketId;
  }
  
  // Si no tenemos datos de autenticación, autorizar primero
  if (!authData) {
    const success = await authorize();
    if (!success) {
      return null;
    }
  }
  
  // Verificar si ahora tenemos el bucket ID
  if (authData && authData.allowed && authData.allowed.bucketId) {
    return authData.allowed.bucketId;
  }
  
  // Si no tenemos el bucket ID en los datos de autenticación, intentar obtenerlo listando buckets
  try {
    const bucketName = process.env.B2_BUCKET_NAME;
    if (!bucketName) {
      console.error('Nombre del bucket no configurado');
      return null;
    }
    
    const response = await b2Client.listBuckets();
    const bucket = response.data.buckets.find(b => b.bucketName === bucketName);
    
    if (!bucket) {
      console.error(`Bucket '${bucketName}' no encontrado`);
      return null;
    }
    
    return bucket.bucketId;
  } catch (error) {
    console.error('Error obteniendo ID del bucket:', error.message);
    return null;
  }
}

// Función para normalizar un path de archivo
function normalizePath(filePath) {
  // Remover barras iniciales y asegurar que no hay barras duplicadas
  let normalizedPath = filePath || '';
  normalizedPath = normalizedPath.replace(/^\/+/, '');
  normalizedPath = normalizedPath.replace(/\/+/g, '/');
  return normalizedPath;
}

// Ruta para listar archivos
app.get('/api/files', async (req, res) => {
  try {
    // Autorizar si es necesario
    if (!authData) {
      const success = await authorize();
      if (!success) {
        return res.status(401).json({
          success: false,
          message: 'Error de autorización',
          serverTime: new Date().toISOString()
        });
      }
    }
    
    // Obtener el ID del bucket
    const bucketId = await getBucketId();
    if (!bucketId) {
      return res.status(500).json({
        success: false,
        message: 'No se pudo obtener el ID del bucket',
        serverTime: new Date().toISOString()
      });
    }
    
    // Obtener el prefijo de la consulta (para navegar carpetas)
    const { prefix } = req.query;
    const prefixPath = normalizePath(prefix);
    
    console.log(`Listando archivos con prefijo: "${prefixPath}"`);
    
    // Listar archivos de Backblaze B2
    const response = await b2Client.listFileNames({
      bucketId,
      prefix: prefixPath,
      delimiter: '/',
      maxFileCount: 1000
    });
    
    // Transformar la respuesta para que coincida con el formato esperado por el frontend
    const files = [];
    
    // Procesar archivos
    if (response.data.files) {
      response.data.files.forEach(file => {
        // Excluir archivos especiales o ocultos si es necesario
        if (!file.fileName.endsWith('/.folder') && !file.fileName.startsWith('.')) {
          files.push({
            name: file.fileName.split('/').pop(),
            path: `/${file.fileName}`,
            type: file.contentType,
            size: file.contentLength,
            lastModified: file.uploadTimestamp
          });
        }
      });
    }
    
    // Procesar carpetas
    if (response.data.folders) {
      response.data.folders.forEach(folder => {
        files.push({
          name: folder.split('/').filter(Boolean).pop(),
          path: `/${folder}`,
          type: 'folder',
          isFolder: true,
          size: 0
        });
      });
    }
    
    res.json({
      success: true,
      prefix: prefixPath,
      files: files,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error listando archivos:', error.message);
    
    // Verificar si el token ha expirado e intentar renovarlo
    if (error.message && error.message.includes('unauthorized')) {
      authData = null; // Resetear auth data para forzar una nueva autorización
      console.log('Token posiblemente expirado, reintentando en la próxima solicitud');
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Error listando archivos',
      error: error.message,
      serverTime: new Date().toISOString()
    });
  }
});

// NUEVA RUTA: Descargar un archivo
app.get('/api/download', async (req, res) => {
  try {
    // Comprobar que se ha proporcionado la ruta del archivo
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere la ruta del archivo',
        serverTime: new Date().toISOString()
      });
    }
    
    // Autorizar si es necesario
    if (!authData) {
      const success = await authorize();
      if (!success) {
        return res.status(401).json({
          success: false,
          message: 'Error de autorización',
          serverTime: new Date().toISOString()
        });
      }
    }
    
    // Obtener información del archivo
    const normalizedPath = normalizePath(filePath);
    console.log(`Intentando descargar archivo: "${normalizedPath}"`);
    
    // Primero, necesitamos obtener la información del archivo
    try {
      // Obtener el ID del bucket
      const bucketId = await getBucketId();
      if (!bucketId) {
        return res.status(500).json({
          success: false,
          message: 'No se pudo obtener el ID del bucket',
          serverTime: new Date().toISOString()
        });
      }
      
      // Localizar el archivo y conseguir el fileId
      const listResponse = await b2Client.listFileNames({
        bucketId,
        prefix: normalizedPath,
        maxFileCount: 1
      });
      
      if (!listResponse.data.files.length) {
        return res.status(404).json({
          success: false,
          message: 'Archivo no encontrado',
          path: normalizedPath,
          serverTime: new Date().toISOString()
        });
      }
      
      const fileInfo = listResponse.data.files[0];
      
      // Obtener la URL de descarga
      const downloadAuth = await b2Client.getDownloadAuthorization({
        bucketId: bucketId,
        fileNamePrefix: fileInfo.fileName,
        validDurationInSeconds: 900 // 15 minutos
      });
      
      // Construir URL de descarga
      const downloadUrl = `${authData.downloadUrl}/b2api/v2/b2_download_file_by_id?fileId=${fileInfo.fileId}`;
      
      // Obtener el archivo
      const response = await b2Client.downloadFileById({
        fileId: fileInfo.fileId,
        responseType: 'stream'
      });
      
      // Configurar headers para la descarga
      const fileName = fileInfo.fileName.split('/').pop();
      res.setHeader('Content-Type', fileInfo.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', fileInfo.contentLength);
      
      // Enviar el stream del archivo
      response.data.pipe(res);
    } catch (error) {
      console.error('Error obteniendo archivo:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo archivo',
        error: error.message,
        serverTime: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error general en descarga:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error en la descarga del archivo',
      error: error.message,
      serverTime: new Date().toISOString()
    });
  }
});

// NUEVA RUTA: Subir un archivo
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    // Verificar que se ha subido un archivo
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se ha proporcionado ningún archivo',
        serverTime: new Date().toISOString()
      });
    }
    
    // Verificar que se ha proporcionado una carpeta destino
    const { path: folderPath } = req.body;
    if (folderPath === undefined) {
      // Eliminar el archivo temporal
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      
      return res.status(400).json({
        success: false,
        message: 'Se requiere la ruta de la carpeta destino',
        serverTime: new Date().toISOString()
      });
    }
    
    // Autorizar si es necesario
    if (!authData) {
      const success = await authorize();
      if (!success) {
        // Eliminar el archivo temporal
        try { fs.unlinkSync(req.file.path); } catch (e) { }
        
        return res.status(401).json({
          success: false,
          message: 'Error de autorización',
          serverTime: new Date().toISOString()
        });
      }
    }
    
    // Obtener el ID del bucket
    const bucketId = await getBucketId();
    if (!bucketId) {
      // Eliminar el archivo temporal
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      
      return res.status(500).json({
        success: false,
        message: 'No se pudo obtener el ID del bucket',
        serverTime: new Date().toISOString()
      });
    }
    
    // Preparar la ruta del archivo en B2
    const normalizedFolder = normalizePath(folderPath);
    const fileName = req.file.originalname;
    const b2Path = normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
    
    console.log(`Subiendo archivo a: "${b2Path}"`);
    
    // Obtener la URL y token para la subida
    const getUploadUrlResponse = await b2Client.getUploadUrl({
      bucketId: bucketId,
    });
    
    const uploadUrl = getUploadUrlResponse.data.uploadUrl;
    const uploadAuthToken = getUploadUrlResponse.data.authorizationToken;
    
    // Leer el archivo del disco
    const fileBuffer = fs.readFileSync(req.file.path);
    
    // Determinar el tipo MIME
    const contentType = req.file.mimetype || 'application/octet-stream';
    
    // Subir el archivo a B2
    try {
      const uploadResponse = await b2Client.uploadFile({
        uploadUrl: uploadUrl,
        uploadAuthToken: uploadAuthToken,
        fileName: b2Path,
        data: fileBuffer,
        contentType: contentType,
        onUploadProgress: progress => {
          console.log(`Progreso de subida: ${Math.round((progress.loaded * 100) / progress.total)}%`);
        }
      });
      
      // Eliminar el archivo temporal
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      
      // Responder con éxito
      res.json({
        success: true,
        message: 'Archivo subido correctamente',
        file: {
          name: fileName,
          path: `/${b2Path}`,
          type: contentType,
          size: req.file.size,
          lastModified: new Date().getTime()
        },
        serverTime: new Date().toISOString()
      });
    } catch (error) {
      // Eliminar el archivo temporal
      try { fs.unlinkSync(req.file.path); } catch (e) { }
      
      console.error('Error subiendo archivo a B2:', error.message);
      
      // Verificar si el token ha expirado e intentar renovarlo
      if (error.message && error.message.includes('unauthorized')) {
        authData = null; // Resetear auth data para forzar una nueva autorización
        console.log('Token posiblemente expirado, reintentando en la próxima solicitud');
      }
      
      res.status(500).json({
        success: false,
        message: 'Error subiendo archivo a Backblaze B2',
        error: error.message,
        serverTime: new Date().toISOString()
      });
    }
  } catch (error) {
    // Eliminar el archivo temporal si existe
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
    }
    
    console.error('Error general en subida:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error en la subida del archivo',
      error: error.message,
      serverTime: new Date().toISOString()
    });
  }
});

// NUEVA RUTA: Crear una carpeta
app.post('/api/createFolder', async (req, res) => {
  try {
    // Verificar que se ha proporcionado un nombre y ruta
    const { parentPath, folderName } = req.body;
    if (!folderName) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el nombre de la carpeta',
        serverTime: new Date().toISOString()
      });
    }
    
    // Autorizar si es necesario
    if (!authData) {
      const success = await authorize();
      if (!success) {
        return res.status(401).json({
          success: false,
          message: 'Error de autorización',
          serverTime: new Date().toISOString()
        });
      }
    }
    
    // Obtener el ID del bucket
    const bucketId = await getBucketId();
    if (!bucketId) {
      return res.status(500).json({
        success: false,
        message: 'No se pudo obtener el ID del bucket',
        serverTime: new Date().toISOString()
      });
    }
    
    // Preparar la ruta de la carpeta en B2
    const normalizedParent = normalizePath(parentPath || '');
    const normalizedFolderName = folderName.replace(/\/+/g, '');
    const folderPath = normalizedParent ? `${normalizedParent}/${normalizedFolderName}` : normalizedFolderName;
    const placeholderPath = `${folderPath}/.folder`;
    
    console.log(`Creando carpeta: "${folderPath}"`);
    
    // Subir un archivo placeholder para crear la carpeta
    const getUploadUrlResponse = await b2Client.getUploadUrl({
      bucketId: bucketId,
    });
    
    const uploadUrl = getUploadUrlResponse.data.uploadUrl;
    const uploadAuthToken = getUploadUrlResponse.data.authorizationToken;
    
    // Subir un archivo vacío para crear la carpeta
    try {
      const uploadResponse = await b2Client.uploadFile({
        uploadUrl: uploadUrl,
        uploadAuthToken: uploadAuthToken,
        fileName: placeholderPath,
        data: Buffer.from(''),
        contentType: 'application/x-empty',
      });
      
      // Responder con éxito
      res.json({
        success: true,
        message: 'Carpeta creada correctamente',
        folder: {
          name: normalizedFolderName,
          path: `/${folderPath}`,
          type: 'folder',
          isFolder: true,
          size: 0
        },
        serverTime: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creando carpeta en B2:', error.message);
      
      // Verificar si el token ha expirado e intentar renovarlo
      if (error.message && error.message.includes('unauthorized')) {
        authData = null; // Resetear auth data para forzar una nueva autorización
        console.log('Token posiblemente expirado, reintentando en la próxima solicitud');
      }
      
      res.status(500).json({
        success: false,
        message: 'Error creando carpeta en Backblaze B2',
        error: error.message,
        serverTime: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error general creando carpeta:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error en la creación de la carpeta',
      error: error.message,
      serverTime: new Date().toISOString()
    });
  }
});

// NUEVA RUTA: Eliminar un archivo o carpeta
app.delete('/api/delete', async (req, res) => {
  try {
    // Verificar que se ha proporcionado una ruta
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere la ruta del archivo o carpeta',
        serverTime: new Date().toISOString()
      });
    }
    
    // Autorizar si es necesario
    if (!authData) {
      const success = await authorize();
      if (!success) {
        return res.status(401).json({
          success: false,
          message: 'Error de autorización',
          serverTime: new Date().toISOString()
        });
      }
    }
    
    // Obtener el ID del bucket
    const bucketId = await getBucketId();
    if (!bucketId) {
      return res.status(500).json({
        success: false,
        message: 'No se pudo obtener el ID del bucket',
        serverTime: new Date().toISOString()
      });
    }
    
    const normalizedPath = normalizePath(filePath);
    const isFolder = req.query.isFolder === 'true';
    
    // Si es una carpeta, necesitamos listar y eliminar todos los archivos en ella
    if (isFolder) {
      console.log(`Eliminando carpeta: "${normalizedPath}"`);
      
      // Listar todos los archivos en la carpeta
      const listResponse = await b2Client.listFileNames({
        bucketId,
        prefix: normalizedPath,
        maxFileCount: 1000
      });
      
      if (listResponse.data.files.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Carpeta no encontrada o vacía',
          path: normalizedPath,
          serverTime: new Date().toISOString()
        });
      }
      
      // Eliminar cada archivo en la carpeta
      let errors = [];
      let deletedCount = 0;
      
      for (const file of listResponse.data.files) {
        try {
          // Necesitamos la versión más reciente del archivo
          await b2Client.deleteFileVersion({
            fileId: file.fileId,
            fileName: file.fileName
          });
          deletedCount++;
        } catch (error) {
          console.error(`Error eliminando archivo ${file.fileName}:`, error.message);
          errors.push({
            fileName: file.fileName,
            error: error.message
          });
        }
      }
      
      // Responder con el resultado
      if (errors.length === 0) {
        res.json({
          success: true,
          message: `Carpeta y ${deletedCount} archivos eliminados correctamente`,
          path: normalizedPath,
          serverTime: new Date().toISOString()
        });
      } else {
        res.status(207).json({
          success: false,
          message: `Eliminación parcial: ${deletedCount} archivos eliminados, ${errors.length} fallaron`,
          path: normalizedPath,
          errors: errors,
          serverTime: new Date().toISOString()
        });
      }
    } else {
      // Eliminar un solo archivo
      console.log(`Eliminando archivo: "${normalizedPath}"`);
      
      // Primero necesitamos obtener el fileId
      const listResponse = await b2Client.listFileNames({
        bucketId,
        prefix: normalizedPath,
        maxFileCount: 1
      });
      
      if (listResponse.data.files.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Archivo no encontrado',
          path: normalizedPath,
          serverTime: new Date().toISOString()
        });
      }
      
      const fileInfo = listResponse.data.files[0];
      
      // Eliminar el archivo
      try {
        await b2Client.deleteFileVersion({
          fileId: fileInfo.fileId,
          fileName: fileInfo.fileName
        });
        
        res.json({
          success: true,
          message: 'Archivo eliminado correctamente',
          path: normalizedPath,
          serverTime: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error eliminando archivo:', error.message);
        
        // Verificar si el token ha expirado e intentar renovarlo
        if (error.message && error.message.includes('unauthorized')) {
          authData = null; // Resetear auth data para forzar una nueva autorización
          console.log('Token posiblemente expirado, reintentando en la próxima solicitud');
        }
        
        res.status(500).json({
          success: false,
          message: 'Error eliminando archivo',
          error: error.message,
          serverTime: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    console.error('Error general en eliminación:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error en la eliminación',
      error: error.message,
      serverTime: new Date().toISOString()
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