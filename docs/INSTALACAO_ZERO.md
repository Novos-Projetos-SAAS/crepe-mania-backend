# Instalação em PostgreSQL limpo — Crepe Mania

1. Crie um projeto/banco **novo**, separado do banco da Lanchonete Shirley. O usuário do banco deve ter permissões para criar tabelas/índices/funções.
2. `npm ci`; configure `.env` com `NODE_ENV=development` local, `DATABASE_URL`, `JWT_SECRET` aleatório forte, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Em Neon, configure `DB_SSL_MODE=require`.
3. `npm run db:migrate` executa exatamente **001, 002, ..., 046** com Knex. As migrations 011, 012, 031 e 035 são reservas sem DDL de pães. Todas as demais preservam a ordem cronológica exigida por chaves estrangeiras, SQL de relatórios, pagamentos e impressão.
4. `npm run db:seed` executa **001, ..., 015** usando o manifesto `src/database/seeds/seedManifest.js`, e salva status/checksums no banco. Seed 004 categorias, 006 dados da empresa, 007 administrador, 011 catálogo Crepe Mania e 015 URLs das imagens publicadas no frontend.
5. `npm run db:migrate:status` e `npm run db:seed:status` verificam histórico.
6. `npm start` ou `npm run dev`. Consulte `/api/v1/health` e `/api/v1/ready` (se aplicável).
7. No painel, confirme todas as categorias, insira **preços individuais**, ative produtos, métodos de pagamento e horário, cadastre as imagens oficiais; a loja deve iniciar fechada até finalizada a homologação.
8. Conecte o frontend; teste login, abertura/fechamento, pedido simples, pedido com adicionais, entrega/retirada, impressão, edição, relatórios e pagamentos.
9. **Jamais aplique a sequência alterada sobre o banco Shirley ou um banco que tenha migrations históricas com os mesmos números e outros nomes.**

## Deploy

**Render:** ambiente dedicado, build `npm ci && npm run db:migrate && npm run db:seed`, start `npm start`. Proteja as credenciais com env secrets e configure origens reais de CORS. O `ADMIN_PASSWORD` inicial só deve ser usado na criação da conta; altere-o após primeiro login.

**Frontend/Vercel:** novo projeto importado de `Novos-Projetos-SAAS/crepe-mania-frontend`, com `NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_SITE_URL`. Valide cookies e autorização HTTPS em produção.

**Impressão automática Android:** o front e a API mantêm o módulo, mas o APK não está nestes ZIPs; depende de adaptação específica e homologação Bluetooth.
