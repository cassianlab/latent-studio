import { useEffect, useState } from 'react'
import { RotateCcw, SquareMousePointer } from 'lucide-react'
import type { WindowClosePreference } from '../../shared/contracts/window-lifecycle'
import { getWindowLifecycleApi } from './window-lifecycle-api'

const labels: Record<WindowClosePreference, string> = {
  ask: '每次询问',
  minimize: '最小化窗口',
  quit: '彻底关闭',
}

export function WindowCloseSettings(): React.ReactElement {
  const [preference, setPreference] = useState<WindowClosePreference | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getWindowLifecycleApi().getPreference().then((value) => {
      if (active) setPreference(value)
    }, () => {
      if (active) setError('无法读取窗口关闭偏好')
    })
    return () => { active = false }
  }, [])

  const reset = async () => {
    setBusy(true)
    setError(null)
    try {
      setPreference(await getWindowLifecycleApi().setPreference('ask'))
    } catch {
      setError('重置失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="window-close-settings" aria-label="窗口关闭行为">
      <span className="window-close-settings-icon"><SquareMousePointer size={17} /></span>
      <div>
        <strong>窗口关闭行为</strong>
        <p>当前：{preference ? labels[preference] : '正在读取…'}。Command + Q 始终彻底退出。</p>
        {error && <small role="alert">{error}</small>}
      </div>
      <button type="button" className="secondary small" disabled={busy || preference === 'ask'} onClick={() => void reset()}>
        <RotateCcw size={13} className={busy ? 'spin' : ''} />
        {busy ? '重置中…' : '重置为每次询问'}
      </button>
    </section>
  )
}
