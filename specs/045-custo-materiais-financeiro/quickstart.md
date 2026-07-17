# Quickstart — Validar "Custo de materiais e Gasto com materiais" (045)

Pré: stack local (`supabase start` :54321), `pnpm supabase:reset` (aplica até `0172`), `pnpm seed:demo`.

## Fluxo feliz (manual)

1. **Catálogo** — em `/configuracoes/materiais`, criar um insumo "Resina composta" com custo R$ 12,00. (Papel `admin`/`financeiro`.)
2. **Uso** — num atendimento, anexar 3× "Resina composta". Conferir que o custo (R$ 12,00) vem do catálogo e o total do material fica R$ 36,00. Testar override (mudar para R$ 15,00 naquele lançamento).
3. **Sem custo** — anexar um material ad-hoc sem custo; conferir que entra com R$ 0,00 e aparece **pendência de custo**.
4. **Completar pendência** — via ação de correção (papel `financeiro`), informar o custo + motivo; conferir auditoria.
5. **Resultado operacional** — em `/relatorios` (mês corrente), conferir a linha **"Gasto com materiais"** e que o lucro caiu exatamente o total dos materiais; receita bruta e comissões inalteradas.
6. **Estorno** — estornar o atendimento; conferir que o gasto com materiais dele sai do total.
7. **Relatórios** — por profissional e por convênio mostram o gasto com materiais; exportar Excel/PDF e conferir a coluna.

## Mapa de verificação (Success Criteria)

| Critério | Como validar |
|---|---|
| SC-001 (registrar em <30s) | Passo 2 a partir de insumo cadastrado |
| SC-002 (linha no resultado + lucro) | Passo 5 (comparar lucro antes/depois) |
| SC-003 (estornado excluído) | Passo 6 |
| SC-004 (snapshot imutável) | Editar custo do insumo no catálogo → uso do passo 2 permanece R$ 36,00 |
| SC-005 (por profissional/convênio + export) | Passo 7 |
| SC-006 (repasse/receita inalterados) | Passo 5: `grossRevenue`/`commissions`/`monthly_payouts` sem variação |

## Testes automatizados (vitest)

- **Contrato**: (a) `appointment_materials` rejeita UPDATE de colunas ≠ `{unit_cost_cents, material_id}` e todo DELETE; (b) isolamento de tenant no catálogo e nas agregações; (c) RBAC — só `admin`/`financeiro` criam/editam custo.
- **Integração**: anexar com custo → `sumMaterialsCost` bate; estorno zera; `operating-result` inclui a linha e o lucro; catálogo editado não muda snapshot.
- **Unidade**: derivação `costPending`, `totalCostCents`, fronteira de mês no fuso do tenant.

## Comandos

```bash
pnpm supabase:reset && pnpm supabase:gen-types
pnpm test:contract && pnpm test:integration
pnpm lint:auth && pnpm typecheck
```
