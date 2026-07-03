# Phase 0 — Research: Calendário de atendimentos, typeahead TUSS, catálogo odonto e navegação

**Feature**: 004-calendario-atendimentos
**Date**: 2026-04-27

Este documento consolida as decisões técnicas tomadas antes do desenho (Phase 1). Cada item resolve uma incerteza ou justifica uma escolha de plataforma.

---

## R-001: Como representar `duration_minutes` em `appointments`

**Decisão**: Acrescentar coluna `duration_minutes INTEGER NULL CHECK (duration_minutes BETWEEN 5 AND 480)` em `appointments`. NULL permitido. Default `30` aplicado em leitura (COALESCE no SELECT/DTO), nunca no banco.

**Rationale**:

- Princípio I (Imutabilidade Financeira): atendimentos passados não podem sofrer UPDATE. Default no banco implicaria backfill, e backfill em registros financeiros viola o princípio. Default em leitura preserva o registro original e dá um valor sensato para a UI.
- 30 min cobre o caso mais comum (consulta padrão). Janela 5–480 min impede valores absurdos no novo formulário.
- `INTEGER` (não `INTERVAL`): a UI pensa em "minutos" e o cálculo de altura do bloco é trivial em minutos.

**Alternativas consideradas**:

- `INTERVAL` no Postgres — mais expressivo, mas força conversões no client; sem ganho real.
- Default `30` no banco com backfill — viola Princípio I.
- Tabela separada `appointment_meta` com (appointment_id, duration_minutes) — overengineering para um único campo opcional.

---

## R-002: Onde guardar o estado do calendário (semana corrente, profissionais selecionados, granularidade)

**Decisão**: **Querystring**. Formato:

```
/operacao/atendimentos?view=cal&week=2026-05-03&doctors=uuid1,uuid2&grain=week
```

- `view`: `list` (default, omite na URL) | `cal`
- `week`: ISO date do domingo da semana exibida (ou do dia para `grain=day`)
- `doctors`: lista de UUIDs separados por vírgula; ausente = todos
- `grain`: `day` | `week` | `month`; ausente = `week`

**Rationale**:

- SSR-friendly: o server component lê `searchParams` e já fetcha o intervalo correto, sem flicker.
- Compartilhar URL e back/forward do navegador funcionam sem código adicional.
- Sem dependência de cookie/localStorage, evita estado fantasma entre abas.
- Filtro de profissional no querystring atende FR-012 ("persiste entre navegações de semana dentro da sessão") — clicar "semana próxima" preserva `doctors` na nova URL.

**Alternativas consideradas**:

- Cookie / localStorage — menos compartilhável; exige hidratação cuidadosa.
- Server-side preference por usuário — fora de escopo (spec é explícita: "reseta entre sessões").

---

## R-003: Library de calendário — custom vs externa

**Decisão**: **Implementação custom** com Tailwind grid + `date-fns` para aritmética.

**Rationale**:

- Requisitos são simples: 7 colunas × 16 linhas (07–22h), slot de 1h, blocos posicionados absolutamente.
- `react-big-calendar` (~150 KB) e `fullcalendar` (~400 KB) são exagerados; trazem CSS próprio que conflita com o design system.
- Algoritmo de overlap (lanes) cabe em ~30 LOC.
- Custom dá controle total sobre acessibilidade e responsividade.

**Alternativas consideradas**:

- `react-big-calendar`: bundle grande, styling difícil de override.
- `fullcalendar`: licença comercial para Premium; community version não atende mobile bem.
- `@nivo/calendar`: orientado a heatmap, não agenda.

---

## R-004: Pré-preenchimento da hora ao clicar em slot vazio

**Decisão**: Querystring `?at=<ISO local com offset>` em `/operacao/atendimentos/novo`. O form converte para `datetime-local` no `useState` inicial.

Exemplo: clicar em terça 14:00 navega para `?at=2026-05-05T14:00:00-03:00`.

**Rationale**:

- Reaproveita o `searchParams` que o componente server já lê.
- ISO com offset evita ambiguidade de fuso (Princípio: timestamps UTC, conversão na apresentação).
- `<input type="datetime-local">` aceita o formato após `slice(0, 16)` no client.

**Alternativas consideradas**:

- Passar via state (Zustand/Context) — exige client-only flow, perde SSR.
- Query separada `?date=&time=` — mais campos, mais conversão.

---

## R-005: Drawer "Ver em lista" para TUSS

**Decisão**: shadcn `<Dialog>` em `max-w-3xl`, com tabela paginada client-side a 20 linhas. Reutiliza endpoint `/api/tuss-codes?q=&table=&limit=200` (já existe), buffering de 200 itens; paginação acontece no client sobre o buffer + nova fetch quando o usuário ultrapassa.

**Rationale**:

- `<Dialog>` já usado em outras partes do sistema (consistência visual).
- 200 itens em memória é leve; paginar a 20 dá UX previsível.
- Buscar via endpoint existente evita criar nova rota.

**Alternativas consideradas**:

- shadcn `<Sheet>` (drawer lateral) — bom para mobile, mas tabela larga renderiza melhor em modal centralizado.
- Server pagination (offset/limit em backend) — mais complexo; o catálogo todo são ~6k itens, server pagination só vale se buscarmos sem filtro, e nesse caso o limit=200 já cobre.

---

## R-006: Filtro multi-profissional persistente

**Decisão**: Lista de profissionais renderizada server-side (full list de `doctors` do tenant). Toggle no client: shadcn `<Popover>` + lista com checkboxes + "Selecionar todos" + botão "Aplicar" que push o querystring.

Inativos aparecem com badge cinza "(inativo)" e ainda são selecionáveis para auditoria histórica (FR-012 + edge case).

**Rationale**:

- Server-side fetch da lista evita waterfall.
- "Aplicar" explícito (em vez de auto-apply por toggle) evita N requests durante seleção múltipla.
- Querystring suporta share-link (decisão R-002).

**Alternativas consideradas**:

- Auto-apply por toggle — UX ruim com 5+ profissionais.
- Combobox single-select — não atende FR-012 (multi).

---

## R-007: Linha de hora atual

**Decisão**: Client component `<CurrentTimeLine>` que usa `useEffect` + `setInterval(updateNow, 60_000)`. Posicionada com `top: ${(hour - 7) * 4}rem + ${minute / 60 * 4}rem` (cada slot é 4rem alto).

**Rationale**:

- Atualização por minuto basta — granularidade visual de 1px é suficiente.
- 60s evita re-render frequente; setInterval é cancelável no cleanup.

**Alternativas consideradas**:

- `requestAnimationFrame` — desperdício; minuto basta.
- WebSocket de tempo real — completamente fora de escopo.

---

## R-008: Sobreposição de blocos no mesmo slot

**Decisão**: Algoritmo "lanes" inline em `src/lib/utils/calendar.ts`:

1. Ordenar blocos do dia por `start ASC, duration DESC`.
2. Para cada bloco, encontrar a primeira lane (0..3) que não está ocupada no intervalo.
3. Width = `100% / numLanesUsadas`, left = `lane * width`.
4. Se >4 lanes seriam necessárias, blocos extras viram um item "+N mais" no slot afetado, expansível por click.

**Rationale**:

- Welsh-Powell completo é overkill; 4 lanes cobre 99% dos casos reais (clínica pequena/média).
- "+N mais" evita layout quebrado em casos raros (mutirões).

**Alternativas consideradas**:

- Empilhar verticalmente — perde a noção de horário.
- Lib externa de scheduling — peso desproporcional.

---

## R-009: Mobile breakpoint para forçar Day view

**Decisão**: Tailwind `sm` breakpoint (640px). Em `< sm`, o componente do calendário ignora `grain=week|month` da querystring e renderiza Day. A querystring permanece — desktop ainda enxerga semana se a URL for compartilhada.

Detecção via `useMediaQuery` custom hook ou `window.matchMedia` no client (com SSR fallback para week).

**Rationale**:

- 640px alinha com convenção mobile do projeto (mesmo breakpoint usado na 003-responsive-design).
- Manter `grain=week` na URL preserva intent — só a renderização adapta.

**Alternativas consideradas**:

- Forçar mudança de `grain` na URL via redirect — quebra back/forward.
- Renderizar miniatura da semana — UX ruim em mobile.

---

## R-010: Reconciliação odonto

**Decisão**: Script offline `scripts/tuss-odonto-audit.ts` que:

1. Baixa o ZIP oficial ANS 202501 de `gov.br/ans/.../Padrao_TISS_Representacao_de_Conceitos_em_Saude_202501.zip`.
2. Extrai e parsa o XLSX (via `exceljs` já instalado).
3. Compara com `tuss_codes` local (filtra `tuss_table='22'`).
4. Imprime relatório por prefixo (81–88) com diferenças.

A migration 0053 não importa códigos novos (investigação prévia provou que a fonte oficial tem **menos** dental que o atual `charlesfgarcia`); apenas insere uma row em `tuss_catalog_versions` documentando a versão 202501 como referência consultada.

**Rationale**:

- Princípio IV exige catálogo versionado e sincronizado; a row em `tuss_catalog_versions` cumpre o papel de evidência sem mutar dados.
- Script é idempotente; auditor roda quando quiser e tem o relatório pronto.
- Não acrescenta códigos para evitar regressão de dados que já estavam OK.

**Alternativas consideradas**:

- Importar todos os 241 códigos novos (não-odonto) da ANS 202501 — fora do escopo desta feature; merece feature separada com revisão de impacto em adapters de billing.
- Endpoint admin com botão "Reconciliar agora" — UI sobrando para algo que rodará 1× por trimestre.

---

## R-011: Estratégia de testes

**Decisão**:

- **Unit (Vitest)**: helpers puros em `src/lib/utils/calendar.ts` — slot positioning, lane assignment, week math. Sem DB.
- **Integration (Vitest + Supabase local)**: `list-week.ts` rodando contra DB seedado com 5+ atendimentos em 2 profissionais; verifica filtro `doctorIds`, intervalo correto, ordenação.
- **Contract (Vitest)**: snapshot do shape do DTO de `<CalendarView>` props para evitar regressão.
- **E2E (Playwright, smoke)**: 1 cenário — abrir Lista, alternar para Calendário, clicar em slot vazio, ver `/novo?at=...`. Rodar só em CI-light (não Playwright full).

**Rationale**:

- Casamento com o que o repo já usa (`vitest`, `pnpm test:integration`, `pnpm test:contract`).
- Helpers puros são o ponto mais bug-pronoso; testes unitários prendem regressão barato.
- E2E mínimo evita pyramid pesado em UI feature.

---

## Resumo das deps adicionadas

**Nenhuma**. `date-fns` já existe (4.1), shadcn primitives idem. Nenhuma lib de calendário externa. Nenhuma lib nova de tabela paginada (custom em ~50 LOC).

## Open questions remanescentes

Nenhuma. Todas as `[NEEDS CLARIFICATION]` do template foram resolvidas no Phase 0.
