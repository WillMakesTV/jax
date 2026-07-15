import {ArrowLeft, Check, Search} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {
  GetSeriesTypes,
  GetYouTubeCategories,
  SaveContentSeries,
  SearchKickCategories,
  SearchTwitchCategories,
} from '../../wailsjs/go/main/App'
import {main} from '../../wailsjs/go/models'
import {TWITCH_CONTENT_LABELS} from '../lib/contentLabels'
import {
  TEXT_GDIPLUS_KINDS,
  loadEpisodeTextSources,
  saveEpisodeTextSources,
} from '../lib/smartSources'
import {useLiveData} from '../live/LiveDataProvider'
import {SERVICES} from '../services/services'
import {useServices} from '../services/ServicesProvider'

const field =
  'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent'
const labelCls = 'mb-1.5 block text-sm font-medium text-fg'

/**
 * The "Content series" form on its own page: create a new series or edit an
 * existing one. Each connected broadcast service (Twitch, YouTube) requires a
 * category chosen from that platform's own catalogue — the IDs are what update
 * the stream information on the platform when the series goes live.
 */
export function EditSeries({
  series,
  onBack,
  onSaved,
}: {
  /** The series being edited, or null when creating a new one. */
  series: main.ContentSeries | null
  onBack: () => void
  /** Called after the series is saved. */
  onSaved: () => void
}) {
  const {statuses, obsRequest} = useServices()
  const {refreshObs} = useLiveData()
  const twitchConnected = statuses['twitch']?.connected ?? false
  const youtubeConnected = statuses['youtube']?.connected ?? false
  const kickConnected = statuses['kick']?.connected ?? false
  const obsConnected = statuses['obs']?.connected ?? false

  const [title, setTitle] = useState(series?.title ?? '')
  const [description, setDescription] = useState(series?.description ?? '')
  const [twitchCat, setTwitchCat] = useState<main.ServiceCategory | null>(
    series?.twitchCategory?.id ? series.twitchCategory : null,
  )
  const [youtubeCat, setYoutubeCat] = useState<main.ServiceCategory | null>(
    series?.youtubeCategory?.id ? series.youtubeCategory : null,
  )
  const [kickCat, setKickCat] = useState<main.ServiceCategory | null>(
    series?.kickCategory?.id ? series.kickCategory : null,
  )
  const [types, setTypes] = useState<main.SeriesType[]>([])
  const [typeId, setTypeId] = useState(series?.typeId ?? '')
  const [tags, setTags] = useState((series?.tags ?? []).join(', '))
  const [twitchLabels, setTwitchLabels] = useState<string[]>(
    series?.twitchLabels ?? [],
  )
  const [ytMadeForKids, setYtMadeForKids] = useState(
    series?.youtubeMadeForKids ?? false,
  )
  const [season, setSeason] = useState(series?.season ?? '')
  const [notes, setNotes] = useState(series?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const episodic = Boolean(types.find((t) => t.id === typeId)?.episodic)

  // Episode-info text sources: the OBS text sources the on-air episode's
  // title and "Episode N" are written into directly (see smartSources.ts).
  // The mapping lives in its own setting, so reopening the form re-derives
  // the state from what is actually saved.
  const [smartEpisodeInfo, setSmartEpisodeInfo] = useState(false)
  const [titleSource, setTitleSource] = useState('')
  const [numberSource, setNumberSource] = useState('')
  const [textSources, setTextSources] = useState<string[]>([])

  useEffect(() => {
    loadEpisodeTextSources().then((map) => {
      setTitleSource(map.title)
      setNumberSource(map.number)
      setSmartEpisodeInfo(Boolean(map.title || map.number))
    })
  }, [])

  // OBS Text (GDI+) sources for the mapping dropdowns.
  useEffect(() => {
    if (!obsConnected) return
    obsRequest<{inputs: {inputName: string; inputKind: string}[]}>(
      'GetInputList',
    )
      .then((r) =>
        setTextSources(
          (r.inputs ?? [])
            .filter((i) => TEXT_GDIPLUS_KINDS.has(i.inputKind))
            .map((i) => i.inputName),
        ),
      )
      .catch(() => {})
  }, [obsConnected, obsRequest])

  useEffect(() => {
    GetSeriesTypes()
      .then((t) => {
        const list = t ?? []
        setTypes(list)
        // A brand-new series starts on the default type, when one is set.
        if (!series) {
          const def = list.find((x) => x.isDefault)
          if (def) setTypeId((cur) => (cur === '' ? def.id : cur))
        }
      })
      .catch(() => {})
  }, [series])

  const save = async () => {
    if (!title.trim()) {
      setError('Give the series a title.')
      return
    }
    if (twitchConnected && !twitchCat) {
      setError('Choose a Twitch category for this series.')
      return
    }
    if (youtubeConnected && !youtubeCat) {
      setError('Choose a YouTube category for this series.')
      return
    }
    if (kickConnected && !kickCat) {
      setError('Choose a Kick category for this series.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await SaveContentSeries(
        main.ContentSeries.createFrom({
          id: series?.id ?? '',
          title: title.trim(),
          description: description.trim(),
          twitchCategory: twitchCat ?? {id: '', name: ''},
          youtubeCategory: youtubeCat ?? {id: '', name: ''},
          kickCategory: kickCat ?? {id: '', name: ''},
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          season: season.trim(),
          notes: notes.trim(),
          createdAt: series?.createdAt ?? '',
          isDefault: series?.isDefault ?? false,
          typeId,
          twitchLabels,
          youtubeMadeForKids: ytMadeForKids,
        }),
      )
      // Persist the episode-info source mapping. Managed only while the
      // section is visible (episodic), so editing a non-episodic series never
      // disturbs another series' mapping.
      if (episodic) {
        saveEpisodeTextSources({
          title: smartEpisodeInfo ? titleSource : '',
          number: smartEpisodeInfo ? numberSource : '',
        })
        refreshObs()
      }
      onSaved()
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save the series.',
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
        Back to Content Series
      </button>

      <div className="max-w-2xl">
        <p className="mb-6 text-sm text-fg-muted">
          Reusable context for a recurring show or segment. Its categories are
          pushed to each platform when a stream in this series goes live.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="flex flex-col gap-5"
        >
          <div>
            <label htmlFor="series-title" className={labelCls}>
              Title
            </label>
            <input
              id="series-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Building AI Bots"
              autoFocus
              className={field}
            />
          </div>

          <fieldset className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4">
            <ServiceLegend id="twitch" />
            <p className="-mt-2 text-xs text-fg-muted">
              Applied to the Twitch channel when a stream in this series goes
              live. The category is required while Twitch is connected.
            </p>
            <TwitchCategoryPicker
              connected={twitchConnected}
              value={twitchCat}
              onChange={setTwitchCat}
            />

            <div>
              <p className="mb-2 text-sm font-medium text-fg">
                Content classification
              </p>
              <div className="flex flex-col gap-2">
                {TWITCH_CONTENT_LABELS.map((label) => (
                  <label key={label.id} className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={twitchLabels.includes(label.id)}
                      onChange={(e) =>
                        setTwitchLabels((prev) =>
                          e.target.checked
                            ? [...prev, label.id]
                            : prev.filter((id) => id !== label.id),
                        )
                      }
                      className="mt-0.5 h-4 w-4 accent-accent"
                    />
                    <span>
                      <span className="block text-sm text-fg">
                        {label.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        {label.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                &ldquo;Mature-rated game&rdquo; is applied automatically by
                Twitch from the chosen category and cannot be set here.
              </p>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4">
            <ServiceLegend id="youtube" />
            <p className="-mt-2 text-xs text-fg-muted">
              Applied to the YouTube broadcast once the stream is live. The
              category is required while YouTube is connected.
            </p>
            <YouTubeCategoryPicker
              connected={youtubeConnected}
              value={youtubeCat}
              onChange={setYoutubeCat}
            />

            <div>
              <p className="mb-2 text-sm font-medium text-fg">
                Content classification
              </p>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={ytMadeForKids}
                  onChange={(e) => setYtMadeForKids(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span>
                  <span className="block text-sm text-fg">Made for kids</span>
                  <span className="mt-0.5 block text-xs text-fg-muted">
                    Self-declares the broadcast as made for kids (COPPA);
                    YouTube then limits personalized ads, comments, and live
                    chat. This is the only classification YouTube&apos;s API
                    accepts — age restriction is set in YouTube Studio.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4">
            <ServiceLegend id="kick" />
            <p className="-mt-2 text-xs text-fg-muted">
              Applied to the Kick channel when a stream in this series goes
              live. The category is required while Kick is connected.
            </p>
            <SearchCategoryPicker
              connected={kickConnected}
              value={kickCat}
              onChange={setKickCat}
              serviceName="Kick"
              inputId="series-kick-category"
              search={SearchKickCategories}
            />
          </fieldset>

          {types.length > 0 && (
            <div>
              <label htmlFor="series-type" className={labelCls}>
                Series type{' '}
                <span className="font-normal text-fg-muted">(optional)</span>
              </label>
              <select
                id="series-type"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className={field}
              >
                <option value="">None</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.episodic ? ' (episodic)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {episodic && (
            <fieldset className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
              <legend className="px-1 text-sm font-semibold text-fg">
                Episode information
              </legend>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={smartEpisodeInfo}
                  onChange={(e) => setSmartEpisodeInfo(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-fg">
                    Show episode info in OBS text sources
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-muted">
                    Writes the on-air episode&apos;s info straight into the
                    chosen OBS text sources: the title as-is, and the number
                    as e.g.{' '}
                    <span className="font-mono">Episode 8</span>.
                  </span>
                </span>
              </label>
              {smartEpisodeInfo && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <EpisodeSourcePicker
                    id="series-episode-title-source"
                    label="Episode title"
                    value={titleSource}
                    options={textSources}
                    onChange={setTitleSource}
                  />
                  <EpisodeSourcePicker
                    id="series-episode-number-source"
                    label="Episode number"
                    value={numberSource}
                    options={textSources}
                    onChange={setNumberSource}
                  />
                  {!obsConnected && (
                    <p className="text-xs text-fg-muted sm:col-span-2">
                      Connect OBS in Settings → Services to pick sources from
                      a list; names typed here are matched when it connects.
                    </p>
                  )}
                </div>
              )}
            </fieldset>
          )}

          <div>
            <label htmlFor="series-description" className={labelCls}>
              Description{' '}
              <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <textarea
              id="series-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What is this series about?"
              className={`${field} resize-y`}
            />
          </div>

          <div>
            <label htmlFor="series-tags" className={labelCls}>
              Tags{' '}
              <span className="font-normal text-fg-muted">
                (comma-separated)
              </span>
            </label>
            <input
              id="series-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="ai, coding, twitch, youtube"
              className={field}
            />
          </div>

          <div>
            <label htmlFor="series-season" className={labelCls}>
              Season{' '}
              <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <input
              id="series-season"
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="1"
              className={field}
            />
            <p className="mt-1 text-xs text-fg-muted">
              Videos cut from this series&apos; streams are filed under this
              season in the edit workspace folder, instead of piling up in one
              flat directory. A bare number reads as “Season 1”; anything else
              is used as written. Changing it re-files the existing videos.
            </p>
          </div>

          <div>
            <label htmlFor="series-notes" className={labelCls}>
              Notes <span className="font-normal text-fg-muted">(context)</span>
            </label>
            <textarea
              id="series-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Recurring talking points, links, format, sponsors…"
              className={`${field} resize-y`}
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
              {saving ? 'Saving…' : 'Save series'}
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

/**
 * Maps one piece of episode information onto an OBS Text (GDI+) source: a
 * dropdown over the discovered text sources, or a free-text input while OBS
 * is disconnected. "" = not mapped.
 */
function EpisodeSourcePicker({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      {options.length === 0 ? (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="OBS text source name…"
          className={field}
        />
      ) : (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={field}
        >
          <option value="">Not mapped</option>
          {/* A saved name may reference a source OBS no longer has. */}
          {value && !options.includes(value) && (
            <option value={value}>{value} (not found)</option>
          )}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/** Fieldset legend for one service's section: brand tile + service name. */
function ServiceLegend({id}: {id: 'twitch' | 'youtube' | 'kick'}) {
  const svc = SERVICES.find((s) => s.id === id)
  if (!svc) return null
  return (
    <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-fg">
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded"
        style={{backgroundColor: svc.brand}}
      >
        <svc.Icon size={12} className="text-white" />
      </span>
      {svc.name}
    </legend>
  )
}

/** The pickers' field label — the service itself is named by the section. */
function CategoryLabel({htmlFor}: {htmlFor: string}) {
  return (
    <label htmlFor={htmlFor} className={labelCls}>
      Category
    </label>
  )
}

function DisconnectedNote({name}: {name: string}) {
  return (
    <p className="text-xs text-fg-muted">
      Connect {name} in Settings → Services to choose its category.
    </p>
  )
}

/**
 * Search-as-you-type picker over Twitch's category/game catalogue. The chosen
 * category is shown as the input value; typing again reopens the search.
 */
function TwitchCategoryPicker(props: {
  connected: boolean
  value: main.ServiceCategory | null
  onChange: (c: main.ServiceCategory | null) => void
}) {
  return (
    <SearchCategoryPicker
      {...props}
      serviceName="Twitch"
      inputId="series-twitch-category"
      search={SearchTwitchCategories}
    />
  )
}

/**
 * Shared search-as-you-type category picker for the platforms whose
 * catalogues are searched (Twitch games, Kick categories).
 */
function SearchCategoryPicker({
  connected,
  value,
  onChange,
  serviceName,
  inputId,
  search,
}: {
  connected: boolean
  value: main.ServiceCategory | null
  onChange: (c: main.ServiceCategory | null) => void
  serviceName: string
  inputId: string
  search: (query: string) => Promise<main.ServiceCategory[]>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<main.ServiceCategory[]>([])
  const [open, setOpen] = useState(false)
  const [searchError, setSearchError] = useState('')
  const debounce = useRef<number>()

  // Debounced catalogue search; a cleared query just closes the list.
  useEffect(() => {
    window.clearTimeout(debounce.current)
    if (!open || !query.trim()) {
      setResults([])
      return
    }
    debounce.current = window.setTimeout(() => {
      search(query)
        .then((r) => {
          setResults(r ?? [])
          setSearchError('')
        })
        .catch((err) => {
          setResults([])
          setSearchError(
            err instanceof Error && err.message
              ? err.message
              : 'Category search failed.',
          )
        })
    }, 300)
    return () => window.clearTimeout(debounce.current)
  }, [query, open, search])

  if (!connected) {
    return (
      <div>
        <CategoryLabel htmlFor={inputId} />
        <DisconnectedNote name={serviceName} />
      </div>
    )
  }

  return (
    <div className="relative">
      <CategoryLabel htmlFor={inputId} />
      <div className="relative">
        <Search
          size={14}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          id={inputId}
          value={open ? query : value?.name ?? ''}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onBlur={() => {
            // Delay so a click on a result lands before the list closes.
            window.setTimeout(() => setOpen(false), 150)
          }}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${serviceName} categories…`}
          autoComplete="off"
          className={`${field} pl-8`}
        />
        {value && !open && (
          <Check
            size={14}
            aria-hidden
            className="absolute right-3 top-1/2 -translate-y-1/2 text-accent"
          />
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-edge bg-surface py-1 shadow-lg">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                // onMouseDown so it fires before the input's blur.
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(main.ServiceCategory.createFrom(r))
                  setOpen(false)
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-fg transition-colors hover:bg-surface-hover"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchError && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {searchError}
        </p>
      )}
    </div>
  )
}

/** Dropdown over YouTube's fixed list of assignable video categories. */
function YouTubeCategoryPicker({
  connected,
  value,
  onChange,
}: {
  connected: boolean
  value: main.ServiceCategory | null
  onChange: (c: main.ServiceCategory | null) => void
}) {
  const [categories, setCategories] = useState<main.ServiceCategory[]>([])
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!connected) return
    GetYouTubeCategories()
      .then((c) => {
        setCategories(c ?? [])
        setLoadError('')
      })
      .catch((err) => {
        setLoadError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not load YouTube categories.',
        )
      })
  }, [connected])

  if (!connected) {
    return (
      <div>
        <CategoryLabel htmlFor="series-youtube-category" />
        <DisconnectedNote name="YouTube" />
      </div>
    )
  }

  // The saved category may predate the loaded list; keep it selectable.
  const options =
    value && !categories.some((c) => c.id === value.id)
      ? [value, ...categories]
      : categories

  return (
    <div>
      <CategoryLabel htmlFor="series-youtube-category" />
      <select
        id="series-youtube-category"
        value={value?.id ?? ''}
        onChange={(e) => {
          const chosen = options.find((c) => c.id === e.target.value)
          onChange(chosen ? main.ServiceCategory.createFrom(chosen) : null)
        }}
        className={field}
      >
        <option value="">Choose a category…</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {loadError && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}
    </div>
  )
}
