import {ArrowLeft, Check} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState} from 'react'
import {GetContentSeries, SavePlannedStream} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {SERVICES} from '../services/services'
import {useServices} from '../services/ServicesProvider'

/** The platforms a stream can be broadcast to. */
const BROADCAST_SERVICES = SERVICES.filter(
  (s) => s.id === 'twitch' || s.id === 'youtube',
)

/**
 * The "Plan a stream" form on its own page: a title, description, and the
 * connected channels to broadcast to (all connected ones checked by default).
 */
export function PlanStream({
  onBack,
  onSaved,
}: {
  onBack: () => void
  /** Called after a plan is saved. */
  onSaved: () => void
}) {
  const {statuses} = useServices()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const svc of BROADCAST_SERVICES) {
      if (statuses[svc.id]?.connected) s.add(svc.id)
    }
    return s
  })
  const [series, setSeries] = useState<main.ContentSeries[]>([])
  const [seriesId, setSeriesId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    GetContentSeries()
      .then((s) => setSeries(s ?? []))
      .catch(() => {})
  }, [])

  const activeSeries = series.find((s) => s.id === seriesId)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    if (!title.trim()) {
      setError('Give your stream a title.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await SavePlannedStream(
        main.PlannedStream.createFrom({
          id: '',
          title: title.trim(),
          description: description.trim(),
          channels: [...selected],
          seriesId,
          createdAt: '',
        }),
      )
      onSaved()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the plan.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Broadcast
      </button>

      <div className="max-w-2xl">
        <p className="mb-6 text-sm text-fg-muted">
          Outline your next broadcast and choose where it goes out.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="flex flex-col gap-5"
        >
          <div>
            <label
              htmlFor="plan-title"
              className="mb-1.5 block text-sm font-medium text-fg"
            >
              Title
            </label>
            <input
              id="plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Episode 6 | Building the planner"
              autoFocus
              className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          {series.length > 0 && (
            <div>
              <label
                htmlFor="plan-series"
                className="mb-1.5 block text-sm font-medium text-fg"
              >
                Content series{' '}
                <span className="font-normal text-fg-muted">(optional)</span>
              </label>
              <select
                id="plan-series"
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="">None</option>
                {series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>

              {activeSeries && (
                <div className="mt-2 rounded-lg border border-edge bg-surface p-3 text-sm">
                  {activeSeries.category && (
                    <p className="text-xs font-medium text-fg-muted">
                      {activeSeries.category}
                    </p>
                  )}
                  {activeSeries.description && (
                    <p className="mt-1 text-fg-muted">
                      {activeSeries.description}
                    </p>
                  )}
                  {activeSeries.notes && (
                    <p className="mt-2 whitespace-pre-wrap text-fg">
                      {activeSeries.notes}
                    </p>
                  )}
                  {activeSeries.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activeSeries.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-md bg-surface-hover px-2 py-0.5 text-xs text-fg-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="plan-description"
              className="mb-1.5 block text-sm font-medium text-fg"
            >
              Description{' '}
              <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <textarea
              id="plan-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What's the plan for this stream?"
              className="w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-fg">
              Broadcast to
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {BROADCAST_SERVICES.map((svc) => {
                const connected = Boolean(statuses[svc.id]?.connected)
                const account = statuses[svc.id]?.account
                const checked = selected.has(svc.id)
                const Logo = svc.Icon
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => toggle(svc.id)}
                    disabled={!connected}
                    className={clsx(
                      'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      checked
                        ? 'border-accent/50 bg-accent/5'
                        : 'border-edge bg-surface hover:bg-surface-hover',
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{backgroundColor: svc.brand}}
                    >
                      <Logo size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">
                        {svc.name}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {connected
                          ? account || 'Connected'
                          : 'Not connected'}
                      </p>
                    </div>
                    <span
                      aria-hidden
                      className={clsx(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                        checked
                          ? 'border-accent bg-accent text-accent-fg'
                          : 'border-edge',
                      )}
                    >
                      {checked && <Check size={14} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save plan'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
