# Contract — Calendar Advanced Filters & Views (US4)

**Feature**: 010 | **Group**: agenda UX

US4 é majoritariamente UI. Este contrato documenta:

1. **URL query string** que serve de single source of truth dos filtros.
2. **Parâmetros de filtro** que o endpoint `GET /api/atendimentos` aceita (alguns já existem; outros são acréscimos lightweight).

---

## URL Schema (single source of truth)

A página `/operacao/atendimentos` lê filtros e estado de visualização da query string.

| Param | Valores aceitos | Default | Notas |
|-------|----------------|---------|-------|
| `view` | `dia` \| `semana` \| `mes` | `semana` | persiste a visualização |
| `date` | `YYYY-MM-DD` | hoje | data de referência (centro da view) |
| `from` | `YYYY-MM-DD` | derivado de `view`+`date` | início do período custom (quando setado, sobrepõe o derivado) |
| `to` | `YYYY-MM-DD` | derivado de `view`+`date` | fim do período custom |
| `doctor` | UUID | (todos) | filtra por profissional |
| `status` | `agendado` \| `realizado` \| `cancelado` | (todos) | filtra por status efetivo |
| `procedure` | substring (≤ 60 chars) | — | match em nome do procedimento |
| `patient` | substring (≤ 60 chars) | — | match em nome do paciente |

**Exemplos**:

- `/operacao/atendimentos` → semana atual, sem filtros.
- `/operacao/atendimentos?view=mes&date=2026-05-01` → vista Mês de maio/26.
- `/operacao/atendimentos?from=2026-05-01&to=2026-05-15&doctor=abc-123&status=cancelado` → 1ª quinzena de maio, dr. ABC, cancelados.
- `/operacao/atendimentos?view=semana&patient=Maria` → semana atual, atendimentos cuja paciente contém "Maria".

**Botão "Limpar filtros"**: navega para `/operacao/atendimentos` (sem qs).

**Filtro inválido na URL** (FR-036): cliente ignora o param inválido silenciosamente; o `useCalendarFilters` hook normaliza a URL no mount removendo qualquer param que não case com o schema.

---

## Endpoint extension: `GET /api/atendimentos`

O endpoint atual já aceita `from`, `to`, `doctor`. Esta feature acrescenta (de modo backward-compatible — todos opcionais):

| Param | Tipo | Notas |
|-------|------|-------|
| `from` | `YYYY-MM-DD` | (já existe) |
| `to` | `YYYY-MM-DD` | (já existe) |
| `doctor` | UUID | (já existe) |
| `status` | `agendado` \| `realizado` \| `cancelado` | NOVO — filtra por status efetivo |
| `procedure` | string | NOVO — `ilike '%${procedure}%'` em `procedures.name` |
| `patient` | string | NOVO — match contra nome decriptado (uses RPC existente que já decifra) |
| `limit` | number ≤ 1000 | default 200; Mês usa 1000 |

**Response shape**: inalterada (lista de `Appointment` DTO).

**Performance**: mês com até 500 atendimentos retorna em < 1 s p95 (SC-007). Filtros são aplicados em SQL; o front-end recebe o conjunto já filtrado.

**RLS**: continua autoritativa — filtros são predicados adicionais, não bypass. Recepcionista que não pode ver paciente X não verá X mesmo que digite o nome.

---

## Page contract: `/operacao/atendimentos` (renderização)

### Componentes da página (visual)

```
┌────────────────────────────────────────────────────────────┐
│ <header com data-range, navegação, view-switcher, "Limpar"> │
├────────────────────────────────────────────────────────────┤
│ <FilterBar: doctor, status, procedure (search),            │
│             patient (search), atalhos rápidos>             │
├──────┬─────────────────────────────────────────────────────┤
│ Mini │                                                     │
│ Cal  │   <DayView | WeekView | MonthView>                  │
│      │                                                     │
└──────┴─────────────────────────────────────────────────────┘
```

### Mini-calendário (R10)

Renderiza grid 7×6 do mês corrente (relativo a `date`). Indica dias com atendimento via marcador visual. Clique navega `date` para o dia clicado. Mês/ano clicáveis para navegação.

Recebe via prop:

```ts
{
  value: Date;
  hasAppointmentsByDay: Set<string>;  // 'YYYY-MM-DD'
  onSelect(date: Date): void;
  onNavigateMonth(direction: -1 | 1): void;
}
```

### View Mês

Grid 7 colunas × 5–6 linhas. Cada célula:

- Cabeçalho: número do dia (vazio para dias fora do mês).
- Até 3 chips de atendimento (cor por status: agendado=azul, realizado=verde, cancelado=cinza).
- Chip "+N mais" quando excede 3 — clicar leva para `/operacao/atendimentos?view=dia&date=YYYY-MM-DD`.

Clicar na célula vazia abre o modal de criar atendimento naquele dia (comportamento existente reusado).

### Atalhos de período

`<button>` para cada um:

- "Hoje" → `?date=hoje&view=dia`
- "Esta semana" → `?date=hoje&view=semana`
- "Este mês" → `?view=mes&date=hoje`
- "Próxima semana" → `?date=hoje+7d&view=semana`
- "Próximo mês" → `?view=mes&date=hoje+1mês`

### Seleção de período por clique no calendário

Estado client `{ pickStart: Date | null }`. Primeiro clique seta `pickStart`; segundo clique forma o intervalo (menor → maior) e atualiza `from` + `to` na URL. Terceiro clique reseta para single date.

Visual: dias dentro do range ganham `bg-primary/10`; `pickStart` e `pickEnd` ganham `bg-primary text-white`.

### Botão "Limpar filtros"

Visível quando há QUALQUER filtro além do default. Click → `router.replace('/operacao/atendimentos')` (sem qs).

---

## Hook: `useCalendarFilters()`

```ts
export function useCalendarFilters(): {
  filters: CalendarFilters;
  setFilter<K extends keyof CalendarFilters>(key: K, value: CalendarFilters[K] | null): void;
  setRange(from: Date, to: Date): void;
  clear(): void;
  asQuery(): string;          // serializa para query string (debug/testing)
  range: { from: Date; to: Date };  // sempre derivado
}
```

Internamente:

- `useSearchParams()` para ler.
- `router.replace(pathname + '?' + qs, { scroll: false })` para escrever — não navega, só atualiza URL.
- Schema Zod parser que ignora params inválidos.

Tornar testável (unit test cobre round-trip URL ↔ filters).
