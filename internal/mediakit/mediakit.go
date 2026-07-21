// Package mediakit wraps the ffmpeg toolchain the app shells out to: finding
// the binaries, reading a video's properties, and pulling a frame out of one.
//
// Rendering itself stays with the features that do it — a timeline export
// reports progress as it runs, a thumbnail grab does not — but everything
// that is just "ask ffmpeg about a file" lives here, where it needs nothing
// from the app.
package mediakit

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"bp-temp/internal/platform"
)

// FFmpeg returns the ffmpeg binary's path, or an error naming what it is for.
func FFmpeg(purpose string) (string, error) {
	path, err := exec.LookPath("ffmpeg")
	if err != nil {
		if purpose == "" {
			return "", fmt.Errorf("ffmpeg was not found on PATH")
		}
		return "", fmt.Errorf("ffmpeg was not found on PATH — %s", purpose)
	}
	return path, nil
}

// FFprobe returns the ffprobe binary's path. It ships with ffmpeg.
func FFprobe(purpose string) (string, error) {
	path, err := exec.LookPath("ffprobe")
	if err != nil {
		if purpose == "" {
			return "", fmt.Errorf("ffprobe was not found on PATH — it ships with ffmpeg")
		}
		return "", fmt.Errorf("ffprobe was not found on PATH — it ships with ffmpeg and %s", purpose)
	}
	return path, nil
}

// Props are a video's rendering properties: what any clip joined onto it has
// to be normalized to.
type Props struct {
	Width, Height int
	FPS           string // ffmpeg r_frame_rate, e.g. "30000/1001"
	HasAudio      bool
}

// Probe reads a video's dimensions, frame rate, and whether it carries audio.
func Probe(path string) (Props, error) {
	var p Props
	ffprobe, err := FFprobe("is needed to expand segments")
	if err != nil {
		return p, err
	}
	cmd := exec.Command(ffprobe,
		"-v", "error",
		"-show_entries", "stream=codec_type,width,height,r_frame_rate",
		"-of", "json", path)
	platform.HideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return p, fmt.Errorf("could not read %s: %v", filepath.Base(path), err)
	}
	var probed struct {
		Streams []struct {
			CodecType  string `json:"codec_type"`
			Width      int    `json:"width"`
			Height     int    `json:"height"`
			RFrameRate string `json:"r_frame_rate"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &probed); err != nil {
		return p, fmt.Errorf("could not read %s: %v", filepath.Base(path), err)
	}
	for _, s := range probed.Streams {
		switch s.CodecType {
		case "video":
			if p.Width == 0 && s.Width > 0 && s.Height > 0 {
				p.Width, p.Height, p.FPS = s.Width, s.Height, s.RFrameRate
			}
		case "audio":
			p.HasAudio = true
		}
	}
	if p.Width == 0 || p.Height == 0 {
		return p, fmt.Errorf("%s has no video track", filepath.Base(path))
	}
	if p.FPS == "" || p.FPS == "0/0" {
		p.FPS = "30"
	}
	return p, nil
}

// ExtractFrame writes one frame of the video at the given offset as a JPEG,
// scaled down to thumbnail size. Treats a missing/empty output as failure —
// ffmpeg exits 0 on an out-of-range seek while writing nothing.
func ExtractFrame(ffmpeg, video, out string, seekSecs int) error {
	cmd := exec.Command(ffmpeg,
		"-y", "-loglevel", "error",
		"-ss", strconv.Itoa(seekSecs),
		"-i", video,
		"-frames:v", "1",
		"-vf", "scale=640:-2",
		"-q:v", "4",
		out,
	)
	platform.HideWindow(cmd)
	raw, err := cmd.CombinedOutput()
	if err != nil {
		_ = os.Remove(out)
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 300 {
			msg = msg[len(msg)-300:]
		}
		return fmt.Errorf("%s", firstNonEmpty(msg, err.Error()))
	}
	if info, statErr := os.Stat(out); statErr != nil || info.Size() == 0 {
		_ = os.Remove(out)
		return fmt.Errorf("no frame at %ds", seekSecs)
	}
	return nil
}

// firstNonEmpty returns the first value that is not blank.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
