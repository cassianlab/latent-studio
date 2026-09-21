import React from 'react'
import ReactDOM from 'react-dom/client'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import './styles.css'
import './workbench-ui.css'
import './styles-motion.css'
import './renderer/conversation/conversation.css'
import App from './App'
import { flushAllSessionWrites } from './renderer/conversation/session-store'
import { WindowCloseDialog } from './renderer/common/WindowCloseDialog'

window.latentStudio?.conversations.onFlushRequested(flushAllSessionWrites)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
      <WindowCloseDialog />
    </TooltipProvider>
  </React.StrictMode>,
)
