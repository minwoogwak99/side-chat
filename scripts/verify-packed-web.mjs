/**
 * Verify the packed plugin installed into a clean profile, then start the
 * pinned DSH Web app and fetch the Browser module that users will execute.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PACKAGE_NAME = 'dsh-plugin-side-chat'
const READY_TIMEOUT_MS = 90_000
const OUTPUT_LIMIT = 64 * 1024

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function verifyInstalledProfile() {
  const home = process.env.DSH_HOME
  if (home === undefined || home === '') throw new Error('DSH_HOME is required')

  const expected = readJson(new URL('../package.json', import.meta.url))
  const profile = readJson(join(home, 'profiles/web/package.json'))
  if (!profile.dsh?.profile?.bundles?.includes(PACKAGE_NAME)) {
    throw new Error(`${PACKAGE_NAME} is missing from the Web profile bundle list`)
  }

  const installed = readJson(join(home, 'profiles/web/node_modules', PACKAGE_NAME, 'package.json'))
  if (installed.name !== PACKAGE_NAME || installed.version !== expected.version) {
    throw new Error(`installed package identity mismatch: ${installed.name}@${installed.version}`)
  }
  if (installed.dsh?.bundle?.patch !== './cordis.patch.yml' || installed.dsh?.client?.platform !== 'web') {
    throw new Error('installed DSH bundle/client manifest mismatch')
  }
}

function waitForReadyUrl(child, output) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`dsh web was not ready in ${READY_TIMEOUT_MS / 1000}s\n${output.read()}`))
    }, READY_TIMEOUT_MS)

    const onData = (chunk) => {
      output.append(chunk)
      const match = /dsh web: (http:\/\/[^\s]+)/.exec(output.read())
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`dsh web exited before readiness with code ${code}\n${output.read()}`))
    })
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise((resolve) => { child.once('close', resolve) })
  child.kill('SIGTERM')
  const timer = setTimeout(() => { child.kill('SIGKILL') }, 10_000)
  await closed
  clearTimeout(timer)
}

verifyInstalledProfile()

const output = {
  value: '',
  append(chunk) {
    this.value = `${this.value}${chunk.toString()}`.slice(-OUTPUT_LIMIT)
  },
  read() {
    return this.value
  },
}
const child = spawn(process.env.DSH_BIN ?? 'dsh', ['web', '--no-open', '--port', '0'], {
  env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

try {
  const baseUrl = await waitForReadyUrl(child, output)
  const moduleUrl = new URL(`/plugins/${PACKAGE_NAME}/client.js`, baseUrl)
  const response = await fetch(moduleUrl)
  const body = await response.text()
  if (!response.ok) throw new Error(`client module returned HTTP ${response.status}: ${body}`)
  if (!body.includes('window.__ModuleLoader__.load({') || !body.includes(`id: "${PACKAGE_NAME}"`)) {
    throw new Error('served client module is not the expected Harness Browser bundle')
  }
  console.log(`verified ${PACKAGE_NAME} at ${moduleUrl.href}`)
} finally {
  await stopChild(child)
}
