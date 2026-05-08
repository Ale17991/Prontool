/**
 * Sniff de tipo de imagem por magic bytes — defesa contra upload de arquivo
 * arbitrário renomeado para .jpg/.png. Confia apenas no conteúdo binário,
 * não na extensão nem no `Content-Type` declarado.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPG_SIGNATURE = [0xff, 0xd8, 0xff] as const

export type ImageType = 'jpg' | 'png'

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false
  }
  return true
}

/**
 * Lê os primeiros 16 bytes (suficiente para JPG/PNG) e retorna o tipo
 * detectado, ou null se não bater com nenhuma assinatura conhecida.
 */
export function sniffImageType(buffer: ArrayBuffer | Uint8Array): ImageType | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png'
  if (startsWith(bytes, JPG_SIGNATURE)) return 'jpg'
  return null
}
