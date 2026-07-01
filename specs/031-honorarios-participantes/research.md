# Phase 0 — Research & Decisions: Honorários e participantes por procedimento

## D1 — Estender `appointment_assistants` vs. tabela nova

**Decision**: Estender a tabela existente `appointment_assistants` (feature 013, migration 0084).

**Rationale**:

- Já é append-only com soft-unlink (`removed_at`/`removed_by`), congela `frozen_amount_cents` (= honorário) e tem triggers de tenant/imutabilidade — exatamente o padrão exigido (Constitution I/II).
- **Já é somada no repasse**: `src/lib/core/monthly-payouts/index.ts` (`aggregateLiberalByDoctor`) e o RPC `close_monthly_payout` (0126) leem `appointment_assistants` por `assistant_doctor_id`. Relaxar a trava "só liberal" no INSERT faz o honorário de qualquer modalidade entrar no repasse **sem novo código de repasse** (FR-014).
- Menor superfície de mudança, sem duplicar conceito nem arriscar dupla contagem.

**Alternatives considered**:

- _Tabela nova `appointment_procedure_participants`_: mais limpa conceitualmente, mas exigiria reescrever o caminho de repasse e a deduplicação/backfill da tabela antiga, com risco de dupla contagem. Rejeitada por custo/risco maior sem ganho proporcional.

**Mudanças na tabela** (migration `0128`):

- `+ procedure_id UUID NULL REFERENCES appointment_procedures(id)` — vincula a participação à **linha de procedimento** (NULL = participação a nível de atendimento, compatível com dados legados).
- `+ participation_degree TEXT NULL` — código do grau (domínio TISS 35).
- Trigger liberal-only (trigger 3 da 0084) **relaxado**: aceita participante de qualquer `payment_mode` ativo do mesmo tenant.
- Unique parcial nova: `(appointment_id, procedure_id, assistant_doctor_id) WHERE removed_at IS NULL` (substitui a unique por `(appointment_id, assistant_doctor_id)`), permitindo o mesmo médico em procedimentos diferentes com graus diferentes.

## D2 — Catálogo de grau de participação (domínio TISS 35)

**Decision**: Usar `tiss_domain_tables` domínio `'35'` — **já semeado** por `scripts/seed-tiss-domains.ts` (mapa `dm_grauPart: '35'`, confirmado). Validar `participation_degree` por pertinência ao domínio (reusa `isValidDomainCode`/`listDomain`).

**Rationale**: Princípio IV — grau nunca é texto livre; vem do catálogo oficial. Sem novo seed.

**Alternatives**: enum fixo no código — rejeitado (duplica fonte de verdade; já há catálogo).

## D3 — Integração com o repasse mensal

**Decision**: Reaproveitar o caminho existente. (a) **Mês aberto**: `aggregateLiberalByDoctor` já soma `appointment_assistants` ativos (exceto estornados) por médico → após relaxar o liberal-only no INSERT, passa a incluir qualquer modalidade automaticamente. (b) **Mês fechado**: o RPC `close_monthly_payout` (0126) já agrega `appointment_assistants` em `liberal_agg` sem filtrar modalidade → também passa a incluir. Renomear apenas o **rótulo** na UI/TS de "liberal" para "participações/honorários" (mecanismo idêntico).

**Rationale**: FR-010/FR-014 com zero mudança de cálculo; evita risco em lógica financeira já testada. O executante principal continua fora (FR-015), sem dupla contagem.

**Nota**: o campo `liberal_payment_cents` em `monthly_payouts` continua sendo o canal; a feature 023/013 já o trata como "pagamento de participação". Avaliar na implementação se vale renomear o rótulo exibido sem alterar a coluna (preferível: só rótulo de apresentação).

## D4 — Equipe na guia TISS SP/SADT (`equipeSadt`)

**Decision**: Em `generateSpSadtGuia`, para cada linha de procedimento, carregar os participantes ativos daquela linha e montar o bloco `equipeSadt` (`ct_identEquipeSADT`); em `render-spsadt.ts`, renderizar `equipeSadt` por `procedimentoExecutado` na ordem do XSD.

**Estrutura `ct_identEquipeSADT`** (confirmada no XSD): `grauPart` (dom. 35, opcional) · `codProfissional` (choice: `codigoPrestadorNaOperadora` OU `cpfContratado`) · `nomeProf` · `conselho` (dom. 26) · `numeroConselhoProfissional` · `UF` (dom. 59) · `CBOS` (dom. 24).

**Mapeamento**: `codProfissional` = `cpfContratado` (CPF do médico participante, de `doctors.cpf`); `nomeProf/conselho/numeroConselho/UF/CBOS` de `doctors` (mesmos campos já usados no executante). `grauPart` = `participation_degree`.

**Validação de conteúdo**: participante sem CPF/conselho/UF/CBO completos → pendência (a guia não fica `pronta`), espelhando a regra do executante. Teste-âncora: render SP/SADT com `equipeSadt` valida no XSD 04.03.00.

**Rationale**: Princípio IV — a equipe faz parte do padrão; XSD é o gate.

## D5 — RBAC e congelamento do honorário

**Decision**: Adicionar/remover participação exige `admin` ou `financeiro` (valor financeiro), avaliado no servidor (`requireRole`); negações logadas. Honorário é informado manualmente e **congelado** no INSERT (sem edição in-place); correção = soft-unlink + novo registro. Ver valores na UI respeita `finance.view_values`.

**Rationale**: Princípios I e V. Mantém o padrão de assistentes.

**Alternatives**: honorário derivado de tabela por grau/percentual — **fora de escopo** (evolução futura), conforme spec.

## D6 — Numeração da migration

**Decision**: `0128_procedure_participants.sql`. As 0126 (financeiro) e 0127 (TISS) já estão em master; 0128 é o próximo número livre.
