import {SERVICES} from '../../services/services'
import {ServiceCardGrid} from './ServiceCards'

/** AI providers that power assistant features, connected like any service. */
export function AiTab() {
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-fg-muted">
        Connect the AI services that power assistant features. Signing in with
        your Claude or ChatGPT account is recommended; an API key also works.
      </p>

      <ServiceCardGrid
        services={SERVICES.filter((s) => s.category === 'ai')}
      />
    </>
  )
}
