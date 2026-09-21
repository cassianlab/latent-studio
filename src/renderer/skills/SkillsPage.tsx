import { useEffect, useMemo, useState } from 'react'
import { Check, Command, Download, LoaderCircle, Link2, Pencil, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import type { SkillInstallation, SkillScope, SkillTrustMode } from '../../shared/contracts/skills'
import { getSkillApi } from './skill-api'
import { HoverTip } from '../common/HoverTip'

const sourceLabels: Record<SkillInstallation['source'], string> = { link: '链接', install: '已安装', builtin: '内置' }

function errorMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback }

function SkillEditor({ item, busy, onClose, onSave }: {
  item: SkillInstallation
  busy: boolean
  onClose: () => void
  onSave: (input: { displayName: string; note: string; projectAuthorized?: boolean }) => Promise<void>
}): React.ReactElement {
  const [displayName, setDisplayName] = useState(item.displayName)
  const [note, setNote] = useState(item.note ?? '')
  const [projectAuthorized, setProjectAuthorized] = useState(item.projectAuthorized === true)

  return <div className="library-modal skill-editor-modal" role="dialog" aria-modal="true" aria-labelledby="skill-editor-title">
    <div className="library-modal-card">
      <header>
        <div><h3 id="skill-editor-title">编辑 Skill</h3><p>@{item.name} · {sourceLabels[item.source]}</p></div>
        <button className="icon-button" aria-label="关闭 Skill 编辑器" onClick={onClose} disabled={busy}><X size={17} /></button>
      </header>
      <label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} autoFocus /></label>
      <label>备注<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={1000} placeholder="例如：用于电商商品图，优先保持品牌色" /></label>
      {item.description && <div className="skill-metadata"><span>Skill 原始说明</span><p>{item.description}</p></div>}
      {item.scope === 'project' && <label className="skill-authorization-row"><input type="checkbox" checked={projectAuthorized} onChange={(event) => setProjectAuthorized(event.target.checked)} /><span><strong>允许当前项目调用</strong><small>关闭后 Agent 不会读取或执行该 Skill</small></span></label>}
      <footer>
        <button className="secondary" onClick={onClose} disabled={busy}>取消</button>
        <button className="primary" onClick={() => void onSave({ displayName: displayName.trim(), note: note.trim(), ...(item.scope === 'project' ? { projectAuthorized } : {}) })} disabled={busy || !displayName.trim()}>{busy ? '保存中…' : '保存修改'}</button>
      </footer>
    </div>
  </div>
}

export function SkillsPage(): React.ReactElement {
  const api = useMemo(() => getSkillApi(), [])
  const [items, setItems] = useState<SkillInstallation[]>([])
  const [scope, setScope] = useState<SkillScope>('global')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [editing, setEditing] = useState<SkillInstallation | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try { setItems(await api.list()) } catch (cause) { setError(errorMessage(cause, 'Skill 列表读取失败')) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const run = async (key: string, action: () => Promise<void>) => {
    setWorking(key); setError(null)
    try { await action(); await load(); return true } catch (cause) { setError(errorMessage(cause, 'Skill 操作失败')); return false } finally { setWorking(null) }
  }
  const add = (source: 'link' | 'install') => run(source, async () => {
    try {
      const input = { sourcePath: '', scope }
      if (source === 'link') await api.link(input)
      else await api.install(input)
    } catch (cause) {
      const message = errorMessage(cause, '')
      if (message.includes('未选择') || message.includes('canceled') || message.includes('cancelled')) return
      throw cause
    }
  })
  const update = (item: SkillInstallation, input: { displayName?: string; enabled?: boolean; trusted?: boolean; trustMode?: SkillTrustMode; note?: string; projectAuthorized?: boolean }) => run(item.id, async () => { await api.update({ id: item.id, ...input }) })
  const trust = (item: SkillInstallation) => {
    if (!window.confirm(`确认信任 Skill「${item.displayName}」？受控执行不等于操作系统沙箱。`)) return
    void update(item, { trusted: true })
  }
  const remove = (item: SkillInstallation) => {
    const action = item.source === 'builtin' ? '从列表隐藏' : '移除'
    if (!window.confirm(`确认${action}「${item.displayName}」？`)) return
    void run(item.id, () => api.remove(item.id))
  }
  const saveEdit = async (input: { displayName: string; note: string; projectAuthorized?: boolean }) => {
    if (!editing) return
    if (await update(editing, input)) setEditing(null)
  }

  const visible = items.filter((item) => item.scope === scope)
  return <div className="content-page">
    <div className="section-heading">
      <div><h2>技能</h2><p>Agent 会按目标匹配已启用、已信任的 Skill，也可以在工作台显式指定。</p></div>
      <div className="skill-toolbar"><button className={`secondary small ${scope === 'global' ? 'selected' : ''}`} onClick={() => setScope('global')}>全局</button><button className={`secondary small ${scope === 'project' ? 'selected' : ''}`} onClick={() => setScope('project')}>当前项目</button><button className="secondary small" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />重新扫描</button></div>
    </div>
    <div className="notice"><ShieldCheck size={18} /><span><strong>自动触发不越权</strong>Agent 只会看到已启用、已信任且获得当前项目授权的候选 Skill。</span></div>
    {error && <div className="start-state error" role="alert"><span>{error}</span></div>}
    {loading ? <div className="start-state"><LoaderCircle size={17} className="spin" />正在读取 Skill…</div> : <>
      <div className="skill-install-actions"><button className="primary small" onClick={() => void add('link')} disabled={working !== null}><Link2 size={15} />链接本地 Skill</button><button className="secondary small" onClick={() => void add('install')} disabled={working !== null}><Download size={15} />安装到工作站</button></div>
      <div className="table-list skill-list">{visible.length === 0 ? <div className="start-state">当前范围还没有 Skill</div> : visible.map((item) => <div key={item.id}>
        <span className="skill-mark"><Command size={18} /></span>
        <span><strong>{item.displayName}<small>@{item.name} · {sourceLabels[item.source]}</small></strong><small>{item.note || item.description || '没有备注'} · SHA {item.contentHash.slice(0, 12)}</small></span>
        <div className="skill-status"><span className={`pill ${item.trusted ? 'green' : 'amber'}`}>{item.trusted ? '已信任' : '待确认'}</span><span className={`pill ${item.enabled ? 'green' : 'amber'}`}>{item.enabled ? '启用' : '停用'}</span>{item.scope === 'project' && <span className={`pill ${item.projectAuthorized ? 'green' : 'amber'}`}>{item.projectAuthorized ? '已授权' : '未授权'}</span>}</div>
        <button className={`toggle ${item.enabled ? 'on' : ''}`} aria-label={item.enabled ? '停用 Skill' : '启用 Skill'} onClick={() => void update(item, { enabled: !item.enabled })} disabled={working === item.id}><span /></button>
        <div className="skill-row-actions">
          <HoverTip label="编辑名称与备注">
            <button
              type="button"
              className="icon-button"
              aria-label={`编辑 ${item.displayName}`}
              onClick={() => setEditing(item)}
            >
              <Pencil size={15} />
            </button>
          </HoverTip>
          {!item.trusted ? (
            <HoverTip label="确认信任 Skill（受控执行）">
              <button
                type="button"
                className="icon-button trust"
                aria-label={`信任 ${item.displayName}`}
                onClick={() => trust(item)}
              >
                <Check size={15} />
              </button>
            </HoverTip>
          ) : (
            <HoverTip label="撤销信任">
              <button
                type="button"
                className="icon-button"
                aria-label={`撤销信任 ${item.displayName}`}
                onClick={() => void update(item, { trusted: false })}
              >
                <ShieldCheck size={15} />
              </button>
            </HoverTip>
          )}
          <HoverTip label="重新扫描配置">
            <button
              type="button"
              className="icon-button"
              aria-label={`重新扫描 ${item.displayName}`}
              disabled={working === item.id}
              onClick={() => void run(item.id, async () => { await api.rescan(item.id) })}
            >
              <RefreshCw size={15} className={working === item.id ? 'spin' : ''} />
            </button>
          </HoverTip>
          <HoverTip label={item.source === 'builtin' ? '隐藏内置 Skill' : '移除此 Skill'}>
            <button
              type="button"
              className="icon-button danger"
              aria-label={`${item.source === 'builtin' ? '隐藏' : '移除'} ${item.displayName}`}
              onClick={() => remove(item)}
            >
              <Trash2 size={15} />
            </button>
          </HoverTip>
        </div>
      </div>)}</div>
    </>}
    {editing && <SkillEditor item={editing} busy={working === editing.id} onClose={() => setEditing(null)} onSave={saveEdit} />}
  </div>
}

export default SkillsPage
