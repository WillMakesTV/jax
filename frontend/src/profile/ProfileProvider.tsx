import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/** The locally stored user profile. */
export interface Profile {
  name: string
  email: string
}

const STORAGE_KEY = 'jax:profile'
const EMPTY_PROFILE: Profile = {name: '', email: ''}

interface ProfileContextValue {
  profile: Profile
  setProfile: (profile: Profile) => void
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

const readStoredProfile = (): Profile => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Profile>
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        email: typeof parsed.email === 'string' ? parsed.email : '',
      }
    }
  } catch {
    // Corrupt or unavailable storage; fall back to an empty profile.
  }
  return EMPTY_PROFILE
}

export function ProfileProvider({children}: {children: ReactNode}) {
  const [profile, setProfileState] = useState<Profile>(readStoredProfile)

  const setProfile = useCallback((next: Profile) => {
    setProfileState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Ignore persistence failures.
    }
  }, [])

  const value = useMemo<ProfileContextValue>(
    () => ({profile, setProfile}),
    [profile, setProfile],
  )

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext)
  if (!context) {
    throw new Error('useProfile must be used within a ProfileProvider')
  }
  return context
}
