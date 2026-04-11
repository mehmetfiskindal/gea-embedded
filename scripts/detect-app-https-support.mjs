#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'

const [, , appsJsonPath, ...appIds] = process.argv

if (!appsJsonPath || appIds.length === 0) {
  console.error('Usage: detect-app-https-support.mjs <apps.json> <app-id...>')
  process.exit(1)
}

const sourceExtensions = new Set(['.css', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const ignoredDirectories = new Set([
  '.git',
  '.vite',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'test',
  'tests'
])

const appsJsonDir = dirname(resolve(appsJsonPath))
const manifest = JSON.parse(readFileSync(appsJsonPath, 'utf8'))
const appsById = new Map(manifest.apps.map(app => [app.id, app]))

function resolveAppRoot(app) {
  const candidates = [
    resolve(appsJsonDir, app.root),
    resolve(appsJsonDir, '..', app.root),
    resolve(process.cwd(), app.root)
  ]
  const root = candidates.find(candidate => existsSync(candidate))
  if (!root) throw new Error(`Cannot find root '${app.root}' for app '${app.id}'`)
  return root
}

function fileMayContainAppCode(fileName) {
  return sourceExtensions.has(extname(fileName))
}

function directoryHasHttpsUrl(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue
      if (directoryHasHttpsUrl(resolve(directory, entry.name))) return true
      continue
    }

    if (!entry.isFile() || !fileMayContainAppCode(entry.name)) continue
    if (readFileSync(resolve(directory, entry.name), 'utf8').includes('https://')) return true
  }
  return false
}

for (const appId of appIds) {
  const app = appsById.get(appId)
  if (!app) throw new Error(`Unknown app '${appId}'`)
  if (directoryHasHttpsUrl(resolveAppRoot(app))) {
    console.log('1')
    process.exit(0)
  }
}

console.log('0')
