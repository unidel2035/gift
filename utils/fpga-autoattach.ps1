# fpga-autoattach.ps1 — USB-страж: Tang Nano 9K → WSL2 + окно терминала
#
# Запуск: Task Scheduler → At Startup → Run as Administrator → Hidden
# Реагирует на каждую вставку устройства 0403:6010 через WMI-событие.
#
# При обнаружении:
#   1. usbipd bind + attach --wsl --auto-attach
#   2. Открывает Windows Terminal с chip-connect в WSL2

$VID_PID    = "0403:6010"
$WSL_DISTRO = "Ubuntu"
$CHIP_CMD   = "node ~/gift/utils/chip-connect.mjs; echo ''; echo 'Нажми Enter для закрытия'; read"
$LOG        = "$env:TEMP\fpga-autoattach.log"

function Write-Log($msg) {
    $ts = (Get-Date).ToString("HH:mm:ss")
    "$ts  $msg" | Tee-Object -FilePath $LOG -Append | Out-Null
    Write-Host "$ts  $msg"
}

function Find-TangNano {
    $list = usbipd list 2>$null
    foreach ($line in $list) {
        if ($line -match $VID_PID) {
            $cols  = ($line -split '\s+') | Where-Object { $_ -ne '' }
            $busid = $cols[0]
            $state = $line -match 'Attached' ? 'Attached' : ($line -match 'Shared' ? 'Shared' : 'NotShared')
            return @{ BusId = $busid; State = $state; Line = $line }
        }
    }
    return $null
}

function Attach-TangNano {
    $dev = Find-TangNano
    if (-not $dev) {
        Write-Log "Tang Nano не найдена в usbipd list"
        return
    }

    Write-Log "Найдена: BUSID $($dev.BusId)  [$($dev.State)]"

    # Bind если не shared
    if ($dev.Line -notmatch 'Shared|Attached') {
        Write-Log "  bind..."
        usbipd bind --busid $dev.BusId 2>$null
        Start-Sleep -Milliseconds 700
    }

    # Detach если уже был attached (сброс для чистого переподключения)
    if ($dev.Line -match 'Attached') {
        Write-Log "  detach (сброс)..."
        usbipd detach --busid $dev.BusId 2>$null
        Start-Sleep -Milliseconds 500
    }

    # Attach с авто-реаттачем
    Write-Log "  attach --wsl --auto-attach..."
    Start-Process -NoNewWindow -FilePath "usbipd" `
        -ArgumentList "attach --wsl --busid $($dev.BusId) --auto-attach"
    Start-Sleep -Milliseconds 1200

    # Открыть Windows Terminal с chip-connect
    Write-Log "  открываю терминал WSL..."
    $wtArgs = @(
        "--title", "Tang Nano 9K",
        "-p", $WSL_DISTRO,
        "--", "bash", "-lc", $CHIP_CMD
    )
    $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($wt) {
        Start-Process wt.exe -ArgumentList $wtArgs
    } else {
        # fallback: обычный wsl.exe в новом окне
        Start-Process powershell.exe -ArgumentList `
            "-NoProfile -Command `"wsl.exe -d $WSL_DISTRO -- bash -lc '$CHIP_CMD'`""
    }

    Write-Log "  готово."
}

# ── Запуск ─────────────────────────────────────────────────────
Write-Log "fpga-autoattach запущен (WMI-мониторинг USB)"
Write-Log "Ожидаю Tang Nano 9K ($VID_PID)..."

# Проверить — вдруг уже подключена при старте
$dev = Find-TangNano
if ($dev) {
    Write-Log "Плата уже подключена при старте — attach сразу"
    Attach-TangNano
}

# WMI-подписка на вставку USB-устройства
$query = "SELECT * FROM __InstanceCreationEvent WITHIN 2 WHERE TargetInstance ISA 'Win32_PnPEntity'"
$watcher = New-Object System.Management.ManagementEventWatcher
$watcher.Query = New-Object System.Management.WqlEventQuery $query
$watcher.Options.Timeout = [System.TimeSpan]::MaxValue
$watcher.Start()

Write-Log "WMI watcher запущен. Жду событий вставки..."

while ($true) {
    try {
        $event = $watcher.WaitForNextEvent()
        $name  = $event.SourceEventArgs.NewEvent.TargetInstance.Name
        $devId = $event.SourceEventArgs.NewEvent.TargetInstance.DeviceID

        # Фильтр: только FTDI 0403:6010
        if ($devId -match "VID_0403" -and $devId -match "PID_6010") {
            Write-Log "USB событие: $name"
            Start-Sleep -Milliseconds 800  # дать Windows время зарегистрировать
            Attach-TangNano
        }
    } catch {
        Write-Log "Ошибка WMI: $_"
        Start-Sleep -Seconds 3
    }
}
