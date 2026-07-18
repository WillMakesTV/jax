import {ArrowLeft, Upload} from 'lucide-react'
import {useEffect, useState} from 'react'
import {
  AddCampaignAssets,
  DeleteCampaignAsset,
  GetSponsors,
  SaveSponsorCampaign,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {SponsorFileList} from './SponsorDetails'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/**
 * A sponsor campaign's own page: create a new campaign for the sponsor, or
 * view/edit an existing one — name, run dates, messaging, promotion details,
 * and the campaign's asset uploads.
 */
export function CampaignDetails({
  sponsor,
  campaign,
  onBack,
}: {
  /** The sponsor the campaign belongs to. */
  sponsor: main.Sponsor
  /** The campaign being viewed, or null when creating a new one. */
  campaign: main.SponsorCampaign | null
  onBack: () => void
}) {
  const [sp, setSp] = useState(sponsor)
  const [campaignId, setCampaignId] = useState(campaign?.id ?? '')

  // The navigation history hands us a snapshot; reload the live record so
  // edits from a previous visit are current.
  useEffect(() => {
    GetSponsors()
      .then((all) => {
        const fresh = (all ?? []).find((s) => s.id === sponsor.id)
        if (fresh) setSp(fresh)
      })
      .catch(() => {})
  }, [sponsor])

  const current = (sp.campaigns ?? []).find((c) => c.id === campaignId)

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={16} aria-hidden />
        Back to {sp.name || 'Sponsor'}
      </button>

      {!current ? (
        <CreateCampaignForm
          sponsor={sp}
          onCreated={(saved) => {
            setSp(saved)
            // The new campaign is stored first.
            const created = saved.campaigns?.[0]
            if (created) setCampaignId(created.id)
          }}
          onCancel={onBack}
        />
      ) : (
        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="min-w-0 max-w-3xl flex-1">
            <CampaignForm sponsor={sp} campaign={current} onChange={setSp} />
          </div>
          <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
            <AssetsSection sponsor={sp} campaign={current} onChange={setSp} />
          </aside>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Creation: a name is all it takes
// ---------------------------------------------------------------------------

function CreateCampaignForm({
  sponsor,
  onCreated,
  onCancel,
}: {
  sponsor: main.Sponsor
  onCreated: (sponsor: main.Sponsor) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!name.trim()) {
      setError('Give the campaign a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      onCreated(
        await SaveSponsorCampaign(
          sponsor.id,
          main.SponsorCampaign.createFrom({
            id: '',
            name: name.trim(),
            startDate: '',
            endDate: '',
            messaging: '',
            promotionDetails: '',
            assets: [],
            createdAt: '',
          }),
        ),
      )
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not create the campaign.',
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
        A campaign is one engagement with {sponsor.name || 'the sponsor'} — a
        product push, an event, a season. A name is all it takes to start;
        dates, messaging, and assets follow on its page.
      </p>

      <div>
        <label htmlFor="campaign-name" className={labelCls}>
          Campaign name
        </label>
        <input
          id="campaign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Fall product launch"
          autoFocus
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
          {saving ? 'Creating…' : 'Create campaign'}
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
// Editing: name, run dates, and the two markdown briefs
// ---------------------------------------------------------------------------

function CampaignForm({
  sponsor,
  campaign,
  onChange,
}: {
  sponsor: main.Sponsor
  campaign: main.SponsorCampaign
  onChange: (sponsor: main.Sponsor) => void
}) {
  const [name, setName] = useState(campaign.name)
  const [startDate, setStartDate] = useState(campaign.startDate ?? '')
  const [endDate, setEndDate] = useState(campaign.endDate ?? '')
  const [messaging, setMessaging] = useState(campaign.messaging)
  const [promotionDetails, setPromotionDetails] = useState(
    campaign.promotionDetails,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Adopt the freshly reloaded record (see CampaignDetails) once, but never
  // clobber in-progress typing: only sync when the record itself changes.
  const [synced, setSynced] = useState(campaign)
  if (campaign !== synced) {
    setSynced(campaign)
    setName(campaign.name)
    setStartDate(campaign.startDate ?? '')
    setEndDate(campaign.endDate ?? '')
    setMessaging(campaign.messaging)
    setPromotionDetails(campaign.promotionDetails)
  }

  const dirty =
    name !== campaign.name ||
    startDate !== (campaign.startDate ?? '') ||
    endDate !== (campaign.endDate ?? '') ||
    messaging !== campaign.messaging ||
    promotionDetails !== campaign.promotionDetails

  // Assets are preserved by the backend regardless of what is sent.
  const save = async () => {
    if (!name.trim()) {
      setError('Give the campaign a name.')
      return
    }
    setSaving(true)
    setError('')
    try {
      onChange(
        await SaveSponsorCampaign(
          sponsor.id,
          main.SponsorCampaign.createFrom({
            id: campaign.id,
            name: name.trim(),
            startDate,
            endDate,
            messaging,
            promotionDetails,
            assets: [],
            createdAt: campaign.createdAt,
          }),
        ),
      )
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the campaign.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="campaign-name" className={labelCls}>
          Campaign name
        </label>
        <input
          id="campaign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="campaign-start" className={labelCls}>
            Start date
          </label>
          <input
            id="campaign-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="campaign-end" className={labelCls}>
            End date
          </label>
          <input
            id="campaign-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={field}
          />
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-fg">
          Messaging
        </span>
        <MarkdownField
          id="campaign-messaging"
          value={messaging}
          onChange={setMessaging}
          onDone={() => void save()}
          placeholder="Key talking points, required phrases, do's and don'ts…"
        />
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-fg">
          Promotion details
        </span>
        <MarkdownField
          id="campaign-promotion"
          value={promotionDetails}
          onChange={setPromotionDetails}
          onDone={() => void save()}
          placeholder="Deliverables and placement — mid-rolls, overlays, link drops, posts…"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {dirty && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="w-fit rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save campaign'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assets: the campaign's uploaded files
// ---------------------------------------------------------------------------

function AssetsSection({
  sponsor,
  campaign,
  onChange,
}: {
  sponsor: main.Sponsor
  campaign: main.SponsorCampaign
  onChange: (sponsor: main.Sponsor) => void
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const addFiles = async () => {
    setAdding(true)
    setError('')
    try {
      onChange(await AddCampaignAssets(sponsor.id, campaign.id))
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
        <h2 className="text-sm font-semibold text-fg">Campaign assets</h2>
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
        files={campaign.assets ?? []}
        emptyCopy="Ad reads, banners, product shots — everything this campaign runs with."
        onDelete={async (fileID) =>
          onChange(await DeleteCampaignAsset(sponsor.id, campaign.id, fileID))
        }
      />
    </div>
  )
}
