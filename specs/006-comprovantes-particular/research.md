# Phase 0 — Research: Múltiplos comprovantes + atendimento particular

**Feature**: 006-comprovantes-particular
**Date**: 2026-04-28

Decisões fechadas pelo user input do `/speckit.plan`. Esta seção documenta o porquê para que o `/speckit.tasks` e o `/speckit.implement` partam da mesma base.

---

## R-001: Tabela `expense_receipts` separada vs. JSONB array em `expenses`

**Decisão (user input)**: Tabela separada.

**Rationale**:

- RLS por linha permite políticas distintas (read aberto a 4 papéis, INSERT a 2, UPDATE a admin para soft-delete). Em JSONB cada elemento herdaria a policy do row pai — sem granularidade.
- Audit log indexa por `entity_id` (UUID); receipts em JSONB não têm id próprio para referenciar — perderíamos rastreabilidade individual.
- Soft-delete por elemento exige UPDATE parcial em JSONB (`jsonb_set` + array filter) — caro e propenso a corrida.
- JOIN agregado para count na lista (`COUNT(*) FILTER (WHERE deleted_at IS NULL) GROUP BY expense_id`) é O(log N) com índice — JSONB exige `jsonb_array_length` em cada row.
- GIN index em `(expense_id, deleted_at)` é simples e direto.

**Alternativas consideradas**:

- JSONB array em `expenses.receipts` — rejeitada acima.
- Tabela `attachments` genérica (polimórfica) — overengineering; só uma feature precisa hoje.

---

## R-002: `appointments.plan_id` nullable + trigger 0015 atualizado

**Decisão (user input)**: `ALTER TABLE appointments ALTER COLUMN plan_id DROP NOT NULL`. Trigger `enforce_appointment_preconditions` recria-se com lógica condicional.

**Rationale**:

- `DROP NOT NULL` é idempotente — re-rodar a migration não quebra.
- Trigger condicional preserva o caminho de validação existente para convenios (busca em `price_versions`) e adiciona caminho particular sem regression.
- Backend confia no `frozen_amount_cents` enviado pelo cliente quando `plan_id IS NULL` — a UI já calcula via `default_amount_cents` ou override do usuário. CHECK existente `frozen_amount_cents > 0` previne zero-value.

**Pseudo-código do trigger atualizado**:

```sql
IF NEW.plan_id IS NOT NULL THEN
  -- comportamento atual: busca price_versions ativa
  SELECT id INTO active_price FROM price_versions WHERE tenant_id=NEW.tenant_id ...
  IF active_price IS NULL THEN RAISE 'APPOINTMENT_PRICE_MISSING'; END IF;
  IF NEW.source_price_version_id IS NULL THEN
    NEW.source_price_version_id := active_price;
  END IF;
ELSE
  -- caminho particular: skip price_versions; exige source_price_version_id NULL
  IF NEW.source_price_version_id IS NOT NULL THEN
    RAISE 'APPOINTMENT_PARTICULAR_NO_PRICE_VERSION';
  END IF;
END IF;
-- TUSS check: mantido nos dois caminhos.
```

**Alternativas consideradas**:

- Plano sentinela "Particular" por tenant — força registro sintético, complica relatórios (filter out o sentinela em todo SELECT).
- Coluna `is_particular boolean` separada — duplica intent (`plan_id IS NULL` já é semântico); inconsistência possível.

---

## R-003: Backfill 1:1 → 1:N

**Decisão (user input)**: `INSERT INTO expense_receipts SELECT ... FROM expenses WHERE receipt_file_url IS NOT NULL`. Drop das colunas legadas em 0060 num PR posterior.

**Rationale**:

- Single-receipt acabou de subir — esperamos 0–10 receipts em prod. Backfill é trivial.
- Drop **não** na mesma migration — preserva caminho de rollback se algum cliente legado ainda escrever (improvável; código novo substitui).
- Column-guard em `expenses` atualizado para REJEITAR UPDATE em `receipt_file_*` (write-only zerado a partir de 0059).
- 0060 será criada quando confirmarmos: (a) prod migrada, (b) código deployado, (c) sem alertas de write nas colunas legadas por uma semana.

**Alternativas consideradas**:

- Drop na mesma 0059 — riscoso em ambiente onde o deploy do app pode falhar e o rollback perde dados.
- Manter dual-write (escrever em ambos) — overhead sem ganho; a nova tabela é canônica.

---

## R-004: Soft-delete preserva binário no storage

**Decisão**: `expense_receipts.deleted_at TIMESTAMPTZ` marca remoção lógica. Bucket nunca tem `remove()` chamado no fluxo normal.

**Rationale**:

- Princípio II — auditoria forense exige preservação. Se um arquivo subiu por engano com PII, soft-delete tira da listagem mas mantém para investigação compliance.
- Limpeza física é responsabilidade de job futuro com retenção legal definida (ex.: 5 anos para fiscal). Fora deste escopo.
- Storage espacial é barato — 200 clínicas × 50 receipts/mês × 5 MB médio × 60 meses = 30 GB/clínica. Aceitável.

**Alternativas consideradas**:

- Hard-delete com cópia para arquivo morto — complica fluxo, custo similar.

---

## R-005: Múltiplos arquivos com mesmo nome em uma despesa

**Decisão**: Sufixo numérico no path quando há colisão. Path interno: `{tenant_id}/{expense_id}/{filename}` ou `{tenant_id}/{expense_id}/{base}-{n}.{ext}`.

**Rationale**:

- UX: usuário pode subir "comprovante.pdf" duas vezes (versões diferentes); rejeitar gera fricção.
- Verificação via `head` no storage antes do upload OU SELECT na tabela `expense_receipts` por `(expense_id, file_name)` — a segunda é mais rápida e não precisa hit no Storage.

**Algoritmo**:

```ts
const baseName = removeExt(safeFileName)
const ext = getExt(safeFileName)
let candidate = safeFileName
let n = 1
while (await receiptExistsForExpense(expenseId, candidate)) {
  candidate = `${baseName}-${n}.${ext}`
  n++
}
const path = `${tenantId}/${expenseId}/${candidate}`
```

---

## R-006: URL assinada — 60 segundos

**Decisão**: 60s, alinhado com a feature anterior (0058).

**Rationale**:

- Curto o suficiente para não vazar via link compartilhado.
- Longo o suficiente para o browser baixar até em rede ruim (10 MB cabem em 60s a 200 KB/s).

**Alternativas**:

- 5 min — mais flexibilidade, mais risco se o usuário copia URL.
- 10s — frequência de requisição alta para downloads grandes.

---

## R-007: Visualizar vs. Baixar (UX duplo)

**Decisão**: Dois botões. Visualizar abre em nova aba; Baixar força download.

```ts
// Visualizar
window.open(signedUrl, '_blank', 'noopener,noreferrer')

// Baixar
const a = document.createElement('a')
a.href = signedUrl
a.download = fileName
a.rel = 'noopener'
document.body.appendChild(a)
a.click()
a.remove()
```

**Rationale**:

- Browsers tratam content-disposition de forma diferente; o atributo `download` força salvar.
- Visualizar é o caso comum (auditoria rápida); baixar é o caso explícito (anexar em e-mail externo).

---

## R-008: Thumbnail de imagens

**Decisão**: Preview client-side via `URL.createObjectURL` (no momento do upload, antes do POST) + tag `<img src={signedUrl}>` na lista quando `content_type` começa com `image/`. Sem pipeline server-side.

**Rationale**:

- Imagens raras passam de 5 MB; browser carrega o original como preview sem custo extra.
- Pipeline server-side (sharp + queue) é complexidade desnecessária para volume baixo.

---

## R-009: Auto-detect particular na UI

**Decisão**: Lógica no client component (`<NewAppointmentForm>` e `<NewStepForm>`):

```ts
const [particular, setParticular] = useState(initialParticular)

useEffect(() => {
  // Auto-detect: paciente sem plano OR procedimento nao coberto
  if (
    selectedPatient &&
    (!selectedPatient.planId || (selectedProcedure && !selectedProcedure.coveredByPlan))
  ) {
    setParticular(true)
    return
  }
  // Caso oposto: paciente tem plano e procedimento coberto → desmarca
  if (selectedPatient?.planId && selectedProcedure?.coveredByPlan) {
    setParticular(false)
  }
}, [selectedPatient, selectedProcedure])

// Override manual: usuario clica e fica fixo (override de auto-detect)
const [userOverrode, setUserOverrode] = useState(false)
function onCheckboxChange(checked: boolean) {
  setParticular(checked)
  setUserOverrode(true)
}
```

**Rationale**:

- Auto-detect roda só quando user **não** marcou manualmente. Caso contrário a edição reverteria sem feedback.
- Server permite ambas combinações; gate é só no front e no trigger 0015.

**Alternativas**:

- Server pré-calcula e envia como prop — quebra quando paciente/procedimento mudam no client.

---

## R-010: Badge "Particular" propagado

**Decisão**: Renderização condicional baseada em `plan_id === null` em todas as áreas:

- Detalhe atendimento `/operacao/atendimentos/[id]`
- Lista atendimentos
- Calendar block (junto com o status badge)
- Step row do plano de tratamento (`treatment-steps-section.tsx`)

Badge usa Tailwind `bg-amber-50 border-amber-200 text-amber-800` — neutralidade visual sem alarme.

---

## Resumo das deps adicionadas

**Nenhuma** dep npm. Schema: 1 tabela nova + 1 ALTER COLUMN + 1 trigger recriado + RLS + audit triggers.

## Open questions remanescentes

Nenhuma. Os 3 itens de risco foram fechados pelo user input.
