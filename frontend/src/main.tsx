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
import {AiQueueProvider} from './ai/AiQueueProvider'
import {ClipIdeasProvider} from './clips/ClipIdeasProvider'
import {PlanAiProvider} from './plans/PlanAiProvider'
import {ProjectThumbsProvider} from './projects/ProjectThumbsProvider'
import {SponsorAiProvider} from './sponsors/SponsorAiProvider'
import {EditSessionProvider} from './editor/EditSessionProvider'
import {InspirationProvider} from './inspiration/InspirationProvider'

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
                                                <AiQueueProvider>
                                                    <ClipIdeasProvider>
                                                        <PlanAiProvider>
                                                            <ProjectThumbsProvider>
                                                                <SponsorAiProvider>
                                                                    <EditSessionProvider>
                                                                        <InspirationProvider>
                                                                            <App/>
                                                                        </InspirationProvider>
                                                                    </EditSessionProvider>
                                                                </SponsorAiProvider>
                                                            </ProjectThumbsProvider>
                                                        </PlanAiProvider>
                                                    </ClipIdeasProvider>
                                                </AiQueueProvider>
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
