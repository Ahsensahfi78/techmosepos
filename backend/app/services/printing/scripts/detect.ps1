# Detects installed print queues, their connection/health signals and any
# physically attached USB printer that has no Windows print queue.
# Emits a single JSON document. Never modifies system state.
param(
    [string]$OutFile
)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing

function Write-Payload($Object) {
    $json = $Object | ConvertTo-Json -Depth 8 -Compress
    if ($OutFile) {
        $enc = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($OutFile, $json, $enc)
    }
    [Console]::Out.Write($json)
}

$result = [ordered]@{
    ok           = $true
    error        = $null
    platform     = 'windows'
    computer     = $env:COMPUTERNAME
    ps_version   = $PSVersionTable.PSVersion.ToString()
    spooler      = $null
    printers     = @()
    unbound      = @()
    default_name = $null
}

$svc = Get-Service -Name 'Spooler' -ErrorAction SilentlyContinue
if ($svc) {
    $result.spooler = [ordered]@{ status = "$($svc.Status)"; start_type = "$($svc.StartType)" }
} else {
    $result.spooler = [ordered]@{ status = 'Missing'; start_type = 'Unknown' }
}

try {
    $d = Get-CimInstance -ClassName Win32_Printer -Filter 'Default=TRUE' -ErrorAction Stop | Select-Object -First 1
    if ($d) { $result.default_name = [string]$d.Name }
} catch { $result.default_name = $null }

# ---- device inventory -----------------------------------------------------
$presentIds = @{}
foreach ($d in @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue)) {
    $presentIds["$($d.InstanceId)".ToUpperInvariant()] = $true
}

$usbDevicesByPort = @{}
$printerDevices = @()
foreach ($d in @(Get-PnpDevice -ErrorAction SilentlyContinue)) {
    $id = [string]$d.InstanceId
    if (-not $id) { continue }
    $isPrinter = ($id -like 'USBPRINT\*') -or ("$($d.Class)" -in @('Printer', 'SoftwareDevice'))
    if (-not $isPrinter) { continue }
    $entry = [pscustomobject]@{
        id      = $id
        name    = "$($d.FriendlyName)"
        cls     = "$($d.Class)"
        status  = "$($d.Status)"
        present = [bool]$presentIds.ContainsKey($id.ToUpperInvariant())
        port    = $null
    }
    $printerDevices += $entry
    if ($id -like 'USBPRINT\*') {
        # USBPRINT\<device>\<instance-id ending in &USBnnn>
        $segments = $id -split '\\'
        if ($segments.Count -ge 3 -and $segments[$segments.Count - 1] -match '(?:^|&)(USB\d+)$') {
            $entry.port = $Matches[1]
            $usbDevicesByPort[$entry.port.ToUpperInvariant()] = $entry
        }
    }
}

$boundPorts = @{}
foreach ($p in @(Get-Printer -ErrorAction SilentlyContinue)) {
    $boundPorts["$($p.PortName)".ToUpperInvariant()] = $true
}

# USB printers plugged in that have no print queue bound to their port.
foreach ($e in @(Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue)) {
    $id = [string]$e.PNPDeviceID
    if (-not $id) { continue }
    $isUsbPrinter = ("$($e.Service)" -eq 'usbprint') -or ($id -like 'USBPRINT\*')
    if (-not $isUsbPrinter) { continue }

    $port = $null
    if ($id -like 'USBPRINT\*') {
        $segments = $id -split '\\'
        if ($segments.Count -ge 3 -and $segments[$segments.Count - 1] -match '(?:^|&)(USB\d+)$') {
            $port = $Matches[1]
        }
    }
    $hasQueue = $false
    if ($port -and $boundPorts.ContainsKey($port.ToUpperInvariant())) { $hasQueue = $true }

    $vid = $null; $devPid = $null
    if ($id -match 'VID_([0-9A-Fa-f]{4})') { $vid = $Matches[1].ToUpperInvariant() }
    if ($id -match 'PID_([0-9A-Fa-f]{4})') { $devPid = $Matches[1].ToUpperInvariant() }

    $desc = [string]$e.Description
    if (-not $desc) { $desc = [string]$e.Name }

    if (-not $hasQueue) {
        $busDesc = $null
        $svcName = $null
        $prop = Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc' -ErrorAction SilentlyContinue
        if ($prop -and $null -ne $prop.Data) { $busDesc = [string]$prop.Data }
        $svcProp = Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Service' -ErrorAction SilentlyContinue
        if ($svcProp -and $null -ne $svcProp.Data) { $svcName = [string]$svcProp.Data }
        if ($busDesc -and $desc -eq 'USB Printing Support') { $desc = $busDesc }
        $result.unbound += [ordered]@{
            instance_id         = $id
            description         = $desc
            bus_reported_desc   = $busDesc
            driver_service      = $svcName
            status              = "$($e.Status)"
            present             = [bool]$e.Present
            problem_code        = [int]$e.ConfigManagerErrorCode
            usb_vid             = $vid
            usb_pid             = $devPid
            port                = $port
            has_queue           = $hasQueue
        }
    }
}

# ---- print queues ---------------------------------------------------------
foreach ($p in @(Get-Printer -ErrorAction SilentlyContinue)) {
    $name = [string]$p.Name
    $port = [string]$p.PortName

    $conn = [ordered]@{
        kind           = 'unknown'
        port_monitor   = $null
        device_present = $null
        device_status  = $null
        device_name    = $null
        device_id      = $null
        usb_vid        = $null
        usb_pid        = $null
    }

    $pm = Get-PrinterPort -Name $port -ErrorAction SilentlyContinue
    if ($pm) { $conn.port_monitor = "$($pm.PortMonitor)" }

    if ($port -like 'USB*') {
        $conn.kind = 'usb'
        $entry = $null
        if ($usbDevicesByPort.ContainsKey($port.ToUpperInvariant())) {
            $entry = $usbDevicesByPort[$port.ToUpperInvariant()]
        }
        if ($entry) {
            $conn.device_present = $entry.present
            $conn.device_status  = $entry.status
            $conn.device_name    = $entry.name
            $conn.device_id      = $entry.id
        } else {
            $conn.device_present = $false
            $conn.device_status  = 'NotDetected'
        }
    } elseif ($port -like '\\\\*') {
        $conn.kind = 'network'
        $conn.device_status = 'Unknown'
    } elseif ($port -eq 'PORTPROMPT:' -or $port -eq 'FILE:' -or $port -like 'Microsoft.Office*') {
        $conn.kind = 'virtual'
        $conn.device_status = 'NotApplicable'
    } elseif ($port -eq 'nul:' -or $port -eq 'SHRFAX:') {
        $conn.kind = 'software'
        $conn.device_status = 'NotApplicable'
    } elseif ($port -like 'LPT*' -or $port -like 'COM*') {
        $conn.kind = 'parallel'
        $conn.device_status = 'Unknown'
    }

    $cap = [ordered]@{
        is_valid    = $false
        can_print   = $false
        is_offline  = $false
        duplex      = $null
        color       = $null
        copies      = $null
        resolutions = @()
        paper_sizes = @()
        default_paper = $null
        config      = $null
    }
    try {
        $ps = New-Object System.Drawing.Printing.PrinterSettings
        $ps.PrinterName = $name
        $cap.is_valid   = [bool]$ps.IsValid
        $cap.can_print  = [bool]$ps.CanPrint
        $cap.is_offline = [bool]$ps.IsOffline
        $cap.duplex     = "$($ps.Duplex)"
        $cap.color      = [bool]$ps.Color
        $cap.copies     = [int]$ps.Copies
        try {
            $dp = $ps.DefaultPageSettings.PaperSize
            if ($dp) {
                $cap.default_paper = [ordered]@{
                    name         = "$($dp.PaperName)"
                    width_100in  = [int]$dp.Width
                    height_100in = [int]$dp.Height
                    kind         = "$($dp.Kind)"
                }
            }
        } catch { }
        foreach ($r in @($ps.PrinterResolution)) {
            $cap.resolutions += [ordered]@{ kind = "$($r.Kind)"; x = [int]$r.X; y = [int]$r.Y }
        }
        foreach ($s in @($ps.PaperSizes)) {
            $cap.paper_sizes += [ordered]@{
                name         = "$($s.PaperName)"
                width_100in  = [int]$s.Width
                height_100in = [int]$s.Height
                kind         = "$($s.Kind)"
            }
        }
    } catch { }

    $cfg = Get-PrintConfiguration -PrinterName $name -ErrorAction SilentlyContinue
    if ($cfg) {
        $cap.config = [ordered]@{
            duplex      = "$($cfg.Duplex)"
            orientation = "$($cfg.Orientation)"
            media_size  = [int]$cfg.MediaSize
            color       = [bool]$cfg.Color
            copy_count  = [int]$cfg.CopyCount
            fit_to_page = [bool]$cfg.FitToPage
            pages_sheet = [int]$cfg.PagesPerSheet
        }
    }

    $jobCount = @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue).Count
    $processor = $null
    try { $processor = [string]$p.PrintProcessor } catch { $processor = $null }

    $wmi = Get-CimInstance -ClassName Win32_Printer -ErrorAction SilentlyContinue |
        Where-Object { [string]$_.Name -eq $name } | Select-Object -First 1

    $result.printers += [ordered]@{
        name            = $name
        driver          = [string]$p.DriverName
        port            = $port
        type            = "$($p.Type)"
        shared          = [bool]$p.Shared
        share_name      = [string]$p.ShareName
        location        = [string]$p.Location
        comment         = [string]$p.Comment
        print_processor = $processor
        queue_status    = "$($p.PrinterStatus)"
        attributes      = [int]$p.Attributes
        work_offline    = if ($wmi) { [bool]$wmi.WorkOffline } else { $false }
        is_default      = if ($wmi) { [bool]$wmi.Default } else { $false }
        detected_error  = if ($wmi) { [int]$wmi.DetectedErrorState } else { -1 }
        job_count       = $jobCount
        connection      = $conn
        capabilities    = $cap
    }
}

Write-Payload $result
