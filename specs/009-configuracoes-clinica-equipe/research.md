# Research — Configurações da Clínica, Perfil, Equipe e Navegação

**Feature**: 009-configuracoes-clinica-equipe
**Phase**: 0 (Outline & Research)
**Date**: 2026-05-08

Este documento consolida as decisões técnicas necessárias para destravar Phase 1. Não há `[NEEDS CLARIFICATION]` pendente do spec — as áreas abaixo são escolhas de implementação onde havia mais de um caminho viável.

---

## R1 — Estratégia de armazenamento da identidade da clínica

**Decision**: criar tabela nova `tenant_clinic_profile` (1:1 com `tenants`), em vez de adicionar colunas em `tenants`.

**Rationale**:

- `tenants` hoje é "core de tenancy" (id, slug, status, timezone) usado por RLS em **toda** consulta do sistema. Adicionar 12+ colunas opcionais (logo, CNPJ, endereço, responsável técnico) inflaria a row e reduziria a localidade de caches.
- A política RLS de `tenants` é restritiva por design (cada tenant lê só a si mesmo via JWT claim); colocar dados que precisam de update granular admin-only numa tabela dedicada permite policy específica sem mexer no `tenants` core.
- Migrações futuras (segundo responsável técnico, múltiplas filiais, branding por canal) se tornam aditivas em `tenant_clinic_profile` sem risco regressivo.

**Alternatives considered**:

- _Adicionar colunas em `public.tenants`_: rejeitado pelos motivos acima e pelo risco de quebrar policies existentes que pressupõem o shape atual.
- _JSON único `tenants.profile JSONB`_: rejeitado — perde validação por coluna (CNPJ, UF, formato de telefone), dificulta índices e contradiz o estilo do projeto (ver `tenant_integrations` que prefere colunas explícitas).

---

## R2 — Validação de CNPJ

**Decision**: helper puro local em `src/lib/core/clinic-profile/validate-cnpj.ts` — implementa o algoritmo oficial de dígitos verificadores (módulo 11). Sem dep nova.

**Rationale**:

- O algoritmo é estável (define tabular de pesos `[5,4,3,2,9,8,7,6,5,4,3,2]` e `[6,5,4,3,2,9,8,7,6,5,4,3,2]`). Implementar em ~30 linhas evita carregar uma biblioteca só para isto.
- A mesma função roda no client (form de validação imediata) e no server (rota `PUT /api/configuracoes/clinica`). Compartilhada via export simples.

**Alternatives considered**:

- `cpf-cnpj-validator` (npm): adiciona dep para algoritmo conhecido; rejeitada por bagagem desnecessária.
- Validação só por regex de formato: rejeitada — spec exige dígitos verificadores (FR-005).

---

## R3 — Lookup ViaCEP

**Decision**: Route Handler `GET /api/configuracoes/cep/[cep]` proxy para `https://viacep.com.br/ws/{cep}/json/` com `AbortSignal.timeout(3000)`. Resposta cacheada 24 h via `unstable_cache` ou `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`.

**Rationale**:

- **Privacidade**: chamar ViaCEP do server evita CORS preflight no browser e oculta o tipo de request da rede do paciente (boa prática em UI de saúde).
- **Cache**: CEPs são quase imutáveis; cache de 24 h reduz drasticamente o tráfego à API pública e melhora o p95.
- **Falha graciosa**: timeout 3 s + handler que retorna `{ ok: false }` sem 5xx, deixando o front tratar como "preencha manualmente" (FR-007 + edge case).

**Alternatives considered**:

- Chamar ViaCEP direto do browser: rejeitado pela perda de cache e do controle de timeout server-side (exposição direta de CEP no monitoramento de redes corporativas é indesejável).
- Cadastro local de CEP: fora de escopo; ViaCEP é dado externo autoritativo gratuito.

---

## R4 — Buckets e RLS para imagens (logo + avatar)

**Decision**: dois buckets privados separados — `clinic-logos` (path `{tenant_id}/logo.{ext}`) e `user-avatars` (path `{tenant_id}/{user_id}.{ext}`). Ambos com RLS em `storage.objects` no padrão já usado por `expense-receipts` (migration 0058).

Policies:

- **clinic-logos**:
  - `SELECT`: `bucket_id='clinic-logos' AND (storage.foldername(name))[1] = jwt_tenant_id()::text`
  - `INSERT`/`UPDATE`/`DELETE`: idem + `jwt_role() = 'admin'`
- **user-avatars**:
  - `SELECT`: `bucket_id='user-avatars' AND (storage.foldername(name))[1] = jwt_tenant_id()::text` (qualquer membro do tenant lê para exibir nas listas)
  - `INSERT`/`UPDATE`/`DELETE`: idem + `(storage.foldername(name))[2] = auth.uid()::text` (apenas o dono escreve)

**Rationale**:

- Reuso do padrão validado em produção pela feature 006 (expense-receipts) — RLS por primeiro segmento de path é a forma idiomática do Supabase Storage.
- Nomes determinísticos (`{tenant_id}/logo.ext` substitui silenciosamente a logo anterior) evitam acúmulo de blobs órfãos. Para avatar, o nome é `{tenant_id}/{user_id}.ext` pelo mesmo motivo.
- Buckets privados + URLs assinadas (`createSignedUrl`, validade 24 h em SSR) — mais simples que ACL público.

**Alternatives considered**:

- Bucket único `branding`: rejeitado — mistura escopos de leitura (logo é vista por todos os autenticados do tenant; avatar idem hoje, mas se um dia precisar de visibilidade diferente, fica difícil retroceder).
- Bucket público com URL aleatória: rejeitado — qualquer link vazado expõe a logo permanentemente.

---

## R5 — Validação de tipo binário das imagens

**Decision**: validar em duas camadas no upload:

1. Tamanho em `Content-Length` ≤ 2 MB (curto-circuito antes do streaming).
2. Sniff dos primeiros 16 bytes via `file.slice(0, 16).arrayBuffer()` checando magic numbers JPG (`FF D8 FF`) ou PNG (`89 50 4E 47 0D 0A 1A 0A`). Se não bater, recusa com 400 antes de subir ao Storage.

**Rationale**:

- Confiar só na extensão ou no `Content-Type` declarado abre vetor para upload de payload arbitrário renomeado para `.jpg` (FR-002, FR-025, edge case "MIME mismatch").
- Sniff binário é barato (16 bytes), executa em Node sem deps.

**Alternatives considered**:

- `sharp` ou `image-size`: deps pesadas para uma checagem que cabe em 10 linhas. Rejeitado.
- ClamAV/scan antivírus: fora de escopo da feature; os buckets são privados e a aplicação não serve esse conteúdo a anônimos.

---

## R6 — Status de "Convite pendente" — sem nova tabela

**Decision**: derivar status do par (`user_tenants.status`, `auth.users.email_confirmed_at`):

| `user_tenants.status` | `auth.users.email_confirmed_at` | Status exibido   |
| --------------------- | ------------------------------- | ---------------- |
| `active`              | `NOT NULL`                      | Ativo            |
| `active`              | `NULL`                          | Convite pendente |
| `disabled`            | qualquer                        | Desativado       |

**Rationale**:

- O Supabase já mantém `email_confirmed_at` autoritativamente; criar uma tabela `invitations` paralela duplicaria estado e exigiria sincronização.
- "Reenviar convite" se traduz em `supabase.auth.admin.inviteUserByEmail` que reusa o mesmo `auth.users.id` sem precisar de nova linha.

**Alternatives considered**:

- Tabela `invitations(email, tenant_id, role, sent_at, accepted_at)`: rejeitada — adiciona drift (e se o `auth.users` for criado antes? e se for excluído depois?). Estado derivado é mais simples e correto.

---

## R7 — Convite (Service Role + admin createUser)

**Decision**: `POST /api/configuracoes/usuarios/convite` (admin only) executa, em ordem:

1. `requireRole('admin')` valida o ator.
2. Verifica e-mail não está em `user_tenants` ativo do mesmo tenant (FR-034).
3. Cria conta com `supabaseService.auth.admin.createUser({ email, email_confirm: false })` — se já existir, retorna o `id` existente sem erro (Supabase responde 422; tratamos para reusar conta).
4. Insere em `user_tenants(user_id, tenant_id, role, status='active')`.
5. Dispara `supabaseService.auth.admin.inviteUserByEmail(email, { redirectTo: '<APP_URL>/welcome' })` para enviar o link de definição de senha.
6. Insere em `audit_log` com `entity='user_tenants'`, `field='invite'`, `new_value={ email, role }`.

**Rationale**:

- O Supabase oferece **dois** verbos relevantes — `createUser` cria a conta sem enviar e-mail; `inviteUserByEmail` envia o e-mail de convite. Combinar dá controle total: se o e-mail falhar, a row em `user_tenants` ainda fica como "Convite pendente" e o admin pode reenviar.
- Service Role é obrigatória — cliente browser não tem privilégio para `auth.admin.*`.

**Alternatives considered**:

- Apenas `inviteUserByEmail` sem `createUser` prévio: funciona, mas acopla o fluxo a uma única chamada que pode falhar parcialmente (conta criada, e-mail não entregue) sem retorno claro. A divisão em duas etapas dá idempotência.
- Magic link via `signInWithOtp`: rejeitado — não força definição de senha, e o Prontool exige senha persistente.

---

## R8 — Validação da "última admin ativa"

**Decision**: dupla camada — função SQL `is_last_active_admin(tenant_id, user_id)` chamada **(a)** no Route Handler antes da mutação para resposta clara, e **(b)** dentro de trigger `enforce_last_admin` em `user_tenants` (BEFORE UPDATE) para fechar a corrida entre duas admins se desativando simultaneamente.

```sql
CREATE OR REPLACE FUNCTION public.is_last_active_admin(p_tenant_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.user_tenants
    WHERE tenant_id = p_tenant_id
      AND user_id <> p_user_id
      AND role = 'admin'
      AND status = 'active'
  );
$$;
```

Trigger rejeita `UPDATE` que mude `role` (saindo de `admin`) ou `status` (saindo de `active`) quando a função retorna `true` para a row sendo alterada.

**Rationale**:

- Validar só em aplicação não basta: duas admins clicando "desativar" simultaneamente em janelas diferentes podem deixar o tenant órfão.
- Trigger no banco é a barreira final, idiomática neste codebase (ver triggers `enforce_appointments_*`).

**Alternatives considered**:

- Lock pessimista no `user_tenants` por tenant durante o update: rejeitado — overhead desnecessário; o trigger resolve.
- Constraint `EXCLUDE`: não se aplica diretamente porque o invariante é cardinalidade, não um conflito por overlap.

---

## R9 — Troca de senha com confirmação da senha atual

**Decision**: `POST /api/configuracoes/perfil/senha` recebe `{ currentPassword, newPassword }`, executa, em ordem:

1. `getSession()` para identificar o usuário atual (e seu e-mail).
2. `supabase.auth.signInWithPassword({ email, password: currentPassword })` numa **instância isolada** do client (não persiste cookies — usar `createClient` direto com `persistSession: false`). Se falhar → retorna `400 invalid_current_password`.
3. Validar `newPassword` contra política mínima (≥ 8 chars, ao menos 1 letra e 1 número — alinhado com defaults do Supabase Auth quando `password_strength_check=true`; o spec deixa a política da plataforma).
4. `supabase.auth.updateUser({ password: newPassword })` na sessão real.
5. Insere `audit_log` com `entity='user_profile'`, `field='password'`, sem `old/new` (zero PII de senha).

**Rationale**:

- `auth.updateUser` por si só **não** valida a senha atual — qualquer sessão sequestrada poderia trocar a senha. A reautenticação via `signInWithPassword` numa instância isolada é o padrão recomendado pelo Supabase.
- Não logar a senha (nem hash) na auditoria — Princípio II combinado com LGPD.

**Alternatives considered**:

- `auth.admin.updateUserById` com Service Role: rejeitado — precisa validar a senha atual de qualquer forma e abre vetor de privilege escalation se mal usado em outros endpoints.
- Não exigir senha atual: rejeitado pela spec (FR-030) e pelas práticas de segurança básicas.

---

## R10 — Fuso horário do usuário: persistência e aplicação

**Decision**: `user_profile.timezone` armazena IANA TZ (default `'America/Sao_Paulo'`). Aplicação usa o fuso **apenas em formatação visual** (datas/horários exibidos): pages SSR leem `user_profile.timezone` e injetam num context React que `formatDate`/`formatTime` consomem. Persistência de `TIMESTAMPTZ` permanece em UTC (constituição §"Relógio").

**Rationale**:

- Princípio constitucional explícito: timestamps persistidos em UTC, conversão na apresentação.
- O list de fusos suportados é derivado de `Intl.supportedValuesOf('timeZone')` — não precisa de tabela.

**Alternatives considered**:

- Aplicar fuso na query (`AT TIME ZONE`): rejeitado — quebra cache e cross-tenant reuse de queries.
- Fuso por tenant em vez de por usuário: já existe `tenants.timezone` para defaults globais; o fuso individual é uma preferência de exibição (FR-031), não substitui o default do tenant.

---

## R11 — Renderização da logo nos PDFs

**Decision**: novo componente compartilhado `src/lib/pdf/clinic-header.tsx` que recebe `{ profile: ClinicProfile | null }` e renderiza `<View>` com `<Image src={signedLogoUrl}/>` + dados textuais. Cada gerador de PDF existente (`prontuario-pdf`, `anamnesis/export-pdf`, `reports/export-*`) **substitui** seu header atual por este componente, recebendo `profile` no bundle.

A URL assinada é gerada **antes** do `renderToBuffer`/`renderToStream` (server-side), com TTL 5 min — suficiente para a renderização do PDF concluir.

**Rationale**:

- `@react-pdf/renderer` aceita `Image src` como string (URL) ou como Buffer. Usar URL signed mantém consistência com o pattern já existente nos PDFs.
- Header único elimina drift entre os 5+ documentos.

**Alternatives considered**:

- Embarcar a logo como base64 dentro do bundle do PDF: rejeitado — aumenta payload; uma URL signed válida por 5 min é mais limpa.
- Cada PDF buscar a logo separadamente: rejeitado — duplica fetch do storage e do row de `tenant_clinic_profile`.

---

## R12 — Redirects 301 e renomes de rota

**Decision**: estender o middleware existente (`src/middleware.ts`) com 5 redirects no mesmo padrão da rota `/cadastros/medicos` (já em produção):

| De                         | Para                                                                    |
| -------------------------- | ----------------------------------------------------------------------- |
| `/cadastros/procedimentos` | `/configuracoes/procedimentos`                                          |
| `/cadastros/planos`        | `/configuracoes/convenios`                                              |
| `/cadastros/profissionais` | `/configuracoes/profissionais`                                          |
| `/cadastros/anamnese`      | `/configuracoes/modelos-anamnese`                                       |
| `/cadastros/despesas`      | `/analise/despesas`                                                     |
| `/cadastros`               | `/configuracoes/clinica` (admin) ou `/configuracoes/perfil` (não-admin) |

Implementação: array de pares `[from, to]`, loop simples antes do branch existente. Preserva query string e fragmento (default do `NextResponse.redirect`).

**Rationale**:

- Pattern já existe no repositório (linhas 21–25 do `middleware.ts`); mantém coerência.
- 301 (permanente) é o status correto para SEO e bookmarks. Cache do browser respeita.

**Alternatives considered**:

- `next.config.js` `redirects()`: funciona, mas mistura configuração com regras dinâmicas (a última linha depende de role, que precisa do middleware autenticado). Centralizar tudo no middleware é mais simples.

---

## R13 — Sidebar: render server-side da logo + integração com o shell existente

**Decision**: a logo aparece via novo Server Component `sidebar-clinic-logo.tsx` que faz `read clinic-profile` no contexto SSR e passa `signedLogoUrl + clinicName` para o `DashboardShell` como prop. Quando ausente, fallback é o "Stethoscope ícone + 'Prontool'" atual.

**Rationale**:

- O shell atual já é `'use client'` mas recebe `email`, `role`, `integrations` como props vindas do layout SSR (ver `src/app/(dashboard)/layout.tsx`). Mesmo padrão para `clinicLogoUrl` e `clinicName`.
- Server Component evita expor o path do bucket no bundle JS.

**Alternatives considered**:

- Buscar via fetch client-side: rejeitado — flicker no carregamento inicial.

---

## R14 — Exclusão da barra de abas horizontais

**Decision**: remover o bloco `{visibleTabs.length > 0 ? (<div ...tab-bar />) : null}` do `dashboard-shell.tsx` (linhas 258–270 atuais) e descontinuar a lógica `visibleTabs`/`activeCategory` que dependia do layout categorizado. Cada item da sidebar passa a apontar diretamente para sua página final.

**Rationale**:

- O spec é explícito (FR-022): "remover completamente". Manter o branch condicional escondido por flag duplicaria caminhos.
- Os testes E2E que checam `aria-current` na tab bar precisam ser removidos/atualizados — ver tarefas em Phase 2.

**Alternatives considered**:

- Toggle por feature flag: rejeitado — adiciona dívida técnica; a regra é definitiva.

---

## R15 — `disabled` user kill-switch

**Decision**: o middleware `getUser()` que já roda em toda requisição autenticada passa a verificar a claim `tenant_status` no JWT — se ausente ou inválida, retorna 401. **Atualizar** o `auth_hook_custom_claims` (definido na migration `0019`) para **só** projetar `tenant_id` e `role` no JWT quando `user_tenants.status='active'`. Disabled → JWT vazio → todas as policies RLS rejeitam → usuário é redirecionado pra `/login` na próxima requisição (FR-039).

**Rationale**:

- O hook custom de JWT já é o ponto de injeção autoritativo das claims; estender o filtro é uma linha de SQL e mantém defesa em profundidade.
- Sessões já emitidas continuam válidas até expirar — o middleware refresca a cada request via `getUser()`, e `getUser()` reissue do JWT executa o hook, que omite as claims, resultando em `jwt_tenant_id() IS NULL` → bloqueio.

**Alternatives considered**:

- Lista negra de `user_id` na aplicação: rejeitado — frágil, fácil esquecer um endpoint.
- Forçar `signOut` server-side ao desativar: o Supabase não expõe API equivalente para invalidar sessão remota; o approach via JWT hook é o canônico.

---

## R16 — Estratégia de testes

**Decision**: cinco categorias, todas via Vitest:

1. **Unit** — `validate-cnpj`, sniff de magic number, `pdf/clinic-header` (snapshot).
2. **Contract** — request/response shape de cada endpoint novo (Zod schemas) + status codes esperados.
3. **Integration RLS** — cria 2 tenants, valida que tenant A não vê logo/avatar/profile/users de B; valida que avatar é legível por outro membro do mesmo tenant.
4. **Integration RBAC** — simula `recepcionista`, `financeiro`, `profissional_saude` em todos os endpoints admin-only; espera 403.
5. **Integration last-admin** — duas admins, desativa a última, espera trigger rejeitar.
6. **Integration redirects** — fetch a `/cadastros/...` (não autenticado e autenticado) e valida `Location` + status 301.

**Rationale**: cobre as três obrigatoriedades constitucionais (Princípios II, III, V) e os edge cases destacados no spec.

---

## Resumo de NEEDS CLARIFICATION

Nenhum. Spec entrou no plano com 0 marcadores.
