import manifest from '../../examples/apps.json'

export type AppRuntime = 'app-render' | 'screen'

export interface AppEntry {
  id: string
  root: string
  entry: string
  runtime: AppRuntime
  targets: { web: { enabled: boolean }; esp32: { enabled: boolean } }
}

const apps = manifest.apps as AppEntry[]

export const WEB_APP_IDS = apps.filter(app => app.targets.web.enabled).map(app => app.id)

export function getAppRuntime(appId: string): AppRuntime {
  const app = apps.find(a => a.id === appId)
  return app?.runtime ?? 'app-render'
}
