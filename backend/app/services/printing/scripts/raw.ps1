<#
    raw.ps1 - write bytes straight to a print queue with the RAW data type.

    This bypasses the printer driver (no rasterisation, no EMF, no driver
    filtering) so it can be used to answer a very specific question: does the
    physical device respond to bytes on its port at all?

    Read-only with respect to everything except the printer itself. Emits a
    single JSON object on stdout.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [string]$Text,
    [string]$TextPath,
    [string]$TextBase64,
    [int]$WaitSeconds = 0
)

$ErrorActionPreference = 'Stop'

$result = [ordered]@{
    ok            = $false
    printer       = $PrinterName
    bytes_written = 0
    error         = $null
    waited_ms     = 0
}

if (-not $Text -and -not $TextPath -and -not $TextBase64) {
    $result.error = 'One of -Text, -TextPath or -TextBase64 is required.'
    ConvertTo-Json $result -Compress
    exit 3
}

try {
    $bytes = $null
    if ($TextBase64) {
        $bytes = [Convert]::FromBase64String($TextBase64)
    } elseif ($TextPath) {
        $bytes = [System.IO.File]::ReadAllBytes($TextPath)
    } else {
        # ANSI/CP1252 bytes: printers on this port expect single-byte text.
        $bytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($Text)
    }

    if (-not $bytes -or $bytes.Length -eq 0) {
        $result.error = 'Payload is empty.'
        ConvertTo-Json $result -Compress
        exit 3
    }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace PosRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DOC_INFO_1
    {
        public string pDocName;
        public string pOutputFile;
        public string pDatatype;
    }

    public static class Native
    {
        [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true)]
        public static extern bool OpenPrinter(string szPrinter, out IntPtr phPrinter, IntPtr pDefault);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOC_INFO_1 pDocInfo);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBuf, int cbBuf, out int pcWritten);
    }
}
'@

    $h = [IntPtr]::Zero
    if (-not [PosRawPrinter.Native]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero)) {
        throw "OpenPrinter failed: $([ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
    }
    try {
        $doc = New-Object PosRawPrinter.DOC_INFO_1
        $doc.pDocName = "POS raw probe"
        $doc.pOutputFile = $null
        $doc.pDatatype = "RAW"
        if (-not [PosRawPrinter.Native]::StartDocPrinter($h, 1, [ref]$doc)) {
            throw "StartDocPrinter failed: $([ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
        }
        try {
            if (-not [PosRawPrinter.Native]::StartPagePrinter($h)) { throw "StartPagePrinter failed" }
            $written = 0
            $ok = [PosRawPrinter.Native]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)
            $winErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            if (-not [PosRawPrinter.Native]::EndPagePrinter($h)) { throw "EndPagePrinter failed" }
            if (-not $ok) {
                throw "WritePrinter failed: $([ComponentModel.Win32Exception]::new($winErr).Message) (win32=$winErr)"
            }
            $result.bytes_written = $written
        } finally {
            [void][PosRawPrinter.Native]::EndDocPrinter($h)
        }
    } finally {
        [void][PosRawPrinter.Native]::ClosePrinter($h)
    }

    if ($WaitSeconds -gt 0) {
        $t = [System.Diagnostics.Stopwatch]::StartNew()
        while ($t.Elapsed.TotalSeconds -lt $WaitSeconds) {
            Start-Sleep -Milliseconds 200
        }
        $result.waited_ms = [int]$t.ElapsedMilliseconds
    }

    $result.ok = $result.bytes_written -eq $bytes.Length
    if (-not $result.ok) {
        $result.error = "Wrote $($result.bytes_written) of $($bytes.Length) bytes."
    }
} catch {
    $result.error = $_.Exception.Message
}

ConvertTo-Json $result -Compress
if ($result.ok) { exit 0 } else { exit 4 }
