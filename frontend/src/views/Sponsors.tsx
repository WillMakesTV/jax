import {Handshake, Megaphone, Paperclip, Plus, Trash2} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {DeleteSponsor, GetSponsors} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Markdown} from '../components/markdown/Markdown'
import {PageHeader} from '../components/PageHeader'
import {useDataChanged} from '../lib/dataChanged'

/**
 * The Sponsors section: the brand partners the channel works with. Each card
 * opens the sponsor's page (see SponsorDetails) with its branding files and
 * campaigns.
 */
export function Sponsors({
  onOpenSponsor,
}: {
  /** Open a sponsor's page (null = create a new sponsor). */
  onOpenSponsor: (sponsor: main.Sponsor | null) => void
}) {
  const [sponsors, setSponsors] = useState<main.Sponsor[]>([])

  const load = useCallback(() => {
    GetSponsors()
      .then((s) => setSponsors(s ?? []))
      .catch(() => {})
  }, [])

  useEffect(load, [load])
  // Sponsors saved elsewhere (e.g. an MCP client) appear without a re-visit.
  useDataChanged(['sponsors'], load)

  const remove = async (id: string) => {
    try {
      await DeleteSponsor(id)
      setSponsors((prev) => prev.filter((s) => s.id !== id))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        description="The brand partners you work with — each with its branding, campaigns, and assets."
        actions={
          sponsors.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenSponsor(null)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              <Plus size={14} aria-hidden />
              New sponsor
            </button>
          )
        }
      />

      {sponsors.length === 0 ? (
        <button
          type="button"
          onClick={() => onOpenSponsor(null)}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover sm:w-1/2"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"
          >
            <Handshake size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">Add a sponsor</span>
            <p className="mt-1 text-sm text-fg-muted">
              Keep each partner's branding, messaging, and campaign assets in
              one place.
            </p>
          </div>
        </button>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sponsors.map((s) => (
            <SponsorCard
              key={s.id}
              sponsor={s}
              onOpen={() => onOpenSponsor(s)}
              onDelete={() => void remove(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SponsorCard({
  sponsor,
  onOpen,
  onDelete,
}: {
  sponsor: main.Sponsor
  onOpen: () => void
  onDelete: () => void
}) {
  const campaigns = sponsor.campaigns?.length ?? 0
  const files = sponsor.branding?.length ?? 0
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
        className="flex h-full cursor-pointer flex-col rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {sponsor.logoUrl ? (
              <img
                src={sponsor.logoUrl}
                alt={`${sponsor.name} logo`}
                className="h-8 w-8 shrink-0 rounded-lg border border-edge bg-bg object-contain"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
              >
                <Handshake size={16} />
              </span>
            )}
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
              {sponsor.name}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="Delete sponsor"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>

        {sponsor.description && (
          <div className="mt-2 line-clamp-3 text-sm text-fg-muted">
            <Markdown>{sponsor.description}</Markdown>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
            <Megaphone size={11} aria-hidden />
            {campaigns} {campaigns === 1 ? 'campaign' : 'campaigns'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-bg px-2 py-0.5 text-xs font-medium text-fg-muted">
            <Paperclip size={11} aria-hidden />
            {files} {files === 1 ? 'file' : 'files'}
          </span>
        </div>
      </div>
    </li>
  )
}
