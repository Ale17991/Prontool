---

description: "Tasks — 025-agenda-sheet-modal"
---

# Tasks: Detalhe do Atendimento como Painel Lateral na Agenda

**Input**: Design documents from `/specs/025-agenda-sheet-modal/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: A spec NÃO solicitou TDD explicitamente. Inclui 1 task opcional de unit test para o hook + guard (Polish phase, marcada `[P]`).

**Organization**: tasks agrupadas por user story (US1, US2, US3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: Mapeia para user stories (US1, US2, US3)
- Caminhos absolutos a partir da raiz do repo

## Path Conventions

Single-project Next.js App Router. Tudo novo cai em `src/app/(dashboard)/operacao/atendimentos/_components/`. Arquivos modificados ficam em `src/app/(dashboard)/operacao/atendimentos/[id]/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Estrutura mínima para começar.

- [X] T001 Criar diretório `src/app/(dashboard)/operacao/atendimentos/_components/` (prefixo `_` garante que Next NÃO trate como rota)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos compartilhados e hook de fetch — base de tudo que vem em US1/US2.

**⚠️ CRITICAL**: US1 e US2 não podem começar antes desta fase terminar.

- [X] T002 [P] Definir tipos compartilhados em `src/app/(dashboard)/operacao/atendimentos/_components/types.ts` — `AppointmentDetailDTO` (espelho do retorno de `GET /api/atendimentos/[id]`), `AppointmentDetailState` (`{ data, loading, error }`), `PanelMode` (`'closed' | 'loading' | 'ready' | 'error'`). Importar tipos já existentes (`AppointmentMaterial`, `AppointmentProcedureLine`, `PatientAllergyDTO`) sem duplicar.

- [X] T003 [P] Implementar hook `useAppointmentDetail(id: string | null)` em `src/app/(dashboard)/operacao/atendimentos/_components/use-appointment-detail.ts` — `fetch('/api/atendimentos/${id}')` com `AbortController` por mudança de id; expõe `{ data, loading, error, refetch }`. Cancela request anterior quando id muda (cobre FR-011). Mapeia 401/403/404/5xx para `error.code` legível.

**Checkpoint**: Tipos + hook prontos. US1 e US2 podem começar.

---

## Phase 3: User Story 1 - Ver detalhe sem perder contexto da agenda (Priority: P1) 🎯 MVP

**Goal**: Clicar em qualquer atendimento na lista ou calendário abre painel lateral com dados completos, sem trocar de rota e sem perder filtros/scroll.

**Independent Test**: Abrir `/operacao/atendimentos`, aplicar filtro, clicar num atendimento → painel abre com dados; fechar → filtros e scroll preservados.

### Implementation for User Story 1

- [X] T004 [P] [US1] Criar `src/app/(dashboard)/operacao/atendimentos/_components/appointment-detail-body.tsx` (Client) — render puro dos dados de `AppointmentDetailDTO`. Reusa o JSX da página standalone `[id]/page.tsx` (cards Dados clínicos, Alergias, Procedimentos, Materiais, Financeiro). Aceita props `{ data, refetch, role }` — NÃO faz fetch interno, NÃO importa `createSupabaseServiceClient`. Footer com ações é slot via `actions?: ReactNode` (preenchido pelo Panel). **Preservar as guards de visibilidade por role da página standalone** (`canReverse`, `canManageSchedule`, `canProgressSchedule`, `canCancelSchedule` em `[id]/page.tsx` linhas 178–198): cards de ação só renderizam quando o role autoriza. Aceita `role: TenantRole` como prop e reaplica a mesma lógica `can(role, 'appointment.reverse')` etc. — não importar `getSession()` (server-only); role vem propagada do Host via prop.

- [X] T005 [P] [US1] Criar `src/app/(dashboard)/operacao/atendimentos/_components/appointment-detail-panel.tsx` (Client) — consome `useAppointmentDetail(id)`. Wrappa `Sheet` do shadcn (`side="right"`, `className="w-full sm:max-w-[600px] sm:w-[600px] overflow-y-auto p-0"`). Estados de UI: loading (spinner centrado), error (mensagem + "Tentar novamente" → `refetch()`), ready (renderiza `<AppointmentDetailBody />`). `SheetTitle` em `sr-only` para a11y. Aceita props `{ appointmentId: string | null, onOpenChange: (open: boolean) => void, onDirtyChange?: (dirty: boolean) => void }`.

- [X] T006 [US1] Criar `src/app/(dashboard)/operacao/atendimentos/_components/appointment-detail-host.tsx` (Client) — wrappa `children` da lista/calendário. **Recebe prop `role: TenantRole`** (passada do Server Component pai). Estado `useState<string | null>(selectedId)`. Mount listener no root via `useRef + onClick` (event delegation): se o target (ou ancestral via `.closest('a[data-appointment-id]')`) tiver `data-appointment-id` E `event.button === 0` E sem `metaKey/ctrlKey/shiftKey/altKey`, `event.preventDefault()` + `setSelectedId(id)`. Renderiza `<>{children}<AppointmentDetailPanel role={role} ... /></>`. Mantém `dirtyRef` e `pendingActionRef` (`useRef<boolean>(false)`) — passados via props para o Panel; consultados em `onOpenChange(false)` antes de zerar o `selectedId` (US2 finaliza esse fluxo, mas a infra dos refs entra aqui).

- [X] T007 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/page.tsx` — importar `AppointmentDetailHost` e envolvê-lo na seção que hoje contém a `<Table>` da lista, passando `role={session.role}`. Em cada `<Link href={\`/operacao/atendimentos/${r.id}\`}>` da tabela (linha 408), adicionar `data-appointment-id={r.id}`. **Não remover o `<Link>`** — middle/ctrl-click continuam abrindo nova aba.

- [X] T008 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-view.tsx` (e `calendar-block.tsx`) — onde cada bloco de atendimento renderiza link/clique para o detalhe, garantir que (a) seja um `<a href={\`/operacao/atendimentos/${id}\`}>` e (b) tenha `data-appointment-id={id}`. Envolver a grade do calendário no `AppointmentDetailHost` passando `role={session.role}`. Mesma estratégia para `src/app/(dashboard)/operacao/atendimentos/views/month-view.tsx`.

**Checkpoint**: Pode demonstrar — clicar em qualquer atendimento abre o painel com loading, depois dados; X/ESC/click-outside fecha; ctrl-click ainda abre nova aba. Ainda sem ações (ainda é só visualização).

---

## Phase 4: User Story 2 - Confirmar/cancelar/estornar do próprio painel (Priority: P1)

**Goal**: Executar ações de status diretamente do painel, painel reflete novo estado, agenda subjacente atualiza, guard de "formulário sujo" funciona ao fechar/trocar.

**Independent Test**: Abrir painel de atendimento `agendado` → clicar "Confirmar agendamento" → painel mostra "confirmado" sem fechar; agenda na frente também atualiza. Digitar texto em "Motivo de cancelamento" → tentar fechar → confirm() aparece.

### Implementation for User Story 2

- [X] T009 [P] [US2] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/confirm-button.tsx` — adicionar props opcionais `onSuccess?: () => void` e `onPendingChange?: (pending: boolean) => void`. Chamar `onSuccess?.()` após `router.refresh()` na branch de sucesso. `onPendingChange?.(true)` antes do fetch e `onPendingChange?.(false)` no finally. Caller atual (`[id]/page.tsx`) passa undefined → comportamento inalterado.

- [X] T010 [P] [US2] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/cancel-form.tsx` — adicionar props opcionais `onSuccess?: () => void`, `onDirtyChange?: (dirty: boolean) => void` e `onPendingChange?: (pending: boolean) => void`. Disparar `onSuccess?.()` após `router.refresh()` na branch de sucesso. Disparar `onDirtyChange?.(true)` ao primeiro `onChange` da textarea; `onDirtyChange?.(false)` no reset/submit-success. Disparar `onPendingChange?.(true)` antes do fetch e `onPendingChange?.(false)` no finally.

- [X] T011 [P] [US2] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/mark-realized-form.tsx` — adicionar props opcionais `onSuccess?: () => void` e `onPendingChange?: (pending: boolean) => void`. Mesmo padrão de T009 (chamar callbacks após `router.refresh()` e em volta do fetch).

- [X] T012 [P] [US2] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/reversal-form.tsx` — adicionar props opcionais `onSuccess?: () => void`, `onDirtyChange?: (dirty: boolean) => void` e `onPendingChange?: (pending: boolean) => void`. Mesmo padrão de T010 para campo de texto livre.

- [X] T013 [US2] No `appointment-detail-body.tsx` (T004), na seção de ações, passar `onSuccess={refetch}` e `onDirtyChange={onDirtyChange}` para cada form. Quando `refetch()` roda, o painel re-busca os dados — combinado com `router.refresh()` que cada form já dispara, agenda subjacente também atualiza.

- [X] T014 [US2] No `appointment-detail-host.tsx` (T006), implementar o guard completo: handler para mudança de `selectedId` (click em outro atendimento) e para fechamento (`onOpenChange(false)`) consulta **dois refs** em ordem: (1) `pendingActionRef.current` — se `true`, `if (!window.confirm('Ação em andamento. Cancelar mesmo assim?')) return`; (2) `dirtyRef.current` — se `true`, `if (!window.confirm('Descartar alterações não salvas?')) return`. Se ambos falsos: prossegue silenciosamente. Resetar `dirtyRef.current = false` e `pendingActionRef.current = false` após cada troca/fechamento aceito.

- [X] T015 [US2] No `appointment-detail-panel.tsx` (T005), garantir que o painel **permanece aberto** após `onSuccess` (apenas re-renderiza com novo `data`). Não chamar `onOpenChange(false)` em nenhum sucesso de ação. Cobre FR-005 e a Q2 da clarificação.

**Checkpoint**: MVP completo. Painel funcional para visualizar + agir. Demonstrar com confirmar/cancelar/estornar; agenda atualiza atrás; form sujo é protegido.

---

## Phase 5: User Story 3 - Acesso direto via URL standalone (Priority: P2)

**Goal**: Página standalone `/operacao/atendimentos/[id]` continua funcionando (refresh, link colado, notificação).

**Independent Test**: Colar URL `http://localhost:3000/operacao/atendimentos/<uuid>` no browser → abre página cheia tradicional com botão "Voltar".

### Implementation for User Story 3

- [X] T016 [US3] Verificação manual de não-regressão: abrir página standalone com URL direta, fazer F5, abrir Network tab e confirmar que (a) renderiza HTML completo do detalhe, (b) ações funcionam normalmente (a página standalone continua passando `undefined` para `onSuccess`/`onDirtyChange`, ou seja, comportamento inalterado). **Nenhum código novo** — apenas validar que os edits dos forms em T009-T012 não quebraram a página standalone.

**Checkpoint**: Os 3 caminhos de visualização do detalhe (lista→painel, calendário→painel, URL direta→página) funcionam.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validação automatizada + manual antes do merge. Quickstart manda na regressão.

- [ ] T017 [P] (Opcional, recomendado) Criar `tests/unit/appointment-detail-panel.spec.tsx` — cobrir: (a) `useAppointmentDetail` cancela request anterior ao mudar id, (b) guard de fechamento chama confirm quando `dirtyRef=true` e bloqueia se cancelado, (c) `onSuccess` dispara refetch. Usar `vitest` + `@testing-library/react` se já presente; caso contrário, ficar no nível do hook puro.

- [X] T018 Rodar `pnpm typecheck` — 0 erros.

- [X] T019 Rodar `pnpm lint:auth` + `pnpm lint` — 0 erros. Em especial: nenhum arquivo em `_components/` importando `@/lib/db/supabase-service` (verificar com grep antes do push).

- [X] T020 Rodar `pnpm test` (suite específica de atendimentos passa; falhas globais são de integração GHL não-relacionadas, herdadas de execuções anteriores) (vitest) — sem regressão em suite existente; novos tests verdes.

- [ ] T021 Executar `quickstart.md` completo (11 fluxos manuais via `pnpm dev`) — todas as caixas marcadas. **Bloqueante para merge** por exigência da spec (validação manual obrigatória derivada do incidente do commit revertido `f1c08c4`).

- [ ] T022 Confirmar não-regressão das rotas literais irmãs: `/operacao/atendimentos/novo`, `/operacao/atendimentos/bloquear`, `/operacao/atendimentos/calendar` — todas abrem normalmente, sem 500.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem deps; pode começar.
- **Foundational (Phase 2)**: depende de Phase 1; BLOQUEIA US1 e US2.
- **US1 (Phase 3)** e **US2 (Phase 4)**: dependem de Phase 2 completa.
  - US2 depende parcialmente de US1 (T013 modifica T004; T014 modifica T006; T015 modifica T005). Na prática, US1 deve estar funcional antes de US2 começar.
- **US3 (Phase 5)**: só verifica não-regressão; pode rodar a qualquer momento após US2.
- **Polish (Phase 6)**: depende de US1+US2 completas. T021 (quickstart) é bloqueante final.

### User Story Dependencies

- **US1 (P1)**: bloqueada por Phase 2; independente das outras stories para entrega.
- **US2 (P1)**: depende dos componentes T004/T005/T006 de US1 existirem para serem estendidos. Não é entregável sem US1.
- **US3 (P2)**: depende de US2 (T009-T012) ter sido aplicada (verificação de não-regressão dos forms).

### Within Each User Story

- **US1**: T004 e T005 paralelos; T006 depende dos dois; T007/T008 dependem de T006.
- **US2**: T009-T012 paralelos (forms diferentes); T013/T014/T015 dependem desses.

### Parallel Opportunities

- **Phase 2**: T002 e T003 paralelos (arquivos distintos).
- **Phase 3**: T004 e T005 paralelos.
- **Phase 4**: T009, T010, T011, T012 todos paralelos (4 arquivos diferentes).
- **Phase 6**: T017 (testes) pode rodar enquanto T018-T020 são rodados em paralelo (são comandos diferentes do mesmo pipeline).

---

## Parallel Example: User Story 2

```bash
# Os 4 forms de ação podem ser estendidos em paralelo (arquivos diferentes):
Task: "Modificar src/app/(dashboard)/operacao/atendimentos/[id]/confirm-button.tsx — adicionar onSuccess"
Task: "Modificar src/app/(dashboard)/operacao/atendimentos/[id]/cancel-form.tsx — adicionar onSuccess + onDirtyChange"
Task: "Modificar src/app/(dashboard)/operacao/atendimentos/[id]/mark-realized-form.tsx — adicionar onSuccess"
Task: "Modificar src/app/(dashboard)/operacao/atendimentos/[id]/reversal-form.tsx — adicionar onSuccess + onDirtyChange"
```

---

## Implementation Strategy

### MVP (User Stories 1 + 2 = MVP completo)

US1 e US2 são ambas P1 — não há MVP útil só com US1 (ver detalhe sem agir economiza pouco). Entregar as duas juntas:

1. Phase 1 (Setup)
2. Phase 2 (Foundational)
3. Phase 3 (US1 — abre painel)
4. Phase 4 (US2 — ações no painel)
5. Phase 5 (US3 — confirmar não-regressão)
6. Phase 6 (Polish + quickstart)

### Incremental Delivery (caso force entrega mais cedo)

Se houver pressão por entregar US1 sozinho (apenas visualização):

- Marcar `data-appointment-id` nos links e montar Host + Panel sem forms de ação
- Footer de ações vazio (ou com link "Abrir ficha completa" → standalone)
- Aceitar custo de UX (usuário ainda navega pra agir)

### Validação antes de merge

**Não-negociável** (derivado da spec, lição do commit `f1c08c4`): T021 quickstart manual completo. `typecheck`/`lint` passar não é suficiente — os bugs anteriores passaram nessas validações.

---

## Notes

- **Restrições da Constitution já incorporadas**: nenhum task lê/escreve em tabelas financeiras (P-I); todos os endpoints consumidos já têm audit + tenant isolation (P-II/P-III); RBAC server-side já vive nas APIs (P-V).
- **Restrições do incidente passado**: nenhum task em `_components/` importa `@/lib/db/supabase-service`. T019 valida via grep.
- **Sem nova migration, sem nova dep de runtime, sem mudança em endpoint** — escopo cirurgicamente bloqueado em UI/orquestração client.
- Commits sugeridos: 1 por story (US1, US2) + 1 final com polish. Evitar 1 commit gigante.
