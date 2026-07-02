import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {GetProfile, SaveProfile} from '../../wailsjs/go/main/App'

/** The locally stored user profile. */
export interface Profile {
  name: string
  email: string
}

const EMPTY_PROFILE: Profile = {name: '', email: ''}

interface ProfileContextValue {
  profile: Profile
  setProfile: (profile: Profile) => void
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

export function ProfileProvider({children}: {children: ReactNode}) {
  const [profile, setProfileState] = useState<Profile>(EMPTY_PROFILE)

  // Load the persisted profile from the SQLite-backed store on mount.
  useEffect(() => {
    let cancelled = false
    GetProfile()
      .then((stored) => {
        if (cancelled || !stored) return
        setProfileState({
          name: typeof stored.name === 'string' ? stored.name : '',
          email: typeof stored.email === 'string' ? stored.email : '',
        })
      })
      .catch(() => {
        // Backend unavailable (e.g. plain Vite dev); keep the empty profile.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setProfile = useCallback((next: Profile) => {
    setProfileState(next)
    SaveProfile(next).catch(() => {
      // Ignore persistence failures; the in-session value still applies.
    })
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
