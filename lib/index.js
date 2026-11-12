/**
 * Host half of dsh-plugin-git-graph.
 *
 * Serves the browser half's read-only git questions over one same-origin
 * route (`/api/dsh-git-graph`):
 *
 *  - `GET`  → `{ ok, value: { token, state } }`: the page's per-load RPC token
 *    plus the initial state (configured directory, detected repository);
 *  - `POST` → `state.rpc` calls (`repo`, `graph`, `branches`, `commit`,
 *    `diff`, `fetch`), requiring the token or a same-site browser marker;
 *  - `GET …/health` → a token-free probe so a stale tab can tell "plugin not
 *    mounted" from "page not signed in".
 *
 * Connection is the only carrier that matters: it authenticates the browser
 * peer itself, and the desktop shell (whose page lives on `dsh-app://app` and
 * whose forwarding hop deletes `Origin`, `Cookie` and `Sec-Fetch-Site`) only
 * completes requests that go through it. The route therefore attaches as soon
 * as an already-mounted Connection is visible, not only from a `ctx.inject`
 * callback. `webServer` stays as a fallback for profiles without Connection,
 * as an exact route under the plugin path: a `/api/...` prefix there takes
 * requests away from Connection's `/api` prefix route (the web server picks
 * the longest prefix) and every call then answers 403.
 *
 * Configuration is read from the row's `config` at load time. The write path
 * for the working directory goes through `ctx.configEditor`, never through
 * the profile's `cordis.patch.yml`.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CODES, DEFAULT_LIMIT, GitGraphError, fetchAll, findRepoRoot, listRefs,
  readCommit, readDiff, readGraph, readRepoInfo, readStatus, runGit, switchBranch,
} from './git.js';

export const name = 'git-graph';

/**
 * Freshness marker: changing this string forces the Loader to import a new
 * module generation of this host half (`?v=` bust), so an edited plugin
 * reloads instead of reusing an already-imported module. Bump it on every code
 * change that must reach a running harness.
 */
export const VERSION = '2026-11-12.3';

/** Page size bounds accepted from the browser. */
const LIMIT_MIN = 20;
const LIMIT_MAX = 3000;
/** How long one resolved repository cache entry stays fresh. */
const REPO_CACHE_MS = 4000;

/** Normalize a directory the user typed: `~`, `~/...`, absolute paths only. */
function expandDirectory(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

/** Whether a user-visible directory has a `.git` entry (dir or file). */
function looksLikeGitDirectory(directory) {
  try {
    if (!statSync(directory).isDirectory()) return false;
  } catch {
    return false;
  }
  return existsSync(join(directory, '.git'));
}

/** One JSON response with no caching (the page polls after mutations). */
function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Read the whole request body as text (no size ceiling: git output never returns here). */
async function readBody(request) {
  if (typeof request.text === 'function') return request.text();
  const body = request?.body;
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (typeof body.getReader === 'function') {
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }
  return String(body);
}

/**
 * Where the Schemastery namespace may come from, most specific first: the
 * profile's own dependency tree (also where a `link:` checkout is meant to
 * get it from), then the bundle's, then whatever the module resolver sees.
 */
const SCHEMA_SOURCES = (() => {
  const sources = [];
  const profile = process.env.DSH_PROFILE_DIR;
  if (typeof profile === 'string' && profile !== '') {
    sources.push(`file://${profile.replace(/\\/g, '/')}/node_modules/@deepseek-ai/schemastery/lib/index.js`);
    sources.push(`file://${profile.replace(/\\/g, '/')}/node_modules/@deepseek-ai/schemastery/index.js`);
  }
  try {
    sources.push(new URL('../../node_modules/@deepseek-ai/schemastery/index.js', import.meta.url).href);
  } catch {
    // the checkout cannot be addressed as a URL; the bare specifier below still can
  }
  for (const specifier of ['@deepseek-ai/schemastery', 'schemastery']) {
    try {
      sources.push(import.meta.resolve(specifier));
    } catch {
      // not resolvable from this module
    }
  }
  return [...new Set(sources)];
})();

/** The Config schema built once a Schema namespace was found (a module singleton). */
const schemaState = { value: null };

/**
 * Build (or rebuild) the row's Config schema from the first namespace that
 * imports, so a later `apply` sees it even if the first ran before the package
 * was reachable.
 * @returns {Promise<any | null>}
 */
async function loadSchema() {
  if (schemaState.value !== null) return schemaState.value;
  for (const source of SCHEMA_SOURCES) {
    try {
      const namespace = await import(source);
      const Schema = namespace?.default ?? namespace;
      if (typeof Schema?.object !== 'function') continue;
      const field = () => {
        const node = {
          description() { return node; },
          default() { return node; },
          volatile() { return node; },
        };
        return node;
      };
      schemaState.value = Schema.object({
        workingDirectory: Schema.string?.() ? Schema.string().description('仓库路径（或其子目录），留空表示使用 Harness 默认工作目录。').default('').volatile() : field(),
        pageSize: Schema.natural?.() ? Schema.natural().description('每页读取的提交数（20–3000）。').default(DEFAULT_LIMIT).volatile() : field(),
        enableFetch: Schema.boolean?.() ? Schema.boolean().description('在工具栏提供「拉取远程」按钮（git fetch --all --prune）。').default(false).volatile() : field(),
      });
      return schemaState.value;
    } catch {
      // try the next source
    }
  }
  return null;
}

/**
 * The row's Config schema, built once a Schema namespace was found, so a later
 * mount of this module validates the row's `config` in full.
 *
 * It is built on the first `apply` (not at import): a mount never needs it,
 * because the Loader takes a row's schema when it parses the patch, and an
 * import-time side effect only delays the row's activation.
 *
 * @returns {Promise<any | null>}
 */
export function loadConfigSchema() {
  return loadSchema().catch(() => null);
}

/**
 * The config field names this plugin reads.
 * @type {readonly ['workingDirectory', 'pageSize', 'enableFetch']}
 */
export const CONFIG_FIELDS = ['workingDirectory', 'pageSize', 'enableFetch'];

/**
 * Plugin body.
 *
 * Every step is isolated: a failure inside the route registration must leave
 * the row mounted (the page then reports "cannot reach the host") instead of
 * making the whole entry "did not activate", which would take every dependent
 * of the profile down with it.
 *
 * @param {any} ctx - host context.
 * @param {Record<string, any>} [config] - the row's config.
 */
function activate(ctx, config = {}) {
  const logger = ctx.logger?.('git-graph');
  const step = (label, fn) => {
    try {
      return fn();
    } catch (error) {
      logger?.warn?.(`[git-graph] ${label} failed: ${error?.stack ?? error}`);
      return null;
    }
  };
  /** Volatile fields are read through `.get()` at call time; a plain value still works. */
  const field = (value) => (value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value);
  const pageSize = () => Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(Number(field(config.pageSize)) || DEFAULT_LIMIT)));
  const configuredDirectory = () => expandDirectory(field(config.workingDirectory));
  const enableFetch = () => field(config.enableFetch) === true;
  // Two tokens, both per host load. `pageToken` is the capability the page's
  // GET hands out; it authenticates browser requests (the desktop shell deletes
  // `Origin`, `Cookie` and `Sec-Fetch-Site` before Connection validates them,
  // so no browser marker survives that hop). `peerToken` is minted into the
  // Fetch route from inside Connection's own Fetch handler, where the caller
  // reads the delivered `Request`: only Connection plus the web server produce
  // one of those, so presenting it proves the request really came through
  // Connection to this plugin, which is what the `webServer` fallback — if it
  // ever runs — needs after its browser markers were stripped.
  const pageToken = randomBytes(24).toString('base64url');
  const peerToken = randomBytes(24).toString('base64url');
  /** Resolved repository cache: `{ key, at, value }`, keyed by the requested directory. */
  let repoCache = null;

  /** The directory to inspect before any repository is known. */
  const defaultDirectory = () => {
    const configured = configuredDirectory();
    if (configured !== '') return configured;
    try {
      const directory = ctx.workingDirectory?.defaultDirectory;
      if (typeof directory === 'string' && directory !== '') return directory;
    } catch {
      // not mounted yet
    }
    return process.cwd();
  };

  /**
   * Conventional roots a directory may belong to. A workspace nested inside a
   * shared repository, or a repository whose own work tree sits above the
   * directory the session was started in, resolves here; `.git` wins over an
   * enclosing repository, and `$HOME` is never reported.
   */
  const conventionalRoot = (directory) => {
    if (looksLikeGitDirectory(directory)) return directory;
    const home = resolve(homedir());
    let current = resolve(directory);
    for (let depth = 0; depth < 12; depth += 1) {
      const parent = resolve(current, '..');
      if (parent === current) return null;
      if (parent === home) return null;
      if (existsSync(join(parent, '.git'))) return parent;
      current = parent;
    }
    return null;
  };

  /**
   * Resolve the repository the Graph tab talks to.
   *
   * The directory follows the page: every request carries the open session's
   * working directory, so switching to a session in another repository
   * switches the graph. The configured `workingDirectory` pins the tab to one
   * repository instead.
   *
   * @param {string} requested - the session directory sent by the browser ('' for none).
   * @param {boolean} [force] - skip the cache.
   * @param {string[]} [location] - candidate directories from the browser's own location.
   * @returns {Promise<{ root: string | null, directory: string, error: null | { code: string, message: string }, source: 'session' | 'config' | 'default' }>}
   */
  const resolveRepo = async (requested = '', force = false, location = []) => {
    const pin = configuredDirectory();
    const fromSession = typeof requested === 'string' && requested !== '' && requested !== 'null' && requested !== 'undefined';
    const directory = pin !== '' ? pin : (fromSession ? requested : defaultDirectory());
    const source = pin !== '' ? 'config' : (fromSession ? 'session' : 'default');
    const cacheKey = `${directory}\u0000${pin}`;
    if (!force && repoCache !== null && repoCache.key === cacheKey && Date.now() - repoCache.at < REPO_CACHE_MS) {
      return repoCache.value;
    }
    let value;
    try {
      // git itself answers "is this inside a work tree", so a subdirectory, a
      // nested checkout, and a worktree all resolve the same way.
      let root = await findRepoRoot(directory, undefined);
      if (root === null) root = conventionalRoot(directory);
      // A synthetic session directory (`sessions/code/x`) is not on disk and
      // its parent walk finds an enclosing repository; the browser's real
      // location answers "which workspace is this" in that case.
      if (root === null) {
        for (const candidate of location) {
          const found = await findRepoRoot(candidate, undefined);
          if (found !== null) {
            root = found;
            break;
          }
        }
      }
      value = { root, directory, error: null, source };
    } catch (error) {
      // "not a repository" is not an error; anything else (no git binary, an
      // unusable directory) is reported with its code.
      const code = error?.code === CODES.NOT_REPO ? null : error?.code ?? CODES.GIT_FAILED;
      value = {
        root: null,
        directory,
        error: code === null ? null : { code, message: String(error?.message ?? error) },
        source,
      };
    }
    repoCache = { key: cacheKey, at: Date.now(), value };
    return value;
  };

  /** The resolved repository root or a typed failure. */
  const requireRoot = async (requested) => {
    const resolved = await resolveRepo(requested);
    if (resolved.error !== null) throw new GitGraphError(resolved.error.code, resolved.error.message);
    if (resolved.root === null) throw new GitGraphError(CODES.NOT_REPO, `${resolved.directory} is not inside a git repository`);
    return resolved.root;
  };

  /** One page of the graph plus the refs the toolbar needs. */
  const graphState = async (args = {}) => {
    const root = await requireRoot(args.directory);
    const limit = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(Number(args.limit) || pageSize())));
    const skip = Math.max(0, Math.trunc(Number(args.skip) || 0));
    const branches = Array.isArray(args.branches) ? args.branches.filter((value) => typeof value === 'string' && value !== '').slice(0, 50) : [];
    const [refs, info] = await Promise.all([
      listRefs(root).catch(() => []),
      readRepoInfo(root),
    ]);
    // A filter name can be a local branch and a remote-tracking branch at once
    // ("origin/main"), so the host resolves which refs exist and tells the
    // backend which kind each filter meant.
    const remoteNames = new Set(refs.filter((ref) => ref.kind === 'remote').map((ref) => ref.name));
    const graph = await readGraph(root, {
      limit,
      skip,
      branches,
      remoteBranches: branches.filter((name) => remoteNames.has(name)),
      tags: args.tags !== false,
      remotes: args.remotes !== false,
    });
    return {
      repo: info,
      directory: (await resolveRepo(args.directory)).directory,
      refs: refs.filter((ref) => ref.kind !== 'remote' || args.remotes !== false)
        .map((ref) => ({ kind: ref.kind, name: ref.name, oid: ref.oid })),
      commits: graph.commits,
      hasMore: graph.hasMore,
      skip,
      limit,
      query: {
        tags: args.tags !== false,
        remotes: args.remotes !== false,
        branches,
      },
      source: (await resolveRepo(args.directory)).source,
      settings: { enableFetch: enableFetch(), pageSize: pageSize() },
    };
  };

  /** Initial state of the page: repository detection only (no log yet). */
  const initialState = async (requested, location = []) => {
    const resolved = await resolveRepo(requested, true, location);
    let repo = null;
    if (resolved.root !== null) repo = await readRepoInfo(resolved.root).catch(() => null);
    return {
      directory: resolved.directory,
      source: resolved.source,
      repo,
      error: resolved.error,
      settings: { pageSize: pageSize(), enableFetch: enableFetch() },
    };
  };

  /** The RPC table. Each entry returns plain JSON; failures carry `GitGraphError.code`. */
  const methods = {
    /** Re-detect the repository and return its metadata. */
    async repo(args) {
      const resolved = await resolveRepo(args?.directory, true);
      if (resolved.error !== null) return { directory: resolved.directory, source: resolved.source, repo: null, error: resolved.error };
      if (resolved.root === null) return { directory: resolved.directory, source: resolved.source, repo: null, error: null };
      return { directory: resolved.directory, source: resolved.source, repo: await readRepoInfo(resolved.root), error: null };
    },
    /** One page of the commit graph. */
    graph: (args) => graphState(args),
    /** Ref lists used by the branch selector. */
    async branches(args) {
      const root = await requireRoot(args?.directory);
      const [refs, info] = await Promise.all([listRefs(root), readRepoInfo(root)]);
      return { repo: info, refs: refs.map((ref) => ({ kind: ref.kind, name: ref.name, oid: ref.oid })) };
    },
    /** Full message, parents, and changed files of one commit. */
    async commit(args) {
      const root = await requireRoot(args?.directory);
      return readCommit(root, String(args?.oid ?? ''));
    },
    /** Unified diff of one file in one commit. */
    async diff(args) {
      const root = await requireRoot(args?.directory);
      return readDiff(root, String(args?.oid ?? ''), String(args?.path ?? ''));
    },
    /**
     * Branch state of the composer chip: current branch, changes, in-progress
     * operation, and the local branches. Read-only and cheap enough to poll.
     */
    async status(args) {
      const root = await requireRoot(args?.directory);
      const [status, refs] = await Promise.all([readStatus(root), listRefs(root)]);
      const branches = refs.filter((ref) => ref.kind === 'local').map((ref) => ({ name: ref.name, oid: ref.oid }));
      return {
        root,
        branch: status.branch,
        detached: status.detached,
        head: status.head,
        unborn: status.unborn,
        dirty: status.dirty,
        conflicts: status.conflicts,
        operationInProgress: status.operationInProgress,
        operation: status.operation,
        branches,
      };
    },
    /** Switch the checked-out branch (guarded; see `switchBranch`). */
    async switch(args) {
      const root = await requireRoot(args?.directory);
      const result = await switchBranch(root, String(args?.branch ?? ''));
      // The graph and the chip both read the checkout, so the cache must go.
      repoCache = null;
      return result;
    },
    /** `git fetch --all --prune`: the graph toolbar when enabled, the chip's refresh always. */
    async fetch(args) {
      if (args?.from !== 'chip' && !enableFetch()) throw new GitGraphError(CODES.FETCH_DISABLED, 'fetching is disabled in the plugin configuration');
      const root = await requireRoot(args?.directory);
      const result = await fetchAll(root);
      repoCache = null;
      return result;
    },
    /** Whether `git` exists at all (shown when detection fails). */
    async health() {
      const result = await runGit(['--version'], { cwd: defaultDirectory(), timeoutMs: 5000 }).catch(() => null);
      return {
        plugin: 'git-graph',
        mounted: true,
        git: result !== null && result.code === 0 ? result.stdout.trim() : null,
        directory: defaultDirectory(),
        configuredDirectory: configuredDirectory(),
        // Registered even when the shell offered no `connection`/`webServer`
        // carrier: the page then knows the host half loaded but cannot be
        // reached, which is a different failure from "plugin not mounted".
        route: carrier,
        version: VERSION,
      };
    },
  };

  const rpc = async (request) => {
    let payload;
    try {
      payload = JSON.parse(await readBody(request));
    } catch {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'body is not JSON' } });
    }
    if (payload?.method !== 'state.rpc') {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'unknown method' } });
    }
    return respondRpc(payload.args?.method, payload.args?.args);
  };

  /** Dispatch one `state.rpc` method; every call shares this envelope. */
  const respondRpc = async (method, args) => {
    const handler = typeof method === 'string' ? methods[method] : undefined;
    if (typeof handler !== 'function') {
      return jsonResponse(200, { ok: false, error: { code: 'METHOD_NOT_FOUND', message: `unknown method ${method}` } });
    }
    try {
      return jsonResponse(200, { ok: true, value: await handler(args) });
    } catch (error) {
      if (!(error instanceof GitGraphError)) logger?.warn?.(`[git-graph] ${method} failed: ${error?.message ?? error}`);
      return jsonResponse(200, {
        ok: false,
        error: { code: error?.code ?? CODES.GIT_FAILED, message: String(error?.message ?? error) },
      });
    }
  };

  const readHeader = (headers, key) => (typeof headers?.get === 'function' ? headers.get(key) : headers?.[key]);
  const sameSite = (headers) => {
    const site = readHeader(headers, 'sec-fetch-site');
    return site === 'same-origin' || site === 'same-site';
  };
  const presents = (headers) => {
    const presented = readHeader(headers, 'x-dsh-git-graph-token');
    return presented === pageToken || presented === peerToken;
  };
  const authorized = (headers) => presents(headers) || sameSite(headers);

  /** `{ directory, location }` from the GET query: the session directory and the page's own path. */
  const readTarget = (request) => {
    const query = new URL(String(request?.url ?? '/'), 'http://127.0.0.1').searchParams;
    return {
      requested: query.get('directory') ?? '',
      // The browser sends its own location too: on versions whose URL path is
      // not the workspace, it tells which repository to prefer.
      location: query.getAll('location').filter((entry) => entry !== ''),
    };
  };

  /**
   * The protocol, independent of carrier: boot (GET), health, and token-gated
   * `state.rpc` calls (POST). `authorize` is the carrier's own admission check;
   * the Connection carrier passes none, because Connection already admits the
   * request as an authenticated browser peer.
   */
  const handle = async (request, authorize = null) => {
    const method = String(request?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(String(request?.url ?? '/'), 'http://127.0.0.1');
    if (method === 'GET' && pathname.endsWith('/health')) {
      return jsonResponse(200, { ok: true, value: await methods.health() });
    }
    if (method === 'GET') {
      const { requested, location } = readTarget(request);
      try {
        return jsonResponse(200, { ok: true, value: { token: pageToken, state: await initialState(requested, location) } });
      } catch (error) {
        return jsonResponse(500, { ok: false, error: { code: CODES.GIT_FAILED, message: String(error?.message ?? error) } });
      }
    }
    if (method !== 'POST') {
      return jsonResponse(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } });
    }
    const headers = request?.headers;
    if (!(authorize === null ? authorized(headers) : authorize(headers))) {
      return jsonResponse(403, { ok: false, error: { code: 'FORBIDDEN', message: 'forbidden' } });
    }
    return rpc(request);
  };

  const disposers = [];
  /**
   * Provenance of calls that reached this plugin over Connection: the Fetch
   * route records the `Request` it was handed, and every caller gets the same
   * private peer token to put in `x-dsh-git-graph-token`. A record is written
   * only from inside this plugin's own handler with a token the browser never
   * sees, so it is proof that a call came through Connection rather than
   * through some other route that merely reuses the path.
   */
  const connections = new WeakSet();
  const recordConnection = (request) => {
    if (request !== null && typeof request === 'object') connections.add(request);
    return request;
  };
  const throughConnection = (request) => connections.has(request)
    || connections.has(readHeader(request?.headers, 'x-dsh-git-graph-token'));
  const connectToken = () => peerToken;
  /** The fallback's admission: the page's boot read, or a token (see above). */
  const fallbackAdmission = (incoming) => authorized(incoming.headers);
  const guarded = async (request, admit = null) => {
    try {
      return await handle(request, admit);
    } catch (error) {
      logger?.warn?.(`[git-graph] route failed: ${error?.message ?? error}`);
      return jsonResponse(500, { ok: false, error: { code: CODES.GIT_FAILED, message: String(error?.message ?? error) } });
    }
  };

  /**
   * Connection is the carrier whenever it exists: it authenticates the browser
   * peer itself, and the desktop shell's header rewrite happens on its route.
   * The fallback below exists only for profiles that never provide Connection,
   * and is dropped as soon as Connection arrives.
   */
  const registerConnection = (connection) => {
    if (typeof connection?.fetch?.register !== 'function') return false;
    disposers.push(connection.fetch.register({
      path: '/api/dsh-git-graph',
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      // Connection already admitted this request as an authenticated browser
      // peer; record where it came from and answer.
      fetch: (request) => guarded(recordConnection(request)),
    }));
    return true;
  };

  /** Whether Connection serves this path, so the fallback must not answer at all. */
  const connectionOwnsPath = () => {
    try {
      if (carrier === 'connection') return true;
      const connection = ctx.get?.('connection', false) ?? ctx.get?.('connection');
      return typeof connection?.fetch?.register === 'function';
    } catch {
      return false;
    }
  };

  const disposeWebServer = () => {
    const disposer = fallbackRoute;
    fallbackRoute = null;
    if (disposer === null) return;
    try {
      disposer();
    } catch {
      // Disposal is best effort.
    }
  };

  /**
   * Fallback carrier for a profile without Connection: one exact route.
   *
   * It must never be a prefix. The web server matches its own `exact` table
   * first and then the longest prefix, while Connection owns the `/api`
   * prefix; a `/api/dsh-git-graph` prefix registered here therefore takes
   * every request away from Connection, the desktop shell's own header
   * rewrite (origin, cookie and Fetch metadata) then never happens, and the
   * page's calls answer 403 `forbidden` while the plugin is mounted. It also
   * is dropped the moment Connection shows up: Connection authenticates the
   * browser peer itself and is the only route the desktop shell completes.
   */
  const registerWebServer = (webServer) => {
    if (typeof webServer?.register !== 'function') return false;
    // Exact path, not a prefix: `webServer` only matches `/api` (Connection's
    // own route) and then longest prefix wins, so a `/api/dsh-git-graph`
    // prefix registered here shadows Connection's route.
    fallbackRoute = webServer.register({
      kind: 'exact',
      path: '/api/dsh-git-graph',
      handler: async (req, res) => {
        const method = String(req.method ?? 'GET').toUpperCase();
        const headers = req.headers;
        // Boot is public (it only hands out the page token and the initial
        // state); everything else needs a token, and every call needs one once
        // Connection has shown up: the peer token minted there proves the call
        // reached this plugin through Connection.
        const read = method === 'GET';
        const authorizedHere = read && !connectionOwnsPath()
          ? true
          : authorized(headers);
        if (!authorizedHere) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'forbidden' } }));
          return;
        }
        const response = await guarded(new Request(`http://127.0.0.1${req.url ?? '/'}`, {
          method,
          headers,
          body: read || method === 'HEAD' ? undefined : await readBodyFromIncoming(req),
        }), (incoming) => (read && !connectionOwnsPath() ? true : throughConnection(incoming) || sameSite(incoming.headers)));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      },
    });
    return true;
  };
  let fallbackRoute = null;

  /** Stream the webServer request body into a string. */
  const readBodyFromIncoming = (req) => new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  let carrier = null;

  /** Whether a Context already exposes a usable Connection. */
  const hasConnection = (owner = ctx) => {
    try {
      const connection = owner.get?.('connection', false) ?? owner.get?.('connection');
      return typeof connection?.fetch?.register === 'function';
    } catch {
      return false;
    }
  };

  /**
   * Register the Connection route. Idempotent: once registered, the route stays
   * for the life of the row, whichever callback (an already-mounted service, a
   * later `ctx.inject`, a retry) runs first.
   */
  const attachConnection = (connection, label) => {
    if (carrier === 'connection') return true;
    const registered = step(`connection route (${label})`, () => registerConnection(connection));
    if (registered !== true) return false;
    carrier = 'connection';
    // Connection owns the path now: the fallback would only shadow it.
    disposeWebServer();
    return true;
  };

  /**
   * Carrier registration.
   *
   * The route is attached in this order: synchronously when Connection is
   * already mounted, then through `ctx.inject` when it mounts later, then once
   * more after the plugin's own effects settle. A registration that landed on
   * the live service is never undone or retried; a callback that Cordis skips
   * or tears down (the row is evaluated before Connection's own row, a reload
   * disposes the child fiber) therefore cannot leave the page without a route.
   */
  step('carrier registration', () => {
    if (hasConnection()) {
      attachConnection(ctx.get('connection'), 'mounted');
      return;
    }
    if (typeof ctx.inject === 'function') {
      ctx.inject(['connection'], (child) => {
        if (carrier === 'connection') return;
        // The fallback's admission is only stricter once Connection really
        // serves this path; a callback without the service changes nothing.
        if (typeof child?.connection?.fetch?.register !== 'function') return;
        if (!attachConnection(child.connection, 'inject')) {
          logger?.warn?.('[git-graph] connection service arrived but the route could not be registered');
        }
      });
      ctx.inject(['webServer'], (child) => {
        // Only a profile without Connection ever needs the fallback.
        if (carrier !== null || hasConnection()) return;
        step('webServer route', () => {
          if (registerWebServer(child.webServer)) carrier = 'webServer';
        });
      });
    } else if (!attachConnection(ctx.get?.('connection'), 'bare')) {
      step('webServer route', () => {
        if (registerWebServer(ctx.get?.('webServer'))) carrier = 'webServer';
      });
    }
  });

  // Retry once after the plugin's own activation completes, in case Connection
  // mounted between the synchronous read and the inject registration.
  step('carrier retry', () => ctx.effect?.(() => {
    if (carrier === 'connection' || !hasConnection()) return () => {};
    attachConnection(ctx.get('connection'), 'retry');
    return () => {};
  }));

  step('disposer', () => ctx.effect?.(() => () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* best effort */ }
    }
    fallbackRoute = null;
  }));

  logger?.info?.(`[git-graph] loaded: ${configuredDirectory() || defaultDirectory()} (carrier: ${carrier ?? 'pending'})`);
  if (carrier === null && typeof ctx.inject !== 'function') {
    logger?.warn?.('[git-graph] no connection or webServer service; the page cannot reach the host half');
  }
}

/**
 * Plugin entry.
 *
 * The Loader validates a row's `config` against the plugin's `Config` export
 * before calling `apply`, and a row whose `config` fails that validation is
 * refused. The schema is therefore best effort here: it is built from the
 * Schema namespace the runtime loaded, so a profile keeps the full validation
 * while a checkout whose dependency tree does not resolve that package (a
 * local `link:`) still activates with the field defaults. {@link loadConfigSchema}
 * exposes the schema built in the background for a later mount.
 *
 * @param {any} ctx - host context.
 * @param {Record<string, any>} [config] - the row's config.
 */
export function apply(ctx, config = {}) {
  activate(ctx, config);
  // Built after activation, so a slow or failing schema import can never hold
  // the row up; a later mount of this module reads the cached value.
  loadConfigSchema().catch(() => null);
}
