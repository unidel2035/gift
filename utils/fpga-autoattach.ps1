# fpga-autoattach.ps1 — Автоматический attach Tang Nano 9K в WSL2
# Запускать: Task Scheduler → При входе в систему → Run as Administrator
# Action: powershell.exe -ExecutionPolicy Bypass -File "C:\...\fpga-autoattach.ps1"

$VID_PID = "0403:6010"
$MAX_WAIT = 30  # секунд ожидания платы

Write-Host "fpga-autoattach: ожидаю Tang Nano 9K ($VID_PID)..."

for ($i = 0; $i -lt $MAX_WAIT; $i++) {
    $list = usbipd list 2>$null
    $line = $list | Select-String $VID_PID
    if ($line) {
        $busid = ($line -split '\s+')[0].Trim()
        Write-Host "  Найдена: BUSID $busid"
        
        # Bind если нужно
        $state = ($line -split '\s+')[-1].Trim()
        if ($state -eq "Not" -or $line -match "Not shared") {
            Write-Host "  Bind..."
            usbipd bind --busid $busid
            Start-Sleep -Seconds 1
        }
        
        # Attach
        Write-Host "  Attach → WSL..."
        usbipd attach --wsl --busid $busid
        Write-Host "  Готово: Tang Nano 9K подключена в WSL2"
        exit 0
    }
    Start-Sleep -Seconds 1
}

Write-Host "  Плата не найдена за $MAX_WAIT секунд"
exit 1
