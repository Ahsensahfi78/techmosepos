# Lists the jobs currently queued for a printer (read-only).
param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [string]$OutFile
)

$ErrorActionPreference = 'SilentlyContinue'

$result = [ordered]@{
    ok      = $true
    printer = $PrinterName
    error   = $null
    jobs    = @()
}

$jobs = @(Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue)
if (-not $jobs -and -not (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue)) {
    $result.ok = $false
    $result.error = "Printer '$PrinterName' was not found"
}

foreach ($j in $jobs) {
    $result.jobs += [ordered]@{
        id            = [int]$j.Id
        name          = "$($j.Name)"
        status        = "$($j.JobStatus)"
        user          = "$($j.Submitter)"
        document_name = "$($j.DocumentName)"
        submitted     = if ($j.SubmittedTime) { $j.SubmittedTime.ToString('o') } else { $null }
        total_pages   = [int]$j.TotalPages
        pages_printed = [int]$j.PagesPrinted
    }
}

$json = $result | ConvertTo-Json -Depth 6 -Compress
if ($OutFile) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutFile, $json, $enc)
}
[Console]::Out.Write($json)
