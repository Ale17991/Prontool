# Contrato — Migration 0128 e bloco `equipeSadt`

## Migration `0128_procedure_participants.sql` (esboço)

Aditiva e idempotente. Estende `appointment_assistants`.

```sql
-- Colunas novas
ALTER TABLE public.appointment_assistants
  ADD COLUMN IF NOT EXISTS procedure_id UUID NULL REFERENCES public.appointment_procedures(id),
  ADD COLUMN IF NOT EXISTS participation_degree TEXT NULL;

CREATE INDEX IF NOT EXISTS appointment_assistants_procedure_idx
  ON public.appointment_assistants (procedure_id) WHERE removed_at IS NULL;

-- Unicidade por (atendimento, procedimento, médico) ativo
DROP INDEX IF EXISTS appointment_assistants_no_duplicate_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS appointment_assistants_no_dup_proc_active_idx
  ON public.appointment_assistants (appointment_id, procedure_id, assistant_doctor_id)
  WHERE removed_at IS NULL;

-- Trigger liberal-only (trigger 3 da 0084) SUBSTITUÍDO: aceita qualquer
-- payment_mode de médico ATIVO do mesmo tenant. (CREATE OR REPLACE da função)

-- Trigger de imutabilidade (enforce_appointment_assistants_mutation):
-- acrescentar procedure_id e participation_degree à lista de colunas imutáveis
-- no UPDATE (só removed_at/removed_by podem mudar).

-- Trigger de tenant consistency: validar que procedure_id (quando não nulo)
-- pertence ao mesmo appointment_id/tenant_id.

NOTIFY pgrst, 'reload schema';
```

**Notas de conformidade**:

- Nenhum DROP de coluna/tabela financeira (Constitution I/migrações).
- Append-only preservado; novas colunas imutáveis após INSERT.
- RLS inalterada (SELECT por tenant; mutação por RPC/service).

## Bloco `equipeSadt` no XML SP/SADT

Por `procedimentoExecutado`, 0..N elementos `equipeSadt` (`ct_identEquipeSADT`), na ordem do XSD:

```
procedimentoExecutado
  ... (campos já existentes da linha)
  equipeSadt            (repetível, opcional)
    grauPart            (dom. 35 — participation_degree)   [opcional]
    codProfissional
      cpfContratado     (doctors.cpf do participante)       [choice]
    nomeProf            (doctors.full_name)
    conselho            (dom. 26 — mapeado)
    numeroConselhoProfissional
    UF                  (dom. 59 — IBGE)
    CBOS                (dom. 24)
```

**Regras**:

- `equipeSadt` entra **depois** dos campos de valor da linha, conforme `ct_procedimentoExecutadoSadt` (ordem exata do XSD — `equipeSadt` é o último elemento da sequência).
- Participante sem CPF/conselho/UF/CBO completos → guia fica `rascunho` com `validation_errors` apontando o campo.
- Teste-âncora: `render-spsadt` com `equipeSadt` valida contra `tissGuiasV4_03_00.xsd` (xmllint-wasm).
