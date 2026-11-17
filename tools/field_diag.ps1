<#
.SYNOPSIS
    Tanuki Rush blue-screen field diagnostic. Windows + adb + a phone in
    developer mode. Collects everything needed to say WHICH blue screen a device
    is showing and why, in one run, with no manual adb commands.

.DESCRIPTION
    The app has five surfaces that all look "blue", and only some of them are the
    bug. This script separates them objectively instead of by eye:

      colour #0A1A44 (dark navy), nothing on screen
        = the Android window background showing before Flutter painted anything,
          OR the Dart gate spinner. A pre-first-frame hang. Back button is dead.
      colour #BFE3FF (pale blue), nothing on screen
        = WebGL clear colour: Flutter and the WebView are alive, the 3D scene
          never rendered. A completely different bug with a different fix.
      navy + visible text or buttons
        = one of the error overlays is doing its job. Send the screenshot.

    It decides between them by sampling the screen, reading the exact pixel
    colours, and cross-checking the logcat breadcrumbs the app already writes:
      [tanuki] first-frame-painted   Flutter painted at least one frame
      native-watchdog: armed         the native watchdog started (1.0.6+)
      native-watchdog: heartbeat N   the Android UI thread was still running
      native-watchdog: no first frame  the watchdog gave up and drew its overlay
      [gate] failed to start asset server  port 43853 could not be bound

    Finally it forwards the app's own loopback port to the PC and fetches the
    game over HTTP. If that succeeds while the phone shows nothing, the Dart side
    is fully alive and the failure is inside the WebView or the GPU.

.PARAMETER Adb
    Path to adb.exe. Only needed when adb is not on PATH.

.PARAMETER Apk
    Path to an APK to install before testing (e.g. the published preview).

.PARAMETER WaitSeconds
    How long to watch the app after launching it. Default 45.

.PARAMETER OutDir
    Where to write tanuki-report.txt, tanuki-logcat.txt and the screenshots.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\field_diag.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\field_diag.ps1 -Adb C:\platform-tools\adb.exe -Apk .\tanuki-rush-android-preview.apk

.NOTES
    Deliberately ASCII-only: Windows PowerShell 5.1 reads scripts without a BOM
    as ANSI, so non-ASCII text would turn into mojibake.
    Never destructive: it does not clear app data and does not uninstall
    anything unless -ForceUninstall is passed.
#>
[CmdletBinding()]
param(
    [string]$Adb,
    [string]$Apk,
    [int]$WaitSeconds = 45,
    [string]$OutDir = ".",
    [string]$Serial,
    [switch]$SkipInstall,
    [switch]$ForceUninstall
)

# Native commands write to stderr routinely (adb does it for warnings). Stopping
# on that would abort the diagnostic halfway, so errors are handled explicitly.
$ErrorActionPreference = 'Continue'

$script:Package = 'com.tanukirush.tanuki_rush'
$script:Activity = '.MainActivity'
$script:Port = 43853
$script:AdbExe = $null
$script:SerialArg = @()
$script:Report = New-Object System.Collections.Generic.List[string]

function Write-Line {
    param([string]$Text)
    $script:Report.Add($Text)
    Write-Host $Text
}

function Write-Section {
    param([string]$Title)
    Write-Line ""
    Write-Line ("=== " + $Title + " ===")
}

# Single place that runs adb, so the serial flag and stderr handling are uniform.
function Invoke-Adb {
    param([string[]]$Arguments)
    $all = @()
    if ($script:SerialArg.Count -gt 0) { $all += $script:SerialArg }
    $all += $Arguments
    $output = & $script:AdbExe @all 2>&1 | Out-String
    return $output.Trim()
}

function Get-Prop {
    param([string]$Name)
    $value = Invoke-Adb @('shell', ('getprop ' + $Name))
    return ($value -replace "`r", "" -replace "`n", "").Trim()
}

# Reads a screenshot and answers the only question that matters here: what colour
# is actually on the glass, and is the screen flat or does it have content?
# PSCustomObject rather than a hashtable so the function cannot be unrolled by
# the pipeline, and the caller always gets one object back.
function Get-ScreenSummary {
    param([string]$Path)

    $summary = [pscustomobject]@{
        Ok       = $false
        Error    = ""
        Width    = 0
        Height   = 0
        Centre   = "??????"
        Distinct = -1
        Top      = @()
    }

    if (-not (Test-Path $Path)) {
        $summary.Error = "screenshot file was not written"
        return $summary
    }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    # 137 80 = the PNG magic bytes. screencap writes nothing useful when the
    # screen is off or locked, and a truncated file would only confuse the reader.
    if ($bytes.Length -lt 100 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80) {
        $summary.Error = ("not a PNG (" + $bytes.Length + " bytes) - unlock the screen and keep it on")
        return $summary
    }

    try {
        Add-Type -AssemblyName System.Drawing
        $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
        try {
            $width = $bitmap.Width
            $height = $bitmap.Height
            $summary.Width = $width
            $summary.Height = $height

            $centre = $bitmap.GetPixel([int][Math]::Floor($width / 2), [int][Math]::Floor($height / 2))
            $summary.Centre = ('{0:X2}{1:X2}{2:X2}' -f $centre.R, $centre.G, $centre.B)

            # Sample a coarse grid instead of every pixel: enough to notice a
            # spinner, a progress bar or a heading, cheap enough to repeat 8 times.
            $histogram = @{}
            $total = 0
            $stepX = [Math]::Max(1, [int][Math]::Floor($width / 100))
            $stepY = [Math]::Max(1, [int][Math]::Floor($height / 60))
            for ($y = 0; $y -lt $height; $y += $stepY) {
                for ($x = 0; $x -lt $width; $x += $stepX) {
                    $pixel = $bitmap.GetPixel($x, $y)
                    $key = ('{0:X2}{1:X2}{2:X2}' -f $pixel.R, $pixel.G, $pixel.B)
                    if ($histogram.ContainsKey($key)) { $histogram[$key] = $histogram[$key] + 1 }
                    else { $histogram[$key] = 1 }
                    $total = $total + 1
                }
            }
            $summary.Distinct = $histogram.Count

            $top = @()
            $entries = $histogram.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 5
            foreach ($entry in $entries) {
                $percent = 0.0
                if ($total -gt 0) { $percent = [Math]::Round((100.0 * $entry.Value) / $total, 1) }
                $top += ("#" + $entry.Key + " covers " + $percent + "% of sampled points")
            }
            $summary.Top = $top
            $summary.Ok = $true
        }
        finally { $bitmap.Dispose() }
    }
    catch {
        $summary.Error = ("image analysis failed: " + $_.Exception.Message)
    }
    return $summary
}

# ---------------------------------------------------------------------------
# 1. adb
# ---------------------------------------------------------------------------
Write-Section "adb"

$candidate = $Adb
if (-not $candidate) {
    $onPath = Get-Command adb -ErrorAction SilentlyContinue
    if ($onPath) { $candidate = $onPath.Source }
}
if (-not $candidate) {
    foreach ($guess in @(
            (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"),
            "C:\platform-tools\adb.exe",
            (Join-Path $env:USERPROFILE "platform-tools\adb.exe")
        )) {
        if (Test-Path $guess) { $candidate = $guess; break }
    }
}
if (-not $candidate -or -not (Test-Path $candidate)) {
    Write-Host ""
    Write-Host "adb HAIPATIKANI / adb NOT FOUND." -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Google platform-tools (official, no installer needed):"
    Write-Host "  1. Download  https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
    Write-Host "  2. Extract to C:\platform-tools"
    Write-Host "  3. Re-run:   powershell -ExecutionPolicy Bypass -File tools\field_diag.ps1 -Adb C:\platform-tools\adb.exe"
    Write-Host ""
    exit 2
}
$script:AdbExe = (Resolve-Path $candidate).Path
Write-Line ("adb: " + $script:AdbExe)
Write-Line (Invoke-Adb @('version') | Select-Object -First 1)

Invoke-Adb @('start-server') | Out-Null

# ---------------------------------------------------------------------------
# 2. device
# ---------------------------------------------------------------------------
Write-Section "device"

# -replace "`r" first: on Windows every adb output line ends with CR, which would
# silently break the "device$" anchor below and report an authorized phone as
# unauthorized.
$deviceText = (Invoke-Adb @('devices')) -replace "`r", ""
$devices = @($deviceText -split "`n" | Where-Object { $_ -match "\t" })
if ($devices.Count -eq 0) {
    Write-Host "HAKUNA SIMU / NO DEVICE. Connect the phone by USB, then on the phone:" -ForegroundColor Red
    Write-Host "  Settings > System > Developer options > USB debugging = ON"
    Write-Host "  (Developer options: Settings > About phone > tap 'Build number' 7 times)"
    Write-Host "  Then re-plug the cable and tap ALLOW on the 'Allow USB debugging?' prompt."
    exit 3
}
foreach ($line in $devices) { Write-Line $line.Trim() }

$ready = @($devices | Where-Object { $_ -match "`tdevice$" })
if ($ready.Count -eq 0) {
    Write-Host ""
    Write-Host "The phone is visible but NOT authorized." -ForegroundColor Red
    Write-Host "Look at the phone screen and tap ALLOW on 'Allow USB debugging?'."
    Write-Host "If no prompt appears: Developer options > Revoke USB debugging authorizations,"
    Write-Host "then re-plug the cable."
    exit 4
}
if ($Serial) {
    $script:SerialArg = @('-s', $Serial)
}
elseif ($ready.Count -gt 1) {
    Write-Host ""
    Write-Host "More than one device is connected. Re-run with -Serial <id> from the list above." -ForegroundColor Yellow
    exit 5
}
else {
    $script:SerialArg = @('-s', (($ready[0] -split "`t")[0].Trim()))
}

$model = Get-Prop 'ro.product.model'
$brand = Get-Prop 'ro.product.brand'
$release = Get-Prop 'ro.build.version.release'
$sdk = Get-Prop 'ro.build.version.sdk'
$fingerprint = Get-Prop 'ro.build.fingerprint'
Write-Line ("device: " + $brand + " " + $model)
Write-Line ("android: " + $release + " (API " + $sdk + ")")
Write-Line ("fingerprint: " + $fingerprint)

# ---------------------------------------------------------------------------
# 3. GPU + WebView: the two subsystems that can silently produce a blank canvas
# ---------------------------------------------------------------------------
Write-Section "graphics and webview"

$surfaceFlinger = Invoke-Adb @('shell', 'dumpsys SurfaceFlinger')
$gles = @($surfaceFlinger -split "`n" | Where-Object { $_ -match "GLES|OpenGL|Vulkan|Adreno|Mali|PowerVR|Renderer" } | Select-Object -First 6)
if ($gles.Count -eq 0) { Write-Line "graphics backend: (dumpsys SurfaceFlinger gave nothing usable)" }
foreach ($line in $gles) { Write-Line ("graphics: " + $line.Trim()) }

$webview = Invoke-Adb @('shell', 'dumpsys webviewupdate')
$provider = @($webview -split "`n" | Where-Object { $_ -match "Current WebView package|Fallback|package=|versionName" } | Select-Object -First 4)
if ($provider.Count -eq 0) { Write-Line "webview: (dumpsys webviewupdate gave nothing usable)" }
foreach ($line in $provider) { Write-Line ("webview: " + $line.Trim()) }

# ---------------------------------------------------------------------------
# 4. installed version: the watchdog only exists in 1.0.6+
# ---------------------------------------------------------------------------
Write-Section "installed app"

$pkgInfo = Invoke-Adb @('shell', ('dumpsys package ' + $script:Package))
if ($pkgInfo -match "Unable to find package" -or $pkgInfo.Length -lt 40) {
    Write-Line "installed: NOT INSTALLED"
}
else {
    foreach ($line in ($pkgInfo -split "`n")) {
        if ($line -match "versionName|versionCode|firstInstallTime|lastUpdateTime|codePath") {
            Write-Line ("installed: " + $line.Trim())
        }
    }
}

# ---------------------------------------------------------------------------
# 5. optional install
# ---------------------------------------------------------------------------
Write-Section "install"

$apkPath = $Apk
if (-not $apkPath) {
    foreach ($guess in @("tanuki-rush-android-preview.apk", (Join-Path $OutDir "tanuki-rush-android-preview.apk"))) {
        if (Test-Path $guess) { $apkPath = $guess; break }
    }
}
if ($SkipInstall) {
    Write-Line "install: skipped (-SkipInstall)"
}
elseif ($apkPath -and (Test-Path $apkPath)) {
    Write-Line ("installing: " + $apkPath)
    $installResult = Invoke-Adb @('install', '-r', $apkPath)
    Write-Line ("install result: " + ($installResult -replace "`r`n", " | "))
    if ($installResult -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE|signatures do not match") {
        Write-Line "install: BLOCKED by a different signing key or a downgrade."
        if ($ForceUninstall) {
            Write-Line "install: -ForceUninstall given, removing the old copy first."
            Write-Line ("uninstall: " + (Invoke-Adb @('uninstall', $script:Package)))
            Write-Line ("install retry: " + (Invoke-Adb @('install', '-r', $apkPath)))
        }
        else {
            Write-Line "install: NOT uninstalled automatically, because uninstalling erases the local save."
            Write-Line "install: to accept that, re-run with -ForceUninstall."
        }
    }
}
else {
    Write-Line "install: no APK given and none found next to the script."
    Write-Line "install: latest published preview = https://github.com/mwijay12/tanuki-rush/releases/latest"
    Write-Line "install: download tanuki-rush-android-preview.apk, then re-run with -Apk <path>."
}

# Everything below is meaningless if the app is not on the phone, so say that
# plainly instead of producing a report full of "not running".
$pmPath = (Invoke-Adb @('shell', ('pm path ' + $script:Package))) -replace "`r", ""
if ($pmPath -notmatch "package:") {
    Write-Line "install: the app is NOT installed, so there is nothing to diagnose yet."
    Write-Line "install: get tanuki-rush-android-preview.apk from"
    Write-Line "install:   https://github.com/mwijay12/tanuki-rush/releases/latest"
    Write-Line "install: then re-run with -Apk <path to apk>."
    exit 6
}
Write-Line ("pm path: " + ($pmPath -replace "`n", " "))

# ---------------------------------------------------------------------------
# 6. cold start, timed
# ---------------------------------------------------------------------------
Write-Section "launch"

Invoke-Adb @('shell', ('am force-stop ' + $script:Package)) | Out-Null
Start-Sleep -Seconds 2
Invoke-Adb @('logcat', '-c') | Out-Null

# -W makes the system report WaitTime/TotalTime, so a slow start is measurable
# instead of guessed at.
$startResult = Invoke-Adb @('shell', ('am start -W -n ' + $script:Package + '/' + $script:Activity))
foreach ($line in ($startResult -split "`n")) { Write-Line ("am start -W: " + $line.Trim()) }

if ($startResult -match "Error|Exception") {
    Write-Line "launch: THE ACTIVITY REFUSED TO START. That alone explains a dead screen."
}

# ---------------------------------------------------------------------------
# 7. screen sampling: exact pixels, not somebody's description of "blue"
# ---------------------------------------------------------------------------
Write-Section "screen sampling"

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$lastSummary = $null
$captureAt = @(@(3, 8, 13, 20, 30, 45, 60, 90) | Where-Object { $_ -le $WaitSeconds })
if ($captureAt -notcontains $WaitSeconds) { $captureAt += $WaitSeconds }
# A real clock: a screenshot plus two dumpsys calls take a second or two each, so
# counting sleeps would drift and the "t=" labels would be a lie.
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($mark in $captureAt) {
    while ($stopwatch.Elapsed.TotalSeconds -lt $mark) { Start-Sleep -Milliseconds 250 }
    $stamp = [int][Math]::Round($stopwatch.Elapsed.TotalSeconds)

    $png = Join-Path $OutDir ("tanuki-screen-" + $stamp + "s.png")
    # screencap to the card, then pull: piping binary through PowerShell's
    # redirection corrupts the PNG on Windows PowerShell 5.1.
    Invoke-Adb @('shell', ('screencap -p /sdcard/tanuki-diag.png')) | Out-Null
    Invoke-Adb @('pull', '/sdcard/tanuki-diag.png', $png) | Out-Null
    Invoke-Adb @('shell', 'rm -f /sdcard/tanuki-diag.png') | Out-Null

    $procLine = @((Invoke-Adb @('shell', 'ps -A')) -split "`n" | Where-Object { $_ -match $script:Package })
    $procState = "process NOT running"
    if ($procLine.Count -gt 0) { $procState = "process up: " + ($procLine[0] -replace "\s+", " ").Trim() }

    $resumed = @((Invoke-Adb @('shell', 'dumpsys activity activities')) -split "`n" |
        Where-Object { $_ -match "ResumedActivity|topResumedActivity" } | Select-Object -First 2)
    $resumedText = "(none reported)"
    if ($resumed.Count -gt 0) { $resumedText = ($resumed[0] -replace "\s+", " ").Trim() }

    $summary = Get-ScreenSummary -Path $png
    Write-Line ("t=" + $stamp + "s  " + $procState)
    Write-Line ("t=" + $stamp + "s  resumed: " + $resumedText)
    Write-Line ("t=" + $stamp + "s  screen: " + $summary.Width + "x" + $summary.Height +
        "  centre=#" + $summary.Centre + "  distinct sampled colours=" + $summary.Distinct)
    foreach ($entry in $summary.Top) { Write-Line ("t=" + $stamp + "s    " + $entry) }
    if (-not $summary.Ok) { Write-Line ("t=" + $stamp + "s  screenshot FAILED: " + $summary.Error) }
    $lastSummary = $summary
}

$finalPng = Join-Path $OutDir "tanuki-screen.png"
if (Test-Path $finalPng) { Remove-Item $finalPng -Force }
$newest = @(Get-ChildItem -Path $OutDir -Filter "tanuki-screen-*s.png" -ErrorAction SilentlyContinue |
    Sort-Object -Property LastWriteTime)
if ($newest.Count -gt 0) { Copy-Item $newest[-1].FullName $finalPng -Force }

# ---------------------------------------------------------------------------
# 8. logcat: the app's own breadcrumbs
# ---------------------------------------------------------------------------
Write-Section "logcat"

$rawLog = Invoke-Adb @('logcat', '-d', '-v', 'time')
$logPath = Join-Path $OutDir "tanuki-logcat.txt"
Set-Content -Path $logPath -Value $rawLog -Encoding UTF8
Write-Line ("full logcat saved: " + $logPath + "  (" + $rawLog.Length + " chars)")

$logLines = $rawLog -split "`n"

# Everything the app itself writes, plus the subsystems that can stall a start.
$patterns = @(
    'TanukiBoot', 'native-watchdog', '\[tanuki\]', '\[gate\]', '\[web-asset-server\]',
    'TanukiStorage', 'first-frame-painted', 'Impeller', 'impeller', 'Vulkan', 'vulkan',
    'OpenGLRenderer', 'AndroidRuntime', 'FATAL', 'ANR in', 'dex2oat', 'WebViewFactory',
    'WebViewChromium', 'chromium', 'cr_', 'flutter', 'Flutter', 'Address already in use',
    'SurfaceView', 'libGLES'
)
$interesting = @($logLines | Where-Object {
        $line = $_
        $hit = $false
        foreach ($pattern in $patterns) { if ($line -match $pattern) { $hit = $true; break } }
        $hit
    })
Write-Line ("matching lines: " + $interesting.Count)
foreach ($line in ($interesting | Select-Object -Last 90)) {
    $text = $line.Trim()
    Write-Line ("  | " + $text)
}

function Test-Log {
    param([string]$Pattern)
    return [bool](@($logLines | Where-Object { $_ -match $Pattern }).Count -gt 0)
}

# ---------------------------------------------------------------------------
# 9. what the system recorded about the process
# ---------------------------------------------------------------------------
Write-Section "process history"

# ApplicationExitInfo (Android 11+) records ANR and crash reasons after the fact,
# which is the only way to see an ANR that already ended.
$exitInfo = Invoke-Adb @('shell', ('dumpsys activity exit-info ' + $script:Package))
if ($exitInfo.Length -gt 5) {
    foreach ($line in (($exitInfo -split "`n") | Select-Object -First 25)) { Write-Line ("exit-info: " + $line.Trim()) }
}
else { Write-Line "exit-info: (nothing recorded, or Android < 11)" }

$anr = Invoke-Adb @('shell', 'ls -l /data/anr')
Write-Line ("anr dir: " + ($anr -replace "`r`n", " | "))

$layers = @((Invoke-Adb @('shell', 'dumpsys SurfaceFlinger --list')) -split "`n" |
    Where-Object { $_ -match $script:Package })
if ($layers.Count -eq 0) {
    Write-Line "surfaceflinger layers for this app: NONE (no window surface at all)"
}
else {
    foreach ($line in $layers) { Write-Line ("surfaceflinger layer: " + $line.Trim()) }
}

# ---------------------------------------------------------------------------
# 10. the app's own HTTP server, fetched from the PC
# ---------------------------------------------------------------------------
Write-Section "loopback asset server"

# The game is served by the app itself on 127.0.0.1:43853. Forwarding that port
# to the PC and fetching it proves whether the Dart side is alive and serving,
# independently of what the phone's screen shows.
Invoke-Adb @('forward', ('tcp:' + $script:Port), ('tcp:' + $script:Port)) | Out-Null
$serverState = "not tested"
try {
    $response = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $script:Port + "/index.html") -UseBasicParsing -TimeoutSec 15
    $serverState = ("HTTP " + $response.StatusCode + ", " + $response.RawContentLength + " bytes of index.html")
}
catch {
    $serverState = ("FAILED: " + $_.Exception.Message)
}
Write-Line ("GET http://127.0.0.1:" + $script:Port + "/index.html  ->  " + $serverState)
Write-Line ("open in PC Chrome while the app runs: http://127.0.0.1:" + $script:Port + "/index.html")
Write-Line "  (if it plays on the PC but not on the phone, the bundle and the Dart"
Write-Line "   server are fine and the fault is the phone WebView or GPU)"
Invoke-Adb @('forward', '--remove-all') | Out-Null

# ---------------------------------------------------------------------------
# 11. verdict
# ---------------------------------------------------------------------------
Write-Section "verdict"

$firstFrame = Test-Log 'first-frame-painted'
$armed = Test-Log 'native-watchdog: armed'
$beats = @($logLines | Where-Object { $_ -match 'native-watchdog: heartbeat' }).Count
$gaveUp = Test-Log 'native-watchdog: no first frame'
$paintedLate = Test-Log 'native-watchdog: first frame painted'
$gateFailed = Test-Log '\[gate\] failed to start asset server'
$dex2oat = Test-Log 'dex2oat|WebViewFactory|WebViewChromium'
$renderer = Test-Log 'Impeller|Vulkan|libGLES|OpenGLRenderer'
$fatal = Test-Log 'FATAL|AndroidRuntime'

$colour = "?"
$distinct = -1
if ($lastSummary -and $lastSummary.Ok) { $colour = $lastSummary.Centre; $distinct = $lastSummary.Distinct }

Write-Line ("screen centre colour: #" + $colour + "   distinct sampled colours: " + $distinct)
Write-Line ("[tanuki] first-frame-painted in logcat: " + $firstFrame)
Write-Line ("native-watchdog armed: " + $armed + "   heartbeats: " + $beats + "   gave up (overlay shown): " + $gaveUp + "   frame arrived late: " + $paintedLate)
Write-Line ("asset server start failed: " + $gateFailed + "   WebView first-run work seen: " + $dex2oat + "   renderer lines: " + $renderer + "   crash: " + $fatal)
Write-Line ("loopback server from PC: " + $serverState)
Write-Line ""

$flat = ($distinct -ge 0 -and $distinct -le 2)
if ($colour -eq "BFE3FF") {
    Write-Line "READING: PALE BLUE #BFE3FF = the WebGL clear colour. Flutter painted, the WebView"
    Write-Line "  loaded the page, and the 3D scene never rendered. This is NOT the pre-frame hang;"
    Write-Line "  it is a GPU/WebGL problem inside the WebView. The watchdog correctly stayed quiet."
}
elseif ($colour -eq "0A1A44" -and $flat -and -not $firstFrame) {
    Write-Line "READING: FLAT NAVY #0A1A44 WITH NO FIRST FRAME = the Android window background."
    Write-Line "  The app hung before Flutter drew anything, which is the reported blue screen."
    if ($armed -and $beats -eq 0) {
        Write-Line "  SUB-VERDICT: the watchdog armed and then never beat again -> the Android UI thread"
        Write-Line "  STOPPED RUNNING after onCreate. Something native is blocking it (engine init,"
        Write-Line "  plugin registration, or WebView first-run optimisation)."
    }
    elseif ($armed -and $beats -gt 0) {
        Write-Line "  SUB-VERDICT: the watchdog kept beating -> the UI thread is ALIVE while Flutter never"
        Write-Line "  painted. That points at the rasterizer/engine, not at a blocked main thread."
    }
    elseif ($gaveUp) {
        Write-Line "  SUB-VERDICT: the watchdog fired and its overlay should have been on screen. If the"
        Write-Line "  screen was still flat navy, the overlay itself failed to draw."
    }
    else {
        Write-Line "  SUB-VERDICT: no watchdog line at all -> this build is older than 1.0.6, or the"
        Write-Line "  process died before onCreate. Check the installed version above."
    }
    if ($dex2oat) {
        Write-Line "  NOTE: WebView first-run work (dex2oat / WebViewFactory) appears in the log. On a"
        Write-Line "  fresh or just-updated WebView that can block the main thread for tens of seconds"
        Write-Line "  and is a prime suspect."
    }
}
elseif ($colour -eq "0A1A44" -and $firstFrame) {
    Write-Line "READING: NAVY BUT FLUTTER DID PAINT. The Dart gate is up and something later is stuck:"
    Write-Line "  the asset server, the WebView, or the game's own LOADING overlay (which prints the"
    Write-Line "  word LOADING). Since the screen looks flat, the WebView most likely never drew."
    if ($gateFailed) { Write-Line "  FOUND IT: the asset server failed to start (port 43853 already in use)." }
}
elseif ($distinct -gt 2) {
    Write-Line "READING: THE SCREEN IS NOT FLAT - there is content (text, a spinner, or a button)."
    Write-Line "  Send tanuki-screen.png; that picture identifies the surface immediately."
}
else {
    Write-Line "READING: UNCLASSIFIED. Send tanuki-report.txt and tanuki-screen.png as they are."
}

Write-Line ""
Write-Line "SEND BACK / TUMA HAYA: tanuki-report.txt, tanuki-logcat.txt, tanuki-screen.png"

$reportPath = Join-Path $OutDir "tanuki-report.txt"
Set-Content -Path $reportPath -Value ($script:Report -join "`r`n") -Encoding UTF8
Write-Host ""
Write-Host ("Report written to " + $reportPath) -ForegroundColor Green
Write-Host "Paste its contents back into the chat, and attach tanuki-screen.png."
