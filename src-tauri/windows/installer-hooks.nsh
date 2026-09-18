; Close the app and its bundled Python (Camoufox / 17track) before NSIS
; overwrites python\Lib\site-packages\*.pyd. Those files stay locked if a
; python.exe child outlives Profile Generator.exe.

!macro StopBundledPython
  nsExec::ExecToLog 'taskkill /F /T /IM "Profile Generator.exe"'
  Pop $0
  nsExec::ExecToLog 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$$paths = @(''$INSTDIR\python\python.exe'', ''$INSTDIR\python\pythonw.exe''); Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and ($$paths -contains $$_.ExecutablePath) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $0
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping Profile Generator and bundled Python..."
  !insertmacro StopBundledPython
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping Profile Generator and bundled Python..."
  !insertmacro StopBundledPython
!macroend
