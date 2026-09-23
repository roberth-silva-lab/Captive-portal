[CmdletBinding()]
param(
    [string]$RepoPath = "",
    [string]$CaddyExe = "C:\caddy\caddy.exe",
    [string]$WinSWUrl = "https://github.com/winsw/winsw/releases/latest/download/WinSW-x64.exe",
    [switch]$StopExisting
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Abra o PowerShell como Administrador e execute novamente."
    }
}

function Xml-Escape([string]$Value) {
    return [Security.SecurityElement]::Escape($Value)
}

Assert-Administrator

if (-not $RepoPath) {
    $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
} else {
    $RepoPath = (Resolve-Path $RepoPath).Path
}

$ApiPython = Join-Path $RepoPath "backend\.venv\Scripts\python.exe"
$CaddyConfig = Join-Path $RepoPath "caddy\Caddyfile.windows"
$FrontendIndex = Join-Path $RepoPath "frontend\dist\index.html"

foreach ($required in @($ApiPython, $CaddyExe, $CaddyConfig)) {
    if (-not (Test-Path $required)) {
        throw "Arquivo obrigatório não encontrado: $required"
    }
}

if (-not (Test-Path $FrontendIndex)) {
    Write-Warning "frontend\dist\index.html não existe. Execute npm.cmd run build em frontend antes de iniciar o Caddy."
}

if ($StopExisting) {
    foreach ($port in @(8000, 8090)) {
        $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($pidValue in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
            if ($pidValue) {
                Write-Host "Encerrando processo manual na porta $port (PID $pidValue)..."
                Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Start-Sleep -Seconds 2
}

& $CaddyExe validate --config $CaddyConfig --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
    throw "Caddyfile.windows inválido."
}

$ServiceRoot = Join-Path $env:ProgramData "CaptivePortal\Services"
$LogRoot = Join-Path $env:ProgramData "CaptivePortal\Logs"
New-Item -ItemType Directory -Force -Path $ServiceRoot, $LogRoot | Out-Null

$WinSWBase = Join-Path $ServiceRoot "WinSW-x64.exe"
if (-not (Test-Path $WinSWBase)) {
    Write-Host "Baixando WinSW..."
    Invoke-WebRequest -Uri $WinSWUrl -OutFile $WinSWBase -UseBasicParsing
}

$ApiWrapper = Join-Path $ServiceRoot "CaptivePortalApi.exe"
$CaddyWrapper = Join-Path $ServiceRoot "CaptivePortalCaddy.exe"
Copy-Item $WinSWBase $ApiWrapper -Force
Copy-Item $WinSWBase $CaddyWrapper -Force

$repoXml = Xml-Escape $RepoPath
$apiPythonXml = Xml-Escape $ApiPython
$caddyExeXml = Xml-Escape $CaddyExe
$caddyConfigXml = Xml-Escape $CaddyConfig
$logRootXml = Xml-Escape $LogRoot

$ApiXml = @"
<service>
  <id>CaptivePortalApi</id>
  <name>Captive Portal API</name>
  <description>FastAPI do captive portal UniFi.</description>
  <executable>$apiPythonXml</executable>
  <arguments>-m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000</arguments>
  <workingdirectory>$repoXml</workingdirectory>
  <env name="PYTHONUNBUFFERED" value="1" />
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <logpath>$logRootXml\api</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@

$CaddyXml = @"
<service>
  <id>CaptivePortalCaddy</id>
  <name>Captive Portal Caddy</name>
  <description>Proxy reverso e frontend estático do captive portal.</description>
  <executable>$caddyExeXml</executable>
  <arguments>run --config "$caddyConfigXml" --adapter caddyfile</arguments>
  <workingdirectory>$repoXml</workingdirectory>
  <depend>CaptivePortalApi</depend>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <logpath>$logRootXml\caddy</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@

Set-Content -Path (Join-Path $ServiceRoot "CaptivePortalApi.xml") -Value $ApiXml -Encoding UTF8
Set-Content -Path (Join-Path $ServiceRoot "CaptivePortalCaddy.xml") -Value $CaddyXml -Encoding UTF8

foreach ($serviceName in @("CaptivePortalCaddy", "CaptivePortalApi")) {
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.Status -ne "Stopped") {
            Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
        sc.exe delete $serviceName | Out-Null
        Start-Sleep -Seconds 2
    }
}

& $ApiWrapper install
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar CaptivePortalApi." }
& $CaddyWrapper install
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar CaptivePortalCaddy." }

Start-Service CaptivePortalApi
Start-Sleep -Seconds 3
Start-Service CaptivePortalCaddy
Start-Sleep -Seconds 3

Write-Host ""
Get-Service CaptivePortalApi, CaptivePortalCaddy, cloudflared -ErrorAction SilentlyContinue |
    Select-Object Status, Name, DisplayName |
    Format-Table -AutoSize

try {
    $health = Invoke-RestMethod "http://127.0.0.1:8090/health/ready" -TimeoutSec 10
    Write-Host "Health local:" ($health | ConvertTo-Json -Compress)
} catch {
    Write-Warning "Os serviços foram instalados, mas o health check falhou: $($_.Exception.Message)"
    Write-Host "Logs: $LogRoot"
}

Write-Host ""
Write-Host "Instalação concluída. API e Caddy iniciarão automaticamente com o Windows."
