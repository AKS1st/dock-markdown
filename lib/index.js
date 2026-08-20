import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
//#region src/index.ts
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
* Every candidate must resolve inside the session workspace (canonical
* containment, same as dock-editor / dock-images): a candidate that escapes
* the workspace — via `..`, a symlink, or because the repo root sits above
* the workspace — is skipped, never served. A URL-encoded spelling of the
* ref (`%20` etc.) is tried as a secondary spelling per candidate.
*
* - kind "image" reads the matched file as base64 + mime (20 MiB cap) so
*   the client can inline it as a data URL;
* - kind "link" returns the matched absolute path so the client can open
*   the target through workbench.openPath.
*
* Wire / fence / fs helpers follow the same stripped pattern as dock-files /
* dock-editor / dock-images (each plugin keeps its own copies).
*/
const name = "dock-markdown";
/** Services required before mounting. */
const inject = [
	"webServer",
	"sessions",
	"webRuntime"
];
var WbError = class extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
};
const MAX_BODY_BYTES = 1 << 20;
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new WbError("bad-request", "request body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new WbError("bad-request", "request body is not valid JSON");
	}
}
function writeJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
function writeOk(res, value) {
	writeJson(res, 200, {
		ok: true,
		value
	});
}
function writeError(res, error) {
	if (error instanceof WbError) {
		writeJson(res, error.status, {
			ok: false,
			error: {
				code: error.code,
				message: error.message
			}
		});
		return;
	}
	writeJson(res, 500, {
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error)
		}
	});
}
function stringOrUndefined(payload, key) {
	const value = payload?.[key];
	return typeof value === "string" && value !== "" ? value : void 0;
}
function requireAbsolute(path) {
	if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) throw new WbError("fs-error", `"${path}" is not an absolute path`, 400);
	return path;
}
/**
* Confine a caller-supplied absolute path to the session workspace: the
* canonical (symlink-resolved) path must equal the canonical session cwd or
* live under it (separator boundary). Any escape — `..`, a symlink pointing
* out of the workspace, or an unrelated absolute path — is rejected 403.
* For a not-yet-existing target, the parent directory is canonicalized and
* the basename re-appended before the containment check. Returns the
* canonical target path.
*/
async function resolveWorkspacePath(cwd, raw) {
	const root = await realpath(cwd).catch(() => resolve(cwd));
	requireAbsolute(raw);
	let target;
	try {
		target = await realpath(raw);
	} catch {
		const parent = await realpath(dirname(raw)).catch(() => dirname(raw));
		target = join(parent, basename(raw));
	}
	const rel = relative(root, target);
	if (rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return target;
	throw new WbError("forbidden", `path is outside the session workspace: "${raw}"`, 403);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
function isTrustedRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/** Cap for a single image read (same as dock-images): 20 MiB keeps the data URL reasonable. */
const IMAGE_LIMIT_BYTES = 20971520;
/** MIME type inferred from the file extension (lowercased, no dot). */
function mimeOfPath(path) {
	const at = path.lastIndexOf(".");
	if (at === -1) return "application/octet-stream";
	switch (path.slice(at + 1).toLowerCase()) {
		case "png": return "image/png";
		case "jpg":
		case "jpeg": return "image/jpeg";
		case "gif": return "image/gif";
		case "webp": return "image/webp";
		case "bmp": return "image/bmp";
		case "svg": return "image/svg+xml";
		case "ico": return "image/x-icon";
		case "avif": return "image/avif";
		default: return "application/octet-stream";
	}
}
/** Resolve the git work-tree root owning a directory; null when not inside a repo. */
function gitRootOf(dir) {
	const env = { ...process.env };
	delete env.GIT_DIR;
	delete env.GIT_WORK_TREE;
	env.LC_ALL = "C";
	env.LC_MESSAGES = "C";
	env.LANG = "C";
	return new Promise((settle) => {
		execFile("git", ["rev-parse", "--show-toplevel"], {
			cwd: dir,
			env,
			timeout: 5e3
		}, (error, stdout) => {
			if (error !== null) {
				settle(null);
				return;
			}
			const root = stdout.trim();
			settle(root === "" ? null : root);
		});
	});
}
/**
* Decode a URL-encoded ref (`my%20image.png` → `my image.png`) when the
* encoded spelling differs; otherwise return the ref unchanged. A ref that
* is not URL-encoded at all is returned as-is (no decode attempt).
*/
function decodedRefOf(ref) {
	if (!/%[0-9A-Fa-f]{2}/.test(ref)) return ref;
	try {
		const decoded = decodeURIComponent(ref);
		return decoded === ref ? ref : decoded;
	} catch {
		return ref;
	}
}
/**
* The candidate absolute paths for a relative ref, in priority order:
* Markdown dir → git repo root of the Markdown file → session workspace
* root. Each base also tries the URL-decoded spelling of the ref; duplicate
* candidates are dropped.
*/
async function resolveCandidates(cwd, baseFile, ref) {
	const bases = [dirname(baseFile)];
	const repoRoot = await gitRootOf(dirname(baseFile));
	if (repoRoot !== null) bases.push(repoRoot);
	bases.push(cwd);
	const candidates = [];
	const seen = /* @__PURE__ */ new Set();
	const spellings = decodedRefOf(ref) === ref ? [ref] : [ref, decodedRefOf(ref)];
	for (const base of bases) for (const spelling of spellings) {
		const candidate = resolve(base, spelling);
		if (!seen.has(candidate)) {
			seen.add(candidate);
			candidates.push(candidate);
		}
	}
	return candidates;
}
/** A relative filesystem reference from Markdown: no URL scheme, no leading
*  '/', '\' or drive letter, no control characters. */
function isValidRef(ref) {
	if (/[\u0000-\u001f\u007f]/.test(ref)) return false;
	if (ref.startsWith("/") || ref.startsWith("\\") || ref.startsWith("#") || ref.startsWith("~")) return false;
	if (/^[A-Za-z]:[\\/]/.test(ref)) return false;
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) return false;
	return true;
}
/** POST /dock-markdown/resolve { sessionId, basePath, ref, kind: 'image'|'link' }
*  → { found: true, kind:'image', dataUrl, mime, size } | { found:true,
*    kind:'image', tooLarge:true, size } | { found:true, kind:'link', path }
*  | { found:false } */
async function endpointResolve(ctx, payload) {
	const sessionId = stringOrUndefined(payload, "sessionId");
	const rawBase = stringOrUndefined(payload, "basePath");
	const ref = stringOrUndefined(payload, "ref");
	const kind = stringOrUndefined(payload, "kind");
	if (rawBase === void 0) throw new WbError("bad-request", "resolve requires a \"basePath\"");
	if (ref === void 0) throw new WbError("bad-request", "resolve requires a \"ref\"");
	if (kind !== "image" && kind !== "link") throw new WbError("bad-request", "resolve requires kind \"image\" or \"link\"");
	if (!isValidRef(ref)) throw new WbError("bad-request", `invalid relative ref "${ref}"`);
	const cwd = sessionCwdOf(ctx, sessionId);
	const candidates = await resolveCandidates(cwd, await resolveWorkspacePath(cwd, rawBase), ref);
	for (const candidate of candidates) {
		let target;
		try {
			target = await resolveWorkspacePath(cwd, candidate);
		} catch {
			continue;
		}
		const info = await stat(target).catch(() => void 0);
		if (info === void 0 || !info.isFile()) continue;
		if (kind === "link") return {
			found: true,
			kind: "link",
			path: target
		};
		if (info.size > IMAGE_LIMIT_BYTES) return {
			found: true,
			kind: "image",
			tooLarge: true,
			size: info.size
		};
		const buffer = await readFile(target).catch((error) => {
			throw new WbError("fs-error", `cannot read "${target}": ${messageOf(error)}`, 400);
		});
		const mime = mimeOfPath(target);
		return {
			found: true,
			kind: "image",
			dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
			mime,
			size: info.size
		};
	}
	return { found: false };
}
function sessionCwdOf(ctx, sessionId) {
	if (sessionId !== void 0) {
		const cwd = ctx.sessions.get(sessionId)?.header.cwd;
		if (cwd !== void 0 && cwd !== "") return cwd;
	}
	return process.cwd();
}
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dock-markdown",
		handler: async (req, res) => {
			if (!isTrustedRequest(req, ctx.webRuntime.trustedHosts)) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: {
						code: "bad-request",
						message: "method not allowed"
					}
				});
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith("/dock-markdown/") ? pathname.slice(15) : void 0;
			if (method === void 0 || method.includes("/")) {
				writeError(res, new WbError("not-found", `unknown /dock-markdown method "${method}"`, 404));
				return;
			}
			try {
				const payload = await readJsonBody(req);
				if (method === "resolve") {
					writeOk(res, await endpointResolve(ctx, payload));
					return;
				}
				writeError(res, new WbError("not-found", `unknown /dock-markdown method "${method}"`, 404));
			} catch (error) {
				writeError(res, error);
			}
		}
	}), "dock-markdown: /dock-markdown routes");
}
//#endregion
export { WbError, apply, inject, name };
