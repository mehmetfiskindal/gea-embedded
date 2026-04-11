#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const appsPath = path.join(repoRoot, 'examples', 'apps.json')
const deployScript = path.join(repoRoot, 'scripts', 'esp32s3-touch-amoled-2.06.sh')
const targetDir = path.join(repoRoot, 'targets', 'esp32-s3-touch-amoled-2.06')
const partitionsPath = path.join(targetDir, 'partitions.csv')
const buildImagePath = path.join(targetDir, 'build', 'gea_embedded.bin')

const launcherId = 'app-launcher'
const firstAppOffset = 0x20000
const bootableAppRegionEnd = 0x2000000
const appAlignment = 0x10000
const firmwareOtaSlotCount = 2

function usage() {
  console.log(`Usage:
  npm run uninstall-app <app-id...> [-- --port=<port>]
  npm run uninstall-app all [-- --port=<port>]
  npm run uninstall-app <app-id...> -- --ota=<board-ip>

Examples:
  npm run uninstall-app button-tetris
  npm run uninstall-app button-tetris tilt-breakout
  npm run uninstall-app all
  npm run uninstall-app button-tetris -- --ota=192.168.1.42
  npm run uninstall-app all -- --dry-run

Options:
  --port=<port>   USB serial port. Defaults to auto-detect.
  --ota=<target>  Update the launcher over WiFi OTA instead of flashing over USB.
  --dry-run       Print the uninstall plan without flashing or erasing.
`)
}

function parseArgs(argv) {
  const apps = []
  let port = 'auto'
  let otaTarget = ''
  let dryRun = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      dryRun = true
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
    throw new Error('--port is for USB uninstalls. Use --ota=<board-ip> for WiFi OTA uninstalls.')
  }

  return { apps, port, otaTarget, dryRun }
}

function isEsp32Enabled(app) {
  return Boolean(app.targets && app.targets.esp32 && app.targets.esp32.enabled)
}

function isResidentApp(app) {
  return app.id !== launcherId && app.runtime === 'app-render' && isEsp32Enabled(app)
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

function residentAppIds(allApps) {
  return allApps.filter(app => isResidentApp(app)).map(app => app.id)
}

function resolveUninstallApps(requested, allApps) {
  const enabled = new Set(residentAppIds(allApps))
  if (requested.includes(launcherId)) throw new Error('The launcher app cannot be uninstalled.')
  if (requested.includes('all')) return [...enabled]

  const selected = unique(requested)
  if (selected.length === 0) throw new Error('Pick at least one app id, or use "all".')
  for (const id of selected) {
    if (!enabled.has(id)) throw new Error(`App '${id}' is not an ESP32-enabled app-render resident app.`)
  }
  return selected
}

function parsePlanList(value) {
  return value.split(',').map(id => id.trim()).filter(id => id && id !== '<none>')
}

function loadCurrentResidentPlan(allApps) {
  if (!existsSync(partitionsPath)) return null

  const csv = readFileSync(partitionsPath, 'utf8')
  const byId = new Map(allApps.map(app => [app.id, app]))
  const residentLine = csv.match(/^# Resident app plan:\s*(.+)$/m)
  if (residentLine) {
    const planned = parsePlanList(residentLine[1])
    return planned.filter(id => byId.has(id) && isResidentApp(byId.get(id)))
  }

  const planLine = csv.match(/^# Installed app plan:\s*(.+)$/m)
  if (planLine) {
    const planned = parsePlanList(planLine[1]).filter(id => byId.has(id) && isResidentApp(byId.get(id)))
    if (planned.length > 0) return planned
  }

  const slotApps = [...csv.matchAll(/^#\s*ota_\d+:\s*(.+)$/gm)]
    .map(match => match[1].trim())
    .filter(id => id && id !== '<empty>' && byId.has(id) && isResidentApp(byId.get(id)))
  if (slotApps.length > 0) return slotApps

  return residentAppIds(allApps)
}

function buildPartitionTable(residentApps) {
  const available = bootableAppRegionEnd - firstAppOffset
  const slotSize = alignDown(Math.floor(available / firmwareOtaSlotCount), appAlignment)
  if (slotSize <= 0) throw new Error('Could not calculate a valid OTA slot size.')

  const lines = [
    '# Generated by npm run uninstall-app. Safe to regenerate.',
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

function printUsbPlan(currentPlan, remainingPlan, removedIds, slotSize) {
  console.log('Uninstalling resident app-render apps over USB')
  console.log(`Removing: ${removedIds.join(', ')}`)
  console.log(`Current resident plan: ${currentPlan.length ? currentPlan.join(', ') : '<none>'}`)
  console.log(`New resident plan: ${remainingPlan.length ? remainingPlan.join(', ') : '<none>'}`)
  console.log(`Firmware OTA slot size: ${hex(slotSize)} (${Math.floor(slotSize / 1024)} KiB)`)
}

function validateTwoSlotStatus(status, slotPlan) {
  const devicePartitions = new Map((status.partitions || []).map(partition => [partition.label, partition]))
  const missing = slotPlan.filter(part => !devicePartitions.has(part.name))
  const slotNames = new Set(slotPlan.map(part => part.name))
  const extra = (status.partitions || []).filter(partition => /^ota_\d+$/.test(partition.label) && !slotNames.has(partition.label))
  const wrongSize = slotPlan.filter(part => Number(devicePartitions.get(part.name)?.size) !== part.size)
  if (missing.length > 0 || extra.length > 0 || wrongSize.length > 0) {
    throw new Error('The board is not using the two-slot resident launcher partition table yet. Run npm run install-app over USB once, then use --ota.')
  }
}

function residentBuildArg(residentApps) {
  return [launcherId, ...residentApps].join(',')
}

async function uninstallOverOta(currentPlan, remainingPlan, removedIds, otaTarget, dryRun) {
  const { csv, slotPlan, slotSize } = buildPartitionTable(remainingPlan)
  if (dryRun) {
    console.log(`Uninstalling resident app-render apps over WiFi OTA from ${otaBaseUrl(otaTarget)}`)
    console.log(`Would remove: ${removedIds.join(', ')}`)
    console.log(`New resident plan: ${remainingPlan.length ? remainingPlan.join(', ') : '<none>'}`)
    console.log(`Firmware OTA slot size: ${hex(slotSize)} (${Math.floor(slotSize / 1024)} KiB)`)
    console.log('\nGenerated partition table:\n')
    console.log(csv)
    return
  }

  const status = await readOtaStatus(otaTarget).catch(error => {
    throw new Error(`Could not read OTA status from ${otaBaseUrl(otaTarget)}. Make sure the board is running current firmware with /ota/status support. ${error.message}`)
  })
  validateTwoSlotStatus(status, slotPlan)

  const runningLabel = status.running && status.running.label ? status.running.label : ''
  const updatePart = slotPlan.find(part => part.name !== runningLabel)
  if (!updatePart) throw new Error('Could not find an inactive OTA slot for the launcher update.')

  console.log(`Uninstalling resident app-render apps over WiFi OTA from ${otaBaseUrl(otaTarget)}`)
  console.log(`Removing: ${removedIds.join(', ')}`)
  console.log(`Current resident plan: ${currentPlan.length ? currentPlan.join(', ') : '<none>'}`)
  console.log(`New resident plan: ${remainingPlan.length ? remainingPlan.join(', ') : '<none>'}`)

  writeFileSync(partitionsPath, csv)
  console.log(`\nWrote ${path.relative(repoRoot, partitionsPath)}`)
  run(deployScript, ['build', `--app=${launcherId}`, `--resident-apps=${residentBuildArg(remainingPlan)}`])
  run(deployScript, ['stage-image-ota', otaTarget, `--app=${launcherId}`, `--slot=${updatePart.name}`, `--image=${buildImagePath}`, '--boot', '--reboot'])

  console.log('\nUninstall complete. The updated launcher firmware is staged and the board is rebooting.')
}

function uninstallOverUsb(currentPlan, remainingPlan, removedIds, port, dryRun) {
  const { csv, slotPlan, slotSize } = buildPartitionTable(remainingPlan)
  printUsbPlan(currentPlan, remainingPlan, removedIds, slotSize)
  if (dryRun) {
    console.log('\nGenerated partition table:\n')
    console.log(csv)
    return
  }

  writeFileSync(partitionsPath, csv)
  console.log(`\nWrote ${path.relative(repoRoot, partitionsPath)}`)

  run(deployScript, ['build', `--app=${launcherId}`, `--resident-apps=${residentBuildArg(remainingPlan)}`])
  run(deployScript, [
    'flash-image',
    port,
    `--app=${launcherId}`,
    `--image=${buildImagePath}`
  ])

  console.log('\nUninstall complete. The regenerated launcher firmware is now flashed.')
}

async function main() {
  const { apps: requestedApps, port, otaTarget, dryRun } = parseArgs(process.argv.slice(2))
  if (requestedApps.length === 0) {
    usage()
    process.exit(1)
  }

  const allApps = loadApps()
  const removedIds = resolveUninstallApps(requestedApps, allApps)
  const currentPlan = loadCurrentResidentPlan(allApps) ?? residentAppIds(allApps)
  const removeSet = new Set(removedIds)
  const remainingPlan = currentPlan.filter(id => !removeSet.has(id))

  if (otaTarget) {
    await uninstallOverOta(currentPlan, remainingPlan, removedIds, otaTarget, dryRun)
    return
  }

  uninstallOverUsb(currentPlan, remainingPlan, removedIds, port, dryRun)
}

main().catch(error => {
  console.error(`ERROR: ${error.message}`)
  process.exit(1)
})
