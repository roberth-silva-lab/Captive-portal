# Execução no Windows — Posto Esdras

Este documento descreve a execução do Captive Portal no Windows sem manter janelas de PowerShell abertas. O desenho atual usa:

- Frontend React/Vite compilado em `frontend/dist`.
- Caddy escutando somente em `127.0.0.1:8090`.
- FastAPI/Uvicorn escutando somente em `127.0.0.1:8000`.
- Cloudflare Tunnel como entrada pública.
- Neon PostgreSQL como banco central.
- UniFi Network Server local via API clássica (login + cookie de sessão).

## 1. Arquivo .env

Use apenas o arquivo `.env` na raiz do repositório. O backend resolve esse arquivo pela localização do código, portanto não depende mais do diretório atual do processo.

Para o controlador local do Esdras:

```env
APP_ENV=production
DEBUG=false
PUBLIC_BASE_URL=https://portal.gabineteitinerante.com.br
ADMIN_BASE_URL=https://portal-system.gabineteitinerante.com.br
ALLOWED_ORIGINS=https://portal.gabineteitinerante.com.br,https://portal-system.gabineteitinerante.com.br
TRUSTED_PROXY_IPS=127.0.0.1,::1

UNIFI_AUTH_MODE=legacy
UNIFI_BASE_URL=https://127.0.0.1:8443
UNIFI_USERNAME=captive-api
UNIFI_PASSWORD=COLOQUE_A_SENHA_LOCAL_SOMENTE_NO_ENV
UNIFI_SITE=default
UNIFI_SITE_LABEL=Esdras
UNIFI_VERIFY_SSL=false
UNIFI_TIMEOUT_SECONDS=10
UNIFI_CACHE_TTL_SECONDS=5

DATABASE_POOL_SIZE=10
DATABASE_MAX_OVERFLOW=10
DATABASE_POOL_TIMEOUT_SECONDS=30
```

Mantenha no mesmo `.env` as URLs reais do Neon, SECRET_KEY, FERNET_KEY e SMTP. Nunca versione o arquivo real.

Se existir `backend/.env` de testes anteriores, remova-o ou renomeie-o depois de confirmar que a raiz contém todos os valores corretos. Isso evita duas fontes de configuração.

## 2. Atualizar dependências e compilar o frontend

No PowerShell:

```powershell
cd C:\Users\RFB_OCR\Captive-portal

.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-prod.txt

cd .\frontend
npm.cmd ci
npm.cmd run build
cd ..
```

## 3. Atualizações com migração

Quando uma atualização incluir uma nova revisão Alembic, atualize o código e aplique a migração **antes** de reiniciar a API. A revisão `20260923_0008` inclui os ajustes mais recentes de vouchers sem limite, renovação de acesso e controles de contas administrativas.

```powershell
cd C:\Users\RFB_OCR\Captive-portal
git pull --ff-only

cd .\backend
$env:PYTHONPATH="$PWD"
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
cd ..
```

Depois compile o frontend e reinicie os serviços na ordem Caddy → API → Caddy:

```powershell
cd .\frontend
npm.cmd ci
npm.cmd run build
cd ..

Stop-Service CaptivePortalCaddy
Restart-Service CaptivePortalApi
Start-Service CaptivePortalCaddy
```

Aplique a migração antes do restart para evitar que o backend atualizado encontre um schema antigo.

## 4. Instalar API e Caddy como serviços

Abra o PowerShell como Administrador. O script usa WinSW para criar serviços nativos com inicialização automática, reinício em caso de falha e logs rotativos.

Se as instâncias manuais de Caddy/Uvicorn ainda estiverem abertas, use `-StopExisting`:

```powershell
cd C:\Users\RFB_OCR\Captive-portal

powershell.exe -ExecutionPolicy Bypass -File .\scripts\windows\install-services.ps1 -StopExisting
```

Serviços criados:

- `CaptivePortalApi`
- `CaptivePortalCaddy`

O `cloudflared` existente não é alterado.

Logs:

```text
C:\ProgramData\CaptivePortal\Logs\api
C:\ProgramData\CaptivePortal\Logs\caddy
```

## 5. Verificação

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\windows\status.ps1
```

Ou manualmente:

```powershell
Get-Service CaptivePortalApi,CaptivePortalCaddy,cloudflared

curl.exe -i http://127.0.0.1:8000/health/ready
curl.exe -i http://127.0.0.1:8090/health/ready
curl.exe -i https://portal.gabineteitinerante.com.br/health/ready
curl.exe -i https://portal-system.gabineteitinerante.com.br/health/ready
```

Todos devem voltar após reiniciar o Windows sem abrir terminal.

## 6. UniFi legado

No modo `legacy`, o backend autentica no Network Server com a conta técnica local e mantém o cookie de sessão. O adaptador usa:

```text
POST /api/login
GET  /api/self/sites
GET  /api/s/{site}/stat/sta
GET  /api/s/{site}/stat/device
POST /api/s/{site}/cmd/stamgr
```

A autorização de visitante é confirmada consultando novamente o cliente por alguns segundos antes de considerar a sessão liberada.

## 7. Teste seguro do UniFi

Antes de testar um celular, valide a conta técnica sem imprimir cookies, senhas ou payloads de dispositivos:

```powershell
cd C:\Users\RFB_OCR\Captive-portal
$env:PYTHONPATH="$PWD\backend"
.\backend\.venv\Scripts\python.exe .\backend\scripts\check_unifi.py
```

O resultado deve terminar em `UniFi OK` e mostrar somente contagens por site.

## 8. Hotspot Visitantes-Esdras

O captive portal deve ser aplicado apenas ao SSID público. Para o ambiente atual:

```text
Servidor de Portal Externo (IPv4): 192.168.5.3
Domínio: portal.gabineteitinerante.com.br
Permissão pré-autorização: portal.gabineteitinerante.com.br
URL criptografada: desativada
```

O painel administrativo permanece em `portal-system.gabineteitinerante.com.br`.

## 9. Migração do UniFi Network Server da AWS

Não desligue a instância AWS antes do corte concluído.

Sequência recomendada:

1. Gere um backup completo e recente do UniFi Network Server na AWS.
2. Registre a versão do Network Server usada na AWS.
3. Instale no Windows uma versão compatível, preferencialmente a mesma ou uma versão que aceite a restauração daquele backup.
4. Restaure o backup no Windows e confirme sites, redes, WLANs, vouchers e dispositivos.
5. Crie/revalide a conta local `captive-api` sem Remote Access, com acesso somente aos sites necessários.
6. Confirme que `/api/login`, `/api/self/sites`, `/stat/sta` e `/stat/device` funcionam localmente.
7. Faça o corte dos APs/controladores para o novo Network Server e confirme que eles aparecem conectados antes de desligar a AWS.
8. Teste um único celular no SSID de visitantes: redirecionamento, autenticação, `authorized=true`, navegação e expiração.
9. Mantenha o backup da AWS até o ambiente local ficar estável.

Evite manter dois controladores tentando gerenciar os mesmos APs durante o corte.

## 10. Manutenção

A manutenção pode ser global ou específica por unidade. O painel diferencia:

- desativada;
- agendada;
- ativa;
- encerrada.

Uma unidade sem configuração própria herda a manutenção global. Os atalhos de 30 minutos e 1 hora facilitam uma intervenção rápida. Durante uma manutenção ativa, a API pública bloqueia novas autorizações e o frontend mostra a tela amigável configurada, sem expor erro técnico.
