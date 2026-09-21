import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, Cpu, Database, Info, ShieldCheck, X } from 'lucide-react'
import { APP_VERSION } from '../../shared/app-version'

export interface FeedbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const copyDiagnostics = async () => {
    const info = {
      app: 'Latent Studio',
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      storage: 'SQLite local-first',
      runtime: 'Electron 44 + React 19',
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(info, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay feedback-dialog-overlay" />
        <Dialog.Content className="dialog-content feedback-dialog-content">
          <div className="dialog-head">
            <div>
              <Dialog.Title>关于与运行诊断</Dialog.Title>
              <Dialog.Description>Latent Studio · 本地优先 AI 视觉分镜工作站</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="关闭">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <div className="feedback-body">
            <div className="feedback-badge-row">
              <div className="feedback-badge">
                <ShieldCheck size={16} />
                <span>Local-First 原生隔离</span>
              </div>
              <div className="feedback-badge">
                <Database size={16} />
                <span>SQLite 本地存储</span>
              </div>
              <div className="feedback-badge">
                <Cpu size={16} />
                <span>受控 Skill 执行</span>
              </div>
            </div>

            <div className="feedback-section">
              <h4>系统运行规范</h4>
              <p>
                本项目严格遵循 macOS 本地优先原则与进程安全边界：主进程管理模型调用、SQLite
                和凭证，渲染层仅接收受限的业务指令。所有剧本、素材与生成结果均保存在本地项目目录中。
              </p>
            </div>

            <div className="feedback-section">
              <h4>版本与环境</h4>
              <dl className="feedback-meta-grid">
                <div>
                  <dt>应用版本</dt>
                  <dd>v{APP_VERSION} (Production Shell)</dd>
                </div>
                <div>
                  <dt>运行核心</dt>
                  <dd>Electron 44 / Node 24</dd>
                </div>
                <div>
                  <dt>界面框架</dt>
                  <dd>React 19 + Konva 9</dd>
                </div>
                <div>
                  <dt>设计语言</dt>
                  <dd>Graphite Tech Console</dd>
                </div>
              </dl>
            </div>
          </div>

          <footer>
            <button
              type="button"
              className="secondary"
              onClick={() => void copyDiagnostics()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? '已复制诊断信息' : '复制诊断环境信息'}</span>
            </button>
            <Dialog.Close asChild>
              <button type="button" className="primary">
                确定
              </button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
