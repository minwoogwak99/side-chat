/**
 * tsdown config for the side-chat plugin. Mirrors the harness client preset's
 * artifact contracts (packages/client/tsdown.client.ts) without depending on
 * in-repo helpers, so this package builds from its own install:
 *
 * - node half: ESM lib/index.js with every bare specifier external (the
 *   profile install resolves them).
 * - browser half: lib/client.js as a `window.__ModuleLoader__.load` closure
 *   factory; only module-table specifiers (the platform baseline) stay
 *   external, everything else inlines; `.module.css` compiles to a hashed
 *   class map plus an idempotent injected <style> tag.
 */
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TsdownPlugin, UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const ID = 'dsh-plugin-side-chat'
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))

/** Module-table specifiers shared by every dynamic bundle (web platform baseline). */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

/** Virtual-id pieces keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0side-chat-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Emit one plugin-owned style injector plus the CSS Modules class map. */
function styleInjectionModule(fileId: string, css: string, classMap: Record<string, string>): string {
  const tagId = `${ID}/${fileId.split('/').pop()}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/** CSS Modules inline loader (adapted from the harness preset). */
const cssModulesInline: TsdownPlugin = {
  name: 'side-chat-css-modules-inline',
  resolveId(source, importer) {
    if (!source.endsWith('.module.css')) return null
    const fileId = importer === undefined
      ? resolvePath(PACKAGE_ROOT, source)
      : resolvePath(dirname(importer), source)
    const portableId = relative(PACKAGE_ROOT, fileId).replaceAll('\\', '/')
    return CSS_VIRTUAL_PREFIX + portableId + CSS_VIRTUAL_SUFFIX
  },
  async load(virtualId) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const portableId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    const fileId = resolvePath(PACKAGE_ROOT, portableId)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      // Lightning CSS includes the filename in CSS Module hashes. A
      // package-relative value keeps committed bundles machine-independent.
      filename: portableId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    const entries = Object.entries(cssExports ?? {})
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    for (const [local, exp] of entries) classMap[local] = exp.name
    return styleInjectionModule(fileId, code.toString(), classMap)
  },
}

/** Node half: everything bare stays an import for the profile install to resolve. */
const nodeConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: () => true,
  },
}

/** Browser half: the __ModuleLoader__ closure-factory artifact. */
const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: specifier => CLIENT_EXTERNALS.has(specifier),
    alwaysBundle: specifier => !CLIENT_EXTERNALS.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [cssModulesInline],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeConfig, clientConfig]
