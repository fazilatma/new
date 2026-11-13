#requires -Version 5.1
<#
.SYNOPSIS
  server.ps1 — اجرای سروریِ وب‌اپ scraper4 روی ویندوز (معادلِ server.sh)

  دو حالتِ قابلِ تنظیم:
    .\server.ps1 run    → حالت پیش‌زمینه (لاگ زنده، توقف با Ctrl+C)
    .\server.ps1 start  → حالت پس‌زمینه (پنجرهٔ مخفی + فایل‌های PID/لاگ)
    .\server.ps1 stop | restart | status | logs

  در هر دو حالت سوپروایزر فعال است: اگر PHP به هر دلیلی از کار بیفتد،
  بی‌درنگ و تا بی‌نهایت دوباره بالا می‌آید — تا وقتی stop شود.
  تنظیمات PHP هیچ سقف زمانی نمی‌گذارد؛ تیکِ کران هم کارهای پس‌زمینهٔ
  اپ را بدون نیاز به بازدیدکننده زنده نگه می‌دارد.

  پیکربندی: متغیرهای محیطی (نمونه در server.conf.sample) یا همان‌جا که
  اجرا می‌کنید، مثلاً:   $env:SCRAPER_PORT=9000; .\server.ps1 run
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('run','start','stop','restart','status','logs','help')]
  [string]$Command = 'help'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $HERE

$SCRAPER_HOST       = if ($env:SCRAPER_HOST)       { $env:SCRAPER_HOST }       else { '0.0.0.0' }
$SCRAPER_PORT       = if ($env:SCRAPER_PORT)       { [int]$env:SCRAPER_PORT }  else { 8000 }
$SCRAPER_APP        = if ($env:SCRAPER_APP)        { $env:SCRAPER_APP }        else { 'scraper4.php' }
$SCRAPER_ROUTER     = if ($env:SCRAPER_ROUTER)     { $env:SCRAPER_ROUTER }     else { 'server.php' }
$SCRAPER_PHP        = if ($env:SCRAPER_PHP)        { $env:SCRAPER_PHP }        else { 'php' }
$SCRAPER_MEMORY     = if ($env:SCRAPER_MEMORY)     { $env:SCRAPER_MEMORY }     else { '512M' }
$RESTART_DELAY      = if ($env:SCRAPER_RESTART_DELAY)     { [int]$env:SCRAPER_RESTART_DELAY }     else { 1 }
$RESTART_DELAY_MAX  = if ($env:SCRAPER_RESTART_DELAY_MAX) { [int]$env:SCRAPER_RESTART_DELAY_MAX } else { 30 }
$CRON_TICK          = if ($env:SCRAPER_CRON_TICK)  { [int]$env:SCRAPER_CRON_TICK } else { 60 }
$LOG                = if ($env:SCRAPER_LOG)        { $env:SCRAPER_LOG }        else { Join-Path $HERE 'logs\server.log' }
$TICK_LOG           = if ($env:SCRAPER_TICK_LOG)   { $env:SCRAPER_TICK_LOG }   else { Join-Path $HERE 'logs\cron-tick.log' }
$RUN_DIR            = if ($env:RUN_DIR)            { $env:RUN_DIR }            else { Join-Path $HERE 'run' }
$SUP_PIDFILE        = Join-Path $RUN_DIR 'supervisor.pid'
$SRV_PIDFILE        = Join-Path $RUN_DIR 'php-server.pid'
$STOP_FLAG          = Join-Path $RUN_DIR 'STOP'

function Log([string]$msg) { Write-Host "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg }
function Ensure-Dirs { New-Item -ItemType Directory -Force -Path $RUN_DIR, (Split-Path $LOG), (Split-Path $TICK_LOG) | Out-Null }
function Test-Alive([int]$p) { if (-not $p) { return $false }; try { Get-Process -Id $p -ErrorAction Stop | Out-Null; return $true } catch { return $false } }
function Read-Pid([string]$f) { if (Test-Path $f) { try { return [int](Get-Content $f -Raw) } catch { return 0 } } return 0 }
function Need-Php {
  try { & $SCRAPER_PHP -v | Out-Null } catch { Log "خطا: «$SCRAPER_PHP» پیدا نشد. PHP CLI نصب کنید یا SCRAPER_PHP را ست کنید."; exit 1 }
}
function Need-Files {
  if (-not (Test-Path $SCRAPER_ROUTER)) { Log "خطا: روتر «$SCRAPER_ROUTER» نیست."; exit 1 }
  if (-not (Test-Path $SCRAPER_APP))    { Log "خطا: فایل اپ «$SCRAPER_APP» نیست."; exit 1 }
}

function Start-PhpServer {
  # روی ویندوز چندکارگر (PHP_CLI_SERVER_WORKERS) پشتیبانی نمی‌شود؛ خودِ PHP
  # اگر متغیر ست باشد فقط هشدار می‌دهد، پس آن را نمی‌فرستیم.
  $argList = @(
    '-d', 'max_execution_time=0',
    '-d', 'max_input_time=-1',
    '-d', "memory_limit=$SCRAPER_MEMORY",
    '-d', 'ignore_user_abort=1',
    '-d', 'default_socket_timeout=-1',
    '-S', "${SCRAPER_HOST}:$SCRAPER_PORT",
    $SCRAPER_ROUTER
  )
  $p = Start-Process -FilePath $SCRAPER_PHP -ArgumentList $argList `
        -WorkingDirectory $HERE -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $RUN_DIR 'php-out.log') `
        -RedirectStandardError  (Join-Path $RUN_DIR 'php-err.log')
  Set-Content -Path $SRV_PIDFILE -Value $p.Id
  return $p
}

function Start-Ticker {
  if ($CRON_TICK -le 0) { return $null }
  $tickerCode = {
    param($php, $app, $tick, $flag, $log)
    while (-not (Test-Path $flag)) {
      Start-Sleep -Seconds $tick
      if (Test-Path $flag) { break }
      & $php -d max_execution_time=0 $app cron_run *>> $log
    }
  }
  return Start-Job -ScriptBlock $tickerCode -ArgumentList $SCRAPER_PHP, (Join-Path $HERE $SCRAPER_APP), $CRON_TICK, $STOP_FLAG, $TICK_LOG
}

function Invoke-Supervise {
  Ensure-Dirs
  Remove-Item $STOP_FLAG -Force -ErrorAction SilentlyContinue
  $delay = $RESTART_DELAY
  Log "حلقهٔ نگهبان فعال شد — توقف با Ctrl+C یا ساختن فایل $STOP_FLAG"
  while (-not (Test-Path $STOP_FLAG)) {
    $started = Get-Date
    Log "راه‌اندازی وب‌سرور: http://${SCRAPER_HOST}:$SCRAPER_PORT (memory=$SCRAPER_MEMORY)"
    $server = Start-PhpServer
    $ticker = Start-Ticker

    $server.WaitForExit()
    $rc = $server.ExitCode
    if ($ticker) { Stop-Job $ticker -ErrorAction SilentlyContinue; Remove-Job $ticker -Force -ErrorAction SilentlyContinue }

    if (Test-Path $STOP_FLAG) { Log 'پرچم توقف دیده شد — بازراه‌اندازی نمی‌شود.'; break }

    $up = [int]((Get-Date) - $started).TotalSeconds
    if ($up -ge 60) { $delay = $RESTART_DELAY }
    Log "وب‌سرور با کد $rc از کار افتاد (پس از $up ثانیه) — بازراه‌اندازی تا $delay ثانیهٔ دیگر…"
    Start-Sleep -Seconds $delay
    if ($up -lt 60) { $delay = [Math]::Min($delay * 2, $RESTART_DELAY_MAX) }
  }
  Remove-Item $SRV_PIDFILE -Force -ErrorAction SilentlyContinue
}

function Invoke-Run   { Need-Php; Need-Files; Log 'حالت پیش‌زمینه — برای توقف Ctrl+C بزنید.'; Invoke-Supervise }

function Invoke-Start {
  Need-Php; Need-Files; Ensure-Dirs
  $sup = Read-Pid $SUP_PIDFILE
  if (Test-Alive $sup) { Log "دیمون از قبل در حال اجراست (PID $sup) — ابتدا stop کنید."; exit 1 }
  Log "حالت پس‌زمینه — پروسهٔ مستقل با خروجی روی $LOG"
  $psArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" run' -f $PSCommandPath
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs `
        -WorkingDirectory $HERE -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $LOG -RedirectStandardError "$LOG.err"
  Set-Content -Path $SUP_PIDFILE -Value $p.Id
  Start-Sleep -Seconds 2
  Invoke-Status
}

function Invoke-Stop {
  Ensure-Dirs
  New-Item -ItemType File -Force -Path $STOP_FLAG | Out-Null
  $sup = Read-Pid $SUP_PIDFILE
  $srv = Read-Pid $SRV_PIDFILE
  foreach ($p in @($srv, $sup)) { if (Test-Alive $p) { Stop-Process -Id $p -Wait -ErrorAction SilentlyContinue } }
  foreach ($p in @($srv, $sup)) { if (Test-Alive $p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }
  Remove-Item $SUP_PIDFILE, $SRV_PIDFILE, $STOP_FLAG -Force -ErrorAction SilentlyContinue
  Log 'متوقف شد.'
}

function Invoke-Status {
  $sup = Read-Pid $SUP_PIDFILE
  $srv = Read-Pid $SRV_PIDFILE
  Write-Host "آدرس:        http://${SCRAPER_HOST}:$SCRAPER_PORT"
  Write-Host "اپ:          $SCRAPER_APP (روتر: $SCRAPER_ROUTER)"
  $mode = if (Test-Alive $sup) { "در حال اجرا (پس‌زمینه، supervisor PID $sup)" } elseif (Test-Alive $srv) { "در حال اجرا (پیش‌زمینه، server PID $srv)" } else { 'متوقف' }
  Write-Host "حالت:        $mode"
  Write-Host "وب‌سرور PHP: $(if (Test-Alive $srv) { "زنده (PID $srv)" } else { '—' })"
  Write-Host "تیکِ کران:   $(if ($CRON_TICK -gt 0) { "هر $CRON_TICK ثانیه (در حالت اجرا فعال است)" } else { 'خاموش' })"
  if (Test-Alive $srv) {
    try {
      $code = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$SCRAPER_PORT/").StatusCode
      Write-Host "پاسخ HTTP:   $code"
    } catch { Write-Host "پاسخ HTTP:   در دسترس نیست" }
  }
  Write-Host "لاگ:         $LOG"
}

function Invoke-Logs { if (Test-Path $LOG) { Get-Content $LOG -Tail 100 -Wait } else { Log 'هنوز لاگی نیست.' } }

switch ($Command) {
  'run'     { Invoke-Run }
  'start'   { Invoke-Start }
  'stop'    { Invoke-Stop }
  'restart' { Invoke-Stop; Start-Sleep 1; Invoke-Start }
  'status'  { Invoke-Status }
  'logs'    { Invoke-Logs }
  default   {
    Write-Host @"
استفاده: .\server.ps1 <دستور>
  run      حالت ۱ — پیش‌زمینه (لاگ زنده، توقف با Ctrl+C)
  start    حالت ۲ — پس‌زمینه (پروسهٔ مخفی + PID/لاگ)
  stop | restart | status | logs
در هر دو حالت نگهبانِ سقوط، سرور را تا بی‌نهایت دوباره بالا می‌آورد.
پیکربندی با متغیر محیطی (مثلاً `$env:SCRAPER_PORT=9000`).
"@
  }
}
