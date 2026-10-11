param(
    [Parameter(Mandatory = $true)][string]$LayoutPath,
    [int]$WaitSeconds = 0,
    [int]$PollIntervalMs = 400,
    [switch]$DryRun,
    [int]$DryRunDpi = 203,
    [string]$TsplOut,
    [double]$TsplGapMm = 2.0,
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Write-Payload($Object) {
    $json = $Object | ConvertTo-Json -Depth 6 -Compress
    if ($OutFile) {
        $enc = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($OutFile, $json, $enc)
    }
    [Console]::Out.Write($json)
}

function Get-ColorValue([string]$value, $fallback) {
    if (-not $value) { return $fallback }
    try {
        if ($value.StartsWith('#')) { return [System.Drawing.ColorTranslator]::FromHtml($value) }
        $c = [System.Drawing.Color]::FromName($value)
        if ($c.IsKnownColor) { return $c }
    } catch { }
    return $fallback
}

# $pxPerMm is pixels per millimetre ($sx / $sy), NOT a DPI value: passing DPI
# here would divide by 25.4 twice and shrink every item to 1/25.4 scale.
function Convert-MmToPx([double]$mm, [double]$pxPerMm) { return [double]$mm * $pxPerMm }

function Invoke-LayoutRender($g, $layout, $dpiOverride = $null) {
    $script:lastModulePx = $null
    $g.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
    # Crisp binary output suits thermal/label printers: no grey antialiasing
    # between bars, which is what a scanner sees.
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None

    $dpiX = [double]$g.DpiX
    $dpiY = [double]$g.DpiY
    if ($dpiOverride) { $dpiX = [double]$dpiOverride; $dpiY = [double]$dpiOverride }
    $sx = $dpiX / 25.4
    $sy = $dpiY / 25.4
    $g.Clear((Get-ColorValue ([string]$layout.background) ([System.Drawing.Color]::White)))

    foreach ($it in @($layout.items)) {
        $kind = [string]$it.kind
        $pen = $null
        $font = $null
        $brush = $null
        try {
            switch ($kind) {
                'text' {
                    $family = [string]$it.font
                    if (-not $family) { $family = 'Arial' }
                    $size = 10.0
                    if ($null -ne $it.size_pt) { $size = [double]$it.size_pt }
                    $style = [System.Drawing.FontStyle]::Regular
                    if ($it.bold) { $style = $style -bor [System.Drawing.FontStyle]::Bold }
                    if ($it.italic) { $style = $style -bor [System.Drawing.FontStyle]::Italic }
                    $font = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Point)
                    $brush = New-Object System.Drawing.SolidBrush((Get-ColorValue ([string]$it.color) ([System.Drawing.Color]::Black)))

                    $x = Convert-MmToPx ([double]$it.x_mm) $sx
                    $y = Convert-MmToPx ([double]$it.y_mm) $sy
                    $w = 0.0
                    if ($null -ne $it.w_mm) { $w = Convert-MmToPx ([double]$it.w_mm) $sx }

                    $txt = [string]$it.text
                    $align = [string]$it.align
                    if (-not $align) { $align = 'left' }

                    if ($w -gt 0 -and $align -ne 'left') {
                        $m = $g.MeasureString($txt, $font)
                        if ($align -eq 'center') { $x = $x + (($w - $m.Width) / 2) }
                        elseif ($align -eq 'right') { $x = $x + ($w - $m.Width) }
                    }

                    $flags = [System.Drawing.StringFormat]::GenericTypographic
                    $flags.Trimming = [System.Drawing.StringTrimming]::None
                    $flags.FormatFlags = $flags.FormatFlags -bor [System.Drawing.StringFormatFlags]::NoWrap
                    $g.DrawString($txt, $font, $brush, [float]$x, [float]$y, $flags)
                }
                'rect' {
                    $x = Convert-MmToPx ([double]$it.x_mm) $sx
                    $y = Convert-MmToPx ([double]$it.y_mm) $sy
                    $w = Convert-MmToPx ([double]$it.w_mm) $sx
                    $h = Convert-MmToPx ([double]$it.h_mm) $sy
                    $rect = New-Object System.Drawing.RectangleF([float]$x, [float]$y, [float]$w, [float]$h)
                    if ($it.fill) {
                        $brush = New-Object System.Drawing.SolidBrush((Get-ColorValue ([string]$it.fill) ([System.Drawing.Color]::Black)))
                        $g.FillRectangle($brush, $rect)
                    }
                    if ($it.outline) {
                        $ow = 0.75
                        if ($null -ne $it.outline_pt) { $ow = [double]$it.outline_pt }
                        $pen = New-Object System.Drawing.Pen((Get-ColorValue ([string]$it.outline) ([System.Drawing.Color]::Black)), [float]$ow)
                        $g.DrawRectangle($pen, $rect.X, $rect.Y, $rect.Width, $rect.Height)
                    }
                }
                'line' {
                    $x1 = Convert-MmToPx ([double]$it.x_mm) $sx
                    $y1 = Convert-MmToPx ([double]$it.y_mm) $sy
                    $x2 = Convert-MmToPx ([double]$it.x2_mm) $sx
                    $y2 = Convert-MmToPx ([double]$it.y2_mm) $sy
                    $lw = 0.75
                    if ($null -ne $it.width_pt) { $lw = [double]$it.width_pt }
                    $pen = New-Object System.Drawing.Pen((Get-ColorValue ([string]$it.color) ([System.Drawing.Color]::Black)), [float]$lw)
                    if ($it.dash) { $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash }
                    $g.DrawLine($pen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
                }
                'bars' {
                    # Quantise every module to a whole device dot so the bar /
                    # space ratio survives the rasteriser and stays scannable.
                    $x = Convert-MmToPx ([double]$it.x_mm) $sx
                    $y = Convert-MmToPx ([double]$it.y_mm) $sy
                    $w = Convert-MmToPx ([double]$it.w_mm) $sx
                    $h = Convert-MmToPx ([double]$it.h_mm) $sy
                    $modules = @($it.modules)
                    $count = $modules.Count
                    if ($count -gt 0) {
                        # Snap the module pitch to a whole number of device dots
                        # and re-centre, so every bar/space keeps the same width
                        # after rasterisation.
                        $unit = [math]::Max(1, [math]::Round($w / $count))
                        $total = $unit * $count
                        $x0 = [math]::Round($x + (($w - $total) / 2))
                        $y0 = [math]::Round($y)
                        $brush = New-Object System.Drawing.SolidBrush((Get-ColorValue ([string]$it.color) ([System.Drawing.Color]::Black)))
                        for ($i = 0; $i -lt $count; $i++) {
                            if ([int]$modules[$i] -ne 1) { continue }
                            $bx = $x0 + ($i * $unit)
                            $g.FillRectangle($brush, [float]$bx, [float]$y0, [float]$unit, [float][math]::Round($h))
                        }
                        $script:lastModulePx = [int]$unit
                    }
                }
            }
        } finally {
            if ($font) { $font.Dispose() }
            if ($brush) { $brush.Dispose() }
            if ($pen) { $pen.Dispose() }
        }
    }
    return $script:lastModulePx
}

<#
    Pack a rendered bitmap into TSPL `BITMAP` commands.

    The payload is chunked by rows: a full label at 203 dpi is tens of
    kilobytes of hex, which overflows the command buffer on most label
    firmware. Each chunk re-states its own Y origin so the printer stitches
    the bands back together.
#>
function Convert-BitmapToTspl($bm, [int]$x0 = 0, [int]$y0 = 0) {
    $w = [int]$bm.Width
    $h = [int]$bm.Height
    $wBytes = [int][math]::Ceiling($w / 8)
    # Keep every command under ~4 KB of hex.
    $rowsPerChunk = [math]::Max(1, [int][math]::Floor(4000 / [math]::Max(1, (2 * $wBytes))))

    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $bd = $bm.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $buf = $null
    try {
        $stride = [int]$bd.Stride
        $buf = New-Object byte[] ($stride * $h)
        [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $buf, 0, $buf.Length)
    } finally {
        $bm.UnlockBits($bd)
    }

    $out = New-Object System.Text.StringBuilder
    for ($y = 0; $y -lt $h; $y += $rowsPerChunk) {
        $rows = [math]::Min($rowsPerChunk, $h - $y)
        $hex = New-Object System.Text.StringBuilder
        for ($r = 0; $r -lt $rows; $r++) {
            $off = ($y + $r) * $stride
            for ($bx = 0; $bx -lt $wBytes; $bx++) {
                $byte = 0
                for ($bit = 0; $bit -lt 8; $bit++) {
                    $px = ($bx * 8) + $bit
                    if ($px -ge $w) { break }
                    $i = $off + ($px * 3)
                    # b, g, r — the render is binary (no antialiasing)
                    if ((($buf[$i] + $buf[$i + 1] + $buf[$i + 2]) / 3) -lt 160) {
                        $byte = $byte -bor (128 -shr $bit)
                    }
                }
                [void]$hex.Append(('{0:X2}' -f $byte))
            }
        }
        [void]$out.Append(('BITMAP {0},{1},{2},{3},0,{4}' -f $x0, ($y0 + $y), ($wBytes * 8), $rows, $hex.ToString()))
        [void]$out.Append("`r`n")
    }
    return $out.ToString()
}


$layout = Get-Content -LiteralPath $LayoutPath -Raw -Encoding UTF8 | ConvertFrom-Json
$printerName = [string]$layout.printer

$result = [ordered]@{
    ok                = $false
    printer           = $printerName
    mode              = 'print'
    job_id            = $null
    status            = 'NotSubmitted'
    error             = $null
    jobs_before       = @()
    jobs_after        = @()
    page_width_in100  = $null
    page_height_in100 = $null
    module_px         = $null
    ink_pixels        = $null
    elapsed_ms        = 0
}
if ($DryRun) { $result.mode = 'dry-run' }
if ($TsplOut) { $result.mode = 'tspl' }

$sw = [System.Diagnostics.Stopwatch]::StartNew()

if ($DryRun -or $TsplOut) {
    # Render the layout to an in-memory bitmap so the drawing code can be
    # exercised without touching any hardware. -TsplOut additionally packs
    # the result into TSPL so it can be sent RAW, bypassing the driver.
    $dpi = $DryRunDpi
    $bm = $null
    try {
        $pw = [int][math]::Round(8.5 * $dpi)
        $ph = [int][math]::Round(11.0 * $dpi)
        if ($layout.width_mm) { $pw = [int][math]::Round(([double]$layout.width_mm) * $dpi / 25.4) }
        if ($layout.height_mm) { $ph = [int][math]::Round(([double]$layout.height_mm) * $dpi / 25.4) }
        $pw = [math]::Max(1, $pw)
        $ph = [math]::Max(1, $ph)
        $bm = New-Object System.Drawing.Bitmap($pw, $ph)
        $bm.SetResolution($dpi, $dpi)
        $g = [System.Drawing.Graphics]::FromImage($bm)
        try {
            $modulePx = Invoke-LayoutRender $g $layout $DryRunDpi
            if ($null -ne $modulePx) { $result.module_px = [int]$modulePx }
            $result.page_width_in100 = [int][math]::Round($pw / $dpi * 100)
            $result.page_height_in100 = [int][math]::Round($ph / $dpi * 100)

            # Count non-white pixels: proves something was actually drawn.
            $ink = 0
            $step = [math]::Max(1, [int]($pw / 400))
            $black = [System.Drawing.Color]::FromArgb(0, 0, 0)
            for ($yy = 0; $yy -lt $ph; $yy += $step) {
                for ($xx = 0; $xx -lt $pw; $xx += $step) {
                    $c = $bm.GetPixel($xx, $yy)
                    if ($c.R -lt 200 -or $c.G -lt 200 -or $c.B -lt 200) { $ink++ }
                }
            }
            $result.ink_pixels = $ink
            $result.ok = $ink -gt 0
            $result.status = 'Rendered'
            if ($ink -le 0) { $result.error = 'Layout rendered an empty page' }

            if ($result.ok -and $TsplOut) {
                $header = New-Object System.Text.StringBuilder
                [void]$header.Append(('SIZE {0} mm,{1} mm' -f ([double]$layout.width_mm), ([double]$layout.height_mm)) + "`r`n")
                [void]$header.Append(('GAP {0} mm,0 mm' -f $TsplGapMm) + "`r`n")
                [void]$header.Append('DIRECTION 1' + "`r`n")
                [void]$header.Append('CLS' + "`r`n")
                $body = Convert-BitmapToTspl $bm 0 0
                $tail = 'PRINT 1' + "`r`n"
                $enc = New-Object System.Text.ASCIIEncoding
                [System.IO.File]::WriteAllBytes($TsplOut, $enc.GetBytes($header.ToString() + $body + $tail))
                $result.status = 'TsplWritten'
                $result.tspl_out = $TsplOut
                $result.tspl_bytes = (Get-Item -LiteralPath $TsplOut).Length
            }
        } finally { $g.Dispose() }
    } catch {
        $result.error = $_.Exception.Message
        $result.status = 'RenderFailed'
        $result.ok = $false
    } finally {
        if ($bm) { $bm.Dispose() }
    }
    $result.elapsed_ms = $sw.ElapsedMilliseconds
    Write-Payload $result
    if ($result.ok) { exit 0 } else { exit 3 }
}

if (-not $printerName) {
    $result.error = 'Layout has no target printer'
    $result.status = 'Rejected'
    $result.elapsed_ms = $sw.ElapsedMilliseconds
    Write-Payload $result
    exit 2
}

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printerName
if (-not $doc.PrinterSettings.IsValid) {
    $result.error = "Printer '$printerName' is not available to Windows"
    $result.status = 'Rejected'
    $result.elapsed_ms = $sw.ElapsedMilliseconds
    Write-Payload $result
    exit 2
}

# Never pop the Windows print progress dialog.
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

# Optionally pin the media (paper) size; when not specified the driver default
# is used, which for roll/label printers is normally the loaded stock.
$requestedPaper = $layout.paper_size
if ($requestedPaper) {
    foreach ($s in @($doc.PrinterSettings.PaperSizes)) {
        if ($s.PaperName -eq [string]$requestedPaper) {
            $doc.DefaultPageSettings.PaperSize = $s
            break
        }
    }
}

$script:layout = $layout
$script:result = $result

$doc.add_PrintPage({
    param($sender, $e)
    $g = $e.Graphics
    $modulePx = Invoke-LayoutRender $g $script:layout $null
    if ($null -ne $modulePx) { $script:result.module_px = [int]$modulePx }
    $script:result.page_width_in100 = [int][math]::Round($g.ClipBounds.Width / $g.DpiX * 100)
    $script:result.page_height_in100 = [int][math]::Round($g.ClipBounds.Height / $g.DpiY * 100)
    $e.HasMorePages = $false
})

try {
    $before = @(Get-PrintJob -PrinterName $printerName -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
    $result.jobs_before = @($before)

    $doc.Print()

    $after = @(Get-PrintJob -PrinterName $printerName -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.Id })
    $result.jobs_after = @($after)
    $newJobs = @($after | Where-Object { $before -notcontains $_ })
    if ($newJobs.Count -gt 0) {
        $result.job_id = [int](($newJobs | Sort-Object)[-1])
        $result.status = 'Submitted'
    } else {
        $result.job_id = $null
        $result.status = 'SubmittedUntracked'
    }
    $result.ok = $true
} catch {
    $result.error = $_.Exception.Message
    $result.status = 'Failed'
    $result.ok = $false
} finally {
    $doc.Dispose()
}

# Optional: watch the spooler until the job reaches a terminal state.
$deadline = [datetime]::UtcNow.AddSeconds([math]::Max(0, $WaitSeconds))
while ($result.ok -and $result.job_id -ne $null -and [datetime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds ([math]::Max(100, $PollIntervalMs))
    $job = Get-PrintJob -PrinterName $printerName -ErrorAction SilentlyContinue |
        Where-Object { [int]$_.Id -eq [int]$result.job_id } | Select-Object -First 1
    if (-not $job) {
        # Left the queue: spooler finished (or purged) the job.
        $result.status = 'CompletedUntracked'
        break
    }
    $js = "$($job.JobStatus)"
    $result.status = $js
    if ($js -match 'Printed|Error|Deleted|Retained|Paused') { break }
}

$result.elapsed_ms = $sw.ElapsedMilliseconds
Write-Payload $result




