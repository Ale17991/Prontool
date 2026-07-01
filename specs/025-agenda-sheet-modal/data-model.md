# Data Model — Detalhe do Atendimento como Painel Lateral

**Feature**: 025-agenda-sheet-modal
**Status**: Phase 1 complete
**Date**: 2026-05-25

## Resumo

**Nenhuma mudança de schema, RLS, função SQL ou bucket.** A feature é puramente UI e consome estruturas que já existem.

## Entidades consumidas (read-only)

### `appointments_effective` (view existente)

Já materializada via migrations anteriores. Fornece os campos exibidos pelo painel:

| Campo                         | Tipo                          | Uso no painel                                                         |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `id`                          | UUID                          | Chave do painel (estado client)                                       |
| `patient_id`                  | UUID                          | Link para `/operacao/pacientes/[id]` e join com nome descriptografado |
| `doctor_id`                   | UUID                          | Para resolver `doctors.full_name` no JSON de retorno                  |
| `plan_id`                     | UUID nullable                 | Render do convênio ou badge "Particular"                              |
| `appointment_at`              | TIMESTAMPTZ                   | Data/hora de início                                                   |
| `duration_minutes`            | INT nullable                  | Derivar hora de fim                                                   |
| `observacoes`                 | TEXT nullable                 | Bloco de observações                                                  |
| `frozen_amount_cents`         | BIGINT                        | Card financeiro (colapsável)                                          |
| `frozen_commission_bps`       | INT                           | Card financeiro                                                       |
| `net_amount_cents`            | BIGINT                        | Card financeiro                                                       |
| `effective_status`            | TEXT                          | Badge de status + define quais ações aparecem                         |
| `reversal_id` / `reversed_at` | UUID/TIMESTAMPTZ              | Identificar estornado                                                 |
| `procedures` (embed)          | `{ tuss_code, display_name }` | Card "Dados clínicos"                                                 |
| `doctors` (embed)             | `{ full_name }`               | Card "Dados clínicos"                                                 |
| `health_plans` (embed)        | `{ name }`                    | Card financeiro                                                       |

### Tabelas auxiliares (read-only via API)

- `appointment_procedures` — linhas multi-procedimento (mostradas no card "Procedimentos")
- `appointment_materials` — materiais (mostrados no card "Materiais utilizados")
- `appointment_assistants` — assistentes Liberais (mostrados sob "Profissional")
- `patient_allergies` — alergias para o card de destaque
- `appointments_effective` (audit_log filtrado por entity=appointments) — **não vai aparecer no painel** (foi removido por decisão anterior; auditoria fica apenas em `/configuracoes/auditoria`)

## Transformação de dados (frontend)

O endpoint `GET /api/atendimentos/[id]` já entrega tudo necessário num único payload JSON. O painel apenas renderiza — não monta queries adicionais.

Hook `useAppointmentDetail(id)` mantém em estado:

```typescript
type AppointmentDetailState = {
  data: AppointmentDetailDTO | null
  loading: boolean
  error: { message: string } | null
}
```

`AppointmentDetailDTO` é o shape já retornado pelo endpoint existente (não criamos um novo). Se o endpoint ainda não inclui algum sub-campo necessário (ex: assistentes), a Tarefa correspondente em `tasks.md` documenta a extensão pontual sem alterar o contrato externo.

## Transições de estado (UI)

O painel não muda estado de banco — todas as ações delegam para os endpoints existentes que já têm suas próprias máquinas de estado:

| Status atual                        | Ação disponível       | Endpoint                                | Novo status             |
| ----------------------------------- | --------------------- | --------------------------------------- | ----------------------- |
| `agendado`                          | Confirmar agendamento | `POST /api/atendimentos/[id]/confirmar` | `confirmado`            |
| `confirmado`                        | Confirmar presença    | `POST /api/atendimentos/[id]/realizado` | `ativo`                 |
| `ativo`                             | Cancelar              | `POST /api/atendimentos/[id]/cancelar`  | `estornado`             |
| `agendado`/`confirmado`/`estornado` | Cancelar agenda       | `POST /api/atendimentos/[id]/cancelar`  | `cancelado`/`estornado` |
| `ativo`                             | Estornar              | `POST /api/atendimentos/[id]/reversal`  | `estornado`             |

Painel é read-side dessa máquina; refletir o novo estado após ação = `refetch()` do GET (Decisão 4 do `research.md`).

## Estado client-side adicional

```typescript
type PanelHostState = {
  selectedAppointmentId: string | null // null = painel fechado
  pendingDirtyFormRef: React.RefObject<boolean> // controla o guard de fechamento
}
```

`pendingDirtyFormRef` é manipulado pelos forms filhos via prop `onDirtyChange(dirty: boolean)`. Não é estado React (não re-renderiza); é uma ref consultada sob demanda.

## Validações

| Regra               | Onde                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sessão autenticada  | Já no endpoint `GET /api/atendimentos/[id]` via `requireRole`                                                        |
| Tenant correto      | Já no endpoint (filter explícito por tenant_id)                                                                      |
| Atendimento existe  | Endpoint retorna 404; painel mostra "Atendimento não encontrado"                                                     |
| Permissão para ação | Server-side via `requireRole` em cada endpoint de ação; client esconde botões via `can(role, action)` apenas como UX |

## Não-objetivos

- **Realtime updates**: o painel não escuta mudanças do servidor (ex: outro user cancelou). FR-005 só exige refresh após **minhas próprias ações**.
- **Cache compartilhado entre lista e painel**: cada um faz seu próprio fetch. Aceitável para a v1; otimizações com cache podem vir depois.
