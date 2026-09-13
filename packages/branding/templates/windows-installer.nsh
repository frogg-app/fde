; Branded one-click Windows installer, included through electron-builder `nsis.include`.
;
; brand:prepare copies this file next to a generated brand.nsh and per-DPI artwork.
; Every product string, colour and image comes from those generated files: keep
; product names, copy and colours out of this template.
;
; Behaviour:
;  * One-click, per-user. The stock SpiderBanner progress page is restyled into a small
;    frameless window: brand artwork, name, tagline, a thin accent progress bar and
;    status copy, ending in a success state before the app launches.
;  * A pre-existing per-machine install (HKLM uninstall key for the same app GUID) is
;    removed once, elevated, with /KEEP_APP_DATA --updated, before the per-user copy is
;    written. If elevation is refused the installer stops rather than leave two copies.
;  * Silent runs (/S, electron-updater `--updated --force-run`) skip every UI call.

!ifndef BRAND_INSTALLER_NSH
!define BRAND_INSTALLER_NSH
!define BRAND_INSTALLER_DIR "${__FILEDIR__}"
!include "${BRAND_INSTALLER_DIR}/brand.nsh"

!ifndef BUILD_UNINSTALLER

!include LogicLib.nsh
!include WinMessages.nsh
; Replacing customCheckAppRunning skips this include in allowOnlyOneInstallerInstance.nsh.
!include "getProcessInfo.nsh"
Var pid

ManifestDPIAware true

Var brandScale
Var brandPage
Var brandStatus
Var brandProgress
Var brandDone
Var brandFontTitle
Var brandFontBody
Var brandFontStatus

!define MUI_CUSTOMFUNCTION_GUIINIT brandInstallerGuiInit
!define MUI_PAGE_CUSTOMFUNCTION_SHOW brandInstallerShow

!define /ifndef BRAND_WS_CHILD_VISIBLE 0x50000000
!define /ifndef BRAND_WS_CLIPSIBLINGS 0x04000000
!define /ifndef BRAND_SS_CENTER_NOPREFIX 0x00000081
!define /ifndef BRAND_SS_BITMAP 0x0000000E
!define /ifndef BRAND_STM_SETIMAGE 0x0172
!define /ifndef BRAND_PBM_SETBARCOLOR 0x0409
!define /ifndef BRAND_PBM_SETBKCOLOR 0x2001

; Scales a logical coordinate by the selected DPI bucket.
!macro brandScaled VALUE OUT
  IntOp ${OUT} ${VALUE} * $brandScale
  IntOp ${OUT} ${OUT} / 100
!macroend

; STATIC control on the page: TEXT X Y W H FONT FG BG OUT
!macro brandLabel TEXT X Y W H FONT FG BG OUT
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  !insertmacro brandScaled ${X} $R0
  !insertmacro brandScaled ${Y} $R1
  !insertmacro brandScaled ${W} $R2
  !insertmacro brandScaled ${H} $R3
  IntOp $9 ${BRAND_WS_CHILD_VISIBLE} | ${BRAND_WS_CLIPSIBLINGS}
  IntOp $9 $9 | ${BRAND_SS_CENTER_NOPREFIX}
  StrCpy $8 "${TEXT}"
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w r8, i r9, i R0, i R1, i R2, i R3, p $brandPage, p 0, p 0, p 0) p.s'
  Pop $9
  SendMessage $9 ${WM_SETFONT} ${FONT} 1
  SetCtlColors $9 ${FG} ${BG}
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  StrCpy ${OUT} $9
!macroend

; Face, logical point size, weight -> font handle in OUT.
!macro brandFont FACE SIZE WEIGHT OUT
  IntOp $9 ${SIZE} * $brandScale
  IntOp $9 $9 * 96
  IntOp $9 $9 / 7200
  IntOp $9 0 - $9
  System::Call 'gdi32::CreateFontW(i r9, i 0, i 0, i 0, i ${WEIGHT}, i 0, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "${FACE}") p.s'
  Pop ${OUT}
!macroend

Function brandInstallerGuiInit
  ; Pick the closest artwork bucket to the system DPI (the installer is DPI aware).
  System::Call 'user32::GetDC(p 0) p.r0'
  System::Call 'gdi32::GetDeviceCaps(p r0, i 90) i.r1'
  System::Call 'user32::ReleaseDC(p 0, p r0)'
  IntOp $1 $1 * 100
  IntOp $1 $1 / 96
  ${If} $1 < 113
    StrCpy $brandScale 100
  ${ElseIf} $1 < 138
    StrCpy $brandScale 125
  ${ElseIf} $1 < 175
    StrCpy $brandScale 150
  ${Else}
    StrCpy $brandScale 200
  ${EndIf}
  InitPluginsDir
  File "/oname=$PLUGINSDIR\brand-background-100.bmp" "${BRAND_INSTALLER_DIR}/background-100.bmp"
  File "/oname=$PLUGINSDIR\brand-background-125.bmp" "${BRAND_INSTALLER_DIR}/background-125.bmp"
  File "/oname=$PLUGINSDIR\brand-background-150.bmp" "${BRAND_INSTALLER_DIR}/background-150.bmp"
  File "/oname=$PLUGINSDIR\brand-background-200.bmp" "${BRAND_INSTALLER_DIR}/background-200.bmp"
  !insertmacro brandFont "Segoe UI" 20 600 $brandFontTitle
  !insertmacro brandFont "Segoe UI" 10 400 $brandFontBody
  !insertmacro brandFont "Segoe UI" 9 400 $brandFontStatus
  ; Start fully transparent: the stock SpiderBanner dialog is created on this window
  ; before any install hook runs. customCheckAppRunning hides it and fades the window in.
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i.r0'
  IntOp $0 $0 | 0x00080000 ; WS_EX_LAYERED
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i r0)'
  System::Call 'user32::SetLayeredWindowAttributes(p $HWNDPARENT, i 0, i 0, i 2)'
  Call brandFrameWindow
FunctionEnd

; Frameless, centred, rounded (Windows 11) main window at the branded size.
Function brandFrameWindow
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -16) i.r0'
  IntOp $1 0x00CC0000 ~ ; WS_CAPTION | WS_THICKFRAME
  IntOp $0 $0 & $1
  IntOp $1 0x00030000 ~ ; WS_MINIMIZEBOX | WS_MAXIMIZEBOX
  IntOp $0 $0 & $1
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -16, i r0)'
  System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i.r0'
  IntOp $1 0x00020201 ~ ; WS_EX_STATICEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME
  IntOp $0 $0 & $1
  System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i r0)'
  !insertmacro brandScaled ${BRAND_INSTALLER_WIDTH} $2
  !insertmacro brandScaled ${BRAND_INSTALLER_HEIGHT} $3
  System::Call 'user32::GetSystemMetrics(i 0) i.r4'
  System::Call 'user32::GetSystemMetrics(i 1) i.r5'
  IntOp $4 $4 - $2
  IntOp $4 $4 / 2
  IntOp $5 $5 - $3
  IntOp $5 $5 / 2
  ; SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r4, i r5, i r2, i r3, i 0x34)'
  ; DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND; ignored before Windows 11.
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, *i 2, i 4)'
  ; Dark title-bar hint keeps the taskbar thumbnail consistent.
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  ; Hide the stock chrome (buttons, branding text, header) on the outer dialog.
  StrCpy $0 0
  ${Do}
    FindWindow $0 "" "" $HWNDPARENT $0
    ${If} $0 == 0
      ${Break}
    ${EndIf}
    System::Call 'user32::GetClassNameW(p r0, w .r1, i 64)'
    ${If} $1 != "#32770"
      ShowWindow $0 ${SW_HIDE}
    ${EndIf}
  ${Loop}
FunctionEnd

Function brandInstallerShow
  FindWindow $brandPage "#32770" "" $HWNDPARENT
  !insertmacro brandScaled ${BRAND_INSTALLER_WIDTH} $2
  !insertmacro brandScaled ${BRAND_INSTALLER_HEIGHT} $3
  System::Call 'user32::SetWindowPos(p $brandPage, p 0, i 0, i 0, i r2, i r3, i 0x14)'
  ; Stock instfiles controls: status text, details list, details button, header text.
  GetDlgItem $0 $brandPage 1006
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $brandPage 1016
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $brandPage 1027
  ShowWindow $0 ${SW_HIDE}

  ; Solid background, bottom of the z-order.
  !insertmacro brandLabel "" 0 0 ${BRAND_INSTALLER_WIDTH} ${BRAND_INSTALLER_HEIGHT} $brandFontBody ${BRAND_INSTALLER_COLOR_FOREGROUND} ${BRAND_INSTALLER_COLOR_BACKGROUND} $0
  StrCpy $7 $0
  ; Hero artwork with the brand mark, rendered at this DPI bucket by brand:prepare.
  IntOp $9 ${BRAND_WS_CHILD_VISIBLE} | ${BRAND_WS_CLIPSIBLINGS}
  IntOp $9 $9 | ${BRAND_SS_BITMAP}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i r9, i 0, i 0, i 0, i 0, p $brandPage, p 0, p 0, p 0) p.r6'
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\brand-background-$brandScale.bmp", i 0, i 0, i 0, i 0x10) p.r1'
  SendMessage $6 ${BRAND_STM_SETIMAGE} 0 $1

  !insertmacro brandLabel "${BRAND_INSTALLER_NAME}" 20 140 400 40 $brandFontTitle ${BRAND_INSTALLER_COLOR_FOREGROUND} ${BRAND_INSTALLER_COLOR_BACKGROUND} $0
  !insertmacro brandLabel "${BRAND_INSTALLER_TAGLINE}" 20 182 400 22 $brandFontBody ${BRAND_INSTALLER_COLOR_MUTED_FOREGROUND} ${BRAND_INSTALLER_COLOR_BACKGROUND} $0
  !insertmacro brandLabel "${BRAND_INSTALLER_COPY_INSTALLING}" 20 254 400 20 $brandFontStatus ${BRAND_INSTALLER_COLOR_MUTED_FOREGROUND} ${BRAND_INSTALLER_COLOR_BACKGROUND} $brandStatus

  ; Thin, flat, brand-coloured progress bar: unthemed so bar colours apply.
  GetDlgItem $brandProgress $brandPage 1004
  System::Call 'uxtheme::SetWindowTheme(p $brandProgress, w " ", w " ")'
  System::Call 'user32::GetWindowLongW(p $brandProgress, i -16) i.r0'
  IntOp $1 0x00800000 ~ ; WS_BORDER
  IntOp $0 $0 & $1
  IntOp $0 $0 | ${BRAND_WS_CLIPSIBLINGS}
  IntOp $0 $0 | 1 ; PBS_SMOOTH
  System::Call 'user32::SetWindowLongW(p $brandProgress, i -16, i r0)'
  System::Call 'user32::GetWindowLongW(p $brandProgress, i -20) i.r0'
  IntOp $1 0x00020200 ~
  IntOp $0 $0 & $1
  System::Call 'user32::SetWindowLongW(p $brandProgress, i -20, i r0)'
  SendMessage $brandProgress ${BRAND_PBM_SETBARCOLOR} 0 ${BRAND_INSTALLER_COLORREF_ACCENT}
  SendMessage $brandProgress ${BRAND_PBM_SETBKCOLOR} 0 ${BRAND_INSTALLER_COLORREF_SURFACE}
  !insertmacro brandScaled 80 $2
  !insertmacro brandScaled 234 $3
  !insertmacro brandScaled 280 $4
  !insertmacro brandScaled 4 $5
  ${If} $5 < 3
    StrCpy $5 3
  ${EndIf}
  ; HWND_TOP, SWP_FRAMECHANGED | SWP_SHOWWINDOW
  System::Call 'user32::SetWindowPos(p $brandProgress, p 0, i r2, i r3, i r4, i r5, i 0x60)'
  ; Finished state bar, revealed by customInstall. Windows must be created on this UI
  ; thread: the install section runs on a worker thread without a message loop.
  !insertmacro brandLabel "" 80 234 280 4 $brandFontStatus ${BRAND_INSTALLER_COLOR_SUCCESS} ${BRAND_INSTALLER_COLOR_SUCCESS} $brandDone
  !insertmacro brandScaled 80 $2
  !insertmacro brandScaled 234 $3
  System::Call 'user32::SetWindowPos(p $brandDone, p 0, i r2, i r3, i r4, i r5, i 0x80)'
  ; Background stays at the bottom so it never paints over its siblings.
  System::Call 'user32::SetWindowPos(p r6, p 1, i 0, i 0, i 0, i 0, i 0x13)'
  System::Call 'user32::SetWindowPos(p r7, p 1, i 0, i 0, i 0, i 0, i 0x13)'
FunctionEnd

!macro brandSetStatus TEXT
  ${IfNot} ${Silent}
  ${AndIf} $brandStatus != ""
    SendMessage $brandStatus ${WM_SETTEXT} 0 "STR:${TEXT}"
  ${EndIf}
!macroend

; SpiderBanner::Show runs just before this hook and adds its own dialog; hide it and
; keep the branded frame, then run the stock running-app check.
!macro customCheckAppRunning
  ${IfNot} ${Silent}
    FindWindow $0 "#32770" "" $HWNDPARENT
    FindWindow $0 "#32770" "" $HWNDPARENT $0
    ${If} $0 != 0
      ShowWindow $0 ${SW_HIDE}
    ${EndIf}
    Call brandFrameWindow
    ShowWindow $brandPage ${SW_SHOW}
    ; Fade in, then drop WS_EX_LAYERED so later painting is not composited.
    ${For} $1 1 8
      IntOp $2 $1 * 32
      System::Call 'user32::SetLayeredWindowAttributes(p $HWNDPARENT, i 0, i r2, i 2)'
      Sleep 16
    ${Next}
    System::Call 'user32::SetLayeredWindowAttributes(p $HWNDPARENT, i 0, i 255, i 2)'
    System::Call 'user32::GetWindowLongW(p $HWNDPARENT, i -20) i.r0'
    IntOp $1 0x00080000 ~
    IntOp $0 $0 & $1
    System::Call 'user32::SetWindowLongW(p $HWNDPARENT, i -20, i r0)'
    System::Call 'user32::RedrawWindow(p $HWNDPARENT, p 0, p 0, i 0x0485)'
  ${EndIf}
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !insertmacro brandMigratePerMachineInstall
!macroend

; Removes an older per-machine copy so the per-user install never duplicates it.
; A macro, inserted in the install section after installUtil.nsh defines its helpers.
!macro brandMigratePerMachineInstall
  ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ${If} $R8 == ""
      ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    ${EndIf}
  !endif
  ${If} $R8 == ""
    Goto brandMigrateDone
  ${EndIf}
  !insertmacro GetInQuotes $R7 "$R8"
  ${If} $R7 == ""
  ${OrIfNot} ${FileExists} "$R7"
    DetailPrint "Ignoring per-machine registration without an uninstaller."
    Goto brandMigrateDone
  ${EndIf}
  ReadRegStr $R9 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R9 == ""
    Push $R7
    Call GetFileParent
    Pop $R9
  ${EndIf}
  !insertmacro brandSetStatus "${BRAND_INSTALLER_COPY_MIGRATING}"
  CopyFiles /SILENT "$R7" "$PLUGINSDIR\per-machine-uninstaller.exe"

  brandElevate:
  ; SEE_MASK_NOCLOSEPROCESS; "runas" shows one UAC prompt for the uninstaller only.
  StrCpy $4 "$PLUGINSDIR\per-machine-uninstaller.exe"
  StrCpy $5 "/S /KEEP_APP_DATA /allusers --updated _?=$R9"
  System::Call '*(&l4, i 0x40, p $HWNDPARENT, w "runas", w r4, w r5, p 0, i 0, p 0, p 0, p 0, p 0, i 0, p 0, p 0) p.r0'
  System::Call 'shell32::ShellExecuteExW(p r0) i.r1 ?e'
  Pop $3
  ${If} $1 == 0
    System::Free $0
    DetailPrint "Elevation for the per-machine uninstaller failed: $3"
    ${If} ${Silent}
      SetErrorLevel 2
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${BRAND_INSTALLER_COPY_ELEVATION_REQUIRED}" /SD IDCANCEL IDRETRY brandElevate
    SetErrorLevel 2
    Quit
  ${EndIf}
  System::Call '*$0(i, i, p, p, p, p, p, i, p, p, p, p, i, p, p .r2)'
  System::Free $0
  ${If} $2 != 0
    System::Call 'kernel32::WaitForSingleObject(p r2, i -1)'
    System::Call 'kernel32::CloseHandle(p r2)'
  ${EndIf}

  ; Success is the registration disappearing, not the exit code of an old uninstaller.
  ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $R8 != ""
    ${If} ${Silent}
      SetErrorLevel 2
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${BRAND_INSTALLER_COPY_ELEVATION_REQUIRED}" /SD IDCANCEL IDRETRY brandElevate
    SetErrorLevel 2
    Quit
  ${EndIf}
  !insertmacro brandSetStatus "${BRAND_INSTALLER_COPY_INSTALLING}"
  brandMigrateDone:
!macroend

; Fresh per-user installs use the brand folder name rather than the npm package name.
!macro customInit
  ReadRegStr $R0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro GetDParameter $R1
  ${If} $R0 == ""
  ${AndIf} $R1 == ""
    ${GetParent} "$INSTDIR" $R2
    StrCpy $INSTDIR "$R2\${BRAND_INSTALLER_INSTALL_DIR_NAME}"
  ${EndIf}
!macroend

; Files and shortcuts are in place: show the finished state before the app launches.
!macro customInstall
  ${IfNot} ${Silent}
  ${AndIf} $brandProgress != ""
    ; NSIS keeps driving the stock bar until the section ends, so show the full
    ; success bar created (hidden) on the UI thread instead.
    System::Call 'user32::SetWindowPos(p $brandDone, p 0, i 0, i 0, i 0, i 0, i 0x43)'
    SetCtlColors $brandStatus ${BRAND_INSTALLER_COLOR_SUCCESS} ${BRAND_INSTALLER_COLOR_BACKGROUND}
    !insertmacro brandSetStatus "${BRAND_INSTALLER_COPY_READY}"
    Sleep 900
    SetCtlColors $brandStatus ${BRAND_INSTALLER_COLOR_MUTED_FOREGROUND} ${BRAND_INSTALLER_COLOR_BACKGROUND}
    !insertmacro brandSetStatus "${BRAND_INSTALLER_COPY_LAUNCHING}"
    Sleep 350
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER
!endif ; BRAND_INSTALLER_NSH
