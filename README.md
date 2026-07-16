# goBuy — Plataforma de Compras Vammo

Solicitações de compra, aprovações por head de centro de custo, documentos fiscais e
execução de pagamentos — substituindo o fluxo manual de todas as áreas.

**Stack:** Next.js (App Router) · Supabase (Postgres `finance` schema + Auth + Storage) · Vercel
**Spec:** [docs/superpowers/specs/2026-06-10-gobuy-purchase-platform-design.md](docs/superpowers/specs/2026-06-10-gobuy-purchase-platform-design.md)

## Como funciona

| Papel | Acesso |
|---|---|
| Qualquer @vammo.com | Cria solicitações (produtos/serviço/adiantamento), acompanha status, anexa PDFs (NF, cotações), cancela enquanto pendente |
| Head (e-mail em `finance.cost_center_heads`) | Aba **Aprovações**: budget por centro (pizza consumido × disponível), fila pendente ordenável, aprovar/recusar |
| `finance` (em `finance.user_roles`) | Aba **Financeiro**: tudo + fila de pagamento + marcar paga |
| `fiscal` | Aba **Financeiro** somente leitura + todos os documentos |

Toda mudança de estado passa por RPCs `security definer` com auditoria em
`finance.request_events`. Clientes não têm INSERT/UPDATE/DELETE direto em nenhuma tabela.
Arquivos ficam no bucket privado `finance-documents`, acessível apenas via API do app.

## ⚠️ Configuração pendente (só você consegue fazer — Dashboard)

1. **Google OAuth**: Supabase → Authentication → Sign In / Providers → Google → Enable.
   Crie o OAuth Client no Google Cloud Console (tipo *Internal* no workspace Vammo),
   redirect URI: `https://jfdqlnpidynxwqqiblcd.supabase.co/auth/v1/callback`.
2. **URLs de auth**: Supabase → Authentication → URL Configuration →
   Site URL = `https://gobuy-gmb-eltrami-s-projects.vercel.app` (ou domínio final);
   Additional Redirect URLs: `http://localhost:3000/auth/callback` e a URL de produção + `/auth/callback`.
3. **Expor o schema**: Supabase → Settings → API → *Exposed schemas* → adicionar `finance`.
4. **Bucket**: Supabase → Storage → New bucket → nome `finance-documents`, **Private**.
5. **Chave secreta**: Supabase → Settings → API keys → copie a *service role / secret key* e
   adicione como env var `SUPABASE_SECRET_KEY` no Vercel (Production) e no seu `.env.local`.
6. **Papéis**: conceda finance/fiscal/admin via SQL (uma vez):
   ```sql
   insert into finance.user_roles (user_email, role, granted_by_email)
   values ('fulana@vammo.com', 'finance', 'gabriel.beltrami@vammo.com');
   ```
7. **Liberar a URL de produção**: Vercel → projeto `go_buy` → Settings →
   Deployment Protection → Vercel Authentication → **Only Preview Deployments**.
   (Hoje a URL devolve 401 do SSO da Vercel; o app tem o próprio login Google @vammo.)

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # preencha SUPABASE_SECRET_KEY
npm run dev
```

## Dados

- Centros de custo + heads: seedados de `CC_DATA` legado (109 centros, 10 heads).
- Budgets: **mock** (`source='mock'`, Jun–Dez 2026). Para plugar a fonte real, faça upsert em
  `finance.cost_center_budgets` com outro `source` (RPC `finance.upsert_cost_center_budget`).
- Slack: estrutura pronta (`finance.slack_notification_queue` + `/api/slack/interact` em 501);
  o design do fluxo de 1 clique está documentado no próprio endpoint.
