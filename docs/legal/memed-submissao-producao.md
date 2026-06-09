# Dossiê de Submissão — Avaliação de Produção Memed (Clinni)

> Documento para enviar à equipe de integração da Memed ao solicitar a
> validação técnica / autorização de uso em **produção** da prescrição digital.
> Complementa o registro de aceite formal em `memed-acceptance-record.md`.
>
> **Responsável pela integração:** Álefe Lima Martins (Desenvolvedor full stack)
> — Alefelimamartins7@gmail.com
> **Produto:** Clinni (sistema de gestão para clínicas) — domínio clinnipro
> **Data:** 2026-06-06

---

## Resumo

A integração com a prescrição digital Memed está concluída e validada. O fluxo
completo (registrar prescritor → carregar paciente → abrir prescrição → emitir →
capturar eventos) foi validado em **homologação** em 2026-06-01 e está coberto
por suíte automatizada: **54 testes de contrato/integração + 4 testes E2E**, todos
verdes.

Modelo de credenciais: **chave única de plataforma** — as chaves de produção
ficam apenas em variável de ambiente no servidor (nunca por clínica, nunca em
banco, nunca no front). Cada clínica apenas ativa a funcionalidade e aceita o
termo de responsabilidade.

---

## Conformidade — os 9 itens verificados pela Memed

| # | Item | Como o Clinni atende | Evidência |
|---|------|----------------------|-----------|
| 1 | Cadastro do prescritor completo (CPF, conselho + UF, nascimento, especialidade) | Campos exigidos e validados antes do `POST /usuarios`; cadastro incompleto bloqueia a habilitação listando o que falta | `tests/contract/memed-prescriber-payload.spec.ts` |
| 2 | `setPaciente` completo (nome, CPF, e-mail, celular, nascimento) | Payload montado no servidor a partir do cadastro decifrado; faltando campo, a prescrição não abre (HTTP 422 orientando) | `tests/integration/memed-setpaciente-payload.spec.ts` |
| 3 | Evento `prescricaoImpressa` capturado e registrado | Registro idempotente em `prescription_records` + trilha de auditoria | `tests/integration/memed-record-issued-and-deleted.spec.ts` |
| 4 | Evento `prescricaoExcluida` capturado; registro imutável | Marca `issued→deleted`; tabela append-only (nunca apaga) | `tests/contract/prescription-records-append-only.spec.ts` |
| 5 | `api_key`/`secret_key` nunca no front | 3 camadas: lint estático, scan do bundle compilado e E2E com scan de TODO o tráfego do navegador | `pnpm lint:memed` + `pnpm scan:memed-keys` + `tests/e2e/memed-credential-leak-scan.spec.ts` |
| 6 | Credenciais cifradas em repouso; logs mascaram segredos | Chaves só em env do servidor; logger com redação testada | `tests/contract/memed-credentials-encrypted-at-rest.spec.ts`, `memed-pino-redact.spec.ts` |
| 7 | Isolamento multi-tenant | Tabelas Memed isoladas por `tenant_id` (RLS) | `tests/contract/memed-tenant-isolation.spec.ts` |
| 8 | Controle de acesso por papel (RBAC) por endpoint | Cada rota exige papel autorizado | `tests/contract/memed-rbac.spec.ts` |
| 9 | Integração por profissional qualificado, ciente da responsabilidade legal | Registro institucional versionado | `docs/legal/memed-acceptance-record.md` |

## Pontos adicionais (motivos de revogação que a Memed monitora)

- **Feature toggles do iframe respeitados** — o wrapper do Clinni nunca reativa
  uma feature que a Memed desativou (sem CSS sobrepondo o iframe). Evidência:
  `tests/e2e/memed-feature-toggle-respected.spec.ts`.
- **Performance de abertura** — p95 do "clique em Prescrever → iframe pronto com
  o paciente" dentro do orçamento (≤ 3s no build de produção). Evidência:
  `tests/e2e/memed-prescribe-button-to-iframe-loaded.spec.ts`.
- **Logout do prescritor** ao trocar de atendimento (recepção compartilhada).

---

## Como reproduzir a validação (se a Memed quiser inspecionar)

```bash
pnpm test:contract && pnpm test:integration   # 54 testes (contrato + integração)
pnpm test:e2e:memed                            # 4 testes E2E (Playwright)
pnpm lint:memed && pnpm scan:memed-keys        # zero segredos no front/bundle
pnpm verify:memed-acceptance                   # gate do registro de aceite
```

## Status técnico

- Ambiente de produção configurado (chaves em env no servidor; já provisionadas).
- Banco de produção com as migrations da Memed aplicadas (0110 + 0111).
- Aguardando: **validação técnica da Memed** para autorizar o uso em produção.
