/**
 * Read-only git backend of dsh-plugin-git-graph.
 *
 * Every command runs through one narrow runner: fixed argv shapes declared
 * below, `LC_ALL=C`, a timeout, a bounded output cap, and a scrubbed optional
 * environment. Nothing here writes to the repository (no checkout, commit,
 * reset, rebase, push); `fetch` is the only ref-updating command and it is
 * gated by configuration at the route layer.
 *
 * Shapes returned to the browser are plain JSON and are described in the
 * "wire vocabulary" section at the bottom of this file.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Default scan window of a page request (matches the VS Code extension). */
export const DEFAULT_LIMIT = 200;
/** Upper bound of one page request; larger requests are clamped. */
export const MAX_LIMIT = 3000;
/** Collected-output cap per command (a commit body can never exceed this). */
const OUTPUT_CAP_BYTES = 8 << 20;
/** Default deadline of one git command. */
const TIMEOUT_MS = 20000;

/** Error codes the client maps onto localized copy. */
export const CODES = {
  NO_GIT: 'no-git',
  NOT_REPO: 'not-repo',
  EMPTY: 'empty-repo',
  TIMEOUT: 'timeout',
  BAD_INPUT: 'bad-input',
  GIT_FAILED: 'git-failed',
  // Branch switching (the only place this plugin changes the checkout)
  INVALID_BRANCH: 'invalid-branch-name',
  BRANCH_NOT_FOUND: 'target-branch-not-found',
  BRANCH_EXISTS: 'branch-already-exists',
  CONFLICTS: 'conflicts-present',
  OPERATION_IN_PROGRESS: 'operation-in-progress',
  OVERWRITTEN: 'changes-would-be-overwritten',
  BRANCH_IN_USE: 'branch-in-other-worktree',
  FETCH_DISABLED: 'fetch-disabled',
};

/** A typed failure carrying one of {@link CODES}. */
export class GitGraphError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'GitGraphError';
    this.code = code;
  }
}

/**
 * Spawn one git argument list and collect both streams.
 * @param {readonly string[]} argv - git arguments (without the binary).
 * @param {{ cwd: string, env?: Record<string, string>, timeoutMs?: number, signal?: AbortSignal }} options
 * @returns {Promise<{ stdout: string, stderr: string, code: number | null }>}
 */
export function runGit(argv, options) {
  const { cwd, env, timeoutMs = TIMEOUT_MS, signal } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', [...argv], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0', ...(env ?? {}) },
      });
    } catch (error) {
      reject(new GitGraphError(CODES.NO_GIT, `git could not be started: ${error?.message ?? error}`));
      return;
    }
    const out = [];
    const err = [];
    let outBytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish(reject, new GitGraphError(CODES.TIMEOUT, `git ${argv[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onAbort = () => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish(reject, new GitGraphError(CODES.TIMEOUT, 'git command aborted'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length;
      if (outBytes > OUTPUT_CAP_BYTES) {
        onAbort();
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => { err.push(chunk); });
    child.on('error', (error) => {
      const code = /** @type {any} */ (error)?.code;
      if (code === 'ENOENT') finish(reject, new GitGraphError(CODES.NO_GIT, 'git is not installed or not on PATH'));
      else finish(reject, new GitGraphError(CODES.GIT_FAILED, String(error?.message ?? error)));
    });
    child.on('close', (code) => {
      finish(resolve, {
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code,
      });
    });
  });
}

/**
 * Run git and require a zero exit status.
 * @param {readonly string[]} argv @param {Parameters<typeof runGit>[1]} options
 * @returns {Promise<string>} stdout
 */
async function must(argv, options) {
  const result = await runGit(argv, options);
  if (result.code !== 0) {
    const message = (result.stderr || result.stdout || `git ${argv.join(' ')} exited ${result.code}`).trim();
    const code = /not a git repository/i.test(message) ? CODES.NOT_REPO : CODES.GIT_FAILED;
    throw new GitGraphError(code, message.split('\n')[0]);
  }
  return result.stdout;
}

/** @param {string} value */
const isFullHex = (value) => /^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
/** @param {string} value */
const isShortHex = (value) => /^[0-9a-f]{4,64}$/i.test(value);

/**
 * Resolve the repository that contains `cwd`.
 * @param {string} cwd
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>} absolute top-level, or null when `cwd` is not inside a work tree.
 */
export async function findRepoRoot(cwd, signal) {
  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd, signal });
  if (inside.code !== 0) {
    if (/\bnot a git repository\b/i.test(inside.stderr)) return null;
    throw new GitGraphError(CODES.GIT_FAILED, (inside.stderr.trim().split('\n')[0]) || `git rev-parse exited ${inside.code}`);
  }
  if (inside.stdout.trim() !== 'true') return null;
  const root = (await must(['rev-parse', '--show-toplevel'], { cwd, signal })).trim();
  return root === '' ? null : root;
}

/**
 * Repository metadata: HEAD, branch, remotes, and whether HEAD has a commit.
 * @param {string} root @param {AbortSignal} [signal]
 */
export async function readRepoInfo(root, signal) {
  const options = { cwd: root, signal };
  const [branchOut, headOut, remoteOut] = await Promise.all([
    runGit(['symbolic-ref', '--short', '-q', 'HEAD'], options),
    runGit(['rev-parse', '-q', '--verify', 'HEAD'], options),
    runGit(['remote'], options),
  ]);
  const head = headOut.code === 0 ? headOut.stdout.trim() : '';
  const branch = branchOut.code === 0 ? branchOut.stdout.trim() : '';
  const remotes = remoteOut.code === 0
    ? remoteOut.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  return {
    root,
    name,
    branch: branch === '' ? (head === '' ? '' : 'HEAD') : branch,
    detached: branch === '' && head !== '',
    head: head === '' ? '' : head.slice(0, 40),
    unborn: head === '',
    remotes,
  };
}

/**
 * Remote names (`git remote`).
 * @param {string} root @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
export async function listRemotes(root, signal) {
  const result = await runGit(['remote'], { cwd: root, signal });
  if (result.code !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Local branches, remote-tracking refs, and tags.
 * @param {string} root @param {AbortSignal} [signal]
 */
export async function listRefs(root, signal) {
  // A second invocation over refs/tags carries the object type and the peeled
  // commit (`*objectname`), so an annotated tag's badge lands on the commit
  // row rather than on the tag object.
  const [stdout, tagOut] = await Promise.all([
    must(['for-each-ref', '--format=%(refname)%00%(objectname)%1e', 'refs/heads', 'refs/remotes'], { cwd: root, signal }),
    must(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%1e', 'refs/tags'], { cwd: root, signal }),
  ]);
  /** @type {{ kind: 'local'|'remote'|'tag', name: string, oid: string, subject: string, tag: boolean }[]} */
  const refs = [];
  for (const record of stdout.split('\x1e')) {
    const line = record.replace(/^\n/, '');
    if (line.trim() === '') continue;
    const [refname = '', objectname = ''] = line.split('\x00');
    if (refname === '' || objectname === '') continue;
    const oid = objectname;
    if (refname.startsWith('refs/heads/')) {
      refs.push({ kind: 'local', name: refname.slice('refs/heads/'.length), oid, subject: '', tag: false });
    } else if (refname.startsWith('refs/remotes/')) {
      const name = refname.slice('refs/remotes/'.length);
      if (name.endsWith('/HEAD')) continue;
      refs.push({ kind: 'remote', name, oid, subject: '', tag: false });
    }
  }
  for (const record of tagOut.split('\x1e')) {
    const line = record.replace(/^\n/, '');
    if (line.trim() === '') continue;
    const [refname = '', objectname = '', objectType = '', peeled = '', peeledType = ''] = line.split('\x00');
    if (!refname.startsWith('refs/tags/') || objectname === '') continue;
    const oid = objectType === 'tag' ? (peeledType === 'commit' ? peeled : '') : objectname;
    if (oid === '') continue;
    refs.push({ kind: 'tag', name: refname.slice('refs/tags/'.length), oid, subject: objectname, tag: objectType === 'tag' });
  }
  refs.sort((a, b) => a.name.localeCompare(b.name));
  return refs;
}

/**
 * Decoration names (`%D`) into badge rows: `HEAD` first, then local branches,
 * remote-tracking refs, and tags, with duplicates removed.
 *
 * The decoration mode is pinned to `log.decorate=short`, so entries arrive as
 * `HEAD -> main`, `main`, `origin/main`, or `tag: v1.2.0`; a repository whose
 * config widens decorations to `refs/...` is handled as well.
 *
 * @param {string} decoration
 * @param {{ remotes?: ReadonlySet<string> }} context
 * @returns {{ kind: 'head'|'local'|'remote'|'tag', name: string }[]}
 */
export function parseDecorations(decoration, context) {
  /** @type {{ kind: 'head'|'local'|'remote'|'tag', name: string }[]} */
  const badges = [];
  const push = (kind, name) => {
    if (name === '') return;
    if (!badges.some((badge) => badge.kind === kind && badge.name === name)) badges.push({ kind, name });
  };
  for (const rawEntry of decoration.split(',')) {
    const entry = rawEntry.trim();
    if (entry === '') continue;
    if (entry.startsWith('HEAD -> ')) {
      push('head', 'HEAD');
      push('local', entry.slice('HEAD -> '.length));
    } else if (entry === 'HEAD') {
      push('head', 'HEAD');
    } else if (entry.startsWith('tag: ')) {
      push('tag', entry.slice('tag: '.length));
    } else if (entry.startsWith('refs/tags/')) {
      push('tag', entry.slice('refs/tags/'.length));
    } else if (entry.startsWith('refs/remotes/')) {
      push('remote', entry.slice('refs/remotes/'.length));
    } else if (entry.startsWith('refs/heads/')) {
      push('local', entry.slice('refs/heads/'.length));
    } else if (entry.startsWith('origin/')) {
      push('remote', entry);
    } else {
      push('local', entry);
    }
  }
  const rank = { head: 0, local: 1, remote: 2, tag: 3 };
  return badges.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/**
 * Short names of the remote-tracking refs, from the ref listing
 * (`refs/remotes/<remote>/<branch>` → `origin/main`), which is also the form a
 * `log.decorate=short` decoration prints when the remote is not treated as
 * the default one.
 * @param {{ kind: string, name: string }[]} refs
 * @returns {Set<string>}
 */
export function remoteShortNames(refs) {
  return new Set(refs.filter((ref) => ref.kind === 'remote').map((ref) => ref.name));
}

/**
 * Topologically ordered log page.
 *
 * @param {string} root
 * @param {{
 *   limit?: number,
 *   skip?: number,
 *   branches?: string[],
 *   tags?: boolean,
 *   remotes?: boolean,
 *   signal?: AbortSignal,
 * }} options
 */
export async function readGraph(root, options = {}) {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(options.limit ?? DEFAULT_LIMIT)));
  const skip = Math.max(0, Math.trunc(options.skip ?? 0));
  const branchArgs = Array.isArray(options.branches) ? options.branches.filter((name) => typeof name === 'string' && name !== '') : [];
  // "Show all" = every branch tip (`--branches`); a branch filter restricts
  // the walk to what those branch tips reach.
  const refs = branchArgs.length > 0
    ? branchArgs.map((name) => name.replace(/^refs\/heads\//, ''))
    : ['--branches'];
  if (options.tags !== false) refs.push('--tags');
  if (options.remotes !== false) refs.push('--remotes');
  const argv = [
    '-c', 'log.showSignature=false',
    '-c', 'log.decorate=short',
    '-c', 'core.quotepath=false',
    '--no-pager',
    'log',
    '--topo-order',
    '--date-order',
    ...refs,
    '--parents',
    `--max-count=${limit + 1}`,
    skip > 0 ? `--skip=${skip}` : '',
    '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x00%b%x1e',
  ].filter(Boolean);
  let stdout;
  try {
    stdout = await must(argv, { cwd: root, signal: options.signal });
  } catch (error) {
    // An unborn repository has no branch tip to walk and exits non-zero.
    if (error?.code === CODES.GIT_FAILED && /does not have any commits yet|bad default revision|unknown revision|ambiguous argument 'HEAD'/i.test(String(error.message))) {
      return { commits: [], hasMore: false, skip, limit };
    }
    throw error;
  }
  const [info, refRows] = await Promise.all([
    readRepoInfo(root, options.signal),
    listRefs(root, options.signal).catch(() => []),
  ]);
  const branchSet = new Set(refRows.filter((ref) => ref.kind === 'local').map((ref) => ref.name));
  /** @type {any[]} */
  const commits = [];
  for (const record of stdout.split('\x1e')) {
    const line = record.replace(/^\n/, '');
    if (line.trim() === '') continue;
    const [oid, parents, author, email, at, decoration, subject, body] = line.split('\x00');
    if (!oid) continue;
    commits.push({
      oid,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      email,
      time: (Number(at) || 0) * 1000,
      subject: subject ?? '',
      body: (body ?? '').replace(/\s+$/, ''),
      badges: parseDecorations(decoration ?? '', { branch: info.branch, remotes: remoteShortNames(refRows) }),
    });
  }
  if (commits.length === 0) return { commits: [], hasMore: false, skip, limit };
  const hasMore = commits.length > limit;
  return {
    commits: hasMore ? commits.slice(0, limit) : commits,
    hasMore,
    skip,
    limit,
    branches: [...branchSet].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * One commit with its full message and changed files.
 * @param {string} root @param {string} oid @param {AbortSignal} [signal]
 */
export async function readCommit(root, oid, signal) {
  if (!isFullHex(oid) && !isShortHex(oid)) throw new GitGraphError(CODES.BAD_INPUT, 'invalid commit id');
  const format = '%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%D%x00%s%x00%b%1e';
  const revision = oid + (isFullHex(oid) ? '^{commit}' : '');
  const stdout = await must(['-c', 'log.showSignature=false', '-c', 'log.decorate=short', '--no-pager', 'show', '-s', '--format=' + format, revision, '--'], { cwd: root, signal });
  const record = stdout.split('\x1e')[0] ?? '';
  const [full, parents, author, email, at, committer, committerEmail, ct, decoration, subject, body] = record.split('\x00');
  if (!full) throw new GitGraphError(CODES.GIT_FAILED, 'commit not found');
  // A merge commit defaults to `--cc` (combined diff), which prints nothing
  // for an already-merged side branch; `-m --first-parent` shows the change
  // the merge brought onto the target branch.
  // `--numstat` carries the added/deleted line counts the tree view shows; its
  // order matches the file list.
  const filesOut = await must(['-c', 'core.quotepath=false', '--no-pager', 'show', '--name-status', '--format=', '--no-renames', '-m', '--first-parent', revision, '--'], { cwd: root, signal });
  const statOut = await must(['-c', 'core.quotepath=false', '--no-pager', 'show', '--numstat', '--format=', '--no-renames', '-m', '--first-parent', revision, '--'], { cwd: root, signal });
  /** @type {Map<string, { add: number, del: number }>} */
  const counts = new Map();
  for (const line of statOut.split('\n')) {
    if (line.trim() === '') continue;
    const [add, del, ...rest] = line.split('\t');
    const path = rest.join('\t').trim();
    if (path === '') continue;
    // A binary file reports `-` for both counts.
    counts.set(path, { add: Number(add) || 0, del: Number(del) || 0 });
  }
  /** @type {{ status: string, path: string, add: number, del: number }[]} */
  const files = [];
  for (const line of filesOut.split('\n')) {
    if (line.trim() === '') continue;
    const [status, ...rest] = line.split('\t');
    const path = rest.join('\t').trim();
    if (!status || !path) continue;
    const count = counts.get(path) ?? { add: 0, del: 0 };
    files.push({ status: status.trim(), path, add: count.add, del: count.del });
  }
  const info = await readRepoInfo(root, signal);
  const refRows = await listRefs(root, signal).catch(() => []);
  return {
    oid: full,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    author,
    email,
    time: (Number(at) || 0) * 1000,
    committer,
    committerEmail,
    commitTime: (Number(ct) || 0) * 1000,
    subject: subject ?? '',
    body: (body ?? '').replace(/\s+$/, ''),
    files,
    badges: parseDecorations(decoration ?? '', { branch: info.branch, remotes: remoteShortNames(refRows) }),
  };
}

/**
 * Unified diff of one file in one commit.
 * @param {string} root @param {string} oid @param {string} path @param {{ maxBytes?: number }} [options]
 */
export async function readDiff(root, oid, path, options = {}) {
  if (!isFullHex(oid) && !isShortHex(oid)) throw new GitGraphError(CODES.BAD_INPUT, 'invalid commit id');
  if (typeof path !== 'string' || path === '' || path.startsWith('-')) throw new GitGraphError(CODES.BAD_INPUT, 'invalid path');
  const maxBytes = options.maxBytes ?? 400 * 1024;
  const stdout = await must(['-c', 'core.quotepath=false', '--no-pager', 'show', '--format=', '--no-ext-diff', '--no-renames', '-m', '--first-parent', oid + (isFullHex(oid) ? '^{commit}' : ''), '--', path], { cwd: root });
  const truncated = Buffer.byteLength(stdout, 'utf8') > maxBytes;
  return { path, diff: truncated ? stdout.slice(0, maxBytes) : stdout, truncated };
}

/**
 * Every ref of one commit (used by the detail pane when `%D` is unavailable).
 * @param {string} root @param {string} oid
 */
export async function refsAt(root, oid) {
  if (!isFullHex(oid)) throw new GitGraphError(CODES.BAD_INPUT, 'invalid commit id');
  const stdout = await must(['for-each-ref', '--format=%(refname)', '--points-at', oid], { cwd: root });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * `git fetch --all --prune --quiet` with a bounded deadline.
 * @param {string} root @param {{ timeoutMs?: number }} [options]
 */
export async function fetchAll(root, options = {}) {
  const started = Date.now();
  await must(['fetch', '--all', '--prune', '--quiet'], { cwd: root, timeoutMs: options.timeoutMs ?? 120000 });
  return { ms: Date.now() - started };
}

// --------------------------------------------------------------- branch state

/** Repository state a switch must respect; `dirty` counts tracked changes. */
export async function readStatus(root, signal) {
  const options = { cwd: root, signal };
  const info = await readRepoInfo(root, signal);
  // V1 porcelain: staged changes are one column, work-tree changes the other,
  // so a change that is staged but clean in the work tree still counts.
  // Untracked files do not block `git switch` and are only reported.
  const status = await must(['-c', 'core.quotepath=false', '--no-optional-locks', 'status', '--porcelain=v1'], options);
  const changes = status.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('??'));
  const conflicts = changes.filter((line) => /^(DD|AU|UD|UA|DU|AA|UU)/.test(line));
  const operation = await operationInProgress(root, signal);
  return {
    ...info,
    dirty: changes.length - conflicts.length,
    conflicts: conflicts.length,
    operationInProgress: operation !== null,
    operation,
  };
}

/** A running merge/rebase/cherry-pick/revert/bisect, or null. */
export async function operationInProgress(root, signal) {
  const result = await runGit(['rev-parse', '--git-path', 'MERGE_HEAD', '--git-path', 'REBASE_HEAD', '--git-path', 'CHERRY_PICK_HEAD', '--git-path', 'REVERT_HEAD', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', '--git-path', 'sequencer', '--git-path', 'BISECT_LOG'], { cwd: root, signal });
  if (result.code !== 0) return null;
  const markers = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const marker of markers) {
    if (existsSync(resolve(root, marker))) {
      const name = marker.split('/').filter(Boolean).pop() ?? marker;
      return name;
    }
  }
  return null;
}

/**
 * Move one branch checked out in another worktree (a local path) back to its
 * own worktree: `git switch <branch>` from inside that worktree. The chip
 * offers this as the recovery for {@link CODES.BRANCH_IN_USE}.
 */
export async function worktreeOfBranch(root, branch, signal) {
  const stdout = await must(['worktree', 'list', '--porcelain'], { cwd: root, signal });
  let current = null;
  for (const line of `${stdout}\n`.split('\n')) {
    if (line === '') {
      if (current !== null && current.branch === branch) return current.path;
      current = null;
      continue;
    }
    if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length).trim(), branch: '' };
    else if (current !== null && line.startsWith('branch refs/heads/')) current.branch = line.slice('branch refs/heads/'.length).trim();
  }
  return null;
}

/**
 * `git switch <branch>` with the guards a shared work tree needs.
 *
 * The checks are deliberate: a branch already checked out elsewhere is
 * reported with the path so the chip can offer "move it here"; an unfinished
 * merge/rebase, unresolved conflicts, or tracked changes that the switch would
 * overwrite all block before git touches the index.
 *
 * @param {string} root
 * @param {string} branch - local branch short name.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ branch: string }>}
 */
export async function switchBranch(root, branch, options = {}) {
  if (typeof branch !== 'string' || branch === '' || branch.startsWith('-')) {
    throw new GitGraphError(CODES.INVALID_BRANCH, 'invalid branch name');
  }
  const options2 = { cwd: root, signal: options.signal };
  // `--branch` is a separate argv token: the old `--branch=<name>` form is not
  // accepted by every git (2.33 answers with usage and exit 129).
  const format = await runGit(['check-ref-format', '--branch', branch], options2);
  if (format.code !== 0) throw new GitGraphError(CODES.INVALID_BRANCH, `invalid branch name: ${branch}`);
  const verify = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], options2);
  if (verify.code !== 0) throw new GitGraphError(CODES.BRANCH_NOT_FOUND, `branch "${branch}" does not exist locally`);
  const error = (code, message, extra = {}) => Object.assign(new GitGraphError(code, message), extra);
  const status = await readStatus(root, options.signal);
  if (status.branch === branch) return { branch };
  if (status.operationInProgress) throw error(CODES.OPERATION_IN_PROGRESS, `a ${status.operation} operation is in progress`);
  if (status.conflicts > 0) throw error(CODES.CONFLICTS, `${status.conflicts} unresolved conflict(s) in the working tree`);
  const elsewhere = await worktreeOfBranch(root, branch, options.signal);
  if (elsewhere !== null && resolve(elsewhere) !== resolve(root)) {
    throw error(CODES.BRANCH_IN_USE, `branch "${branch}" is checked out in ${elsewhere}`, { path: elsewhere });
  }
  const switched = await runGit(['switch', '--no-guess', branch], options2);
  if (switched.code === 0) return { branch };
  const message = (switched.stderr || switched.stdout).trim().split('\n')[0] || 'git switch failed';
  if (/local changes to the following files would be overwritten|would be overwritten by switch/i.test(switched.stderr)) {
    throw error(CODES.OVERWRITTEN, message);
  }
  throw new GitGraphError(CODES.GIT_FAILED, message);
}
