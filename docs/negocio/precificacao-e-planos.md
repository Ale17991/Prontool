# Clinni — Análise de Mercado, Precificação e Definição de Planos

**Documento de planejamento empresarial** · Versão 1.0 · 2026-06-09
Autor: análise estratégica · Status: proposta para decisão

---

## Sumário executivo

O Clinni é um sistema de gestão para clínicas e consultórios **profissão-neutro** (atende
médicos, odonto, estética, fisio, psi, multiespecialidade) com uma arquitetura **modular por
área funcional**: um núcleo de operação + camadas opcionais (financeiro/repasse, faturamento
TISS, prescrição digital Memed, portal do paciente, agendamento público, integrações/CRM).

A pesquisa nos maiores players do Brasil mostra um mercado **consolidado em torno de dois
modelos** — cobrança **por profissional de saúde** (iClinic, Feegow, Amplimed, Shosp,
Ninsaúde) e **plano único por clínica** (Clínica nas Nuvens) — com **bundling em três camadas**
("bom-melhor-ótimo") e **TISS/telemedicina como gatilhos de upsell**.

**Recomendação central:** adotar **modelo híbrido por profissional** com três planos
(Essencial / Pro / Clínica) **acrescido de módulos à la carte** (TISS, Portal do Paciente,
Telemedicina, CRM). Isso espelha o modelo validado pela Amplimed e pelo iClinic, transforma a
arquitetura modular do produto em **alavanca de expansão de receita** (land-and-expand) e
posiciona o Clinni no **centro-premium** do mercado (entrada em R$ 99/prof, topo em
R$ 259/prof), abaixo do teto do iClinic Premium (R$ 299) e do flat da Clínica nas Nuvens
(R$ 499), com TISS como módulo de alto valor regulado.

---

## 1. Cenário competitivo (pesquisa de mercado — jun/2026)

### 1.0 Tamanho e dinâmica do mercado (TAM)

O Brasil é o **maior ecossistema de healthtech da América Latina**: entre 1.216 e 1.919
startups mapeadas, concentrando **64,8% de todo o investimento** em saúde digital da região.

- **Mercado de saúde digital:** US$ 6,34 bi (2024) → projeção **US$ 21,9 bi até 2030**
  (**CAGR 23,2%**).
- **Segmento-alvo do Clinni** ("Gestão de Saúde") é o **maior fatia do setor — 28%**; somado a
  prontuário eletrônico, gestão+prontuário respondem por ~25% das healthtechs. É o coração do
  mercado, não um nicho.
- **Concentração geográfica:** 68% Sudeste, 20% Sul — onde a digitalização de consultórios está
  mais avançada e o ticket médio é maior. Norte/Nordeste/Centro-Oeste são fronteira de
  expansão com menor penetração (e maior sensibilidade a preço).

**Leitura estratégica:** mercado grande, em crescimento acelerado e fragmentado entre dezenas de
players — há espaço para um produto **modular e profissão-neutro** que atravesse verticais em
vez de competir de frente com os verticalizados em cada nicho.

### 1.1 Tabela comparativa de preços (generalistas)

Valores **por profissional de saúde/mês** salvo indicação. Recepção/admin geralmente não são
cobrados.

| Player                              | Dono/Grupo              | Modelo                                | Entrada                                         | Topo                             | TISS                          | Telemedicina                                       | Observações                                                                          |
| ----------------------------------- | ----------------------- | ------------------------------------- | ----------------------------------------------- | -------------------------------- | ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **iClinic**                         | Afya                    | Por profissional, 4 tiers             | Starter **R$ 99**                               | Premium **R$ 299**               | a partir do **Plus (R$ 129)** | ilimitada só no Premium; add-on R$ 35/10 consultas | Sem fidelidade, sem taxa de instalação. Pro (R$ 169) traz financeiro/repasse/estoque |
| **Feegow**                          | Docplanner (Doctoralia) | Free + por profissional               | Free (até 100 pacientes) → **Plus R$ 129**      | Pro **R$ 149**                   | sim                           | sim                                                | Plano gratuito é isca de aquisição                                                   |
| **Amplimed**                        | Independente            | Por profissional **+ módulos add-on** | **R$ 89–99**                                    | varia (add-ons dobram/triplicam) | **add-on**                    | **add-on**                                         | Modelo "núcleo + módulos" — o mais próximo do Clinni                                 |
| **Clínica nas Nuvens**              | Independente            | **Plano único (flat)**                | **R$ 499/mês** (até 3 prof.)                    | extra por profissional           | incluso                       | incluso                                            | Contrato 12 meses; tudo incluído                                                     |
| **Shosp**                           | Independente            | Free + 2 tiers                        | Free (5 usuários) → **Fellowship R$ 149**       | Excellence **R$ 229**            | a partir do Fellowship        | sim                                                | Usuários ilimitados; taxa de setup; 15% desconto anual                               |
| **Ninsaúde Apolo**                  | Independente            | Por profissional                      | **~R$ 79** (ref. 2019; provável reajuste)       | —                                | —                             | sim                                                | 2 meses grátis no anual                                                              |
| **HiDoctor** (Centralx)             | Independente (30+ anos) | Por profissional, rampa promo         | R$ 89,90 (6 meses) → R$ 110 → **R$ 195** padrão | —                                | —                             | —                                                  | Marca tradicional/instalada; rampa de preço cresce após 12 meses                     |
| **ProDoctor**                       | Independente            | Por profissional/uso                  | sob consulta (R$ 50–5.000 conforme porte)       | —                                | —                             | —                                                  | **60 mil+ profissionais** — base instalada gigante, marca consolidada                |
| **Doctoralia Pro**                  | Docplanner              | Marketplace + agenda                  | R$ 200–600                                      | Premium ~R$ 599                  | n/a                           | n/a                                                | **Captação de pacientes**, não gestão — concorrente parcial                          |
| **Iter / Estetia (nicho estética)** | Independentes           | Por clínica                           | **R$ 39–149**                                   | até R$ 597                       | n/a                           | n/a                                                | Verticalizados em estética                                                           |

### 1.2 Anatomia das camadas de preço (por profissional/mês)

- **Entrada:** R$ 79–99 — agenda + prontuário + prescrição (table-stakes).
- **Intermediário:** R$ 129–169 — soma WhatsApp, **TISS** e **financeiro/repasse**.
- **Topo:** R$ 229–299 — soma telemedicina ilimitada, BI, automações/campanhas, multiunidade.
- **Flat por clínica:** R$ 499 (Clínica nas Nuvens) — para quem prefere previsibilidade.

### 1.3 Padrões estratégicos que o mercado já validou

1. **Cobrança por profissional é o padrão dominante.** Recepcionistas, secretárias e admins
   entram de graça — é argumento de venda explícito (iClinic). Só a Clínica nas Nuvens foge,
   com flat até 3 profissionais.
2. **Bundling em 3 camadas** ("bom-melhor-ótimo") é quase universal. O salto entre tiers é
   feito por **recursos**, não por limites de uso.
3. **TISS é gatilho de upsell consagrado** — sempre paywall: ou tier intermediário
   (iClinic Plus, Shosp Fellowship) ou **módulo avulso** (Amplimed). Nunca está no plano de
   entrada. → O módulo 029 do Clinni cai exatamente nesse ponto de monetização.
4. **Telemedicina** é a segunda alavanca de upsell (topo de linha ou add-on por uso).
5. **Free/trial como aquisição:** Feegow (100 pacientes) e Shosp (5 usuários) usam free
   permanente; iClinic usa trial. Reduz CAC e atrito de entrada.
6. **"Sem fidelidade, sem taxa de instalação"** é diferencial de marca (iClinic) — enquanto
   Shosp cobra setup + contrato de 12 meses e Clínica nas Nuvens trava 12 meses.
7. **Desconto anual** de ~12–15% (ou "2 meses grátis") é o padrão para reduzir churn e melhorar
   o caixa.
8. **Modularização à la carte** (Amplimed, **SimplesVet**) permite **ticket de entrada baixo +
   expansão** — exatamente a vantagem arquitetural do Clinni.

### 1.4 Análise por vertical/área (nichos)

O Clinni é profissão-neutro, então compete em cada vertical contra um especialista. Mapear o
preço e o modelo de cobrança de cada nicho é essencial para empacotar e posicionar:

| Vertical                        | Players de referência                                                                 | Faixa de preço         | Modelo de cobrança                                | Sensibilidade a preço                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Médico / multiespecialidade** | iClinic, Feegow, Amplimed, HiDoctor, ProDoctor                                        | R$ 89–299/prof         | **Por profissional**                              | Média; valoriza TISS, prontuário, financeiro                                                  |
| **Odontologia**                 | Simples Dental (R$ 137–321), Clinicorp (R$ 150+), Dental Office (R$ 40 mobile)        | R$ 137–349/**clínica** | **Por clínica** + add-ons pagos (NF, score, etc.) | Média-alta; valoriza orçamento, contratos, comissão, ortodontia                               |
| **Estética**                    | Iter (R$ 39+), Estetia (R$ 149–597), Belasis                                          | R$ 39–597              | Por clínica                                       | **Alta** — piso muito baixo; valoriza fotos antes/depois, pacotes, WhatsApp                   |
| **Psicologia / terapia**        | Clínica Ágil (R$ 199/3 usuários), ElloTools (R$ 49,90), PsicoManager, Psicoplanner    | R$ 49–199              | Por bundle de usuários                            | **Muito alta** — consultório solo, margem apertada; valoriza teleatendimento, evolução por IA |
| **Fisioterapia / Pilates**      | ZenFisio (R$ 79/179/439), Clinora (R$ 49,90/usuário), Simples Agenda (R$ 39,90)       | R$ 39–439              | Por usuário ou por clínica                        | Alta; valoriza sessões/pacotes, evolução, multiagenda                                         |
| **Veterinária**                 | SimplesVet (base + **módulos**: fiscal R$ 153, internação R$ 136), Vetus (R$ 200–250) | R$ 200–250 + módulos   | Por clínica + **add-ons**                         | Média; valoriza estoque, vacinas, internação, fiscal                                          |

**Conclusões por vertical:**

1. **O modelo de cobrança muda por vertical.** Médico → por profissional. Odonto, estética,
   fisio, vet → tendem a **por clínica** (o "profissional" frequentemente é o próprio dono). Um
   produto profissão-neutro precisa **suportar os dois modos** (já previsto no §3.1 com o plano
   flat) — é requisito competitivo, não luxo.
2. **A modularização é validada nos dois nichos mais maduros:** odonto (Simples Dental marca
   features com `*` = serviço pago à parte) e veterinária (SimplesVet vende fiscal e internação
   como módulos avulsos). É exatamente a arquitetura do Clinni → vantagem direta.
3. **Sensibilidade a preço é altíssima em psi, estética e fisio** (piso R$ 39–50). Não dá para
   atacar esses nichos com o preço médico cheio. Estratégia: **plano Essencial enxuto + flat
   Solo** capturam o consultório solo; o valor premium vem dos módulos (financeiro, TISS) que
   esses nichos solo geralmente não precisam — mantendo a margem onde ela existe (médico/odonto
   com convênio).
4. **Verticais carregam features-âncora distintas** que decidem a compra: odonto = orçamento +
   ortodontia + contratos; estética = fotos antes/depois + pacotes; fisio/psi = evolução de
   sessão + teleatendimento; vet = estoque + vacinas + internação. O Clinni cobre o tronco
   comum (agenda, prontuário, financeiro, TISS, prescrição); **lacunas de feature-âncora por
   vertical** são decisão de roadmap (ver §5.3 e §7).

---

## 2. O produto Clinni mapeado em módulos por área

A base de código já está organizada em áreas funcionais (seções da sidebar + feature flags +
specs). Esta é a matéria-prima do empacotamento:

| Área                             | Capacidades (specs)                                                                                                                                                   | Natureza                               | Onde monetiza              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------- |
| **Núcleo / Operação**            | Agenda/atendimentos (004,005,025), Pacientes (009), Prontuário + timeline + anamnese + sinais vitais (019), Tarefas (012), Agendamento público (017), Lembretes (018) | Table-stakes                           | Plano base                 |
| **Prescrição digital (Memed)**   | Memed integração + conformidade (026, 027)                                                                                                                            | Diferencial; **grátis para o médico**  | Núcleo (custo zero) ou Pro |
| **Financeiro & Repasse**         | Contas a pagar/receber, fluxo de caixa, despesas, impostos (011), repasse médico (023), comissões, relatórios, dashboard                                              | Alto valor de gestão                   | Tier intermediário         |
| **Faturamento TISS / Convênios** | Config por operadora, guias, lotes, glosas, XML assinado ICP-Brasil (029)                                                                                             | **Regulado (RN 501/2022), alto valor** | **Módulo avulso premium**  |
| **Portal do Paciente**           | Login CPF+nascimento, medições, acompanhamento (030, planejado)                                                                                                       | Experiência/retenção do paciente       | Módulo avulso              |
| **Integrações / CRM**            | Homio Marketplace OAuth, webhooks, captação (002, 008, 010)                                                                                                           | Marketing/captação                     | Módulo avulso ou topo      |
| **Multiunidade / Multi-tenant**  | Multi-clínica, claims, tenant ativo (010)                                                                                                                             | Escala                                 | Tier topo                  |

**Insight de empacotamento:** o Clinni já tem feature flags (`despesas`, `anamnese`,
`relatorios`, `comissoes`) e RBAC por papel — a infraestrutura técnica de "ligar/desligar
módulo por tenant" praticamente existe. O passo de produto é transformar flags binárias em
**entitlements por plano + add-on** (ver §6).

---

## 3. Estratégia de precificação recomendada

### 3.1 Modelo de cobrança

**Por profissional de saúde/mês, com recepção e admin gratuitos** — alinhado ao padrão de
mercado e à expectativa do comprador. Profissional de saúde = quem tem agenda/prontuário
próprios (médico, dentista, esteticista, fisio, psi).

> Oferecer **opção flat para consultório solo/pequeno** (1–2 profissionais) como "porta de
> entrada" simplificada, convertendo para por-profissional ao crescer — captura tanto o
> comprador sensível a previsibilidade (perfil Clínica nas Nuvens) quanto o que cresce.

### 3.2 Posicionamento

**Centro-premium, profissão-neutro e modular.** Não competir no piso (R$ 39–89 nicho/entrada),
onde a margem é destruída; ancorar valor em **prontuário sério + financeiro/repasse robusto +
TISS conforme + prescrição digital**, com entrada acessível (R$ 99) e teto (R$ 259) **abaixo**
do iClinic Premium (R$ 299). A modularidade é o diferencial: o cliente paga só pela área que usa.

---

## 4. Planos propostos

### 4.1 Três planos base (por profissional/mês)

|                                                                      | **Clinni Essencial**      | **Clinni Pro** ⭐      | **Clinni Clínica**        |
| -------------------------------------------------------------------- | ------------------------- | ---------------------- | ------------------------- |
| **Preço mensal**                                                     | **R$ 99**/prof            | **R$ 169**/prof        | **R$ 259**/prof           |
| **Preço anual** (~16% off / 2 meses grátis)                          | R$ 990/ano                | R$ 1.690/ano           | R$ 2.590/ano              |
| **Alvo**                                                             | Consultório solo / início | Clínica em crescimento | Multiespecialidade / rede |
| Agenda + atendimentos                                                | ✅                        | ✅                     | ✅                        |
| Pacientes + Prontuário + Anamnese                                    | ✅                        | ✅                     | ✅                        |
| Prescrição digital (Memed)                                           | ✅                        | ✅                     | ✅                        |
| Agendamento público                                                  | ✅                        | ✅                     | ✅                        |
| Lembretes (e-mail)                                                   | ✅                        | ✅                     | ✅                        |
| Lembretes/Confirmação **WhatsApp**                                   | —                         | ✅                     | ✅                        |
| Tarefas e notificações                                               | ✅                        | ✅                     | ✅                        |
| **Financeiro completo** (contas, fluxo de caixa, despesas, impostos) | —                         | ✅                     | ✅                        |
| **Repasse médico + Comissões**                                       | —                         | ✅                     | ✅                        |
| Relatórios + Dashboard                                               | básico                    | completo               | completo + BI             |
| **Multiunidade** (multi-clínica)                                     | —                         | —                      | ✅                        |
| Auditoria / logs avançados                                           | —                         | —                      | ✅                        |
| Suporte                                                              | padrão                    | prioritário            | dedicado                  |

⭐ **Pro é o plano-âncora** (o que a maioria deve escolher). O salto Essencial→Pro é justificado
por financeiro + repasse + WhatsApp — o coração da gestão de uma clínica com mais de um sócio.

### 4.2 Módulos à la carte (somados a qualquer plano)

| Módulo                                     | Preço sugerido                                           | Requisito  | Justificativa de preço                                                                                 |
| ------------------------------------------ | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| **Faturamento TISS / Convênios**           | **R$ 89/prof** ou **R$ 199/clínica** (flat)              | Pro+       | Regulado (RN 501/2022), XML assinado ICP-Brasil, alto valor, substitui faturista. Mercado já paywalla. |
| **Portal do Paciente**                     | **R$ 79/clínica**                                        | qualquer   | Diferencial de retenção; custo por clínica, não por prof.                                              |
| **Telemedicina**                           | **R$ 39/prof** (pacote) ou por uso                       | qualquer   | Padrão de mercado (iClinic R$ 35/10 consultas).                                                        |
| **Integrações / CRM (Homio)**              | **a partir de R$ 156/clínica** ou **incluso no Clínica** | Pro+       | Captação/marketing; valor de receita incremental para a clínica.                                       |
| **Certificado / assinatura ICP-Brasil A1** | repasse de custo + R$ 0 de markup                        | TISS/Memed | Não monetizar — reduzir atrito de adoção do TISS.                                                      |

> **Prescrição Memed fica no núcleo** (custo zero — a Memed é gratuita para o prescritor) como
> diferencial competitivo: o iClinic só dá prescrição eletrônica a partir do Starter, e
> oferecê-la já no Essencial é argumento de aquisição.

### 4.3 Camada de entrada e teste

- **Trial de 14 dias** do plano Pro (sem cartão) — reduz CAC e atrito; padrão Amplimed/iClinic.
- **Plano Solo flat opcional:** R$ 149/mês para 1 profissional com o pacote Essencial + WhatsApp
  — captura o consultório individual sensível a previsibilidade, com upgrade natural para Pro.
- **Sem taxa de instalação e sem fidelidade no mensal** — replicar o diferencial de marca do
  iClinic contra Shosp/Clínica nas Nuvens (que travam 12 meses).

---

## 5. Racional financeiro e de negócio

### 5.1 Por que este desenho

- **Land-and-expand:** entrada barata (R$ 99) + expansão por módulos (TISS, Portal, CRM)
  aumenta o **ARPA (receita média por conta)** sem aumentar CAC. Uma clínica de 4 profissionais
  no Pro + TISS por clínica = R$ 169×4 + R$ 199 = **R$ 875/mês**, com margem de expansão clara.
- **TISS como motor de receita:** é o módulo de maior disposição a pagar (obrigatório,
  trabalhoso de fazer à mão, risco de glosa). Precificar por profissional captura clínicas
  grandes; o flat por clínica (R$ 199) protege a venda em consultórios menores.
- **Anual melhora caixa e churn:** desconto de ~16% (2 meses) é payback rápido e padrão de
  mercado; recomenda-se meta de ≥ 40% da base no anual.
- **Profissão-neutro = TAM maior:** ao não nichar (decisão de marca já registrada), o Clinni
  endereça médico + odonto + estética + fisio + psi. O empacotamento modular permite "ligar"
  só o que cada vertical usa (estética não precisa de TISS; convênio precisa muito).

### 5.2 Indicadores a instrumentar (sugestão de metas iniciais)

| Métrica            | Definição                   | Meta de referência         |
| ------------------ | --------------------------- | -------------------------- |
| ARPA               | Receita média por conta/mês | ≥ R$ 600 (Pro + 1 módulo)  |
| Mix de plano       | % em Pro (âncora)           | ≥ 55%                      |
| Anexação de módulo | % de contas com ≥ 1 add-on  | ≥ 35% (TISS sendo o líder) |
| Trial→pago         | conversão                   | ≥ 25%                      |
| Churn mensal       | logo churn                  | ≤ 2,5%                     |
| LTV/CAC            | razão                       | ≥ 3×                       |
| % receita anual    | base em contrato anual      | ≥ 40%                      |

> CAC/LTV exatos dependem do canal de aquisição (a landing usa CTA WhatsApp, sem funil pago
> ainda). Recomenda-se medir desde o primeiro mês para calibrar os preços acima.

### 5.3 Riscos e mitigações

- **Guerra de preço no piso** (Iter R$ 39, Ninsaúde R$ 79): **não competir lá**; ancorar em
  prontuário+financeiro+TISS. O plano Solo (R$ 149) cobre o consultório sensível a preço sem
  canibalizar o Pro.
- **TISS é obrigatório e regulado:** atraso/erro de versão (hoje 04.03.00, prazo 30/06/2026)
  vira risco contratual. Vender TISS exige SLA de atualização — usar como diferencial, não
  passivo.
- **Percepção de "preço que dobra com add-ons"** (crítica feita à Amplimed): comunicar
  preço-total transparente no checkout; oferecer o módulo TISS embutido no plano Clínica para
  quem quer tudo incluído.
- **Flat vs por-profissional:** clínicas grandes podem achar o por-profissional caro acima de
  ~8 profissionais → ter **tabela negociada/teto** acima de N profissionais (padrão iClinic/Shosp
  "consulte para 10+").
- **Concorrência verticalizada:** em cada nicho há um especialista com features-âncora que o
  Clinni ainda não tem (orçamento/ortodontia em odonto, fotos antes/depois em estética, evolução
  de sessão em fisio/psi, internação/vacinas em vet). **Mitigação:** focar a aquisição inicial
  nas verticais onde o tronco comum (agenda + prontuário + **financeiro/repasse + TISS +
  prescrição**) já é decisivo — **médico, multiespecialidade e odonto com convênio** — e tratar
  features-âncora dos demais nichos como módulos de roadmap, não pré-requisito de lançamento.
- **Sensibilidade a preço por nicho:** psi/estética/fisio solo têm piso de R$ 39–50; vender o
  preço médico cheio ali gera atrito. O plano **Solo flat** e o **Essencial enxuto** existem
  justamente para não perder esse comprador sem destruir a margem do Pro.

---

## 6. Implicações de produto (para viabilizar os planos)

1. **Entitlements por plano + add-on:** evoluir `feature-flags.ts` (hoje 4 flags binárias
   globais por env) para **entitlements por tenant** (plano + módulos ativos), checados no RBAC
   e na sidebar. A infraestrutura de flag + RBAC + `tenant_integrations` já dá o esqueleto.
2. **Medição de "profissional de saúde ativo"** para faturar — derivar de `doctors`/
   `user_tenants` com papel `profissional_saude`.
3. **Billing/assinatura:** integrar um provedor (Stripe/Iugu/Asaas) com cobrança por seat +
   add-ons; webhook para suspender entitlement em inadimplência.
4. **Tela de planos in-app** (upsell contextual): quando o usuário clica em módulo não
   contratado (ex.: TISS), oferecer upgrade — converte intenção em receita.

---

## 7. Decisões que dependem de você

Estas escolhas mudam os números acima e são suas:

1. **Posicionamento de preço:** confirmar o centro-premium (entrada R$ 99 / topo R$ 259) ou
   mirar mais agressivo (entrada ~R$ 79) para ganhar volume.
2. **TISS por profissional vs flat por clínica** (ou ambos, como proposto).
3. **Plano flat Solo** (R$ 149) — incluir ou manter só por-profissional.
4. **Free vs Trial:** trial de 14 dias (recomendado) ou um free permanente limitado (estilo
   Feegow) para acelerar aquisição.
5. **Provedor de billing** a integrar (impacta roadmap técnico do §6).
6. **Verticais de foco no go-to-market:** concentrar aquisição em médico/odonto/multiespecialidade
   (onde o tronco comum já vende) ou investir desde já em features-âncora para entrar em
   estética/fisio/psi/vet (amplia o TAM, mas exige roadmap).

---

## Fontes

### Generalistas

- [iClinic — Planos e preços](https://iclinic.com.br/precos/) · [iClinic Premium](https://iclinic.com.br/premium/) · [iClinic — preço (suporte)](https://suporte.iclinic.com.br/pt-br/qual-o-preco-do-software-iclinic)
- [Feegow — Preços e Planos](https://feegowclinic.com.br/precos-e-planos) · [Feegow no GetApp](https://www.getapp.com/healthcare-pharmaceuticals-software/a/feegow/)
- [Amplimed — Planos e Recursos](https://www.amplimed.com.br/planos-e-recursos/) · [Amplimed — valor (blog)](https://www.amplimed.com.br/blog/valor-da-amplimed/)
- [Clínica nas Nuvens — Planos e Preços](https://clinicanasnuvens.com.br/planos-e-precos) · [plano único](https://clinicanasnuvens.com.br/blog/plano-unico-do-clinica-nas-nuvens/)
- [Shosp — Planos e Preços](https://www.shosp.com.br/precos)
- [Ninsaúde / Apolo](https://www.apolo.app/pt-br/)
- [HiDoctor — Comprar/Preços](https://www.hidoctor.com.br/p/comprar/) · [ProDoctor — Preços](https://prodoctor.net/precos/)
- [Doctoralia Pro — Preço](https://pro.doctoralia.com.br/preco) · [Doctoralia Pro — Clínicas](https://pro.doctoralia.com.br/preco/clinicas)

### Verticais / nichos

- **Odontologia:** [Simples Dental — Planos e Preços](https://www.simplesdental.com/planos-e-precos) · [Clinicorp — preço](https://www.clinicorp.com/post/software-odontologico-preco-mercado)
- **Estética:** [Iter Clinic](https://www.iterclinic.com/blog/os-6-melhores-sistemas-de-gestao-para-clinica-estetica-no-brasil-testados-em-2026) · [Estetia CRM](https://estetiacrm.com.br/pricing) · [Belasis](https://www.belasis.com.br/sistema-para-clinica-de-estetica)
- **Psicologia:** [Clínica Ágil Psicologia](https://clinicaagilpsicologia.com.br/) · [PsicoManager](https://www.psicomanager.com.br/) · [GestorPsi](https://gestorpsi.com.br/)
- **Fisioterapia:** [ZenFisio](https://www.zenfisio.com/) · [Clinora](https://clinora.com.br/software-para-fisioterapia/) · [Simples Agenda](https://www.simplesagenda.com.br/site/software-para-clinica-de-fisioterapia)
- **Veterinária:** [SimplesVet — Preços](https://simples.vet/precos/) · [Vetus](https://vetus.com.br/new/) · [VetSoft](https://www.vetsoft.com.br/online/planos/)

### Comparativos e mercado

- [Cloudia — 15 softwares médicos](https://www.cloudia.com.br/8-melhores-softwares-medicos-do-mercado-2024/) · [App Health — comparativo](https://www.apphealth.com.br/comparativo-feegow-iclinic-amplimed-app-health)
- Tamanho de mercado: [Healthtechs do Brasil — mapa do ecossistema](https://engenhariabiomedica.com/artigos/healthtechs-mapa-brasil) · [Saúde digital no Brasil 2026 (Mercado Hoje/UAI)](https://mercadohoje.uai.com.br/2026/05/09/mercado-de-saude-digital-no-brasil-numeros-tendencias-e-oportunidades-para-2026/)
- Contexto regulatório TISS: RN 501/2022 (ANS), versão 04.03.00 — ver `specs/029-faturamento-tiss/`.
