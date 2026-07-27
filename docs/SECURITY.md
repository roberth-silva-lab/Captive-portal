# Segurança

Este projeto deve ser tratado como aplicação exposta à Internet e integrada a rede Wi-Fi real. As configurações de produção precisam evitar defaults inseguros e impedir exposição direta do backend.

## Sessão Administrativa

A autenticação administrativa usa cookie HttpOnly. Em produção, o cookie deve ser `Secure` e trafegar somente por HTTPS.

A proteção CSRF usa um segundo cookie legível pelo frontend e o header `X-CSRF-Token`. Rotas administrativas que alteram estado exigem esse token.

Tokens administrativos não devem ser salvos em `localStorage`.

## Senhas e Secrets

Senhas administrativas são armazenadas com Argon2id.

Secrets reais não devem aparecer no repositório. Exemplos:

- `.env` real.
- API key UniFi.
- string real do Neon.
- senha SMTP.
- chaves privadas e certificados privados.
- JWT/secret key/Fernet key reais.

O arquivo `.env.example` deve conter apenas placeholders.

## Dados Pessoais

CPF, email, telefone e IP são dados pessoais. O backend deve armazenar somente o necessário e usar criptografia/máscara quando aplicável.

A política de retenção deve definir quando dados pessoais são removidos ou anonimizados.

## CORS e Headers

CORS deve aceitar somente:

- `https://portal.gabineteitinerante.com.br`
- `https://portal-system.gabineteitinerante.com.br`

Não usar `*` em produção.

Caddy e FastAPI adicionam headers de segurança compatíveis com navegadores captive portal.

## UniFi

A integração com UniFi deve usar API key e SSL válido.

Em produção, `UNIFI_VERIFY_SSL=false` não é permitido.

Não usar usuário/senha administrativa do UniFi quando a Integration API com API key estiver disponível.

## Limitação Conhecida

O rate limiting atual é adequado para uma instância de backend. Antes de escalar horizontalmente, usar Redis ou outro backend compartilhado para limitar tentativas entre instâncias.