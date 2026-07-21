import {Layers, Plus, Trash2} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  DeleteInspirationType,
  GetInspirationChannels,
  GetInspirationTypes,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Modal} from '../components/Modal'
import {PageHeader} from '../components/PageHeader'
import {useDataChanged} from '../lib/dataChanged'
import {inspirationError} from './Inspiration'

/**
 * The lenses the library studies channels through. A type's brief steers what
 * the takeaway pass looks for in the videos of every channel tagged with it —
 * see the "Inspiration types" skill.
 */
export function InspirationTypes({
  onOpenType,
}: {
  /** Open one type's page; null starts a new one. */
  onOpenType: (type: main.InspirationType | null) => void
}) {
  const [types, setTypes] = useState<main.InspirationType[]>([])
  const [channels, setChannels] = useState<main.InspirationChannel[]>([])

  const load = useCallback(() => {
    GetInspirationTypes()
      .then((t) => setTypes(t ?? []))
      .catch(() => {})
    GetInspirationChannels()
      .then((c) => setChannels(c ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  useDataChanged(['inspiration_types', 'inspiration'], load)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        description="What a source channel is studied for. Tagging a channel with a type steers what its videos are mined for."
        actions={
          <button
            type="button"
            onClick={() => onOpenType(null)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            <Plus size={14} aria-hidden />
            Add a type
          </button>
        }
      />

      {types.length === 0 ? (
        <p className="rounded-xl border border-dashed border-edge bg-surface p-6 text-sm text-fg-muted">
          No types yet. Add one to say what a channel is worth studying for.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => (
            <TypeCard
              key={t.id}
              type={t}
              channels={channels.filter((c) => c.typeIds.includes(t.id))}
              onOpen={() => onOpenType(t)}
              onDeleted={load}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function TypeCard({
  type,
  channels,
  onOpen,
  onDeleted,
}: {
  type: main.InspirationType
  channels: main.InspirationChannel[]
  onOpen: () => void
  onDeleted: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await DeleteInspirationType(type.id)
      setConfirm(false)
      onDeleted()
    } catch (err) {
      setError(inspirationError(err, 'That type could not be removed.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="group flex h-full cursor-pointer flex-col gap-2 rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
      >
        <div className="flex min-w-0 items-start gap-2">
          <Layers
            size={16}
            aria-hidden
            className="mt-0.5 shrink-0 text-accent"
          />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
            {type.name}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setConfirm(true)
            }}
            title="Remove this type…"
            aria-label="Remove this type"
            className="shrink-0 text-fg-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
        {type.summary && (
          <p className="line-clamp-2 text-sm text-fg-muted">{type.summary}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <span className="rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
            {channels.length} {channels.length === 1 ? 'channel' : 'channels'}
          </span>
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Are you sure?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Removing “{type.name}” untags every channel using it. The channels
            and their studied videos stay.
          </p>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Remove type
            </button>
          </div>
        </div>
      </Modal>
    </li>
  )
}
