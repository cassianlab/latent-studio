import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { LogOut, Minus, X } from 'lucide-react'
import type { WindowCloseAction, WindowCloseDecision } from '../../shared/contracts/window-lifecycle'
import { getWindowLifecycleApi } from '../settings/window-lifecycle-api'
import './WindowCloseDialog.css'

export function WindowCloseDialog(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)
  const resolveRef = useRef<((decision: WindowCloseDecision) => void) | null>(null)

  useEffect(() => getWindowLifecycleApi().onCloseIntent(() => new Promise<WindowCloseDecision>((resolve) => {
    resolveRef.current?.({ action: 'cancel', remember: false })
    resolveRef.current = resolve
    setRemember(false)
    setOpen(true)
  })), [])

  const decide = (action: WindowCloseAction) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setOpen(false)
    resolve?.({ action, remember: action === 'cancel' ? false : remember })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) decide('cancel') }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay window-close-overlay" />
        <Dialog.Content className="dialog-content window-close-dialog" onEscapeKeyDown={(event) => { event.preventDefault(); decide('cancel') }}>
          <div className="dialog-head">
            <div>
              <Dialog.Title>关闭 Latent Studio？</Dialog.Title>
              <Dialog.Description>选择保持后台任务运行，或安全保存后彻底退出。</Dialog.Description>
            </div>
            <button type="button" className="icon-button" aria-label="取消关闭" onClick={() => decide('cancel')}>
              <X size={17} />
            </button>
          </div>

          <div className="window-close-options">
            <button type="button" className="window-close-option" onClick={() => decide('minimize')}>
              <span className="window-close-option-icon"><Minus size={18} /></span>
              <span><strong>最小化窗口</strong><small>隐藏当前窗口，任务和队列继续运行</small></span>
            </button>
            <button type="button" className="window-close-option danger" onClick={() => decide('quit')}>
              <span className="window-close-option-icon"><LogOut size={17} /></span>
              <span><strong>彻底关闭</strong><small>保存会话并执行安全清理后退出应用</small></span>
            </button>
          </div>

          <label className="window-close-remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span><strong>记住我的选择</strong><small>可在全局设置中重置</small></span>
          </label>
          <p className="window-close-command-note">Command + Q 始终直接执行安全退出，不受此选择影响。</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
