/**
 * Client half of dsh-plugin-git-graph.
 *
 * A Git Graph tab body for the right sidebar (`sidebar.right.pane.tab`, keyed
 * `git-graph`), its title cell, and a launcher in the Session header
 * utilities (`conversation.session.header.utilities`).
 *
 * Plain JavaScript and React from the browser module table: no Harness Client
 * package is imported, every colour comes from `--dsw-alias-*` theme tokens
 * (only the lane palette is artwork), and every label goes through the Client
 * locale service with a built-in zh/en dictionary fallback.
 *
 * Git facts arrive from the host half through `state.rpc` on
 * `/api/dsh-git-graph`; the browser never runs git itself.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-git-graph',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;
    // `react-dom` is a shared module of the page; only ports are used, so a
    // host that cannot resolve it degrades to rendering in place.
    const createPortal = (() => {
      try {
        const dom = require('react-dom');
        return typeof dom?.createPortal === 'function' ? dom.createPortal : null;
      } catch {
        return null;
      }
    })();

    const NAMESPACE = 'git-graph';
    /** Key of the tab body and of its title cell. */
    const TAB_KEY = 'git-graph';
    /** Right-sidebar tab kind: the shell's tab registry and `openTab` speak it. */
    const TAB_KIND = 'git-graph';
    const RPC_PATH = '/api/dsh-git-graph';
    const ROW_HEIGHT = 28;
    const LANE_WIDTH = 16;
    const GRAPH_PAD = 8;
    const LANE_COLORS = [
      '#4f9cf9', '#c95be0', '#26b47a', '#f0a020', '#ef6b5a',
      '#8a7bf0', '#2fb8c0', '#d96fd0', '#9aa83a', '#e0804a',
    ];

    const DICT = {
      zh: {
        'tab.title': 'Git 图谱',
        'launcher.label': 'Git 图谱',
        'launcher.hint': '已展开右侧栏；在标签页列表里选择「Git 图谱」',
        'tab.description': '当前项目仓库的提交图谱、分支与标签',
        'toolbar.repo': '仓库',
        'toolbar.branch': '分支',
        'toolbar.showAll': '显示全部分支',
        'toolbar.localBranches': '本地分支',
        'toolbar.remoteBranches': '远程分支',
        'toolbar.tags': '标签',
        'toolbar.remotes': '远程分支',
        'toolbar.refresh': '刷新',
        'toolbar.fetch': '拉取远程',
        'col.graph': '图谱',
        'col.description': '描述',
        'col.date': '日期',
        'col.author': '作者',
        'col.commit': '提交',
        'status.loading': '正在读取提交…',
        'status.waitingSession': '正在等待会话加载…',
        'status.hostDown': 'Git 插件没有响应',
        'status.hostDownHint': '宿主里的插件这一轮没有加载起来。检查插件是否启用，或重启应用后再试。',
        'status.forbiddenHint': '请求被宿主里的其他路由拦截（403），没有到达 Git 插件。请升级插件到修复了兜底路由的版本，然后重启应用。',
        'status.noRepo': '当前工作目录不在 Git 仓库中',
        'status.noRepoHint': '打开一个位于 Git 仓库里的会话，标签页就会跟着会话目录切换；也可以在插件配置里把 workingDirectory 固定到某个仓库。',
        'status.empty': '这个仓库还没有任何提交。',
        'status.noGit': '未找到 git，请先安装 Git 并确认它在 PATH 中。',
        'status.detached': '游离 HEAD',
        'status.more': '加载更多',
        'status.loaded': '{count} 个提交',
        'detail.parent': '父提交',
        'detail.parents': '父提交',
        'detail.commit': '提交',
        'detail.author': '作者',
        'detail.committer': '提交者',
        'detail.message': '提交信息',
        'detail.files': '变更文件（{count}）',
        'detail.noFiles': '没有文件变更。',
        'detail.copy': '复制哈希',
        'detail.copied': '已复制',
        'detail.diffEmpty': '这个文件没有差异。',
        'detail.diffTruncated': '差异过长，已截断。',
        'detail.loading': '正在加载…',
        'detail.back': '返回',
        'detail.close': '收起',
        'error.title': '读取仓库失败',
        'error.not-repo': '当前工作目录不在 Git 仓库中',
        'error.no-git': '未找到 git 可执行文件',
        'error.timeout': 'git 命令超时',
        'error.empty-repo': '仓库还没有提交',
        'error.bad-input': '参数无效',
        'error.forbidden': '页面令牌失效，请刷新页面',
        'error.git-failed': 'git 命令失败',
        'error.network': '无法连接宿主进程',
        'error.unknown': '未知错误',
        'error.fetch-disabled': '拉取远程未启用（配置 enableFetch）',
        'error.invalid-branch-name': '分支名无效',
        'error.target-branch-not-found': '本地没有这个分支',
        'error.branch-in-other-worktree': '该分支已在其他 worktree 中检出',
        'error.operation-in-progress': '有未完成的 Git 操作',
        'error.conflicts-present': '存在未解决的冲突',
        'error.changes-would-be-overwritten': '本地改动会被覆盖，请先提交或暂存',
        'chip.switch': '切换分支',
        'chip.search': '搜索分支…',
        'chip.current': '当前分支',
        'chip.head': 'HEAD 提交',
        'chip.noRemotes': '无远程',
        'chip.remotes': '{count} 个远程',
        'chip.clean': '工作区干净',
        'chip.dirty': '{count} 个文件有改动',
        'chip.conflicts': '{count} 个冲突',
        'chip.operation': '进行中：{name}',
        'chip.detached': '游离 HEAD',
        'chip.unborn': '尚无提交',
        'chip.fetch': '拉取远程',
        'chip.fetching': '正在拉取远程…',
        'chip.fetched': '远程已更新',
        'chip.graph': '打开 Git 图谱',
        'chip.switched': '已切换到 {branch}',
        'chip.empty': '没有匹配的分支',
        'chip.count': '{count} 个本地分支',
        'chip.more': '还有 {count} 个，继续输入筛选',
      },
      en: {
        'tab.title': 'Git graph',
        'launcher.label': 'Git graph',
        'launcher.hint': 'Right sidebar opened; pick “Git graph” from the tab list',
        'tab.description': 'Commit lanes, branches, and tags of the current repository',
        'toolbar.repo': 'Repository',
        'toolbar.branch': 'Branches',
        'toolbar.showAll': 'Show all branches',
        'toolbar.localBranches': 'Local branches',
        'toolbar.remoteBranches': 'Remote branches',
        'toolbar.tags': 'Tags',
        'toolbar.remotes': 'Remote branches',
        'toolbar.refresh': 'Refresh',
        'toolbar.fetch': 'Fetch',
        'col.graph': 'Graph',
        'col.description': 'Description',
        'col.date': 'Date',
        'col.author': 'Author',
        'col.commit': 'Commit',
        'status.loading': 'Reading commits…',
        'status.waitingSession': 'Waiting for the session to load…',
        'status.hostDown': 'The Git plugin is not responding',
        'status.hostDownHint': 'The plugin did not load in this host session. Check that it is enabled, or restart the app and try again.',
        'status.forbiddenHint': 'The request was answered by another host route (403) and never reached the Git plugin. Update the plugin to a build with the exact fallback route, then restart the app.',
        'status.noRepo': 'The working directory is not inside a Git repository',
        'status.noRepoHint': 'Open a session inside a Git repository and this tab follows its directory; workingDirectory pins one repository instead.',
        'status.empty': 'This repository has no commits yet.',
        'status.noGit': 'git was not found. Install Git and make sure it is on PATH.',
        'status.detached': 'detached HEAD',
        'status.more': 'Load more',
        'status.loaded': '{count} commits',
        'detail.parent': 'Parent',
        'detail.parents': 'Parents',
        'detail.commit': 'Commit',
        'detail.author': 'Author',
        'detail.committer': 'Committer',
        'detail.message': 'Message',
        'detail.files': 'Files ({count})',
        'detail.noFiles': 'No file changes.',
        'detail.copy': 'Copy hash',
        'detail.copied': 'Copied',
        'detail.diffEmpty': 'No diff for this file.',
        'detail.diffTruncated': 'The diff is truncated.',
        'detail.loading': 'Loading…',
        'detail.back': 'Back',
        'detail.close': 'Collapse',
        'error.title': 'Could not read the repository',
        'error.not-repo': 'The working directory is not inside a Git repository',
        'error.no-git': 'git executable not found',
        'error.timeout': 'git command timed out',
        'error.empty-repo': 'The repository has no commits',
        'error.bad-input': 'Invalid argument',
        'error.forbidden': 'The page token expired; refresh the page',
        'error.git-failed': 'git command failed',
        'error.network': 'Cannot reach the host process',
        'error.unknown': 'Unknown error',
        'error.fetch-disabled': 'Fetching is disabled (enableFetch)',
        'error.invalid-branch-name': 'Invalid branch name',
        'error.target-branch-not-found': 'No such local branch',
        'error.branch-in-other-worktree': 'That branch is checked out in another worktree',
        'error.operation-in-progress': 'A Git operation is in progress',
        'error.conflicts-present': 'Unresolved conflicts in the working tree',
        'error.changes-would-be-overwritten': 'Local changes would be overwritten; commit or stash them first',
        'chip.switch': 'Switch branch',
        'chip.head': 'HEAD',
        'chip.noRemotes': 'no remotes',
        'chip.remotes': '{count} remotes',
        'chip.search': 'Search branches…',
        'chip.current': 'Current branch',
        'chip.clean': 'Working tree clean',
        'chip.dirty': '{count} changed file(s)',
        'chip.conflicts': '{count} conflict(s)',
        'chip.operation': 'In progress: {name}',
        'chip.detached': 'detached HEAD',
        'chip.unborn': 'no commits yet',
        'chip.fetch': 'Fetch remotes',
        'chip.fetching': 'Fetching remotes…',
        'chip.fetched': 'Remotes updated',
        'chip.graph': 'Open the Git graph',
        'chip.switched': 'Switched to {branch}',
        'chip.empty': 'No matching branch',
        'chip.count': '{count} local branches',
        'chip.more': '{count} more — keep typing to filter',
      },
    };

    const format = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => (values?.[key] ?? ''));

    /** Locale-aware translator; falls back to the built-in dictionary. */
    function translate(ctx) {
      let bound;
      try {
        bound = ctx.get('locale')?.bind?.(NAMESPACE);
      } catch {
        bound = undefined;
      }
      let lang = 'zh';
      try {
        const snapshot = ctx.get('locale')?.getSnapshot?.();
        if (String(snapshot?.active ?? 'zh').toLowerCase().startsWith('en')) lang = 'en';
      } catch {
        // keep zh
      }
      return (key, values) => {
        if (typeof bound === 'function') {
          try {
            const value = bound(key);
            if (typeof value === 'string' && value !== '' && value !== key) return values ? format(value, values) : value;
          } catch {
            // fall through to the dictionary
          }
        }
        const text = DICT[lang]?.[key] ?? DICT.zh[key] ?? key;
        return values ? format(text, values) : text;
      };
    }

    /** The client context, read by thunks the host re-evaluates on every projection. */
    let clientContext = null;

    // ------------------------------------------------------------------ host RPC

    /** One page/host RPC session: a per-load token plus the initial state. */
    function createRpc() {
      let token = null;
      let bootPromise = null;
      let bootKey = null;
      /** Boot with the given session directory; a different directory reboots. */
      const boot = (directory = '', location = '') => {
        const key = `${directory ?? ''}\u0000${location ?? ''}`;
        if (bootPromise !== null && bootKey === key) return bootPromise;
        bootKey = key;
        // The session directory selects the repository; this page's own
        // location is a hint for hosts whose synthetic session directories do
        // not exist on disk.
        const params = [];
        const dir = directory ?? '';
        if (dir !== '') params.push(`directory=${encodeURIComponent(dir)}`);
        try {
          const where = location ?? window.location.pathname;
          if (where) params.push(`location=${encodeURIComponent(where)}`);
        } catch {
          // no location in this environment
        }
        const query = params.length === 0 ? '' : `?${params.join('&')}`;
        bootPromise = fetch(`${RPC_PATH}${query}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then(async (response) => {
            // A failed boot must not become a sticky promise: the next call
            // asks again instead of replaying the same rejection forever.
            const envelope = await response.json().catch(() => null);
            if (envelope?.ok === true) {
              token = envelope.value.token;
              return envelope.value.state;
            }
            if (response.status === 403) throw forbiddenFailure('boot');
            throw new Error(envelope?.error?.message ?? `boot failed (HTTP ${response.status})`);
          })
          .catch((error) => {
            bootPromise = null;
            throw error;
          });
        return bootPromise;
      };
      /**
       * One `state.rpc` call. The token is always obtained from a fresh `GET`
       * first: a bare POST authenticates only through a same-site Fetch-Metadata
       * marker, and hosts that strip browser markers (the desktop shell rewrites
       * them on its own route) answer 403 instead of `FORBIDDEN` in JSON.
       */
      const call = async (method, args) => {
        await boot();
        const response = await fetch(RPC_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dsh-git-graph-token': token ?? '' },
          body: JSON.stringify({ method: 'state.rpc', args: { method, args } }),
        });
        const envelope = await response.json().catch(() => null);
        if (envelope?.ok === true) return envelope.value;
        if (envelope === null || response.status === 403) {
          const error = envelope?.error ?? forbiddenFailure(method);
          const failure = new Error(error.code === 'FORBIDDEN' ? error.message : error.code);
          failure.code = error.code;
          throw failure;
        }
        const error = envelope.error ?? { code: 'phrase', message: 'unknown error' };
        if (error.code === 'FORBIDDEN') {
          // The host restarted (tokens are per load): refresh the token once.
          token = null;
          bootPromise = null;
          await boot();
          return call(method, args);
        }
        const failure = new Error(error.message ?? error.code);
        failure.code = error.code;
        throw failure;
      };
      return { boot, call };
    }

    /**
     * 403 with no JSON envelope: the request never reached this plugin. On the
     * desktop shell that means another route under `/api` shadowed
     * `connection.fetch` (or this build hands out no token), so the failure is
     * named as such instead of surfacing as "unknown error".
     */
    function forbiddenFailure(where) {
      const failure = new Error(`forbidden: ${RPC_PATH} (${where}) was answered by a route other than this plugin`);
      failure.code = 'FORBIDDEN';
      return failure;
    }

    /**
     * Whether the host half answers at all: the one question the page asks
     * before blaming a repository, and the way a dev-server-style client (this
     * bundle is part of the page, not the host process) detects that the host
     * came back after a restart.
     */
    function createAvailability(rpc) {
      let probing = null;
      const probe = () => {
        if (probing !== null) return probing;
        probing = rpc.call('health', {}).then((value) => {
          if (value?.mounted !== true) throw new Error('Git graph host half is not mounted');
          return value;
        }).catch((error) => {
          probing = null;
          throw error;
        });
        return probing;
      };
      return {
        probe,
        forget() { probing = null; },
      };
    }

    /**
     * Session directory as `{ directory, known }`. `known === false` means the
     * sessions snapshot has no row for this id yet (the session is still
     * loading), which must not be treated as "not a repository".
     */
    function readSessionDirectory(props) {
      const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : '';
      if (typeof props?.cwd === 'string' && props.cwd !== '') return { directory: props.cwd, known: true };
      const useSessions = props?.useSessions;
      if (typeof useSessions !== 'function' || sessionId === '') return { directory: '', known: false };
      try {
        // `useSessions` is a selector hook: it takes a selector and returns
        // that selector's value.
        const snapshot = useSessions((state) => state);
        const store = typeof snapshot?.getSnapshot === 'function' ? snapshot.getSnapshot() : snapshot;
        const rows = store?.byId ?? store;
        const row = rows !== null && typeof rows === 'object' ? rows[sessionId] : undefined;
        if (row === undefined || row === null) return { directory: '', known: false };
        return { directory: typeof row.cwd === 'string' ? row.cwd : '', known: true };
      } catch (error) {
        console.warn('[git-graph] reading the session directory failed', error);
        return { directory: '', known: false };
      }
    }

    /** Keep the hook identity stable across renders; the directory is read per render. */
    function useSessionDirectory(props) {
      return readSessionDirectory(props);
    }

    // ------------------------------------------------------------ lane layout

    /**
     * Lane assignment shared by the reference implementations of this view
     * (gitk, Git Extensions, the VS Code Git Graph extensions): walking the
     * rows top-down, each column holds the commit it is still waiting for. The
     * current commit sits in one column, receives every other column waiting
     * for it (merge joins), and its parents continue that column or open new
     * columns to the right (merge forks).
     *
     * Every row reports the segments crossing its **full height** (so a column
     * is one continuous line rather than a dot-to-dot chain) together with the
     * commit each one waits for, which keeps a column's colour constant from
     * row to row, plus the horizontal joins drawn at the node line.
     */

    /**
     * @typedef {{ col: number, parent: string | null }} Lane
     * @typedef {{ col: number, parent: string | null, from: 'top' | 'node', to: 'node' | 'bottom' }} LaneSegment
     * @typedef {{ from: number, to: number }} LaneJoin
     * @typedef {{ col: number, segments: LaneSegment[], joins: LaneJoin[], width: number }} LaneRowData
     */

    /** Column x coordinate. */
    const laneX = (column) => GRAPH_PAD + column * LANE_WIDTH + LANE_WIDTH / 2;

    /**
     * Assign lanes to one page of commits.
     * @param {ReadonlyArray<{ oid: string, parents?: string[] }>} commits
     * @param {ReadonlyArray<Lane>} [startLanes] the previous page's bottom lanes.
     * @returns {{ rows: LaneRowData[], lanes: Lane[] }}
     */
    function computeLanes(commits, startLanes) {
      /** The state *above* the next row: one lane per column, in column order. */
      let lanes = Array.isArray(startLanes) ? startLanes.filter((lane) => lane !== null && lane.parent !== null).map((lane) => ({ parent: lane.parent })) : [];
      const rows = [];

      for (const commit of commits) {
        const parents = Array.isArray(commit.parents) ? commit.parents : [];
        let node = lanes.findIndex((lane) => lane.parent === commit.oid);
        let above = lanes;
        if (node === -1) {
          // A head no column waits for opens a column on the right.
          above = [...lanes, { parent: commit.oid }];
          node = above.length - 1;
        }
        // Columns that continue below: the first parent takes the node column;
        // each extra parent either reuses the column already waiting for it or
        // opens a new one.
        const below = above.map((lane, index) => (index === node ? (parents.length > 0 ? { parent: parents[0] } : { parent: null }) : { parent: lane.parent }));
        const joins = [];
        below.forEach((lane, index) => {
          if (index !== node && lane.parent === commit.oid) {
            // A column that was waiting for this commit ends on the node.
            joins.push({ from: index, to: node });
            lane.parent = null;
          }
        });
        for (const parent of parents.slice(1)) {
          const existing = below.findIndex((lane, index) => index !== node && lane.parent === parent);
          if (existing !== -1) joins.push({ from: node, to: existing });
          else below.push({ parent });
        }
        // Drop unused columns, keeping the node's column where it is when the
        // columns to its right are still in use.
        const keep = [];
        let nodeFinal = 0;
        below.forEach((lane, index) => {
          if (lane.parent === null && index !== node) return;
          if (index === node) nodeFinal = keep.length;
          keep.push(lane);
        });
        const finalLanes = keep.length > 0 ? keep : [{ parent: null }];
        const remap = (index) => {
          if (index === node) return nodeFinal;
          let seen = 0;
          for (let cursor = 0; cursor < below.length; cursor += 1) {
            if (below[cursor].parent === null && cursor !== node) continue;
            if (cursor === index) return seen;
            seen += 1;
          }
          return index;
        };
        const placedJoins = [];
        for (const join of joins) {
          const from = join.from === node ? nodeFinal : remap(join.from);
          const to = join.to === node ? nodeFinal : remap(join.to);
          if (from !== to) placedJoins.push({ from, to: join.from === node ? to : nodeFinal });
        }
        const width = Math.max(above.length, finalLanes.length + 1);
        const segments = [];
        above.forEach((lane, index) => {
          if (index === node) {
            segments.push({ col: index, parent: commit.oid, from: 'node', to: 'node' });
            return;
          }
          segments.push({ col: index, parent: lane.parent, from: 'top', to: 'node' });
        });
        finalLanes.forEach((lane, index) => {
          segments.push({ col: index, parent: lane.parent, from: 'node', to: 'bottom' });
        });
        rows.push({ col: nodeFinal, segments, joins: placedJoins, width });
        lanes = finalLanes.map((lane) => ({ parent: lane.parent }));
      }
      return { rows, lanes: lanes.map((lane, col) => ({ col, parent: lane.parent })) };
    }

    /** The lane area width one row needs. */
    const laneWidth = (row) => GRAPH_PAD * 2 + Math.max(row.width, row.col + 1) * LANE_WIDTH;

    /** A stable colour per column: the colour of the commit the column waits for. */
    function laneColorOf(segment, colorFor) {
      return colorFor(segment?.parent ?? '');
    }

    // One page of a long history: keep the lane count bounded so a repository
    // with hundreds of old branches cannot push the description column away.
    const MAX_LANES = 40;

    /**
     * SVG layer of one row. Verticals run the full row height, joins are
     * smooth splines on the node line, and the node sits on its column: the
     * drawn columns are continuous across rows because every arm of a spline
     * is vertical except at the node line itself.
     *
     * @param {{ row: LaneRowData, colorOf: (parent: string) => string, height: number }} props
     */
    function LaneRow({ row, colorOf, height }) {
      const middle = height / 2;
      const children = [];
      const stroke = { strokeWidth: 1.8, strokeLinecap: 'butt' };
      for (const segment of row.segments) {
        if (segment.col >= MAX_LANES) continue;
        const x = laneX(segment.col);
        const colour = colorOf(segment.parent);
        const y1 = segment.from === 'top' ? 0 : middle;
        const y2 = segment.to === 'bottom' ? height : middle;
        if (y2 > y1) {
          children.push(h('line', { key: `v${segment.col}-${segment.from}-${segment.parent}`, x1: x, y1, x2: x, y2, stroke: colour, ...stroke }));
        }
      }
      for (const join of row.joins) {
        if (join.from >= MAX_LANES || join.to >= MAX_LANES) continue;
        // A spline that leaves vertically, curves on the node line, and enters
        // the target vertically: the standard gitk/Git Extensions join.
        const x1 = laneX(join.from);
        const x2 = laneX(join.to);
        const bend = Math.min(LANE_WIDTH * 0.75, Math.abs(x2 - x1) / 2) || LANE_WIDTH * 0.35;
        const direction = x2 >= x1 ? 1 : -1;
        const d = `M ${x1} 0 C ${x1} ${middle - bend}, ${x2 - direction * bend} ${middle}, ${x2} ${middle} C ${x2} ${middle + bend}, ${x2} ${height}, ${x2} ${height}`;
        children.push(h('path', {
          key: `j${join.from}-${join.to}`,
          d: join.from === join.to ? `M ${x1} 0 L ${x1} ${height}` : d,
          fill: 'none',
          stroke: colorOf(row.segments.find((segment) => segment.col === join.from)?.parent ?? row.segments.find((segment) => segment.col === join.to)?.parent),
          ...stroke,
        }));
      }
      // The node carries the colour of its outgoing parent column (the same
      // column the line below it uses), or of its own commit at a branch tip.
      const below = row.segments.find((segment) => segment.col === row.col && segment.to === 'bottom');
      const nodeColor = colorOf(below?.parent ?? row.segments.find((segment) => segment.col === row.col)?.parent);
      const nodeX = laneX(Math.min(row.col, MAX_LANES - 1));
      children.push(h('circle', { key: 'node', cx: nodeX, cy: middle, r: 3.8, fill: nodeColor, stroke: 'var(--dsw-alias-bg-base)', strokeWidth: 1.5 }));
      const width = laneWidth(row);
      return h('svg', { className: 'dgg-lanes', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': true }, children);
    }

    // ---------------------------------------------------------------- badges

    /** One ref badge: HEAD, local branch, remote-tracking branch, or tag. */
    function RefBadge({ badge }) {
      const label = badge.kind === 'head' ? 'HEAD' : badge.name;
      return h('span', { className: `dgg-badge dgg-badge-${badge.kind}`, title: label },
        h('svg', { className: 'dgg-badge-icon', viewBox: '0 0 10 10', width: 9, height: 9, 'aria-hidden': true },
          badge.kind === 'tag'
            ? h('path', { d: 'M1 1h4.2L9 4.4 5.2 8.2 1 4z', fill: 'currentColor' })
            : h('path', {
              d: 'M4.2 1.2H8a.8.8 0 0 1 .8.8v3.8L4.2 10.4 1.2 7.4z',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.1,
              strokeLinejoin: 'round',
            }),
        ),
        h('span', { className: 'dgg-badge-label' }, label),
      );
    }

    // -------------------------------------------------------------- formatting

    const pad2 = (value) => String(value).padStart(2, '0');

    /** `2026-11-02 21:41`, in the browser's own time zone. */
    function formatDate(ms) {
      const date = new Date(ms);
      if (Number.isNaN(date.getTime())) return '';
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    }

    /** Short hash, independent of the repository's abbreviation settings. */
    const shortHash = (oid) => (typeof oid === 'string' ? oid.slice(0, 8) : '');

    // ---------------------------------------------------------------- diff view

    /** Minimal unified-diff renderer: hunk headers, additions, removals, context. */
    function DiffView({ diff, t }) {
      const rows = useMemo(() => {
        if (!diff) return [];
        const out = [];
        let oldLine = 0;
        let newLine = 0;
        for (const line of diff.split('\n')) {
          if (line.startsWith('@@')) {
            const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
            if (match) {
              oldLine = Number(match[1]);
              newLine = Number(match[2]);
            }
            out.push({ kind: 'hunk', text: line });
          } else if (/^(diff |index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename )/.test(line)) {
            out.push({ kind: 'meta', text: line });
          } else if (line.startsWith('+')) {
            out.push({ kind: 'add', old: '', next: newLine, text: line.slice(1) });
            newLine += 1;
          } else if (line.startsWith('-')) {
            out.push({ kind: 'del', old: oldLine, next: '', text: line.slice(1) });
            oldLine += 1;
          } else if (line.startsWith('\\')) {
            out.push({ kind: 'meta', text: line });
          } else {
            out.push({ kind: 'ctx', old: oldLine, next: newLine, text: line.slice(1) });
            oldLine += 1;
            newLine += 1;
          }
        }
        return out;
      }, [diff]);
      if (rows.length === 0) return h('div', { className: 'dgg-muted dgg-pad' }, t('detail.diffEmpty'));
      return h('table', { className: 'dgg-diff' },
        h('tbody', null, rows.map((row, index) => h('tr', { key: index, className: `dgg-diff-${row.kind}` },
          h('td', { className: 'dgg-diff-num' }, row.old ?? ''),
          h('td', { className: 'dgg-diff-num' }, row.next ?? ''),
          h('td', { className: 'dgg-diff-text' }, row.text === '' ? ' ' : row.text),
        ))),
      );
    }

    // ----------------------------------------------------------- commit detail

    /** Expanded commit pane: hash, metadata, message, changed files, per-file diff. */
    function CommitDetail({ commit, rpc, t, onClose, directory }) {
      const directoryRef = { current: directory ?? '' };
      const [detail, setDetail] = useState(null);
      const [failure, setFailure] = useState(null);
      const [selected, setSelected] = useState(null);
      const [diff, setDiff] = useState(null);
      const [copied, setCopied] = useState(false);
      const [collapsed, setCollapsed] = useState({});

      useEffect(() => {
        let cancelled = false;
        setDetail(null);
        setFailure(null);
        rpc.call('commit', { oid: commit.oid, directory: directoryRef.current }).then((value) => {
          if (!cancelled) setDetail(value);
        }).catch((error) => {
          if (!cancelled) setFailure(error.message ?? String(error));
        });
        return () => { cancelled = true; };
      }, [commit.oid]);

      useEffect(() => {
        if (selected === null) {
          setDiff(null);
          return undefined;
        }
        let cancelled = false;
        setDiff(null);
        rpc.call('diff', { oid: commit.oid, path: selected, directory: directoryRef.current }).then((value) => {
          if (!cancelled) setDiff(value);
        }).catch((error) => {
          if (!cancelled) setDiff({ diff: '', truncated: false, failure: error.message ?? String(error) });
        });
        return () => { cancelled = true; };
      }, [commit.oid, selected]);

      /** Copy one value (hash, parent) to the clipboard. */
      const copy = (text) => () => {
        const done = () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        };
        try {
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => {});
          else done();
        } catch {
          done();
        }
      };

      // Per-file line counts from `git show --numstat` (the tree on the right
      // shows `+n / -n` like a stat view).
      const stats = useMemo(() => {
        const map = new Map();
        for (const file of detail?.files ?? []) map.set(file.path, { add: file.add ?? 0, del: file.del ?? 0 });
        return map;
      }, [detail]);

      const message = detail?.body ?? '';
      const full = detail?.oid ?? commit.oid;
      const parentBadges = commit.parents ?? [];
      const author = detail?.author ?? commit.author;
      const authorEmail = detail?.email ?? commit.email;
      const committer = detail?.committer;
      const committerEmail = detail?.committerEmail;
      const date = formatDate(commit.time);
      const files = detail?.files ?? [];
      const messageTitle = (commit.subject ?? '').trim();

      /** One metadata row: bold label column, selectable value. */
      const metaRow = (label, value, options = {}) => h('div', { className: 'dgg-detail-meta-row' },
        h('span', { className: 'dgg-detail-label' }, label),
        h('span', { className: options.mono ? 'dgg-detail-value dgg-detail-mono' : 'dgg-detail-value' }, value),
        options.copy !== undefined
          ? h('button', { type: 'button', className: 'dgg-icon-btn dgg-detail-copy', title: t('detail.copy'), onClick: copy(options.copy) },
            h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true },
              h('rect', { x: 3, y: 5, width: 8, height: 8, rx: 1.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
              h('path', { d: 'M5.5 3.5h6a1 1 0 0 1 1 1v6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 })))
          : null,
      );

      return h('div', { className: 'dgg-detail', role: 'region', 'aria-label': messageTitle || full },
        // Header: the same columns as the row itself, so the detail lines up
        // with the graph lanes and the table columns.
        h('div', { className: 'dgg-detail-bar' },
          h('span', { className: 'dgg-detail-avatar', 'aria-hidden': true }, (author || '?').trim().charAt(0).toUpperCase()),
          h('span', { className: 'dgg-detail-title', title: messageTitle }, messageTitle || t('detail.message')),
          h('span', { className: 'dgg-detail-badges' },
            (detail?.badges ?? commit.badges ?? []).map((badge) => h(RefBadge, { key: `${badge.kind}:${badge.name}`, badge })),
          ),
          h('span', { className: 'dgg-spacer' }),
          copied ? h('span', { className: 'dgg-muted' }, t('detail.copied')) : null,
          selected !== null
            ? h('button', { type: 'button', className: 'dgg-btn', onClick: () => setSelected(null) }, t('detail.back'))
            : null,
          h('button', { type: 'button', className: 'dgg-icon-btn', title: t('detail.close'), 'aria-label': t('detail.close'), onClick: onClose },
            h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
              h('path', { d: 'M4 4l8 8M12 4l-8 8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))),
        ),
        selected !== null
          ? h('div', { className: 'dgg-detail-diff' },
            h('div', { className: 'dgg-detail-file-head' }, selected),
            h('div', { className: 'dgg-diff-wrap' },
              diff === null
                ? h('div', { className: 'dgg-muted dgg-pad' }, t('detail.loading'))
                : diff.failure !== undefined
                  ? h('div', { className: 'dgg-error' }, diff.failure)
                  : h(React.Fragment, null,
                    h(DiffView, { diff: diff.diff, t }),
                    diff.truncated ? h('div', { className: 'dgg-muted dgg-pad' }, t('detail.diffTruncated')) : null,
                  ),
            ),
          )
          : h('div', { className: 'dgg-detail-body' },
            // Left: the commit metadata Git Extensions shows, one labelled line each.
            h('div', { className: 'dgg-detail-info' },
              metaRow(t('detail.commit'), full, { mono: true, copy: full }),
              metaRow(t('detail.parents'), parentBadges.length > 0
                ? parentBadges.map((parent) => h('button', { key: parent, type: 'button', className: 'dgg-detail-parent', title: parent, onClick: copy(parent) }, parent))
                : '-', { mono: true }),
              metaRow(t('detail.author'), `${author} <${authorEmail ?? ''}>`),
              metaRow(t('detail.committer'), `${committer ?? author} <${committerEmail ?? authorEmail ?? ''}>`),
              metaRow(t('detail.date'), date),
              h('div', { className: 'dgg-detail-message' },
                messageTitle ? h('div', { className: 'dgg-detail-message-title' }, messageTitle) : null,
                message !== '' && message !== messageTitle ? h('pre', { className: 'dgg-detail-message-body' }, message) : null,
                message === '' && detail === null && failure === null ? h('div', { className: 'dgg-muted' }, t('detail.loading')) : null,
              ),
              failure !== null ? h('div', { className: 'dgg-error' }, failure) : null,
            ),
            // Right: the changed-file tree, grouped by directory, each row
            // opening that file's diff in place.
            h('div', { className: 'dgg-detail-files' },
              h('div', { className: 'dgg-detail-files-head' }, t('detail.files', { count: files.length })),
              detail === null
                ? null
                : files.length === 0
                  ? h('div', { className: 'dgg-muted dgg-pad' }, t('detail.noFiles'))
                  : h(FileTree, { files, stats, collapsed, onToggle: (dir) => setCollapsed((current) => ({ ...current, [dir]: !current[dir] })), onOpen: (path) => setSelected(path) }),
            ),
          ),
      );
    }

    /** Group files into a directory tree (`a/b/c.txt` → folder nodes). */
    function buildFileTree(files) {
      const root = { name: '', dirs: new Map(), files: [] };
      for (const file of files) {
        const parts = file.path.split('/');
        let node = root;
        for (const part of parts.slice(0, -1)) {
          if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
          node = node.dirs.get(part);
        }
        node.files.push(file);
      }
      return root;
    }

    /** Render one file-tree level; directories collapse and files open their diff. */
    function FileTree({ files, stats, collapsed, onToggle, onOpen }) {
      const tree = useMemo(() => buildFileTree(files), [files]);
      const renderLevel = (node, depth) => {
        const rows = [];
        for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const full = child.fullName ?? name;
          const isCollapsed = collapsed[full] === true;
          rows.push(h('button', {
            key: `d${full}`,
            type: 'button',
            className: 'dgg-tree-row dgg-tree-dir',
            style: { paddingLeft: `${depth * 14 + 4}px` },
            onClick: () => onToggle(full),
          },
          h('span', { className: 'dgg-tree-caret' }, isCollapsed ? '\u25b8' : '\u25be'),
          h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true },
            h('path', { d: 'M2 4.5c0-.6.4-1 1-1h3.4l1.2 1.4H13c.6 0 1 .4 1 1v5.6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z', fill: 'currentColor', opacity: .75 })),
          h('span', { className: 'dgg-tree-name' }, name)),
          );
          if (!isCollapsed) {
            child.fullName = full;
            rows.push(...renderLevel(child, depth + 1));
          }
        }
        for (const file of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
          const stat = stats.get(file.path) ?? { add: 0, del: 0 };
          rows.push(h('button', {
            key: `f${file.path}`,
            type: 'button',
            className: 'dgg-tree-row dgg-tree-file',
            style: { paddingLeft: `${depth * 14 + 4}px` },
            title: file.path,
            onClick: () => onOpen(file.path),
          },
          h('span', { className: 'dgg-tree-caret' }),
          h('span', { className: `dgg-status dgg-status-${file.status.charAt(0)}` }, file.status.charAt(0)),
          h('span', { className: 'dgg-tree-name' }, file.path.split('/').pop()),
          stat.add > 0 || stat.del > 0
            ? h('span', { className: 'dgg-tree-stat' },
              h('span', { className: 'dgg-stat-add' }, `+${stat.add}`),
              h('span', { className: 'dgg-stat-del' }, `-${stat.del}`))
            : null),
          );
        }
        return rows;
      };
      return h('div', { className: 'dgg-tree' }, renderLevel(tree, 0));
    }

    /** Empty state block. */
    function EmptyState({ title, body }) {
      return h('div', { className: 'dgg-empty' },
        h('div', { className: 'dgg-empty-title' }, title),
        body ? h('div', { className: 'dgg-empty-body' }, body) : null,
      );
    }

    // -------------------------------------------------------------- graph body

    /** The Git Graph tab body. */
    function GitGraphTab(props) {
      const [t, setT] = useState(() => translate(clientContext ?? { get: () => undefined }));
      useEffect(() => {
        const locale = clientContext?.get?.('locale');
        if (typeof locale?.subscribe !== 'function') return undefined;
        const update = () => setT(() => translate(clientContext));
        update();
        return locale.subscribe(update);
      }, []);

      const rpc = useMemo(() => createRpc(), []);
      const availability = useMemo(() => createAvailability(rpc), [rpc]);
      const session = useSessionDirectory(props);
      const directory = session.directory;
      // Probe once per page load: an unreachable host is reported as such, not
      // as a repository problem.
      const [hostError, setHostError] = useState(null);
      useEffect(() => {
        let cancelled = false;
        availability.probe().then(() => {
          if (!cancelled) setHostError(null);
        }).catch((error) => {
          if (!cancelled) setHostError(error);
        });
        return () => { cancelled = true; };
      }, [availability]);
      const directoryRef = useRef(directory);
      directoryRef.current = directory;
      const [boot, setBoot] = useState(null);
      const [bootError, setBootError] = useState(null);
      const [state, setState] = useState(null);
      const [repoInfo, setRepoInfo] = useState(null);
      const [failure, setFailure] = useState(null);
      const [loading, setLoading] = useState(true);
      const [loadingMore, setLoadingMore] = useState(false);
      const [showAll, setShowAll] = useState(true);
      const [branch, setBranch] = useState('');
      const [tags, setTags] = useState(true);
      const [remotes, setRemotes] = useState(true);
      const [expanded, setExpanded] = useState(null);
      const [scrollTop, setScrollTop] = useState(0);
      const [viewport, setViewport] = useState(600);
      const seq = useRef(0);
      const next = useRef({ skip: 0, limit: 200 });
      const scrollRef = useRef(null);

      /** Fetch one page (`reset`) or the next page; failures keep the previous view. */
      const load = useCallback((reset) => {
        const request = seq.current + 1;
        seq.current = request;
        if (reset) {
          next.current = { skip: 0, limit: 200 };
          setLoading(true);
        } else {
          setLoadingMore(true);
        }
        const { skip, limit } = next.current;
        return rpc.call('graph', {
          limit,
          skip,
          tags,
          remotes,
          branches: showAll || branch === '' ? [] : [branch],
          directory: reset ? directoryRef.current : undefined,
        }).then((page) => {
          if (request !== seq.current) return;
          next.current = { skip: skip + page.commits.length, limit: page.limit };
          setState((current) => (reset || current === null
            ? page
            : { ...page, commits: [...current.commits, ...page.commits] }));
          setRepoInfo(page.repo);
          setFailure(null);
        }).catch((error) => {
          if (request !== seq.current) return;
          setFailure(error);
        }).finally(() => {
          if (request !== seq.current) return;
          setLoading(false);
          setLoadingMore(false);
        });
      }, [rpc, showAll, branch, tags, remotes, directory]);

      // Boot (or reboot, when the session moved to another directory), then read the first page.
      // Booting waits until the sessions snapshot knows this session.
      useEffect(() => {
        if (!session.known) return undefined;
        let cancelled = false;
        setState(null);
        setRepoInfo(null);
        setFailure(null);
        setBootError(null);
        rpc.boot(directory, window.location?.pathname ?? '').then((value) => {
          if (cancelled) return;
          setBoot(value);
          setRepoInfo(value?.repo ?? null);
          if (value?.repo) load(true);
          else setLoading(false);
        }).catch((error) => {
          if (cancelled) return;
          setBootError(error);
          setLoading(false);
        });
        return () => { cancelled = true; };
      }, [rpc, directory, session.known]);

      // Reload when a filter changes, after the first boot.
      const filters = useRef(null);
      useEffect(() => {
        if (boot?.repo === null || boot?.repo === undefined) return;
        const key = `${showAll}|${branch}|${tags}|${remotes}`;
        if (filters.current === key) return;
        const first = filters.current === null;
        filters.current = key;
        if (first) return;
        load(true);
      }, [boot, showAll, branch, tags, remotes, load]);

      // Track the visible height for simple virtualization.
      useLayoutEffect(() => {
        const element = scrollRef.current;
        if (element === null) return undefined;
        const measure = () => setViewport(element.clientHeight || 600);
        measure();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(element);
          return () => observer.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, [state === null]);

      const commits = state?.commits ?? [];

      // Lane layout over the whole loaded history, so the columns carried into
      // "load more" are exact and every row's segments line up with its
      // neighbours. Recomputed only when the commit list changes.
      const layout = useMemo(() => computeLanes(commits), [commits]);

      const graphWidth = useMemo(() => {
        let width = 1;
        for (const row of layout.rows) width = Math.max(width, row.width);
        return Math.max(56, Math.min(320, GRAPH_PAD * 2 + Math.min(width, MAX_LANES) * LANE_WIDTH));
      }, [layout]);

      const onScroll = useCallback((event) => {
        const element = event.currentTarget;
        setScrollTop(element.scrollTop);
        if (state !== null && state.hasMore && !loadingMore && element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 6) {
          load(false);
        }
      }, [state, loadingMore, load]);

      const refresh = () => load(true);
      // One colour per commit, hashed: a column keeps its colour while it
      // waits for the same commit and changes only when the history forks.
      const colorOf = (parent) => {
        let hash = 0;
        for (let index = 0; index < (parent ?? '').length; index += 1) hash = (hash * 31 + parent.charCodeAt(index)) | 0;
        return LANE_COLORS[(hash >>> 0) % LANE_COLORS.length];
      };

      const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
      const last = Math.min(commits.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + 10);
      const repo = repoInfo;
      const directoryShown = directory !== '' ? directory : boot?.directory ?? '';
      const localBranches = (state?.refs ?? []).filter((ref) => ref.kind === 'local');
      // Remote-tracking branches are offered too (origin/* etc.). They only
      // come with the graph when the 远程分支 switch is on, but picking one
      // turns into a filter on that ref, so the list follows the checkbox.
      const remoteBranches = (state?.refs ?? [])
        .filter((ref) => ref.kind === 'remote')
        .map((ref) => ref.name)
        .sort((a, b) => a.localeCompare(b));
      const translateError = (error) => {
        if (error?.code && DICT.zh[`error.${error.code}`] !== undefined) return t(`error.${error.code}`);
        return error?.message ?? t('error.unknown');
      };

      const emptyState = (() => {
        if (bootError !== null) {
          // A 403 here means no route answered as this plugin (see
          // `forbiddenFailure`), not that the repository is unreadable.
          return bootError.code === 'FORBIDDEN'
            ? h(EmptyState, { title: t('status.hostDown'), body: t('status.forbiddenHint') })
            : h(EmptyState, { title: t('error.title'), body: translateError({ code: 'network' }) });
        }
        // The session is still loading: say so instead of claiming the
        // directory is not a repository.
        if (!session.known) return h('div', { className: 'dgg-muted dgg-pad' }, t('status.waitingSession'));
        if (hostError !== null) return h(EmptyState, { title: t('status.hostDown'), body: t('status.hostDownHint') });
        if (loading && state === null) return h('div', { className: 'dgg-muted dgg-pad' }, t('status.loading'));
        if (failure !== null && state === null) return h(EmptyState, { title: t('error.title'), body: translateError(failure) });
        // No session directory at all (a session without a workspace): follow
        // the configured / default directory rather than show an error.
        if (session.directory === '' && boot !== null && boot.repo === null && state === null) {
          return h(EmptyState, { title: t('status.noRepo'), body: `${boot.directory}\n\n${t('status.noRepoHint')}` });
        }
        if (boot !== null && boot.repo === null && state === null) {
          const code = boot.error?.code;
          if (code === 'no-git') return h(EmptyState, { title: t('status.noGit'), body: boot.error?.message ?? '' });
          return h(EmptyState, { title: t('status.noRepo'), body: `${boot.directory}\n\n${t('status.noRepoHint')}` });
        }
        if (state !== null && commits.length === 0) return h(EmptyState, { title: t('status.empty'), body: state.repo?.root ?? '' });
        return null;
      })();

      return h('div', { className: 'dgg-root', 'data-dsh-plugin': 'git-graph' },
        h('div', { className: 'dgg-toolbar' },
          h('div', { className: 'dgg-toolbar-row' },
            h('span', { className: 'dgg-repo', title: repo?.root ?? directoryShown },
              h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
                h('path', { d: 'M2 3.5C2 2.7 2.7 2 3.5 2h5.6L14 6.9v5.6c0 .8-.7 1.5-1.5 1.5h-9C2.7 14 2 13.3 2 12.5z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
                h('path', { d: 'M9 2v5h5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }),
              ),
              h('span', { className: 'dgg-repo-name' }, repo?.name ?? t('toolbar.repo')),
            ),
            h('label', { className: 'dgg-field' },
              h('span', { className: 'dgg-field-label' }, t('toolbar.branch')),
              h('select', {
                className: 'dgg-select',
                value: showAll ? '' : branch,
                disabled: boot?.repo === null || boot?.repo === undefined,
                onChange: (event) => {
                  const value = event.target.value;
                  if (value === '') {
                    setShowAll(true);
                  } else {
                    setShowAll(false);
                    setBranch(value);
                  }
                },
              },
              h('option', { value: '' }, t('toolbar.showAll')),
              localBranches.length > 0
                ? h('optgroup', { label: t('toolbar.localBranches') },
                  localBranches.map((ref) => h('option', { key: ref.name, value: ref.name }, ref.name)))
                : null,
              remoteBranches.length > 0
                ? h('optgroup', { label: t('toolbar.remoteBranches') },
                  remoteBranches.map((name) => h('option', { key: name, value: name }, name)))
                : null,
              ),
            ),
            h('label', { className: 'dgg-check' },
              h('input', { type: 'checkbox', checked: remotes, onChange: (event) => setRemotes(event.target.checked) }),
              h('span', null, t('toolbar.remotes')),
            ),
            h('label', { className: 'dgg-check' },
              h('input', { type: 'checkbox', checked: tags, onChange: (event) => setTags(event.target.checked) }),
              h('span', null, t('toolbar.tags')),
            ),
            h('span', { className: 'dgg-spacer' }),
            h('button', { type: 'button', className: 'dgg-icon-btn', title: t('toolbar.refresh'), 'aria-label': t('toolbar.refresh'), onClick: refresh },
              h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
                h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              )),
          ),
          repo !== null || state !== null
            ? h('div', { className: 'dgg-status-line' },
              [
                repo?.branch ? repo.branch : repo?.detached ? t('status.detached') : '',
                t('status.loaded', { count: commits.length }),
                state?.hasMore ? '+' : '',
                failure !== null && state !== null ? translateError(failure) : '',
              ].filter(Boolean).join(' · '))
            : null,
        ),
        emptyState !== null
          ? emptyState
          : h('div', { className: 'dgg-table', role: 'table', 'aria-label': t('tab.title') },
            h('div', { className: 'dgg-thead', role: 'row', style: { '--dgg-graph-width': `${graphWidth}px` } },
              h('span', { role: 'columnheader', className: 'dgg-th' }, t('col.graph')),
              h('span', { role: 'columnheader', className: 'dgg-th' }, t('col.description')),
              h('span', { role: 'columnheader', className: 'dgg-th dgg-th-muted' }, t('col.date')),
              h('span', { role: 'columnheader', className: 'dgg-th dgg-th-muted' }, t('col.author')),
              h('span', { role: 'columnheader', className: 'dgg-th dgg-th-muted' }, t('col.commit')),
            ),
            h('div', { className: 'dgg-rows', ref: scrollRef, onScroll },
              h('div', { className: 'dgg-rows-inner', style: { height: commits.length * ROW_HEIGHT } },
                commits.slice(first, last).map((commit, offset) => {
                  const index = first + offset;
                  const row = layout.rows[index];
                  if (row === undefined) return null;
                  const isOpen = expanded === commit.oid;
                  return h('div', {
                    key: `${commit.oid}-${index}`,
                    className: 'dgg-row-group',
                    style: { top: index * ROW_HEIGHT, '--dgg-graph-width': `${graphWidth}px` },
                  },
                  h('div', {
                    role: 'row',
                    className: `dgg-row${isOpen ? ' dgg-row-open' : ''}`,
                    tabIndex: 0,
                    'aria-expanded': isOpen,
                    onClick: () => setExpanded(isOpen ? null : commit.oid),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setExpanded(isOpen ? null : commit.oid);
                      }
                    },
                  },
                  h('span', { className: 'dgg-cell dgg-cell-graph' },
                    h(LaneRow, { row, colorOf, height: ROW_HEIGHT })),
                  h('span', { className: 'dgg-cell dgg-cell-desc' },
                    (commit.badges ?? []).length > 0
                      ? h('span', { className: 'dgg-badges' },
                        commit.badges.map((badge) => h(RefBadge, { key: `${badge.kind}:${badge.name}`, badge })))
                      : null,
                    h('span', { className: 'dgg-subject', title: commit.subject }, commit.subject || '-'),
                  ),
                  h('span', { className: 'dgg-cell dgg-cell-muted' }, formatDate(commit.time)),
                  h('span', { className: 'dgg-cell dgg-cell-muted dgg-cell-author', title: commit.email }, commit.author),
                  h('span', { className: 'dgg-cell dgg-cell-muted dgg-cell-hash', title: commit.oid }, shortHash(commit.oid)),
                  ),
                  isOpen ? h(CommitDetail, { commit, rpc, t, directory, onClose: () => setExpanded(null) }) : null,
                  );
                }),
                state?.hasMore
                  ? h('div', { className: 'dgg-more', style: { position: 'absolute', left: 0, right: 0, top: commits.length * ROW_HEIGHT } },
                    h('button', { type: 'button', className: 'dgg-btn', disabled: loadingMore, onClick: () => load(false) },
                      loadingMore ? t('status.loading') : t('status.more')))
                  : null,
              ),
            ),
          ),
      );
    }

    // ------------------------------------------------------------ tab chrome

    /** Tab title cell: icon plus localized label. */
    function GitGraphTitle() {
      const t = useMemo(() => translate(clientContext ?? { get: () => undefined }), []);
      return h('span', { className: 'dgg-tab-title' },
        h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
          h('path', { d: 'M4 4v8M4 8h4a3 3 0 0 0 3-3V4M4 8h4a3 3 0 0 1 3 3v1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
          h('circle', { cx: 4, cy: 3.4, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 4, cy: 12.6, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 11, cy: 3.4, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 11, cy: 12.6, r: 1.5, fill: 'currentColor' }),
        ),
        h('span', null, t('tab.title')),
      );
    }

    /**
     * Read one Client service from a context or an injected scope. The shell
     * keeps its right-sidebar tab types in `sidebarRightTabs` and opens one
     * with `sidebarRight.openTab(kind)`; both are optional here.
     */
    function readService(source, key) {
      try {
        if (typeof source?.get === 'function') {
          const value = source.get(key);
          if (value !== undefined) return value;
        }
      } catch {
        // not mounted
      }
      try {
        return source?.[key];
      } catch {
        return undefined;
      }
    }

    /**
     * Session-header launcher for the Graph tab: opens the tab through the
     * right sidebar's own registry (`sidebarRight.openTab`).
     */
    function GitGraphLauncher() {
      const t = useMemo(() => translate(clientContext ?? { get: () => undefined }), []);
      const openGraph = () => {
        try {
          const sidebarRight = readService(clientContext, 'sidebarRight');
          if (typeof sidebarRight?.openTab === 'function') {
            sidebarRight.openTab(TAB_KIND);
            return;
          }
          const layout = readService(clientContext, 'layout');
          if (typeof layout?.openRightbar === 'function') layout.openRightbar(true, false);
        } catch (error) {
          console.warn('[git-graph] opening the graph tab failed', error);
        }
      };
      return h('span', { className: 'dgg-launcher' },
        h('button', {
          type: 'button',
          className: 'dgg-icon-btn',
          title: t('launcher.label'),
          'aria-label': t('launcher.label'),
          onClick: openGraph,
        },
        h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
          h('path', { d: 'M4 4v8M4 8h4a3 3 0 0 0 3-3V4M4 8h4a3 3 0 0 1 3 3v1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
          h('circle', { cx: 4, cy: 3.4, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 4, cy: 12.6, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 11, cy: 3.4, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 11, cy: 12.6, r: 1.5, fill: 'currentColor' }),
        )),
      );
    }

    // ------------------------------------------------------------------- error boundary

    /** Keeps a render failure from blanking the host slot. */
    class Guard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false, reason: '' };
      }

      static getDerivedStateFromError(error) {
        // Keep the message: a blank boundary hides exactly the information a
        // user needs to report a crash, and hides it from the one place that
        // shows the error.
        return { failed: true, reason: error?.message ?? String(error ?? '') };
      }

      componentDidCatch(error) {
        console.error('[git-graph] view crashed', error);
      }

      render() {
        if (this.state.failed) {
          const t = translate(clientContext ?? { get: () => undefined });
          return h('div', { className: 'dgg-root' },
            h(EmptyState, {
              title: t('error.title'),
              body: this.state.reason ? `${t('error.unknown')}\n\n${this.state.reason}` : t('error.unknown'),
            }));
        }
        return this.props.children;
      }
    }

    // ---------------------------------------------------------- branch chip

    /**
     * Popover geometry (viewport-fixed, because the composer dock clips
     * overflow). Wide enough for long `feat(chat): …` branch names without a
     * mid-word cut, and the list keeps a readable height above the footer.
     */
    const POPOVER_WIDTH = 360;
    const POPOVER_MAX_HEIGHT = 460;
    const POPOVER_MIN_HEIGHT = 240;
    /** Smallest height still worth showing when neither side is roomy. */
    const POPOVER_COMPACT_HEIGHT = 200;
    const POPOVER_GAP = 6;
    const POPOVER_MARGIN = 8;
    /** Placement of a popover that has committed but not been measured yet. */
    const MEASURE_STYLE = { left: 0, top: 0, width: POPOVER_WIDTH, maxHeight: POPOVER_COMPACT_HEIGHT, visibility: 'hidden' };

    /** How often the chip re-reads the branch state, plus a debounced refresh on window focus. */
    const CHIP_POLL_MS = 20000;
    const CHIP_FOCUS_DEBOUNCE_MS = 1500;

    /**
     * Branch state for the session's directory, polled while the chip is
     * mounted. Stale answers are dropped, so overlapping polls never flash an
     * older branch back after a switch.
     *
     * @param {ReturnType<typeof createRpc>} rpc
     * @param {string} directory - the open session's working directory ('' when there is none).
     */
    function useBranchState(rpc, directory) {
      const [state, setState] = useState(null);
      const [failure, setFailure] = useState(null);
      const seq = useRef(0);
      const refresh = useCallback(() => {
        if (directory === '') {
          setState(null);
          return Promise.resolve(null);
        }
        const request = seq.current + 1;
        seq.current = request;
        return rpc.call('status', { directory }).then((value) => {
          if (request === seq.current) {
            setState(value);
            setFailure(null);
          }
          return value;
        }).catch((error) => {
          if (request === seq.current) {
            // "not a repository" is an answer, not a failure: the chip stays hidden.
            setState(null);
            setFailure(error);
          }
          return null;
        });
      }, [rpc, directory]);

      useEffect(() => {
        if (directory === '') {
          setState(null);
          return undefined;
        }
        refresh();
        const timer = window.setInterval(refresh, CHIP_POLL_MS);
        let focusTimer = 0;
        const onFocus = () => {
          window.clearTimeout(focusTimer);
          focusTimer = window.setTimeout(refresh, CHIP_FOCUS_DEBOUNCE_MS);
        };
        window.addEventListener('focus', onFocus);
        return () => {
          window.clearInterval(timer);
          window.clearTimeout(focusTimer);
          window.removeEventListener('focus', onFocus);
        };
      }, [refresh, directory]);

      return { state, failure, refresh };
    }

    /**
     * Render `children` in the document body while keeping React context and
     * event bubbling through the caller's tree.
     *
     * The composer keeps its own compositor layer (`will-change: transform`),
     * which makes it the containing block for `position: fixed` descendants:
     * a viewport-fixed overlay rendered inside a composer slot is positioned
     * against the composer box and clipped to it. The host's own rule for
     * `conversation.input.*` slots is to portal such overlays to the body, so
     * the measured viewport coordinates mean what they say.
     */
    function Portal({ children }) {
      // The popover is opened by a click, long after mount: the body is read on
      // every render so the very render that opens it already ports its
      // children (reading it only in an effect would leave one frame without
      // the popover, and the frame after the opening click is exactly the one
      // that shows it).
      const host = typeof document !== 'undefined' && document.body ? document.body : null;
      if (createPortal === null || host === null) return children;
      return createPortal(children, host);
    }

    /**
     * The branch chip in the composer tool row (left of the model selector):
     * the current branch, a searchable local branch list that switches the
     * checkout, fetch, and the graph tab.
     */
    function BranchChip(props) {
      const t = useMemo(() => translate(clientContext ?? { get: () => undefined }), []);
      const rpc = useMemo(() => createRpc(), []);
      const session = useSessionDirectory(props);
      const directory = session.directory;
      const { state, refresh } = useBranchState(rpc, directory);
      const [open, setOpen] = useState(false);
      // Reads the live open state, so the outside-pointer handler never acts on
      // a stale closure while the popover is being mounted.
      const openRef = useRef(false);
      openRef.current = open;
      /** Close from anywhere the popover dismisses itself (Escape, outside click, actions). */
      const closePopover = useCallback(() => {
        openRef.current = false;
        setOpen(false);
      }, []);
      const [query, setQuery] = useState('');
      const [busy, setBusy] = useState('');
      const [notice, setNotice] = useState(null);
      const anchorRef = useRef(null);
      const popRef = useRef(null);
      const searchRef = useRef(null);

      // Hidden where there is nothing to switch: no session directory, or not
      // inside a repository.
      const visible = session.known && directory !== '' && state !== null;
      useEffect(() => {
        if (!visible && open) setOpen(false);
      }, [visible, open]);

      /**
       * Place the popover from the chip's live rect. Pure DOM work: it writes
       * the popover's own inline style instead of updating React state, so a
       * measurement can never schedule a render. (Feeding a measured size back
       * into state is the render → measure → re-render loop of React #185.)
       */
      const onLayout = useCallback(() => {
        const anchor = anchorRef.current?.getBoundingClientRect?.();
        const node = popRef.current;
        if (!anchor || !node) return;
        const width = Math.min(POPOVER_WIDTH, Math.max(220, window.innerWidth - POPOVER_MARGIN * 2));
        const left = Math.max(POPOVER_MARGIN, Math.min(anchor.left, window.innerWidth - width - POPOVER_MARGIN));
        const roomAbove = anchor.top - POPOVER_GAP - POPOVER_MARGIN;
        const roomBelow = window.innerHeight - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
        // Prefer the side with room for the whole popover, then the taller
        // side, and at worst a compact box: a sliver that hides every branch
        // behind the fold is worse than a short scrollable list.
        const up = roomAbove >= POPOVER_MIN_HEIGHT || (roomBelow < POPOVER_MIN_HEIGHT && roomAbove >= roomBelow);
        const room = Math.min(POPOVER_MAX_HEIGHT, up ? roomAbove : roomBelow);
        const style = node.style;
        style.left = `${left}px`;
        style.width = `${width}px`;
        style.maxWidth = `min(${width}px, calc(100vw - 32px))`;
        style.maxHeight = `${Math.max(POPOVER_COMPACT_HEIGHT, room)}px`;
        style.bottom = up ? `${window.innerHeight - anchor.top + POPOVER_GAP}px` : '';
        style.top = up ? '' : `${anchor.bottom + POPOVER_GAP}px`;
        style.visibility = '';
      }, []);
      // Open: close on Escape or on a click outside, and focus the search box.
      useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            closePopover();
          }
        };
        // The popover is portaled to the body (the composer is the containing
        // block for fixed descendants), so a click outside both it and the
        // chip closes it. Renderer differences after mount are covered by the
        // containment test against the chip: only a click on neither counts.
        const openedAt = Date.now();
        const onPointer = (event) => {
          if (Date.now() - openedAt < 150) return; // the click that opened it
          const target = event.target;
          const insideChip = anchorRef.current?.contains(target) === true;
          const insidePop = popRef.current?.contains(target) === true;
          if (!insideChip && !insidePop) closePopover();
        };
        window.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onPointer, true);
        window.addEventListener('resize', onLayout);
        const focusTimer = window.setTimeout(() => searchRef.current?.focus?.(), 0);
        return () => {
          window.removeEventListener('keydown', onKey, true);
          document.removeEventListener('mousedown', onPointer, true);
          window.removeEventListener('resize', onLayout);
          window.clearTimeout(focusTimer);
        };
      }, [open, onLayout, closePopover]);

      // The popover mounts into a body portal; keep the node it mounted so a
      // size change can re-anchor it, and drop it when the popover closes.
      // Position right after the popover commits (its node exists then).
      useLayoutEffect(() => {
        if (open) onLayout();
      }, [open, onLayout]);
      // Keep the popover under the chip when the window resizes or the chip
      // itself moves (the composer grows with the draft). Positioning writes
      // its inline style directly: a measurement never schedules a render, so
      // nothing here can feed back into itself.
      useLayoutEffect(() => {
        if (!open) return undefined;
        const onResize = () => onLayout();
        window.addEventListener('resize', onResize);
        const chipHost = anchorRef.current?.parentElement ?? null;
        const observer = typeof ResizeObserver === 'function' && chipHost !== null ? new ResizeObserver(onResize) : null;
        observer?.observe(chipHost ?? document.body);
        return () => {
          window.removeEventListener('resize', onResize);
          observer?.disconnect();
        };
      }, [open, onLayout]);

      if (!visible) return null;

      const current = state.branch || (state.detached ? t('chip.detached') : state.unborn ? t('chip.unborn') : '');
      const dirtyText = state.conflicts > 0
        ? t('chip.conflicts', { count: state.conflicts })
        : state.dirty > 0 ? t('chip.dirty', { count: state.dirty }) : t('chip.clean');
      const needle = query.trim().toLowerCase();
      const allBranches = (state.branches ?? []).map((entry) => entry.name);
      const branches = allBranches
        .filter((name) => needle === '' || name.toLowerCase().includes(needle))
        // The checked-out branch first, so a long list never hides the answer
        // to "which branch am I on?" behind the fold; the rest stay in the
        // host's order (git's, i.e. alphabetical for refs).
        .sort((a, b) => (a === state.branch ? -1 : 0) - (b === state.branch ? -1 : 0));
      const remotes = state.remotes ?? [];

      /** One switch; the popover stays open on failure so the reason is readable. */
      const runSwitch = (branch) => {
        if (busy !== '') return;
        setBusy(branch);
        setNotice(null);
        rpc.call('switch', { directory, branch })
          .then(() => {
            setNotice({ kind: 'ok', text: t('chip.switched', { branch }) });
            setQuery('');
            window.setTimeout(() => setOpen(false), 900);
            return refresh();
          })
          .catch((error) => setNotice({ kind: 'error', text: translateError(error) }))
          .finally(() => setBusy(''));
      };

      const fetchRemotes = () => {
        if (busy !== '') return;
        setBusy('fetch');
        setNotice({ kind: 'info', text: t('chip.fetching') });
        rpc.call('fetch', { directory, from: 'chip' })
          .then(() => {
            setNotice({ kind: 'ok', text: t('chip.fetched') });
            return refresh();
          })
          .catch((error) => setNotice({ kind: 'error', text: translateError(error) }))
          .finally(() => setBusy(''));
      };

      const openGraph = () => {
        try {
          const sidebarRight = readService(clientContext, 'sidebarRight');
          if (typeof sidebarRight?.openTab === 'function') sidebarRight.openTab(TAB_KIND);
        } catch (error) {
          console.warn('[git-graph] opening the graph tab failed', error);
        }
        setOpen(false);
      };

      // Shown when the list is filtered: how many match, and how many the
      // filter hides, so a truncated list never looks like the whole list.
      const listHint = needle === ''
        ? t('chip.count', { count: allBranches.length })
        : branches.length === 0
          ? t('chip.empty')
          : branches.length < allBranches.length
            ? t('chip.count', { count: branches.length }) + ' · ' + t('chip.more', { count: allBranches.length - branches.length })
            : t('chip.count', { count: branches.length });

      const HEAD_ICON = h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 3, fill: 'currentColor' }),
        h('path', { d: 'M8 1v3M8 12v3M1 8h3M12 8h3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }));

      // The popover is rendered whenever it is open: its placement is computed
      // synchronously from the chip, and self-corrected once mounted. Gating the
      // render on a measured placement left the slot empty for a frame every
      // time it opened, and any failure to measure (the chip unmounting, a
      // transformed ancestor) meant no popover at all.
      const popover = open
        ? h(Portal, null, h('div', {
          ref: (node) => {
            popRef.current = node;
          },
          className: 'dgg-pop',
          role: 'dialog',
          'aria-label': t('chip.switch'),
          // Positioned by the layout effect right after this commit; until
          // then it waits invisible instead of flashing at the origin.
          style: MEASURE_STYLE,
        },
          // 1. Where am I: branch (full name, wraps instead of clipping),
          //    repository, HEAD, remote count, working-tree state.
          h('div', { className: 'dgg-pop-head' },
            h('div', { className: 'dgg-pop-current' },
              HEAD_ICON,
              h('code', { className: 'dgg-pop-branch', title: `${current}\n${state.root}` }, current || '-'),
              state.unborn || state.detached ? null : h('span', { className: 'dgg-pop-repo', title: state.root }, state.name ?? ''),
            ),
            h('span', {
              className: state.operationInProgress || state.conflicts > 0 ? 'dgg-warn dgg-pop-status' : 'dgg-muted dgg-pop-status',
            }, state.operationInProgress ? t('chip.operation', { name: state.operation ?? '' }) : dirtyText),
          ),
          h('div', { className: 'dgg-pop-meta dgg-muted' },
            state.head ? h('span', { className: 'dgg-pop-meta-item', title: state.head }, `${t('chip.head')} ${String(state.head).slice(0, 7)}`) : null,
            h('span', { className: 'dgg-pop-meta-item' }, remotes.length === 0 ? t('chip.noRemotes') : remotes.map((name) => name).join(' · ')),
          ),
          // 2. Filter, inside the body so the list keeps its height.
          h('div', { className: 'dgg-pop-body' },
            h('input', {
              ref: searchRef,
              className: 'dgg-search',
              type: 'search',
              value: query,
              placeholder: t('chip.search'),
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && branches.length > 0) runSwitch(branches[0]);
              },
            }),
            // 3. Branches: current first, full names with a hover title.
            h('ul', { className: 'dgg-branch-list', role: 'listbox', 'aria-label': t('chip.switch') },
              branches.map((name) => h('li', { key: name, role: 'option', 'aria-selected': name === state.branch },
                h('button', {
                  type: 'button',
                  className: `dgg-branch${name === state.branch ? ' dgg-branch-current' : ''}`,
                  disabled: busy !== '' && busy !== name,
                  title: name,
                  onClick: () => (name === state.branch ? setOpen(false) : runSwitch(name)),
                },
                h('span', { className: 'dgg-branch-check' }, name === state.branch ? '\u2713' : ''),
                h('span', { className: 'dgg-branch-name' }, name),
                busy === name ? h('span', { className: 'dgg-branch-busy', 'aria-hidden': true }, '…') : null),
              )),
              branches.length === 0
                ? h('li', { className: 'dgg-muted dgg-pad' }, t('chip.empty'))
                : null,
            ),
          ),
          h('div', { className: 'dgg-pop-count dgg-muted' }, listHint),
          notice !== null
            ? h('div', { className: `dgg-notice dgg-notice-${notice.kind}` }, notice.text)
            : null,
          // 4. Actions: short labels with icons, one row even at the floor width.
          h('div', { className: 'dgg-pop-foot' },
            h('button', { type: 'button', className: 'dgg-pop-action', disabled: busy !== '', onClick: fetchRemotes, title: t('chip.fetch') },
              h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
                h('path', { d: 'M8 13V3.5M4.5 7 8 3.5 11.5 7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })),
              h('span', { className: 'dgg-pop-action-label' }, busy === 'fetch' ? t('chip.fetching') : t('chip.fetch'))),
            h('button', { type: 'button', className: 'dgg-pop-action', onClick: openGraph, title: t('chip.graph') },
              h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
                h('path', { d: 'M4 4v8M4 8h4a3 3 0 0 0 3-3V4M4 8h4a3 3 0 0 1 3 3v1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
                h('circle', { cx: 4, cy: 3.4, r: 1.4, fill: 'currentColor' }),
                h('circle', { cx: 4, cy: 12.6, r: 1.4, fill: 'currentColor' }),
                h('circle', { cx: 11, cy: 3.4, r: 1.4, fill: 'currentColor' })),
              h('span', { className: 'dgg-pop-action-label' }, t('chip.graph'))),
          ),
        ))
        : null;

      return h('div', { className: 'dgg-chip-wrap', ref: anchorRef },
        h('button', {
          type: 'button',
          className: `dgg-chip${open ? ' dgg-chip-open' : ''}`,
          title: `${current}\n${state.root}\n${dirtyText}`,
          'aria-label': t('chip.switch'),
          'aria-expanded': open,
          onClick: () => {
            if (openRef.current) {
              closePopover();
              return;
            }
            // Flip the flag and let the committed popover measure itself. No
            // positioning work runs during this render: state updates from a
            // handler's render pass are legal, layout reads and renders inside
            // one are not, and a throw here would replace the whole chip with
            // the error boundary.
            openRef.current = true;
            setOpen(true);
          },
        },
        h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
          h('path', { d: 'M4.5 4.2v7.6M4.5 8h4A2.5 2.5 0 0 0 11 5.5V4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
          h('circle', { cx: 4.5, cy: 3.4, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 4.5, cy: 12.6, r: 1.5, fill: 'currentColor' }),
          h('circle', { cx: 11, cy: 3.4, r: 1.5, fill: 'currentColor' }),
        ),
        h('span', { className: 'dgg-chip-label' }, current || '-'),
        state.dirty > 0 || state.conflicts > 0
          ? h('span', { className: 'dgg-chip-dot', 'aria-hidden': true })
          : null,
        h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, 'aria-hidden': true },
          h('path', { d: 'M4 6.5 8 10.5l4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        )),
        popover,
      );
    }

    /** Localized copy for an error code the host returns. */
    function translateError(error) {
      const code = error?.code;
      if (typeof code === 'string' && DICT.zh[`error.${code}`] !== undefined) {
        return translate(clientContext ?? { get: () => undefined })(`error.${code}`);
      }
      return error?.message ?? String(error ?? '');
    }

    // ------------------------------------------------------------------- styles

    const CSS = [
      '.dgg-root{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:12px;}',
      '.dgg-toolbar{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 8px;background:var(--dsw-alias-bg-layer-1);}',
      '.dgg-toolbar-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;}',
      '.dgg-repo{display:inline-flex;align-items:center;gap:4px;font-weight:600;min-width:0;max-width:45%;color:var(--dsw-alias-label-primary);}',
      '.dgg-repo-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dgg-field{display:inline-flex;align-items:center;gap:4px;min-width:0;}',
      '.dgg-field-label{color:var(--dsw-alias-label-secondary);}',
      '.dgg-select{max-width:200px;height:24px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;padding:0 4px;}',
      '.dgg-check{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;}',
      '.dgg-check input{margin:0;accent-color:var(--dsw-alias-brand-primary);}',
      '.dgg-spacer{flex:1 1 auto;}',
      '.dgg-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}',
      '.dgg-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dgg-icon-btn:disabled{opacity:.5;cursor:default;}',
      '.dgg-btn{height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;white-space:nowrap;}',
      '.dgg-btn:hover{border-color:var(--dsw-alias-border-l2);}',
      '.dgg-btn:disabled{opacity:.6;cursor:default;}',
      '.dgg-status-line{color:var(--dsw-alias-label-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-top:4px;}',
      '.dgg-table{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;}',
      '.dgg-thead{display:grid;grid-template-columns:var(--dgg-graph-width,80px) minmax(0,1fr) 108px 88px 76px;align-items:center;gap:6px;flex:none;height:24px;padding:0 6px 0 0;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-weight:600;}',
      '.dgg-th{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dgg-th:nth-child(2){padding-left:8px;}',
      '.dgg-rows{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;position:relative;}',
      '.dgg-rows-inner{position:relative;min-width:max-content;}',
      '.dgg-row-group{position:absolute;left:0;right:0;}',
      '.dgg-row{display:grid;grid-template-columns:var(--dgg-graph-width,80px) minmax(0,1fr) 108px 88px 76px;align-items:center;gap:6px;height:28px;padding:0 6px 0 0;cursor:pointer;outline:none;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 55%,transparent);}',
      '.dgg-row:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.dgg-row:focus-visible{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);}',
      '.dgg-row-open{background:var(--dsw-alias-bg-layer-1);}',
      '.dgg-cell{display:flex;align-items:center;min-width:0;overflow:hidden;}',
      '.dgg-cell-graph{overflow:visible;height:28px;justify-content:flex-start;align-self:stretch;}',
      '.dgg-cell-graph .dgg-lanes{height:100%;}',
      '.dgg-lanes{display:block;overflow:visible;flex:none;}',
      '.dgg-lanes line,.dgg-lanes path{shape-rendering:geometricPrecision;}',
      // Badges are part of the description: they stay visible and the subject
      // shrinks around them. A subject that shrank first would take the whole
      // cell and leave the remote/tag badges cut off at the right edge.
      '.dgg-cell-desc{gap:4px;white-space:nowrap;padding-left:8px;flex:1 1 auto;min-width:0;}',
      '.dgg-badges{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;min-width:0;}',
      '.dgg-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0;padding-left:2px;color:var(--dsw-alias-label-primary);}',
      '.dgg-cell-muted{padding-left:4px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;text-overflow:ellipsis;}',
      '.dgg-cell-hash{font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;}',
      '.dgg-badge{display:inline-flex;align-items:center;flex:none;gap:3px;height:17px;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:15px;max-width:88px;}',
      // A squeezed badge shortens its label instead of overlapping the next one.
      '.dgg-badges > .dgg-badge{flex:0 1 auto;min-width:0;}',
      '.dgg-badge-icon{flex:none;display:block;}',
      '.dgg-badge-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}',
      '.dgg-badge-head{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600;}',
      '.dgg-badge-local{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dgg-badge-remote{background:transparent;color:#2f7de1;border-color:#2f7de180;}',
      '.dgg-badge-tag{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);}',
      'body[data-ds-dark-theme] .dgg-badge-remote{color:#6cb0ff;border-color:#6cb0ff80;}',
      // ---- commit detail (two panes: metadata left, changed-file tree right)
      '/* Opaque surface: the detail pane is absolutely positioned over the virtualised rows, so a translucent theme layer would let the graph show through. */',
      '.dgg-detail{position:absolute;left:0;top:0;right:0;z-index:2;margin:0;padding:10px 12px 12px;background:var(--dsw-alias-bg-base);background-color:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:12px;cursor:default;}',
      '.dgg-detail-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px;min-width:0;}',
      '.dgg-detail-avatar{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;flex:none;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600;}',
      '.dgg-detail-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;min-width:0;}',
      '.dgg-detail-badges{display:inline-flex;align-items:center;gap:4px;min-width:0;overflow:hidden;}',
      '.dgg-detail-body{display:grid;grid-template-columns:minmax(0,3fr) minmax(180px,2fr);gap:16px;align-items:start;}',
      '@media (max-width:560px){.dgg-detail-body{grid-template-columns:minmax(0,1fr);}}',
      '.dgg-detail-info{display:flex;flex-direction:column;gap:3px;min-width:0;}',
      '.dgg-detail-meta-row{display:flex;align-items:baseline;gap:8px;min-width:0;line-height:18px;}',
      '.dgg-detail-label{flex:none;width:66px;color:var(--dsw-alias-label-secondary);font-weight:600;}',
      '.dgg-detail-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);}',
      '.dgg-detail-mono .dgg-detail-value{font-family:var(--dsw-font-family-code,ui-monospace,monospace);font-size:11px;}',
      '.dgg-detail-copy{width:18px;height:18px;flex:none;}',
      '.dgg-detail-parent{border:0;background:transparent;padding:0;margin-right:8px;cursor:pointer;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,monospace);font-size:11px;text-decoration:underline dotted;text-underline-offset:2px;}',
      '.dgg-detail-parent:hover{color:var(--dsw-alias-brand-primary);}',
      '.dgg-detail-message{margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:6px;}',
      '.dgg-detail-message-title{font-weight:600;}',
      '.dgg-detail-message-body{margin:0;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;font-family:var(--dsw-font-family,inherit);font-size:12px;color:var(--dsw-alias-label-primary);}',
      '/* The card itself scrolls and clamps its height, so the message, the file tree and a diff never outgrow it. */',
      '.dgg-detail{max-height:min(70vh,720px);overflow:auto;overscroll-behavior:contain;}',
      '.dgg-detail-files{min-width:0;border-left:1px solid var(--dsw-alias-border-l1);padding-left:14px;max-height:320px;overflow:auto;}',
      '@media (max-width:560px){.dgg-detail-files{border-left:0;padding-left:0;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;}}',
      '.dgg-detail-files-head{color:var(--dsw-alias-label-secondary);font-weight:600;margin-bottom:4px;}',
      '.dgg-tree{display:flex;flex-direction:column;}',
      '.dgg-tree-row{display:flex;align-items:center;gap:4px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;padding:1px 2px;border-radius:4px;cursor:pointer;min-width:0;line-height:18px;}',
      '.dgg-tree-row:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.dgg-tree-caret{flex:none;width:10px;color:var(--dsw-alias-label-secondary);font-size:10px;text-align:center;}',
      '.dgg-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}',
      '.dgg-tree-dir{color:var(--dsw-alias-label-secondary);}',
      '.dgg-tree-file .dgg-tree-name{font-family:var(--dsw-font-family-code,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-primary);}',
      '.dgg-tree-stat{margin-left:auto;flex:none;display:inline-flex;gap:6px;font-family:var(--dsw-font-family-code,ui-monospace,monospace);font-size:11px;}',
      '.dgg-stat-add{color:var(--dsw-alias-state-success-primary);}',
      '.dgg-stat-del{color:var(--dsw-alias-state-error-primary);}',
      '.dgg-detail-diff{display:flex;flex-direction:column;gap:6px;}',
      '.dgg-diff-wrap{min-width:0;max-height:min(60vh,520px);overflow:auto;}',
      '.dgg-detail-file-head{font-family:var(--dsw-font-family-code,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dgg-pad{padding:8px;}',
      '.dgg-muted{color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.dgg-error{margin:0 8px 8px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;}',
      '.dgg-detail .dgg-error{margin:4px 0 0;}',
      '.dgg-empty{margin:auto;max-width:420px;padding:24px 16px;text-align:center;}',
      '.dgg-empty-title{font-weight:600;margin-bottom:6px;}',
      '.dgg-empty-body{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;}',
      '.dgg-more{display:flex;justify-content:center;padding:8px;}',
      '.dgg-tab-title{display:inline-flex;align-items:center;gap:4px;min-width:0;}',
      '.dgg-launcher{display:inline-flex;align-items:center;}',
      // Branch chip under the composer
      '.dgg-chip-wrap{position:relative;display:inline-flex;align-items:center;max-width:100%;min-width:0;}',
      '.dgg-chip{display:inline-flex;align-items:center;gap:5px;max-width:200px;height:24px;padding:0 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;}',
      '.dgg-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dgg-chip:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);}',
      '.dgg-chip-open{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);}',
      '.dgg-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dgg-chip-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none;}',
      // The popover is a column: fixed head, a body that takes the remaining
      // height (search + scrollable list), the count line, the notice, and the
      // footer. Its height is the measured placement, so it grows with content
      // up to POPOVER_MAX_HEIGHT instead of letting the footer drift out of
      // the clamped box.
      '.dgg-pop{position:fixed;left:0;top:0;z-index:30;display:flex;flex-direction:column;gap:8px;width:360px;max-width:min(360px,calc(100vw - 32px));padding:10px 10px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 12px 32px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.16);color:var(--dsw-alias-label-primary);font-size:12px;overflow:hidden;}',
      '.dgg-pop-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;}',
      '.dgg-pop-current{display:flex;align-items:center;gap:3px;min-width:0;color:var(--dsw-alias-brand-primary);}',
      '.dgg-pop-current > svg{flex:none;}',
      '.dgg-pop-branch{font-family:var(--dsw-font-family-code,ui-monospace,monospace);font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}',
      '.dgg-pop-repo{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%;}',
      '.dgg-pop-label{color:var(--dsw-alias-label-secondary);font-size:11px;}',
      '.dgg-pop-status{flex:none;font-size:11px;white-space:nowrap;}',
      '.dgg-pop-meta{flex:none;display:flex;gap:10px;min-width:0;font-size:11px;white-space:nowrap;}',
      '.dgg-pop-meta-item{overflow:hidden;text-overflow:ellipsis;}',
      '.dgg-pop-meta-item + .dgg-pop-meta-item{min-width:0;flex:1 1 auto;text-align:right;}',
      '.dgg-pop-body{flex:1 1 auto;display:flex;flex-direction:column;gap:6px;min-height:0;overflow:hidden;}',
      '.dgg-pop-count{flex:none;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dgg-warn{color:var(--dsw-alias-state-warn-primary);}',
      '.dgg-pop .dgg-search{flex:none;height:28px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;padding:0 10px;}',
      '.dgg-pop .dgg-search:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      // The list scrolls inside the body; a 28px row shows more branches in the
      // same height than the old 22px rows.
      '.dgg-branch-list{list-style:none;margin:0;padding:0;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;}',
      '.dgg-branch{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;}',
      '.dgg-branch:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));}',
      '.dgg-branch:focus-visible{outline:none;box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);}',
      '.dgg-branch:disabled{opacity:.6;cursor:default;}',
      '.dgg-branch-current{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);}',
      '.dgg-branch-check{width:10px;flex:none;text-align:center;}',
      '.dgg-branch-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,monospace);font-size:12px;}',
      '.dgg-branch-current .dgg-branch-name{color:var(--dsw-alias-brand-primary);font-weight:600;}',
      '.dgg-branch-busy{flex:none;color:var(--dsw-alias-label-secondary);}',
      '.dgg-notice{padding:6px 8px;border-radius:6px;font-size:11px;overflow-wrap:anywhere;}',
      '.dgg-notice-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary);}',
      '.dgg-notice-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary);}',
      '.dgg-notice-info{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}',
      '.dgg-pop-foot{flex:none;display:flex;gap:6px;justify-content:stretch;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;}',
      '.dgg-pop-action{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;min-width:0;}',
      '.dgg-pop-action:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));}',
      '.dgg-pop-action:disabled{opacity:.6;cursor:default;}',
      '.dgg-pop-action-label{overflow:hidden;text-overflow:ellipsis;}',
      '@media (prefers-reduced-motion:reduce){.dgg-root *{transition:none!important;animation:none!important;}}',
    ].join('\n');

    /** Insert the plugin stylesheet once; the returned disposer removes it. */
    function insertStyles() {
      if (typeof document === 'undefined') return () => {};
      const style = document.createElement('style');
      style.setAttribute('data-dsh-git-graph', '1');
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => style.remove();
    }

    // -------------------------------------------------------------- lifecycle

    /** The tab-type registration handed to `sidebarRightTabs`. */
    function tabDefinition(t) {
      return {
        id: TAB_KEY,
        kind: TAB_KIND,
        priority: 'extension',
        title: () => t('tab.title'),
        guide: [
          {
            id: TAB_KEY,
            order: 30,
            title: () => t('tab.title'),
            description: () => t('tab.description'),
            icon: GitGraphGlyph,
          },
        ],
      };
    }

    /** Shared glyph used by the launcher and the tab guide. */
    function GitGraphGlyph({ size }) {
      const s2 = size ?? 16;
      return h('svg', { viewBox: '0 0 16 16', width: s2, height: s2, 'aria-hidden': true },
        h('path', { d: 'M4 4v8M4 8h4a3 3 0 0 0 3-3V4M4 8h4a3 3 0 0 1 3 3v1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 4, cy: 3.4, r: 1.5, fill: 'currentColor' }),
        h('circle', { cx: 4, cy: 12.6, r: 1.5, fill: 'currentColor' }),
        h('circle', { cx: 11, cy: 3.4, r: 1.5, fill: 'currentColor' }),
        h('circle', { cx: 11, cy: 12.6, r: 1.5, fill: 'currentColor' }),
      );
    }

    // -------------------------------------------------------------- lifecycle

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        clientContext = ctx;
        try {
          ctx.get('locale')?.register?.(NAMESPACE, DICT);
        } catch (error) {
          console.error('[git-graph] registering the locale failed', error);
        }
        ctx.effect(() => insertStyles(), 'git-graph: styles');

        // The tab type, so the shell lists it in the right sidebar's + menu
        // and `openTab('git-graph')` resolves.
        if (typeof ctx.inject === 'function') {
          ctx.inject(['sidebarRightTabs'], (scope) => {
            const tabs = readService(scope, 'sidebarRightTabs');
            if (typeof tabs?.register !== 'function') return undefined;
            try {
              return ctx.effect(() => tabs.register(tabDefinition(translate(ctx))), 'git-graph: tab type');
            } catch (error) {
              console.error('[git-graph] tab type registration failed', error);
              return undefined;
            }
          });
        }

        const slots = ctx.slots;
        if (!slots) return;
        const mount = (slot, registration, component, tag) => {
          slots.inject(slot, () => {
            try {
              return slots.register({ ...registration, name: slot, locale: NAMESPACE }, function GitGraphEntry(props) {
                return h(Guard, null, h(component, props ?? {}));
              });
            } catch (error) {
              console.error(`[git-graph] ${tag} registration failed`, error);
              return () => {};
            }
          });
        };
        mount('sidebar.right.pane.tab', { key: TAB_KEY }, GitGraphTab, 'tab');
        mount('sidebar.right.pane.tab.title', { key: TAB_KEY }, GitGraphTitle, 'tab title');
        // The branch chip belongs to the composer tool row, immediately left of
        // the model selector: the left group is followed by the model control.
        mount('conversation.input.left', { id: 'git-graph-branch', order: 50 }, BranchChip, 'branch chip');
        mount('conversation.session.header.utilities', { id: 'git-graph', order: 5 }, GitGraphLauncher, 'launcher');
      },
    };
  },
});
