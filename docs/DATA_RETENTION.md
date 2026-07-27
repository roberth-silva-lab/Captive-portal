# Retenção de Dados

A aplicação registra somente os dados necessários para autenticação, autorização, auditoria e operação do Captive Portal.

`DATA_RETENTION_DAYS` controla a janela padrão de retenção.

## Política Esperada

1. Sessões ativas expiram pelo horário do servidor.
2. Dados pessoais devem ser removidos ou anonimizados após o prazo definido.
3. Estatísticas agregadas podem ser preservadas quando úteis para operação.
4. Logs de auditoria administrativa devem seguir política formal de retenção.

## Dados Pessoais

Dados como CPF, email, telefone e IP devem ser tratados como pessoais. O acesso a esses dados deve ser restrito e o armazenamento deve evitar exposição desnecessária.

## Atenção Jurídica

Registros exigidos por obrigação legal, auditoria ou investigação não devem ser removidos sem política formal aprovada.