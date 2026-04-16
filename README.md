# YouTube Video Streaming App

Aplicación de escritorio Electron para reproducir y descargar videos de YouTube usando yt-dlp.

## 🚀 Características

- **Aplicación de Escritorio**: Interfaz nativa con Electron
- **Login de YouTube**: Botón para iniciar sesión y evitar restricciones
- **Streaming Directo**: Reproduce videos sin descargarlos (más rápido)
- **Descarga y Reproducción**: Descarga videos al servidor para reproducción posterior
- **Biblioteca**: Gestiona y reproduce videos descargados previamente
- **Interfaz Moderna**: UI limpia y responsive
- **Gestión Automática de Cookies**: Guarda las cookies de tu sesión de YouTube

## 📋 Requisitos Previos

1. **Node.js** (v14 o superior)
   - Descarga desde: https://nodejs.org/

2. **yt-dlp** (requerido para descargar videos)
   
   ### Windows:
   ```powershell
   # Opción 1: Usando Chocolatey
   choco install yt-dlp
   
   # Opción 2: Descarga manual
   # Descarga yt-dlp.exe desde: https://github.com/yt-dlp/yt-dlp/releases
   # Colócalo en una carpeta en tu PATH o en la carpeta del proyecto
   ```
   
   ### Linux/Mac:
   ```bash
   # Usando pip
   pip install yt-dlp
   
   # O usando brew (Mac)
   brew install yt-dlp
   ```

3. **Node portable (opcional, recomendado para mover a otra PC)**
   - Si colocas `node.exe` en alguna de estas rutas, la app lo usará automáticamente para `yt-dlp`:
     - `node-portable/node.exe`
     - `runtime/node/node.exe`
     - `node.exe` (en la raíz del proyecto)
   - Si no existe, usa Node del sistema.

## 🔧 Instalación

1. Instala las dependencias de Node:
```bash
npm install
```

2. Verifica que yt-dlp esté instalado:
```bash
yt-dlp --version
```

## ▶️ Uso

1. Inicia la aplicación Electron:
```bash
npm start
```

2. La aplicación se abrirá automáticamente en una ventana de escritorio.

3. **Primer uso - Inicia sesión en YouTube**:
   - Haz clic en el botón "🔐 Iniciar Sesión en YouTube"
   - Se abrirá una ventana de Google
   - Inicia sesión con tu cuenta de YouTube
   - Cierra la ventana cuando termines
   - Las cookies se guardarán automáticamente

4. Usa la aplicación:
   - **Streaming Directo**: Pega una URL de YouTube y haz clic en "Reproducir"
   - **Descargar**: Pega una URL y haz clic en "Descargar" (el video se guardará en `/videos`)
   - **Biblioteca**: Ve y reproduce videos descargados previamente

## 📁 Estructura del Proyecto

```
youtubeapp/
├── server.js           # Servidor Express
├── package.json        # Dependencias
├── videos/            # Videos descargados (se crea automáticamente)
├── public/
│   ├── index.html     # Interfaz principal
│   ├── styles.css     # Estilos
│   └── script.js      # Lógica del cliente
└── README.md
```

## 🔌 API Endpoints

- `GET /` - Página principal
- `GET /stream?url=VIDEO_URL` - Stream directo del video
- `GET /descargar?url=VIDEO_URL` - Descarga el video
- `GET /videos-list` - Lista de videos descargados
- `GET /info?url=VIDEO_URL` - Información del video

## ⚠️ Notas Importantes

- Los videos descargados se guardan en la carpeta `/videos`
- El streaming directo requiere que yt-dlp esté en el PATH del sistema
- Algunos videos pueden tardar en cargar dependiendo de la velocidad de internet
- Respeta los derechos de autor al descargar videos

## 🐛 Solución de Problemas

### Error: "yt-dlp no encontrado"
- Asegúrate de que yt-dlp esté instalado y en el PATH
- En Windows, reinicia la terminal después de instalar

### Video no se reproduce
- Verifica que la URL de YouTube sea válida
- Algunos videos pueden tener restricciones de región o edad
- Intenta actualizar yt-dlp: `yt-dlp -U`

### Error de descarga
- Verifica tu conexión a internet
- Algunos videos muy largos pueden tardar mucho
- Revisa los logs del servidor en la consola

## 📝 Licencia

MIT
