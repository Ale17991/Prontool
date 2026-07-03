# Contrato — API de participantes por procedimento

Rotas novas sob o atendimento. Todas: `requireRole(['admin','financeiro'])`, isolamento por tenant, auditoria via `log_audit_event`. Valores em centavos.

## POST `/api/atendimentos/[id]/participantes`

Adiciona uma participação a uma linha de procedimento do atendimento `[id]`.

**Request body** (Zod):

```json
{
  "procedureId": "uuid", // linha de appointment_procedures (obrigatório)
  "doctorId": "uuid", // participante (qualquer modalidade ativa)
  "participationDegree": "string", // código do domínio TISS 35
  "amountCents": 12345 // honorário, inteiro > 0
}
```

**Resposta 201**:

```json
{ "participantId": "uuid" }
```

**Erros**:

- `422 INVALID_BODY` — payload inválido (campos listados).
- `409 PARTICIPANT_DUPLICATE` — mesmo médico já ativo nessa (atendimento, procedimento).
- `422 INVALID_DEGREE` — grau fora do domínio 35.
- `404` — atendimento/procedimento/médico não encontrado no tenant.
- `403` — papel sem permissão (negação logada).

## DELETE `/api/atendimentos/[id]/participantes/[participantId]`

Remove (soft-unlink) uma participação ativa.

**Resposta 200**: `{ "ok": true }`
**Erros**: `404` (não encontrada/já removida), `403`.

## GET (leitura) — via detalhe do atendimento

A listagem de participantes por procedimento é entregue no payload de detalhe do atendimento (RSC/route existente), agrupada por `procedureId`, cada item com `{ participantId, doctorId, doctorName, participationDegree, degreeLabel, amountCents }`. Valores só aparecem com `finance.view_values`.

## Observações de implementação

- INSERT/soft-unlink via RPC SECURITY DEFINER (padrão 0084/0085 `attach_assistant_to_appointment` / `remove_appointment_assistant`) estendido com `procedure_id` + `participation_degree`, ou nova RPC equivalente.
- O `degreeLabel` vem de `tiss_domain_tables(35)`.
