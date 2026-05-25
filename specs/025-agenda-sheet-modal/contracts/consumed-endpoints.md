# Consumed Endpoints — Detalhe do Atendimento como Painel Lateral

**Feature**: 025-agenda-sheet-modal
**Status**: Phase 1 complete
**Date**: 2026-05-25

A feature **não cria endpoints novos**. Esta página enumera os endpoints existentes que o painel consome — serve de checklist de regressão (qualquer mudança contratual nesses endpoints quebra o painel).

## GET `/api/atendimentos/[id]`

**Existe**: ✅ (arquivo `src/app/api/atendimentos/[id]/route.ts`).
**Auth**: `requireRole(['admin', 'financeiro', 'recepcionista', 'profissional_saude'])`.
**Tenant**: filtrado por `tenant_id` derivado da sessão.

**Consumo do painel**:
- Chamado client-side via `fetch` quando `selectedAppointmentId` muda.
- `AbortController` cancela o request anterior se o ID mudar antes da resposta.
- Resposta usada para popular o conteúdo do Sheet.

**Contrato esperado** (já entregue hoje):
```jsonc
{
  // Campos da view appointments_effective + embeds existentes.
  // O painel não exige novos campos. Se o conteúdo for re-fetch após
  // ação, este endpoint é a única fonte de verdade.
}
```

**Códigos de retorno esperados**:
- `200 OK` → painel renderiza
- `401 Unauthorized` → painel mostra "Sessão expirada, recarregue a página"
- `403 Forbidden` → painel mostra mensagem de permissão
- `404 Not Found` → painel mostra "Atendimento não encontrado"
- `5xx` → painel mostra erro com botão "Tentar novamente"

## POST `/api/atendimentos/[id]/confirmar`

**Existe**: ✅
**Consumo do painel**: via `ConfirmAppointmentButton` (componente existente, já faz `fetch`).
**Mudança nesta feature**: aceita prop opcional `onSuccess?: () => void`. Quando definido, dispara após `router.refresh()`.

## POST `/api/atendimentos/[id]/realizado`

**Existe**: ✅
**Consumo do painel**: via `MarkRealizedForm` (componente existente).
**Mudança nesta feature**: prop opcional `onSuccess?: () => void`.

## POST `/api/atendimentos/[id]/cancelar`

**Existe**: ✅
**Consumo do painel**: via `CancelAppointmentForm` (componente existente, tem textarea de motivo).
**Mudança nesta feature**: props opcionais `onSuccess?: () => void` e `onDirtyChange?: (dirty: boolean) => void`.

## POST `/api/atendimentos/[id]/reversal`

**Existe**: ✅
**Consumo do painel**: via `ReversalForm` (componente existente).
**Mudança nesta feature**: props opcionais `onSuccess?: () => void` e `onDirtyChange?: (dirty: boolean) → void`.

## Endpoints NÃO consumidos

- `/api/atendimentos/manual` (POST de criação) — fora do escopo do painel (página `/novo` continua independente).
- `/api/atendimentos/[id]/materiais` (POST/DELETE) — leitura sim (via GET principal); manipulação fica fora do painel.
- `/api/atendimentos/[id]/assistants` — mesma regra.

## Regressão a verificar

Se qualquer um dos endpoints acima mudar shape de resposta ou adicionar header obrigatório, **rodar `quickstart.md` antes do merge**. O painel não tem testes de contrato automatizados por enquanto.
