import {Check, Eye, EyeOff} from 'lucide-react'
import {useState, type FormEvent} from 'react'
import {Avatar} from '../components/Avatar'
import {PageHeader} from '../components/PageHeader'
import {useProfile} from '../profile/ProfileProvider'

export function Profile() {
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
    <div className="flex h-full flex-col">
      <PageHeader description="Set your name and the email used for your avatar." />

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
    </div>
  )
}
