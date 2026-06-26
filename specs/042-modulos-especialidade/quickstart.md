# Quickstart — Verificar os módulos de especialidade

## Pré-requisitos

- Stack local: `pnpm supabase:reset` (aplica até a migração `0162`) + `pnpm seed:demo`.
- App: `pnpm dev`.

## Cenário A — Convênio OFF esconde tudo de convênio

1. No `/admin`, abra uma clínica de teste (não-legacy) e **desligue** o módulo "Convênio".
2. Entre na clínica e verifique:
   - Sidebar: **não** aparecem "Faturamento TISS" nem "Recebíveis Convênio".
   - Configurações: **não** aparece o card "Convênios"; integração TISS indisponível.
   - Novo atendimento: **não** há seleção convênio×particular (tudo particular).
   - Prontuário → Cadastro: **não** aparece o campo de convênio/plano.
3. **Ligue** "Convênio" → todas as áreas reaparecem.

## Cenário B — Odonto OFF esconde Odonto-Space

1. No `/admin`, desligue "Odontologia".
2. Abra um prontuário → a aba "Odonto-Space" **não** existe.
3. Acesse `…/pacientes/<id>?tab=odontograma` diretamente → cai numa aba padrão (sem erro).
4. Ligue "Odontologia" → a aba volta.

## Cenário C — Oftalmo OFF esconde exames oftalmológicos

1. No `/admin`, desligue "Oftalmologia".
2. Prontuário → a seção de exames oftalmológicos **não** aparece; modelos de laudo somem das Configurações.
3. Ligue "Oftalmologia" → reaparecem.

## Cenário D — Legacy mantém tudo

1. Clínica no plano `legacy` (ou sem linha em `tenant_entitlements`): todos os módulos aparecem, independente do backfill.

## Cenário E — Migração auto-ativa quem já usa

1. Em uma clínica não-legacy com odontograma/periograma já registrados (ex.: seed de apresentação), após `supabase:reset`, confirme que `odonto` está em `tenant_entitlements.modules`.
2. Idem: clínica com `appointment_procedures.plan_id` preenchido ou TISS configurado → `convenio` presente; com `ophthalmology_exams` → `oftalmo` presente.
3. Confirme que **nenhum** tenant tem mais `tiss` em `modules` (todos migrados para `convenio`).

## Testes automatizados (alvo)

- `pnpm test tests/unit/dashboard-shell-sections.spec.ts` — matriz de visibilidade da sidebar com `convenio`.
- Novos unit tests: hub cards (G3/G9) e `getTenantEntitlements` reconhecendo os novos módulos / ignorando `tiss`.
- Integration: aplicar a migração `0162` em um tenant com cada tipo de dado e assertar os módulos resultantes (+ rename `tiss`→`convenio` + idempotência).

> ⚠️ Rodar testes apaga o banco local (resetDatabase). Re-seedar com `pnpm seed:demo` depois.
