# Implantação AWS

A implantação alvo usa uma EC2 Ubuntu exclusiva para o Captive Portal. O UniFi OS Server fica em outra EC2 e o banco fica no Neon PostgreSQL.

Diretório recomendado no servidor:

```bash
/opt/portal
```

## DNS

Criar dois registros `A` apontando para o Elastic IP da EC2 do portal:

- `portal.gabineteitinerante.com.br`
- `portal-system.gabineteitinerante.com.br`

O hostname do UniFi não deve ser reapontado para a EC2 do portal.

## Grupo de Segurança

Entrada mínima recomendada na EC2 do portal:

- `80/tcp`: público, necessário para emissão/renovação HTTPS pelo Caddy.
- `443/tcp`: público, acesso real dos usuários e administradores.
- `22/tcp`: somente IP administrativo conhecido, ou substituir por AWS SSM.

Não abrir publicamente:

- `8000/tcp` do FastAPI.
- `5432/tcp` ou qualquer porta de banco.
- Portas administrativas do UniFi.

## Preparação do Servidor

```bash
sudo mkdir -p /opt/portal/backups
sudo chown -R ubuntu:ubuntu /opt/portal
cd /opt/portal
```

O arquivo `.env` deve ser criado a partir de `.env.example`, mas os valores reais devem vir de fonte segura, como SSM Parameter Store ou Secrets Manager.

```bash
cp .env.example .env
```

O `.env` real não deve ser enviado ao GitHub.

## Subida da Aplicação

```bash
docker compose build
./scripts/migrate.sh
cd backend
python -m app.cli create-admin
cd ..
docker compose up -d
docker compose ps
```

Verificação básica:

```bash
curl -f https://portal.gabineteitinerante.com.br/health/live
curl -f https://portal.gabineteitinerante.com.br/health/ready
```

## systemd

Criar `/etc/systemd/system/portal.service` para iniciar o Docker Compose junto com o servidor:

```ini
[Unit]
Description=Captive Portal Docker Compose
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/portal
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

Ativar o serviço:

```bash
sudo systemctl enable --now portal.service
```

## Pós-Deploy

Depois da subida, validar:

- HTTPS dos dois hostnames.
- Login administrativo.
- Health checks.
- Conexão com Neon.
- Conexão com UniFi.
- Fluxo real de captive portal em Android, iPhone e computador.