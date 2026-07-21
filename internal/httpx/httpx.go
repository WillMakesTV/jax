// Package httpx is the JSON-over-HTTP layer every platform API in the app
// talks through: one shared client, one way to send an authenticated request,
// and one shape of error when a call comes back wrong.
//
// It knows nothing about Twitch, YouTube or Kick — callers pass the endpoint
// and their own auth headers — so the service files stay about the service.
package httpx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is the shared client for platform API calls. Twenty seconds is
// generous for a metadata request and short enough that a hung endpoint does
// not stall a poll.
var Client = &http.Client{Timeout: 20 * time.Second}

// GetJSON performs an authenticated GET and decodes the JSON response into
// out. Returns the status code alongside any error, so callers can tell an
// expired token from a network failure.
func GetJSON(endpoint string, headers map[string]string, out any) (int, error) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, err
	}
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, statusError(resp.StatusCode, body)
	}
	return resp.StatusCode, json.Unmarshal(body, out)
}

// PostJSON performs an authenticated POST with a JSON body and decodes the
// JSON response into out (which may be nil). Any 2xx counts as success.
func PostJSON(endpoint string, headers map[string]string, payload any, out any) (int, error) {
	return SendJSON(http.MethodPost, endpoint, headers, payload, out)
}

// PatchJSON performs an authenticated PATCH with a JSON body. Any 2xx counts
// as success (Twitch's channel update answers 204 No Content).
func PatchJSON(endpoint string, headers map[string]string, payload any) (int, error) {
	return SendJSON(http.MethodPatch, endpoint, headers, payload, nil)
}

// DeleteResource performs an authenticated DELETE with no body. Any 2xx
// counts as success (Twitch and YouTube both answer 204 No Content when a
// chat message or ban is removed).
func DeleteResource(endpoint string, headers map[string]string) (int, error) {
	req, err := http.NewRequest(http.MethodDelete, endpoint, nil)
	if err != nil {
		return 0, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return resp.StatusCode, statusError(resp.StatusCode, body)
	}
	return resp.StatusCode, nil
}

// SendJSON performs an authenticated request with a JSON body and decodes the
// JSON response into out (which may be nil). Any 2xx counts as success.
func SendJSON(method, endpoint string, headers map[string]string, payload any, out any) (int, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequest(method, endpoint, bytes.NewReader(raw))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := Client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return resp.StatusCode, statusError(resp.StatusCode, body)
	}
	if out == nil {
		return resp.StatusCode, nil
	}
	return resp.StatusCode, json.Unmarshal(body, out)
}

// statusError shapes a failed response into an error carrying enough of the
// body to be diagnosable, without pasting a whole HTML error page into a
// toast.
func statusError(status int, body []byte) error {
	msg := string(body)
	if len(msg) > 200 {
		msg = msg[:200]
	}
	return fmt.Errorf("request failed (%d): %s", status, msg)
}
