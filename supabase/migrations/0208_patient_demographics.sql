-- ---------------------------------------------------------------------------
-- Estado civil, raça/cor e ocupação do paciente.
--
-- Três dados que toda ficha de clínica coleta e que o cadastro não tinha. A
-- falta apareceu ao importar uma base de 15 mil pacientes vinda do HiDoctor:
-- as três colunas existiam na origem e não tinham para onde ir.
--
-- COLUNA EM CLARO, NÃO `_enc` — a linha que este projeto traça para cifrar é
-- re-identificação (nome, CPF, RG, telefone, e-mail, nascimento, endereço).
-- Estes três não apontam para ninguém sozinhos; ganham sujeito só depois que o
-- nome é decifrado. Mesmo tratamento de `sex` (0107) e `alert_note`.
--
-- E, no caso de raça/cor, cifrar custaria a razão de coletar: é o recorte que
-- e-SUS e relatório de equidade pedem AGREGADO. Cifrada, a coluna existiria
-- sem poder ser contada.
--
-- Ficam de fora do RPC `get_patient_for_tenant` (0027) de propósito: ele é o
-- caminho da PII cifrada. Estas colunas são lidas pelo mesmo SELECT em claro
-- que já busca `status`, `alert_note` e `plan_id` — sem tocar na assinatura de
-- uma função que meia dúzia de telas chama.
-- ---------------------------------------------------------------------------

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS marital_status TEXT,
  ADD COLUMN IF NOT EXISTS race           TEXT,
  ADD COLUMN IF NOT EXISTS occupation     TEXT;

-- Lista fechada nas duas primeiras. Sem o CHECK, cada importação inventaria a
-- própria grafia ("Casado(a)", "CASADO", "casado") e o agrupamento por estado
-- civil viraria contagem de erros de digitação.
ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_marital_status_check;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_marital_status_check
  CHECK (marital_status IS NULL OR marital_status IN (
    'solteiro', 'casado', 'uniao_estavel', 'divorciado', 'separado', 'viuvo'
  ));

-- Categorias do IBGE, que são as mesmas do e-SUS. Não é preferência de
-- vocabulário: é o formato em que o dado precisa sair quando for reportado.
ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_race_check;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_race_check
  CHECK (race IS NULL OR race IN (
    'branca', 'preta', 'parda', 'amarela', 'indigena'
  ));

-- Ocupação é texto livre: não existe lista fechada que sirva a toda clínica.
-- O teto é para conter colagem acidental de parágrafo inteiro, não para
-- classificar nada.
ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_occupation_length_check;
ALTER TABLE public.patients
  ADD CONSTRAINT patients_occupation_length_check
  CHECK (occupation IS NULL OR char_length(occupation) <= 120);

COMMENT ON COLUMN public.patients.marital_status IS
  'Estado civil (lista fechada). Em claro: não re-identifica sozinho, e serve para recorte agregado.';
COMMENT ON COLUMN public.patients.race IS
  'Raça/cor AUTODECLARADA, categorias IBGE/e-SUS. Em claro porque o uso legítimo é agregado. Nunca inferir a partir de foto, nome ou endereço — o dado só é válido como o paciente declara.';
COMMENT ON COLUMN public.patients.occupation IS
  'Ocupação declarada, texto livre (até 120 caracteres).';

-- Índices só onde há recorte agregado a fazer. `occupation` é texto livre e
-- alta cardinalidade: índice ali pagaria escrita em todo cadastro para servir
-- uma consulta que ninguém faz.
CREATE INDEX IF NOT EXISTS patients_tenant_race_idx
  ON public.patients (tenant_id, race) WHERE race IS NOT NULL;
CREATE INDEX IF NOT EXISTS patients_tenant_marital_status_idx
  ON public.patients (tenant_id, marital_status) WHERE marital_status IS NOT NULL;

-- RLS: nenhuma policy nova. As policies de `patients` são por linha
-- (tenant_id), não por coluna — coluna nova entra coberta pelo que já existe.
-- O trigger `patients_audit` (0013) também já registra a mudança sem tocar em
-- valor, porque audita QUAL campo mudou, nunca o conteúdo.
