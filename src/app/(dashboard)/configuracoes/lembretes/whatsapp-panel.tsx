'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { AlertTriangle, Check, Loader2, QrCode, Send, Smartphone, Unplug } from 'lucide-react'
import {
  connectWhatsApp,
  disconnectWhatsApp,
  refreshConnection,
  sendTestWhatsApp,
} from './whatsapp-actions'
import type { WhatsAppConnection } from '@/lib/core/whatsapp/types'

interface Props {
  initial: WhatsAppConnection | null
}

/** Enquanto o QR está na tela, perguntamos ao serviço se já foi escaneado. */
const POLL_MS = 4000
/** Um QR da Evolution expira em ~1 min; depois disso insistir só gasta chamada. */
const POLL_TIMEOUT_MS = 90_000

export function ConnectionPanel({ initial }: Props) {
  const [connection, setConnection] = useState<WhatsAppConnection | null>(initial)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const pollStartedAt = useRef<number | null>(null)

  const status = connection?.status ?? 'disconnected'
  const isConnecting = status === 'connecting'

  const poll = useCallback(async () => {
    const res = await refreshConnection()
    if (res.ok) setConnection(res.connection)
  }, [])

  // Polling só enquanto está conectando — parado é parado, não gasta chamada.
  useEffect(() => {
    if (!isConnecting) {
      pollStartedAt.current = null
      return
    }
    pollStartedAt.current ??= Date.now()
    const id = setInterval(() => {
      if (Date.now() - (pollStartedAt.current ?? 0) > POLL_TIMEOUT_MS) {
        clearInterval(id)
        setQrCode(null)
        setError('O QR Code expirou. Clique em "Gerar novo QR Code" para tentar de novo.')
        return
      }
      void poll()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [isConnecting, poll])

  // Conectou: some com o QR, que já não serve pra nada.
  useEffect(() => {
    if (status === 'connected') setQrCode(null)
  }, [status])

  function onConnect() {
    setError(null)
    setQrCode(null)
    startTransition(async () => {
      const res = await connectWhatsApp()
      if (!res.ok) {
        setError(
          res.error === 'NOT_CONFIGURED'
            ? 'O serviço de WhatsApp não está configurado. Fale com o suporte.'
            : 'Não foi possível iniciar a conexão. Tente de novo em alguns instantes.',
        )
        return
      }
      setQrCode(res.qrCode)
      if (!res.qrCode) {
        setError('O serviço não devolveu o QR Code. Clique em "Gerar novo QR Code".')
      }
      await poll()
    })
  }

  function onDisconnect() {
    if (!confirm('Desconectar o WhatsApp da clínica? Os lembretes por WhatsApp param de sair.')) {
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await disconnectWhatsApp()
      if (!res.ok) {
        setError('Não foi possível desconectar. Tente de novo.')
        return
      }
      setConnection(null)
      setQrCode(null)
    })
  }

  return (
    <div className="space-y-6">
      <StatusCard connection={connection} />

      {/* FR-012a — bloqueio é diferente de queda comum, e a ação da clínica é outra. */}
      {connection?.disconnectReason === 'blocked' && <BlockedWarning />}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {status !== 'connected' && (
          <button
            onClick={onConnect}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-strong px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <QrCode className="h-4 w-4" />
            )}
            {connection ? 'Gerar novo QR Code' : 'Conectar WhatsApp'}
          </button>
        )}
        {connection && (
          <button
            onClick={onDisconnect}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            <Unplug className="h-4 w-4" />
            Desconectar
          </button>
        )}
      </div>

      {qrCode && <QrPanel qrCode={qrCode} />}

      {status === 'connected' && <TestSendCard />}
    </div>
  )
}

/**
 * Envio de teste. Só aparece com a conexão de pé — oferecer o botão desconectado
 * seria convidar o admin a um erro que ele não pode resolver ali.
 *
 * O número é digitado, e não herdado do que está conectado: mandar para si mesmo
 * prova que a instância aceita a chamada, mas não que a mensagem SAI e chega em
 * outro aparelho, que é o que a clínica quer saber antes do primeiro paciente.
 */
function TestSendCard() {
  const [phone, setPhone] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSend() {
    setError(null)
    setSentTo(null)
    startTransition(async () => {
      const res = await sendTestWhatsApp(phone)
      if (res.ok) {
        setSentTo(res.to)
        return
      }
      setError(
        {
          INVALID_PHONE: 'Número inválido. Use DDD + número, como (11) 98888-7777.',
          NO_CONNECTION:
            'O WhatsApp aparece como conectado aqui, mas o serviço diz que não está. Gere um QR Code novo.',
          NOT_CONFIGURED: 'O serviço de WhatsApp não está configurado. Fale com o suporte.',
          UNAUTHORIZED: 'Você não tem permissão para enviar testes.',
          SEND_FAILED: 'O serviço recusou o envio. Tente de novo em alguns instantes.',
          SEND_TIMEOUT:
            'A confirmação não voltou a tempo. A mensagem pode ter saído mesmo assim — confira o aparelho antes de enviar de novo.',
          INTERNAL_ERROR: 'Não foi possível enviar. Tente de novo.',
        }[res.error],
      )
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-semibold text-slate-900">Enviar uma mensagem de teste</p>
      <p className="mt-1 text-sm text-slate-500">
        Confere a conexão na hora, sem esperar o próximo lembrete. O texto é fixo e avisa que é
        teste — não vai para paciente nenhum.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(11) 98888-7777"
          aria-label="Número que vai receber o teste"
          className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={onSend}
          disabled={pending || phone.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-strong px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar teste
        </button>
      </div>

      {sentTo && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700">
          <Check className="h-4 w-4" />
          Enviado para {sentTo}. Confira o aparelho — pode levar alguns segundos.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  )
}

function StatusCard({ connection }: { connection: WhatsAppConnection | null }) {
  const status = connection?.status ?? 'disconnected'
  const meta = {
    connected: { dot: 'bg-emerald-500', label: 'Conectado', tone: 'text-emerald-700' },
    connecting: {
      dot: 'bg-amber-500 animate-pulse',
      label: 'Aguardando leitura do QR',
      tone: 'text-amber-700',
    },
    disconnected: { dot: 'bg-slate-400', label: 'Desconectado', tone: 'text-slate-600' },
  }[status]

  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="rounded-lg bg-slate-100 p-3">
        <Smartphone className="h-6 w-6 text-slate-600" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          <span className={`text-sm font-semibold ${meta.tone}`}>{meta.label}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {connection?.numberConnected
            ? `Número ${formatPhone(connection.numberConnected)}`
            : 'Nenhum número vinculado ainda.'}
        </p>
      </div>
    </div>
  )
}

/**
 * FR-012a. O canal NÃO é desligado automaticamente: um falso positivo faria os
 * lembretes pararem em silêncio, que é o pior desfecho possível numa feature
 * cujo valor é justamente avisar. A decisão fica com a clínica.
 */
function BlockedWarning() {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="text-sm text-red-800">
          <p className="font-semibold">Este número foi bloqueado pelo WhatsApp.</p>
          <p className="mt-1">
            Reconectar o mesmo número provavelmente não vai funcionar. O caminho é vincular outro
            número — de preferência um que já tenha conversas reais com pacientes, e não um chip
            novo, que é o perfil mais sujeito a bloqueio.
          </p>
          <p className="mt-2">
            Os lembretes por WhatsApp continuam ligados e vão falhar até você resolver. Se preferir
            parar de tentar agora, desative o canal em Lembretes automáticos.
          </p>
        </div>
      </div>
    </div>
  )
}

function QrPanel({ qrCode }: { qrCode: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <p className="text-sm font-semibold text-slate-900">Escaneie com o WhatsApp da clínica</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        No celular:{' '}
        <strong>WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho</strong>. O
        código expira em cerca de um minuto.
      </p>
      <div className="mt-4 inline-block rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
        {/* eslint-disable-next-line @next/next/no-img-element -- base64 vindo do serviço, não é asset local */}
        <img src={qrCode} alt="QR Code para conectar o WhatsApp" width={256} height={256} />
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Esperando você escanear…
      </p>
    </div>
  )
}

/** 5511999998888 → (11) 99999-8888. Só formatação, sem validar. */
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return raw
}
