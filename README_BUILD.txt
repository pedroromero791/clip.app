CLIP APP 1.1.0 - proyecto Windows

MEJORAS INCLUIDAS
- Vista previa a 540x960 para reducir carga; exportación vuelve a 1080x1920.
- Electron con backgroundThrottling=false para evitar que perder el foco/minimizar detenga timers de reproducción/exportación.
- Exportación MP4 a: Videos\\CLIP APP
- Barra de progreso de descarga de YouTube.
- yt-dlp + FFmpeg nativos.

ANTES DE COMPILAR
1. Coloca yt-dlp.exe en tools\\yt-dlp.exe
2. Coloca ffmpeg.exe en tools\\ffmpeg.exe
3. Instala Node.js LTS.
4. Abre PowerShell en esta carpeta.
5. npm install
6. npm run dist

SALIDA
- dist\\CLIP-APP-Setup-1.1.0.exe

NOTA
La carpeta tools no incluye binarios en este ZIP porque son ejecutables externos. Usa los mismos ffmpeg.exe y yt-dlp.exe que ya tienes en tu instalación anterior.
