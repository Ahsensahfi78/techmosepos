<#
    status.ps1 - ask the printer for its own status and return the raw reply.

    Status is a printer-side fact, not a spooler fact: the queue reports
    `Normal` even while the ERROR LED is red, so the only way to learn what
    the hardware is complaining about is to write a query byte and read the
    bulk IN endpoint back.

    Read-only with respect to the machine; emits one JSON object on stdout.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    # Comma-separated hex bytes, e.g. "1B,72"
    [Parameter(Mandatory = $true)][string]$Query,
    [int]$ReadBytes = 8,
    [int]$TimeoutMs = 1500
)

$ErrorActionPreference = 'Stop'

$result = [ordered]@{
    ok       = $false
    printer  = $PrinterName
    query    = $Query
    written  = 0
    reply    = $null
    reply_hex = $null
    error    = $null
}

try {
    $parts = @($Query -split '[,\s]+' | Where-Object { $_ })
    $bytes = New-Object byte[] $parts.Count
    for ($i = 0; $i -lt $parts.Count; $i++) { $bytes[$i] = [Convert]::ToByte($parts[$i], 16) }

    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace PosPrinterStatus
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

            [DllImport("winspool.drv", SetLastError = true)]
            public static extern bool ReadPrinter(IntPtr hPrinter, byte[] pBuf, int cbBuf, out int pNoBytesRead);
        }
    }
'@

    $h = [IntPtr]::Zero
    if (-not [PosPrinterStatus.Native]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero)) {
        throw "OpenPrinter failed win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    try {
        # A bare WritePrinter outside a document is rejected with
        # ERROR_PRINT_CANCELLED (3003), so the query rides inside a
        # throwaway RAW document, exactly like a normal job would.
        $doc = New-Object PosPrinterStatus.DOC_INFO_1
        $doc.pDocName = 'POS status query'
        $doc.pDatatype = 'RAW'
        if (-not [PosPrinterStatus.Native]::StartDocPrinter($h, 1, [ref]$doc)) {
            throw "StartDocPrinter failed win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
        }
        try {
            [void][PosPrinterStatus.Native]::StartPagePrinter($h)
            $written = 0
            if (-not [PosPrinterStatus.Native]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) {
                throw "WritePrinter failed win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
            }
            $result.written = $written

            # Give the firmware a moment to put the answer on the IN pipe.
            $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
            $buf = New-Object byte[] $ReadBytes
            $n = 0
            while ([DateTime]::UtcNow -lt $deadline -and $n -eq 0) {
                Start-Sleep -Milliseconds 50
                $read = 0
                if ([PosPrinterStatus.Native]::ReadPrinter($h, $buf, $buf.Length, [ref]$read)) {
                    $n = $read
                } else {
                    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
                    if ($err -ne 0 -and $err -ne 1222) { break }  # ERROR_NO_MORE_ITEMS / busy
                }
            }

            [void][PosPrinterStatus.Native]::EndPagePrinter($h)

            if ($n -gt 0) {
                $slice = New-Object byte[] $n
                [Array]::Copy($buf, $slice, $n)
                $result.reply = ($slice | ForEach-Object { '{0:X2}' -f $_ }) -join ' '
                $result.reply_hex = ($slice | ForEach-Object { '{0:X2}' -f $_ }) -join ''
                $result.ok = $true
            } else {
                $result.error = "no reply within $TimeoutMs ms"
            }
        } finally {
            [void][PosPrinterStatus.Native]::EndDocPrinter($h)
        }
    } finally {
        [void][PosPrinterStatus.Native]::ClosePrinter($h)
    }
} catch {
    $result.error = $_.Exception.Message
}

ConvertTo-Json $result -Compress
if ($result.ok) { exit 0 } else { exit 4 }
