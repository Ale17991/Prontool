# Phase 0 — Research: Permissões granulares + autonomia de super-admin

## R1. Como aplicar overrides na autorização

- **Decision**: Manter `MATRIX[role]` e `can(role, action)` (compat). Adicionar `canUser(role, overrides, action)` em `rbac.ts`: efetivo = `(MATRIX[role] ∪ grants) \ denies` — **deny prevalece**. Carregar os overrides do ator no servidor (1 query por request/render) via `getUserOverrides(supabase, tenantId, userId)` e usar `canUser` na camada autoritativa (`requireRole`/route handlers) e nas telas (server components).
- **Rationale**: `MATRIX` inalterada = baixo risco; overrides como camada aditiva. Fonte da verdade no DB → mudança vale **imediatamente** (FR-001), sem depender de refresh do JWT.
- **Alternatives**: (a) embutir efetivo no JWT via auth hook — rejeitado (staleness; FR-001 exige imediato); (b) cachear em memória — desnecessário (tabela pequena, índice).

## R2. Onde enforce

- **Decision**: A autorização autoritativa é nos **route handlers `/api/*`** (onde já há `requireRole`) e em server actions — passam a carregar overrides do ator e chamar `canUser`. As telas (sidebar/cards/botões) refletem o efetivo, mas NÃO são o mecanismo de segurança (constituição V).
- **Rationale**: já é o ponto de checagem; estende sem novo padrão.

## R3. Conjunto overridável vs Princípio V (TENSÃO)

- **Decision (default seguro até o stakeholder decidir)**: marcar como **NÃO-overridáveis** as ações que o Princípio V protege explicitamente / financeiras-críticas: `price.write`, `commission.write`, `appointment.reverse`, `audit.read`, `audit.export` (lista a confirmar). As demais são overridáveis; as "sensíveis" não-bloqueadas mostram aviso na UI.
- **Rationale**: honra a letra de uma cláusula NON-NEGOTIABLE sem travar a autonomia nos casos comuns (ex.: `finance.view_values`, leituras, tarefas). Se o stakeholder optar por permitir as críticas, é preciso **emenda da constituição** (Princípio V) — registrado em plan.md §Complexity Tracking.
- **Alternatives**: liberar tudo (viola a letra de V sem emenda) — rejeitado por ora.

## R4. UI de overrides (admin da clínica)

- **Decision**: Em `/configuracoes/usuarios`, ação "Permissões" por usuário abre um diálogo listando as Actions agrupadas, mostrando para cada uma: vem-do-papel / concedida / revogada, com toggle tri-estado (herdar / conceder / revogar). Ações sensíveis exibem aviso ao conceder. Salvar via novo route handler (admin-only, audita).
- **Rationale**: edição explícita do efeito combinado (FR-005), com guard-rails (FR-005a).

## R5. Autonomia de super-admin (/admin)

- **Decision**: No detalhe da clínica (`clinic-detail.tsx`), abas/sub-seções novas:
  - **Usuários**: reusa `createManualUser`/convite/troca-papel/status, mas com **service client + escopo de tenant alvo** e checagem `superAdminUserId()`; auditoria com `tenant_id` alvo. (Hoje esses fluxos rodam no contexto do tenant do próprio usuário; aqui parametriza-se o tenant alvo.)
  - **Reset de senha**: reusa o fluxo de recuperação (Supabase `resetPasswordForEmail`/`generateLink`) — já há ações análogas em `admin/usuarios/actions.ts`.
  - **Dados da clínica**: form editando `tenant_clinic_profile` (nome/CNPJ/contato) com validação de CNPJ (helper existente).
  - **Entrar (read-only)**: ver R6.
- **Rationale**: maximiza reuso; o que muda é o escopo (cross-tenant, super-admin) e a auditoria.

## R6. Impersonação read-only

- **Decision**: Iniciar uma "sessão de impersonação" do super-admin para um `tenant_id`: o app passa a renderizar as telas da clínica em modo **read-only** — todas as escritas (route handlers/actions) são **bloqueadas no servidor** enquanto a impersonação está ativa (guard central: se o ator é super-admin impersonando, nega qualquer Action de escrita). Banner fixo visível + auditoria de início/fim. Tempo limitado (expira).
- **Rationale**: a parte boa do suporte (enxergar como a clínica vê) sem risco de alteração em nome do cliente. Evolução futura: "assumir controle" (escrita) sob auditoria reforçada.
- **Open**: mecanismo exato de sessão (cookie assinado de impersonação vs claim) — detalhe de implementação; o invariante é "escrita bloqueada no servidor".

## R7. Auditoria

- **Decision**: Toda mutação (override set, criar/editar/desativar usuário, troca de papel, reset, início/fim de impersonação) e **negações** relevantes gravam em `audit_log` via `log_audit_event` com ator, `tenant_id` alvo, entidade/alvo, antes/depois, motivo, origem (IP/UA).
- **Rationale**: FR-010/011 + Princípio II.

## R8. Migração

- **Decision**: `0163_user_permission_overrides.sql` cria a tabela (PK `(tenant_id, user_id, action)` ou id + unique), RLS por tenant (admin lê/escreve do próprio tenant; service_role para super-admin), índice `(tenant_id, user_id)`. Sem backfill (começa vazio = comportamento atual). Append de auditoria via app.
- **Rationale**: aditivo, reversível, sem alterar dados existentes.
