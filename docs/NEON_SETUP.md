# Configuração Neon PostgreSQL

O banco de produção deve usar Neon PostgreSQL com papéis separados para migration e runtime.

## Papéis Recomendados

- Papel owner/admin: usado apenas para Alembic e tarefas de schema.
- `captive_app`: usado pela aplicação em runtime.

## Permissões do Runtime

Exemplo de SQL para executar com o papel owner, ajustando banco e senha no momento da criação:

```sql
create role captive_app login password 'REPLACE_AT_CREATION_TIME';
grant connect on database captive to captive_app;
grant usage on schema public to captive_app;
grant select, insert, update, delete on all tables in schema public to captive_app;
grant usage, select, update on all sequences in schema public to captive_app;
alter default privileges in schema public grant select, insert, update, delete on tables to captive_app;
alter default privileges in schema public grant usage, select, update on sequences to captive_app;
```

## Variáveis de Ambiente

`DATABASE_URL` deve usar o usuário `captive_app` e conexão adequada para runtime.

`MIGRATION_DATABASE_URL` deve usar conexão direta com o papel owner, apenas para Alembic.

As duas URLs precisam usar SSL:

```text
sslmode=require
```

Strings reais de conexão não devem ser commitadas.