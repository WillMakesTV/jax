import {useEffect, useState} from 'react'
import {
  GetServiceStatuses,
  ListFacebookPages,
  PollFacebookDeviceAuth,
  PollTwitchDeviceAuth,
  PollYouTubeDeviceAuth,
  SelectFacebookPage,
  StartFacebookDeviceAuth,
  StartTwitchDeviceAuth,
  StartYouTubeDeviceAuth,
} from '../../../wailsjs/go/main/App'
import {main} from '../../../wailsjs/go/models'
import {useServices} from '../ServicesProvider'
import {errorMessage} from './shared'
import {Modal} from '../../components/Modal'
import {SETTING_KEYS, loadSetting, saveSetting} from '../../lib/settings'
import type {ServiceDef} from '../services'
import {AnthropicConnectForm} from './AnthropicConnectForm'
import {DeviceAuthForm} from './DeviceAuthForm'
import {InstagramConnectForm} from './InstagramConnectForm'
import {KickConnectForm} from './KickConnectForm'
import {ObsConnectForm} from './ObsConnectForm'
import {OpenAIConnectForm} from './OpenAIConnectForm'
import {TikTokConnectForm} from './TikTokConnectForm'
import {XConnectForm} from './XConnectForm'

/**
 * Twitch scopes requested on connect: sending chat as the broadcaster
 * (broadcast messages), follower/subscriber lookups (chat user popup and
 * follow events), bits:read for cheer events, and channel:manage:broadcast
 * to push a planned stream's title/category before going live.
 */
const TWITCH_SCOPES =
  'user:write:chat moderator:read:followers channel:read:subscriptions bits:read channel:manage:broadcast'

const ExternalHint = ({href, children}: {href: string; children: string}) => (
  <>
    {children}{' '}
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline"
    >
      Register an app
    </a>
    .
  </>
)

export function ServiceModal({
  service,
  onClose,
}: {
  service: ServiceDef | null
  onClose: () => void
}) {
  const Logo = service?.Icon
  const icon = service && Logo && (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
      style={{backgroundColor: service.brand}}
    >
      <Logo size={18} />
    </span>
  )

  return (
    <Modal
      open={service !== null}
      onClose={onClose}
      title={service ? `Connect ${service.name}` : ''}
      icon={icon}
    >
      {service?.id === 'obs' && <ObsConnectForm onClose={onClose} />}

      {service?.id === 'anthropic' && <AnthropicConnectForm />}

      {service?.id === 'openai' && <OpenAIConnectForm />}

      {service?.id === 'twitch' && (
        <DeviceAuthForm
          service={service}
          requiresSecret={false}
          idConfigKey="twitchClientId"
          clientIdHint={
            <ExternalHint href="https://dev.twitch.tv/console/apps">
              From the Twitch Developer Console.
            </ExternalHint>
          }
          start={(clientId) => StartTwitchDeviceAuth(clientId, TWITCH_SCOPES)}
          poll={(deviceCode, clientId) =>
            PollTwitchDeviceAuth(clientId, deviceCode, TWITCH_SCOPES)
          }
        />
      )}

      {service?.id === 'kick' && <KickConnectForm service={service} />}

      {service?.id === 'facebook' && (
        <>
          <DeviceAuthForm
            service={service}
            requiresSecret
            idConfigKey="facebookAppId"
            secretConfigKey="facebookClientToken"
            idLabel="App ID"
            secretLabel="Client Token"
            clientIdHint={
              <ExternalHint href="https://developers.facebook.com/apps/">
                A Meta app; the Client Token is under Settings → Advanced (not
                the App Secret).
              </ExternalHint>
            }
            start={(appId, clientToken) =>
              StartFacebookDeviceAuth(appId, clientToken)
            }
            poll={(code, appId, clientToken) =>
              PollFacebookDeviceAuth(appId, clientToken, code)
            }
          />
          <FacebookPagePicker />
        </>
      )}

      {service?.id === 'instagram' && <InstagramConnectForm />}

      {service?.id === 'x' && <XConnectForm service={service} />}

      {service?.id === 'tiktok' && <TikTokConnectForm service={service} />}

      {service?.id === 'youtube' && (
        <>
          <DeviceAuthForm
            service={service}
            requiresSecret
            idConfigKey="youtubeClientId"
            secretConfigKey="youtubeClientSecret"
            clientIdHint={
              <ExternalHint href="https://console.cloud.google.com/apis/credentials">
                A "TV and Limited Input" OAuth client in Google Cloud.
              </ExternalHint>
            }
            start={(clientId) => StartYouTubeDeviceAuth(clientId)}
            poll={(deviceCode, clientId, clientSecret) =>
              PollYouTubeDeviceAuth(clientId, clientSecret, deviceCode)
            }
          />
          <YouTubeApiKeyField />
        </>
      )}
    </Modal>
  )
}

/**
 * Which managed Facebook Page the app works as. Multi-Page accounts
 * previously got whatever Page Facebook listed first; this picker switches
 * the working Page (the linked Instagram account re-derives from it).
 */
function FacebookPagePicker() {
  const {statuses, setStatus} = useServices()
  const connected = statuses.facebook.connected

  const [pages, setPages] = useState<main.FBPageInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!connected) {
      setPages([])
      return
    }
    ListFacebookPages()
      .then((p) => setPages(p ?? []))
      .catch((err) =>
        setError(errorMessage(err, 'Could not list your Pages.')),
      )
  }, [connected])

  if (!connected || pages.length < 2) return null

  const select = (id: string) => {
    setBusy(true)
    setError('')
    SelectFacebookPage(id)
      .then((s) => {
        setStatus('facebook', {connected: s.connected, account: s.account})
        setPages((prev) => prev.map((p) => ({...p, selected: p.id === id})))
        // Switching Pages re-derives (or drops) the Instagram link on the
        // backend; mirror its outcome.
        return GetServiceStatuses().then((all) => {
          const ig = (all ?? []).find((x) => x.name === 'instagram')
          if (ig) {
            setStatus('instagram', {connected: ig.connected, account: ig.account})
          }
        })
      })
      .catch((err) =>
        setError(errorMessage(err, 'Could not switch the Page.')),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="mt-5 border-t border-edge pt-5">
      <p className="text-sm font-semibold text-fg">Page to work as</p>
      <p className="mt-1 text-xs text-fg-muted">
        Live videos, chat, announcements, and the video catalogue all belong
        to this Page. Switching also re-links Instagram from the new Page.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {pages.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={busy || p.selected}
              onClick={() => select(p.id)}
              className={
                p.selected
                  ? 'w-full rounded-lg border border-accent bg-accent/10 px-3 py-2 text-left text-sm font-semibold text-fg'
                  : 'w-full rounded-lg border border-edge bg-bg px-3 py-2 text-left text-sm text-fg transition-colors hover:bg-surface-hover disabled:opacity-50'
              }
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {p.name}
                  {p.selected && (
                    <span className="ml-2 text-xs font-medium text-accent">
                      current
                    </span>
                  )}
                </span>
                <span
                  className={
                    p.instagram
                      ? 'shrink-0 text-xs font-medium text-green-600 dark:text-green-400'
                      : 'shrink-0 text-xs text-fg-muted'
                  }
                >
                  {p.instagram ? `IG @${p.instagram}` : 'no Instagram'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

/**
 * Optional Google API key stored alongside the YouTube connection. The
 * device-code sign-in can't grant the scope needed to read comments, so a key
 * with the YouTube Data API v3 enabled unlocks them.
 */
function YouTubeApiKeyField() {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSetting(SETTING_KEYS.youtubeApiKey).then((v) => setValue(v ?? ''))
  }, [])

  const save = () => {
    saveSetting(SETTING_KEYS.youtubeApiKey, value.trim())
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2_000)
  }

  return (
    <div className="mt-5 border-t border-edge pt-5">
      <label
        htmlFor="youtube-api-key"
        className="text-sm font-semibold text-fg"
      >
        API key <span className="font-normal text-fg-muted">(optional)</span>
      </label>
      <p className="mt-1 text-xs text-fg-muted">
        Enables loading public comments on YouTube videos. Create a key with the
        YouTube Data API v3 enabled in the Google Cloud console.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          id="youtube-api-key"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
          placeholder="AIza…"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={save}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          Save
        </button>
      </div>
      {saved && (
        <p className="mt-2 text-xs text-green-600 dark:text-green-400">
          ✓ Saved.
        </p>
      )}
    </div>
  )
}
