# Research — Impressos da consulta de nutrição

Decisões tomadas antes de escrever código, com o que foi verificado no
repositório e nas dependências.

---

## D1 — Reuso do que já existe, em vez de uma camada nova

**Decisão**: seguir o padrão dos 13 PDFs já existentes: componente em
`src/lib/core/**`, `renderToBuffer` do `@react-pdf/renderer`, `ClinicHeader`
compartilhado, rota `nodejs` devolvendo `application/pdf`.

**Verificado**: `@react-pdf/renderer` ^3.4.4 já está nas dependências e é usado
em prontuário, receituário, orçamento odontológico, etiqueta, exame oftalmológico,
relatórios financeiros e rótulo nutricional.

**Achado**: `src/lib/core/anamnesis/export-pdf.tsx` **existe e é código morto** —
exporta `AnamnesisPdfDocument` e nenhuma rota o importa. A US3 aproveita esse
componente em vez de escrever outro.

**Correção de levantamento**: a solicitação de exames foi listada como lacuna no
levantamento inicial e **não é**. Existe desde a migration `0149_exam_requests.sql`,
com CRUD, PDF e seção na ficha do paciente. Saiu do escopo.

**Alternativas descartadas**: gerar HTML e converter com navegador headless
(Puppeteer) — traria dependência pesada, cold-boot lento no Vercel e um binário
de Chromium; não se justifica quando já há renderer nativo em uso.

---

## D2 — Nenhum PDF recalcula nada

**Decisão**: os componentes de PDF recebem o **resultado já calculado** e apenas
formatam. Nenhum deles importa motor de cálculo diretamente.

**Racional**: é o risco número um da feature. Se o PDF recalcular, qualquer
divergência de arredondamento, de ordem de soma ou de versão de fórmula produz um
papel que não bate com a tela — e o paciente leva embora o número errado. Foi
exatamente o problema que a revisão de fórmulas de agosto acabou de resolver;
reintroduzi-lo pela porta da impressão seria autodestrutivo.

**Consequência de teste**: cada impresso tem um teste que gera o dado pela mesma
função da tela e compara com o que foi para o documento.

**Alternativas descartadas**: o PDF buscar do banco e calcular por conta própria
— mais "independente", e justamente por isso perigoso.

---

## D3 — A curva de crescimento é desenhada, não vira tabela

**Decisão**: desenhar as curvas com as primitivas SVG do próprio renderer.

**Verificado**: `@react-pdf/renderer` 3.4.4 exporta `Svg`, `Line`, `Path`,
`Circle`, `Polyline`, `Rect` e `G`. Confirmado por inspeção do módulo, não por
suposição.

**Racional**: `recharts` é React DOM e não renderiza dentro do PDF — era o risco
que motivou a pesquisa. Como as primitivas existem, a alternativa degradada
(imprimir uma tabela de percentis) fica desnecessária: a curva é justamente o que
a mãe entende à primeira vista, e uma tabela de números não substitui isso.

**Escopo do desenho**: eixo de idade, as bandas de percentil como polilinhas e os
pontos do paciente. Sem interatividade, sem tooltip.

**Alternativas descartadas**: renderizar o gráfico no cliente e mandar como
imagem — exigiria captura de canvas, sujeita a diferença entre navegadores, e
quebraria a geração pelo servidor.

---

## D4 — Dado ausente aparece como ausente

**Decisão**: campo sem dado sai como travessão simples ou em branco. Nunca zero,
nunca valor estimado.

**Racional**: é a mesma regra que o rótulo nutricional (052) já aplica, e pela
mesma razão: zero é uma afirmação ("não tem"), enquanto o branco é a ausência de
afirmação. Num documento entregue ao paciente, confundir os dois é declarar algo
que não se sabe.

---

## D5 — Onde o botão fica

**Decisão**: o botão de impressão fica **na tela onde o dado é produzido** —
plano alimentar na tela do plano, avaliação na tela de avaliação, exames e
orientações nas suas seções do prontuário.

**Racional**: um menu central de "Impressos" obrigaria a profissional a sair do
contexto, escolher o paciente de novo e lembrar o nome do documento. O fluxo real
é "terminei isto, quero entregar".

**Alternativas descartadas**: uma tela única de documentos — vira um segundo
lugar para manter e some do caminho de quem acabou de montar o plano.

---

## D6 — Emissão entra na auditoria, sem tabela nova

**Decisão**: registrar a emissão via `log_audit_event`, no padrão que o
prontuário e a solicitação de exames já usam.

**Racional**: documento entregue a paciente é evidência; saber quem emitiu e
quando é exigência razoável de prontuário e atende o Princípio II. Criar tabela
para isso seria duplicar o que a trilha já resolve.

**Não decidido aqui**: se o PDF deve ser arquivado como documento do paciente
(existe `patient_documents`). Fica de fora do v1 — arquivar cria cópia de dado
sensível em storage e merece decisão própria.

---

## D7 — Três colunas é o padrão, não configuração

**Decisão**: os impressos de evolução mostram **até três avaliações**, fixo.

**Racional**: é o número da planilha de referência, e nenhuma das conversas pediu
outra coisa. Tornar configurável antes de alguém pedir é complexidade especulativa;
o layout de três colunas também é o que cabe confortavelmente em retrato A4.

**Consequência**: com menos de três, imprime só as que existem. Coluna vazia
sugeriria histórico que não há.

---

## Pendências que o plano assume

- **Conferência com a nutricionista (SC-003)** contra a planilha, documento a
  documento. É validação humana e não se resolve em código — precisa ser
  agendada, e não deixada para o fim, que foi o que aconteceu da 046 à 052.
- **Envio automático** por WhatsApp ou e-mail depende da frente 051 e está fora
  do escopo declarado.
