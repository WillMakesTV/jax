package main

import "testing"

func TestGitHubRepoSetting(t *testing.T) {
	a := newTestApp(t)

	// Nothing connected, nothing set.
	if got := a.GetGitHubConnection(); got.Connected || got.Repo != "" {
		t.Fatalf("fresh connection state should be empty: %+v", got)
	}

	if err := a.SetGitHubRepo("WillMakesTV/jax"); err != nil {
		t.Fatalf("set repo: %v", err)
	}
	if got := a.GetGitHubConnection(); got.Repo != "WillMakesTV/jax" {
		t.Fatalf("repo round trip mismatch: %+v", got)
	}

	// Anything that isn't owner/repo is refused.
	for _, bad := range []string{"jax", "https://github.com/WillMakesTV/jax", "owner/", "/repo", "a b/c"} {
		if err := a.SetGitHubRepo(bad); err == nil {
			t.Fatalf("want error for repo %q", bad)
		}
	}

	// Blank clears the setting.
	if err := a.SetGitHubRepo(""); err != nil {
		t.Fatalf("clear repo: %v", err)
	}
	if got := a.GetGitHubConnection(); got.Repo != "" {
		t.Fatalf("repo should be cleared: %+v", got)
	}
}
