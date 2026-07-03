# Implementation Plan: Faturamento TISS de Convênios

**Branch**: `029-faturamento-tiss` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/029-faturamento-tiss/spec.md`

## Summary

Permitir que clínicas que atendem convênios **gerem, validem, agrupem em lotes, assinem (ICP-Brasil A1) e exportem** guias no padrão **TISS 4.03.00** da ANS, reaproveitando atendimentos (`appointments`/`appointment_procedures`), convênios (`health_plans`), procedimentos TUSS (`tuss_codes`), médicos (`doctors`) e o financeiro/repasse (feature 023). A lógica TISS vive numa **cápsula de domínio** `src/lib/core/tiss/` (análoga à `memed/` da feature 026): geração do XML a partir de um modelo de guia normalizado, **validação contra o XSD oficial** (fonte da verdade), montagem de lote `loteGuias`, cálculo do **hash MD-5** do epílogo, **assinatura XMLDSig** com certificado ICP-Brasil A1, e download do arquivo para upload manual no portal da operadora (sem webservice no MVP). Acompanhamento de status (rascunho → pronta → exportada → paga/glosada), registro manual de glosas (Tabela 38) e reapresentação. Conta a receber da operadora integra ao financeiro existente e respeita o repasse médico.

**Descoberta de planejamento (impacto em escopo):** a assinatura ICP-Brasil (feature 024) **não existe em código** — só há um diretório de spec stub. Como a decisão D2 colocou assinatura no MVP, **esta feature constrói o assinador XMLDSig** (cápsula `tiss/signing/`), suportando **apenas certificado A1 (.pfx)** no MVP (A3/token de hardware não assina server-side). Ver Complexity Tracking.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, Route Handlers, Server Actions, RSC), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, Tailwind 3.4, shadcn/ui. **Novas deps de runtime** (justificadas — padrão ANS exige XML+XSD+assinatura, não se faz à mão com segurança):

- `xmlbuilder2` — construção determinística do XML (escaping correto, ordem de elementos).
- `xmllint-wasm` — validação XML×XSD via libxml2 compilado para **WebAssembly** (sem binários nativos → seguro em serverless Vercel).
- `xml-crypto` — assinatura **XMLDSig enveloped** (RSA-SHA256) no elemento de assinatura do `mensagemTISS`.
- `node-forge` — leitura do certificado **ICP-Brasil A1 (.pfx/.p12)** e conversão para PEM + extração da cadeia.

**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0112_tiss_faturamento.sql` (próximo número livre — última é `0111_memed_platform_keys.sql`). **Tabelas novas**: `tenant_tiss_operator_config`, `tenant_tiss_certificates`, `tiss_guias`, `tiss_guia_procedures`, `tiss_lotes`, `tiss_glosas`, `tiss_domain_tables`. **Tabelas tocadas (uso, sem schema change)**: `audit_log` (via `log_audit_event`), `appointments`/`appointment_procedures`/`appointments_effective`, `health_plans`, `doctors`, `patients` (decifra via RPC), `tuss_codes`. **Sem alteração** em `health_plans` (o Registro ANS e o código do contratado ficam na nova `tenant_tiss_operator_config`, 1:1 com o convênio — evita poluir a tabela base e mantém TISS opt-in).
**Testing**: Vitest — `pnpm test`, `pnpm test:integration`, `pnpm test:contract` (isolamento multi-tenant + RBAC por endpoint + append-only), `pnpm typecheck`, `pnpm lint:auth`. **Teste-âncora de conformidade**: todo XML gerado nos fixtures valida contra o XSD oficial 04.03.00 (SC-001) — gate automatizado.
**Target Platform**: Web app SSR (Vercel) + navegadores modernos. Geração/validação/assinatura do XML rodam **server-side** (Route Handler/Server Action) — nunca no browser (certificado e PII jamais saem do servidor).
**Project Type**: Web application full-stack (Next.js) — estrutura existente do repositório.
**Performance Goals**: gerar+validar uma Guia de Consulta a partir de um atendimento completo em ≤1 min (SC-002, com folga — alvo técnico <2s server-side); validação XSD de lote típico (≤100 guias) em <5s.
**Constraints**: XML deve validar 100% contra o XSD da 04.03.00 antes de exportar (SC-001/SC-003); nenhum dado faltante exportável; PII de paciente decifrada só no servidor; certificado A1 cifrado em repouso (mesmo padrão de credenciais); timestamps UTC; valores em centavos (constituição); isolamento por tenant em 3 camadas; `lint:auth` em todos os `/api/*`.
**Scale/Scope**: 7 tabelas novas, 1 migration, 1 cápsula de domínio `tiss/` (geração + validação + assinatura + lote + glosa), ~8–10 Route Handlers, telas: config TISS por operadora (admin), gerar/validar guia no atendimento e em lote (faturista), painel de lotes/status/glosas. XSDs 04.03.00 versionados como asset estático no repo. Domínios TISS (38, 87, 26, 24, 59, 52, 36, 48, 50, 23, 76, 35) seedados.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                              | Avaliação                  | Como o plano atende                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável** | ✅                         | `tiss_guias`, `tiss_guia_procedures`, `tiss_lotes`, `tiss_glosas` são **append-only**. Valor da guia é **congelado** a partir de `appointments_effective.net_amount_cents` (centavos) no momento da geração. Transições de status só por caminho-guardado (`enforce_append_only_columns` com whitelist de `status`/`exported_at`/`signed_at`). Glosa e reapresentação **não apagam** a guia original — criam vínculo (`supersedes_guia_id`). |
| **II. Auditabilidade Total**           | ✅                         | Configurar operadora, subir certificado, gerar/validar/exportar guia, fechar lote, assinar, registrar glosa e reapresentar emitem `log_audit_event` (ator, UTC, tenant, entidade, origem). Conteúdo do XML é persistido por lote para reprodutibilidade (mesmo hash).                                                                                                                                                                        |
| **III. Isolamento Multi-Tenant**       | ✅                         | Todas as tabelas com `tenant_id` + RLS (`jwt_tenant_id()`); PKs UUID; certificado e config por tenant. Teste de contrato de vazamento entre tenants. Lote nunca mistura operadoras nem tenants.                                                                                                                                                                                                                                              |
| **IV. Conformidade TUSS/ANS**          | ✅ **(núcleo da feature)** | Versão TISS **04.03.00** fixada; XML **validado contra XSD oficial** antes de exportar (rejeita silêncio); par **Tabela (dom. 87) + Código** obrigatório; catálogo TUSS versionado (`tuss_catalog_versions`) — código obsoleto (`valid_to` no passado) **sinaliza/bloqueia**; divergência gera alerta operacional, não falha silenciosa.                                                                                                     |
| **V. Segurança por Perfil (RBAC)**     | ✅                         | Configurar operadora + subir/remover certificado = `admin`; gerar/validar/lotear/exportar/assinar/registrar glosa = `financeiro` (faturista) e `admin`; `profissional_saude`/`recepcionista` **não** faturam. `requireRole` server-side em todos os handlers; negações logadas.                                                                                                                                                              |
| **Domínio/LGPD/Segredos**              | ✅                         | Certificado A1 e senha cifrados via `enc_text_with_key` (não em env versionado, não no browser); PII de paciente decifrada via RPC só no servidor e embutida no XML server-side; logs com PII/segredo mascarados; centavos como inteiros; UTC na persistência.                                                                                                                                                                               |

**Resultado**: Sem violações de princípio. Há **novas dependências de runtime** e a **restrição A1-only** de assinatura — registradas em Complexity Tracking (não são violações, são decisões com trade-off explícito).

## Project Structure

### Documentation (this feature)

```text
specs/029-faturamento-tiss/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões técnicas (versão, libs XSD/assinatura, A1-only)
├── data-model.md        # Phase 1 — entidades, RLS, triggers, máquina de status
├── quickstart.md        # Phase 1 — como rodar/validar localmente (XSD + assinatura de teste)
├── contracts/
│   ├── internal-endpoints.md     # contrato dos Route Handlers
│   └── tiss-xml-contract.md      # mapeamento campo→XSD (Consulta + SP/SADT) + lote + assinatura
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec (já criado)
└── tasks.md             # Phase 2 (/speckit.tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── configuracoes/integracoes/tiss/        # config TISS por operadora + certificado (admin)
│   │   │   ├── page.tsx
│   │   │   ├── tiss-operator-form.tsx
│   │   │   └── tiss-certificate-form.tsx
│   │   └── financeiro/tiss/                        # área do faturista
│   │       ├── page.tsx                            # painel de guias/lotes/status
│   │       ├── guias-table.tsx
│   │       └── lote-detail.tsx
│   └── api/
│       ├── tiss/operadoras/[planId]/route.ts       # POST/PATCH/DELETE config TISS (admin)
│       ├── tiss/certificados/route.ts              # POST upload / DELETE certificado A1 (admin)
│       ├── tiss/guias/route.ts                     # POST gerar guia a partir de atendimento (faturista)
│       ├── tiss/guias/[id]/route.ts                # GET detalhe + validação; PATCH status
│       ├── tiss/lotes/route.ts                     # POST criar/fechar lote (faturista)
│       ├── tiss/lotes/[id]/xml/route.ts            # GET download XML assinado
│       └── tiss/glosas/route.ts                    # POST registrar glosa; reapresentação
├── lib/core/tiss/                                  # CÁPSULA de domínio TISS
│   ├── version.ts                                  # constantes da versão-alvo (04.03.00, 202511, 202605)
│   ├── build-guia.ts                               # appointment → modelo normalizado de guia
│   ├── xml/
│   │   ├── render-consulta.ts                      # modelo → XML Guia de Consulta
│   │   ├── render-spsadt.ts                        # modelo → XML Guia SP/SADT
│   │   ├── render-lote.ts                          # loteGuias + cabeçalho + epílogo(hash MD-5)
│   │   └── hash.ts                                 # hash MD-5 do conteúdo (regra do componente)
│   ├── validate.ts                                 # validação XML×XSD (xmllint-wasm) → erros legíveis
│   ├── signing/
│   │   ├── load-certificate.ts                     # node-forge: .pfx → PEM + cadeia (cert cifrado)
│   │   └── sign-lote.ts                            # xml-crypto: XMLDSig enveloped RSA-SHA256
│   ├── validate-content.ts                         # regras de obrigatoriedade por tipo de guia (pré-XSD)
│   ├── domains.ts                                  # acesso às tabelas de domínio (38/87/26/24/...)
│   ├── glosa.ts                                    # registrar glosa + reapresentação
│   └── mask.ts                                     # masking de PII/segredo em logs
├── lib/core/tiss/schemas/04.03.00/                 # XSDs oficiais da ANS (asset versionado)
│   └── *.xsd
└── supabase/migrations/
    └── 0112_tiss_faturamento.sql

tests/
├── contract/
│   ├── tiss-tenant-isolation.spec.ts
│   ├── tiss-rbac.spec.ts
│   ├── tiss-guias-append-only.spec.ts
│   └── tiss-xml-validates-against-xsd.spec.ts      # ÂNCORA: todo XML gerado valida no XSD oficial
└── integration/
    ├── tiss-generate-consulta.spec.ts
    ├── tiss-generate-spsadt.spec.ts
    ├── tiss-validate-blocks-incomplete.spec.ts
    ├── tiss-lote-and-sign.spec.ts
    └── tiss-glosa-and-resubmit.spec.ts
```

**Structure Decision**: Web app full-stack na estrutura existente. Toda a lógica TISS (geração, validação XSD, hash, assinatura, lote, glosa) vive em `src/lib/core/tiss/` — **único** lugar que monta/valida/assina o XML; nenhum Route Handler manipula XML diretamente. Config e certificado por operadora ficam em tabelas dedicadas (`tenant_tiss_operator_config` 1:1 com `health_plans`; `tenant_tiss_certificates` por tenant), cifrados pelos RPCs `enc_text_with_key`/`dec_text_with_key`. Os XSDs oficiais 04.03.00 entram como **asset versionado** no repo (`schemas/04.03.00/`) — a versão é parte do código, atualizada por PR a cada release ANS (Princípio IV).

## Phasing (entrega faseada)

- **Fase A — Fundação** (bloqueante): migration 0112 (7 tabelas + RLS + triggers append-only + seed dos domínios 38/87/26/24/59/52/36/48/50/23/76/35), cápsula `tiss/version.ts` + `domains.ts`, download/commit dos XSDs 04.03.00, `validate.ts` (xmllint-wasm) com teste-âncora XSD, testes de contrato (isolamento, RBAC, append-only). Validável: um XML mínimo de exemplo valida contra o XSD oficial.
- **Fase B — US1 (P1)**: config TISS por operadora (Registro ANS, versão, código do contratado, CNPJ/CNES, mapeamentos) + upload de certificado A1 cifrado. Validável: operadora "TISS habilitado".
- **Fase C — US2 (P1)**: gerar+validar **Guia de Consulta** a partir do atendimento (`build-guia` + `render-consulta` + `validate-content` + `validate` XSD) com mensagens claras de pendência. MVP de valor parcial.
- **Fase D — US4 (P1)**: montar **lote** (`render-lote` + hash MD-5) + **assinar** (XMLDSig A1) + download do XML. Fecha o ciclo de exportação ponta a ponta (com US2). **MVP mínimo viável = A+B+C+D.**
- **Fase E — US3 (P2)**: gerar+validar **Guia SP/SADT** (blocos solicitante/executante, múltiplas linhas, totalizadores).
- **Fase F — US5 (P2)**: status, registro manual de **glosa** (Tabela 38) e **reapresentação** com vínculo.
- **Fase G — US6 (P3)**: integração financeira — conta a receber da operadora + conciliação parcial respeitando repasse.

## Complexity Tracking

> Sem violação de princípio constitucional. Decisões com trade-off explícito (não-violações):

| Decisão                                                                             | Por que é necessária                                                                                                                             | Alternativa rejeitada (porquê)                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 4 novas deps de runtime (`xmlbuilder2`, `xmllint-wasm`, `xml-crypto`, `node-forge`) | O padrão ANS exige XML conforme XSD + assinatura XMLDSig + hash; construir/validar/assinar à mão é fonte garantida de glosa (viola Princípio IV) | Hand-roll de XML/validação/assinatura: rejeitado por risco de conformidade e superfície de bug em algo regulado  |
| `xmllint-wasm` (WASM) p/ validação XSD                                              | Vercel serverless não compila binários nativos de forma confiável; WASM roda em qualquer runtime                                                 | `libxmljs2-xsd` (nativo): risco de build em serverless. `xsd-schema-validator` (spawna Java): inviável na Vercel |
| Assinatura **A1-only** no MVP                                                       | Certificado A1 (.pfx) é arquivo → assinável server-side; A3 é token de hardware, não acessível em servidor sem presença física                   | Suporte A3 no MVP: impossível server-side sem HSM/cliente local; fica como follow-up                             |
| XSDs versionados como asset no repo (não baixados em runtime)                       | Reprodutibilidade + Princípio IV (versão é parte do código, auditável por PR); gov.br bloqueia download não-browser                              | Download em runtime: frágil (WAF 403), não reprodutível, risco de validar contra versão errada                   |
| ICP signing construído nesta feature (024 não existe)                               | D2 colocou assinatura no MVP e não há módulo 024                                                                                                 | Esperar feature 024: bloquearia o MVP por dependência inexistente                                                |
