package main

import (
	"encoding/json"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// API caching policy
//
// Only live/real-time data (current broadcast metrics, chat) is fetched from
// the platform APIs on every call. Everything else — video lists, past
// broadcasts, per-video analytics — is served from the SQLite cache for up to
// apiCacheTTL, with an explicit force-refresh escape hatch surfaced in the UI.
// ---------------------------------------------------------------------------

// apiCacheTTL is how long cached (non-realtime) API data stays fresh.
const apiCacheTTL = time.Hour

// cachedJSON returns the cached value for key when it is fresher than ttl and
// force is false. Otherwise it runs fetch, caches the JSON-encoded result, and
// returns it. When fetch fails, any cached copy — however stale — is returned
// instead so the UI degrades to old data rather than nothing.
func cachedJSON[T any](a *App, key string, ttl time.Duration, force bool, fetch func() (T, error)) (val T, fetchedAt time.Time, fromCache bool, err error) {
	readCache := func() (T, time.Time, bool) {
		var out T
		if a.store == nil {
			return out, time.Time{}, false
		}
		raw, at, ok, err := a.store.getCacheEntry(key)
		if err != nil || !ok {
			return out, time.Time{}, false
		}
		if err := json.Unmarshal([]byte(raw), &out); err != nil {
			return out, time.Time{}, false
		}
		return out, at, true
	}

	if !force {
		if cached, at, ok := readCache(); ok && time.Since(at) < ttl {
			return cached, at, true, nil
		}
	}

	fresh, err := fetch()
	if err != nil {
		// Fall back to a stale copy when the platforms are unreachable.
		if cached, at, ok := readCache(); ok {
			return cached, at, true, nil
		}
		var zero T
		return zero, time.Time{}, false, err
	}

	if a.store != nil {
		if raw, err := json.Marshal(fresh); err == nil {
			_ = a.store.setCacheEntry(key, string(raw))
		}
	}
	return fresh, time.Now(), false, nil
}

// connsCacheKey scopes a cache key to the set of connected OAuth services, so
// connecting or disconnecting a platform naturally invalidates cached lists
// instead of hiding the new platform's content for up to a TTL.
func (a *App) connsCacheKey(base string) string {
	a.mu.Lock()
	names := make([]string, 0, len(a.conns))
	for name := range a.conns {
		names = append(names, name)
	}
	a.mu.Unlock()
	sort.Strings(names)
	return base + "|" + strings.Join(names, ",")
}
