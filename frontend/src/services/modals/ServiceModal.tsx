import {
  PollTwitchDeviceAuth,
  PollYouTubeDeviceAuth,
  StartTwitchDeviceAuth,
  StartYouTubeDeviceAuth,
} from '../../../wailsjs/go/main/App'
import {Modal} from '../../components/Modal'
import type {ServiceDef} from '../services'
import {DeviceAuthForm} from './DeviceAuthForm'
import {ObsConnectForm} from './ObsConnectForm'

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

      {service?.id === 'twitch' && (
        <DeviceAuthForm
          service={service}
          requiresSecret={false}
          clientIdHint={
            <ExternalHint href="https://dev.twitch.tv/console/apps">
              From the Twitch Developer Console.
            </ExternalHint>
          }
          start={(clientId) => StartTwitchDeviceAuth(clientId, '')}
          poll={(deviceCode, clientId) =>
            PollTwitchDeviceAuth(clientId, deviceCode, '')
          }
        />
      )}

      {service?.id === 'youtube' && (
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
      )}
    </Modal>
  )
}
