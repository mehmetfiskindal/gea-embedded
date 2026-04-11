#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const requireFromLib = createRequire(new URL('../lib/package.json', import.meta.url))
const { parse } = requireFromLib('@babel/parser')
const traverseModule = requireFromLib('@babel/traverse')
const t = requireFromLib('@babel/types')
const traverse = traverseModule.default || traverseModule

const [, , appsJsonPath, outputPath, ...appIds] = process.argv

if (!appsJsonPath || !outputPath || appIds.length === 0) {
  console.error('Usage: generate-resident-app-registry.mjs <apps.json> <output.c> <app-id...>')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(appsJsonPath, 'utf8'))
const appsById = new Map(manifest.apps.map(app => [app.id, app]))
const repoRoot = resolve(dirname(appsJsonPath), '..')

function symbolPrefix(appId) {
  return `gea_resident_${appId.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function quote(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function parseTsx(code) {
  return parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  })
}

function discoverLocalImport(source, srcId, localImports) {
  if (!source.startsWith('.') || source.endsWith('.css')) return
  for (const p of [
    resolve(dirname(srcId), source + '.tsx'),
    resolve(dirname(srcId), source + '.ts'),
    resolve(dirname(srcId), source, 'index.tsx'),
    resolve(dirname(srcId), source, 'index.ts')
  ]) {
    if (existsSync(p)) {
      localImports.push(p)
      break
    }
  }
}

function collectMemberPath(node) {
  if (t.isIdentifier(node)) return [node.name]
  if (!t.isMemberExpression(node) || node.computed) return null
  const objectPath = collectMemberPath(node.object)
  if (!objectPath || !t.isIdentifier(node.property)) return null
  objectPath.push(node.property.name)
  return objectPath
}

function evalStaticLiteral(node) {
  if (t.isBooleanLiteral(node) || t.isNumericLiteral(node) || t.isStringLiteral(node)) return node.value
  if (t.isNullLiteral(node)) return null
  if (t.isUnaryExpression(node, { operator: '-' })) {
    const value = evalStaticLiteral(node.argument)
    if (typeof value === 'number') return -value
  }
  if (t.isUnaryExpression(node, { operator: '+' })) {
    const value = evalStaticLiteral(node.argument)
    if (typeof value === 'number') return value
  }
  return undefined
}

function assignDefaultPath(target, path, value) {
  if (path.length === 0) return
  let cursor = target
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]
    if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {}
    cursor = cursor[segment]
  }
  cursor[path[path.length - 1]] = value
}

function collectDisplayDefaults(app) {
  const entry = resolve(repoRoot, app.root, app.entry)
  const pending = [entry]
  const processed = new Set()
  const defaults = {}

  while (pending.length > 0) {
    const srcId = pending.shift()
    if (processed.has(srcId)) continue
    processed.add(srcId)

    const code = readFileSync(srcId, 'utf8')
    const ast = parseTsx(code)
    const defaultVars = new Set()

    traverse(ast, {
      ImportDeclaration(path) {
        const source = path.node.source.value
        if (source.includes('gea-embedded')) {
          for (const spec of path.node.specifiers) {
            if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported, { name: 'defaults' }) && t.isIdentifier(spec.local)) {
              defaultVars.add(spec.local.name)
            }
          }
        }
        discoverLocalImport(source, srcId, pending)
      }
    })

    traverse(ast, {
      ExpressionStatement(path) {
        if (path.parent.type !== 'Program') return
        const expr = path.node.expression
        if (!t.isAssignmentExpression(expr, { operator: '=' })) return
        const memberPath = collectMemberPath(expr.left)
        if (!memberPath || memberPath.length < 3 || !defaultVars.has(memberPath[0])) return
        if (memberPath[1] !== 'display') return

        const value = evalStaticLiteral(expr.right)
        if (value === undefined) return
        assignDefaultPath(defaults, memberPath.slice(1), value)
      }
    })
  }

  return defaults.display || {}
}

function positiveInteger(value) {
  if (typeof value !== 'number') return 0
  const rounded = Math.floor(value)
  return rounded > 0 ? rounded : 0
}

const apps = appIds.map(appId => {
  const app = appsById.get(appId)
  if (!app) throw new Error(`Unknown resident app '${appId}'`)
  if (app.runtime !== 'app-render') throw new Error(`Resident app '${appId}' must use runtime 'app-render'`)
  const displayDefaults = collectDisplayDefaults(app)
  return {
    id: appId,
    prefix: symbolPrefix(appId),
    displayFlushChunkRows: positiveInteger(displayDefaults.flushChunkRows),
    displayFlushQueueDepth: positiveInteger(displayDefaults.flushQueueDepth)
  }
})

const lines = [
  '#include "resident_apps.h"',
  '#include "event.h"',
  '',
  '#include <stdio.h>',
  '#include <string.h>',
  '',
  '#include "esp_log.h"',
  '#include "freertos/FreeRTOS.h"',
  '#include "freertos/queue.h"',
  '#include "freertos/portmacro.h"',
  '#include "display.h"',
  '',
  'static const char *TAG = "resident_apps";',
  'static const char *LAUNCHER_APP_ID = "app-launcher";',
  'static portMUX_TYPE pending_launch_lock = portMUX_INITIALIZER_UNLOCKED;',
  'static char pending_launch_app_id[64];',
  'static int pending_launch_valid = 0;',
  ''
]

for (const app of apps) {
  const p = app.prefix
  lines.push(
    `extern void ${p}_init(int w, int h);`,
    `extern void ${p}_frame(int timestamp_ms);`,
    `extern void ${p}_touch(int press_id);`,
    `extern void ${p}_touch_start_element(int press_id, int x, int y);`,
    `extern void ${p}_touch_end_element(int press_id, int x, int y);`,
    `extern void ${p}_touch_move_element(int press_id, int x, int y);`,
    `extern void ${p}_touch_start(int x, int y);`,
    `extern void ${p}_touch_move(int x, int y);`,
    `extern void ${p}_touch_end(int x, int y);`,
    `extern void ${p}_settings_toggle(void);`,
    `extern int ${p}_mirror_begin_snapshot(void);`,
    `extern int ${p}_mirror_begin_diff(void);`,
    `extern int ${p}_mirror_next_record(unsigned char *dst, int cap);`,
    `extern void ${p}_mirror_clear_dirty(void);`,
    `extern const gea_embedded_font_t *${p}_font_lookup(int font_id);`,
    `extern void ${p}_ble_connected(void);`,
    `extern void ${p}_ble_disconnected(void);`,
    `extern void ${p}_ble_bound(void);`,
    ''
  )
}

for (const app of apps) {
  const p = app.prefix
  lines.push(
    `void __attribute__((weak)) ${p}_ble_connected(void) {}`,
    `void __attribute__((weak)) ${p}_ble_disconnected(void) {}`,
    `void __attribute__((weak)) ${p}_ble_bound(void) {}`,
    ''
  )
}

lines.push('static const gea_embedded_resident_app_t resident_apps[] = {')
for (const app of apps) {
  const p = app.prefix
  lines.push(
    `\t{ "${quote(app.id)}", ${app.displayFlushChunkRows}, ${app.displayFlushQueueDepth}, ${p}_init, ${p}_frame, ${p}_touch,`,
    `\t  ${p}_touch_start_element, ${p}_touch_end_element, ${p}_touch_move_element,`,
    `\t  ${p}_touch_start, ${p}_touch_move, ${p}_touch_end,`,
    `\t  ${p}_settings_toggle,`,
    `\t  ${p}_mirror_begin_snapshot, ${p}_mirror_begin_diff, ${p}_mirror_next_record, ${p}_mirror_clear_dirty, ${p}_font_lookup,`,
    `\t  ${p}_ble_connected, ${p}_ble_disconnected, ${p}_ble_bound },`
  )
}
lines.push('};')
lines.push(`static const int resident_app_count = ${apps.length};`)
lines.push('static const gea_embedded_resident_app_t *active_app = &resident_apps[0];')
lines.push('')

lines.push(
  'static void apply_display_config(const gea_embedded_resident_app_t *app)',
  '{',
  '\tif (!app) return;',
  '\tgea_embedded_display_set_flush_config(app->display_flush_chunk_rows, app->display_flush_queue_depth);',
  '}',
  '',
  'static const gea_embedded_resident_app_t *find_app(const char *app_id)',
  '{',
  "\tif (!app_id || app_id[0] == '\\0') return NULL;",
  '\tfor (int i = 0; i < resident_app_count; i++) {',
  '\t\tif (strcmp(resident_apps[i].id, app_id) == 0) return &resident_apps[i];',
  '\t}',
  '\treturn NULL;',
  '}',
  '',
  'int gea_embedded_resident_apps_is_enabled(void)',
  '{',
  '\treturn resident_app_count > 0;',
  '}',
  '',
  'const char *gea_embedded_resident_apps_active_id(void)',
  '{',
  '\treturn active_app ? active_app->id : NULL;',
  '}',
  '',
  'int gea_embedded_resident_apps_select(const char *app_id)',
  '{',
  '\tconst gea_embedded_resident_app_t *next = find_app(app_id);',
  '\tif (!next) return 0;',
  '\tactive_app = next;',
  '\tapply_display_config(active_app);',
  '\tESP_LOGI(TAG, "Selected resident app \'%s\'", active_app->id);',
  '\treturn 1;',
  '}',
  '',
  'int gea_embedded_resident_apps_request_launch(const char *app_id)',
  '{',
  '\tif (!find_app(app_id)) return 0;',
  '\tportENTER_CRITICAL(&pending_launch_lock);',
  '\tsnprintf(pending_launch_app_id, sizeof(pending_launch_app_id), "%s", app_id);',
  '\tpending_launch_valid = 1;',
  '\tportEXIT_CRITICAL(&pending_launch_lock);',
  '',
  '\tif (gea_embedded_event_queue) {',
  '\t\tgea_embedded_event_t evt = { .type = GEA_EMBEDDED_EVT_APP_LAUNCH, .data = 0 };',
  '\t\tif (xQueueSend(gea_embedded_event_queue, &evt, 0) != pdPASS) {',
  '\t\t\tportENTER_CRITICAL(&pending_launch_lock);',
  '\t\t\tpending_launch_valid = 0;',
  "\t\t\tpending_launch_app_id[0] = '\\0';",
  '\t\t\tportEXIT_CRITICAL(&pending_launch_lock);',
  '\t\t\tESP_LOGW(TAG, "Launch queue is full for resident app \'%s\'", app_id);',
  '\t\t\treturn 0;',
  '\t\t}',
  '\t}',
  '\treturn 1;',
  '}',
  '',
  'int gea_embedded_resident_apps_consume_launch(char *dst, size_t cap)',
  '{',
  '\tif (!dst || cap == 0) return 0;',
  '\tportENTER_CRITICAL(&pending_launch_lock);',
  '\tint valid = pending_launch_valid;',
  '\tif (valid) {',
  '\t\tsnprintf(dst, cap, "%s", pending_launch_app_id);',
  '\t\tpending_launch_valid = 0;',
  "\t\tpending_launch_app_id[0] = '\\0';",
  '\t}',
  '\tportEXIT_CRITICAL(&pending_launch_lock);',
  '\treturn valid;',
  '}',
  '',
  'int gea_embedded_resident_apps_return_to_launcher(const char *trigger)',
  '{',
  '\tif (!active_app || strcmp(active_app->id, LAUNCHER_APP_ID) == 0) return 0;',
  '\tESP_LOGI(TAG, "%s; returning to resident launcher from \'%s\'", trigger ? trigger : "Launcher requested", active_app->id);',
  '\treturn gea_embedded_resident_apps_request_launch(LAUNCHER_APP_ID);',
  '}',
  '',
  'void gea_embedded_app_init(int w, int h) { if (active_app) { apply_display_config(active_app); if (active_app->init) active_app->init(w, h); } }',
  'void gea_embedded_app_frame(int timestamp_ms) { if (active_app && active_app->frame) active_app->frame(timestamp_ms); }',
  'void gea_embedded_app_touch(int press_id) { if (active_app && active_app->touch) active_app->touch(press_id); }',
  'void gea_embedded_app_touch_start_element(int press_id, int x, int y) { if (active_app && active_app->touch_start_element) active_app->touch_start_element(press_id, x, y); }',
  'void gea_embedded_app_touch_end_element(int press_id, int x, int y) { if (active_app && active_app->touch_end_element) active_app->touch_end_element(press_id, x, y); }',
  'void gea_embedded_app_touch_move_element(int press_id, int x, int y) { if (active_app && active_app->touch_move_element) active_app->touch_move_element(press_id, x, y); }',
  'void gea_embedded_app_touch_start(int x, int y) { if (active_app && active_app->touch_start) active_app->touch_start(x, y); }',
  'void gea_embedded_app_touch_move(int x, int y) { if (active_app && active_app->touch_move) active_app->touch_move(x, y); }',
  'void gea_embedded_app_touch_end(int x, int y) { if (active_app && active_app->touch_end) active_app->touch_end(x, y); }',
  'void gea_embedded_app_settings_toggle(void) { if (active_app && active_app->settings_toggle) active_app->settings_toggle(); }',
  '',
  'int gea_embedded_app_mirror_begin_snapshot(void) { return active_app && active_app->mirror_begin_snapshot ? active_app->mirror_begin_snapshot() : 0; }',
  'int gea_embedded_app_mirror_begin_diff(void) { return active_app && active_app->mirror_begin_diff ? active_app->mirror_begin_diff() : 0; }',
  'int gea_embedded_app_mirror_next_record(unsigned char *dst, int cap) { return active_app && active_app->mirror_next_record ? active_app->mirror_next_record(dst, cap) : 0; }',
  'void gea_embedded_app_mirror_clear_dirty(void) { if (active_app && active_app->mirror_clear_dirty) active_app->mirror_clear_dirty(); }',
  '',
  'const gea_embedded_font_t *gea_embedded_font_lookup(int font_id)',
  '{',
  '\tif (active_app && active_app->font_lookup) return active_app->font_lookup(font_id);',
  '\treturn NULL;',
  '}',
  '',
  'void gea_embedded_app_ble_connected(void) { if (active_app && active_app->ble_connected) active_app->ble_connected(); }',
  'void gea_embedded_app_ble_disconnected(void) { if (active_app && active_app->ble_disconnected) active_app->ble_disconnected(); }',
  'void gea_embedded_app_ble_bound(void) { if (active_app && active_app->ble_bound) active_app->ble_bound(); }',
  ''
)

const newContent = lines.join('\n')
const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null
if (existing !== newContent) {
  writeFileSync(outputPath, newContent)
}
