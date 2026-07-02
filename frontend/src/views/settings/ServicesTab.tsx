import clsx from 'clsx'
import {useState} from 'react'
import {ServiceModal} from '../../services/modals/ServiceModal'
import {SERVICES, type ServiceDef} from '../../services/services'
import {useServices} from '../../services/ServicesProvider'

function StatusBadge({connected}: {connected: boolean}) {
  return (
    <span
      className={clsx(
        'mt-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        connected
          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
          : 'bg-surface-hover text-fg-muted',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'h-1.5 w-1.5 rounded-full',
          connected ? 'bg-green-600 dark:bg-green-400' : 'bg-fg-muted',
        )}
      />
      {connected ? 'Connected' : 'Not connected'}
    </span>
  )
}

export function ServicesTab() {
  const {statuses} = useServices()
  const [active, setActive] = useState<ServiceDef | null>(null)

  return (
    <>
      <p className="mb-4 max-w-2xl text-sm text-fg-muted">
        Connect Jax to the services you use. Select a service to set
        up its connection.
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {SERVICES.map((service) => {
          const Logo = service.Icon
          const status = statuses[service.id]
          return (
            <button
              key={service.id}
              type="button"
              onClick={() => setActive(service)}
              className="flex min-h-[11rem] flex-col items-start gap-3 rounded-xl border border-edge bg-surface p-4 text-left transition-colors hover:bg-surface-hover"
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
                style={{backgroundColor: service.brand}}
              >
                <Logo size={26} />
              </span>
              <div>
                <p className="text-sm font-semibold text-fg">{service.name}</p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {status.connected && status.account
                    ? status.account
                    : service.description}
                </p>
              </div>
              <StatusBadge connected={status.connected} />
            </button>
          )
        })}
      </div>

      <ServiceModal service={active} onClose={() => setActive(null)} />
    </>
  )
}
