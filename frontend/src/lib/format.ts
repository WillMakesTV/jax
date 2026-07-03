/** Number/duration formatters shared by the live-stream metric displays. */

const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const plain = new Intl.NumberFormat('en')

/** 1234 → "1.2K"; used where space is tight (cards, tiles). */
export function formatCompact(n: number): string {
  return compact.format(n)
}

/** 1234 → "1,234"; used in detail lists. */
export function formatNumber(n: number): string {
  return plain.format(n)
}

/** Milliseconds → "1h 23m 45s" (segments omitted when zero). */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Uptime since an RFC3339 timestamp, or "—" when absent/invalid. */
export function formatUptime(startedAt: string): string {
  if (!startedAt) return '—'
  const started = Date.parse(startedAt)
  if (Number.isNaN(started)) return '—'
  return formatDurationMs(Date.now() - started)
}

/** Kilobits per second → "2500 kbps" / "2.5 Mbps". */
export function formatKbps(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${Math.round(kbps)} kbps`
}

/** Bytes → "1.2 GB" style, for total data output. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

const dateFmt = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** RFC3339 timestamp → "Jun 28, 2026", or "" when invalid. */
export function formatDate(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '' : dateFmt.format(t)
}

const dateTimeFmt = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** RFC3339 timestamp → "Jun 28, 2026, 6:02 PM" (local time), or "" when invalid. */
export function formatDateTime(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '' : dateTimeFmt.format(t)
}

/** RFC3339 timestamp → "just now" / "12 min ago" / "3 h ago", or "" when invalid. */
export function formatAgo(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const mins = Math.floor((Date.now() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return formatDate(iso)
}

/** Skipped/total frame pair → "12 (0.4%)". */
export function formatFrameDrops(skipped: number, total: number): string {
  if (!total) return '0'
  const pct = ((skipped / total) * 100).toFixed(1)
  return `${plain.format(skipped)} (${pct}%)`
}
