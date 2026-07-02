package main

// ChannelSource represents an external channel (e.g. a streaming platform
// account) that a Stream can be associated with.
type ChannelSource struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Account string `json:"account"`
}

// Stream represents a planned stream and its associated metadata.
//
// ChannelSource is modelled as an embedded value for now. Once persistence is
// introduced this is expected to become an ID-based reference to a stored
// ChannelSource record.
type Stream struct {
	Title         string        `json:"title"`
	Description   string        `json:"description"`
	ChannelSource ChannelSource `json:"channelSource"`
	Plan          string        `json:"plan"`
}

// Profile is the locally stored user profile. It is persisted in the SQLite
// database under ~/.jax rather than in the browser's localStorage.
type Profile struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// ServiceConfig holds the connection settings the Settings → Services modals
// prefill from. Client IDs are not secrets; the Google client secret and OBS
// password are stored here for usability — acceptable for a local single-user
// app, but a future version should move secrets to the OS keychain.
type ServiceConfig struct {
	TwitchClientID      string `json:"twitchClientId"`
	YouTubeClientID     string `json:"youtubeClientId"`
	YouTubeClientSecret string `json:"youtubeClientSecret"`
	ObsHost             string `json:"obsHost"`
	ObsPort             string `json:"obsPort"`
	ObsPassword         string `json:"obsPassword"`
	// ObsAutoConnect makes the frontend re-establish the OBS WebSocket on
	// launch; set when a connection succeeds, cleared on manual disconnect.
	ObsAutoConnect bool `json:"obsAutoConnect"`
}
