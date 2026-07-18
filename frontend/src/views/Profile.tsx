import {
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Link2,
  Palette,
  Plus,
  Trash2,
  User,
} from 'lucide-react'
import clsx from 'clsx'
import {useEffect, useState, type FormEvent} from 'react'
import {
  AddBrandAssets,
  DeleteBrandAsset,
  DeleteBrandLink,
  GetBrandAssets,
  GetBrandGuidelines,
  GetBrandLinks,
  SaveBrandLink,
  SetBrandGuidelines,
  UpdateBrandAsset,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {Avatar} from '../components/Avatar'
import {MarkdownField} from '../components/markdown/MarkdownField'
import {PageHeader} from '../components/PageHeader'
import {openExternal} from '../lib/browser'
import {formatBytes, formatDate} from '../lib/format'
import {useProfile} from '../profile/ProfileProvider'

export type ProfileTab = 'user-info' | 'brand-assets' | 'links'

const TABS: {id: ProfileTab; label: string; icon: typeof User}[] = [
  {id: 'user-info', label: 'User Info', icon: User},
  {id: 'brand-assets', label: 'Brand Assets', icon: Palette},
  {id: 'links', label: 'Links', icon: Link2},
]

/**
 * The profile page, in tabs: User Info (name + Gravatar email) and Brand
 * Assets (uploaded files — logos, banners, overlays — that define the brand
 * and can be referenced across the app). The user menu links straight to
 * each tab.
 */
export function Profile({initialTab}: {initialTab?: ProfileTab}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab ?? 'user-info')
  // Navigating here again with an explicit tab (same mounted component, new
  // nav entry) should switch to it.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        description={
          tab === 'user-info'
            ? 'Set your name and the email used for your avatar.'
            : tab === 'brand-assets'
              ? 'The files that define your brand — logos, banners, overlays — kept in one place to reference anywhere.'
              : 'Everywhere your brand lives — social profiles, website, store — with each service’s logo pulled in automatically.'
        }
      />

      <div
        role="tablist"
        aria-label="Profile sections"
        className="mb-6 flex w-fit items-center gap-1 rounded-lg border border-edge bg-surface p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-accent text-accent-fg'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            <t.icon size={15} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'user-info' && <UserInfoTab />}
      {tab === 'brand-assets' && <BrandAssetsTab />}
      {tab === 'links' && <LinksTab />}
    </div>
  )
}

/** Name + Gravatar email — the original profile form. */
function UserInfoTab() {
  const {profile, setProfile} = useProfile()
  const [name, setName] = useState(profile.name)
  const [email, setEmail] = useState(profile.email)
  const [saved, setSaved] = useState(false)
  // The email is treated like a password: hidden by default, revealable.
  const [showEmail, setShowEmail] = useState(false)

  const dirty = name !== profile.name || email !== profile.email

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfile({name: name.trim(), email: email.trim()})
    setSaved(true)
  }

  const markEdited = () => {
    if (saved) setSaved(false)
  }

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-2xl rounded-xl border border-edge bg-surface p-6"
    >
      {/* Avatar preview reflects the email as you type. */}
      <div className="flex items-center gap-4">
        <Avatar email={email} name={name} size={64} />
        <div>
          <p className="text-sm font-semibold text-fg">
            {name.trim() || 'Your name'}
          </p>
          <p className="text-xs text-fg-muted">
            {email.trim()
              ? 'Showing your Gravatar if one exists for this email.'
              : 'Add an email to use your Gravatar photo.'}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="profile-name"
            className="mb-1.5 block text-sm font-medium text-fg"
          >
            Name
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            autoComplete="name"
            placeholder="e.g. Will Jackson"
            onChange={(e) => {
              setName(e.target.value)
              markEdited()
            }}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted"
          />
        </div>

        <div>
          <label
            htmlFor="profile-email"
            className="mb-1.5 block text-sm font-medium text-fg"
          >
            Email
          </label>
          <div className="relative">
            <input
              id="profile-email"
              type={showEmail ? 'email' : 'password'}
              value={email}
              autoComplete="off"
              placeholder="you@example.com"
              onChange={(e) => {
                setEmail(e.target.value)
                markEdited()
              }}
              className="w-full rounded-lg border border-edge bg-bg px-3 py-2 pr-10 text-sm text-fg placeholder:text-fg-muted"
            />
            <button
              type="button"
              onClick={() => setShowEmail((s) => !s)}
              aria-label={showEmail ? 'Hide email' : 'Show email'}
              title={showEmail ? 'Hide email' : 'Show email'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            >
              {showEmail ? (
                <EyeOff size={15} aria-hidden />
              ) : (
                <Eye size={15} aria-hidden />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">
            Used only to look up your{' '}
            <a
              href="https://gravatar.com"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              Gravatar
            </a>{' '}
            avatar. If no Gravatar exists, a default icon is shown.
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity disabled:opacity-50"
        >
          Save changes
        </button>
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <Check size={16} aria-hidden />
            Saved
          </span>
        )}
      </div>
    </form>
  )
}

/** File extensions rendered as an inline image preview. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i

/**
 * The brand's written guidelines — voice, tone, colors, dos and don'ts — in
 * the app's markdown editor. AI features (and MCP clients, via
 * get_brand_guidelines) consult this before producing brand-facing visuals
 * or copy, so the rules written here follow the brand everywhere.
 */
function BrandGuidelinesSection() {
  const [guidelines, setGuidelines] = useState('')
  const [saved, setSaved] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    GetBrandGuidelines()
      .then((v) => {
        if (cancelled) return
        setGuidelines(v)
        setSaved(v)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (value: string) => {
    setError('')
    try {
      await SetBrandGuidelines(value)
      setSaved(value)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the guidelines.',
      )
    }
  }

  const dirty = guidelines !== saved

  return (
    <div className="mb-6">
      <p className="mb-1.5 text-sm font-medium text-fg">Branding Guidelines</p>
      <p className="mb-2 text-sm text-fg-muted">
        The written rules of the brand — voice, tone, colors, typography, dos
        and don&apos;ts. Every AI feature producing brand-facing visuals or copy
        consults them first.
      </p>
      {!loaded ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : (
        <>
          <MarkdownField
            id="brand-guidelines"
            value={guidelines}
            onChange={setGuidelines}
            onDone={() => void save(guidelines)}
            placeholder="e.g. Voice: energetic but never salesy. Colors: purple #7C3AED on near-black. Logo always bottom-right, never stretched…"
          />
          {dirty && (
            <button
              type="button"
              onClick={() => void save(guidelines)}
              className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
            >
              Save guidelines
            </button>
          )}
        </>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

/** Uploaded brand files: add, describe, and remove. */
function BrandAssetsTab() {
  const [assets, setAssets] = useState<main.BrandAsset[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')

  useEffect(() => {
    GetBrandAssets()
      .then((a) => setAssets(a ?? []))
      .catch(() => {})
  }, [])

  const add = () => {
    setBusy(true)
    setError('')
    AddBrandAssets()
      .then((a) => setAssets(a ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  const remove = (id: string) => {
    setError('')
    DeleteBrandAsset(id)
      .then((a) => setAssets(a ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setConfirmDelete(''))
  }

  return (
    <div className="max-w-2xl">
      <BrandGuidelinesSection />

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {assets.length === 0
            ? 'Nothing uploaded yet.'
            : `${assets.length} asset${assets.length === 1 ? '' : 's'}`}
        </p>
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={14} aria-hidden />
          {busy ? 'Adding…' : 'Add files'}
        </button>
      </div>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Palette size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">No brand assets yet</p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Upload logos, banners, overlays, palettes, or any files that define
            your brand — they become referenceable across the app.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-2"
            >
              {/* Preview: the image itself, or a file tile. */}
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-bg">
                {IMAGE_EXT.test(asset.name) ? (
                  <img
                    src={asset.mediaUrl}
                    alt={asset.name}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <FileText size={20} aria-hidden className="text-fg-muted" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">
                  {asset.name}
                </p>
                <p className="text-xs text-fg-muted">
                  {formatBytes(asset.sizeBytes)} · added{' '}
                  {formatDate(asset.addedAt)}
                </p>
                <AssetDescription
                  asset={asset}
                  onSaved={(a) => setAssets(a ?? [])}
                  onError={(msg) => setError(msg)}
                />
              </div>
              {confirmDelete === asset.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => remove(asset.id)}
                    className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete('')}
                    className="rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(asset.id)}
                  title="Delete this asset"
                  aria-label={`Delete ${asset.name}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Hostname of a link, for the muted secondary line ('' when unparsable). */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * The brand's outward links. Each row carries the service's favicon (fetched
 * and cached by the backend), an editable label, and opens the link in the
 * system browser.
 */
function LinksTab() {
  const [links, setLinks] = useState<main.BrandLink[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')

  useEffect(() => {
    GetBrandLinks()
      .then((l) => setLinks(l ?? []))
      .catch(() => {})
  }, [])

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true)
    setError('')
    SaveBrandLink(main.BrandLink.createFrom({id: '', label, url}))
      .then((l) => {
        setLinks(l ?? [])
        setUrl('')
        setLabel('')
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  const remove = (id: string) => {
    setError('')
    DeleteBrandLink(id)
      .then((l) => setLinks(l ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setConfirmDelete(''))
  }

  return (
    <div className="max-w-2xl">
      {/* Add a link: URL required, label optional (defaults to the host). */}
      <form onSubmit={add} className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/@yourchannel"
          aria-label="Link URL"
          className="min-w-56 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          aria-label="Link label"
          className="w-40 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={14} aria-hidden />
          {busy ? 'Adding…' : 'Add link'}
        </button>
      </form>

      {error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {links.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-surface px-6 py-10 text-center">
          <span
            aria-hidden
            className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-fg-muted"
          >
            <Link2 size={20} />
          </span>
          <p className="text-sm font-semibold text-fg">No links yet</p>
          <p className="mt-1 max-w-sm text-sm text-fg-muted">
            Add your social profiles, website, and store — each shows up with
            the service&apos;s own logo.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-3 rounded-lg border border-edge bg-surface p-2"
            >
              {/* The service's favicon, cached by the backend. */}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-bg">
                {link.iconUrl ? (
                  <img
                    src={link.iconUrl}
                    alt=""
                    aria-hidden
                    className="h-6 w-6 object-contain"
                  />
                ) : (
                  <Link2 size={16} aria-hidden className="text-fg-muted" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <LinkLabel link={link} onSaved={(l) => setLinks(l ?? [])} />
                <p className="truncate text-xs text-fg-muted">
                  {hostOf(link.url) || link.url}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openExternal(link.url)}
                title={`Open ${link.url}`}
                aria-label={`Open ${link.label || link.url}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <ExternalLink size={15} aria-hidden />
              </button>
              {confirmDelete === link.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => remove(link.id)}
                    className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete('')}
                    className="rounded-lg border border-edge bg-bg px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(link.id)}
                  title="Delete this link"
                  aria-label={`Delete ${link.label || link.url}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                >
                  <Trash2 size={15} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A link's label, edited in place and saved when the field loses focus. */
function LinkLabel({
  link,
  onSaved,
}: {
  link: main.BrandLink
  onSaved: (links: main.BrandLink[]) => void
}) {
  const [value, setValue] = useState(link.label)

  const save = () => {
    if (value.trim() === link.label) return
    SaveBrandLink(
      main.BrandLink.createFrom({...link, label: value.trim()}),
    )
      .then(onSaved)
      .catch(() => setValue(link.label))
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      placeholder={hostOf(link.url) || 'Label'}
      aria-label={`Label for ${link.url}`}
      className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-fg outline-none transition-colors hover:border-edge focus:border-accent focus:bg-bg"
    />
  )
}

/** An asset's description, saved when the field loses focus. */
function AssetDescription({
  asset,
  onSaved,
  onError,
}: {
  asset: main.BrandAsset
  onSaved: (assets: main.BrandAsset[]) => void
  onError: (message: string) => void
}) {
  const [value, setValue] = useState(asset.description)

  const save = () => {
    if (value === asset.description) return
    UpdateBrandAsset(asset.id, value)
      .then(onSaved)
      .catch((err) =>
        onError(err instanceof Error ? err.message : String(err)),
      )
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      placeholder="What is this asset for? e.g. primary logo, stream overlay…"
      aria-label={`Description for ${asset.name}`}
      className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-muted outline-none transition-colors placeholder:text-fg-muted/60 hover:border-edge focus:border-accent focus:bg-bg focus:text-fg"
    />
  )
}
