@echo off
:: install-fpga-task.bat — установка USB-стража Tang Nano 9K
:: Запускать от имени АДМИНИСТРАТОРА

echo =========================================
echo  Tang Nano 9K — установка USB-стража
echo =========================================
echo.

:: Путь к скрипту через WSL UNC
set PS_SCRIPT=\\wsl$\Ubuntu\home\unidel\gift\utils\fpga-autoattach.ps1

:: Проверить что файл доступен
if not exist "%PS_SCRIPT%" (
    echo ОШИБКА: файл не найден: %PS_SCRIPT%
    echo Убедись что WSL Ubuntu запущена и путь ~/gift/utils/fpga-autoattach.ps1 существует
    pause
    exit /b 1
)

powershell.exe -ExecutionPolicy Bypass -Command ^
  "$ps = '%PS_SCRIPT%';" ^
  "$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $ps + '\"');" ^
  "$trigger = New-ScheduledTaskTrigger -AtStartup;" ^
  "$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable $true;" ^
  "$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest;" ^
  "Register-ScheduledTask -TaskName 'FpgaTangNanoAutoattach' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Tang Nano 9K: USB-демон, открывает терминал при вставке платы' -Force | Out-Null;" ^
  "Write-Host 'Задача установлена: FpgaTangNanoAutoattach';"

echo.
echo Запускаю сейчас (без перезагрузки)...
powershell.exe -ExecutionPolicy Bypass -Command ^
  "Start-ScheduledTask -TaskName 'FpgaTangNanoAutoattach';" ^
  "Write-Host 'Страж запущен. Вставь плату — откроется окно терминала.'"

echo.
echo Готово! Теперь при каждом подключении Tang Nano 9K:
echo   1. USB автоматически пробрасывается в WSL2
echo   2. Открывается окно Ubuntu с chip-connect
echo.
pause
