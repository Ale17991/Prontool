# Research — Detalhe do Atendimento como Painel Lateral

**Feature**: 025-agenda-sheet-modal
**Status**: Phase 0 complete
**Date**: 2026-05-25

A spec já tinha decisões técnicas amarradas via Assumptions (lições aprendidas no commit revertido `f1c08c4`). Esta pesquisa formaliza por que cada uma é a escolha certa e descarta as alternativas que pareceriam tentadoras.

---

## Decisão 1: Sem intercepting routes (parallel routes `@modal/`)

**Decisão**: Painel é renderizado por um Client Component `AppointmentDetailHost` colocado dentro da árvore da agenda (lista e calendário). Estado `selectedAppointmentId: string | null` em `useState`. Sheet aberto quando o ID não é null.

**Rationale**:
- Intercepting routes do Next.js (`@modal/(.)[id]/page.tsx`) já causaram dois incidentes em produção (commit `f1c08c4` reverteu o experimento):
  1. O dynamic segment `[id]` interceptava rotas literais irmãs (`/novo`, `/bloquear`) tratando `novo` como UUID → erro 500 `invalid input syntax for type uuid: "novo"`.
  2. O componente compartilhado entre rota standalone e modal virava chunk em produção, perdia `/app/` no path da stack e o `assertCallerAllowed()` guard rejeitava `createSupabaseServiceClient()`.
- Controlar via estado React mantém todo o controle no client, evita conflito com rotas literais, evita serialização Server→Client de componentes compartilhados, e funciona idêntico em dev e prod.
- URL não muda — aceito explicitamente na FR-013. Deep-link continua via página standalone (FR-007).

**Alternatives considered**:
- *Intercepting routes* — REJEITADA (causou os dois incidentes acima).
- *Modal full-screen (`Dialog`)* — REJEITADA porque a spec pede painel lateral preservando contexto da agenda; modal central esconde a agenda.
- *Drawer Bottom-sheet (mobile-first)* — REJEITADA em desktop; o `Sheet` já se adapta para tela cheia em mobile via classes responsivas.

---

## Decisão 2: Click interception via wrapper Client + event delegation

**Decisão**: A página da lista (`page.tsx`) e a página do calendário continuam sendo Server Components. Cada uma é envolvida por um Client Component `AppointmentDetailHost` que escuta clicks na árvore via event delegation; quando o click é num `<a>` com `data-appointment-id`, faz `e.preventDefault()` + `setSelectedAppointmentId(id)`. Middle-click, ctrl/cmd-click e clicks com modificadores caem fora do filtro (event.button !== 0 || event.metaKey || event.ctrlKey) — navegação normal preservada.

**Rationale**:
- A árvore da lista (Server Component) já gera `<Link href={\`/operacao/atendimentos/${r.id}\`}>` para cada linha. Refatorar para `<button onClick>` no servidor é impossível (sem state) e perderia funcionalidades de `<Link>` (prefetch, abrir-em-nova-aba).
- Event delegation no wrapper Client é uma única função e cobre lista + calendário sem mudar as células individuais. Marcar com `data-appointment-id={id}` é uma adição mínima nos `<Link>`s.
- Preservar middle-click/ctrl-click é UX importante — usuários experientes abrem múltiplos atendimentos em abas para comparar.

**Alternatives considered**:
- *Converter linhas em Client Components com onClick* — REJEITADA pelo custo (cada célula vira Client → bundle aumenta) e perda de prefetch automático do `<Link>`.
- *Context Provider + cada célula consome* — REJEITADA pelo mesmo motivo: forçar cliente em cada célula.
- *URL hash routing (`#atendimento=<id>`)* — REJEITADA porque adicionaria complexidade de sync URL↔state sem benefício (FR-013 diz URL não muda).

---

## Decisão 3: Fetch client-side via `GET /api/atendimentos/[id]`

**Decisão**: O componente do painel busca os dados via `fetch('/api/atendimentos/' + id)` em um hook `useAppointmentDetail(id)` que expõe `{ data, loading, error, refetch }`. Cancelamento via `AbortController` quando o ID muda (cliques rápidos descartam request anterior — FR-011). Sem nova dep (sem SWR, sem React Query).

**Rationale**:
- O endpoint `/api/atendimentos/[id]` já existe e já retorna o detalhe completo via `requireRole + tenant filter`. Sem novo backend.
- `fetch + useEffect + AbortController` é suficiente para um único request por mudança de ID. Adicionar SWR/React Query seria over-engineering para um único fetch sem caching cross-component.
- Como o componente é puramente Client e nunca importa `createSupabaseServiceClient`, o guard `assertCallerAllowed()` nunca é exercitado pelo painel — incidente do commit `f1c08c4` fica impossível de reproduzir.

**Alternatives considered**:
- *Pre-fetch via Server Component dentro do Host* — REJEITADA: reintroduziria o problema do chunk path em produção.
- *Preload de todos os atendimentos da lista no Host com map(id→data)* — REJEITADA: payload exploda e nunca está fresco depois de ações.
- *SWR/React Query* — REJEITADA por adicionar dep sem ganho real para 1 fetch sob demanda.

---

## Decisão 4: Reuso dos forms de ação existentes via prop `onSuccess`

**Decisão**: Os 4 forms client existentes (`ConfirmAppointmentButton`, `CancelAppointmentForm`, `MarkRealizedForm`, `ReversalForm`) ganham uma prop opcional `onSuccess?: () => void`. Hoje eles chamam `router.refresh()` após sucesso — passam a chamar **também** `onSuccess?.()` quando definido. Página standalone passa `undefined` (comportamento inalterado); painel passa um callback que dispara `refetch()` do hook (refresh dos dados do painel) — `router.refresh()` continua existindo dentro dos forms para atualizar a lista subjacente.

**Rationale**:
- Os forms já têm toda a lógica de POST + erro tratado. Duplicá-los no painel violaria DRY e divergiria com o tempo.
- A prop é opcional → callers existentes (página standalone) não mudam.
- Após ação bem-sucedida: `router.refresh()` re-renderiza a lista subjacente E `onSuccess()` re-fetch dos dados do painel. Os dois rolam em paralelo e em <2s atendem SC-003.
- Coerente com FR-005 (painel permanece aberto refletindo novo estado).

**Alternatives considered**:
- *Duplicar os forms dentro do painel* — REJEITADA (manutenção dupla, divergência).
- *Toast global + fechar painel auto* — REJEITADA pela decisão Q2 (painel permanece aberto).

---

## Decisão 5: Guard de "form sujo" via prop `onDirtyChange`

**Decisão**: Os forms com campos editáveis (CancelAppointmentForm tem textarea de motivo; ReversalForm tem similares) ganham uma prop opcional `onDirtyChange?: (dirty: boolean) => void`. Painel mantém uma `useRef<boolean>` global; cada vez que tenta fechar/trocar e a ref está true, chama `window.confirm("Descartar alterações não salvas?")`. Se o usuário confirma, prossegue; se cancela, aborta o fechamento.

**Rationale**:
- Cumpre o edge case integrado pela Q3 (ESC, X, click-outside, trocar atendimento — todos passam pelo mesmo guard).
- `window.confirm` é nativo do browser, sem custo de UI extra. Aceitável para v1; pode virar um modal customizado depois.
- Apenas 2 forms (Cancel e Reversal) têm texto livre — escopo cirúrgico.
- `ConfirmAppointmentButton` e `MarkRealizedForm` são button-only sem campos → não precisam da prop.

**Alternatives considered**:
- *Context para registry de dirties* — REJEITADA pela complexidade (não há mais de 1 form aberto por vez no painel).
- *beforeunload do window* — REJEITADA porque só dispara em navegação real (refresh/fechar aba); painel fecha sem ser uma navegação.
- *Sempre confirmar sem checar dirty* — REJEITADA por degradar UX no caso comum (sem nada digitado).

---

## Decisão 6: Sheet customizado para largura ≥500px em desktop, full-screen mobile

**Decisão**: Usar o componente `Sheet` existente (`src/components/ui/sheet.tsx`) com variant `side="right"` e classe `w-full sm:max-w-[600px] sm:w-[600px] overflow-y-auto p-0`. O conteúdo interno tem padding `p-6`. Em mobile (<640px do Tailwind `sm`), o Sheet ocupa 100% da viewport — comportamento default do `w-full` sem a media query do `sm:max-w-*`.

**Rationale**:
- A spec pede ~500px no user input; usamos 600px para acomodar a tabela de procedimentos sem rolagem horizontal (o detalhe atual tem 7 colunas no `<Table>`).
- O Sheet já é Radix Dialog underneath → focus trap, ESC, click-outside, ARIA — tudo gratuito.
- Sem novo CSS global.

**Alternatives considered**:
- *400px ou 500px fixo* — REJEITADA: tabela de procedimentos cortaria em telas médias.
- *Resizable sheet* — REJEITADA por overhead sem demanda explícita.

---

## Decisão 7: Validação local antes do deploy (constraint operacional)

**Decisão**: Adicionar checklist explícita no `quickstart.md` (Phase 1) com fluxos críticos que devem rodar via `pnpm dev` antes de qualquer push para `master`:

1. Clicar num atendimento da lista — painel abre, dados carregam.
2. Confirmar/cancelar/estornar — painel reflete, agenda atualiza.
3. Fechar via ESC, X e click-outside.
4. Navegar para `/operacao/atendimentos/novo` — não dá 500, abre o form de criação.
5. Navegar para `/operacao/atendimentos/bloquear` — abre o form de bloqueio.
6. Acessar `/operacao/atendimentos/<uuid>` diretamente — abre página standalone.
7. Form sujo (digitar motivo no cancelar) + clicar em outro atendimento → confirma.

**Rationale**: O incidente do commit `f1c08c4` mostrou que `pnpm typecheck` + `pnpm lint:auth` passam mas a app quebra em produção. A única defesa restante é a validação manual dos fluxos críticos. Sem Docker rodando (constraint atual), testes de integração são limitados.

---

## Resumo

Nenhum `NEEDS CLARIFICATION` resta. Todas as decisões herdam restrições explícitas da spec (Assumptions) e das clarificações da sessão 2026-05-25.
