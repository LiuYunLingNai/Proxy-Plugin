param([ValidateSet('identity','list','admin','start','stop','tun')][string]$Action, [string]$Payload = 'e30=')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
function IsAdmin {
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Identity([int]$ProcessId) {
  $item = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
  if (-not $item) { return $null }
  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  $executable = $item.ExecutablePath
  if (-not $executable) { $executable = $process.Path }
  return @{pid=$ProcessId; executable=$executable; birth=$process.StartTime.ToUniversalTime().Ticks.ToString(); command=$item.CommandLine}
}
function Quote([string]$Text) {
  if ($Text.Contains('"') -or $Text.Contains("`r") -or $Text.Contains("`n")) { throw 'Unsupported path characters' }
  return '"' + $Text + '"'
}
try {
  if ($Action -eq 'list') {
    $filter = "Name LIKE 'mihomo%.exe' OR Name='clash.exe' OR Name LIKE 'clash-meta%.exe' OR Name LIKE 'clash-core%.exe' OR Name LIKE 'clash.meta%.exe' OR Name LIKE 'clash.core%.exe'"
    $items = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop | ForEach-Object { @{pid=[int]$_.ProcessId;name=$_.Name;executable=$_.ExecutablePath} })
    ConvertTo-Json -InputObject $items -Compress; exit 0
  }
  if ($Action -eq 'admin') { @{admin=(IsAdmin)} | ConvertTo-Json -Compress; exit 0 }
  if ($Action -eq 'identity') { Identity ([int]$value.pid) | ConvertTo-Json -Compress; exit 0 }
  if ($Action -eq 'tun') {
    $adapter = Get-NetAdapter -Name ([string]$value.device) -ErrorAction SilentlyContinue
    $routes = if ($adapter) { @(Get-NetRoute -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue).Count -gt 0 } else { $false }
    @{interface=([bool]$adapter);routes=$routes} | ConvertTo-Json -Compress; exit 0
  }
  if ($value.elevate -and -not (IsAdmin)) {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File ' + (Quote $PSCommandPath) + ' -Action ' + $Action + ' -Payload ' + $Payload
    $helper = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -Wait -PassThru
    if ($helper.ExitCode -ne 0) { throw 'Elevated helper failed or UAC was cancelled' }
    @{ok=$true} | ConvertTo-Json -Compress; exit 0
  }
  if ($Action -eq 'start') {
    $binary = [IO.Path]::GetFullPath([string]$value.binary)
    $argsText = (@($value.args) | ForEach-Object { Quote ([string]$_) }) -join ' '
    $child = Start-Process -FilePath $binary -ArgumentList $argsText -WindowStyle Hidden -PassThru -WorkingDirectory ([IO.Path]::GetDirectoryName([string]$value.log)) -RedirectStandardOutput $value.log -RedirectStandardError ($value.log + '.stderr')
    $identity = Identity $child.Id
    @{identity=$identity} | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $value.resultFile -Encoding UTF8
  } elseif ($Action -eq 'stop') {
    $current = Identity ([int]$value.identity.pid)
    if ($current) {
      if ($current.birth -ne $value.identity.birth -or $current.executable -ine $value.identity.executable) { throw 'Process identity mismatch; refusing to stop' }
      Stop-Process -Id $current.pid -ErrorAction Stop
      Wait-Process -Id $current.pid -Timeout 5 -ErrorAction SilentlyContinue
      if (Identity ([int]$current.pid)) { throw 'Process did not exit; keeping recovery record' }
    }
    @{ok=$true} | ConvertTo-Json -Compress | Set-Content -LiteralPath $value.resultFile -Encoding UTF8
  }
  @{ok=$true} | ConvertTo-Json -Compress
} catch {
  if ($value.resultFile) { @{error=$_.Exception.Message} | ConvertTo-Json -Compress | Set-Content -LiteralPath $value.resultFile -Encoding UTF8 }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
