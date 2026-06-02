# Contract: Matriz de Auditoria

Mapeamento explícito de cada critério Memed → User Story → Functional Requirement → Teste que prova.
Esta matriz é o **contrato da suíte**: se todas as linhas passam no CI, o produto está conforme.

## Os 9 critérios consolidados

| # | Origem | Descrição |
|---|---|---|
| C1 | Memed checklist item 1 | Integração feita por profissional qualificado (aceite institucional) |
| C2 | Memed checklist item 2 | Cadastro do Prescritor com 7 campos completos |
| C3 | Memed checklist item 3 | Comando SetPaciente com 6 campos completos |
| C4 | Memed checklist item 4 | Evento `prescricaoImpressa` capturado |
| C5 | Memed checklist item 5 | Evento `prescricaoExcluida` capturado |
| C6 | Memed revogação item 1 | Prescritor não cadastrado conforme documentação |
| C7 | Memed revogação item 2 | Credenciais API-KEY/SECRET-KEY expostas no front |
| C8 | Memed revogação item 3 | `setFeatureToggle` ignorado/sobreposto |
| C9 | Memed revogação item 4 | Fluxo de captura sem eventos implementados |

**Observação de consolidação**: C2 e C6 cobrem a mesma propriedade (prescritor completo) sob ângulos diferentes (positivo vs revogação) — verificáveis pela mesma bateria de testes. C4/C5 e C9 idem. Não há duplicação de implementação, apenas a comunicação dos critérios para a Memed.

## Matriz crítério × user story × FR × teste

| Critério | US | FR | Tipo de teste | Arquivo | Output esperado |
|---|---|---|---|---|---|
| C1 | US7 | FR-017 | Doc check | `docs/legal/memed-acceptance-record.md` existe e tem 9 itens marcados | Verificado em CI por `pnpm verify:memed-acceptance` (grep simples) |
| C2 | US1 | FR-001 | Contract | `tests/contract/memed-prescriber-payload.spec.ts` | Payload tem 7 campos populados; 422 do mock = teste falha |
| C2 | US1 | FR-002 | Contract | mesma + variantes por campo faltante | 7 sub-testes; cada um falha cedo com mensagem específica |
| C2 | US1 | FR-003 | Contract | `tests/contract/memed-prescribers-status-enum.spec.ts` | Constraint CHECK existe |
| C3 | US2 | FR-004 | Integration | `tests/integration/memed-setpaciente-payload.spec.ts` | postMessage `setPaciente` carrega 6 campos |
| C3 | US2 | FR-005 | Integration | mesma + variantes por campo faltante | 6 sub-testes; UI bloqueada com mensagem específica |
| C4 | US3 | FR-006 | Integration | `tests/integration/memed-prescricaoImpressa.spec.ts` | INSERT em `prescription_records` em ≤ 5s; idempotência |
| C4 | US3 | FR-006a | Integration | mesma | Retry backoff 3x; após 3ª falha cria `alert` `prescription_capture_failed`; UI não bloqueia |
| C5 | US4 | FR-007 | Integration | `tests/integration/memed-prescricaoExcluida.spec.ts` | Transição `issued→deleted`; idempotência |
| C4/C5 | US3, US4 | FR-008 | Contract | `tests/contract/memed-prescription-records-append-only.spec.ts` | DELETE falha; UPDATE só permite `issued→deleted` |
| C4/C5 | US3, US4 | FR-009 | Contract | `tests/contract/memed-audit-events.spec.ts` | `audit_log` contém entradas `prescription.issued` / `prescription.deleted` |
| C7 | US5 | FR-010 | E2E | `tests/e2e/memed-credential-leak-scan.spec.ts` | Scan de toda response HTTP no fluxo: 0 ocorrências de `api_key`/`secret_key` |
| C7 | US5 | FR-011 | Contract | `tests/contract/memed-credentials-encrypted-at-rest.spec.ts` | SELECT direto da coluna `api_key_enc` retorna ciphertext, não plaintext |
| C7 | US5 | FR-012 | Contract | `tests/contract/memed-pino-redact.spec.ts` | Log com payload contendo `api_key` sai com `***REDACTED***` |
| C7 | US5 | FR-013 | Lint | `tools/eslint-rules/no-memed-secrets-in-frontend.js` | Arquivo de teste com `process.env.MEMED_API_KEY` em `src/app/**` → erro de lint |
| C7 | US5 | FR-013 | Build scan | `tools/scripts/scan-bundle-for-memed-keys.ts` | Após `next build`, grep recursivo em `.next/static/`: 0 matches |
| C7 | US5 | FR-014 | Integration | `tests/integration/memed-error-messages-no-credentials.spec.ts` | Erro retornado para o navegador: mensagem genérica sem ecoar chave |
| (perf) | US5 | SC-008 | E2E | `tests/e2e/memed-prescribe-button-to-iframe-loaded.spec.ts` (T032a) | 20 iterações: p95 do "click Prescrever → iframe carregado com paciente" ≤ 3000ms |
| C8 | US6 | FR-015 | E2E | `tests/e2e/memed-feature-toggle-respected.spec.ts` | Mock injeta `setFeatureToggle(manualPrescription, false)`; DOM externo respeita |
| C8 | US6 | FR-016 | E2E | mesma | Quando UI externa tem feature equivalente, está oculta |
| Constituição III | (todas) | (transversal) | Contract | `tests/contract/memed-conformity-tenant-isolation.spec.ts` | INSERT em tenant A + SELECT como tenant B → 0 linhas em 3 tabelas |
| Constituição V | (todas) | (transversal) | Contract | `tests/contract/memed-rbac.spec.ts` | Matriz papel × endpoint para 5 endpoints da feature 026 |

## Critério de aprovação do CI

CI workflow `.github/workflows/memed-conformidade.yml` aprova merge se e somente se:

1. `pnpm lint` passa (inclui custom rule FR-013)
2. `pnpm test -- memed-` passa (todos os testes acima)
3. `pnpm build && pnpm scan:memed-keys` exit 0
4. `pnpm e2e:memed` passa
5. `pnpm verify:memed-acceptance` confirma `docs/legal/memed-acceptance-record.md` válido

Qualquer falha = bloqueio. Sem skip/sem flaky tolerance — todos os testes desta suíte são determinísticos.
