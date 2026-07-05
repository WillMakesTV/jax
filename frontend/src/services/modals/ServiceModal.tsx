import {useEffect, useState} from 'react'
import {
  PollTwitchDeviceAuth,
  PollYouTubeDeviceAuth,
  StartTwitchDeviceAuth,
  StartYouTubeDeviceAuth,
} from '../../../wailsjs/go/main/App'
import {Modal} from '../../components/Modal'
import {SETTING_KEYS, loadSetting, saveSetting} from '../../lib/settings'
import type {ServiceDef} from '../services'
import {AnthropicConnectForm} from './AnthropicConnectForm'
import {DeviceAuthForm} from './DeviceAuthForm'
import {ObsConnectForm} from './ObsConnectForm'

/**
 * Twitch scopes requested on connect: sending chat as the broadcaster
 * (broadcast messages), follower/subscriber lookups (chat user popup and
 * follow events), and bits:read for cheer events.
 */
const TWITCH_SCOPES =
  'user:write:chat moderator:read:followers channel:read:subscriptions bits:read'

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

      {service?.id === 'twitch' && (
        <DeviceAuthForm
          service={service}
          requiresSecret={false}
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

      {service?.id === 'youtube' && (
        <>
          <DeviceAuthForm
            service={service}
            requiresSecret
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
