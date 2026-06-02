# Registro de Aceite — Conformidade Memed (Prescrição Digital)

> Documento versionado e auditável (Feature 027, US7 / Critério C1). É o registro
> formal de que a operação do Clinni revisou e aceitou os 9 itens de conformidade
> exigidos pela Memed antes de solicitar a chave de **produção**.
>
> Enquanto os 9 itens não estiverem marcados `[x]` com `data` e `responsável`
> preenchidos, `pnpm verify:memed-acceptance` falha (gate pré-produção).

## Identificação

- **responsável:** <!-- nome completo -->
- **cargo:**
- **e-mail:**
- **data:** <!-- ISO 8601, ex.: 2026-06-15 -->
- **versão do produto:** <!-- ex.: commit/tag na data do aceite -->

## Itens de conformidade (marcar `[x]` no aceite real)

1. [ ] Cadastro do prescritor completo (CPF, conselho + UF, data de nascimento) — *evidência:* `tests/contract/memed-prescriber-payload.spec.ts` / FR-001..FR-005
2. [ ] Paciente carregado completo no `setPaciente` (nome, CPF, e-mail, celular, nascimento) — *evidência:* `tests/integration/memed-setpaciente-payload.spec.ts` / FR-007
3. [ ] Evento `prescricaoImpressa` capturado e registrado (idempotente + auditado) — *evidência:* `tests/integration/memed-record-issued-and-deleted.spec.ts` / FR-006
4. [ ] Evento `prescricaoExcluida` capturado; `prescription_records` append-only — *evidência:* `tests/contract/prescription-records-append-only.spec.ts` / FR-008
5. [ ] `api_key`/`secret_key` nunca no front (lint + scan de bundle + E2E) — *evidência:* `pnpm lint:memed && pnpm scan:memed-keys` / FR-013
6. [ ] Credenciais cifradas em repouso; logs mascaram segredos — *evidência:* `tests/contract/memed-credentials-encrypted-at-rest.spec.ts`, `tests/contract/memed-pino-redact.spec.ts` / FR-011, FR-012
7. [ ] Isolamento multi-tenant das tabelas Memed — *evidência:* `tests/contract/memed-tenant-isolation.spec.ts`
8. [ ] RBAC por endpoint conforme spec 026 — *evidência:* `tests/contract/memed-rbac.spec.ts`
9. [ ] Integração feita por profissional qualificado, ciente da responsabilidade legal — *evidência:* aceite institucional no portal Memed (este documento)

## Observações

<!-- Registrar aqui o número do protocolo/avaliação da Memed, data de aprovação,
     e qualquer ajuste solicitado pela Memed na avaliação. -->
