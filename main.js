const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');

let win = null;

let exportStream = null;
let exportTemp = null;

let potServer = null;
let potServerStarting = null;
const POT_PORT = 4416;


/* =========================================================
   UTILIDADES
   ========================================================= */

function tool(name) {
  /*
   * DESARROLLO:
   * npm.cmd start
   *
   * Los ejecutables están en:
   * CLIP_APP_Project/tools/
   */
  if (process.defaultApp) {
    return path.join(__dirname, 'tools', name);
  }

  /*
   * INSTALADOR:
   *
   * resources/tools/
   */
  return path.join(process.resourcesPath, 'tools', name);
}


function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}


function safeName(value) {
  return String(value || 'clipapp')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 100);
}


function sendYoutubeProgress(
  percent,
  message,
  phase = 'download'
) {
  try {
    win?.webContents?.send(
      'youtube-progress',
      {
        percent,
        message,
        phase
      }
    );
  } catch {}
}


/* =========================================================
   SERVIDOR PO TOKEN (BGUTIL)
   ========================================================= */

function potServerRoot() {
  return path.join(
    tool('bgutil'),
    'bgutil-ytdlp-pot-provider',
    'yt_dlp_plugins',
    'extractor',
    'bgutil-ytdlp-pot-provider-2.0.1',
    'server'
  );
}


function isPortOpen(port) {
  return new Promise(resolve => {
    const socket =
      net.createConnection({
        host: '127.0.0.1',
        port
      });

    const done = result => {
      try {
        socket.destroy();
      } catch {}
      resolve(result);
    };

    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}


async function ensurePotServer() {
  if (potServer && !potServer.killed) {
    return;
  }

  if (await isPortOpen(POT_PORT)) {
    return;
  }

  if (potServerStarting) {
    return potServerStarting;
  }

  const deno = tool('deno.exe');
  const serverRoot = potServerRoot();
  const nodeModules = path.join(
    serverRoot,
    'node_modules'
  );
  const entry = path.join(
    serverRoot,
    'src',
    'main.ts'
  );

  if (!fs.existsSync(deno)) {
    throw new Error(
      `No se encontró deno.exe:\n${deno}`
    );
  }

  if (!fs.existsSync(entry)) {
    throw new Error(
      `No se encontró el servidor POT de bgutil:\n${entry}`
    );
  }

  if (!fs.existsSync(nodeModules)) {
    throw new Error(
      `Faltan las dependencias del servidor POT:\n${nodeModules}`
    );
  }

  potServerStarting = new Promise((resolve, reject) => {
    let settled = false;
    let output = '';

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      potServerStarting = null;

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      finish(
        new Error(
          'El servidor PO Token de YouTube no respondió a tiempo.\n' +
          output.slice(-1500)
        )
      );
    }, 15000);

    try {
      potServer = spawn(
        deno,
        [
          'run',
          '--allow-env',
          '--allow-net',
          '--allow-ffi=.',
          '--allow-read=.',
          '--allow-sys=osRelease',
          '../src/main.ts'
        ],
        {
          cwd: nodeModules,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );

      const waitForPort = async () => {
        const deadline = Date.now() + 12000;

        while (Date.now() < deadline) {
          if (await isPortOpen(POT_PORT)) {
            finish();
            return;
          }

          await new Promise(resolve => setTimeout(resolve, 150));
        }

        finish(
          new Error(
            'El servidor PO Token indicó que inició, pero el puerto 4416 todavía no responde.\n' +
            output.slice(-1500)
          )
        );
      };

      const inspect = data => {
        const text = data.toString();
        output += text;

        if (/Started POT server/i.test(text)) {
          /*
           * No damos por listo el servidor solo porque escribió
           * "Started". Esperamos a que 127.0.0.1:4416 realmente
           * acepte conexiones. Esto evita el error del primer arranque.
           */
          waitForPort();
        }
      };

      potServer.stdout.on('data', inspect);
      potServer.stderr.on('data', inspect);

      potServer.on('error', error => {
        finish(error);
      });

      potServer.on('close', code => {
        if (!settled) {
          finish(
            new Error(
              `El servidor PO Token se cerró antes de iniciar (código ${code}).\n${output.slice(-1500)}`
            )
          );
        }
      });
    } catch (error) {
      finish(error);
    }
  });

  return potServerStarting;
}


/* =========================================================
   VENTANA
   ========================================================= */

function createWindow() {

  win = new BrowserWindow({
    width: 1500,
    height: 900,

    minWidth: 1100,
    minHeight: 720,

    backgroundColor: '#090b0e',

    webPreferences: {
      preload: path.join(
        __dirname,
        'preload.js'
      ),

      contextIsolation: true,
      nodeIntegration: false,

      webSecurity: false,

      /*
       * Evita throttling cuando la ventana
       * pasa a segundo plano.
       */
      backgroundThrottling: false
    }
  });


  win.webContents.setBackgroundThrottling(
    false
  );


  win.loadFile(
    path.join(
      __dirname,
      'resources',
      'app',
      'index.html'
    )
  );
}


/* =========================================================
   YOUTUBE
   ========================================================= */

async function runYoutube(url) {

  if (
    !url ||
    !String(url).trim()
  ) {
    throw new Error(
      'No se recibió una URL de YouTube.'
    );
  }


  const ytdlp =
    tool('yt-dlp.exe');

  const ffmpeg =
    tool('ffmpeg.exe');


  /*
   * Comprobar yt-dlp
   */

  if (!fs.existsSync(ytdlp)) {

    throw new Error(
      `No se encontró yt-dlp.exe:\n${ytdlp}`
    );
  }


  /*
   * Comprobar FFmpeg
   */

  if (!fs.existsSync(ffmpeg)) {

    throw new Error(
      `No se encontró ffmpeg.exe:\n${ffmpeg}`
    );
  }


  /*
   * Carpeta temporal de YouTube
   */

  const dir =
    ensureDir(
      path.join(
        app.getPath('temp'),
        'CLIPAPP-Youtube'
      )
    );


  const stamp =
    Date.now();


  /*
   * IMPORTANTE:
   *
   * No usamos el título de YouTube
   * como nombre del archivo.
   *
   * Usamos únicamente:
   *
   * timestamp.ext
   *
   * Esto evita problemas con:
   *
   * - espacios
   * - caracteres especiales
   * - caracteres Unicode
   * - títulos largos
   * - caracteres incompatibles
   */

  const outputTemplate =
    path.join(
      dir,
      `${stamp}.%(ext)s`
    );


  const finalMp4 =
    path.join(
      dir,
      `${stamp}.mp4`
    );


  /*
   * Limpiar posibles archivos
   * de la misma ejecución.
   */

  try {

    const oldFiles =
      fs.readdirSync(dir);

    for (
      const file of oldFiles
    ) {

      if (
        file.startsWith(
          `${stamp}.`
        )
      ) {

        try {
          fs.unlinkSync(
            path.join(
              dir,
              file
            )
          );
        } catch {}
      }
    }

  } catch {}


  /*
   * Argumentos yt-dlp
   */

  /*
   * Levantar automáticamente el servidor PO Token.
   * El usuario final no necesita abrir PowerShell.
   */
  await ensurePotServer();


  const pluginDir = tool('yt_dlp_plugins');

  if (!fs.existsSync(pluginDir)) {
    throw new Error(
      `No se encontró el plugin de YouTube:\n${pluginDir}`
    );
  }


  const args = [

    '--plugin-dirs',
    pluginDir,

    '--js-runtimes',
    `deno:${tool('deno.exe')}`,

    '--extractor-args',
    `youtubepot-bgutilhttp:base_url=http://127.0.0.1:${POT_PORT}`,

    '--no-playlist',

    '--newline',

    '--restrict-filenames',

    /*
     * Mejor video + mejor audio
     */
    '-f',
    'bv*+ba/b',

    /*
     * Salida MP4
     */
    '--merge-output-format',
    'mp4',

    /*
     * FFmpeg incluido
     */
    '--ffmpeg-location',
    path.dirname(ffmpeg),

    /*
     * Nombre controlado
     */
    '-o',
    outputTemplate,

    /*
     * URL
     */
    url
  ];


  return await new Promise(
    (resolve, reject) => {

      sendYoutubeProgress(
        0,
        'Conectando con YouTube…',
        'start'
      );


      const processYtdlp =
        spawn(
          ytdlp,
          args,
          {
            windowsHide: true
          }
        );


      let stderr = '';
      let stdout = '';

      let finished = false;


      /*
       * Analizar progreso
       */

      function parseProgress(text) {

        if (!text) return;


        const matches =
          text.match(
            /(\d+(?:\.\d+)?)%/g
          );


        if (
          matches &&
          matches.length
        ) {

          const last =
            matches[
              matches.length - 1
            ];


          const percent =
            Number(
              last.replace(
                '%',
                ''
              )
            );


          if (
            Number.isFinite(
              percent
            )
          ) {

            sendYoutubeProgress(

              Math.max(
                0,
                Math.min(
                  100,
                  percent
                )
              ),

              `Descargando video… ${percent.toFixed(0)}%`,

              'download'
            );
          }
        }


        /*
         * Detectar merge
         */

        if (
          /Merging formats/i.test(
            text
          ) ||
          /Merger/i.test(
            text
          )
        ) {

          sendYoutubeProgress(
            100,
            'Procesando video…',
            'merge'
          );
        }
      }


      /*
       * STDOUT
       */

      processYtdlp.stdout.on(
        'data',
        data => {

          const text =
            data.toString();

          stdout += text;

          parseProgress(text);
        }
      );


      /*
       * STDERR
       */

      processYtdlp.stderr.on(
        'data',
        data => {

          const text =
            data.toString();

          stderr += text;

          parseProgress(text);
        }
      );


      /*
       * Error de proceso
       */

      processYtdlp.on(
        'error',
        error => {

          if (finished)
            return;

          finished = true;

          reject(error);
        }
      );


      /*
       * Proceso terminado
       */

      processYtdlp.on(
        'close',
        code => {

          if (finished)
            return;

          finished = true;


          /*
           * Error yt-dlp
           */

          if (
            code !== 0
          ) {

            const details =
              stderr.trim() ||
              stdout.trim() ||
              `yt-dlp terminó con código ${code}`;


            sendYoutubeProgress(
              0,
              'No se pudo descargar el video.',
              'error'
            );


            return reject(
              new Error(
                details
              )
            );
          }


          /*
           * yt-dlp terminó correctamente.
           */

          sendYoutubeProgress(
            100,
            'Finalizando video…',
            'finalize'
          );


          /*
           * Buscar el archivo esperado.
           */

          if (
            fs.existsSync(
              finalMp4
            )
          ) {

            sendYoutubeProgress(
              100,
              'Video listo.',
              'done'
            );


            return resolve({

              ok: true,

              fileUrl:
                'file:///' +
                finalMp4
                  .replace(
                    /\\/g,
                    '/'
                  )
                  .replace(
                    /#/g,
                    '%23'
                  ),

              path:
                finalMp4,

              name:
                path.basename(
                  finalMp4
                )
            });
          }


          /*
           * FALLBACK
           *
           * Por seguridad buscamos
           * cualquier MP4 reciente.
           */

          let candidates = [];


          try {

            candidates =
              fs
                .readdirSync(dir)

                .filter(
                  file =>
                    file
                      .toLowerCase()
                      .endsWith(
                        '.mp4'
                      )
                )

                .map(
                  file => ({

                    file,

                    fullPath:
                      path.join(
                        dir,
                        file
                      ),

                    time:
                      (() => {

                        try {

                          return fs
                            .statSync(
                              path.join(
                                dir,
                                file
                              )
                            )
                            .mtimeMs;

                        } catch {

                          return 0;
                        }

                      })()
                  })
                )

                .sort(
                  (a, b) =>
                    b.time -
                    a.time
                );

          } catch {}


          /*
           * Encontramos un MP4.
           */

          if (
            candidates.length > 0
          ) {

            const selected =
              candidates[0]
                .fullPath;


            sendYoutubeProgress(
              100,
              'Video listo.',
              'done'
            );


            return resolve({

              ok: true,

              fileUrl:
                'file:///' +
                selected
                  .replace(
                    /\\/g,
                    '/'
                  )
                  .replace(
                    /#/g,
                    '%23'
                  ),

              path:
                selected,

              name:
                path.basename(
                  selected
                )
            });
          }


          /*
           * yt-dlp terminó correctamente
           * pero no encontramos MP4.
           */

          reject(
            new Error(
              'yt-dlp terminó correctamente, pero CLIP APP no encontró el MP4 generado.'
            )
          );
        }
      );
    });
}


/* =========================================================
   IPC YOUTUBE
   ========================================================= */

ipcMain.handle(
  'youtube-download',
  async (_event, url) => {

    try {

      const result =
        await runYoutube(
          url
        );

      return result;

    } catch (error) {

      const message =
        error?.message ||
        String(error);


      console.error(
        '[CLIP APP] Error YouTube:',
        message
      );


      sendYoutubeProgress(
        0,
        `Error: ${message}`,
        'error'
      );


      return {
        ok: false,
        error: message
      };
    }
  }
);


/* =========================================================
   EXPORTACIÓN
   ========================================================= */

ipcMain.handle(
  'export-start',
  async (_event, name) => {

    const dir =
      ensureDir(
        path.join(
          app.getPath('videos'),
          'CLIP APP'
        )
      );


    const base =
      safeName(
        name ||
        `CLIPAPP-${Date.now()}`
      );


    exportTemp =
      path.join(
        app.getPath('temp'),
        `CLIPAPP-${Date.now()}.webm`
      );


    exportStream =
      fs.createWriteStream(
        exportTemp
      );


    return {

      ok: true,

      path:
        exportTemp,

      outDir:
        dir,

      base
    };
  }
);


/* =========================================================
   EXPORT CHUNK
   ========================================================= */

ipcMain.handle(
  'export-chunk',
  async (_event, chunk) => {

    if (!exportStream) {

      throw new Error(
        'No hay una exportación iniciada.'
      );
    }


    const buffer =
      Buffer.from(
        chunk
      );


    await new Promise(
      (resolve, reject) => {

        exportStream.write(
          buffer,
          error => {

            if (error) {
              reject(error);
            } else {
              resolve();
            }
          }
        );
      }
    );


    return {
      ok: true
    };
  }
);


/* =========================================================
   EXPORT FINISH
   ========================================================= */

ipcMain.handle(
  'export-finish',
  async (
    _event,
    meta = {}
  ) => {

    if (
      !exportStream ||
      !exportTemp
    ) {

      throw new Error(
        'No hay datos de exportación.'
      );
    }


    const stream =
      exportStream;

    const input =
      exportTemp;


    exportStream = null;
    exportTemp = null;


    /*
     * Terminar WebM
     */

    await new Promise(
      (resolve, reject) => {

        stream.end(
          error => {

            if (error) {
              reject(error);
            } else {
              resolve();
            }
          }
        );
      }
    );


    /*
     * Carpeta de salida
     */

    const dir =
      ensureDir(
        path.join(
          app.getPath('videos'),
          'CLIP APP'
        )
      );


    /*
     * Nombre
     */

    const base =
      safeName(
        meta.base ||
        `CLIPAPP-${Date.now()}`
      );


    const out =
      path.join(
        dir,
        `${base}.mp4`
      );


    /*
     * FFmpeg
     */

    const ffmpeg =
      tool('ffmpeg.exe');


    if (
      !fs.existsSync(
        ffmpeg
      )
    ) {

      throw new Error(
        `No se encontró ffmpeg.exe:\n${ffmpeg}`
      );
    }


    /*
     * Convertir WebM → MP4
     */

    await new Promise(
      (resolve, reject) => {

        const args = [

          '-y',

          '-i',
          input,

          '-c:v',
          'libx264',

          '-preset',
          'medium',

          '-crf',
          '18',

          '-pix_fmt',
          'yuv420p',

          '-c:a',
          'aac',

          '-b:a',
          '192k',

          '-movflags',
          '+faststart',

          out
        ];


        const processFfmpeg =
          spawn(
            ffmpeg,
            args,
            {
              windowsHide: true
            }
          );


        let errorText = '';


        processFfmpeg.stderr.on(
          'data',
          data => {

            errorText +=
              data.toString();
          }
        );


        processFfmpeg.on(
          'error',
          reject
        );


        processFfmpeg.on(
          'close',
          code => {

            if (
              code === 0
            ) {

              resolve();

            } else {

              reject(
                new Error(
                  errorText.slice(
                    -3000
                  ) ||
                  `FFmpeg terminó con código ${code}`
                )
              );
            }
          }
        );
      }
    );


    /*
     * Eliminar WebM temporal
     */

    try {
      fs.unlinkSync(
        input
      );
    } catch {}


    return {

      ok: true,

      path:
        out
    };
  }
);


/* =========================================================
   ELECTRON
   ========================================================= */

app.whenReady().then(
  () => {

    /*
     * Permisos
     */

    session
      .defaultSession
      .setPermissionRequestHandler(
        (
          _webContents,
          _permission,
          callback
        ) => {

          callback(true);
        }
      );


    /*
     * Crear ventana
     */

    createWindow();

    /*
     * Calentar el servidor PO Token desde el arranque.
     * runYoutube() vuelve a comprobarlo, así que si el usuario
     * pulsa YouTube inmediatamente, esperará hasta que esté listo.
     */
    ensurePotServer().catch(error => {
      console.error(
        '[CLIP APP] No se pudo iniciar el servidor PO Token al arrancar:',
        error?.message || error
      );
    });


    /*
     * macOS
     */

    app.on(
      'activate',
      () => {

        if (
          BrowserWindow
            .getAllWindows()
            .length === 0
        ) {

          createWindow();
        }
      }
    );
  }
);


/* =========================================================
   CERRAR
   ========================================================= */

app.on('before-quit', () => {
  if (potServer && !potServer.killed) {
    try {
      potServer.kill();
    } catch {}
  }

  potServer = null;
  potServerStarting = null;
});

app.on(
  'window-all-closed',
  () => {

    if (
      process.platform !== 'darwin'
    ) {

      app.quit();
    }
  }
);