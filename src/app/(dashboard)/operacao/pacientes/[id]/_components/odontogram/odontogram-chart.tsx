'use client'

import { quadrantLayout, type Dentition, type Surface } from '@/lib/core/dental/teeth'
import { Tooth, type FaceMark } from './tooth'

interface Props {
  dentition: Dentition
  faceMarksByTooth: Record<number, Partial<Record<Surface, FaceMark>>>
  toothMarkByTooth: Record<number, FaceMark | null>
  onClickFace: (toothFdi: number, surface: Surface) => void
  onClickTooth: (toothFdi: number) => void
  onInspect: (toothFdi: number) => void
  disabled?: boolean
}

/** Mesial aponta para a linha média: quadrantes de exibição à esquerda (1,4)
 *  apontam à direita; à direita (2,3) apontam à esquerda. */
function mesialSideOf(quadrant: number): 'left' | 'right' {
  return quadrant === 1 || quadrant === 4 ? 'right' : 'left'
}

export function OdontogramChart({
  dentition,
  faceMarksByTooth,
  toothMarkByTooth,
  onClickFace,
  onClickTooth,
  onInspect,
  disabled,
}: Props) {
  const layout = quadrantLayout(dentition)
  const topRow = layout.slice(0, 2) // [Q1, Q2]
  const bottomRow = layout.slice(2, 4) // [Q4, Q3]

  const renderQuadrant = (quadrant: number, teeth: number[]) => (
    <div key={quadrant} className="flex gap-1">
      {teeth.map((toothFdi) => (
        <Tooth
          key={toothFdi}
          toothFdi={toothFdi}
          faceMarks={faceMarksByTooth[toothFdi] ?? {}}
          toothMark={toothMarkByTooth[toothFdi] ?? null}
          mesialSide={mesialSideOf(quadrant)}
          onClickFace={(surface) => onClickFace(toothFdi, surface)}
          onClickTooth={() => onClickTooth(toothFdi)}
          onInspect={() => onInspect(toothFdi)}
          disabled={disabled}
        />
      ))}
    </div>
  )

  return (
    <div className="inline-flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-end gap-4 border-b border-dashed border-slate-200 pb-3">
        {topRow.map((q) => renderQuadrant(q.quadrant, q.teeth))}
      </div>
      <div className="flex items-start gap-4">
        {bottomRow.map((q) => renderQuadrant(q.quadrant, q.teeth))}
      </div>
    </div>
  )
}
