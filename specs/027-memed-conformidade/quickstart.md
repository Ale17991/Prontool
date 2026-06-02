# Quickstart: Suíte de Conformidade Memed

Guia para rodar a suíte completa localmente e entender o que cada peça verifica.

## Pré-requisitos

- Node.js 20 LTS, pnpm 9 (já no repo)
- Docker Desktop rodando (para `supabase start`)
- Spec 026 implementado em algum estado mínimo (mock pode substituir o que estiver pendente)

## 1. Setup inicial

```bash
# Subir stack local Supabase (porta 54321)
pnpm supabase start

# Aplicar todas as migrations (incluindo as do spec 026 quando existirem)
pnpm supabase:reset

# Instalar Playwright se ainda não instalou (~150MB; uma vez só)
pnpm exec playwright install chromium
```

## 2. Rodar a suíte completa

```bash
# Tudo de uma vez — mesmo que o CI roda
pnpm test:memed-conformidade

# Equivale a:
#   pnpm lint                          # FR-013 (lint custom)
#   pnpm test -- memed-                # contract + integration
#   pnpm build && pnpm scan:memed-keys # FR-013 (build scan)
#   pnpm e2e:memed                     # E2E
#   pnpm verify:memed-acceptance       # documento legal versionado
```

## 3. Rodar peças individualmente

### Lint (FR-013)
```bash
pnpm lint -- src/app src/components
# Falha com "no-memed-secrets-in-frontend" se algum arquivo do front
# referenciar process.env.MEMED_* ou string literal "MEMED_API_KEY"
```

Para testar a regra propositalmente: criar arquivo temporário
```ts
// src/components/teste.tsx (apagar depois)
const k = process.env.MEMED_API_KEY  // deve quebrar lint
```

### Contract tests (FRs 001-009)
```bash
pnpm test -- tests/contract/memed-
```

Roda contra Supabase local. Cada teste é independente; reseta tabela alvo antes.

### Integration tests (FRs 004-007, 014)
```bash
# Sobe mock Memed em background
pnpm tsx tests/mocks/memed-mock-server.ts --port 4001 &
MEMED_BASE_URL=http://localhost:4001 pnpm test -- tests/integration/memed-
```

### Build scan (FR-013 parte 2)
```bash
pnpm build
pnpm scan:memed-keys
# Falha se grep encontrar chaves no .next/static/
```

### E2E (FRs 010, 015, 016)
```bash
# Sobe app + mock em terminal 1
pnpm tsx tests/mocks/memed-mock-server.ts --port 4001 &
MEMED_BASE_URL=http://localhost:4001 pnpm dev &

# Em terminal 2:
pnpm e2e:memed
# Roda Playwright; gera relatório em playwright-report/
```

### Verificação do registro de aceite (FR-017)
```bash
pnpm verify:memed-acceptance
# Script simples: confirma que docs/legal/memed-acceptance-record.md
# existe, tem data, responsável e os 9 itens marcados.
```

## 4. Como interpretar falha

| Falha | Significado | O que fazer |
|---|---|---|
| Lint quebrou em `no-memed-secrets-in-frontend` | Alguém adicionou ref a chave Memed em código de front | Mover para backend; o front recebe só `token` do prescritor |
| `memed-prescriber-payload.spec.ts` falhou | Mock retornou 422 = falta campo | Verificar `register-prescriber.ts` no spec 026; algum campo está vazio no payload |
| `memed-prescription-records-append-only.spec.ts` falhou | DELETE/UPDATE forbidden trigger não está ativo | Revisar migration do spec 026 — trigger anti-DELETE no `prescription_records` |
| `scan:memed-keys` encontrou match | Bundle JS contém credencial | Ofuscado? Inline? Achar arquivo via output do scan, refatorar |
| E2E `memed-credential-leak-scan` falhou | Em runtime, alguma response HTTP carrega chave | Falha grave — investigar logs do mock/backend; provavelmente erro de proxy vazando upstream |
| E2E `memed-feature-toggle-respected` falhou | CSS externo está sobrepondo iframe ou UI não respeita toggle | Revisar wrapper React do iframe; remover CSS conflitante |
| `verify:memed-acceptance` falhou | Doc legal está faltando, desatualizado ou sem item marcado | Atualizar `docs/legal/memed-acceptance-record.md` com aceite assinado |

## 5. Promover para produção

Quando todos os 9 critérios passam no CI E o aceite institucional foi feito no portal Memed:

1. Submeter avaliação à Memed via portal deles (eles executam manualmente o fluxo).
2. Aguardar aprovação (1-2 semanas típico).
3. Após aprovação, atualizar `tenant_memed_config.environment` para `production` por tenant que receber chave de produção.
4. Banner "Modo homologação — sem validade legal" some automaticamente.

Se a Memed solicitar ajustes na avaliação: ajustar, rodar `pnpm test:memed-conformidade` localmente até passar, ressubmeter.

## 6. Manutenção pós-produção

- A suíte é **rodada a cada PR** que toca arquivos relevantes (paths filter do workflow).
- Se a Memed publicar mudança de contrato (ex.: novo campo obrigatório no prescritor), atualizar:
  1. `contracts/memed-mock.md` (regras do mock)
  2. `tests/mocks/memed-mock-server.ts` (implementação)
  3. FR correspondente no `spec.md`
  4. Testes que validam o novo campo
- Tipicamente Memed avisa por email do parceiro com 30-60 dias de antecedência.
