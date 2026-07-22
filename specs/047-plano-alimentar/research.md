# Research — Plano Alimentar (047)

Fase 0. Resolve as incógnitas do plano antes do desenho. Cada decisão traz o que foi escolhido, por quê, e o que foi descartado.

---

## D1. Qual base de alimentos semear como catálogo global

**Decisão: POF/IBGE como espinha dorsal + TACO sobreposta nos alimentos onde existe, com `source` por registro. TBCA descartada.**

| Base | Alimentos | Licença | Medida caseira | Veredito |
|---|---|---|---|---|
| **TACO** (NEPA/UNICAMP, 4ª ed. 2011) | 597 | ✅ "permitida a reprodução total ou parcial desde que citada a fonte" | ❌ não tem | **Usar como camada de qualidade** |
| **TBCA** (USP/FoRC, v7.3 2025) | 5.700+ | ❌ **CC BY-NC-ND 4.0** | ✅ | **DESCARTADA** |
| **POF/IBGE** (2008-2009) | 1.972 linhas (1.122 códigos × preparos) | ⚠️ **NÃO CONFIRMADA** | ✅ tabela irmã com join nativo | **Espinha dorsal** |

**Racional:**

1. **A TBCA está fora, e não por pouco.** A licença CC BY-NC-ND proíbe uso comercial *e* proíbe alterar o conteúdo — ou seja, nem normalizar para o nosso schema seria permitido. Além disso não há download em massa, então ingerir significaria scraping, violando as duas cláusulas de uma vez. É a base mais completa e mais atual das três, e mesmo assim é inutilizável sem autorização escrita da coordenação. **Não usar na v1.**

2. **A medida caseira decidiu a escolha, não a cobertura.** A TACO, apesar da licença ideal, **não traz medida caseira** — só valores por 100 g. Sem ela, o FR-008/FR-012 ("2 fatias", "1 colher de sopa") teria que ser construído à mão. As referências brasileiras usuais para isso (Pinheiro et al., Fisberg & Villar) são **livros com direitos reservados — não embutir**. A POF resolve isso com uma publicação irmã, a *Tabela de Medidas Referidas*: **11.802 linhas**, que fazem join pelo **mesmo código de alimento + preparação** da tabela de composição. Chave nativa, sem matching por nome. Isso sozinho economiza semanas e elimina o risco de copiar de fonte protegida.

3. **A POF cobre preparo, a TACO cobre fidelidade.** A POF distingue cru/cozido/frito/assado nativamente — que é como o nutricionista prescreve. Em compensação, inspecionando os dados, boa parte dos valores da POF é **derivada do USDA** (aparecem referências como `"Oil, soybean, unhydrogenated"`), enquanto a TACO é análise laboratorial brasileira real. Daí a sobreposição: onde a TACO existe, ela prevalece; e o campo `source` fica **visível na UI** para o profissional julgar.

**Alternativas consideradas e rejeitadas:**
- *Só TACO*: 597 alimentos e sem medida caseira — insuficiente para atender.
- *Só POF*: perde a qualidade laboratorial brasileira nos alimentos mais usados.
- *TBCA*: bloqueada por licença.
- *Base própria digitada*: custo proibitivo e sem autoridade para defender números.

**Riscos assumidos:**

- ⚠️ **Licença do IBGE NÃO CONFIRMADA.** Não há outorga expressa de redistribuição na publicação. Risco prático baixo (estatística pública federal sob a Política de Dados Abertos, Decreto 8.777/2016, amplamente redistribuída), mas **não é certeza**. **Ação recomendada: e-mail ao IBGE confirmando antes de vender para clientes que auditam fornecedor.**
- ⚠️ **A atribuição da TACO é obrigação de licença, não cortesia.** "Fonte: TACO, 4ª ed., NEPA/UNICAMP, 2011" **MUST** aparecer na UI e em todo PDF exportado. Some do rodapé = violação. → **ver Lacuna L1 abaixo.**
- ⚠️ **Nenhuma das bases tem industrializados nem marcas** (ambas de 2011). A nutricionista vai pedir "Whey marca X" na primeira semana. O cadastro de alimentos próprios (US1) **não é conveniência, é requisito de viabilidade** — sem ele o catálogo vira reclamação recorrente.

**Insumos já prontos**: CSVs baixados e convertidos das fontes oficiais (composição TACO, composição POF, medidas POF) estão no scratchpad da sessão, prontos para o `scripts/seed-foods.ts`.

---

## D2. Estender as tabelas `diet_*` ou recriar

**Decisão: estender.** `diet_plans`, `diet_meals` e `diet_meal_items` (migration 0122) já estão **em produção** e podem ter dados de clínicas reais.

- `diet_meal_items` ganha colunas **aditivas e nullable**: `food_id`, `grams`, medida caseira, e o snapshot `snap_*`.
- `food TEXT` continua `NOT NULL`: itens legados de texto livre seguem legíveis e não quebram nenhuma tela; apenas não entram no cálculo (`food_id IS NULL` → sem nutriente).
- Para itens novos, gravamos em `food` o **nome do alimento no momento da inclusão** — assim o item permanece legível mesmo se o alimento for desativado depois.

**Rejeitado:** criar `diet_plan_items_v2` e migrar. Duplicaria o domínio, exigiria backfill com risco em dados de produção e deixaria duas fontes da verdade — sem ganho, já que as colunas novas são todas aditivas.

---

## D3. O catálogo global e o `catalog_baseline` (migration 0170) — o principal risco técnico

**Contexto do gotcha:** `test_truncate_all_mutable()` (chamada por `resetDatabase()` a cada arquivo de teste) faz `TRUNCATE` em **todas** as tabelas de `public` e depois restaura os catálogos a partir de um snapshot no schema `catalog_baseline`, capturado **lazy na primeira chamada**. Consequência já documentada no projeto: catálogo semeado por migration **depois** da captura do baseline **some a cada reset**.

**Decisão: registrar as tabelas do catálogo de alimentos no `catalog_baseline` (captura + restauração), e a migration 0176 dá refresh no baseline se ele já existir** — exatamente o que a 0175 fez com a métrica `gasto_energetico_total`.

**Volume real (medido, não estimado):**

| Tabela | Linhas | CSV |
|---|---|---|
| Composição (POF + TACO) | ~2.500 | 0,74 MB |
| Medidas caseiras | 11.802 | 1,10 MB |
| **Total** | **~14.300** | **~1,9 MB** |

Isso é **muito menor do que eu temia ao abrir o plano** (a estimativa inicial de ~7.900 *alimentos* vinha das planilhas de referência; a base oficial é mais enxuta). Em disco, com índices, ~5–8 MB. A restauração é um `INSERT … SELECT` de ~14 mil linhas por reset, ~250 resets por suíte — na ordem de **poucos segundos somados**, não minutos. **Custo aceitável.**

**Alternativa considerada e rejeitada:** mover o catálogo global para um schema próprio (ex.: `catalog`), fora de `public`, ficando **imune** ao `TRUNCATE` e com custo zero no reset. Elegante, mas quebra a convenção do projeto (tudo em `public`), exige expor um schema adicional no PostgREST e cria um caso especial em toda leitura. **Não vale a economia de poucos segundos.** Fica registrado como saída caso a suíte cresça e o tempo passe a incomodar.

**Seed via `COPY`, não `INSERT`** — a diferença é de ordens de grandeza em ~14 mil linhas.

---

## D4. Como versionar a prescrição

**Decisão: tabela `diet_plan_prescriptions` append-only com o cardápio inteiro em `snapshot JSONB`.**

O SC-007 exige que o paciente veja **exatamente** o que foi prescrito. Reconstruir o cardápio por join em `diet_meals`/`diet_meal_items` não sustenta isso: o rascunho **continua editável** para a consulta seguinte, então o plano do paciente mudaria sozinho.

O JSONB desacopla o registro histórico do rascunho vivo. É o mesmo padrão do snapshot de `nutrition_assessments` (046), que já se provou.

Reusa a infraestrutura existente, sem inventar mecanismo: `enforce_append_only()` como trigger `BEFORE UPDATE OR DELETE`, `REVOKE UPDATE, DELETE … FROM authenticated`, e `log_audit_event()` no `AFTER INSERT`.

**Rejeitado:** versionar por `valid_from`/`valid_to` nas próprias linhas do cardápio. Multiplicaria as linhas de `diet_meal_items`, complicaria toda leitura e ainda deixaria a reconstrução histórica dependente de joins.

---

## D5. Busca de alimento (typeahead sobre milhares de itens)

**Decisão: `pg_trgm` + `unaccent`, com índice GIN sobre uma expressão `IMMUTABLE`.**

Verificado no Postgres do Supabase local:
- `pg_trgm` — **já instalado** (1.6)
- `unaccent` — **disponível, porém NÃO instalado** → a 0176 precisa de `CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions`, seguindo o precedente do `btree_gist` (feature 005).

⚠️ **Armadilha conhecida**: `unaccent()` **não é `IMMUTABLE`** por padrão (depende de dicionário), e o Postgres recusa índice sobre função não-imutável. É necessário um wrapper `IMMUTABLE` próprio para indexar. Sem isso, o índice não é criado e a busca cai em varredura sequencial — que funciona nos ~14 mil registros de dev e degrada silenciosamente depois.

Ganho: tolera acento (`acucar` acha `açúcar`) e erro de digitação — essencial para o SC-001 (cardápio montado em menos de 10 min).

---

## D6. Fonte do dado visível ao profissional

**Decisão: `source` é coluna de primeira classe em `foods`, exibida na UI e no PDF.**

Três motivos convergem:
1. **Obrigação de licença** da TACO (atribuição).
2. **Rastreabilidade clínica** — a nutricionista precisa saber se o número veio de laboratório brasileiro (TACO) ou de compilação (POF, parcialmente USDA), ou se é cadastro próprio da clínica.
3. **Defesa em divergência** — quando um cliente comparar com a TBCA e o número diferir, a resposta é a fonte por registro.

---

## Lacunas identificadas na spec

**L1 — Atribuição das fontes não é requisito na spec.** A licença da TACO **exige** citação da fonte, e a spec atual não tem nenhum FR cobrindo isso. Como é obrigação contratual e não estética, precisa virar requisito verificável:

> **FR-020 (proposto)**: O sistema MUST exibir a atribuição das bases de composição de alimentos ("Fonte: TACO, 4ª ed., NEPA/UNICAMP, 2011" e "IBGE, POF 2008-2009") na tela do catálogo e em todo material exportado/impresso que contenha valores nutricionais dessas bases.

**L2 — Ausência de industrializados não está registrada como premissa.** As duas bases são de 2011 e não têm marcas. A spec trata o cadastro próprio como funcionalidade; na prática ele é **condição de viabilidade** do módulo. Vale explicitar nas Assumptions para calibrar expectativa de quem for usar.

> Ambas as lacunas são de **documentação**, não de desenho — o plano e o data-model já as suportam (`source` em `foods`, alimentos próprios por clínica). Sugiro incorporá-las à spec antes do `/speckit-tasks`.

---

## Resumo das incógnitas resolvidas

| Incógnita | Status |
|---|---|
| Qual base de alimentos | ✅ POF/IBGE + TACO sobreposta; TBCA descartada por licença |
| Licença para SaaS comercial | ✅ TACO confirmada (atribuição) · ⚠️ IBGE **não confirmada**, risco baixo |
| Medida caseira | ✅ Tabela de Medidas Referidas da POF, join nativo |
| Volume e impacto nos testes | ✅ ~14,3 mil linhas / 1,9 MB — custo de poucos segundos por suíte |
| Extensão vs recriação das `diet_*` | ✅ estender (aditivo) |
| Versionamento da prescrição | ✅ snapshot JSONB append-only |
| Busca textual | ✅ `pg_trgm` ok; `unaccent` a instalar + wrapper `IMMUTABLE` |
