#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const appsPath = path.join(repoRoot, 'examples', 'apps.json')
const vscodeDir = path.join(repoRoot, '.vscode')
const deployScript = './scripts/esp32s3-touch-amoled-2.06.sh'

const manifest = JSON.parse(readFileSync(appsPath, 'utf8'))
const espApps = manifest.apps
  .filter(app => app.targets?.esp32?.enabled)
  .map(app => app.id)
const installableEspApps = espApps.filter(id => id !== 'app-launcher')

if (espApps.length === 0) {
  throw new Error(`No ESP32-enabled apps found in ${appsPath}`)
}

const inputs = [
  {
    id: 'geaEmbeddedExample',
    type: 'pickString',
    description: 'ESP32-enabled example to build/deploy',
    options: espApps,
    default: espApps.includes('app-launcher') ? 'app-launcher' : espApps[0]
  },
  {
    id: 'geaEmbeddedSerialPort',
    type: 'promptString',
    description: 'USB serial port, or auto to let ESP-IDF detect it.',
    default: 'auto'
  },
  {
    id: 'geaEmbeddedInstallApp',
    type: 'pickString',
    description: 'App to install into the launcher',
    options: installableEspApps,
    default: installableEspApps.includes('button-tetris') ? 'button-tetris' : installableEspApps[0]
  },
  {
    id: 'geaEmbeddedUninstallApp',
    type: 'pickString',
    description: 'App to uninstall from the launcher',
    options: installableEspApps,
    default: installableEspApps.includes('button-tetris') ? 'button-tetris' : installableEspApps[0]
  },
  {
    id: 'geaEmbeddedBoardIp',
    type: 'promptString',
    description: 'Board IP address for WiFi OTA deploy',
    default: ''
  }
]

const baseTask = {
  type: 'shell',
  options: { cwd: '${workspaceFolder}' },
  problemMatcher: [],
  presentation: {
    reveal: 'always',
    panel: 'dedicated',
    clear: true
  }
}

const strongShellArg = value => ({ value, quoting: 'strong' })

const tasks = {
  version: '2.0.0',
  tasks: [
    {
      ...baseTask,
      label: 'Gea Embedded: regenerate VS Code configs',
      command: 'node',
      args: ['scripts/generate-vscode-config.mjs']
    },
    {
      ...baseTask,
      label: 'Gea Embedded: ESP32 setup',
      command: deployScript,
      args: ['setup']
    },
    {
      ...baseTask,
      label: 'Gea Embedded: build selected example',
      command: deployScript,
      args: ['build', strongShellArg('--app=${input:geaEmbeddedExample}')],
      group: 'build'
    },
    {
      ...baseTask,
      label: 'Gea Embedded: USB flash selected example',
      command: deployScript,
      args: [
        'flash',
        strongShellArg('--app=${input:geaEmbeddedExample}'),
        strongShellArg('${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: USB flash + monitor selected example',
      command: deployScript,
      args: [
        'flash-monitor',
        strongShellArg('--app=${input:geaEmbeddedExample}'),
        strongShellArg('${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: serial monitor',
      command: deployScript,
      args: ['monitor', strongShellArg('${input:geaEmbeddedSerialPort}')]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: OTA selected example',
      command: deployScript,
      args: [
        'ota',
        strongShellArg('${input:geaEmbeddedBoardIp}'),
        strongShellArg('--app=${input:geaEmbeddedExample}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: OTA selected example + logs',
      command: deployScript,
      args: [
        'ota-monitor',
        strongShellArg('${input:geaEmbeddedBoardIp}'),
        strongShellArg('--app=${input:geaEmbeddedExample}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: install selected app over USB',
      command: 'npm',
      args: [
        'run',
        'install-app',
        '--',
        strongShellArg('${input:geaEmbeddedInstallApp}'),
        strongShellArg('--port=${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: install all apps over USB',
      command: 'npm',
      args: [
        'run',
        'install-app',
        '--',
        'all',
        strongShellArg('--port=${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: install selected app over OTA',
      command: 'npm',
      args: [
        'run',
        'install-app',
        '--',
        strongShellArg('${input:geaEmbeddedInstallApp}'),
        strongShellArg('--ota=${input:geaEmbeddedBoardIp}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: install all apps over OTA',
      command: 'npm',
      args: [
        'run',
        'install-app',
        '--',
        'all',
        strongShellArg('--ota=${input:geaEmbeddedBoardIp}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: recover launcher over USB',
      command: 'npm',
      args: [
        'run',
        'recover-apps',
        '--',
        strongShellArg('--port=${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: uninstall selected app over USB',
      command: 'npm',
      args: [
        'run',
        'uninstall-app',
        '--',
        strongShellArg('${input:geaEmbeddedUninstallApp}'),
        strongShellArg('--port=${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: uninstall all apps over USB',
      command: 'npm',
      args: [
        'run',
        'uninstall-app',
        '--',
        'all',
        strongShellArg('--port=${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: uninstall selected app over OTA',
      command: 'npm',
      args: [
        'run',
        'uninstall-app',
        '--',
        strongShellArg('${input:geaEmbeddedUninstallApp}'),
        strongShellArg('--ota=${input:geaEmbeddedBoardIp}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: uninstall all apps over OTA',
      command: 'npm',
      args: [
        'run',
        'uninstall-app',
        '--',
        'all',
        strongShellArg('--ota=${input:geaEmbeddedBoardIp}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: format apps over USB',
      command: 'npm',
      args: [
        'run',
        'format-apps',
        '--',
        strongShellArg('--port=${input:geaEmbeddedSerialPort}')
      ]
    },
    {
      ...baseTask,
      label: 'Gea Embedded: format apps over OTA',
      command: 'npm',
      args: [
        'run',
        'format-apps',
        '--',
        strongShellArg('--ota=${input:geaEmbeddedBoardIp}')
      ]
    }
  ],
  inputs
}

const launchTask = label => ({
  name: label,
  type: 'node-terminal',
  request: 'launch',
  cwd: '${workspaceFolder}',
  preLaunchTask: label,
  command: 'true'
})

const launch = {
  version: '0.2.0',
  configurations: tasks.tasks
    .filter(task => task.label !== 'Gea Embedded: regenerate VS Code configs')
    .map(task => launchTask(task.label)),
  inputs
}

mkdirSync(vscodeDir, { recursive: true })
writeFileSync(path.join(vscodeDir, 'tasks.json'), `${JSON.stringify(tasks, null, 2)}\n`)
writeFileSync(path.join(vscodeDir, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`)

console.log(`Wrote VS Code deploy configs for ${espApps.length} ESP32 app(s): ${espApps.join(', ')}`)
