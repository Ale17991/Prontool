# Contract — Route Handlers internos (Faturamento TISS)

Todos: `requireRole(...)` server-side como 1ª checagem; isolamento por `tenant_id`; negações logam audit. Erros não vazam segredo/PII (mensagem genérica + `validation_errors` estruturado para campos faltantes).

## Config por operadora (admin)
- `POST /api/tiss/operadoras/[planId]` — habilita TISS no convênio. Body: `{ ans_registration, tiss_version?, contracted_code, contracted_cnpj, contracted_cnes?, procedure_table_map? }`. Valida obrigatórios → 422 com lista do que falta. → `{ id, status:'habilitado' }`.
- `PATCH /api/tiss/operadoras/[planId]` — atualiza mapeamentos/`active`.
- `DELETE /api/tiss/operadoras/[planId]` — desabilita (não apaga histórico de guias).
- Role: `admin`.

## Certificado A1 (admin)
- `POST /api/tiss/certificados` — multipart: `.pfx` + senha. Servidor valida com `node-forge` (lê CN/validade), cifra e persiste. Nunca devolve o conteúdo. → `{ id, subject_cn, not_after }`.
- `DELETE /api/tiss/certificados/[id]`.
- Role: `admin`.

## Guias (faturista)
- `POST /api/tiss/guias` — gera guia a partir de atendimento. Body: `{ appointment_id, guia_type }`. Preenche do schema existente, roda `validate-content`. → `{ id, status, validation_errors[] }` (status `rascunho` se faltar dado, `pronta` se ok).
- `GET /api/tiss/guias/[id]` — detalhe + re-validação (conteúdo + XSD da guia isolada). → guia + `validation_errors[]`.
- `PATCH /api/tiss/guias/[id]` — transição de status permitida (ex.: marcar paga/glosada manualmente fora do fluxo de lote, quando aplicável).
- Role: `admin`, `financeiro`.

## Lotes (faturista)
- `POST /api/tiss/lotes` — cria/fecha lote. Body: `{ health_plan_id, guia_ids[] }`. Regras: todas as guias `pronta`, mesma operadora, mesmo tenant; gera `lote_number`, monta XML (`render-lote`), calcula hash MD-5, **valida contra XSD**, **assina** (cert ativo). Falha se alguma guia inválida (lista) ou sem certificado ativo. → `{ id, lote_number, status:'fechado' }`.
- `GET /api/tiss/lotes/[id]/xml` — download do XML assinado (reproduz o mesmo `xml_content`/hash). `Content-Type: application/xml`, `Content-Disposition: attachment`.
- Role: `admin`, `financeiro`.

## Glosas (faturista)
- `POST /api/tiss/glosas` — registra glosa. Body: `{ guia_id, guia_procedure_id?, motivo_code, motivo_text, glosado_amount_cents }`. Marca guia `glosada`/`parcial`. → `{ id }`.
- `POST /api/tiss/glosas/reapresentar` — Body: `{ guia_id }`. Cria nova guia `rascunho` com `supersedes_guia_id`. → `{ new_guia_id }`.
- Role: `admin`, `financeiro`.

## Códigos de status
- 401 sem sessão; 403 papel não autorizado (audit deny); 422 validação de conteúdo (campos faltando, lista clara); 409 regra de lote violada (operadoras mistas / guia não-pronta); 200/201 sucesso.
