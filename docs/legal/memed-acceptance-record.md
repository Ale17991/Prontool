# Registro de Aceite — Conformidade Memed (Prescrição Digital)

> Documento versionado e auditável (Feature 027, US7 / Critério C1). É o registro
> formal de que a operação do Clinni revisou e aceitou os 9 itens de conformidade
> exigidos pela Memed antes de solicitar a chave de **produção**.
>
> Enquanto os 9 itens não estiverem marcados `[x]` com `data` e `responsável`
> preenchidos, `pnpm verify:memed-acceptance` falha (gate pré-produção).

## Identificação

- **responsável:** Álefe Lima Martins
- **cargo:** Desenvolvedor full stack
- **e-mail:** Alefelimamartins7@gmail.com
- **data:** 2026-06-06
- **versão do produto:** master @ 2026-06-06 (base e29054f + suíte E2E da spec 027 entregue neste commit)

## Itens de conformidade (marcar `[x]` no aceite real)

1. [x] Cadastro do prescritor completo (CPF, conselho + UF, data de nascimento) — *evidência:* `tests/contract/memed-prescriber-payload.spec.ts` / FR-001..FR-005
2. [x] Paciente carregado completo no `setPaciente` (nome, CPF, e-mail, celular, nascimento) — *evidência:* `tests/integration/memed-setpaciente-payload.spec.ts` / FR-007
3. [x] Evento `prescricaoImpressa` capturado e registrado (idempotente + auditado) — *evidência:* `tests/integration/memed-record-issued-and-deleted.spec.ts` / FR-006
4. [x] Evento `prescricaoExcluida` capturado; `prescription_records` append-only — *evidência:* `tests/contract/prescription-records-append-only.spec.ts` / FR-008
5. [x] `api_key`/`secret_key` nunca no front (lint + scan de bundle + E2E) — *evidência:* `pnpm lint:memed && pnpm scan:memed-keys` + `tests/e2e/memed-credential-leak-scan.spec.ts` (`pnpm test:e2e:memed`) / FR-013
6. [x] Credenciais cifradas em repouso; logs mascaram segredos — *evidência:* `tests/contract/memed-credentials-encrypted-at-rest.spec.ts`, `tests/contract/memed-pino-redact.spec.ts` / FR-011, FR-012
7. [x] Isolamento multi-tenant das tabelas Memed — *evidência:* `tests/contract/memed-tenant-isolation.spec.ts`
8. [x] RBAC por endpoint conforme spec 026 — *evidência:* `tests/contract/memed-rbac.spec.ts`
9. [x] Integração feita por profissional qualificado, ciente da responsabilidade legal — *evidência:* aceite institucional no portal Memed (este documento)

## Observações

- Aceite registrado em 2026-06-06 por Álefe Lima Martins (desenvolvedor responsável
  pela integração), que confirmou os 9 itens após a suíte completa ficar verde:
  54 testes vitest (contract + integration) + 4 specs E2E Playwright
  (`memed-credential-leak-scan`, `memed-feature-toggle-respected`,
  `memed-full-flow`, `memed-prescribe-button-to-iframe-loaded`).
- Modelo de credenciais: **chave única de plataforma** (env `MEMED_API_KEY`/
  `MEMED_SECRET_KEY` no servidor — feature 028). Nenhuma chave por clínica,
  nenhuma chave em banco ou front. Clínica apenas ativa + aceita o termo
  (constraint `memed_production_requires_terms`).
- Fluxo validado manualmente em homologação Memed em 2026-06-01 (iframe com
  paciente carregado; emissão registrada em `prescription_records` + `audit_log`).

<!-- Registrar aqui o número do protocolo/avaliação da Memed, data de aprovação,
     e qualquer ajuste solicitado pela Memed na avaliação. -->
