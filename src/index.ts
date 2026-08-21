/**
 * Host half of dock-markdown: the /dock-markdown JSON API that resolves the
 * relative image / internal-link references inside a rendered Markdown file.
 * The markdown view reads the file itself through dock-editor's
 * /desk-editor/fs.read route; this route supplies the referenced assets.
 *
 * Resolution order (first existing candidate wins):
 *   1. relative to the Markdown file's own directory
 *   2. relative to the git repository root that contains the Markdown file
 *      (git rev-parse --show-toplevel; skipped when the file is not inside
 *      a work tree)
 *   3. relative to the session workspace root (the conversation cwd)
 *
 * Candidates are NOT confined to the session workspace: the conversation
 * context can open Markdown files anywhere on the host (e.g.
 * ~/.dsh/skills/...), so their relative assets are resolved and served
 * wherever the file lives. A URL-encoded spelling of the ref (`%20` etc.)
 * is tried as a secondary spelling per candidate.
 *
 * - kind "image" reads the matched file as base64 + mime (20 MiB cap) so
 *   the client can inline it as a data URL;
 * - kind "link" returns the matched absolute path so the client can open
 *   the target through workbench.openPath.
 *
 * Wire / fence / fs helpers follow the same stripped pattern as dock-files /
 * dock-editor / dock-images (each plugin keeps its own copies).
 */
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

export const name = 'dock-markdown'

/** Services required before mounting. */
export const inject = ['webServer', 'sessions', 'webRuntime']

// ── Wire helpers (same envelope as the /desk-editor API) ─────────────────

type WbErrorCode = 'bad-request' | 'forbidden' | 'fs-error' | 'not-found' | 'internal' | 'too-large'

export class WbError extends Error {
  constructor(
    readonly code: WbErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const MAX_BODY_BYTES = 1 << 20

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new WbError('bad-request', 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new WbError('bad-request', 'request body is not valid JSON')
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof WbError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

function stringOrUndefined(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function requireAbsolute(path: string): string {
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) {
    throw new WbError('fs-error', `"${path}" is not an absolute path`, 400)
  }
  return path
}

/**
 * Resolve a caller-supplied absolute path for READING: no workspace
 * containment — Markdown files can live anywhere on the host (the
 * conversation context may mention paths outside the session workspace),
 * and their relative assets must be servable wherever the file lives.
 */
function resolveReadPath(raw: string): string {
  requireAbsolute(raw)
  return resolve(raw)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── Trust fence (same as dock-files / dock-editor / dock-images) ──────────

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

function isTrustedRequest(request: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

// ── Asset resolution ──────────────────────────────────────────────────────

/** Cap for a single image read (same as dock-images): 20 MiB keeps the data URL reasonable. */
const IMAGE_LIMIT_BYTES = 20 * 1024 * 1024

/** MIME type inferred from the file extension (lowercased, no dot). */
function mimeOfPath(path: string): string {
  const at = path.lastIndexOf('.')
  if (at === -1) return 'application/octet-stream'
  const ext = path.slice(at + 1).toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'svg': return 'image/svg+xml'
    case 'ico': return 'image/x-icon'
    case 'avif': return 'image/avif'
    default: return 'application/octet-stream'
  }
}

/** Resolve the git work-tree root owning a directory; null when not inside a repo. */
function gitRootOf(dir: string): Promise<string | null> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Outer GIT_DIR / GIT_WORK_TREE must not redirect where git runs.
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  env.LC_ALL = 'C'
  env.LC_MESSAGES = 'C'
  env.LANG = 'C'
  return new Promise((settle) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd: dir, env, timeout: 5000 }, (error, stdout) => {
      if (error !== null) {
        settle(null)
        return
      }
      const root = stdout.trim()
      settle(root === '' ? null : root)
    })
  })
}

/**
 * Decode a URL-encoded ref (`my%20image.png` → `my image.png`) when the
 * encoded spelling differs; otherwise return the ref unchanged. A ref that
 * is not URL-encoded at all is returned as-is (no decode attempt).
 */
function decodedRefOf(ref: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(ref)) return ref
  try {
    const decoded = decodeURIComponent(ref)
    return decoded === ref ? ref : decoded
  } catch {
    return ref
  }
}

/**
 * The candidate absolute paths for a relative ref, in priority order:
 * Markdown dir → git repo root of the Markdown file → session workspace
 * root. Each base also tries the URL-decoded spelling of the ref; duplicate
 * candidates are dropped.
 */
async function resolveCandidates(cwd: string, baseFile: string, ref: string): Promise<string[]> {
  const bases = [dirname(baseFile)]
  const repoRoot = await gitRootOf(dirname(baseFile))
  if (repoRoot !== null) bases.push(repoRoot)
  bases.push(cwd)
  const candidates: string[] = []
  const seen = new Set<string>()
  const spellings = decodedRefOf(ref) === ref ? [ref] : [ref, decodedRefOf(ref)]
  for (const base of bases) {
    for (const spelling of spellings) {
      const candidate = resolve(base, spelling)
      if (!seen.has(candidate)) {
        seen.add(candidate)
        candidates.push(candidate)
      }
    }
  }
  return candidates
}

/** A relative filesystem reference from Markdown: no URL scheme, no leading
 *  '/', '\' or drive letter, no control characters. */
function isValidRef(ref: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(ref)) return false
  if (ref.startsWith('/') || ref.startsWith('\\') || ref.startsWith('#') || ref.startsWith('~')) return false
  if (/^[A-Za-z]:[\\/]/.test(ref)) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) return false
  return true
}

/** POST /dock-markdown/resolve { sessionId, basePath, ref, kind: 'image'|'link' }
 *  → { found: true, kind:'image', dataUrl, mime, size } | { found:true,
 *    kind:'image', tooLarge:true, size } | { found:true, kind:'link', path }
 *  | { found:false } */
async function endpointResolve(ctx: WbContext, payload: unknown): Promise<unknown> {
  const sessionId = stringOrUndefined(payload, 'sessionId')
  const rawBase = stringOrUndefined(payload, 'basePath')
  const ref = stringOrUndefined(payload, 'ref')
  const kind = stringOrUndefined(payload, 'kind')
  if (rawBase === undefined) throw new WbError('bad-request', 'resolve requires a "basePath"')
  if (ref === undefined) throw new WbError('bad-request', 'resolve requires a "ref"')
  if (kind !== 'image' && kind !== 'link') {
    throw new WbError('bad-request', 'resolve requires kind "image" or "link"')
  }
  if (!isValidRef(ref)) throw new WbError('bad-request', `invalid relative ref "${ref}"`)

  const cwd = sessionCwdOf(ctx, sessionId)
  // The Markdown file may live anywhere on the host (reads are unconfined).
  const base = resolveReadPath(rawBase)
  const candidates = await resolveCandidates(cwd, base, ref)

  for (const candidate of candidates) {
    const target = resolve(candidate)
    const info = await stat(target).catch(() => undefined)
    if (info === undefined || !info.isFile()) continue

    if (kind === 'link') {
      return { found: true, kind: 'link', path: target }
    }
    if (info.size > IMAGE_LIMIT_BYTES) {
      return { found: true, kind: 'image', tooLarge: true, size: info.size }
    }
    const buffer = await readFile(target).catch((error) => {
      throw new WbError('fs-error', `cannot read "${target}": ${messageOf(error)}`, 400)
    })
    const mime = mimeOfPath(target)
    return {
      found: true,
      kind: 'image',
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      mime,
      size: info.size,
    }
  }
  return { found: false }
}

// ── Plugin body ───────────────────────────────────────────────────────────

interface WbContext {
  webServer: {
    register(options: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  sessions: {
    get(sessionId: string): { header: { cwd?: string } } | undefined
  }
  webRuntime: {
    trustedHosts: readonly string[]
  }
  effect(fn: () => void | (() => void), label?: string): void
}

function sessionCwdOf(ctx: WbContext, sessionId: string | undefined): string {
  if (sessionId !== undefined) {
    const cwd = ctx.sessions.get(sessionId)?.header.cwd
    if (cwd !== undefined && cwd !== '') return cwd
  }
  return process.cwd()
}

export function apply(ctx: WbContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dock-markdown',
    handler: async (req, res) => {
      if (!isTrustedRequest(req, ctx.webRuntime.trustedHosts)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'bad-request', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/dock-markdown/') ? pathname.slice('/dock-markdown/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new WbError('not-found', `unknown /dock-markdown method "${method}"`, 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        if (method === 'resolve') {
          writeOk(res, await endpointResolve(ctx, payload))
          return
        }
        writeError(res, new WbError('not-found', `unknown /dock-markdown method "${method}"`, 404))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dock-markdown: /dock-markdown routes')
}
