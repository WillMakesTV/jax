package main

import (
	"fmt"
	"testing"
)

// TikTok answers 401 both for an expired token and for a token whose app was
// never granted the scope — and the two need opposite actions. Reconnecting
// fixes the first and cannot possibly fix the second, so the scope case must
// not be swallowed by the 401 case.
func TestTikTokFailureNamesTheRealProblem(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{
			// What the app is still being set up looks like: a valid token,
			// but the app has no Display API product.
			name: "missing scope, carried on a 401",
			err:  fmt.Errorf(`request failed (401): {"error":{"code":"scope_not_authorized","message":"The app has not been authorized for this scope"}}`),
			want: "scopes",
		},
		{
			name: "scope permission missed",
			err:  fmt.Errorf("scope_permission_missed: user did not authorize the scope"),
			want: "scopes",
		},
		{
			name: "genuinely expired token",
			err:  fmt.Errorf(`request failed (401): {"error":{"code":"access_token_invalid"}}`),
			want: "Reconnect",
		},
		{
			name: "a bare 401 with nothing else to go on",
			err:  fmt.Errorf("request failed (401): "),
			want: "Reconnect",
		},
		{
			name: "rate limited",
			err:  fmt.Errorf(`request failed (429): {"error":{"code":"rate_limit_exceeded"}}`),
			want: "rate-limiting",
		},
		{
			name: "the network, not the token",
			err:  fmt.Errorf("dial tcp: lookup open.tiktokapis.com: no such host"),
			want: "Could not reach",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tiktokFailure(tc.err)
			if !contains(got, tc.want) {
				t.Errorf("tiktokFailure(%v)\n got: %q\nwant it to mention: %q", tc.err, got, tc.want)
			}
			// A scope problem must never tell the producer to reconnect —
			// that is the whole point.
			if tc.want == "scopes" && contains(got, "Authentication expired") {
				t.Errorf("a scope error told the producer to reconnect: %q", got)
			}
		})
	}
}

// TikTok's chunking rules are exact, and it rejects the upload outright when
// they are broken ("The chunk size is invalid"). Every plan this produces is
// checked against the rules as TikTok states them — not against what looks
// reasonable.
func TestTikTokChunkPlanObeysTikToksRules(t *testing.T) {
	const MB = 1 << 20

	sizes := []int64{
		1,             // a hair over nothing
		2 * MB,        // under the 5MB floor: one chunk of exactly its size
		5 * MB,        // exactly the floor
		10 * MB,       // the case that was failing: a typical short
		63 * MB,       // just under the single-chunk ceiling
		64 * MB,       // exactly the ceiling
		65 * MB,       // just over: now it really is chunked
		100 * MB,      // remainder rides the last chunk
		127 * MB,      //
		128 * MB,      //
		200 * MB,      //
		1024 * MB,     // a long-form render
		4*1024*MB - 1, // TikTok's 4GB video ceiling
	}

	for _, size := range sizes {
		chunkSize, chunks := tiktokChunkPlan(size)

		// The rule that broke it: TikTok computes the count itself, by floor
		// division. A plan whose count disagrees is refused.
		if want := int(size / chunkSize); chunks != want {
			t.Errorf("size %dMB: count = %d, but TikTok computes floor(%d/%d) = %d",
				size/MB, chunks, size, chunkSize, want)
		}
		if chunks < 1 {
			t.Errorf("size %dMB: count = %d, want at least one chunk", size/MB, chunks)
		}
		// A chunk bigger than the file is what produced a zero count.
		if chunkSize > size {
			t.Errorf("size %d: chunk_size %d exceeds the video itself", size, chunkSize)
		}

		if size <= tiktokChunkMax {
			// Small enough to go whole. chunk_size is the file itself — which
			// is also what satisfies TikTok's under-5MB special case.
			if chunkSize != size || chunks != 1 {
				t.Errorf("size %d: want one chunk of the whole file, got %d chunks of %d",
					size, chunks, chunkSize)
			}
			continue
		}

		// Genuinely chunked. chunk_size must sit inside TikTok's 5MB–64MB band
		// — it may not be the file's size, because the file is bigger than the
		// band allows.
		if chunkSize < tiktokChunkMin || chunkSize > tiktokChunkMax {
			t.Errorf("size %dMB: chunk_size %dMB is outside TikTok's 5–64MB band",
				size/MB, chunkSize/MB)
		}
		// The last chunk carries the remainder, so it is the only one that may
		// exceed chunk_size — and it must stay under TikTok's 128MB ceiling.
		last := size - int64(chunks-1)*chunkSize
		if last > tiktokLastMax {
			t.Errorf("size %dMB: the final chunk is %dMB, over TikTok's 128MB ceiling",
				size/MB, last/MB)
		}
		if last < chunkSize {
			t.Errorf("size %dMB: the final chunk (%d) is smaller than a chunk (%d) — the remainder was dropped",
				size/MB, last, chunkSize)
		}
		if chunks > 1000 {
			t.Errorf("size %dMB: %d chunks, over TikTok's 1000-chunk limit", size/MB, chunks)
		}
	}
}

// The upload has to hand TikTok exactly the chunks the init call promised, and
// together they must cover the file with no gap and no overlap.
func TestTikTokChunksCoverTheWholeFileExactly(t *testing.T) {
	const MB = 1 << 20
	for _, size := range []int64{2 * MB, 10 * MB, 64 * MB, 100 * MB, 200 * MB} {
		chunkSize, chunks := tiktokChunkPlan(size)

		var covered int64
		var prevEnd int64 = -1
		for i := 0; i < chunks; i++ {
			start := int64(i) * chunkSize
			end := start + chunkSize - 1
			if i == chunks-1 {
				end = size - 1
			}
			if start != prevEnd+1 {
				t.Errorf("size %dMB: chunk %d starts at %d, leaving a gap after %d",
					size/MB, i, start, prevEnd)
			}
			covered += end - start + 1
			prevEnd = end
		}
		if covered != size {
			t.Errorf("size %dMB: the chunks cover %d bytes of %d", size/MB, covered, size)
		}
		if prevEnd != size-1 {
			t.Errorf("size %dMB: the last byte sent is %d, want %d", size/MB, prevEnd, size-1)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 ||
		len(haystack) >= len(needle) &&
			indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
