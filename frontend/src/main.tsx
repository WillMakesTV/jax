import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import {ThemeProvider} from './theme/ThemeProvider'
import {ProfileProvider} from './profile/ProfileProvider'
import {ServicesProvider} from './services/ServicesProvider'
import {LiveDataProvider} from './live/LiveDataProvider'
import {ChatProvider} from './chat/ChatProvider'

const container = document.getElementById('root')

const root = createRoot(container!)

root.render(
    <React.StrictMode>
        <ThemeProvider>
            <ProfileProvider>
                <ServicesProvider>
                    <LiveDataProvider>
                        <ChatProvider>
                            <App/>
                        </ChatProvider>
                    </LiveDataProvider>
                </ServicesProvider>
            </ProfileProvider>
        </ThemeProvider>
    </React.StrictMode>
)
