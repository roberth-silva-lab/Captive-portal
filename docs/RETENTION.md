# Retenção e Anonimização

Este documento resume a política operacional de retenção. A versão detalhada fica em `docs/DATA_RETENTION.md`.

A aplicação deve manter dados pessoais apenas pelo tempo necessário para operação, suporte, auditoria e obrigações legais.

Configuração principal:

```text
DATA_RETENTION_DAYS
```

Após esse prazo, dados pessoais devem ser removidos ou anonimizados. Estatísticas agregadas podem permanecer quando não identificarem diretamente o visitante.