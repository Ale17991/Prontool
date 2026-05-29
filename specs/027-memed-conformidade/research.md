# Research: Conformidade Memed

Resolução de NEEDS CLARIFICATION e decisões de stack para a suíte de verificação.

## R1. Shape exato dos eventos `prescricaoImpressa` e `prescricaoExcluida`

**Decision**: tratar os eventos como `MessageEvent` recebidos via `window.addEventListener('message', ...)` postados pelo iframe da Memed, com payload `{ event: 'prescricaoImpressa'|'prescricaoExcluida', data: { prescriptionId, pdfUrl?, deletedAt? } }`.

**Rationale**: documentação pública da Memed e exemplos de integradores (iClinic, Doctoralia, Conexa) usam `postMessage` para eventos do iframe. Não há SDK oficial — a integração é via script + `window.MdHub`. Os eventos `prescricaoImpressa` e `prescricaoExcluida` aparecem na documentação de eventos do iframe; campo `prescriptionId` (ou `id`) é o identificador estável para idempotência.

**Alternatives considered**:
- Polling `GET /prescricoes` — descartado: gera latência e custo. Memed exige captura via eventos JS.
- WebSocket dedicado — não documentado pela Memed para integradores comuns.

**Confirmação pendente**: shape exato do payload (campo `prescriptionId` vs `id` vs `documento_id`) será confirmado ao receber credenciais de homologação e abrir um caso de teste real. A suíte de testes será escrita contra um adaptador (`memed-event-adapter.ts`) que normaliza o payload, isolando essa incerteza.

---

## R2. Como inspecionar tráfego para garantir `api_key`/`secret_key` não vazam

**Decision**: três camadas de defesa, com testes que verificam cada uma independentemente:

1. **Lint custom** (`tools/eslint-rules/no-memed-secrets-in-frontend.js`) — falha o build se algum arquivo sob `src/app/**` ou `src/components/**` referenciar `process.env.MEMED_*`, `MEMED_API_KEY`, `MEMED_SECRET_KEY`, `memed_api_key`, `memed_secret_key` (case-insensitive em strings literais).
2. **Post-build scan** (`tools/scripts/scan-bundle-for-memed-keys.ts`) — executado após `next build`; faz grep recursivo nos arquivos sob `.next/static/` procurando padrões `mk_[A-Za-z0-9]{20,}` (formato típico de chave) e strings literais "MEMED_". Falha CI se encontrar.
3. **E2E Playwright** (`tests/e2e/memed-credential-leak-scan.spec.ts`) — abre o fluxo de prescrição em ambiente de homologação, intercepta todas as responses via `page.on('response', ...)`, soma os bodies e busca por padrões de chave. Failure = fail teste com print do payload ofensor mascarado.

**Rationale**: A Memed inspeciona manualmente. Replicar a inspeção de forma automatizada cobre os 3 vetores reais: código-fonte (lint), bundle JS distribuído (scan), tráfego de runtime (E2E). Falhar qualquer uma das 3 falha o build → impossível regredir sem alguém perceber.

**Alternatives considered**:
- Apenas E2E — descartado: falha em runtime é tarde demais, e cobre só o fluxo testado. Lint + scan cobrem código que nem está sendo exercitado.
- Apenas lint — descartado: alguém pode codar a chave por outro caminho (inline em JSX, ofuscado).

---

## R3. Mascarar credenciais nos logs do Pino

**Decision**: usar a opção `redact` do Pino já configurada no projeto, estendendo com paths Memed:

```ts
// src/lib/observability/logger.ts (estender — não criar)
const logger = pino({
  redact: {
    paths: [
      // ... paths existentes
      '*.api_key',
      '*.secret_key',
      '*.apiKey',
      '*.secretKey',
      'config.credentials_enc',
      'request.headers.authorization',
    ],
    censor: '***REDACTED***',
  },
})
```

**Rationale**: o projeto já usa pino e já tem padrão de `redact` (verificado em `src/lib/observability/logger.ts`). Adicionar paths é low-risk e cobre todas as 4 capitalizações comuns. Teste de contrato dedicado (`memed-credentials-encrypted-at-rest.spec.ts`) força um log com payload completo e valida que a saída JSON do pino contém `***REDACTED***`.

**Alternatives considered**:
- Mascaramento manual antes de log — descartado: depende de toda call site lembrar. Defesa central é melhor.
- Truncar string para últimos 4 chars (`mk_***ab12`) — boa pra debug, mas a Memed pode considerar "qualquer caractere da chave" como exposição. `***REDACTED***` é mais seguro.

---

## R4. `setFeatureToggle` — como verificar respeito a desativações

**Decision**: o iframe da Memed envia comandos `setFeatureToggle` via `postMessage` ao window pai. O wrapper React do iframe (em `src/app/(dashboard)/.../atendimentos/prescrever-launcher.tsx`, responsabilidade do spec 026) deve:
1. Escutar `postMessage` com `data.command === 'setFeatureToggle'`
2. Não injetar CSS que sobreponha estados internos do iframe
3. Repassar toggles externos relevantes (ex.: esconder botão "Imprimir manual" na UI do Clinni se Memed desativou)

**Teste de verificação**: o E2E `memed-feature-toggle-respected.spec.ts` faz mock do iframe que envia `{ command: 'setFeatureToggle', feature: 'manualPrescription', enabled: false }` e verifica via Playwright que nenhum elemento com `data-feature="manualPrescription"` está visível no DOM externo ao iframe.

**Rationale**: como o iframe é controlado pela Memed e nosso wrapper só é controle externo, a única superfície que podemos auditar é o que renderizamos fora do iframe. O critério da Memed é "não reativar/sobrepor", o que verificamos por (a) ausência de CSS forçado em elementos do iframe (auditável por inspeção do DOM/CSS computado) e (b) propagação correta de toggles para nossa UI.

**Alternatives considered**:
- Não auditar (risco baixo se nunca tivermos CSS conflitante) — descartado: spec exige verificação ativa, e qualquer CSS futuro pode regredir.

---

## R5. Mock da Memed para testes de integração e E2E

**Decision**: escrever mock HTTP server (`tests/mocks/memed-mock-server.ts`) usando MSW (Mock Service Worker, já em devDeps) ou vanilla Node `http`. Responde aos endpoints:

- `POST /usuarios` — registra prescritor; retorna `{ data: { attributes: { token, external_id } } }` ou `422` com lista de campos faltantes (para teste de bloqueio de US1).
- `GET /usuarios/{external_id}` — retorna token atual (para US1 ao reabrir prescrição).
- `GET /catalogos/especialidades` — retorna lista fixa de 5 especialidades (para US4 do spec 026; não testado aqui).

Para E2E: o mock roda na mesma origem que o app (via Playwright `route.fulfill`).

**Rationale**: Memed não publica sandbox dedicado para testes automatizados. Nosso mock fica idêntico ao contrato em `contracts/memed-mock.md` e é usado tanto em integração quanto em E2E, garantindo paridade. Decisão evita acoplar suíte a uptime/latência de homologação real (que serve para uat manual antes de produção).

**Alternatives considered**:
- Bater contra homologação real — descartado: instabilidade, custo, dependência de credenciais válidas no CI.
- Apenas validar payload sem retornar resposta plausível — não cobre fluxo end-to-end nem captura de eventos.

---

## R6. CI orquestração

**Decision**: workflow GitHub Actions dedicado `.github/workflows/memed-conformidade.yml`:

- Trigger: PR/push contra `master` se algum arquivo abaixo mudar:
  - `src/lib/core/integrations/memed/**`
  - `src/app/api/integracoes/memed/**`
  - `src/app/api/medicos/[id]/memed-*/**`
  - `src/app/api/atendimentos/[id]/prescricoes/**`
  - `tools/eslint-rules/no-memed-secrets-in-frontend.js`
  - `tests/contract/memed-*`, `tests/integration/memed-*`, `tests/e2e/memed-*`
  - `tools/scripts/scan-bundle-for-memed-keys.ts`

- Jobs:
  1. `lint` — roda `pnpm lint` (inclui custom rule). Falha = bloqueia.
  2. `unit-contract-integration` — `pnpm test` filtrando `memed-*`.
  3. `build-and-scan` — `pnpm build` seguido de `pnpm scan:memed-keys`. Falha se encontrar key no bundle.
  4. `e2e` — sobe `pnpm dev` (com mock), roda Playwright. Falha = bloqueia.

- Caminho rápido: jobs paralelizados; tempo total ≤ 4 min.

**Rationale**: workflow dedicado isola tempo de CI dos demais. Trigger paths-filter evita rodar pra mudanças irrelevantes (economiza minutos GitHub Actions).

**Alternatives considered**:
- Integrar tudo no workflow principal `ci.yml` — descartado: dilui logs e aumenta tempo do CI principal.
- Rodar só nightly — descartado: regressão precisa bloquear merge, não ser descoberta no dia seguinte.
