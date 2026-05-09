# Research — Multi-Tenant Lifecycle, GHL 1:1 Binding e Filtros do Calendário

**Feature**: 010-multi-tenant-ghl-calendar
**Phase**: 0 (Outline & Research)
**Date**: 2026-05-08

Sem `[NEEDS CLARIFICATION]` herdados do spec. As decisões abaixo cobrem escolhas de implementação onde havia mais de um caminho válido.

---

## R1 — Reutilizar os índices existentes da migration 0062 para o vínculo GHL 1:1

**Decision**: NÃO criar nenhum schema novo para US1. Confiar em duas estruturas já em produção:

1. `tenant_integrations.PRIMARY KEY (tenant_id, provider)` — garante uma única linha por (tenant, ghl).
2. `tenant_integrations_unique_active_location_id` (UNIQUE INDEX parcial em `(location_id) WHERE provider='ghl' AND enabled=true`) — garante que o mesmo `location_id` GHL não pode aparecer ATIVO em mais de uma linha.

**Rationale**:
- Ambas constraints já existem desde a feature 008. O comportamento desejado de US1 é uma combinação delas + mensagens de erro claras.
- Duplicar a regra com um trigger ou tabela à parte introduziria estado divergente (qual constraint é a "verdadeira"?) e custo de manutenção.
- O que faltava — e é o trabalho real desta story — é o **pre-flight em aplicação**: antes do upsert, fazer um SELECT que detecte a violação e responda com a mensagem específica de FR-004 + audit. A constraint do banco continua como rede de segurança contra race condition.

**Alternatives considered**:
- *Adicionar trigger PL/pgSQL que valida e levanta exceção customizada*: aumenta surface de erro silencioso, e a mensagem da exceção é "vazada" em logs sem controle.
- *Tabela `ghl_bindings(tenant_id PK, location_id UNIQUE)` espelhando a relação 1:1*: redundante; mais um lugar para sincronizar.

---

## R2 — Pre-flight de binding no `connectGhlTenant`

**Decision**: criar `src/lib/core/integrations/ghl/binding-check.ts` exportando `assertGhlBindingFree(supabase, { tenantId, locationId })` que:

1. SELECT em `tenant_integrations` por `(tenant_id, provider='ghl', enabled=true)` — se existe, lança `ConflictError('GHL_TENANT_ALREADY_CONNECTED', mensagem FR-001)`.
2. SELECT por `(provider='ghl', enabled=true, location_id=:loc)` filtrando `tenant_id <> :tenantId` — se existe, lança `ConflictError('GHL_LOCATION_ALREADY_BOUND', mensagem FR-002)`.

`connectGhlTenant` chama `assertGhlBindingFree` ANTES do upsert. Em ambos os casos, escreve audit com `field='integration.connect.rejected'` e `result='conflict'` (FR-008).

**Rationale**:
- Centralizar em um único helper (`binding-check.ts`) garante que callback OAuth e webhook install façam exatamente a mesma checagem.
- ConflictError já mapeia para HTTP 409 no `toHttpResponse`.
- Se entre o pre-flight e o upsert outra requisição inserir uma linha conflitante, o partial unique index do banco rejeita com `23505` — `connectGhlTenant` capta o erro e re-lança como o mesmo `ConflictError` (defesa em profundidade contra race).

**Alternatives considered**:
- *Validar só na constraint do banco*: a mensagem retornada seria genérica de PostgreSQL, não FR-004. Reprovado.
- *Fazer LOCK explícito*: overkill — o pre-flight + a constraint cobrem o caso 99,9% das vezes; race condition residual é tratado pelo erro do banco.

---

## R3 — Onboarding atômico via RPC `create_first_tenant`

**Decision**: nova função SQL SECURITY DEFINER `create_first_tenant(p_user_id, p_name, p_slug, p_cnpj, p_phone)` que dentro de uma única transação:

1. Tenta INSERT em `tenants(name, slug, status='active')` — se `slug` colide, levanta `unique_violation` (caller resolve com sufixo).
2. INSERT em `user_tenants(user_id, tenant_id, role='admin', status='active')`.
3. UPSERT em `user_active_tenant(user_id, tenant_id)`.
4. Opcionalmente INSERT em `tenant_clinic_profile(tenant_id, cnpj, phone)` (lazy — pode ficar para o admin preencher depois também).
5. Retorna o `tenant_id`.

**Rationale**:
- Atomicidade é requisito (FR-014 — "uma única operação atômica"). Fazer 4 chamadas separadas do client poderia deixar estado parcial se a sessão cair no meio.
- SECURITY DEFINER permite que o caller (RLS-bound como o usuário recém-criado, sem clínica) faça o INSERT em `tenants` que normalmente requer admin. O caller só consegue chamar a RPC com `p_user_id = auth.uid()` (validado dentro da RPC).
- Mantém RLS como a única autoridade nas leituras subsequentes.

**Alternatives considered**:
- *Service role do JS lado do servidor para fazer 4 inserts*: funciona, mas service role bypass RLS — risco maior. Em RPC SECURITY DEFINER conseguimos restringir explicitamente o que pode rodar (validação de input, `auth.uid()` check).
- *Fazer tudo client-side com Supabase JS*: rejeitado por atomicidade.

---

## R4 — Persistência de "última clínica usada"

**Decision**: tabela `user_active_tenant(user_id PRIMARY KEY → auth.users, tenant_id → tenants, updated_at)` — 1:1, atualizada toda vez que o usuário faz switch ou login (se vier do `auth_hook` com tenant resolvido). FK ON DELETE CASCADE em `auth.users` e ON DELETE SET NULL em `tenants` (se a clínica é apagada, o vínculo "última usada" some, mas o user fica).

**Rationale**:
- Persistência server-side sobrevive a troca de dispositivo/navegador (vs. cookie puro).
- O `auth_hook_custom_claims` lê esta tabela como segunda prioridade (depois do `user_metadata.active_tenant_id` que é o "hint do switch atual"). Combina o melhor dos dois: cookie/metadata para troca rápida; tabela para persistência cross-device.
- Tabela 1:1 é a estrutura mais simples — nada de versionamento.

**Alternatives considered**:
- *Cookie HttpOnly só*: perde-se a info ao limpar cookies / trocar device. Rejeitado.
- *user_metadata only*: requer que o backend escreva nele em todo switch (já fazemos), mas leitura no auth_hook precisa parsear JSON dentro do JWT context — viável, mas a tabela dedicada é mais explícita e testável.

---

## R5 — Switch de tenant sem deslogar

**Decision**: rota `POST /api/auth/switch-tenant {tenantId}` faz, em ordem:

1. Validar que o usuário tem vínculo ATIVO com `tenantId` (`user_tenants` → status='active'). Se não, 403.
2. `supabaseService.auth.admin.updateUserById(userId, { user_metadata: { active_tenant_id: tenantId } })`.
3. UPSERT em `user_active_tenant`.
4. Audit `entity='session', field='tenant_switch', old_value=<tenant_anterior>, new_value=<novo>`.
5. Responder `200 { ok: true }`.

No client, depois da resposta:

6. `supabase.auth.refreshSession()` — força re-mint do JWT, que dispara o `auth_hook_custom_claims` com o novo `active_tenant_id` no metadata.
7. `router.push('/operacao/atendimentos')` + `router.refresh()`.

**Rationale**:
- Nunca chamamos `signOut` — essencial para FR-024.
- `refreshSession` é o único caminho público que regenera o access_token sem re-login (Supabase JS SDK 2.x).
- Audit registra a transição (Princípio II).

**Alternatives considered**:
- *Cookie próprio fora do Supabase Auth*: precisaríamos sincronizar com RLS por outra via — quebra a integração natural com `auth.jwt() ->> 'tenant_id'`.

---

## R6 — `auth_hook_custom_claims` — ordem de prioridade

**Decision**: a função vira:

```text
desired := user_metadata.active_tenant_id
if desired and ut(user_id, desired, status=active) → use it
elif user_active_tenant(user_id).tenant_id and ut(user_id, that, status=active) → use it
elif first ut(user_id, *, status=active) → use it
else → claims sem tenant_id/role  (kill-switch + redirect /onboarding)
```

**Rationale**:
- `user_metadata` representa **intenção atual** (escolha pós-switch); ganha prioridade.
- `user_active_tenant` é **memória persistente** entre dispositivos.
- `first active` cobre o caso multi-tenant onde nada está pré-marcado (raro — geralmente o auth_hook é chamado depois de algum switch ou login com cookie).
- Quando o usuário fica sem tenant ativo (todos disabled OU acabou de fazer signup), as claims saem vazias, jwt_tenant_id() == NULL, RLS rejeita tudo, middleware redireciona.

**Alternatives considered**:
- *Apenas user_metadata*: força que TODA sessão (mesmo a primeira após signup) tenha um cookie/metadata pré-set, o que é frágil.
- *Apenas user_active_tenant*: switch precisa de duas writes (cookie + tabela) e o auth_hook ainda lê só uma — adiciona latência e duplicação.

---

## R7 — Slug auto-gerado com colisão

**Decision**: helper puro `src/lib/core/auth/slug.ts` exportando:

- `slugify(name)`: lowercase, normaliza acento (NFD + replace), espaços/caracteres especiais → `-`, max 60 chars.
- `nextAvailableSlug(supabase, base)`: tenta `base`; se exists, tenta `base-2`, `base-3`, ... até 100 (defesa contra loop).

`onboarding.ts` chama `nextAvailableSlug` antes do `create_first_tenant` para sugerir um slug livre. O usuário pode editar manualmente; ao salvar, se o slug que ele escolheu colide, retorna 409 com sugestão.

**Rationale**:
- Slug auto-livre na entrada do form == zero atrito; usuário só vê colisão se editar manualmente para algo que conflita.
- Limite 100 evita loop infinito em casos patológicos.

**Alternatives considered**:
- *Random suffix (`-xy7k`)*: feio, e o usuário não consegue prever; rejeitado.

---

## R8 — Página `/registrar` e signup

**Decision**: nova rota client `/registrar` (similar a `/login` existente) que:

1. Form: nome completo, email, senha, confirmar senha. Validação client-side (senha igual, força mínima).
2. Submit chama `POST /api/auth/signup` (não browser-side `supabase.auth.signUp` direto) — server-side wrapper permite audit + métricas + futura adição de captcha.
3. Server: `supabaseService.auth.admin.createUser({ email, password, email_confirm: false, user_metadata: { full_name } })`.
4. Cria `user_profile` (full_name) lazy — ou deixa para o `getUserProfile` lazy-create na primeira leitura.
5. Audit (`entity='user_account', field='signup'`).
6. Response 201 → client faz `supabase.auth.signInWithPassword` para autenticar imediatamente, depois `router.push('/onboarding')`.

**Rationale**:
- Server-side wrap dá controle: rate-limit, captcha futuro, audit.
- `email_confirm: false` permite acesso imediato; a verificação por e-mail vira recuperação de senha futura (FR-012 + assumption 1).

**Alternatives considered**:
- *Pure client-side `supabase.auth.signUp`*: simples mas perde audit e dificulta extensão.

---

## R9 — Onboarding como (auth) layout

**Decision**: as três rotas `/registrar`, `/onboarding`, `/selecionar-clinica` ficam sob `src/app/(auth)/` (layout sem sidebar). O dashboard layout `(dashboard)` continua exigindo tenant ativo. Middleware redireciona:

| Estado da sessão | Rota acessada | Ação |
|------------------|---------------|------|
| Não autenticado | `/operacao/*` ou `/configuracoes/*` etc. | redirect `/login` |
| Autenticado sem tenant | qualquer `(dashboard)/*` | redirect `/onboarding` |
| Autenticado com 1+ tenant ativo, mas sem ativo selecionado | qualquer `(dashboard)/*` | redirect `/selecionar-clinica` (se >1) ou auto-select e segue |
| Autenticado com tenant ativo | `/login`, `/registrar`, `/onboarding` | redirect `/operacao/atendimentos` (não voltar) |

**Rationale**:
- Separar layouts é a forma idiomática do App Router.
- Middleware já existe para 301s; estender com a tabela acima é uma adição clara.

**Alternatives considered**:
- *Misturar tudo no `(dashboard)` e gambiar com `if`s*: pior DX e mais fácil de quebrar.

---

## R10 — Mini-calendário sem nova dep

**Decision**: componente próprio `mini-calendar.tsx` ~150 linhas usando apenas `date-fns` (já no projeto). Recebe `{ value: Date, onSelect, hasAppointmentsByDay: Set<string> }`. Renderiza grid 7×6, dias do mês destacados, dias com atendimento marcados com `<span>` ponto.

**Rationale**:
- Adicionar `react-day-picker` ou similar (~30 KB gz) só para isso é overkill — temos o requisito específico (indicar dias com atendimento) que não vem padrão na biblioteca.
- Manter alinhado com o estilo visual do resto do produto sem pelear com themes da lib.

**Alternatives considered**:
- *react-day-picker*: bom mas ~3KB de markup customizado em cima cancela o benefício.

---

## R11 — Estado dos filtros do calendário em URL

**Decision**: hook próprio `useCalendarFilters()` retorna `{ filters, setFilter, clear, asQuery }`. Lê e escreve via `useSearchParams`/`router.replace` (Next.js App Router). Schema de query string:

| Param | Valores | Default |
|-------|---------|---------|
| `view` | `dia` \| `semana` \| `mes` | `semana` |
| `date` | `YYYY-MM-DD` | hoje |
| `from`, `to` | `YYYY-MM-DD` | inferido de view+date |
| `doctor` | UUID | (todos) |
| `status` | `agendado` \| `realizado` \| `cancelado` | (todos) |
| `procedure` | substring (procedure name) | — |
| `patient` | substring (patient name) | — |

`clear` reseta a URL para `/operacao/atendimentos` (sem qs).

**Rationale**:
- URL como single source of truth: bookmarks, share links, browser back/forward funcionam.
- Schema enxuto — só 7 params, todos opcionais (exceto view+date que têm defaults).

**Alternatives considered**:
- *Estado em React + sync para URL*: divergência fácil. URL primeiro é mais simples e correto.
- *Compactar tudo em um único `?f=`*: ofuscação desnecessária; legibilidade > brevidade.

---

## R12 — Visualização Mês: paginação implícita

**Decision**: A query atual de atendimentos retorna até N (paginated). Para Mês, fazemos uma única query do range completo (`from = início da primeira semana visível`, `to = fim da última`). O endpoint `GET /api/atendimentos` aceita `from`/`to` e retorna até 1000 itens; para até ~500 atendimentos cabíveis num mês de uma clínica média, isso é confortável. Cada célula de dia recebe `appointments.filter(d => sameDay(d.appointmentAt, day))` e exibe os primeiros 3 + chip "+N mais" se exceder.

**Rationale**:
- 500 atendimentos == ~50KB no fio — aceitável, não vale paginar mês.
- Render Mês fica purely client-side (group by day) sem chamada extra ao clicar "+N mais" (abre lista filtrada por dia, que já tem os dados).

**Alternatives considered**:
- *Endpoint dedicado `GET /api/atendimentos/calendar-month?date=...`*: redundante; o endpoint atual já serve.

---

## R13 — Sidebar tenant.name vs corporate_name

**Decision**: o nome editado em `/configuracoes/clinica` (campo "Razão social / Nome de exibição" da feature 009) passa a atualizar **dois campos**: `tenants.name` (o display name) E `tenant_clinic_profile.corporate_name` (o nome legal — usado no PDF junto com CNPJ). Default da migration: já existe a coluna `tenants.name` (NOT NULL, do migration 0002 — sempre preenchida). A sidebar lê **`tenants.name`** como fonte primária.

**Rationale**:
- O `tenants.name` foi sempre obrigatório, então funciona desde o início. Renomear não exige migration.
- A separação semântica fica: `tenants.name` = "nome curto/de exibição" (sidebar, seletor, header de PDF como título); `tenant_clinic_profile.corporate_name` = "razão social legal" (linha abaixo no PDF). Em 99% dos casos serão iguais; o admin pode divergir se quiser (ex.: "Clínica Sorriso" como display vs. "Clínica Sorriso Odontologia LTDA" como razão).
- A página `/configuracoes/clinica` ganha um campo "Nome de exibição" (atualiza `tenants.name`) acima do "Razão social" (atualiza `corporate_name`). Quando o admin edita só um, o outro fica como estava.

**Alternatives considered**:
- *Sidebar lê corporate_name primário*: feature 009 já faz isso; mas corporate_name é null em muitos tenants (legacy), forçando fallback "Prontool" — quebra FR-022 e SC-006.
- *Sidebar tenta corporate_name → fallback tenants.name*: aceitável, mas adiciona ramo desnecessário; tenants.name SEMPRE existe.

---

## R14 — Validação de signup (e-mail duplicado, senha fraca)

**Decision**: o handler `/api/auth/signup` valida:

1. Zod: email RFC, password >= 8 chars com letra+dígito (mesma policy de change-password).
2. Tenta `auth.admin.createUser`. Se Supabase responde 422/409 (e-mail existe), retorna **mensagem genérica** "Não foi possível criar a conta. Tente outro e-mail." (FR-011 — não revela existência).
3. Audit de tentativa (sucesso ou falha).

**Rationale**:
- A política de senha é a mesma do change-password (feature 009) — consistência.
- Mensagem genérica em e-mail duplicado é prática padrão anti-enumeration.

**Alternatives considered**:
- *Mensagem específica "e-mail já cadastrado, faça login"*: ajuda UX mas vaza enumeration. Aceitável para alguns produtos; não para o nosso (LGPD, dados clínicos).

---

## R15 — Marketplace install e a regra 1:1

**Decision**: `webhooks/ghl/install` chama `connectGhlTenant({ source: 'marketplace_install', tenantId, ... })` que agora delega ao `assertGhlBindingFree`. Se o webhook chega para uma sub-account já vinculada a outro tenant:

1. assertGhlBindingFree lança `GHL_LOCATION_ALREADY_BOUND`.
2. O handler responde **HTTP 409** com body indicando o conflito (GHL deveria interpretar como "install rejected").
3. Audit em ambos lados (no tenant alvo se conhecido, e cross-system com `tenant_id=null` quando o install era para criar tenant novo).

Se o webhook tenta criar um tenant novo e a sub-account já está bound: NÃO criamos o tenant. O `connectGhlTenant` só roda DEPOIS da criação do tenant — então a verificação tem que acontecer ANTES da criação.

**Decision (ordem do install handler)**:

1. Verificar binding da location_id ANTES de criar tenant.
2. Se livre, criar tenant + provisionar admin (auto-provisioning existente).
3. Chamar connectGhlTenant (que faz nova checagem de binding como defesa).

**Rationale**:
- Evita cleanup posterior se algo der errado: criamos o tenant só quando temos certeza que vamos conseguir conectar.
- Audit em `tenant_id=null` quando rejeitado antes da criação (linha de auditoria com tenant_id NULL é aceita pelo schema).

**Alternatives considered**:
- *Criar tenant primeiro, tentar conectar, se falhar deletar o tenant*: pode deixar inconsistência; pior cleanup. Rejeitado.

---

## R16 — Estratégia de testes

**Decision**:

1. **Unit** — `slug-generation.spec.ts`, `calendar-filter-state.spec.tsx` (URL ↔ state round-trip).
2. **Contract** — endpoints novos (`signup`, `switch-tenant`, `onboarding`, `oauth/ghl/callback` com binding).
3. **Integration** — `ghl-binding-rule.spec.ts` (3 caminhos de violação + happy path), `signup-onboarding-flow.spec.ts` (cria conta nova → vê /onboarding → cria clínica → cai no dashboard), `switch-tenant-no-reauth.spec.ts` (verifica que JWT muda mas sessão persiste), `auth-hook-active-tenant.spec.ts` (ordem de prioridade).
4. **RLS regression** — implícita nos integration tests acima (criando 2 tenants e verificando isolamento).

**Rationale**: cobre as três obrigatoriedades constitucionais (II, III, V) e os edge cases destacados no spec.

---

## Resumo de NEEDS CLARIFICATION

Nenhum. Todas as ambiguidades foram resolvidas com decisões justificadas acima.
