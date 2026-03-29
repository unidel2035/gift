@echo off
:: Запускать от имени Администратора!
powershell.exe -ExecutionPolicy Bypass -Command ^
  "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-ExecutionPolicy Bypass -WindowStyle Hidden -File \\\\wsl$\\Ubuntu\\home\\unidel\\gift\\utils\\fpga-autoattach.ps1';" ^
  "$trigger = New-ScheduledTaskTrigger -AtLogOn;" ^
  "$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1);" ^
  "$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest;" ^
  "Register-ScheduledTask -TaskName 'FpgaTangNanoAttach' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Tang Nano 9K autoattach WSL2' -Force;" ^
  "Write-Host 'Готово! Tang Nano 9K будет подключаться автоматически при входе в систему.'"
pause
