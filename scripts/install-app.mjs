#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const appsPath = path.join(repoRoot, 'examples', 'apps.json')
const deployScript = path.join(repoRoot, 'scripts', 'esp32s3-touch-amoled-2.06.sh')
const targetDir = path.join(repoRoot, 'targets', 'esp32-s3-touch-amoled-2.06')
const partitionsPath = path.join(targetDir, 'partitions.csv')
const buildImagePath = path.join(targetDir, 'build', 'gea_embedded.bin')
const buildBootloaderPath = path.join(targetDir, 'build', 'bootloader', 'bootloader.bin')
const buildPartitionTablePath = path.join(targetDir, 'build', 'partition_table', 'partition-table.bin')
const buildOtaDataPath = path.join(targetDir, 'build', 'ota_data_initial.bin')
const imageCacheDir = path.join(targetDir, 'build', 'app-image-cache')

const launcherId = 'app-launcher'
const firstAppOffset = 0x20000
const bootableAppRegionEnd = 0x2000000
const appAlignment = 0x10000
const firmwareOtaSlotCount = 2
const cacheVersion = 2

function usage() {
  console.log(`Usage:
  npm run install-app <app-id...> [-- --port=<port>]
  npm run install-app all [-- --port=<port>]
  npm run install-app all -- --ota=<board-ip>

Examples:
  npm run install-app button-tetris
  npm run install-app button-tetris tilt-breakout
  npm run install-app all
  npm run install-app all -- --port=/dev/cu.usbmodem101
  npm run install-app all -- --ota=192.168.1.42
  npm run install-app all -- --dry-run
  npm run install-app all -- --rebuild
  npm run install-app all -- --no-reset

Options:
  --port=<port>   USB serial port. Defaults to auto-detect.
  --ota=<target>  Update launcher firmware over WiFi OTA instead of USB.
  --rebuild       Rebuild the launcher image instead of using the cache.
  --no-reset      Leave the device in bootloader after USB flashing.
  --dry-run       Print the install plan without flashing.
`)
}

function parseArgs(argv) {
  const apps = []
  let port = 'auto'
  let otaTarget = ''
  let dryRun = false
  let forceRebuild = false
  let resetAfter = true

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--rebuild' || arg === '--force-rebuild') {
      forceRebuild = true
    } else if (arg === '--no-reset') {
      resetAfter = false
    } else if (arg === '--port') {
      i += 1
      if (!argv[i]) throw new Error('Missing value after --port')
      port = argv[i]
    } else if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length)
    } else if (arg === '--ota' || arg === '--host' || arg === '--ip') {
      i += 1
      if (!argv[i]) throw new Error(`Missing value after ${arg}`)
      otaTarget = argv[i]
    } else if (arg.startsWith('--ota=')) {
      otaTarget = arg.slice('--ota='.length)
    } else if (arg.startsWith('--host=')) {
      otaTarget = arg.slice('--host='.length)
    } else if (arg.startsWith('--ip=')) {
      otaTarget = arg.slice('--ip='.length)
    } else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`)
    } else {
      apps.push(arg)
    }
  }

  if (otaTarget && port !== 'auto') {
    throw new Error('--port is for USB installs. Use --ota=<board-ip> for WiFi OTA installs.')
  }

  return { apps, port, otaTarget, dryRun, forceRebuild, resetAfter }
}

function isEsp32Enabled(app) {
  return Boolean(app.targets && app.targets.esp32 && app.targets.esp32.enabled)
}

function isResidentApp(app) {
  return app.id !== launcherId && app.runtime === 'app-render' && isEsp32Enabled(app)
}

function residentBuildIds(residentApps) {
  return [launcherId, ...residentApps]
}

function unique(values) {
  return [...new Set(values)]
}

function hex(value) {
  return `0x${value.toString(16)}`
}

function alignDown(value, alignment) {
  return Math.floor(value / alignment) * alignment
}

function loadApps() {
  return JSON.parse(readFileSync(appsPath, 'utf8')).apps
}

function resolveInstallApps(requested, allApps) {
  const byId = new Map(allApps.map(app => [app.id, app]))
  if (!byId.has(launcherId)) throw new Error(`Missing required launcher app '${launcherId}'`)

  const selectedIds = requested.includes('all')
    ? allApps.filter(app => isResidentApp(app)).map(app => app.id)
    : unique(requested).filter(id => id !== launcherId)

  if (selectedIds.length === 0) {
    throw new Error('Pick at least one app id, or use "all".')
  }

  for (const id of selectedIds) {
    const app = byId.get(id)
    if (!app) throw new Error(`Unknown app '${id}'. Run ./scripts/esp32s3-touch-amoled-2.06.sh list-apps to see valid ids.`)
    if (!isEsp32Enabled(app)) throw new Error(`App '${id}' does not support the ESP32 target.`)
    if (!isResidentApp(app)) throw new Error(`App '${id}' uses runtime '${app.runtime}' and cannot be installed in the resident launcher. Pick an ESP32-enabled app-render app.`)
  }

  return {
    residentApps: selectedIds
  }
}

function buildPartitionTable(residentApps) {
  const available = bootableAppRegionEnd - firstAppOffset
  const slotSize = alignDown(Math.floor(available / firmwareOtaSlotCount), appAlignment)
  if (slotSize <= 0) throw new Error('Could not calculate a valid OTA slot size.')

  const lines = [
    '# Generated by npm run install-app. Safe to regenerate.',
    `# Installed app plan: ${launcherId}`,
    `# Resident app plan: ${residentApps.length ? residentApps.join(', ') : '<none>'}`,
    '# Firmware OTA layout: app-launcher plus one regular OTA update slot',
    '# Name,    Type, SubType, Offset,   Size'
  ]

  for (let slot = 0; slot < firmwareOtaSlotCount; slot += 1) {
    lines.push(`# ota_${slot}: ${launcherId}`)
  }

  lines.push('nvs,       data, nvs,     0x9000,   0x6000')
  lines.push('otadata,   data, ota,     0xf000,   0x2000')
  lines.push('phy_init,  data, phy,     0x11000,  0x1000')

  const slotPlan = Array.from({ length: firmwareOtaSlotCount }, (_, slot) => ({
    appId: launcherId,
    slot,
    name: `ota_${slot}`,
    offset: firstAppOffset + slot * slotSize,
    size: slotSize
  }))

  for (const part of slotPlan) {
    lines.push(`${`${part.name},`.padEnd(10)} app,  ${`${part.name},`.padEnd(8)} ${`${hex(part.offset)},`.padEnd(9)} ${hex(part.size)}`)
  }

  return {
    csv: `${lines.join('\n')}\n`,
    slotPlan,
    slotSize
  }
}

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function shouldSkipCachePath(name) {
  return name === 'node_modules' ||
    name === 'dist' ||
    name === 'build' ||
    name === '.vite' ||
    name === '.git' ||
    name === 'managed_components' ||
    name === '.DS_Store' ||
    name.endsWith('.tsbuildinfo') ||
    name.endsWith('.log')
}

function collectFiles(root) {
  if (!existsSync(root)) return []

  const stat = statSync(root)
  if (stat.isFile()) return [root]
  if (!stat.isDirectory()) return []

  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (shouldSkipCachePath(entry.name)) continue
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function hashFiles(hash, files) {
  for (const file of files.sort()) {
    hash.update(path.relative(repoRoot, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
}

function buildCommonDigest() {
  const hash = createHash('sha256')
  hash.update(`cache-version:${cacheVersion}\0`)
  hashFiles(hash, [
    path.join(repoRoot, 'package.json'),
    appsPath,
    path.join(repoRoot, 'scripts', 'generate-installed-app-plan.mjs'),
    path.join(repoRoot, 'scripts', 'install-app.mjs'),
    partitionsPath,
    path.join(targetDir, 'CMakeLists.txt'),
    path.join(targetDir, 'sdkconfig.defaults'),
    path.join(targetDir, 'sdkconfig'),
    ...collectFiles(path.join(repoRoot, 'lib')),
    ...collectFiles(path.join(targetDir, 'main')),
    ...collectFiles(path.join(repoRoot, 'targets', 'shared')),
    ...collectFiles(path.join(repoRoot, 'vendor', 'AnimatedGIF')),
    ...collectFiles(path.join(repoRoot, 'vendor', 'xs', 'includes')),
    ...collectFiles(path.join(repoRoot, 'vendor', 'xs', 'sources')),
    ...collectFiles(path.join(repoRoot, 'vendor', 'xs', 'tools'))
  ].filter(existsSync))
  return hash.digest('hex')
}

function buildAppDigest(app, commonDigest, buildContext = {}) {
  const hash = createHash('sha256')
  hash.update(commonDigest)
  hash.update('\0')
  hash.update(JSON.stringify({
    id: app.id,
    root: app.root,
    entry: app.entry,
    runtime: app.runtime,
    esp32: app.targets?.esp32
  }))
  hash.update('\0')
  hashFiles(hash, collectFiles(path.join(repoRoot, app.root)))
  if (app.id === launcherId) {
    const residentAppIds = buildContext.residentApps || []
    const appsById = buildContext.appsById || new Map()
    hash.update(JSON.stringify({ residentAppIds }))
    hash.update('\0')
    for (const residentAppId of residentAppIds) {
      const resident = appsById.get(residentAppId)
      if (!resident) continue
      hash.update(JSON.stringify({
        id: resident.id,
        root: resident.root,
        entry: resident.entry,
        runtime: resident.runtime,
        esp32: resident.targets?.esp32
      }))
      hash.update('\0')
      hashFiles(hash, collectFiles(path.join(repoRoot, resident.root)))
    }
  }
  return hash.digest('hex')
}

function cachePaths(appId) {
  const safeId = appId.replace(/[^a-zA-Z0-9_.-]/g, '_')
  const dir = path.join(imageCacheDir, safeId)
  return {
    dir,
    bin: path.join(dir, 'gea_embedded.bin'),
    meta: path.join(dir, 'metadata.json')
  }
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`
}

function getCachedAppImage(app, commonDigest, slotSize, options) {
  const { appsById, forceRebuild, residentApps = [] } = options
  const signature = buildAppDigest(app, commonDigest, { appsById, residentApps })
  const cache = cachePaths(app.id)
  const metadata = readJsonIfExists(cache.meta)
  const canUseCache = !forceRebuild &&
    metadata &&
    metadata.signature === signature &&
    existsSync(cache.bin)

  if (canUseCache) {
    const imageSize = statSync(cache.bin).size
    if (imageSize > slotSize) {
      throw new Error(`Cached image for '${app.id}' is ${imageSize} bytes but its slot only has ${slotSize} bytes.`)
    }
    console.log(`\nUsing cached image for '${app.id}' (${formatBytes(imageSize)})`)
    return cache.bin
  }

  console.log(`\nBuilding image for '${app.id}'${forceRebuild ? ' (--rebuild)' : ' (cache miss)'}...`)
  const buildArgs = ['build', `--app=${app.id}`]
  if (app.id === launcherId) {
    buildArgs.push(`--resident-apps=${residentBuildIds(residentApps).join(',')}`)
  }
  run(deployScript, buildArgs)

  if (!existsSync(buildImagePath)) {
    throw new Error(`Expected build image was not created: ${path.relative(repoRoot, buildImagePath)}`)
  }

  const imageSize = statSync(buildImagePath).size
  if (imageSize > slotSize) {
    throw new Error(`App image for '${app.id}' is ${imageSize} bytes but its slot only has ${slotSize} bytes.`)
  }

  mkdirSync(cache.dir, { recursive: true })
  copyFileSync(buildImagePath, cache.bin)
  writeFileSync(cache.meta, `${JSON.stringify({
    version: cacheVersion,
    appId: app.id,
    signature,
    size: imageSize,
    builtAt: new Date().toISOString()
  }, null, 2)}\n`)
  console.log(`Cached image for '${app.id}' (${formatBytes(imageSize)})`)
  return cache.bin
}

function haveFlashArtifacts() {
  return existsSync(buildBootloaderPath) &&
    existsSync(buildPartitionTablePath) &&
    existsSync(buildOtaDataPath)
}

function otaBaseUrl(target) {
  const trimmed = target.replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  if (trimmed.includes(':')) return `http://${trimmed}`
  return `http://${trimmed}:8080`
}

async function readOtaStatus(target) {
  const url = `${otaBaseUrl(target)}/ota/status`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

function printPlan(slotPlan, slotSize, { port, otaTarget, resetAfter, residentApps }) {
  console.log(`Installing launcher firmware ${otaTarget ? 'over WiFi OTA' : 'over USB'}`)
  if (otaTarget) {
    console.log(`OTA target: ${otaBaseUrl(otaTarget)}`)
  } else {
    console.log(`USB port: ${port}`)
    console.log(`Reset after flashing: ${resetAfter ? 'yes' : 'no'}`)
  }
  if (residentApps.length > 0) {
    console.log(`Resident app-render apps enabled in launcher: ${residentApps.join(', ')}`)
  } else {
    console.log('Resident app-render apps enabled in launcher: <none>')
  }
  console.log(`Firmware OTA slot size: ${hex(slotSize)} (${Math.floor(slotSize / 1024)} KiB)`)
  for (const part of slotPlan) {
    console.log(`  ${part.name.padEnd(6)} ${part.appId.padEnd(18)} offset ${hex(part.offset)} size ${hex(part.size)}`)
  }
}

function installOverUsb(slotPlan, port, appsById, commonDigest, options) {
  const launcherPart = slotPlan[0]
  const launcherNeedsBuild = options.partitionsChanged || !haveFlashArtifacts()
  const launcherImagePath = getCachedAppImage(appsById.get(launcherId), commonDigest, launcherPart.size, {
    ...options,
    appsById,
    forceRebuild: options.forceRebuild || launcherNeedsBuild
  })

  run(deployScript, [
    'flash-image',
    port,
    ...(options.resetAfter === false ? ['--no-reset'] : []),
    `--app=${launcherId}`,
    `--image=${launcherImagePath}`
  ])

  console.log('\nInstall complete. The launcher firmware is in ota_0; ota_1 is reserved for the next OTA update.')
}

async function installOverOta(slotPlan, otaTarget, appsById, commonDigest, options) {
  const status = await readOtaStatus(otaTarget).catch(error => {
    throw new Error(`Could not read OTA status from ${otaBaseUrl(otaTarget)}. Make sure the board is running current firmware with /ota/status support. ${error.message}`)
  })

  const devicePartitions = new Map((status.partitions || []).map(partition => [partition.label, partition]))
  const missing = slotPlan.filter(part => !devicePartitions.has(part.name))
  if (missing.length > 0) {
    throw new Error(`The board partition table is missing ${missing.map(part => part.name).join(', ')}. Run this install once over USB to apply the generated partition table, then use --ota for launcher updates.`)
  }

  const slotNames = new Set(slotPlan.map(part => part.name))
  const extra = (status.partitions || []).filter(partition => /^ota_\d+$/.test(partition.label) && !slotNames.has(partition.label))
  const wrongSize = slotPlan.filter(part => Number(devicePartitions.get(part.name)?.size) !== part.size)
  if (extra.length > 0 || wrongSize.length > 0) {
    throw new Error('The board is not using the two-slot resident launcher partition table yet. Run this install once over USB, then use --ota for launcher updates.')
  }

  const runningLabel = status.running && status.running.label ? status.running.label : ''
  const updatePart = slotPlan.find(part => part.name !== runningLabel)
  if (!updatePart) throw new Error('Could not find an inactive OTA slot for the launcher update.')

  const imagePath = getCachedAppImage(appsById.get(launcherId), commonDigest, updatePart.size, {
    ...options,
    appsById
  })
  run(deployScript, ['stage-image-ota', otaTarget, `--app=${launcherId}`, `--slot=${updatePart.name}`, `--image=${imagePath}`, '--boot', '--reboot'])

  console.log('\nOTA install complete. The updated launcher firmware is staged and the board is rebooting.')
}

async function main() {
  const { apps: requestedApps, port, otaTarget, dryRun, forceRebuild, resetAfter } = parseArgs(process.argv.slice(2))
  if (requestedApps.length === 0) {
    usage()
    process.exit(1)
  }

  const allApps = loadApps()
  const appsById = new Map(allApps.map(app => [app.id, app]))
  const { residentApps } = resolveInstallApps(requestedApps, allApps)
  const { csv, slotPlan, slotSize } = buildPartitionTable(residentApps)

  printPlan(slotPlan, slotSize, { port, otaTarget, resetAfter, residentApps })
  if (dryRun) {
    console.log('\nGenerated partition table:\n')
    console.log(csv)
    return
  }

  const previousPartitionTable = existsSync(partitionsPath) ? readFileSync(partitionsPath, 'utf8') : ''
  const partitionsChanged = previousPartitionTable !== csv
  writeFileSync(partitionsPath, csv)
  console.log(`\nWrote ${path.relative(repoRoot, partitionsPath)}`)

  const cacheOptions = { forceRebuild, partitionsChanged, resetAfter, residentApps }

  if (otaTarget) {
    const commonDigest = buildCommonDigest()
    await installOverOta(slotPlan, otaTarget, appsById, commonDigest, cacheOptions)
  } else {
    const commonDigest = buildCommonDigest()
    installOverUsb(slotPlan, port, appsById, commonDigest, cacheOptions)
  }
}

main().catch(error => {
  console.error(`ERROR: ${error.message}`)
  process.exit(1)
})
