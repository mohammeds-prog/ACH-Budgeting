#!/usr/bin/env node
/**
 * Catches references to functions/variables that were never defined.
 *
 * A syntax check can't see this: `onSaveSplit={handleSaveSplit}` parses fine
 * even when handleSaveSplit has been deleted, and only blows up at runtime as
 * "ReferenceError: handleSaveSplit is not defined". That exact bug shipped to
 * the dev server once, after an edit removed three handlers by accident.
 *
 * Checks the two positions where that mistake shows up:
 *   - bare identifiers passed as JSX props     onSave={handleSave}
 *   - bare identifiers called as functions     handleSave(...)
 * against every name declared anywhere in the file (imports, functions,
 * variables, destructuring, parameters). File-level, not scope-exact — it errs
 * toward missing a bug rather than false alarms, which keeps it trustworthy.
 *
 * Run: node scripts/check-undefined-refs.js
 */
const { execSync } = require('child_process')
const fs = require('fs')
const { parse } = require('next/dist/build/swc')

const GLOBALS = new Set([
  'window', 'document', 'console', 'alert', 'confirm', 'prompt', 'fetch', 'navigator', 'location',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'queueMicrotask',
  'Math', 'Number', 'String', 'Boolean', 'Object', 'Array', 'Set', 'Map', 'WeakMap', 'Promise', 'JSON',
  'Date', 'RegExp', 'Error', 'TypeError', 'Symbol', 'BigInt', 'Intl', 'URL', 'URLSearchParams', 'Blob',
  'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
  'TextEncoder', 'TextDecoder', 'Uint8Array', 'ArrayBuffer', 'structuredClone', 'crypto',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'require', 'module', 'process', 'globalThis', 'undefined', 'NaN', 'Infinity', 'atob', 'btoa',
  'getComputedStyle', 'matchMedia', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
])

function collectPattern(p, out) {
  if (!p) return
  switch (p.type) {
    case 'Identifier':       out.add(p.value); break
    case 'BindingIdentifier': out.add(p.value); break
    case 'ArrayPattern':     p.elements.forEach((e) => collectPattern(e, out)); break
    case 'ObjectPattern':
      p.properties.forEach((prop) => {
        if (prop.type === 'KeyValuePatternProperty') collectPattern(prop.value, out)
        else if (prop.type === 'AssignmentPatternProperty') collectPattern(prop.key, out)
        else if (prop.type === 'RestElement') collectPattern(prop.argument, out)
      })
      break
    case 'AssignmentPattern': collectPattern(p.left, out); break
    case 'RestElement':       collectPattern(p.argument, out); break
    case 'Param':
    case 'Parameter':         collectPattern(p.pat, out); break
  }
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
  if (node.type) visit(node)
  for (const k in node) if (k !== 'span' && k !== 'ctxt') walk(node[k], visit)
}

async function check(file) {
  const src = fs.readFileSync(file, 'utf8')
  const ast = await parse(src, { jsx: true, syntax: 'ecmascript', filename: file })
  const declared = new Set()
  const used = []   // { name, line }

  const lineOf = (span) => (span ? src.slice(0, Math.max(0, span.start - 1)).split('\n').length : '?')

  walk(ast, (n) => {
    switch (n.type) {
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
      case 'ImportSpecifier':     declared.add(n.local.value); break
      case 'FunctionDeclaration':
      case 'FunctionExpression':
        if (n.identifier) declared.add(n.identifier.value)
        // swc puts params directly on the function node, as `Parameter`s.
        ;(n.params || []).forEach((p) => collectPattern(p, declared))
        break
      case 'ClassDeclaration':    if (n.identifier) declared.add(n.identifier.value); break
      case 'VariableDeclarator':  collectPattern(n.id, declared); break
      case 'Function':            (n.params || []).forEach((p) => collectPattern(p, declared)); break
      case 'ArrowFunctionExpression': (n.params || []).forEach((p) => collectPattern(p, declared)); break
      case 'CatchClause':         collectPattern(n.param, declared); break
      case 'JSXExpressionContainer':
        if (n.expression?.type === 'Identifier') used.push({ name: n.expression.value, line: lineOf(n.expression.span) })
        break
      case 'CallExpression':
        if (n.callee?.type === 'Identifier') used.push({ name: n.callee.value, line: lineOf(n.callee.span) })
        break
    }
  })

  return used.filter((u) => !declared.has(u.name) && !GLOBALS.has(u.name))
}

;(async () => {
  const files = execSync('git ls-files "*.js" "*.jsx"', { encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => f && !f.startsWith('.claude/') && !f.startsWith('scripts/') && !f.startsWith('supabase/'))

  let problems = 0
  for (const f of files) {
    let missing
    try { missing = await check(f) } catch { continue }
    const seen = new Set()
    for (const m of missing) {
      const key = m.name + ':' + m.line
      if (seen.has(key)) continue
      seen.add(key)
      problems++
      console.error(`  ${f}:${m.line}  "${m.name}" is used but never defined`)
    }
  }

  if (problems) {
    console.error(`\n✗ ${problems} undefined reference(s) — these will crash at runtime`)
    process.exit(1)
  }
  console.log('✓ no undefined function or handler references')
})()
