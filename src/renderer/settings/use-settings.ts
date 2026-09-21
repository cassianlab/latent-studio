import { useCallback, useEffect, useState } from 'react'
import type { GlobalSettings, SaveModelProfileInput, SaveProviderConnectionInput, SaveProviderGroupInput, SettingsApi, TestConnectionInput, TestConnectionResult } from '../../shared/contracts/settings'
import { getSettingsApi } from './settings-api'

export interface SettingsState {
  settings: GlobalSettings | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  saveGroup: (input: SaveProviderGroupInput) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  saveConnection: (input: SaveProviderConnectionInput) => Promise<void>
  deleteConnection: (id: string) => Promise<void>
  saveModel: (input: SaveModelProfileInput) => Promise<void>
  saveModels: (inputs: SaveModelProfileInput[]) => Promise<void>
  deleteModel: (id: string) => Promise<void>
  setDefaults: (input: { textModelId?: string | null; imageModelId?: string | null }) => Promise<void>
  testConnection: (input: TestConnectionInput) => Promise<TestConnectionResult>
}

export function useSettings(api: SettingsApi = getSettingsApi()): SettingsState {
  const [settings, setSettings] = useState<GlobalSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    try { setSettings(await api.get()) } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取模型设置') } finally { setLoading(false) }
  }, [api])
  const reload = useCallback(() => refresh(true), [refresh])
  useEffect(() => { void reload() }, [reload])
  const notifyUpdated = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('latent-studio:settings-updated'))
  }
  const saveGroup = useCallback(async (input: SaveProviderGroupInput) => {
    await api.saveGroup(input)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const deleteGroup = useCallback(async (id: string) => {
    await api.deleteGroup(id)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const saveConnection = useCallback(async (input: SaveProviderConnectionInput) => {
    await api.saveConnection(input)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const deleteConnection = useCallback(async (id: string) => {
    await api.deleteConnection(id)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const saveModel = useCallback(async (input: SaveModelProfileInput) => {
    await api.saveModel(input)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const saveModels = useCallback(async (inputs: SaveModelProfileInput[]) => {
    for (const input of inputs) await api.saveModel(input)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const deleteModel = useCallback(async (id: string) => {
    await api.deleteModel(id)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const setDefaults = useCallback(async (input: { textModelId?: string | null; imageModelId?: string | null }) => {
    await api.setDefaults(input)
    await refresh(false)
    notifyUpdated()
  }, [api, refresh])
  const testConnection = useCallback(async (input: TestConnectionInput) => {
    return api.testConnection(input)
  }, [api])
  return { settings, loading, error, reload, saveGroup, deleteGroup, saveConnection, deleteConnection, saveModel, saveModels, deleteModel, setDefaults, testConnection }
}
