import { CheckCircle2, ChevronDown, Circle, LoaderCircle, XCircle } from 'lucide-react'
import type { AgentStep } from '../../shared/contracts/agent'
import { agentStepLabel, type AgentActivityState } from './agent-activity-model'
import './AgentExecutionStatus.css'

interface AgentExecutionStatusProps {
  pending?: boolean
  activity?: AgentActivityState | null
  steps?: readonly AgentStep[]
}

function durationLabel(steps: readonly AgentStep[]): string | undefined {
  const started = Date.parse(steps[0]?.startedAt ?? '')
  const finished = Math.max(...steps.map((step) => Date.parse(step.finishedAt ?? '')).filter(Number.isFinite))
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return undefined
  const seconds = Math.max(1, Math.round((finished - started) / 1_000))
  return `${seconds} 秒`
}

export function AgentExecutionStatus({ pending, activity, steps = [] }: AgentExecutionStatusProps): React.ReactElement | null {
  if (pending) {
    return (
      <div className="agent-execution-live" role="status" aria-live="polite">
        <LoaderCircle size={15} className="spin" aria-hidden="true" />
        <span>{activity?.label ?? '正在理解你的要求'}</span>
      </div>
    )
  }

  const visibleSteps = steps.filter((step) => step.kind !== 'model' || step.status !== 'completed')
  if (!visibleSteps.length) return null
  const failed = visibleSteps.some((step) => step.status === 'failed')
  const duration = durationLabel(steps)
  return (
    <details className="agent-execution-summary">
      <summary>
        {failed ? <XCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
        <span>{failed ? '执行未完成' : '运行完成'} · {visibleSteps.length} 个步骤{duration ? ` · ${duration}` : ''}</span>
        <ChevronDown size={14} className="agent-execution-chevron" aria-hidden="true" />
      </summary>
      <ol>
        {visibleSteps.map((step) => (
          <li key={step.id} className={step.status === 'failed' ? 'failed' : ''}>
            <Circle size={8} fill="currentColor" aria-hidden="true" />
            <span>{agentStepLabel(step)}</span>
            {step.error && <small>{step.error}</small>}
          </li>
        ))}
      </ol>
    </details>
  )
}
