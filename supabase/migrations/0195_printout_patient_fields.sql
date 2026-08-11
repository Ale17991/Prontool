-- 0195 — Quais dados do paciente aparecem nos impressos.
--
-- MOTIVO
-- ------
-- Hoje cada documento decide sozinho o que mostra do paciente, e decide errado
-- de dois jeitos opostos: os impressos da nutrição (054) mostram sempre nome,
-- nascimento, idade e sexo; pedido de exame, receita de óculos, orçamento
-- odontológico e laudo oftalmológico mostram SÓ o nome — nem receberiam mais,
-- porque a rota passa `patientName: string` e nada além.
--
-- Nenhum dos dois serve para toda clínica. Uma pede CPF no receituário porque a
-- farmácia exige; outra quer tirar o sexo do plano alimentar que o paciente
-- carrega na bolsa. É decisão da clínica, não do código.
--
-- DUAS COLUNAS, E A SEGUNDA NÃO É LUXO
-- ------------------------------------
-- `printout_patient_fields` é o padrão da casa. `printout_patient_field_overrides`
-- guarda o conjunto COMPLETO de campos de um documento específico — não um
-- acréscimo ao padrão. Acréscimo pareceria mais simples e seria pior: a clínica
-- que precisa mostrar MENOS num documento (o que o paciente leva embora) ficaria
-- sem saída, e reduzir PII em papel é justamente o caso que a LGPD favorece.
--
-- O preço do conjunto completo é que mudar o padrão depois não alcança o
-- documento personalizado. É um preço visível — a tela marca o documento como
-- personalizado e oferece voltar ao padrão — e melhor que o preço do contrário,
-- que seria uma regra de composição que ninguém consegue prever de cabeça.
--
-- O NOME NÃO ESTÁ NA LISTA
-- ------------------------
-- Não por esquecimento: não é configurável. Documento clínico que sai da clínica
-- sem nome não serve ao paciente nem ao arquivo, e a 054 já tinha fixado isso no
-- `PatientBlock` ("vai em TODA página, folhas soltas se separam"). Deixar
-- desligável seria oferecer um estado que ninguém deveria escolher.
--
-- A guia TISS fica fora do alcance destas colunas: o conteúdo dela é mandatório
-- pela ANS, e configurar o que é obrigatório convida glosa.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS printout_patient_fields TEXT[] NOT NULL
    DEFAULT ARRAY['nascimento', 'idade']::TEXT[],
  ADD COLUMN IF NOT EXISTS printout_patient_field_overrides JSONB NOT NULL
    DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.tenant_clinic_profile.printout_patient_fields IS
  'Campos do paciente exibidos no bloco de identificação dos impressos, fora o '
  'nome — que é sempre exibido e não entra nesta lista. O default reproduz o '
  'que a 054 já imprimia (nascimento e idade), menos o sexo: dado sensível que '
  'só deve sair em papel se a clínica pedir. Chaves válidas em '
  'src/lib/core/printouts/fields.ts.';

COMMENT ON COLUMN public.tenant_clinic_profile.printout_patient_field_overrides IS
  'Exceções por tipo de documento: { "receituario": ["cpf","endereco"] }. O '
  'array é o conjunto COMPLETO daquele documento, não um acréscimo ao padrão — '
  'é o que permite uma clínica mostrar MENOS num documento que o paciente leva '
  'embora. Documento ausente da chave usa o padrão.';

-- A validação das chaves é do lado da aplicação, não um CHECK: o catálogo de
-- campos e de documentos cresce a cada especialidade nova (a 054 sozinha trouxe
-- nove impressos), e um CHECK enumerado obrigaria migration a cada um deles. O
-- risco é baixo por construção — chave desconhecida no array simplesmente não
-- casa com nenhum campo do catálogo e não imprime nada, em vez de corromper o
-- documento.
