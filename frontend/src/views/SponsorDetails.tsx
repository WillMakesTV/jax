import {
  ArrowLeft,
  CalendarRange,
  ExternalLink,
  File,
  Loader2,
  Megaphone,
  Paperclip,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {
  AddSponsorBranding,
  DeleteSponsorBranding,
  DeleteSponsorCampaign,
  GetSponsors,
  SaveSponsor,
  SetSponsorLogo,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {openExternal} from '../lib/browser'
import {useDataChanged} from '../lib/dataChanged'
import {useSponsorAi} from '../sponsors/SponsorAiProvider'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/**
 * A sponsor's own page: create a new sponsor, or view/edit an existing one —
 * name, website, markdown description, branding uploads, and the campaigns
 * run with them (each opens its own page, see CampaignDetails).
 */
export function SponsorDetails({
  sponsor,
  onBack,
  onOpenCampaign,
}: {
  /** The sponsor being viewed, or null when creating a new one. */
  sponsor: main.Sponsor | null
  onBack: () => void
  /** Open a campaign's page (null campaign = create a new one). */
  onOpenCampaign: (
    sponsor: main.Sponsor,
    campaign: main.SponsorCampaign | null,
  ) => void
}) {
  const [sp, setSp] = useState<main.Sponsor | null>(sponsor)

  // The navigation history hands us a snapshot; reload the live record so
  // files/campaigns edited on a previous visit are current.
  const load = useCallback(() => {
    if (!sponsor) return
    GetSponsors()
      .then((all) => {
        const fresh = (all ?? []).find((s) => s.id === sponsor.id)
        if (fresh) setSp(fresh)
      })
      .catch(() => {})
  }, [sponsor])

  useEffect(load, [load])
  // A background website research (see SponsorAiProvider) persists its
  // results while this page may be open; adopt changes as they land.
  useDataChanged(['sponsors'], load)

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to Sponsors
      </button>

      {!sp ? (
        <CreateSponsorForm onCreated={setSp} onCancel={onBack} />
      ) : (
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Branding with the campaigns beneath it, to the left of the
              description column. */}
          <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-80">
            <BrandingSection sponsor={sp} onChange={setSp} />
            <CampaignsSection
              sponsor={sp}
              onChange={setSp}
              onOpenCampaign={onOpenCampaign}
            />
          </aside>
          <div className="min-w-0 max-w-3xl flex-1">
            <DetailsSection sponsor={sp} onChange={setSp} />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Creation: a name is all it takes
// ---------------------------------------------------------------------------

function CreateSponsorForm({
  onCreated,
  onCancel,
}: {
  onCreated: (sponsor: main.Sponsor) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!name.trim()) {
      setError('Give the sponsor a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await SaveSponsor(
        main.Sponsor.createFrom({
          id: '',
          name: name.trim(),
          website: website.trim(),
          description: '',
          branding: [],
          campaigns: [],
          createdAt: '',
        }),
      )
      onCreated(saved)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not create the sponsor.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
      className="flex max-w-2xl flex-col gap-5"
    >
      <p className="text-sm text-fg-muted">
        A sponsor is a brand partner. A name is all it takes to start — branding
        files and campaigns are added from its page.
      </p>

      <div>
        <label htmlFor="sponsor-name" className={labelCls}>
          Sponsor name
        </label>
        <input
          id="sponsor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Tools"
          autoFocus
          className={field}
        />
      </div>

      <div>
        <label htmlFor="sponsor-website" className={labelCls}>
          Website
        </label>
        <input
          id="sponsor-website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://…"
          className={field}
        />
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
          {saving ? 'Creating…' : 'Create sponsor'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-edge bg-surface px-5 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Details: name, website, and markdown description
// ---------------------------------------------------------------------------

function DetailsSection({
  sponsor,
  onChange,
}: {
  sponsor: main.Sponsor
  onChange: (sponsor: main.Sponsor) => void
}) {
  const [name, setName] = useState(sponsor.name)
  const [website, setWebsite] = useState(sponsor.website ?? '')
  const [description, setDescription] = useState(sponsor.description)
  const [error, setError] = useState('')

  // Adopt the freshly reloaded record (see SponsorDetails) once, but never
  // clobber in-progress typing: only sync when the record itself changes.
  const [synced, setSynced] = useState(sponsor)
  if (sponsor !== synced) {
    setSynced(sponsor)
    setName(sponsor.name)
    setWebsite(sponsor.website ?? '')
    setDescription(sponsor.description)
  }

  // Branding/campaigns are preserved by the backend regardless of what is
  // sent.
  const persist = async (fields: {
    name?: string
    website?: string
    description?: string
    selfPromotion?: boolean
  }) => {
    setError('')
    try {
      const saved = await SaveSponsor(
        main.Sponsor.createFrom({
          id: sponsor.id,
          name: fields.name ?? sponsor.name,
          website: fields.website ?? (sponsor.website || ''),
          description: fields.description ?? sponsor.description,
          selfPromotion: fields.selfPromotion ?? sponsor.selfPromotion,
          branding: [],
          campaigns: [],
          createdAt: sponsor.createdAt,
        }),
      )
      onChange(saved)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the sponsor.',
      )
    }
  }

  // Generate with AI: the backend reads the website (homepage, llms.txt,
  // sitemap), writes the description, and pulls likely logo/branding images
  // into the branding uploads. The run lives in SponsorAiProvider so it
  // survives navigating away and reports through the status bar.
  const sponsorAi = useSponsorAi()
  const generating = sponsorAi.jobs.some((j) => j.sponsorId === sponsor.id)
  const generate = async () => {
    setError('')
    try {
      // The backend persists the results; adopt them when this page is
      // still around to hear it.
      onChange(await sponsorAi.generate(sponsor.id, sponsor.name))
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The description could not be generated.',
      )
    }
  }

  const dirtyDescription = description !== sponsor.description
  const websiteHref = website.trim()
    ? /^https?:\/\//i.test(website.trim())
      ? website.trim()
      : `https://${website.trim()}`
    : ''

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="sponsor-name" className={labelCls}>
          Sponsor name
        </label>
        <input
          id="sponsor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== sponsor.name) {
              void persist({name: name.trim()})
            }
          }}
          className={field}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label
            htmlFor="sponsor-website"
            className="text-sm font-medium text-fg"
          >
            Website
          </label>
          {websiteHref && (
            <button
              type="button"
              onClick={() => openExternal(websiteHref)}
              className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              <ExternalLink size={12} aria-hidden />
              Open
            </button>
          )}
        </div>
        <input
          id="sponsor-website"
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          onBlur={() => {
            if (website !== (sponsor.website ?? '')) {
              void persist({website: website.trim()})
            }
          }}
          placeholder="https://…"
          className={field}
        />
      </div>

      {/* Owned or part-owned by the streamer: mentions must disclose it. */}
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={sponsor.selfPromotion ?? false}
          onChange={(e) => void persist({selfPromotion: e.target.checked})}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
        />
        <span>
          <span className="block text-sm font-medium text-fg">
            Self-promotion
          </span>
          <span className="block text-xs text-fg-muted">
            This sponsor is owned or part-owned by you — mentions of it carry a
            disclosure disclaimer.
          </span>
        </span>
      </label>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-fg">Description</span>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating || !websiteHref}
            title={
              websiteHref
                ? 'Read the sponsor’s website and write the description'
                : 'Add the sponsor’s website first — the research starts there.'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={14} aria-hidden className="animate-spin" />
            ) : (
              <Sparkles size={14} aria-hidden className="text-accent" />
            )}
            {generating ? 'Researching…' : 'Generate with AI'}
          </button>
        </div>
        <MarkdownField
          id="sponsor-description"
          value={description}
          onChange={setDescription}
          onDone={() => void persist({description})}
          placeholder="Who is this sponsor? Products, audience fit, contacts, terms… — or Generate with AI from their website."
        />
        {dirtyDescription && (
          <button
            type="button"
            onClick={() => void persist({description})}
            className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            Save description
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Campaigns: the engagements run with this sponsor
// ---------------------------------------------------------------------------

function CampaignsSection({
  sponsor,
  onChange,
  onOpenCampaign,
}: {
  sponsor: main.Sponsor
  onChange: (sponsor: main.Sponsor) => void
  onOpenCampaign: (
    sponsor: main.Sponsor,
    campaign: main.SponsorCampaign | null,
  ) => void
}) {
  const campaigns = sponsor.campaigns ?? []

  const remove = async (campaignID: string) => {
    try {
      onChange(await DeleteSponsorCampaign(sponsor.id, campaignID))
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Campaigns</h2>
        <button
          type="button"
          onClick={() => onOpenCampaign(sponsor, null)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          <Plus size={14} aria-hidden />
          Add Campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <button
          type="button"
          onClick={() => onOpenCampaign(sponsor, null)}
          className="flex w-full items-start gap-4 rounded-xl border border-dashed border-edge bg-surface p-5 text-left transition-colors hover:bg-surface-hover"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
          >
            <Megaphone size={20} />
          </span>
          <div>
            <span className="text-sm font-semibold text-fg">
              Plan the first campaign
            </span>
            <p className="mt-1 text-sm text-fg-muted">
              Dates, messaging, promotion details, and the assets to use on air.
            </p>
          </div>
        </button>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpenCampaign(sponsor, c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpenCampaign(sponsor, c)
                  }
                }}
                className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-accent/50 hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">
                    {c.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                    {(c.startDate || c.endDate) && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarRange size={12} aria-hidden />
                        {formatDateRange(c.startDate, c.endDate)}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Paperclip size={12} aria-hidden />
                      {c.assets?.length ?? 0}{' '}
                      {(c.assets?.length ?? 0) === 1 ? 'asset' : 'assets'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void remove(c.id)
                  }}
                  title="Delete campaign"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Branding: the sponsor's uploaded files
// ---------------------------------------------------------------------------

function BrandingSection({
  sponsor,
  onChange,
}: {
  sponsor: main.Sponsor
  onChange: (sponsor: main.Sponsor) => void
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const addFiles = async () => {
    setAdding(true)
    setError('')
    try {
      onChange(await AddSponsorBranding(sponsor.id))
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not add the files.',
      )
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Branding</h2>
        <button
          type="button"
          onClick={() => void addFiles()}
          disabled={adding}
          className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <Upload size={14} aria-hidden />
          {adding ? 'Adding…' : 'Add files'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <SponsorFileList
        files={sponsor.branding ?? []}
        emptyCopy="Logos, brand kits, overlays — the sponsor's identity, ready to drop into streams and videos."
        onDelete={async (fileID) =>
          onChange(await DeleteSponsorBranding(sponsor.id, fileID))
        }
        logoFileId={sponsor.logoFileId || ''}
        onSetLogo={async (fileID) =>
          onChange(await SetSponsorLogo(sponsor.id, fileID))
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared file list (branding here, campaign assets in CampaignDetails)
// ---------------------------------------------------------------------------

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

/** "2026-07-01" → "Jul 1, 2026"; malformed dates fall back to the raw text. */
function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateRange(start: string, end: string): string {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`
  if (start) return `From ${formatDate(start)}`
  if (end) return `Until ${formatDate(end)}`
  return ''
}

export function SponsorFileList({
  files,
  emptyCopy,
  onDelete,
  logoFileId,
  onSetLogo,
}: {
  files: main.SponsorFile[]
  /** Explains what belongs here when nothing is uploaded yet. */
  emptyCopy: string
  onDelete: (fileID: string) => Promise<void>
  /** Which file serves as the sponsor's logo (branding list only). */
  logoFileId?: string
  /** Pick a file as the logo ('' clears it); omitted = no logo control. */
  onSetLogo?: (fileID: string) => Promise<void>
}) {
  const remove = async (fileID: string) => {
    try {
      await onDelete(fileID)
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  const setLogo = async (fileID: string) => {
    try {
      await onSetLogo?.(fileID)
    } catch {
      // Non-fatal; the list reconciles on the next load.
    }
  }

  if (files.length === 0) {
    return <p className="text-sm text-fg-muted">{emptyCopy}</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {files.map((f) => {
        const isLogo = Boolean(logoFileId) && f.id === logoFileId
        return (
          <li
            key={f.id}
            className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3"
          >
            {IMAGE_EXT.test(f.name) ? (
              <img
                src={f.mediaUrl}
                alt={f.name}
                className="h-12 w-12 shrink-0 rounded-lg border border-edge object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-edge bg-bg text-fg-muted"
              >
                <File size={20} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{f.name}</p>
              <p className="text-xs text-fg-muted">
                {formatSize(f.sizeBytes)}
                {isLogo && (
                  <span className="ml-1.5 font-medium text-accent">Logo</span>
                )}
              </p>
            </div>
            {onSetLogo && (
              <button
                type="button"
                onClick={() => void setLogo(isLogo ? '' : f.id)}
                title={
                  isLogo
                    ? 'This file is the sponsor logo — click to clear'
                    : 'Use this file as the sponsor logo'
                }
                className={
                  isLogo
                    ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-accent transition-colors hover:bg-surface-hover'
                    : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg'
                }
              >
                <Star
                  size={14}
                  aria-hidden
                  fill={isLogo ? 'currentColor' : 'none'}
                />
              </button>
            )}
            <button
              type="button"
              onClick={() => void remove(f.id)}
              title="Remove file"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
