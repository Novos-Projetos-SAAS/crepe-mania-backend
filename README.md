# Crepe Mania — Backend

Clone independente da API **Lanchonete Shirley**, adaptado para **Crepe Mania** (Luiziânia/SP), mantendo pedidos públicos, painel administrativo, login/convites/permissões, adicionais, relatórios, auditoria, notificações, Socket.IO, InfinitePay opcional e fila de impressão.

**Atenção:** esta entrega é código-fonte preparado, **não é implantação homologada em produção**. Não execute migrations no banco da Shirley: crie uma base PostgreSQL exclusiva da Crepe Mania.

## Pré-requisitos

- Node.js 22.x, npm, PostgreSQL 15+ (ou Neon isolado).
- `DATABASE_URL` exclusivo para Crepe Mania.
- `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` forte (mín. 12 caracteres, maiúscula, minúscula e número), `JWT_SECRET` seguro.

## Instalação do zero

```bash
npm ci
cp .env.example .env
# Edite as variáveis obrigatórias da .env, especialmente DATABASE_URL, ADMIN_* e JWT_SECRET.
npm run db:migrate
npm run db:seed
npm run dev
```

No PowerShell: `Copy-Item .env.example .env`.

**Importante:** `npm run db:migrate` aplica **46 migrations** em sequência numérica `001`–`046`. O banco é criado vazio antes desta etapa. `npm run db:seed` aplica **14 seeds** `001`–`014` em ordem através de runner com registro de checksums. Você também pode usar `npm run db:deploy` (migrations + seeds). **Não** use `knex seed:run`.

Migrations `011`, `012`, `031`, `035` são etapas históricas intencionalmente vazias, pois tratavam exclusivamente de seleção de pães ou seus relatórios. O esquema final **não contém tabelas de pães**, e pedidos usam somente produto + adicionais opcionais. **Não use estas migrations para atualizar o banco original da Shirley**, cujos checksums e nomes são diferentes.

O seed `004` cria 11 categorias; o `011` cadastra **75 produtos referenciais, todos desativados e sem preço**, porque as imagens do cliente apresentam informações comerciais não confirmadas. Insira preços, revise produtos e habilite-os pelo painel antes de abrir a loja. O seed não herda pedidos, clientes, usuários ou dados da Shirley. A loja inicia fechada.

## Desenvolvimento e verificações

```bash
npm run check:source # audita numeração e catálogo sem acessar o banco
npm run lint
npm run test:unit
npm run test:integration  # teste de inventário; requer DATABASE_TEST_URL e RUN_DB_INTEGRATION=true
npm run db:migrate:status
npm run db:seed:status
```

API local: `http://localhost:3333`, prefixo `/api/v1`, saúde `/api/v1/health` e documentação `/docs`. Configure `ALLOWED_ORIGINS` com a URL real do frontend.

## Hospedagem

- Render: build `npm ci && npm run db:migrate && npm run db:seed`; start `npm start`.
- Configure `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `APP_PUBLIC_URL`, `ADMIN_*` e demais secrets **no ambiente da hospedagem**, nunca no repositório.
- Confira o banco exclusivo, CORS/cookies, origem pública, migrações e health checks antes de liberar tráfego.
- Recursos R2, Web Push, InfinitePay e impressão necessitam configuração adicional; mantê-los desabilitados até homologar.
- O protocolo externo `shirleyprint://` foi preservado em uma rota de pareamento **por compatibilidade com o aplicativo Android legado**. O código-fonte do aplicativo Android não foi fornecido e deve ser adaptado/reinstalado separadamente antes de habilitar impressão automática.

Mais detalhes em `docs/INSTALACAO_ZERO.md` e `docs/CATALOGO_INICIAL.md`.
