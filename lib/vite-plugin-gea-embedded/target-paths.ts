/**
 * target-paths.ts — shared helper for example vite.config.ts files.
 *
 * Resolves the build output paths based on GEA_EMBEDDED_TARGET:
 *   - 'web'  → simulator/public/apps/<id> + targets/web/generated/<id>
 *   - 'rpi'  → ../../build/rpi/apps/<id>  (shared with the rpi-display-1 target)
 *   - default (esp32) → targets/esp32-s3-touch-amoled-2.06/build/apps/<id>
 *
 * Usage from an example vite.config.ts:
 *   import { resolveAppPaths } from '../../lib/vite-plugin-gea-embedded/target-paths'
 *   const paths = resolveAppPaths('tic-tac-toe')
 *   // paths.cOutput, paths.outDir
 */

import { resolve } from 'path'

const TARGET = process.env.GEA_EMBEDDED_TARGET || ''

function fromRepoRoot(...parts: string[]): string {
    return resolve(__dirname, '..', '..', ...parts)
}

export interface AppPaths {
    cOutput: string
    outDir: string
    format: 'es' | 'iif e'
    fileName: () => string
    libName?: string
}

export function resolveAppPaths(appId: string): AppPaths {
    if (TARGET === 'web') {
        return {
            cOutput: fromRepoRoot('targets', 'web', 'generated', appId, 'gea_embedded_app_generated.c'),
            outDir:  fromRepoRoot('simulator', 'public', 'apps', appId),
            format:  'es',
            fileName: () => 'app.js',
        }
    }
    if (TARGET === 'rpi') {
        // CMakeLists at targets/rpi-display-1/CMakeLists.txt sets
        // GEA_EMBEDDED_C_OUTPUT, GEA_EMBEDDED_FONT_C_OUTPUT, etc. as env
        // vars when invoking npm. Honor those if present, otherwise
        // fall back to a sensible default relative to the repo root.
        const buildRoot = process.env.GEA_RPI_BUILD_ROOT || fromRepoRoot('build', 'rpi')
        return {
            cOutput: process.env.GEA_EMBEDDED_C_OUTPUT
                || `${buildRoot}/apps/${appId}/gea_embedded_app_generated.c`,
            outDir:  process.env.GEA_EMBEDDED_OUT_DIR
                || `${buildRoot}/apps/${appId}/dist`,
            format:  'iife',
            fileName: () => 'index.js',
            libName: 'gea_embedded',
        }
    }
    // default = esp32-s3-touch-amoled-2.06
    return {
        cOutput: fromRepoRoot('targets', 'esp32-s3-touch-amoled-2.06', 'build', 'apps', appId, 'gea_embedded_app_generated.c'),
        outDir:  fromRepoRoot('targets', 'esp32-s3-touch-amoled-2.06', 'build', 'apps', appId, 'dist'),
        format:  'iife',
        fileName: () => 'index.js',
        libName: 'gea_embedded',
    }
}
