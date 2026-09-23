[CmdletBinding()]
param()

Write-Host "Serviços:"
Get-Service CaptivePortalApi, CaptivePortalCaddy, cloudflared -ErrorAction SilentlyContinue |
    Select-Object Status, Name, StartType |
    Format-Table -AutoSize

Write-Host "Portas:"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalPort -in 8000, 8090 |
    Select-Object LocalAddress, LocalPort, OwningProcess |
    Format-Table -AutoSize

Write-Host "Health local:"
try {
    Invoke-RestMethod "http://127.0.0.1:8090/health/ready" -TimeoutSec 10 |
        ConvertTo-Json -Compress
} catch {
    Write-Warning $_.Exception.Message
}

Write-Host "Health público:"
foreach ($url in @(
    "https://portal.gabineteitinerante.com.br/health/ready",
    "https://portal-system.gabineteitinerante.com.br/health/ready"
)) {
    try {
        $result = Invoke-RestMethod $url -TimeoutSec 15
        Write-Host $url ($result | ConvertTo-Json -Compress)
    } catch {
        Write-Warning "$url -> $($_.Exception.Message)"
    }
}
