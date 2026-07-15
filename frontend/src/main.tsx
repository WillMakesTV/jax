import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import {ThemeProvider} from './theme/ThemeProvider'
import {ProfileProvider} from './profile/ProfileProvider'
import {ServicesProvider} from './services/ServicesProvider'
import {LiveDataProvider} from './live/LiveDataProvider'
import {EventsProvider} from './events/EventsProvider'
import {ChatProvider} from './chat/ChatProvider'
import {TranscriptProvider} from './transcript/TranscriptProvider'
import {VodTranscribeProvider} from './transcript/VodTranscribeProvider'
import {DownloadProvider} from './downloads/DownloadProvider'
import {OutlineProvider} from './outline/OutlineProvider'
import {ClipIdeasProvider} from './clips/ClipIdeasProvider'
import {EditSessionProvider} from './editor/EditSessionProvider'

const container = document.getElementById('root')

const root = createRoot(container!)

root.render(
    <React.StrictMode>
        <ThemeProvider>
            <ProfileProvider>
                <ServicesProvider>
                    <LiveDataProvider>
                        <EventsProvider>
                            <ChatProvider>
                                <TranscriptProvider>
                                    <DownloadProvider>
                                        <VodTranscribeProvider>
                                            <OutlineProvider>
                                                <ClipIdeasProvider>
                                                    <EditSessionProvider>
                                                        <App/>
                                                    </EditSessionProvider>
                                                </ClipIdeasProvider>
                                            </OutlineProvider>
                                        </VodTranscribeProvider>
                                    </DownloadProvider>
                                </TranscriptProvider>
                            </ChatProvider>
                        </EventsProvider>
                    </LiveDataProvider>
                </ServicesProvider>
            </ProfileProvider>
        </ThemeProvider>
    </React.StrictMode>
)
