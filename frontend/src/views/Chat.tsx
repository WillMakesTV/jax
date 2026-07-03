import {ChatPanel} from '../chat/ChatPanel'
import {useChat} from '../chat/ChatProvider'
import {PageHeader} from '../components/PageHeader'
import {StatusPill} from '../live/LiveOverview'

/**
 * Full-page aggregated live chat across every channel currently broadcasting.
 * The panel opens scrolled to the newest messages, marks messages read while
 * displayed and focused, and can broadcast a message to all channels.
 */
export function Chat() {
  const {active} = useChat()
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Chat"
        description="Live chat from all your channels, aggregated in one stream."
        actions={
          <StatusPill live={active} label={active ? 'Connected' : 'Offline'} />
        }
      />
      <ChatPanel />
    </div>
  )
}
