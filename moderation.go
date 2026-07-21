package main

import (
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Chat moderation
//
// Timeouts, bans, and message deletions applied on the platform the message
// came from, so acting in Jax acts on the real chat — the chatter card in the
// app and in the Unified Chat overlay both drive these.
//
// Twitch works through Helix (moderator:manage:banned_users and
// moderator:manage:chat_messages, requested on connect), YouTube through the
// live-chat bans/messages endpoints of the youtube.force-ssl scope. Kick
// exposes no moderation the app can reach, so it says so plainly rather than
// pretending the action landed.
// ---------------------------------------------------------------------------

// modErrorMessage maps an API failure to something the producer can act on.
func modErrorMessage(platform string, status int, err error) error {
	if status == 401 || status == 403 {
		return fmt.Errorf("missing moderation permission — reconnect %s in Settings → Services to grant it",
			platformLabel(platform))
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("the moderation action failed")
}

// TimeoutChatUser silences a chatter on their own platform: seconds > 0 is a
// timeout, seconds <= 0 a permanent ban. userID is the platform's id for the
// chatter (Twitch user id, YouTube channel id) — the only handle either API
// accepts, so a message that arrived without one cannot be acted on.
func (a *App) TimeoutChatUser(platform, userID string, seconds int, reason string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("this chatter's %s id is unknown — moderate them on the platform",
			platformLabel(platform))
	}
	reason = strings.TrimSpace(reason)

	switch platform {
	case "twitch":
		conn, ok := a.freshConn("twitch")
		if !ok || conn.userID == "" {
			return fmt.Errorf("connect Twitch in Settings → Services first")
		}
		status, err := twitchClient(conn).Ban(userID, seconds, reason)
		if err != nil {
			return modErrorMessage("twitch", status, err)
		}
		return nil

	case "youtube":
		conn, ok := a.freshConn("youtube")
		if !ok {
			return fmt.Errorf("connect YouTube in Settings → Services first")
		}
		chatID := a.resolveYouTubeChatID(conn)
		if chatID == "" {
			return fmt.Errorf("YouTube has no live chat open right now")
		}
		status, err := youtubeClient(conn).BanUser(chatID, userID, seconds)
		if err != nil {
			return modErrorMessage("youtube", status, err)
		}
		return nil
	}

	return fmt.Errorf("%s moderation is not available from Jax — act on the platform",
		platformLabel(platform))
}

// DeleteChatMessage removes one message from the platform's chat and from the
// local log, so it disappears from the app, the overlay, and the stream at
// once. Platforms Jax cannot moderate report that plainly and leave the log
// untouched — the app never pretends a message is gone from the real chat.
func (a *App) DeleteChatMessage(platform, messageID string) error {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return fmt.Errorf("that message has no id to delete")
	}

	switch platform {
	case "twitch":
		conn, ok := a.freshConn("twitch")
		if !ok || conn.userID == "" {
			return fmt.Errorf("connect Twitch in Settings → Services first")
		}
		status, err := twitchClient(conn).DeleteMessage(messageID)
		if err != nil {
			return modErrorMessage("twitch", status, err)
		}

	case "youtube":
		conn, ok := a.freshConn("youtube")
		if !ok {
			return fmt.Errorf("connect YouTube in Settings → Services first")
		}
		status, err := youtubeClient(conn).DeleteChatMessage(messageID)
		if err != nil {
			return modErrorMessage("youtube", status, err)
		}

	default:
		return fmt.Errorf("%s messages cannot be deleted from Jax — remove it on the platform",
			platformLabel(platform))
	}

	// Gone from the platform; drop the local copy so every surface agrees.
	if a.store != nil {
		if err := a.store.deleteChatMessage(platform, messageID); err != nil {
			return err
		}
	}
	return nil
}
