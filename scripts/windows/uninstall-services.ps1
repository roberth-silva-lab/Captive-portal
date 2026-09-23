[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abra o PowerShell como Administrador e execute novamente."
}

$ServiceRoot = Join-Path $env:ProgramData "CaptivePortal\Services"
foreach ($name in @("CaptivePortalCaddy", "CaptivePortalApi")) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -ne "Stopped") {
            Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
        }
        $wrapper = Join-Path $ServiceRoot "$name.exe"
        if (Test-Path $wrapper) {
            & $wrapper uninstall
        } else {
            sc.exe delete $name | Out-Null
        }
    }
}

Write-Host "Serviços CaptivePortalApi e CaptivePortalCaddy removidos. O cloudflared não foi alterado."
