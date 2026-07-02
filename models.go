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
