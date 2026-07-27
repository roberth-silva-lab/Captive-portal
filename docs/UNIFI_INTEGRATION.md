# Integração UniFi

A integração com o UniFi usa a UniFi Network Integration API com `X-API-Key`.

Servidor esperado em produção:

```text
https://unifi.gabineteitinerante.com.br:11443
```

Prefixo esperado:

```text
/proxy/network/integration/v1
```

## Endpoints Usados

A aplicação usa as seguintes operações documentadas pela UniFi:

- `GET /v1/sites`
- `GET /v1/sites/{siteId}/clients`
- `POST /v1/sites/{siteId}/clients/{clientId}/actions` com `AUTHORIZE_GUEST_ACCESS`
- `POST /v1/sites/{siteId}/clients/{clientId}/actions` com `UNAUTHORIZE_GUEST_ACCESS`
- `GET /v1/sites/{siteId}/devices`

## Fluxo de Autorização

1. O cliente entra na rede Wi-Fi convidada.
2. O UniFi redireciona para o portal externo com parâmetros como `id`, `ap`, `ssid` e `url`.
3. O portal valida o método de autenticação escolhido.
4. O backend consulta o UniFi para localizar o cliente pelo MAC.
5. O backend envia `AUTHORIZE_GUEST_ACCESS`.
6. O backend consulta novamente o UniFi.
7. O portal só mostra sucesso quando o UniFi confirma `authorized=true`.

## Limites de Voucher e Guest

O portal armazena metadados avançados de voucher:

- `time_limit_minutes`
- `data_limit_mb`
- `download_limit`
- `upload_limit`
- `max_devices`
- `site`
- `enabled`
- `expires_at`

Na chamada de autorização do cliente, somente campos documentados pela UniFi são enviados:

- `timeLimitMinutes`
- `dataUsageLimitMBytes`
- `rxRateLimitKbps`
- `txRateLimitKbps`

As demais regras são aplicadas pelo próprio portal:

- `max_devices`: limite de dispositivos por voucher.
- `site`: restrição local do voucher.
- `enabled`: ativa ou desativa o voucher.
- `expires_at`: validade administrativa do voucher.

Parâmetros não documentados não devem ser inventados nem enviados ao UniFi.

## Requisitos de Produção

- API key válida no UniFi Network.
- SSL válido no hostname do UniFi.
- `UNIFI_VERIFY_SSL=true`.
- Grupo de Segurança permitindo acesso da EC2 do portal à EC2 do UniFi na porta configurada.
- Site UniFi correto em `UNIFI_SITE` ou payload do portal.