!include "MUI2.nsh"
!include "nsDialogs.nsh"

; =========================================================
; CLIP APP - CARPETA DE EXPORTACION
; Se ejecuta durante la instalacion mediante customInstall.
; =========================================================

!macro customInstall

    ; Carpeta predeterminada
    StrCpy $0 "$PROFILE\Videos\CLIP APP"

    ; Mensaje previo
    MessageBox MB_ICONINFORMATION|MB_OK \
        "CLIP APP te preguntará ahora dónde deseas guardar los videos exportados."

    ; Abrir selector de carpeta
    nsDialogs::SelectFolderDialog \
        "Selecciona la carpeta para tus videos exportados" \
        "$0"

    Pop $0

    ; Si cancela, usar carpeta predeterminada
    StrCmp $0 "error" 0 +2
        StrCpy $0 "$PROFILE\Videos\CLIP APP"

    ; Si queda vacío, usar carpeta predeterminada
    StrCmp $0 "" 0 +2
        StrCpy $0 "$PROFILE\Videos\CLIP APP"

    ; Crear carpeta elegida
    CreateDirectory "$0"

    ; Crear carpeta de configuracion
    CreateDirectory "$APPDATA\CLIP APP"

    ; Guardar configuracion
    FileOpen $1 "$APPDATA\CLIP APP\export-settings.ini" w
    FileWrite $1 "exportDirectory=$0$\r$\n"
    FileClose $1

!macroend
