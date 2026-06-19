'use client'

import { surfaceLabel, type Surface } from '@/lib/core/dental/teeth'

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

// Geometria: caixa 40x40 com retângulo central 16x16 (faces externas = trapézios).
const POLY = {
  vestibular: '0,0 40,0 28,12 12,12',
  lingual_palatal: '0,40 40,40 28,28 12,28',
  left: '0,0 12,12 12,28 0,40',
  right: '40,0 28,12 28,28 40,40',
} as const

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

  const faceFill = (s: Surface) => faceMarks[s]?.color ?? DEFAULT_FILL
  const toothDimmed = toothMark !== null

  function face(surface: Surface, points: string) {
    const mark = faceMarks[surface]
    return (
      <polygon
        points={points}
        fill={faceFill(surface)}
        stroke={STROKE}
        strokeWidth={0.75}
        className={disabled ? '' : 'cursor-pointer'}
        style={{ opacity: toothDimmed ? 0.35 : 1 }}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label={`Dente ${toothFdi}, face ${surfaceLabel(surface, toothFdi)}${mark ? `: ${mark.label}` : ''}`}
        onClick={(e) => {
          if (disabled) return
          e.stopPropagation()
          onClickFace(surface)
        }}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClickFace(surface)
          }
        }}
      />
    )
  }

  const centerMark = faceMarks.occlusal_incisal

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        width={40}
        height={40}
        viewBox="0 0 40 40"
        className="overflow-visible"
        aria-label={`Dente ${toothFdi}${toothMark ? `: ${toothMark.label}` : ''}`}
      >
        {face('vestibular', POLY.vestibular)}
        {face('lingual_palatal', POLY.lingual_palatal)}
        {face(leftSurface, POLY.left)}
        {face(rightSurface, POLY.right)}

        {/* Centro: face oclusal/incisal */}
        <rect
          x={12}
          y={12}
          width={16}
          height={16}
          fill={centerMark?.color ?? DEFAULT_FILL}
          stroke={STROKE}
          strokeWidth={0.75}
          className={disabled ? '' : 'cursor-pointer'}
          style={{ opacity: toothDimmed ? 0.35 : 1 }}
          tabIndex={disabled ? -1 : 0}
          role="button"
          aria-label={`Dente ${toothFdi}, face ${surfaceLabel('occlusal_incisal', toothFdi)}${centerMark ? `: ${centerMark.label}` : ''}`}
          onClick={(e) => {
            if (disabled) return
            e.stopPropagation()
            onClickFace('occlusal_incisal')
          }}
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onClickFace('occlusal_incisal')
            }
          }}
        />

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
            <rect x={2} y={2} width={36} height={36} fill="none" stroke={toothMark.color} strokeWidth={3} rx={3} />
            <line x1={6} y1={6} x2={34} y2={34} stroke={toothMark.color} strokeWidth={2.5} />
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
