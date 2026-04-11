import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'

export const traverse = (_traverse as any).default || _traverse

export function parseTsx(code: string) {
  return parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  })
}
