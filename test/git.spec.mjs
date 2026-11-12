/**
 * Tests of the host git backend and the `/api/dsh-git-graph` route against a
 * throwaway repository created under the OS temp directory.
 *
 *   node --test test/
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findRepoRoot, listRefs, parseDecorations, readCommit, readDiff, readGraph, readRepoInfo, readStatus,
  runGit, switchBranch, worktreeOfBranch,
} from '../lib/git.js';

// `lib/index.js` imports `schemastery`, which the Harness profile provides at
// runtime; `test/node_modules/schemastery` is a stub so this suite runs from
// the checkout. A profile install resolves the real package instead.
const { apply } = await import('../lib/index.js');

let dir;
let root;

const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
const write = (name, content) => writeFileSync(join(dir, name), content);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-git-graph-test-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'tester@example.com');
  git('config', 'user.name', 'Tester');
  write('a.txt', 'a\n');
  git('add', '.');
  git('commit', '-qm', 'feat: root commit');
  git('checkout', '-q', '-b', 'feature/x');
  write('b.txt', 'b\n');
  git('add', '.');
  git('commit', '-qm', 'B 分支提交');
  git('checkout', '-q', 'main');
  write('c.txt', 'c\n');
  git('add', '.');
  git('commit', '-qm', 'C main commit');
  git('merge', '-q', '--no-ff', 'feature/x', '-m', "Merge branch 'feature/x' into 'main'");
  git('tag', '-a', 'v1.0', '-m', 'release one');
  git('checkout', '-q', '-b', 'feat/y');
  write('d.txt', 'd\n');
  git('add', '.');
  git('commit', '-qm', 'D on feat/y');
  git('checkout', '-q', 'main');
  // Remote-tracking refs without a network round trip.
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('update-ref', 'refs/remotes/origin/dev', 'HEAD~1');
  git('update-ref', 'refs/remotes/origin/HEAD', 'HEAD');
  git('update-ref', 'refs/heads/dev', 'HEAD~2');
  root = dir;
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('findRepoRoot finds the work tree and rejects a plain directory', async () => {
  const found = await findRepoRoot(join(dir, '.git'), undefined).catch(() => null);
  assert.equal(found, null, '.git is not a work tree');
  assert.match(await findRepoRoot(dir), /dsh-git-graph-test-/);
  assert.equal(await findRepoRoot(tmpdir()), null);
});

test('readGraph lists every branch tip with parent links and decorations', async () => {
  const page = await readGraph(root, { limit: 50 });
  const subjects = page.commits.map((commit) => commit.subject);
  assert.equal(page.hasMore, false);
  for (const subject of ['D on feat/y', "Merge branch 'feature/x' into 'main'", 'B 分支提交', 'C main commit', 'feat: root commit']) {
    assert.ok(subjects.includes(subject), `missing ${subject}`);
  }
  const merge = page.commits.find((commit) => commit.subject.startsWith('Merge'));
  assert.equal(merge.parents.length, 2);
  const kinds = merge.badges.map((badge) => `${badge.kind}:${badge.name}`);
  assert.deepEqual(kinds.slice(0, 2), ['head:HEAD', 'local:main']);
  assert.ok(kinds.includes('tag:v1.0'));
  assert.ok(kinds.includes('remote:origin/main'));
  const recent = page.commits.find((commit) => commit.subject === 'C main commit');
  assert.ok(recent.badges.some((badge) => badge.kind === 'remote' && badge.name === 'origin/dev'));
  assert.ok(page.branches.includes('dev'));
});

test('readGraph paginates without dropping or repeating commits', async () => {
  const all = await readGraph(root, { limit: 50 });
  const first = await readGraph(root, { limit: 2 });
  assert.equal(first.hasMore, true);
  assert.equal(first.commits.length, 2);
  const second = await readGraph(root, { limit: 2, skip: 2 });
  const seen = [...first.commits, ...second.commits].map((commit) => commit.oid);
  assert.deepEqual(seen, all.commits.slice(0, 4).map((commit) => commit.oid));
});

test('readGraph filters to one branch and honors the tag/remote switches', async () => {
  // `dev` is created at `HEAD~2`. After the merge fixture that is the root
  // commit, so the walk reaches only history behind it: `C main commit` sits
  // on the first-parent side of the merge and is not reachable from there.
  const devOnly = await readGraph(root, { limit: 50, branches: ['dev'] });
  assert.deepEqual(devOnly.commits.map((commit) => commit.subject), ['feat: root commit']);

  // A remote-tracking filter walks `refs/remotes/<name>`; `origin/dev` is one
  // commit ahead of the local `dev`, so it does reach `C main commit`.
  const remote = await readGraph(root, { limit: 50, branches: ['origin/dev'], remoteBranches: ['origin/dev'] });
  assert.ok(remote.commits.some((commit) => commit.subject === 'C main commit'));
  assert.ok(!remote.commits.some((commit) => commit.subject === 'D on feat/y'));
  // Without the hint the name would be read as a local branch (`refs/heads`).
  const asLocal = await readGraph(root, { limit: 50, branches: ['dev'] });
  assert.ok(!asLocal.commits.some((commit) => commit.subject === 'C main commit'));
});

test('parseDecorations covers every decoration form', () => {
  assert.deepEqual(
    parseDecorations('HEAD -> main, origin/main, tag: v1, dev', { remotes: new Set() }).map((badge) => `${badge.kind}:${badge.name}`),
    ['head:HEAD', 'local:main', 'local:dev', 'remote:origin/main', 'tag:v1'],
  );
  assert.deepEqual(parseDecorations('', {}), []);
});

test('listRefs peels annotated tags to their commit', async () => {
  const refs = await listRefs(root);
  const tag = refs.find((ref) => ref.name === 'v1.0');
  assert.equal(tag.kind, 'tag');
  assert.equal(tag.oid, git('rev-parse', 'v1.0^{commit}'));
  assert.ok(!refs.some((ref) => ref.name === 'origin/HEAD'));
});

test('readCommit returns the message, files and merge changes', async () => {
  const page = await readGraph(root, { limit: 50 });
  const merge = page.commits.find((commit) => commit.subject.startsWith('Merge'));
  const detail = await readCommit(root, merge.oid);
  assert.equal(detail.subject, "Merge branch 'feature/x' into 'main'");
  assert.deepEqual(detail.files.map((file) => file.path), ['b.txt']);
  const simple = page.commits.find((commit) => commit.subject === 'B 分支提交');
  assert.deepEqual((await readCommit(root, simple.oid)).files, [{ status: 'A', path: 'b.txt', add: 1, del: 0 }]);
});

test('readDiff returns one file diff and rejects option-like input', async () => {
  const page = await readGraph(root, { limit: 50 });
  const commit = page.commits.find((entry) => entry.subject === 'B 分支提交');
  const diff = await readDiff(root, commit.oid, 'b.txt');
  assert.match(diff.diff, /\+b/);
  await assert.rejects(readDiff(root, commit.oid, '--upload-pack=evil'), { code: 'bad-input' });
  await assert.rejects(readCommit(root, '--config=evil'), { code: 'bad-input' });
});

test('runGit reports a missing work tree rather than throwing', async () => {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: tmpdir() });
  assert.notEqual(result.code, 0);
});

test('readRepoInfo describes an unborn repository', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'dsh-git-graph-empty-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
    const info = await readRepoInfo(empty);
    assert.equal(info.unborn, true);
    const page = await readGraph(empty, { limit: 10 });
    assert.deepEqual(page.commits, []);
    assert.equal(page.hasMore, false);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('readStatus reports branch, changes and in-progress operations', async () => {
  // Untracked files do not count as changes; tracked edits and staged edits do.
  const clean = await readStatus(root);
  assert.equal(clean.branch, 'main');
  assert.equal(clean.dirty, 0);
  assert.equal(clean.conflicts, 0);
  assert.equal(clean.operationInProgress, false);
  write('dirty.txt', 'x\n');
  assert.equal((await readStatus(root)).dirty, 0);
  rmSync(join(root, 'dirty.txt'));
  write('a.txt', 'a\nmodified\n');
  const edited = await readStatus(root);
  assert.equal(edited.dirty, 1);
  git('checkout', '-q', '--', 'a.txt');
  write('b.txt', 'b\nstaged\n');
  git('add', 'b.txt');
  assert.equal((await readStatus(root)).dirty, 1);
  git('reset', '-q', 'HEAD', 'b.txt');
  git('checkout', '-q', '--', 'b.txt');
  assert.equal((await readStatus(root)).dirty, 0);
});

test('switchBranch moves the checkout and refuses invalid or missing branches', async () => {
  const first = await switchBranch(root, 'dev');
  assert.deepEqual(first, { branch: 'dev' });
  assert.equal((await readStatus(root)).branch, 'dev');
  await switchBranch(root, 'main');
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  await assert.rejects(switchBranch(root, 'no-such-branch'), { code: 'target-branch-not-found' });
  await assert.rejects(switchBranch(root, '--force'), { code: 'invalid-branch-name' });
  await assert.rejects(switchBranch(root, 'feature//x'), { code: 'invalid-branch-name' });
});

test('switchBranch refuses a branch checked out in another worktree', async () => {
  const linked = mkdtempSync(join(tmpdir(), 'dsh-git-graph-wt-'));
  // A fresh branch for the linked worktree: `feat/y` is not checked out here,
  // but a second later check would make git's own refusal ambiguous.
  git('branch', 'wt-probe', 'main');
  try {
    execFileSync('git', ['worktree', 'add', '-q', linked, 'wt-probe'], { cwd: root });
    const found = await worktreeOfBranch(root, 'wt-probe');
    assert.equal(realpathSync(found), realpathSync(linked));
    await assert.rejects(switchBranch(root, 'wt-probe'), { code: 'branch-in-other-worktree' });
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', linked], { cwd: root, stdio: 'ignore' }); } catch { /* gone */ }
    try { execFileSync('git', ['branch', '-q', '-D', 'wt-probe'], { cwd: root, stdio: 'ignore' }); } catch { /* gone */ }
    rmSync(linked, { recursive: true, force: true });
  }
});

test('switchBranch refuses tracked changes the switch would overwrite', async () => {
  git('checkout', '-q', '-b', 'conflict-probe', 'main');
  write('a.txt', 'a\nconflict-probe\n');
  git('commit', '-qam', 'conflict probe change');
  git('checkout', '-q', 'main');
  write('a.txt', 'a\nlocal dirty\n');
  try {
    await assert.rejects(switchBranch(root, 'conflict-probe'), { code: 'changes-would-be-overwritten' });
    assert.equal((await readStatus(root)).dirty, 1);
  } finally {
    git('checkout', '-q', '--', 'a.txt');
    git('branch', '-q', '-D', 'conflict-probe');
  }
});

test('switchBranch refuses while a merge is in progress', async () => {
  git('checkout', '-q', '-b', 'merge-probe', 'main');
  write('m.txt', 'theirs\n');
  git('add', 'm.txt');
  git('commit', '-qm', 'merge probe');
  git('checkout', '-q', 'main');
  write('m.txt', 'ours\n');
  git('add', 'm.txt');
  git('commit', '-qm', 'main side');
  let merged = true;
  try {
    execFileSync('git', ['merge', '--no-commit', 'merge-probe'], { cwd: root, stdio: 'ignore' });
  } catch {
    merged = false;
  }
  try {
    if (!merged) {
      const status = await readStatus(root);
      assert.equal(status.operationInProgress, true);
      assert.equal(status.operation, 'MERGE_HEAD');
      await assert.rejects(switchBranch(root, 'dev'), { code: /operation-in-progress|conflicts-present/ });
    }
  } finally {
    try { execFileSync('git', ['merge', '--abort'], { cwd: root, stdio: 'ignore' }); } catch { /* not merging */ }
    try { execFileSync('git', ['reset', '-q', '--hard', 'HEAD'], { cwd: root }); } catch { /* best effort */ }
    try { execFileSync('git', ['branch', '-q', '-D', 'merge-probe'], { cwd: root, stdio: 'ignore' }); } catch { /* gone */ }
  }
});

test('the /api/dsh-git-graph route answers boot, rpc and health', async () => {
  const routes = [];
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    inject: (_names, callback) => {
      callback({ connection: { fetch: { register: (route) => { routes.push(route); return () => {}; } } } });
    },
    get: () => undefined,
    effect: () => {},
  };
  apply(ctx, { workingDirectory: root, pageSize: 100 });
  assert.equal(routes.length, 1);
  const route = routes[0];
  const post = async (token, body) => (await route.fetch(new Request('http://127.0.0.1/api/dsh-git-graph', {
    method: 'POST',
    headers: token === null ? {} : { 'x-dsh-git-graph-token': token },
    body: JSON.stringify(body),
  })));
  const boot = await (await route.fetch(new Request('http://127.0.0.1/api/dsh-git-graph'))).json();
  assert.equal(boot.ok, true);
  assert.equal(boot.value.state.repo.name, root.split('/').pop());
  const token = boot.value.token;
  const call = async (method, args) => (await post(token, { method: 'state.rpc', args: { method, args } })).json();
  const graph = await call('graph', { limit: 50 });
  assert.equal(graph.ok, true);
  assert.ok(graph.value.commits.length >= 5);
  assert.ok(graph.value.refs.some((ref) => ref.kind === 'remote'));
  const commit = await call('commit', { oid: graph.value.commits[0].oid });
  assert.equal(commit.ok, true);
  const fetchResult = await call('fetch', {});
  assert.equal(fetchResult.ok, false);
  assert.equal(fetchResult.error.code, 'fetch-disabled');
  const status = await call('status', {});
  assert.equal(status.ok, true);
  assert.equal(status.value.branch, 'main');
  assert.ok(status.value.branches.some((entry) => entry.name === 'dev'));
  const switched = await call('switch', { branch: 'dev' });
  assert.equal(switched.ok, true);
  assert.equal((await call('status', {})).value.branch, 'dev');
  assert.equal((await call('switch', { branch: 'main' })).ok, true);
  const missing = await call('switch', { branch: 'nope' });
  assert.equal(missing.error.code, 'target-branch-not-found');
  assert.equal((await post(null, { method: 'state.rpc' })).status, 403);
  const health = await (await route.fetch(new Request('http://127.0.0.1/api/dsh-git-graph/health'))).json();
  assert.equal(health.value.mounted, true);
  assert.match(health.value.git, /^git version/);
});

test('the requested session directory selects the repository', async () => {
  const routes = [];
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    inject: (_names, callback) => {
      callback({ connection: { fetch: { register: (route) => { routes.push(route); return () => {}; } } } });
    },
    get: () => undefined,
    effect: () => {},
  };
  // No workingDirectory override: the page's directory decides.
  apply(ctx, {});
  const route = routes[0];
  const realRoot = realpathSync(root);
  const boot = await (await route.fetch(new Request(`http://x/api/dsh-git-graph?directory=${encodeURIComponent(root)}`))).json();
  assert.equal(boot.value.state.repo.name, root.split('/').pop());
  assert.equal(boot.value.state.source, 'session');
  const call = async (method, args) => (await route.fetch(new Request('http://x/api/dsh-git-graph', {
    method: 'POST',
    headers: { 'x-dsh-git-graph-token': boot.value.token },
    body: JSON.stringify({ method: 'state.rpc', args: { method, args } }),
  }))).json();
  const graph = await call('graph', { limit: 50, directory: root });
  assert.equal(graph.ok, true);
  assert.ok(graph.value.commits.length >= 5);
  assert.equal(graph.value.source, 'session');
  // A subdirectory of the work tree resolves to the same repository.
  mkdirSync(join(root, 'sub'), { recursive: true });
  const nested = await call('repo', { directory: join(root, 'sub') });
  assert.equal(nested.value.repo?.root ?? null, realRoot);
  // Another directory in the same host process is a different repository.
  const other = await call('repo', { directory: tmpdir() });
  assert.equal(other.value.repo, null);
  assert.equal(other.value.error, null);
});

test('a configured non-repository directory reports not-repo', async () => {
  const routes = [];
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    inject: (_names, callback) => {
      callback({ connection: { fetch: { register: (route) => { routes.push(route); return () => {}; } } } });
    },
    get: () => undefined,
    effect: () => {},
  };
  apply(ctx, { workingDirectory: tmpdir() });
  const route = routes[0];
  const boot = await (await route.fetch(new Request('http://x/api/dsh-git-graph'))).json();
  assert.equal(boot.value.state.repo, null);
  const page = await (await route.fetch(new Request('http://x/api/dsh-git-graph', {
    method: 'POST',
    headers: { 'x-dsh-git-graph-token': boot.value.token },
    body: JSON.stringify({ method: 'state.rpc', args: { method: 'graph' } }),
  }))).json();
  assert.equal(page.ok, false);
  assert.equal(page.error.code, 'not-repo');
});

test('the Connection route attaches whether Connection is mounted or arrives later', async () => {
  const registration = (log, label) => ({ register: (route) => { log.push([label, route.kind ?? 'fetch', route.path]); return () => log.push([`${label}.dispose`]); } });

  // Connection is already mounted when the row activates: the desktop profile
  // evaluates plugin rows in an order the plugin cannot rely on, so a route
  // that only registered from a `ctx.inject` callback could stay unregistered
  // for a whole session — the page then answers 403 from whatever else owns
  // the path.
  {
    const log = [];
    const connection = { fetch: registration(log, 'connection') };
    const ctx = {
      logger: () => ({ info() {}, warn() {} }),
      inject: () => { log.push(['inject']); },
      get: (name) => (name === 'connection' ? connection : undefined),
      effect: (fn) => fn(),
    };
    apply(ctx, { workingDirectory: root });
    assert.deepEqual(log, [['connection', 'fetch', '/api/dsh-git-graph']]);
  }

  // Connection mounts after the row: one inject callback registers once.
  {
    const log = [];
    const callbacks = {};
    const ctx = {
      logger: () => ({ info() {}, warn() {} }),
      inject: (names, callback) => { callbacks[names[0]] = callback; },
      get: () => undefined,
      effect: (fn) => fn(),
    };
    apply(ctx, { workingDirectory: root });
    const connection = { fetch: registration(log, 'connection') };
    callbacks.connection({ connection });
    callbacks.connection({ connection });
    assert.deepEqual(log.filter(([kind]) => kind === 'connection'), [['connection', 'fetch', '/api/dsh-git-graph']]);
  }
});

test('the webServer fallback is exact, takes over late Connection, and never shadows /api', async () => {
  // A prefix under `/api` would win the web server's longest-prefix match over
  // Connection's `/api` route, and the desktop shell (which rewrites the
  // browser markers only on Connection's route) would then answer every call
  // 403 while the plugin is mounted.
  const log = [];
  const callbacks = {};
  const ctx = {
    logger: () => ({ info() {}, warn() {} }),
    inject: (names, callback) => { callbacks[names[0]] = callback; },
    get: () => undefined,
    effect: (fn) => fn(),
  };
  apply(ctx, { workingDirectory: root });
  callbacks.webServer({ webServer: { register: (route) => { log.push([route.kind, route.path]); return () => log.push(['disposed', route.kind]); } } });
  assert.deepEqual(log, [['exact', '/api/dsh-git-graph']]);
  // Connection showing up later owns the path again; the fallback steps aside.
  callbacks.connection({ connection: { fetch: { register: (route) => { log.push(['fetch', route.path]); return () => {}; } } } });
  assert.deepEqual(log, [['exact', '/api/dsh-git-graph'], ['fetch', '/api/dsh-git-graph'], ['disposed', 'exact']]);
  // An empty inject callback changes nothing.
  callbacks.connection({ connection: undefined });
  assert.equal(log.filter(([kind]) => kind === 'fetch').length, 1);
});
