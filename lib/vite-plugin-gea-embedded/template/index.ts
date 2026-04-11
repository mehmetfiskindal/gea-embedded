import * as t from '@babel/types'
import type { CompilerDefinitions, CssClassRules, TemplateEmission } from '../types'
import { createTemplateEmitContext, toTemplateEmission } from './context'
import { emitChild, emitNode } from './nodes'

export function emitTemplate(code: string, defs: CompilerDefinitions, cssClassRules: CssClassRules, fontFaces: Map<string, string>): TemplateEmission {
  const ctx = createTemplateEmitContext(code, defs, cssClassRules, fontFaces)
  ctx.emitNode = (node, parentVar, level, exprCtx) => emitNode(ctx, node, parentVar, level, exprCtx)
  ctx.emitChild = (child, parentVar, level, exprCtx, parentNodeId) => emitChild(ctx, child, parentVar, level, exprCtx, parentNodeId)
  ctx.emitNode(defs.componentClasses.get(defs.mountTarget)!.templateJSX, null, 1, ctx.baseCtx)
  if (settingsEnabled(defs) && defs.funcComponents.has('SettingsPanel')) {
    ctx.emitNode(settingsPanelElement(), 'n0', 1, ctx.baseCtx)
  }
  return toTemplateEmission(ctx)
}

function settingsEnabled(defs: CompilerDefinitions): boolean {
  const settings = defs.storeInstances.find(si => si.jsVar === 'Settings' && si.className === 'SettingsStore')
  return !!settings && defs.initStoreCalls.some(call => call.cCall === `${settings.cStruct}_init`)
}

function settingsPanelElement(): t.JSXElement {
  const name = t.jsxIdentifier('SettingsPanel')
  return t.jsxElement(t.jsxOpeningElement(name, [], true), null, [], true)
}
