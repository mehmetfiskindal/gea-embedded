#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const deployScript = path.join(repoRoot, 'scripts', 'esp32s3-touch-amoled-2.06.sh')
const targetDir = path.join(repoRoot, 'targets', 'esp32-s3-touch-amoled-2.06')
const partitionsPath = path.join(targetDir, 'partitions.csv')
const buildImagePath = path.join(targetDir, 'build', 'gea_embedded.bin')
const launcherId = 'app-launcher'

function usage() {
  console.log(`Usage:
  npm run recover-apps [-- --port=<port>]
  npm run recover-apps -- --flash-launcher

Examples:
  npm run recover-apps
  npm run recover-apps -- --port=/dev/cu.usbmodem101
  npm run recover-apps -- --flash-launcher

Options:
  --port=<port>      USB serial port. Defaults to auto-detect.
  --flash-launcher   Rebuild and reflash the launcher image too.
  --no-reset         Leave the device in bootloader after USB flashing.

By default this only restores OTA boot metadata so the next boot starts ota_0.
It does not rebuild the launcher or erase flash.
`)
}

function parseArgs(argv) {
  let port = 'auto'
  let flashLauncher = false
  let resetAfter = true

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') {
      i += 1
      if (!argv[i]) throw new Error('Missing value after --port')
      port = argv[i]
    } else if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length)
    } else if (arg === '--flash-launcher') {
      flashLauncher = true
    } else if (arg === '--no-reset') {
      resetAfter = false
    } else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { port, flashLauncher, resetAfter }
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function currentResidentBuildArg() {
  if (!existsSync(partitionsPath)) return 'auto'
  const csv = readFileSync(partitionsPath, 'utf8')
  const match = csv.match(/^# Resident app plan:\s*(.+)$/m)
  if (!match) return 'auto'
  const residentApps = match[1].split(',').map(id => id.trim()).filter(id => id && id !== '<none>')
  return [launcherId, ...residentApps].join(',')
}

try {
  const { port, flashLauncher, resetAfter } = parseArgs(process.argv.slice(2))
  console.log('Recovering launcher boot selection over USB')
  console.log(`USB port: ${port}`)
  console.log('Flash contents will be preserved unless --flash-launcher is set.')
  const resetArg = resetAfter ? [] : ['--no-reset']
  if (flashLauncher) {
    run(deployScript, ['build', `--app=${launcherId}`, `--resident-apps=${currentResidentBuildArg()}`])
    run(deployScript, [
      'flash-image',
      port,
      ...resetArg,
      `--app=${launcherId}`,
      `--image=${buildImagePath}`
    ])
    console.log('\nRecovery flash complete. The next boot should start app-launcher from ota_0.')
  } else {
    run(deployScript, ['restore-boot', port, ...resetArg])
    console.log('\nRecovery complete. The next boot should start app-launcher from ota_0.')
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`)
  process.exit(1)
}
