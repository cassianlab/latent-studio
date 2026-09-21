export const promptSelectionEvent = 'latent-studio:prompt-selection'
export const workspaceModeEvent = 'latent-studio:workspace-mode'

export function publishSelectedPrompt(prompt: string, mode?: 'text' | 'image' | 'agent'): void {
  if (typeof window === 'undefined') return
  if (mode) window.dispatchEvent(new CustomEvent(workspaceModeEvent, { detail: mode }))
  window.dispatchEvent(new CustomEvent(promptSelectionEvent, { detail: prompt }))
}
