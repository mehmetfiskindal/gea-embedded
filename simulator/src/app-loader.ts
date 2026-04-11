type WasmModule = {
  HEAPU8: Uint8Array
  ccall: (ident: string, returnType: string | null, argTypes: string[], args: unknown[]) => number
}

type WasmModuleOptions = {
  locateFile?: (path: string, scriptDirectory: string) => string
}

type WasmModuleFactory = (options?: WasmModuleOptions) => Promise<WasmModule>
type WasmModuleNamespace = { default: WasmModuleFactory }

const wasmModuleLoaders = import.meta.glob('../../targets/web/dist/*/module.js') as Record<
  string,
  () => Promise<WasmModuleNamespace>
>

let activeAppScript: HTMLScriptElement | null = null

export function getModuleImportKey(appId: string): string {
  return `../../targets/web/dist/${appId}/module.js`
}

export function getAppScriptUrl(appId: string, cacheBust: string): string {
  return `/apps/${appId}/app.js?v=${cacheBust}`
}

export function getModuleWasmUrl(appId: string): string {
  return `/apps/${appId}/module.wasm`
}

export async function loadModule(appId: string): Promise<WasmModule> {
  const moduleLoader = wasmModuleLoaders[getModuleImportKey(appId)]

  if (!moduleLoader) {
    throw new Error(`Missing built WASM module for app "${appId}". Run ./targets/web/build-web.sh ${appId}.`)
  }

  const moduleFactory = (await moduleLoader()).default
  return moduleFactory({
    locateFile(path) {
      return path === 'module.wasm' ? getModuleWasmUrl(appId) : path
    }
  })
}

export async function loadAppScript(appId: string, cacheBust: string): Promise<void> {
  const nextScript = document.createElement('script')
  nextScript.type = 'module'
  nextScript.src = getAppScriptUrl(appId, cacheBust)

  await new Promise<void>((resolve, reject) => {
    nextScript.onload = () => {
      activeAppScript?.remove()
      activeAppScript = nextScript
      resolve()
    }

    nextScript.onerror = () => {
      nextScript.remove()
      reject(new Error(`Failed to load app bundle for "${appId}".`))
    }

    document.head.append(nextScript)
  })
}
