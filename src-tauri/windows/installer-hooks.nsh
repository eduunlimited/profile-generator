; Kill the app and leftover Camoufox / Python / Playwright processes before
; NSIS copies files. Do not use PowerShell $_ or $vars here — NSIS eats $.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping Profile Generator, bundled Python, and Camoufox..."
  nsExec::ExecToLog 'taskkill /F /T /IM "Profile Generator.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM python.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM pythonw.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM camoufox.exe'
  Pop $0
  nsExec::ExecToLog 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object ExecutablePath -Like ''*\Profile Generator\python\*'' | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  Sleep 2000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping Profile Generator, bundled Python, and Camoufox..."
  nsExec::ExecToLog 'taskkill /F /T /IM "Profile Generator.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM python.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM pythonw.exe'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM camoufox.exe'
  Pop $0
  nsExec::ExecToLog 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object ExecutablePath -Like ''*\Profile Generator\python\*'' | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  Sleep 2000
!macroend
