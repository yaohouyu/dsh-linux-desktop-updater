/**
 * DeepSeek Harness Linux desktop updater (Host half).
 *
 * The Linux desktop package of DeepSeek Harness is built by
 * https://github.com/wenyinos/dsh-desktop-linux and ships as a plain .deb / .rpm.
 * It has no in-application updater, so this plugin adds one:
 *
 *   - reads the installed package version from dpkg/rpm (asar fallback),
 *   - reads the newest release from the repository's public Atom feed,
 *   - downloads the matching Linux asset into $DSH_HOME/app-updater/downloads,
 *   - installs it through pkexec (one system authorization dialog),
 *   - exposes the same operations to the Web UI and to an agent tool.
 *
 * The Web UI talks to this file through the exact `/api/dsh-linux-desktop-updater/*`
 * routes registered on `ctx.connection.fetch` (raw HTTP fallback: `ctx.webServer`).
 *
 * Nothing here installs automatically: every download and install starts only
 * from an explicit user action.
 */

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat, statfs } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-linux-desktop-updater'

const PACKAGE_NAME = 'deepseek-harness'
const REPO = 'wenyinos/dsh-desktop-linux'
const REPO_PAGE = `https://github.com/${REPO}`
const API_PREFIX = '/api/dsh-linux-desktop-updater'
const MARKER_HEADER = 'x-dsh-linux-desktop-updater'
const CHECK_TTL_MS = 5 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000
const MAX_ASSET_BYTES = 1.5 * 1024 * 1024 * 1024
const MAX_LOG_LINES = 500

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeGet(ctx, key) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(key) : undefined
  } catch {
    return undefined
  }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(homedir(), '.dsh')
}

function cacheRoot() {
  return path.join(dshHome(), 'app-updater')
}

function downloadDir() {
  return path.join(cacheRoot(), 'downloads')
}

function shellQuote(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

async function fileExists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function execCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeout ?? 10000,
        env: options.env ?? process.env,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = !error ? 0 : typeof error.code === 'number' ? error.code : -1
        resolve({
          ok: !error,
          code,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          error: error ? String(error.message || error) : null,
        })
      },
    )
  })
}

/* ------------------------------------------------------------------ */
/* Version handling (semver-ish, tolerant of Debian `~rc` versions)    */
/* ------------------------------------------------------------------ */

function parseVersion(input) {
  const cleaned = String(input ?? '')
    .trim()
    .replace(/^dsh-v/i, '')
    .replace(/^v/i, '')
    .replace(/~/g, '-')
  const withoutBuild = cleaned.split('+')[0]
  const dash = withoutBuild.indexOf('-')
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const pre = dash === -1 ? '' : withoutBuild.slice(dash + 1)
  const nums = core.split('.').map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) ? value : 0
  })
  while (nums.length < 3) nums.push(0)
  return { raw: cleaned, nums: nums.slice(0, 3), pre: pre ? pre.split('.') : [] }
}

/** Returns 1 when a > b, -1 when a < b, 0 when equal. */
function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1
  }
  const lp = left.pre
  const rp = right.pre
  if (lp.length === 0 && rp.length === 0) return 0
  if (lp.length === 0) return 1
  if (rp.length === 0) return -1
  const length = Math.max(lp.length, rp.length)
  for (let i = 0; i < length; i += 1) {
    const x = lp[i]
    const y = rp[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff > 0 ? 1 : -1
      continue
    }
    if (xNumeric) return -1
    if (yNumeric) return 1
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/* ------------------------------------------------------------------ */
/* Installed app detection (dpkg / rpm, then app.asar fallback)        */
/* ------------------------------------------------------------------ */

let familyCache = null

async function detectFamily() {
  if (familyCache) return familyCache
  let family = 'unknown'
  if (await fileExists('/etc/debian_version')) family = 'debian'
  else if (
    (await fileExists('/etc/redhat-release')) ||
    (await fileExists('/etc/fedora-release')) ||
    (await fileExists('/etc/SuSE-release')) ||
    (await fileExists('/etc/system-release'))
  ) {
    family = 'rpm'
  }
  familyCache = family
  return family
}

const installedCache = { at: 0, value: null, pending: null }

async function readAsarFile(asarPath, innerPath) {
  const handle = await open(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    await handle.read(head, 0, 16, 0)
    const pickleSize = head.readUInt32LE(4)
    const jsonLength = head.readUInt32LE(12)
    if (!pickleSize || !jsonLength) throw new Error('not an asar archive')
    const header = Buffer.alloc(jsonLength)
    await handle.read(header, 0, jsonLength, 16)
    const tree = JSON.parse(header.toString('utf8'))
    let node = tree
    for (const part of innerPath.split('/')) {
      node = node && node.files ? node.files[part] : undefined
    }
    if (!node || typeof node.size !== 'number') throw new Error('entry not found')
    const content = Buffer.alloc(node.size)
    if (node.size > 0) {
      await handle.read(content, 0, node.size, 8 + pickleSize + Number(node.offset))
    }
    return content
  } finally {
    await handle.close()
  }
}

async function readAppPackage() {
  const candidates = []
  const add = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value)
  }
  if (typeof process.resourcesPath === 'string') {
    add(path.join(process.resourcesPath, 'app.asar'))
  }
  try {
    add(path.join(path.dirname(process.execPath), 'resources', 'app.asar'))
  } catch {
    /* ignore */
  }
  add('/opt/DeepSeek Harness/resources/app.asar')
  for (const asarPath of candidates) {
    try {
      const buffer = await readAsarFile(asarPath, 'package.json')
      const parsed = JSON.parse(buffer.toString('utf8'))
      return {
        version: typeof parsed.version === 'string' ? parsed.version : null,
        name: typeof parsed.name === 'string' ? parsed.name : null,
        productName: typeof parsed.productName === 'string' ? parsed.productName : null,
        asarPath,
        root: path.dirname(path.dirname(asarPath)),
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

async function computeInstalled() {
  const family = await detectFamily()
  const result = {
    packageName: PACKAGE_NAME,
    version: null,
    status: null,
    arch: null,
    family,
    source: null,
    root: null,
    app: null,
  }
  if (family === 'debian') {
    const query = await execCapture('/usr/bin/dpkg-query', [
      '-W',
      '-f=${Version}\t${Status}\t${Architecture}',
      PACKAGE_NAME,
    ])
    if (query.ok && query.stdout.trim()) {
      const [version, status, arch] = query.stdout.trim().split('\t')
      result.version = version || null
      result.status = status || null
      result.arch = arch || null
      result.source = 'dpkg'
    }
  } else if (family === 'rpm') {
    const query = await execCapture('/usr/bin/rpm', ['-q', '--qf', '%{VERSION}-%{RELEASE}\t%{ARCH}', PACKAGE_NAME])
    if (query.ok && query.stdout.trim()) {
      const [version, arch] = query.stdout.trim().split('\t')
      result.version = version || null
      result.arch = arch || null
      result.source = 'rpm'
    }
  }
  const app = await readAppPackage()
  if (app) {
    result.app = app
    result.root = app.root
    if (!result.version) {
      result.version = app.version
      result.source = 'asar'
      result.arch = process.arch
    }
  }
  if (!result.root) {
    try {
      result.root = path.dirname(process.execPath)
    } catch {
      result.root = null
    }
  }
  return result
}

async function readInstalled(force = false) {
  const now = Date.now()
  if (!force && installedCache.value && now - installedCache.at < 2000) return installedCache.value
  if (!force && installedCache.pending) return installedCache.pending
  const pending = computeInstalled()
    .then((value) => {
      installedCache.value = value
      installedCache.at = Date.now()
      return value
    })
    .finally(() => {
      installedCache.pending = null
    })
  installedCache.pending = pending
  return pending
}

/* ------------------------------------------------------------------ */
/* Latest release discovery (GitHub Atom feed: no API rate limit)      */
/* ------------------------------------------------------------------ */

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (match, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
}

function htmlToText(html) {
  let text = String(html ?? '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, '• ')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseAtom(xml) {
  const releases = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let match = entryRe.exec(xml)
  while (match) {
    const body = match[1]
    const idMatch = body.match(/<id>tag:github\.com,2008:Repository\/\d+\/([^<]+)<\/id>/)
    const tag = idMatch ? idMatch[1] : null
    if (tag && /^dsh-v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(tag)) {
      const version = tag.slice('dsh-v'.length)
      const titleRaw = (body.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]
      const updated = (body.match(/<updated>([^<]+)<\/updated>/) || [, ''])[1]
      const link = (body.match(/<link[^>]*href="([^"]+)"/) || [, ''])[1]
      const contentRaw = (body.match(/<content type="html">([\s\S]*?)<\/content>/) || [, ''])[1]
      releases.push({
        tag,
        version,
        title: htmlToText(decodeEntities(titleRaw)) || `DeepSeek Harness ${version}`,
        publishedAt: updated || null,
        url: link || `${REPO_PAGE}/releases/tag/${tag}`,
        notes: htmlToText(decodeEntities(contentRaw)),
      })
    }
    match = entryRe.exec(xml)
  }
  return releases
}

function debArch(arch) {
  return arch === 'arm64' ? 'arm64' : 'amd64'
}

function rpmArch(arch) {
  return arch === 'arm64' ? 'aarch64' : 'x86_64'
}

function assetForRelease(release, family, arch) {
  const version = release.version
  if (family === 'rpm') {
    const name = `${PACKAGE_NAME}-${version}-linux-${rpmArch(arch)}.rpm`
    return { name, url: `${REPO_PAGE}/releases/download/${release.tag}/${name}`, kind: 'rpm' }
  }
  const name = `${PACKAGE_NAME}-${version}-linux-${debArch(arch)}.deb`
  return { name, url: `${REPO_PAGE}/releases/download/${release.tag}/${name}`, kind: 'deb' }
}

async function fetchLatestRelease() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${REPO_PAGE}/releases.atom`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'dsh-linux-desktop-updater/1.0 (+dsh plugin)',
        accept: 'application/atom+xml, application/xml;q=0.9, text/html;q=0.8',
      },
    })
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`)
    const xml = await response.text()
    const releases = parseAtom(xml)
    if (releases.length === 0) throw new Error('未能从 GitHub 解析到任何 dsh-v* 发布')
    let best = null
    for (const release of releases) {
      if (!best || compareVersions(release.version, best.version) > 0) best = release
    }
    const family = await detectFamily()
    const asset = assetForRelease(best, family, process.arch)
    return {
      ...best,
      family,
      arch: process.arch,
      assetName: asset.name,
      assetUrl: asset.url,
      checkedAt: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* Package inspection (no privilege required)                          */
/* ------------------------------------------------------------------ */

async function inspectPackage(file, family) {
  if (family === 'rpm') {
    const query = await execCapture('/usr/bin/rpm', ['-qp', '--qf', '%{VERSION}-%{RELEASE}', file])
    if (query.ok) return query.stdout.trim() || null
    return null
  }
  const query = await execCapture('/usr/bin/dpkg-deb', ['--field', file, 'Version'])
  if (query.ok) {
    const version = query.stdout.trim().split(/\s/)[0]
    return version || null
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Task runtime state                                                  */
/* ------------------------------------------------------------------ */

const runtime = {
  phase: 'idle', // idle | checking | downloading | installing | installed | needs-manual | error
  message: '',
  error: null,
  log: [],
  manualCommand: null,
  installMethod: null,
  latest: null,
  download: null,
  progress: null,
  requiresRestart: false,
  installedAfter: null,
  startedAt: null,
  finishedAt: null,
}

let bootVersion = null
let bootVersionRead = false
let lastCheckAt = 0
let downloadController = null
let activeChild = null
let activeTask = null

function isBusy() {
  return runtime.phase === 'checking' || runtime.phase === 'downloading' || runtime.phase === 'installing'
}

function appendLog(text) {
  const clean = String(text ?? '').replace(/\r/g, '')
  for (const line of clean.split('\n')) {
    const trimmed = line.trimEnd()
    if (!trimmed) continue
    runtime.log.push(trimmed.slice(0, 800))
  }
  if (runtime.log.length > MAX_LOG_LINES) {
    runtime.log.splice(0, runtime.log.length - MAX_LOG_LINES)
  }
}

function resetForTask(phase, message) {
  runtime.phase = phase
  runtime.message = message
  runtime.error = null
  runtime.manualCommand = null
  runtime.startedAt = new Date().toISOString()
  runtime.finishedAt = null
  if (phase === 'downloading' || phase === 'installing') runtime.log = []
}

async function checkForUpdate(options = {}) {
  const force = options.force === true
  if (!force && runtime.latest && Date.now() - lastCheckAt < CHECK_TTL_MS) {
    return runtime.latest
  }
  if (isBusy() && runtime.phase !== 'checking') throw new Error('已有更新任务正在进行，请稍后再检查。')
  resetForTask('checking', '正在检查 GitHub 上的最新版本…')
  try {
    const latest = await fetchLatestRelease()
    runtime.latest = latest
    lastCheckAt = Date.now()
    runtime.phase = 'idle'
    runtime.message = ''
    runtime.progress = null
    runtime.finishedAt = new Date().toISOString()
    return latest
  } catch (error) {
    runtime.phase = 'idle'
    runtime.message = ''
    runtime.error = String(error && error.message ? error.message : error)
    runtime.finishedAt = new Date().toISOString()
    throw error
  }
}

async function ensureDownloaded() {
  const latest = runtime.latest || (await fetchLatestRelease())
  runtime.latest = latest
  const installed = await readInstalled(true)
  if (installed.version && compareVersions(latest.version, installed.version) <= 0) {
    throw new Error(`当前已是最新版本（${installed.version}），无需下载。`)
  }
  const dir = downloadDir()
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, latest.assetName)
  if (await fileExists(target)) {
    const version = await inspectPackage(target, latest.family)
    if (version && compareVersions(version, latest.version) === 0) {
      const info = await stat(target)
      runtime.download = {
        file: target,
        version,
        bytes: info.size,
        sha256: null,
        reused: true,
        assetName: latest.assetName,
      }
      runtime.message = '已存在校验通过的安装包，跳过下载。'
      return target
    }
    await rm(target, { force: true })
  }

  const stats = await statfs(dir).catch(() => null)
  if (stats) {
    const freeBytes = Number(stats.bavail) * Number(stats.bsize)
    if (Number.isFinite(freeBytes) && freeBytes < 600 * 1024 * 1024) {
      throw new Error('磁盘剩余空间不足 600 MB，无法下载安装包。')
    }
  }

  const part = `${target}.part`
  await rm(part, { force: true })
  const controller = new AbortController()
  downloadController = controller
  runtime.progress = { received: 0, total: null, percent: null }
  runtime.message = '正在下载安装包…'
  const hash = createHash('sha256')
  let handle = null
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(latest.assetUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'dsh-linux-desktop-updater/1.0 (+dsh plugin)' },
    })
    if (!response.ok) throw new Error(`下载安装包失败：HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    const total = Number.isFinite(declared) && declared > 0 ? declared : null
    if (total && total > MAX_ASSET_BYTES) throw new Error('安装包体积异常，已取消下载。')
    handle = await open(part, 'w')
    let received = 0
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      received += buffer.length
      if (received > MAX_ASSET_BYTES) throw new Error('安装包体积异常，已取消下载。')
      hash.update(buffer)
      await handle.write(buffer)
      runtime.progress = {
        received,
        total,
        percent: total ? Math.min(100, Math.round((received / total) * 1000) / 10) : null,
      }
    }
    await handle.close()
    handle = null
    if (total && received !== total) throw new Error(`下载不完整（${received}/${total} 字节）。`)
    await rename(part, target)
    const version = await inspectPackage(target, latest.family)
    if (!version) throw new Error('安装包校验失败：无法读取包信息。')
    if (compareVersions(version, latest.version) !== 0) {
      throw new Error(`安装包版本不匹配（${version} ≠ ${latest.version}）。`)
    }
    runtime.download = {
      file: target,
      version,
      bytes: received,
      sha256: hash.digest('hex'),
      reused: false,
      assetName: latest.assetName,
    }
    runtime.message = '下载完成，准备安装。'
    return target
  } catch (error) {
    try {
      if (handle) await handle.close()
    } catch {
      /* ignore */
    }
    await rm(part, { force: true }).catch(() => {})
    if (controller.signal.aborted) throw new Error('下载已取消。')
    throw error
  } finally {
    clearTimeout(timer)
    if (downloadController === controller) downloadController = null
  }
}

function spawnTracked(argv, options = {}) {
  return new Promise((resolve) => {
    let timer = null
    let child = null
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (activeChild === child) activeChild = null
      resolve(result)
    }
    try {
      child = spawn(argv[0], argv.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        cwd: tmpdir(),
      })
    } catch (error) {
      finish({ code: -1, signal: null, error: String(error && error.message ? error.message : error) })
      return
    }
    activeChild = child
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        appendLog('执行超时，正在尝试终止进程…')
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }, 5000)
      }, options.timeoutMs)
    }
    const onData = (chunk) => appendLog(chunk.toString())
    if (child.stdout) child.stdout.on('data', onData)
    if (child.stderr) child.stderr.on('data', onData)
    child.on('error', (error) => {
      finish({ code: -1, signal: null, error: String(error && error.message ? error.message : error) })
    })
    child.on('close', (code, signal) => {
      finish({ code: typeof code === 'number' ? code : -1, signal: signal || null, error: null })
    })
  })
}

async function installCommandFor(file, family) {
  if (family === 'rpm') {
    if (await fileExists('/usr/bin/dnf')) return ['/usr/bin/dnf', 'install', '-y', file]
    return ['/usr/bin/rpm', '-Uvh', file]
  }
  if (await fileExists('/usr/bin/apt-get')) {
    return [
      '/usr/bin/apt-get',
      'install',
      '-y',
      '--no-install-recommends',
      '-o',
      'Dpkg::Options::=--force-confdef',
      '-o',
      'Dpkg::Options::=--force-confold',
      file,
    ]
  }
  if (await fileExists('/usr/bin/dpkg')) return ['/usr/bin/dpkg', '-i', file]
  throw new Error('未找到 apt-get 或 dpkg，无法安装系统包。')
}

async function installDownloaded(file) {
  const latest = runtime.latest
  if (!latest) throw new Error('缺少最新版本信息，请先检查更新。')
  if (!file || !(await fileExists(file))) throw new Error('安装包不存在，请先下载。')
  const family = latest.family || (await detectFamily())
  const manual =
    family === 'rpm'
      ? `sudo dnf install -y ${shellQuote(file)}`
      : `sudo apt install -y ${shellQuote(file)}`
  runtime.manualCommand = manual
  const pkexec = (await fileExists('/usr/bin/pkexec'))
    ? '/usr/bin/pkexec'
    : (await fileExists('/bin/pkexec'))
      ? '/bin/pkexec'
      : null
  if (!pkexec) {
    runtime.phase = 'needs-manual'
    runtime.message = '系统没有可用的 pkexec，无法弹出授权窗口。请复制下方命令在终端中执行。'
    runtime.finishedAt = new Date().toISOString()
    return { ok: false, manual: true }
  }
  runtime.phase = 'installing'
  runtime.installMethod = 'pkexec'
  runtime.message = '等待系统授权：请在系统弹窗中输入管理员密码。'
  runtime.log = []
  const args = await installCommandFor(file, family)
  const argv = [pkexec, '/usr/bin/env', 'DEBIAN_FRONTEND=noninteractive', ...args]
  appendLog(`$ ${argv.map(shellQuote).join(' ')}`)
  let outcome = await spawnTracked(argv, { timeoutMs: INSTALL_TIMEOUT_MS })
  appendLog(`退出码：${outcome.code}${outcome.signal ? `（信号 ${outcome.signal}）` : ''}`)
  if (outcome.code !== 0 && (outcome.code === 122 || outcome.code === 127)) {
    const pkcon = (await fileExists('/usr/bin/pkcon')) ? '/usr/bin/pkcon' : null
    if (pkcon) {
      appendLog('pkexec 不可用，改用 PackageKit（pkcon）重试…')
      runtime.installMethod = 'pkcon'
      const pkconArgv = [pkcon, 'install-local', '--allow-untrusted', '-y', file]
      appendLog(`$ ${pkconArgv.map(shellQuote).join(' ')}`)
      outcome = await spawnTracked(pkconArgv, { timeoutMs: INSTALL_TIMEOUT_MS })
      appendLog(`退出码：${outcome.code}${outcome.signal ? `（信号 ${outcome.signal}）` : ''}`)
    }
  }
  if (outcome.code === 0) {
    await delay(800)
    const installed = await readInstalled(true)
    runtime.installedAfter = installed
    runtime.requiresRestart = true
    runtime.phase = 'installed'
    runtime.finishedAt = new Date().toISOString()
    if (installed.version && compareVersions(installed.version, latest.version) >= 0) {
      runtime.message = '安装完成。请完全退出并重新启动 DeepSeek Harness 以启用新版本。'
      return { ok: true }
    }
    runtime.message = '安装命令执行完成，但系统包版本未变化；请查看日志或手动确认。'
    return { ok: false }
  }
  const needsManual = outcome.code === 122 || outcome.code === 126 || outcome.code === 127
  runtime.phase = needsManual ? 'needs-manual' : 'error'
  runtime.finishedAt = new Date().toISOString()
  runtime.message =
    outcome.code === 126
      ? '授权被取消或未获得管理员权限。可复制下方命令手动安装。'
      : '安装失败，请查看日志；也可以复制下方命令在终端中手动安装。'
  return { ok: false, code: outcome.code }
}

async function runUpdateTask() {
  try {
    resetForTask('checking', '正在检查更新…')
    const latest = await fetchLatestRelease()
    runtime.latest = latest
    lastCheckAt = Date.now()
    const installed = await readInstalled(true)
    if (installed.version && compareVersions(latest.version, installed.version) <= 0) {
      runtime.phase = 'idle'
      runtime.message = `当前已是最新版本（${installed.version}）。`
      runtime.progress = null
      runtime.finishedAt = new Date().toISOString()
      return
    }
    resetForTask('downloading', '正在下载安装包…')
    const file = await ensureDownloaded()
    await installDownloaded(file)
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    if (runtime.phase === 'downloading' && /取消/.test(message)) {
      runtime.phase = 'idle'
      runtime.message = '下载已取消。'
    } else if (runtime.phase !== 'needs-manual') {
      runtime.phase = 'error'
      runtime.message = message
    }
    runtime.error = message
    runtime.finishedAt = new Date().toISOString()
  } finally {
    runtime.progress = null
  }
}

function startUpdate() {
  if (isBusy()) throw new Error('已有更新任务正在进行。')
  if (!activeTask) {
    activeTask = runUpdateTask().finally(() => {
      activeTask = null
    })
  }
  return activeTask
}

function cancelTask() {
  if (downloadController) {
    downloadController.abort()
  }
  if (activeChild) {
    appendLog('正在终止安装进程…')
    try {
      activeChild.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (activeChild) activeChild.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, 3000)
  }
  if (!isBusy()) runtime.message = '当前没有正在进行的任务。'
}

/* ------------------------------------------------------------------ */
/* Environment diagnostics                                             */
/* ------------------------------------------------------------------ */

async function collectDiagnostics() {
  const family = await detectFamily()
  const binaries = {
    pkexec: ['/usr/bin/pkexec', '/bin/pkexec'],
    sudo: ['/usr/bin/sudo'],
    dpkg: ['/usr/bin/dpkg'],
    'dpkg-deb': ['/usr/bin/dpkg-deb'],
    'apt-get': ['/usr/bin/apt-get'],
    rpm: ['/usr/bin/rpm'],
    dnf: ['/usr/bin/dnf'],
  }
  const found = {}
  for (const [key, candidates] of Object.entries(binaries)) {
    found[key] = null
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        found[key] = candidate
        break
      }
    }
  }
  let pkexecVersion = null
  if (found.pkexec) {
    const version = await execCapture(found.pkexec, ['--version'])
    pkexecVersion = `${version.stdout}${version.stderr}`.trim() || null
  }
  let cacheWritable = false
  try {
    await mkdir(cacheRoot(), { recursive: true })
    const probe = path.join(cacheRoot(), `.probe-${process.pid}`)
    await (await open(probe, 'w')).close()
    await rm(probe, { force: true })
    cacheWritable = true
  } catch {
    cacheWritable = false
  }
  let freeBytes = null
  const stats = await statfs(cacheRoot()).catch(() => null)
  if (stats) freeBytes = Number(stats.bavail) * Number(stats.bsize)
  const installed = await readInstalled(true)
  return {
    platform: process.platform,
    arch: process.arch,
    family,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath || null,
    binaries: found,
    pkexecVersion,
    dbusSession: Boolean(process.env.DBUS_SESSION_BUS_ADDRESS),
    display: process.env.WAYLAND_DISPLAY || process.env.DISPLAY || null,
    cacheDir: cacheRoot(),
    downloadDir: downloadDir(),
    cacheWritable,
    freeBytes,
    installed,
    bootVersion,
  }
}

async function testElevation() {
  if (isBusy()) return { ok: false, code: -1, log: [], message: '已有更新任务正在进行，请稍后再测试。' }
  const pkexec = (await fileExists('/usr/bin/pkexec')) ? '/usr/bin/pkexec' : null
  if (!pkexec) return { ok: false, code: -1, log: [], message: 'pkexec 不可用。' }
  runtime.log = []
  appendLog('测试提权：pkexec /usr/bin/true（会弹出系统授权窗口）')
  const outcome = await spawnTracked([pkexec, '/usr/bin/true'], { timeoutMs: 120000 })
  appendLog(`退出码：${outcome.code}`)
  return {
    ok: outcome.code === 0,
    code: outcome.code,
    log: runtime.log.slice(-40),
    message:
      outcome.code === 0
        ? '提权可用：授权窗口已确认。'
        : outcome.code === 126
          ? '提权未完成：授权被取消。'
          : '提权失败，请检查 polkit 与桌面会话。',
  }
}

/* ------------------------------------------------------------------ */
/* HTTP API                                                            */
/* ------------------------------------------------------------------ */

function jsonResponse(payload, status = 200) {
  const body = JSON.stringify(payload)
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(body)),
    },
  })
}

async function snapshot() {
  const installed = await readInstalled(false)
  if (!bootVersionRead) {
    bootVersionRead = true
    if (installed.version) bootVersion = installed.version
  }
  const latest = runtime.latest
  const comparison =
    latest && installed.version ? compareVersions(latest.version, installed.version) : null
  return {
    ok: true,
    repo: REPO,
    page: `${REPO_PAGE}/releases`,
    checkedAt: latest ? latest.checkedAt : null,
    cacheDir: cacheRoot(),
    running: {
      version: bootVersion,
      execPath: process.execPath,
      family: installed.family,
      arch: process.arch,
    },
    installed,
    latest,
    comparison,
    download: runtime.download
      ? {
          file: runtime.download.file,
          version: runtime.download.version,
          bytes: runtime.download.bytes,
          sha256: runtime.download.sha256,
          reused: runtime.download.reused,
        }
      : null,
    state: {
      phase: runtime.phase,
      busy: isBusy(),
      message: runtime.message,
      error: runtime.error,
      log: runtime.log.slice(-220),
      manualCommand: runtime.manualCommand,
      installMethod: runtime.installMethod,
      progress: runtime.progress,
      requiresRestart: runtime.requiresRestart,
      startedAt: runtime.startedAt,
      finishedAt: runtime.finishedAt,
      installedAfter: runtime.installedAfter,
    },
  }
}

function checkMutation(request) {
  const marker = request.headers.get(MARKER_HEADER)
  if (marker !== '1') return { status: 403, error: '缺少请求来源标记。' }
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      const originHost = new URL(origin).host
      const requestHost = request.headers.get('host')
      if (originHost !== requestHost) return { status: 403, error: '拒绝跨站请求。' }
    } catch {
      return { status: 403, error: '请求来源无效。' }
    }
  }
  const contentType = String(request.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (contentType !== 'application/json') {
    return { status: 415, error: 'content-type 必须为 application/json。' }
  }
  return null
}

const apiRoutes = [
  {
    path: `${API_PREFIX}/status`,
    methods: ['GET', 'HEAD'],
    handle: async () => jsonResponse(await snapshot()),
  },
  {
    path: `${API_PREFIX}/check`,
    methods: ['POST'],
    mutate: true,
    handle: async () => {
      await checkForUpdate({ force: true })
      return jsonResponse(await snapshot())
    },
  },
  {
    path: `${API_PREFIX}/update`,
    methods: ['POST'],
    mutate: true,
    handle: async () => {
      startUpdate()
      return jsonResponse(await snapshot())
    },
  },
  {
    path: `${API_PREFIX}/install`,
    methods: ['POST'],
    mutate: true,
    handle: async () => {
      if (isBusy()) throw new Error('已有更新任务正在进行。')
      if (!runtime.download) throw new Error('请先下载安装包。')
      const task = (async () => {
        try {
          resetForTask('installing', '正在启动安装…')
          await installDownloaded(runtime.download.file)
        } catch (error) {
          runtime.phase = 'error'
          runtime.message = String(error && error.message ? error.message : error)
          runtime.finishedAt = new Date().toISOString()
        }
      })()
      task.catch(() => {})
      return jsonResponse(await snapshot())
    },
  },
  {
    path: `${API_PREFIX}/cancel`,
    methods: ['POST'],
    mutate: true,
    handle: async () => {
      cancelTask()
      return jsonResponse(await snapshot())
    },
  },
  {
    path: `${API_PREFIX}/diagnostics`,
    methods: ['GET', 'HEAD'],
    handle: async () => jsonResponse({ ok: true, diagnostics: await collectDiagnostics() }),
  },
  {
    path: `${API_PREFIX}/test-elevation`,
    methods: ['POST'],
    mutate: true,
    handle: async () => {
      const result = await testElevation()
      return jsonResponse({ ok: result.ok, result })
    },
  },
]

async function dispatch(request, pathname) {
  const route = apiRoutes.find((item) => item.path === pathname)
  if (!route) return jsonResponse({ ok: false, error: `未知接口：${pathname}` }, 404)
  if (!route.methods.includes(request.method)) {
    return jsonResponse({ ok: false, error: `不支持的请求方法：${request.method}` }, 405)
  }
  try {
    if (route.mutate) {
      const rejection = checkMutation(request)
      if (rejection) return jsonResponse({ ok: false, error: rejection.error }, rejection.status)
    }
    return await route.handle(request)
  } catch (error) {
    return jsonResponse(
      { ok: false, error: String(error && error.message ? error.message : error) },
      500,
    )
  }
}

function nodeRequestToFetch(request, url) {
  return new Promise((resolve, reject) => {
    const headers = new Headers()
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) for (const item of value) headers.append(key, item)
      else headers.set(key, value)
    }
    const method = request.method || 'GET'
    if (method === 'GET' || method === 'HEAD') {
      resolve(new Request(url, { method, headers }))
      return
    }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = chunks.length ? Buffer.concat(chunks) : null
      resolve(
        new Request(url, {
          method,
          headers,
          body: body && body.length > 0 ? new Uint8Array(body) : undefined,
        }),
      )
    })
    request.on('error', reject)
  })
}

function registerRoutes(ctx) {
  const connection = safeGet(ctx, 'connection')
  const webServer = safeGet(ctx, 'webServer')
  ctx.effect(() => {
    const disposers = []
    if (connection && connection.fetch && typeof connection.fetch.register === 'function') {
      for (const route of apiRoutes) {
        const disposer = connection.fetch.register({
          path: route.path,
          methods: route.methods,
          requestBody: 'buffered',
          fetch: async (request) => {
            const url = new URL(request.url)
            return dispatch(request, url.pathname)
          },
        })
        disposers.push(disposer)
      }
      return () => {
        for (const disposer of disposers) {
          try {
            const result = disposer()
            if (result && typeof result.catch === 'function') result.catch(() => {})
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (webServer && typeof webServer.register === 'function') {
      const disposer = webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (request, response) => {
          const url = new URL(request.url || '/', 'http://localhost')
          const pathname = url.pathname.replace(/\/+$/, '')
          try {
            const fetchRequest = await nodeRequestToFetch(request, url.toString())
            const result = await dispatch(fetchRequest, pathname)
            response.writeHead(result.status, Object.fromEntries(result.headers.entries()))
            if (request.method === 'HEAD') {
              response.end()
              return
            }
            response.end(Buffer.from(await result.arrayBuffer()))
          } catch (error) {
            const body = JSON.stringify({
              ok: false,
              error: String(error && error.message ? error.message : error),
            })
            response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            response.end(body)
          }
        },
      })
      disposers.push(disposer)
    }
    return () => {
      for (const disposer of disposers) {
        try {
          const result = disposer()
          if (result && typeof result.catch === 'function') result.catch(() => {})
        } catch {
          /* ignore */
        }
      }
    }
  }, 'dsh-linux-desktop-updater: api routes')
}

/* ------------------------------------------------------------------ */
/* Agent tool                                                          */
/* ------------------------------------------------------------------ */

function describeSnapshot(value) {
  const lines = []
  lines.push(`运行中版本：${value.running.version || '未知'}`)
  lines.push(
    `已安装版本：${value.installed.version || '未知'}${value.installed.source ? `（${value.installed.source}）` : ''}`,
  )
  if (value.latest) {
    lines.push(`最新版本：${value.latest.version}${value.latest.publishedAt ? `（发布于 ${value.latest.publishedAt}）` : ''}`)
    lines.push(`下载包：${value.latest.assetName}`)
    lines.push(`发布页：${value.latest.url}`)
  } else {
    lines.push('最新版本：尚未检查')
  }
  if (value.comparison === null) lines.push('状态：无法比较版本')
  else if (value.comparison > 0) lines.push(`状态：有新版本 ${value.latest.version} 可安装（需要在设置 → 版本更新中一键安装）`)
  else lines.push('状态：已是最新版本')
  if (value.state.requiresRestart) lines.push('提示：安装包已更新，需要重启 DeepSeek Harness 才能生效。')
  return lines.join('\n')
}

function registerTool(ctx) {
  const tools = safeGet(ctx, 'tools')
  if (!tools || typeof tools.register !== 'function') return
  const definition = {
    name: 'linux_app_update',
    description:
      'Inspect the DeepSeek Harness Linux desktop package version and check GitHub (wenyinos/dsh-desktop-linux) for a newer release. action="status" reports the installed/running/latest versions without network access; action="check" refreshes the latest release from GitHub. Installing a package is user-only: it needs a system authorization dialog and runs from Settings → 版本更新 (App Updates).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'check'],
          description: 'status = local versions only; check = also query GitHub for the newest release.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (args, value) => {
        const text =
          value && typeof value.text === 'string'
            ? value.text
            : JSON.stringify(value, null, 2)
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      const action = args && typeof args.action === 'string' ? args.action : 'status'
      if (action === 'check') {
        if (!isBusy()) {
          try {
            await checkForUpdate({ force: true })
          } catch {
            /* snapshot carries the error */
          }
        }
      }
      const value = await snapshot()
      return {
        ok: true,
        action,
        runningVersion: value.running.version,
        installedVersion: value.installed.version,
        latestVersion: value.latest ? value.latest.version : null,
        updateAvailable: value.comparison === 1,
        requiresRestart: value.state.requiresRestart,
        text: describeSnapshot(value),
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: 'DeepSeek Harness 版本检查',
        kind: 'fetch',
        rawInput: args,
      }
    },
  }
  ctx.effect(() => tools.register(definition), 'dsh-linux-desktop-updater: agent tool')
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Internal hooks for offline diagnostics and tests. Not used by the runtime.
 * They let a Node script exercise version comparison, release parsing, download
 * URL derivation and environment detection without a running Harness.
 */
export const __test = {
  compareVersions,
  parseAtom,
  fetchLatestRelease,
  readInstalled,
  collectDiagnostics,
  snapshot,
  runtime,
  ensureDownloaded,
  inspectPackage,
}

function mountWith(ctx, dependencies, run) {
  if (dependencies.every((dependency) => safeGet(ctx, dependency) !== undefined)) {
    run(ctx)
    return
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(dependencies, (scope) => run(scope || ctx))
      return
    } catch {
      /* fall through to immediate mounting */
    }
  }
  run(ctx)
}

export function apply(ctx) {
  readInstalled(true)
    .then((installed) => {
      if (!bootVersionRead) {
        bootVersionRead = true
        bootVersion = installed.version || null
      }
    })
    .catch(() => {})
  mountWith(ctx, ['connection'], (scope) => registerRoutes(scope))
  mountWith(ctx, ['tools'], (scope) => registerTool(scope))
}
