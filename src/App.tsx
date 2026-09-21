import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AnimatePresence, motion } from 'motion/react'
import { EditorDialog } from './renderer/editor/EditorDialog'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Columns2, Copy,
  Download, Eraser, Expand, FolderOpen,
  Link2, ListFilter, Menu, Moon, MoreHorizontal,
  MousePointer2, Pause, PenLine, Play, Plus, Redo2, RotateCcw, Search,
  Settings, SlidersHorizontal, Sparkles, Square, Sun, Trash2, Undo2, WandSparkles,
  X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { assets, navItems } from './mock-data'
import type { Mode, PageKey } from './mock-data'
import { WorkbenchComposer } from './components/ai-input-bar/WorkbenchComposer'
import { CanvasWorkspace } from './components/canvas/CanvasWorkspace'
import { StartScreen } from './renderer/start'
import { SettingsPage } from './renderer/settings/SettingsPage'
import { ProjectSettingsPage } from './renderer/settings/ProjectSettingsPage'
import { TextConversation } from './renderer/text/TextConversation'
import { ImageConversation } from './renderer/image/ImageConversation'
import type { ComposerSubmitHandler } from './components/ai-input-bar/WorkbenchComposer'
import type { ProjectSummary } from './shared/contracts/projects'
import type { ImageEditorLaunch, ImageEditorVersion } from './shared/contracts/editor'
import { getImageApi } from './renderer/settings/image-api'
import { getSettingsApi } from './renderer/settings/settings-api'
import { getLibraryApi } from './renderer/library/library-api'
import { getEditorApi } from './renderer/editor/editor-api'
import { getTextApi } from './renderer/settings/model-api'
import { MemoryLibraryPage, PromptLibraryPage } from './renderer/library/LibraryPages'
import { SavePromptModal } from './renderer/library/SavePromptModal'
import { ProjectDocumentsPage } from './renderer/library/ProjectDocumentsPage'
import { TasksPage } from './renderer/tasks/TasksPage'
import { AssetsLibraryPage } from './renderer/library/AssetsLibraryPage'
import { AgentConversation as RealAgentConversation } from './renderer/agent/AgentConversation'
import { SkillsPage } from './renderer/skills/SkillsPage'
import { SessionHeader } from './renderer/conversation/SessionHeader'
import { flushSessionWrites, getSessionLoadIssues, getSessionPersistenceError, hydrateSessions, loadSessions, renameSession, retrySessionWrites, subscribeSessionChange, updateActiveSession } from './renderer/conversation/session-store'
import type { ConversationCompactionState, SessionMessage, SessionResultCard, WorkspaceSession } from './renderer/conversation/types'
import type { AgentSkillContext, ImageVariationPlan } from './shared/contracts/agent'
import type { ProjectAsset } from './shared/contracts/library'
import { CommandPalette } from './renderer/search/CommandPalette'
import { ProjectSwitcherDropdown } from './renderer/common/ProjectSwitcherDropdown'
import { FeedbackDialog } from './renderer/common/FeedbackDialog'
import { Sidebar } from './renderer/common/Sidebar'
import { RuntimeLogDialog } from './renderer/common/RuntimeLogDialog'
import './renderer/common/runtime-log-dialog.css'
import { getSelectedAssets, subscribeSelectedAssets, publishSelectedAssets } from './renderer/library/asset-selection'
import { publishSelectedPrompt, workspaceModeEvent } from './renderer/library/prompt-selection'
import { SharedResultGallery } from './renderer/conversation/SharedResultGallery'
import { assignResultsToMessages } from './renderer/conversation/result-timeline'
import { estimateConversationUsage, prepareConversationContext, retainSkillContextsAfterCompaction, summarizeConversationWithModel } from './renderer/conversation/context-window'


const pageTitles: Record<PageKey, string> = {
  workspace: '工作台', canvas: '视觉画布', assets: '素材库', documents: '项目文档', prompts: '提示词库',
  skills: '技能', tasks: '任务中心', settings: '项目设置', 'global-settings': '全局模型设置', memory: '记忆',
}

function HoverTip({ label, children, side = 'top' }: { label: string; children: React.ReactElement; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return <Tooltip.Root delayDuration={250}><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side={side} sideOffset={7}>{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}

function IconButton({ label, children, onClick, active = false, className = '' }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean; className?: string }) {
  return <HoverTip label={label}><button type="button" className={`icon-button ${className} ${active ? 'active' : ''}`} onClick={onClick} aria-label={label}>{children}</button></HoverTip>
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

function EmptyHeader({ title, detail, action }: { title: string; detail: string; action: string }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{detail}</p></div><button className="primary small"><Plus size={15} />{action}</button></div>
}


function Topbar({
  title,
  dark,
  onTheme,
  onStart,
  onSettings,
  onSearch,
  project,
}: {
  title: string
  dark: boolean
  onTheme: () => void
  onStart: () => void
  onSettings: () => void
  onSearch: () => void
  project: ProjectSummary
}) {
  return (
    <header className="topbar">
      <div>
        <HoverTip label="返回开始页">
          <button className="back-button" aria-label="返回开始页" onClick={onStart}>
            <ArrowLeft size={16} />
          </button>
        </HoverTip>
        <h1>{title}</h1>
        <Pill>{project.name}</Pill>
      </div>
      <div className="top-actions">
        <button
          type="button"
          className="search-box"
          onClick={onSearch}
          aria-label="全局指令搜索 ⌘ K"
        >
          <Search size={16} />
          <span>搜索项目</span>
          <kbd>⌘ K</kbd>
        </button>
        <IconButton label={dark ? '切换浅色' : '切换深色'} onClick={onTheme}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
        <IconButton label="全局模型设置" onClick={onSettings}>
          <Settings size={18} />
        </IconButton>
      </div>
    </header>
  )
}


function Workspace({
  project,
  onEditor,
  onSavePrompt,
  onCanvas,
  onOpenPrompts,
}: {
  project: ProjectSummary
  onEditor: (input?: ImageEditorLaunch) => void
  onSavePrompt: (content?: string) => void
  onCanvas: () => void
  onOpenPrompts: () => void
}) {
  const [sessionData, setSessionData] = useState(() => loadSessions(project.id))
  const [sessionsReady, setSessionsReady] = useState(false)
  const [persistenceError, setPersistenceError] = useState(() => getSessionPersistenceError(project.id))
  const [loadIssues, setLoadIssues] = useState(() => getSessionLoadIssues(project.id))
  const [retryingPersistence, setRetryingPersistence] = useState(false)
  const [recheckingSessions, setRecheckingSessions] = useState(false)
  const activeSession = sessionData.activeSession
  const mode = activeSession.mode
  const [busy, setBusy] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [editDraft, setEditDraft] = useState<{ id: string; text: string } | undefined>()
  const submitRef = useRef<ComposerSubmitHandler | undefined>(undefined)
  const stopRef = useRef<(() => void) | undefined>(undefined)
  const registerSubmit = useCallback((submit: ComposerSubmitHandler) => { submitRef.current = submit }, [])
  const registerStop = useCallback((stop: (() => void) | undefined) => { stopRef.current = stop }, [])
  const submit = useCallback<ComposerSubmitHandler>((prompt, options) => submitRef.current ? submitRef.current(prompt, options) : Promise.resolve(false), [])
  const stop = useCallback(() => { stopRef.current?.() }, [])
  const editMessage = useCallback((text: string) => setEditDraft({ id: crypto.randomUUID(), text }), [])
  const resultAssignments = useMemo(
    () => assignResultsToMessages(activeSession.messages, activeSession.results),
    [activeSession.messages, activeSession.results],
  )
  const contextUsage = useMemo(
    () => estimateConversationUsage(
      activeSession.messages,
      activeSession.compaction,
      retainSkillContextsAfterCompaction(activeSession.skillContexts, activeSession.messages, activeSession.compaction).map((skill) => skill.instructions),
    ),
    [activeSession.compaction, activeSession.messages, activeSession.skillContexts],
  )
  const renderMessageResults = useCallback((message: SessionMessage) => {
    const resultIds = resultAssignments.get(message.id)
    if (!resultIds?.length) return null
    return (
      <SharedResultGallery
        results={activeSession.results}
        resultIds={resultIds}
        inline
        lastPrompt={activeSession.agentLastPrompt || activeSession.imageLastPrompt}
        onChange={(results) => updateActiveSession(project.id, { results })}
        onCanvas={onCanvas}
        onEditor={onEditor}
        onSavePrompt={(prompt) => onSavePrompt(prompt)}
      />
    )
  }, [activeSession.agentLastPrompt, activeSession.imageLastPrompt, activeSession.results, onCanvas, onEditor, onSavePrompt, project.id, resultAssignments])

  useEffect(() => {
    let disposed = false
    setSessionsReady(false)
    setSessionData(loadSessions(project.id))
    setPersistenceError(getSessionPersistenceError(project.id))
    setLoadIssues(getSessionLoadIssues(project.id))
    const unsubscribe = subscribeSessionChange(() => {
      setSessionData(loadSessions(project.id))
      setPersistenceError(getSessionPersistenceError(project.id))
      setLoadIssues(getSessionLoadIssues(project.id))
    })
    void hydrateSessions(project.id).then((data) => {
      if (!disposed) {
        setSessionData(data)
        setPersistenceError(getSessionPersistenceError(project.id))
        setLoadIssues(getSessionLoadIssues(project.id))
      }
    }).catch((error) => {
      console.error('Failed to load project sessions', error)
    }).finally(() => {
      if (!disposed) setSessionsReady(true)
    })
    return () => { disposed = true; unsubscribe() }
  }, [project.id])

  const retryPersistence = useCallback(async () => {
    setRetryingPersistence(true)
    try {
      await retrySessionWrites(project.id)
    } catch {
      // The store publishes the concrete failure through persistenceError.
    } finally {
      setRetryingPersistence(false)
    }
  }, [project.id])

  const recheckSessions = useCallback(async () => {
    setRecheckingSessions(true)
    try {
      setSessionData(await hydrateSessions(project.id))
      setLoadIssues(getSessionLoadIssues(project.id))
    } catch (error) {
      console.error('Failed to recheck project sessions', error)
    } finally {
      setRecheckingSessions(false)
    }
  }, [project.id])

  useEffect(() => sessionsReady ? getImageApi().onTaskEvent(({ task }) => {
    const current = loadSessions(project.id).activeSession
    if (!current.results.some((result) => result.id === task.id)) return
    updateActiveSession(project.id, {
      results: current.results.map((result) => result.id === task.id ? { ...result, status: task.status, task } : result),
    })
  }) : undefined, [project.id, sessionsReady])

  const setMode = useCallback((nextMode: Mode) => {
    setEditDraft(undefined)
    updateActiveSession(project.id, { mode: nextMode })
  }, [project.id])

  useEffect(() => {
    const selectMode = (event: Event) => {
      const nextMode = (event as CustomEvent<Mode>).detail
      if (nextMode === 'text' || nextMode === 'image' || nextMode === 'agent') setMode(nextMode)
    }
    window.addEventListener(workspaceModeEvent, selectMode)
    return () => window.removeEventListener(workspaceModeEvent, selectMode)
  }, [setMode])

  const handleSessionChange = useCallback((nextSession: WorkspaceSession) => {
    setEditDraft(undefined)
    setSessionData((prev) => ({
      ...prev,
      activeSession: nextSession,
      sessions: prev.sessions.map((s) => (s.id === nextSession.id ? nextSession : s)),
    }))
  }, [])

  const handleAutoTitle = useCallback((title: string) => {
    if (activeSession.title === '新探索对话' || activeSession.title === '新对话' || !activeSession.title) {
      renameSession(project.id, activeSession.id, title)
      handleSessionChange({ ...activeSession, title })
    }
  }, [activeSession, handleSessionChange, project.id])

  const handleTextSessionUpdate = useCallback((data: { messages?: SessionMessage[]; skillContexts?: AgentSkillContext[]; compaction?: ConversationCompactionState }) => {
    updateActiveSession(project.id, data)
  }, [project.id])

  const handleImageSessionUpdate = useCallback((data: { results?: SessionResultCard[]; imagePlan?: ImageVariationPlan | null; imageLastPrompt?: string; messages?: SessionMessage[]; compaction?: ConversationCompactionState }) => {
    updateActiveSession(project.id, data)
  }, [project.id])

  const handleAgentSessionUpdate = useCallback((data: { results?: SessionResultCard[]; agentPlan?: ImageVariationPlan | null; agentLastPrompt?: string; messages?: SessionMessage[]; skillContexts?: AgentSkillContext[]; compaction?: ConversationCompactionState }) => {
    updateActiveSession(project.id, data)
  }, [project.id])

  const compactContext = useCallback(async (): Promise<boolean> => {
    if (busy || compacting) return false
    const candidates = activeSession.messages.filter((message) => !message.pending && !message.error)
    if (candidates.length <= 2) return false
    setCompacting(true)
    try {
      const settings = await getSettingsApi().get().catch(() => null)
      const textModel = settings?.models.find((model) => model.id === settings.defaultTextModelId && model.kind === 'text')
        ?? settings?.models.find((model) => model.kind === 'text')
      const prepared = await prepareConversationContext({
        messages: activeSession.messages,
        ...(activeSession.compaction ? { state: activeSession.compaction } : {}),
        forceCompaction: true,
        ...(textModel ? {
          summarize: (input) => summarizeConversationWithModel(getTextApi(), textModel.id, input),
        } : {}),
      })
      if (!prepared.compacted || !prepared.state) return false
      updateActiveSession(project.id, { compaction: prepared.state })
      return true
    } finally {
      setCompacting(false)
    }
  }, [activeSession.compaction, activeSession.messages, busy, compacting, project.id])

  if (!sessionsReady) {
    return <div className="workspace-layout"><main className="workspace-main" aria-busy="true"><div className="start-state" role="status">正在加载对话…</div></main></div>
  }

  return (
    <div className="workspace-layout">
      <main className="workspace-main">
        <SessionHeader
          projectId={project.id}
          session={activeSession}
          sessions={sessionData.sessions}
          mode={mode}
          onSessionChange={handleSessionChange}
          onModeChange={setMode}
        />
        {persistenceError && (
          <div className="session-persistence-alert" role="alert">
            <AlertTriangle size={16} />
            <span><strong>对话尚未保存</strong><small>{persistenceError}</small></span>
            <button type="button" className="secondary small" onClick={() => void retryPersistence()} disabled={retryingPersistence}>
              <RotateCcw size={14} className={retryingPersistence ? 'spin' : ''} />
              {retryingPersistence ? '正在重试…' : '重试保存'}
            </button>
          </div>
        )}
        {loadIssues.length > 0 && (
          <div className="session-persistence-alert session-recovery-alert" role="alert">
            <AlertTriangle size={16} />
            <span><strong>部分历史对话无法读取</strong><small>发现 {loadIssues.length} 条异常记录，原始数据已保留，没有自动删除或覆盖。</small></span>
            <button type="button" className="secondary small" onClick={() => void recheckSessions()} disabled={recheckingSessions}>
              <RotateCcw size={14} className={recheckingSessions ? 'spin' : ''} />
              {recheckingSessions ? '正在检查…' : '重新检查'}
            </button>
          </div>
        )}
        <div className="thread-scroll">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeSession.id}-${mode}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.18 }}
            >
              {mode === 'text' && (
                <TextConversation
                  conversationId={activeSession.id}
                  initialMessages={activeSession.messages}
                  skillContexts={activeSession.skillContexts}
                  compaction={activeSession.compaction}
                  onSessionUpdate={handleTextSessionUpdate}
                  onAutoTitle={handleAutoTitle}
                  onBusyChange={setBusy}
                  onStopReady={registerStop}
                  onSubmitReady={registerSubmit}
                  onSavePrompt={onSavePrompt}
                  renderMessageResults={renderMessageResults}
                  onEditMessage={editMessage}
                />
              )}
              {mode === 'image' && (
                <ImageConversation
                  initialResults={activeSession.results}
                  initialPlan={activeSession.imagePlan}
                  initialPrompt={activeSession.imageLastPrompt}
                  sessionMessages={activeSession.messages}
                  compaction={activeSession.compaction}
                  onSessionUpdate={handleImageSessionUpdate}
                  onAutoTitle={handleAutoTitle}
                  onBusyChange={setBusy}
                  onStopReady={registerStop}
                  onSubmitReady={registerSubmit}
                  renderMessageResults={renderMessageResults}
                  onEditMessage={editMessage}
                />
              )}
              {mode === 'agent' && (
                <RealAgentConversation
                  conversationId={activeSession.id}
                  initialResults={activeSession.results}
                  initialPlan={activeSession.agentPlan}
                  initialPrompt={activeSession.agentLastPrompt}
                  sessionMessages={activeSession.messages}
                  skillContexts={activeSession.skillContexts}
                  compaction={activeSession.compaction}
                  onSessionUpdate={handleAgentSessionUpdate}
                  onAutoTitle={handleAutoTitle}
                  onBusyChange={setBusy}
                  onStopReady={registerStop}
                  onSubmitReady={registerSubmit}
                  renderMessageResults={renderMessageResults}
                  onEditMessage={editMessage}
                />
              )}
              {activeSession.messages.length === 0 && activeSession.results.length > 0 && (
                <SharedResultGallery
                  results={activeSession.results}
                  lastPrompt={activeSession.agentLastPrompt || activeSession.imageLastPrompt}
                  onChange={(results) => updateActiveSession(project.id, { results })}
                  onCanvas={onCanvas}
                  onEditor={onEditor}
                  onSavePrompt={(prompt) => onSavePrompt(prompt)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <WorkbenchComposer
          mode={mode}
          onMode={setMode}
          agentWriteEnabled={activeSession.agentWriteEnabled}
          onAgentWriteEnabledChange={(agentWriteEnabled) => updateActiveSession(project.id, { agentWriteEnabled })}
          onSubmit={submit}
          onStop={stop}
          onOpenPrompts={onOpenPrompts}
          onCompactContext={compactContext}
          contextUsage={contextUsage}
          busy={busy}
          compacting={compacting}
          editDraft={editDraft}
          onCancelEdit={() => setEditDraft(undefined)}
          onEditSubmitted={() => setEditDraft(undefined)}
        />
      </main>
    </div>
  )
}



function ListPage({
  page,
  project,
  onNavigate,
}: {
  page: PageKey
  project: ProjectSummary
  onNavigate: (page: PageKey) => void
}) {
  if (page === 'documents') return <ProjectDocumentsPage />
  if (page === 'prompts') return <PromptLibraryPage onApplyPrompt={(prompt) => { onNavigate('workspace'); publishSelectedPrompt(prompt, 'image') }} />
  if (page === 'skills') return <SkillsPage />
  if (page === 'tasks') return <TasksPage />
  if (page === 'memory') return <MemoryLibraryPage />
  if (page === 'settings') return <ProjectSettingsPage project={project} onOpenGlobalSettings={() => onNavigate('global-settings')} />
  return <SettingsPage onOpenProjectSettings={() => onNavigate('settings')} />
}

export default function App() {
  const [started, setStarted] = useState(false)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [page, setPage] = useState<PageKey>('workspace')
  const [dark, setDark] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLaunch, setEditorLaunch] = useState<ImageEditorLaunch | undefined>(undefined)
  const [saveOpen, setSaveOpen] = useState(false)
  const [savePromptSeed, setSavePromptSeed] = useState<string | undefined>(undefined)
  const [commandOpen, setCommandOpen] = useState(false)
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.body.classList.toggle('dark', dark)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  // 全局 ⌘ K / Ctrl+K 快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (!started || !project) return <StartScreen onOpenProject={nextProject => { setProject(nextProject); setStarted(true) }} />
  const openEditor = (input?: ImageEditorLaunch) => { setEditorLaunch(input); setEditorOpen(true) }

  return (
    <div className={`app ${dark ? 'dark' : ''}`}>
      <Sidebar
        page={page}
        onPage={setPage}
        collapsed={collapsed}
        onCollapse={() => setCollapsed(v => !v)}
        project={project}
        onOpenProjectSwitcher={() => setProjectSwitcherOpen(true)}
        onOpenLogs={() => setLogsOpen(true)}
        onOpenFeedback={() => setFeedbackOpen(true)}
      />
      <div className="app-main">
        <Topbar
          title={pageTitles[page]}
          project={project}
          dark={dark}
          onTheme={() => setDark(v => !v)}
          onStart={() => { void flushSessionWrites(project.id).then(() => setStarted(false)).catch(() => undefined) }}
          onSettings={() => setPage('global-settings')}
          onSearch={() => setCommandOpen(true)}
        />
        <div style={{ display: page === 'workspace' ? 'contents' : 'none' }}>
          <Workspace
            project={project}
            onEditor={openEditor}
            onSavePrompt={(content) => { setSavePromptSeed(content); setSaveOpen(true) }}
            onCanvas={() => setPage('canvas')}
            onOpenPrompts={() => setPage('prompts')}
          />
        </div>
        {page === 'canvas' && <CanvasWorkspace />}
        {page === 'assets' && <AssetsLibraryPage onEditor={openEditor} />}
        {page !== 'workspace' && page !== 'canvas' && page !== 'assets' && <ListPage page={page} project={project} onNavigate={setPage} />}
      </div>
      <SavePromptModal open={saveOpen} onOpenChange={setSaveOpen} initialContent={savePromptSeed} />
      <EditorDialog open={editorOpen} onOpenChange={setEditorOpen} launch={editorLaunch} />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onNavigate={setPage}
        onToggleTheme={() => setDark(v => !v)}
        dark={dark}
        onOpenNewPrompt={() => setSaveOpen(true)}
        onOpenAssetsImport={() => setPage('assets')}
      />
      <ProjectSwitcherDropdown
        currentProject={project}
        open={projectSwitcherOpen}
        onOpenChange={setProjectSwitcherOpen}
        onSwitchProject={(next) => setProject(next)}
        onBackToStart={() => { void flushSessionWrites(project.id).then(() => setStarted(false)).catch(() => undefined) }}
        onOpenSettings={() => setPage('settings')}
      />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <RuntimeLogDialog open={logsOpen} onOpenChange={setLogsOpen} />
    </div>
  )
}
