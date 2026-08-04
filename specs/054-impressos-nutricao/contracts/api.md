# API Contracts — Impressos da consulta de nutrição

Todas as rotas: `requireRole(['admin','profissional_saude'])`, gate do módulo da
funcionalidade que alimenta o documento, e filtro por `tenant_id` da sessão.
Resposta de sucesso é `application/pdf`; erros seguem `{ error: { code, message } }`.

Convenção herdada da 049/050/052: módulo desligado devolve **404 `MODULE_DISABLED`**,
para não vazar a existência da funcionalidade.

Todas usam `runtime = 'nodejs'` — o renderer de PDF não roda em edge.

---

## `GET /api/pacientes/[id]/plano-alimentar/pdf`

Plano alimentar do paciente. Módulo `dieta`.

**200**: `application/pdf`. Refeições com itens, quantidade e medida caseira;
grupos de substituição como alternativas; totais de energia e macros; meta por
refeição quando definida.

**Regra**: plano em rascunho sai com tarja visível de não definitivo (FR-010).

**404** `NO_PLAN` quando o paciente não tem plano · `MODULE_DISABLED`.

---

## `GET /api/pacientes/[id]/avaliacao-nutricional/pdf`

Antropometria e composição corporal, **até três avaliações lado a lado**.
Módulo `nutri_avaliacao`.

**Query**: `?limite=3` (padrão 3, máximo 3).

**200**: colunas em ordem cronológica, cada uma identificando **o protocolo
usado**. Peso, IMC e classificação, dobras, percentual de gordura e sua
classificação, massa magra e gorda, circunferências, TMB, GET e VET.

**Regra**: com menos de três avaliações, imprime só as existentes (FR-005).

**404** `NO_ASSESSMENT` · `MODULE_DISABLED`.

---

## `GET /api/pacientes/[id]/recordatorio/pdf`

Recordatório alimentar. Módulo `nutri_recordatorio`.

**Query**: `?data=YYYY-MM-DD` (padrão: o mais recente).

**200**: refeições com itens e quantidades, totais do dia e adequação quando
disponível.

**404** `NO_RECALL` · `MODULE_DISABLED`.

---

## `GET /api/pacientes/[id]/exames/pdf`

Quadro de exames laboratoriais. Módulo `exames_lab`.

**200**: por painel, cada exame com valor, unidade, faixa de referência e
classificação.

**Regra**: exame sem faixa cadastrada sai **sem** classificação — nunca
classificado como normal (FR-011).

**404** `MODULE_DISABLED`.

---

## `GET /api/pacientes/[id]/crescimento/pdf`

Avaliação infantil: curvas de percentil com os pontos do paciente. Módulo
`nutri_avaliacao`.

**200**: curvas de peso/idade, estatura/idade e IMC/idade desenhadas com as
primitivas SVG do renderer, mais a classificação da última aferição.

**404** `GROWTH_DISABLED` quando o acompanhamento não está ativado para o
paciente · `OUT_OF_RANGE` acima de 19 anos · `MODULE_DISABLED`.

---

## `GET /api/pacientes/[id]/orientacoes/pdf`

Orientações escritas ao paciente. Sem módulo próprio (a seção é do núcleo).

**200**: cada orientação com sua data, texto íntegro.

**404** `NO_NOTES`.

---

## `GET /api/pacientes/[id]/anamnese/[recordId]/pdf`

Anamnese preenchida. Exige a flag `anamnese`.

**200**: perguntas e respostas na ordem do modelo. Pergunta sem resposta aparece
em branco, e não some (FR-008 e cenário de aceite da US3).

**404** `NOT_FOUND` · `MODULE_DISABLED`.

---

## `GET /api/pacientes/[id]/gestacional/pdf`

Avaliação gestacional. Módulo `nutri_avaliacao`.

**200**: IMC pré-gestacional e sua classificação, ganho de peso acumulado por
semana e a faixa recomendada.

**404** `NO_PREGNANCY_DATA` · `MODULE_DISABLED`.

---

## Regras comuns a todas

- **Isolamento**: paciente de outra clínica devolve **404**, nunca 403 — 403
  confirmaria que o paciente existe.
- **Paciente anonimizado**: **409 `PATIENT_ANONYMIZED`**. Não se emite documento
  identificado de quem foi anonimizado (FR-013).
- **Auditoria**: toda emissão registra `log_audit_event` com quem, quando e qual
  documento.
- **Cabeçalho**: `content-disposition: attachment` com nome legível
  (`plano-alimentar-<paciente>-<data>.pdf`) e `cache-control: no-store`, porque
  o conteúdo tem PII.
- **Sem rota nova para solicitação de exames**: já existe em
  `/api/pacientes/[id]/solicitacoes-exame/[reqId]/pdf`.
