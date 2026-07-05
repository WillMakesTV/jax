import {SERVICES} from '../../services/services'
import {ServiceCardGrid} from './ServiceCards'

/** Streaming and production connections; AI services live on the AI tab. */
export function ServicesTab() {
  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-fg-muted">
        Connect Jax to the services you use. Select a service to set
        up its connection.
      </p>

      <ServiceCardGrid
        services={SERVICES.filter((s) => s.category !== 'ai')}
      />
    </>
  )
}
