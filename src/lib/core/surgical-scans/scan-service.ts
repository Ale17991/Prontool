import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ValidationError } from '@/lib/observability/errors'
import { parseBarcode, type BarcodeFormat, type ParsedBarcode } from './barcode-parser'

export interface ScanRow {
  id: string
  rawBarcode: string
  barcodeFormat: BarcodeFormat
  gtin: string | null
  lotNumber: string | null
  expirationDate: string | null
  serialNumber: string | null
  manufacturer: string | null
  status: 'confirmed' | 'rejected' | 'expired'
  rejectionReason: string | null
  materialId: string | null
  scannedAt: string
}

export interface ScanResult {
  ok: boolean
  /** Status final ('confirmed'/'expired') ou 'duplicate' quando já existia. */
  status: 'confirmed' | 'expired' | 'duplicate'
  /** Vinculou a um material previsto do atendimento. */
  matched: boolean
  parsed: ParsedBarcode
  reason?: string
}

function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${iso}T00:00:00`)
  return d.getTime() < today.getTime()
}

/**
 * Tenta vincular o scan a um material previsto do atendimento. Hoje
 * appointment_materials guarda TUSS (sem GTIN/lote), então o match efetivo é
 * raro — o scan é registrado com os dados GS1 mesmo sem vínculo ("não previsto").
 */
async function matchMaterial(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentId: string,
  parsed: ParsedBarcode,
): Promise<string | null> {
  if (!parsed.gtin) return null
  const { data } = await supabase
    .from('appointment_materials' as never)
    .select('id, tuss_code')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
  for (const m of (data ?? []) as unknown as Array<{ id: string; tuss_code: string | null }>) {
    if (m.tuss_code && parsed.gtin && m.tuss_code === parsed.gtin) return m.id
  }
  return null
}

export async function registerScan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentId: string,
  rawBarcode: string,
  scannedBy: string,
): Promise<ScanResult> {
  const raw = rawBarcode.trim()
  if (!raw) throw new ValidationError('Código vazio.')
  const parsed = parseBarcode(raw)

  // Duplicado no mesmo atendimento.
  const dup = await supabase
    .from('surgical_material_scans' as never)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .eq('raw_barcode', raw)
    .maybeSingle()
  if (dup.data) {
    return { ok: false, status: 'duplicate', matched: false, parsed, reason: 'Material já escaneado neste atendimento.' }
  }

  const expired = isExpired(parsed.expiry ?? null)
  const status: 'confirmed' | 'expired' = expired ? 'expired' : 'confirmed'
  // Vencido = bloqueio hard: não vincula material.
  const materialId = expired ? null : await matchMaterial(supabase, tenantId, appointmentId, parsed)

  const { error } = await supabase.from('surgical_material_scans' as never).insert({
    tenant_id: tenantId,
    appointment_id: appointmentId,
    material_id: materialId,
    raw_barcode: raw,
    barcode_format: parsed.format,
    gtin: parsed.gtin ?? null,
    lot_number: parsed.lot ?? null,
    expiration_date: parsed.expiry ?? null,
    serial_number: parsed.serial ?? null,
    manufacturer: null,
    scanned_by: scannedBy,
    status,
    rejection_reason: expired ? 'Material vencido' : null,
  } as never)
  if (error) throw new Error(`registerScan failed: ${error.message}`)

  await auditScan(supabase, tenantId, appointmentId, scannedBy, status, raw)
  return {
    ok: status === 'confirmed',
    status,
    matched: materialId !== null,
    parsed,
    reason: expired ? 'Material vencido — não registrado como confirmado.' : undefined,
  }
}

export async function registerManualEntry(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentId: string,
  entry: { lot?: string | null; expiry?: string | null; manufacturer?: string | null; description?: string | null },
  scannedBy: string,
): Promise<ScanResult> {
  const expired = isExpired(entry.expiry ?? null)
  const status: 'confirmed' | 'expired' = expired ? 'expired' : 'confirmed'
  const raw = `MANUAL:${entry.manufacturer ?? ''}|${entry.lot ?? ''}|${entry.expiry ?? ''}|${entry.description ?? ''}`.slice(0, 200)

  const { error } = await supabase.from('surgical_material_scans' as never).insert({
    tenant_id: tenantId,
    appointment_id: appointmentId,
    material_id: null,
    raw_barcode: raw,
    barcode_format: 'manual',
    gtin: null,
    lot_number: entry.lot?.trim() || null,
    expiration_date: entry.expiry || null,
    serial_number: null,
    manufacturer: entry.manufacturer?.trim() || null,
    scanned_by: scannedBy,
    status,
    rejection_reason: expired ? 'Material vencido' : null,
  } as never)
  if (error) throw new Error(`registerManualEntry failed: ${error.message}`)

  await auditScan(supabase, tenantId, appointmentId, scannedBy, status, raw)
  return { ok: status === 'confirmed', status, matched: false, parsed: { format: 'manual' } }
}

export async function listScans(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentId: string,
): Promise<ScanRow[]> {
  const { data, error } = await supabase
    .from('surgical_material_scans' as never)
    .select(
      'id, raw_barcode, barcode_format, gtin, lot_number, expiration_date, serial_number, manufacturer, status, rejection_reason, material_id, scanned_at',
    )
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .order('scanned_at', { ascending: false })
  if (error) throw new Error(`listScans failed: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    rawBarcode: r.raw_barcode as string,
    barcodeFormat: r.barcode_format as BarcodeFormat,
    gtin: (r.gtin as string | null) ?? null,
    lotNumber: (r.lot_number as string | null) ?? null,
    expirationDate: (r.expiration_date as string | null) ?? null,
    serialNumber: (r.serial_number as string | null) ?? null,
    manufacturer: (r.manufacturer as string | null) ?? null,
    status: r.status as ScanRow['status'],
    rejectionReason: (r.rejection_reason as string | null) ?? null,
    materialId: (r.material_id as string | null) ?? null,
    scannedAt: r.scanned_at as string,
  }))
}

async function auditScan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  appointmentId: string,
  actorUserId: string,
  status: string,
  raw: string,
) {
  await supabase.from('audit_log').insert({
    tenant_id: tenantId,
    actor_id: actorUserId,
    actor_label: null,
    entity: 'surgical_material_scans',
    entity_id: appointmentId,
    field: 'scan',
    old_value: null,
    new_value: status,
    reason: `scan de material (${raw.slice(0, 60)})`,
    result: 'success',
  } as never)
}
