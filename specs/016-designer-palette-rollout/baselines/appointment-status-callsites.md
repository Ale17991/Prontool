# Audit — Callsites de `effectiveStatus` (status de appointment)

**Task**: T003
**Date**: 2026-05-18
**Command**: `Grep "effectiveStatus" src/`

## Callsites a migrar para `AppointmentStatusBadge`

| File                                                                         | Linha              | Contexto                                                                     | Migrar em US2?                                   |
| ---------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-block.tsx`      | 36-40              | `statusClass` inline com `bg-rose-100`/`bg-sky-50`/`bg-blue-100` (week view) | ✅ SIM (T022)                                    |
| `src/app/(dashboard)/operacao/atendimentos/views/month-view.tsx`             | 32, 113            | Type union + `STATUS_COLOR` map (month view)                                 | ✅ SIM (descoberto após T003 — adicionar à US2)  |
| `src/app/(dashboard)/operacao/pacientes/[id]/appointments-history-table.tsx` | 16, 76             | Tabela histórica do paciente; usa `isReversed` para destacar estornado       | ✅ SIM (T023)                                    |
| `src/app/(dashboard)/operacao/atendimentos/calendar-shell.tsx`               | 23, 34, 36, 54, 86 | Mapeamento UI ↔ effectiveStatus + filtro; **não renderiza badge**            | ❌ NÃO (apenas filtro/lógica, sem render visual) |
| `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`                       | 262                | Cria objeto AppointmentWeekRow; sem render                                   | ❌ NÃO                                           |
| `src/lib/core/appointments/list-week.ts`                                     | 31, 163            | Type domain + atribuição; sem render                                         | ❌ NÃO                                           |
| `src/lib/core/patient-medical/assemble-prontuario.ts`                        | 22, 229            | Domain assemble; sem render                                                  | ❌ NÃO                                           |
| `src/lib/core/patient-medical/prontuario-pdf.tsx`                            | 604                | Renderiza `effectiveStatus` como texto puro no PDF (`@react-pdf/renderer`)   | ❌ NÃO — PDF não consome React DOM/Tailwind      |
| `src/app/api/alertas/route.ts`                                               | 48-49              | Variável local `effectiveStatus` em endpoint de alertas; **outro domínio**   | ❌ NÃO                                           |

## Conclusão

**3 callsites visuais** a migrar em US2:

1. `calendar-block.tsx` (semana — célula de horário)
2. `month-view.tsx` (mês — célula compacta)
3. `appointments-history-table.tsx` (tabela histórica)

`filter-bar.tsx` mencionado em T024 do tasks.md **não existe** — a filtragem fica em `calendar-shell.tsx` e não renderiza badge.

## Domínio observado

| `effectiveStatus` | Origem                            | Tratamento atual                                     |
| ----------------- | --------------------------------- | ---------------------------------------------------- |
| `'agendado'`      | DB (migration 0054)               | Reconhecido em todos os call-sites                   |
| `'ativo'`         | DB (migration 0054)               | Reconhecido; aproximação visual de "concluído"       |
| `'estornado'`     | DB (migration 0054)               | Reconhecido; destaque visual em todos os locais      |
| `'realizado'`     | Type union em `month-view.tsx:32` | Reconhecido pelo type system, sem persistência no DB |
| `'cancelado'`     | Type union em `month-view.tsx:32` | Reconhecido pelo type system, sem persistência no DB |

Decisão pragmática (research.md §3): o **AppointmentStatusBadge** cobre 7 variantes; o mapper de domínio em cada callsite traduz `effectiveStatus` → variant. Estados extras (confirmado, em_atendimento, no_show) ficam disponíveis para evolução futura.
