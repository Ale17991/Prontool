'use client'

import { isAnterior, isUpperTooth, surfaceLabel, type Surface } from '@/lib/core/dental/teeth'

export interface FaceMark {
  color: string
  label: string
  code: string
}

interface Props {
  toothFdi: number
  /** Cor/rótulo por face (status de escopo face vigente). */
  faceMarks: Partial<Record<Surface, FaceMark>>
  /** Status de escopo dente vigente (code != 'none'); precede as faces (C2). */
  toothMark: FaceMark | null
  /** Lado para onde aponta a face mesial (em direção à linha média). */
  mesialSide: 'left' | 'right'
  onClickFace: (surface: Surface) => void
  onClickTooth: () => void
  onInspect: () => void
  disabled?: boolean
}

const DEFAULT_FILL = '#ffffff'
const STROKE = '#94a3b8'

// Coroa: caixa 40x40 com retângulo central 16x16 (faces externas = trapézios).
const POLY = {
  vestibular: '0,0 40,0 28,12 12,12',
  lingual_palatal: '0,40 40,40 28,28 12,28',
  left: '0,0 12,12 12,28 0,40',
  right: '40,0 28,12 28,28 40,40',
} as const

// Geometria total (coroa + cervical + raiz). A raiz aponta para LONGE do plano
// oclusal: para cima nos dentes superiores, para baixo nos inferiores.
const CERVICAL_H = 7
const ROOT_H = 17
const TOTAL_H = 40 + CERVICAL_H + ROOT_H // 64

export function Tooth({
  toothFdi,
  faceMarks,
  toothMark,
  mesialSide,
  onClickFace,
  onClickTooth,
  onInspect,
  disabled,
}: Props) {
  const mesial: Surface = 'mesial'
  const distal: Surface = 'distal'
  const leftSurface = mesialSide === 'left' ? mesial : distal
  const rightSurface = mesialSide === 'left' ? distal : mesial

  const upper = isUpperTooth(toothFdi)
  const anterior = isAnterior(toothFdi)

  // Superior: raiz em cima → coroa empurrada para baixo. Inferior: coroa em cima.
  const crownY = upper ? ROOT_H + CERVICAL_H : 0
  const cervY = upper ? ROOT_H : 40
  const rootPoly = upper
    ? `10,${ROOT_H} 30,${ROOT_H} 24,2 16,2`
    : `10,${40 + CERVICAL_H} 30,${40 + CERVICAL_H} 24,${TOTAL_H - 2} 16,${TOTAL_H - 2}`

  const faceFill = (s: Surface) => faceMarks[s]?.color ?? DEFAULT_FILL
  const toothDimmed = toothMark !== null
  const dimStyle = { opacity: toothDimmed ? 0.35 : 1 }

  // Polígono/região clicável genérico (coroa usa coords relativas ao grupo).
  function region(surface: Surface, kind: 'polygon' | 'rect', geom: string | DOMRectInit) {
    const mark = faceMarks[surface]
    const common = {
      fill: faceFill(surface),
      stroke: STROKE,
      strokeWidth: 0.75,
      className: disabled ? '' : 'cursor-pointer',
      style: dimStyle,
      tabIndex: disabled ? -1 : 0,
      role: 'button' as const,
      'aria-label': `Dente ${toothFdi}, ${surfaceLabel(surface, toothFdi)}${mark ? `: ${mark.label}` : ''}`,
      onClick: (e: React.MouseEvent) => {
        if (disabled) return
        e.stopPropagation()
        onClickFace(surface)
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClickFace(surface)
        }
      },
    }
    if (kind === 'polygon') return <polygon points={geom as string} {...common} />
    const r = geom as { x: number; y: number; width: number; height: number }
    return <rect x={r.x} y={r.y} width={r.width} height={r.height} {...common} />
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        width={40}
        height={TOTAL_H}
        viewBox={`0 0 40 ${TOTAL_H}`}
        className="overflow-visible"
        aria-label={`Dente ${toothFdi}${toothMark ? `: ${toothMark.label}` : ''}`}
      >
        {/* Raiz (canal/endodontia) */}
        {region('raiz', 'polygon', rootPoly)}

        {/* Cervical (colo do dente) */}
        {region('cervical', 'rect', { x: 4, y: cervY, width: 32, height: CERVICAL_H })}

        {/* Coroa: 5 faces (deslocada conforme superior/inferior) */}
        <g transform={`translate(0, ${crownY})`}>
          {region('vestibular', 'polygon', POLY.vestibular)}
          {region('lingual_palatal', 'polygon', POLY.lingual_palatal)}
          {region(leftSurface, 'polygon', POLY.left)}
          {region(rightSurface, 'polygon', POLY.right)}

          {/* Centro: oclusal (posterior, quadrado) ou incisal (anterior, faixa fina) */}
          {anterior
            ? region('occlusal_incisal', 'rect', { x: 9, y: 17, width: 22, height: 6 })
            : region('occlusal_incisal', 'rect', { x: 12, y: 12, width: 16, height: 16 })}
        </g>

        {/* Overlay de status de dente inteiro (precede faces). */}
        {toothMark ? (
          <g
            className={disabled ? '' : 'cursor-pointer'}
            role="button"
            aria-label={`Dente ${toothFdi}: ${toothMark.label}`}
            onClick={(e) => {
              if (disabled) return
              e.stopPropagation()
              onClickTooth()
            }}
          >
            <rect
              x={2}
              y={2}
              width={36}
              height={TOTAL_H - 4}
              fill="none"
              stroke={toothMark.color}
              strokeWidth={3}
              rx={3}
            />
            <line x1={6} y1={6} x2={34} y2={TOTAL_H - 6} stroke={toothMark.color} strokeWidth={2.5} />
          </g>
        ) : null}
      </svg>
      <button
        type="button"
        onClick={onInspect}
        title={`Ver histórico do dente ${toothFdi}`}
        className="select-none text-[10px] font-medium text-slate-500 hover:text-slate-900 hover:underline"
      >
        {toothFdi}
      </button>
    </div>
  )
}
