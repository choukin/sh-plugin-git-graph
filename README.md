# dsh-plugin-git-graph · Git 图谱

在 DeepSeek Harness 的 **右侧栏**浏览当前项目的 Git 提交图谱，交互参照 VS Code Git Graph / SourceTree：

- `图谱 | 描述 | 日期 | 作者 | 提交` 表格，左侧多泳道彩色连线（分支、合并、交叉）；
- 描述前的徽标：`HEAD`（品牌色）、本地分支、`origin/*` 远程分支、`tag`（琥珀色）；
- 工具栏：仓库名、分支下拉（显示全部分支 / 单个分支）、远程分支与标签开关、刷新（`enableFetch` 开启时另有「拉取远程」）；
- 点击任一行在表格上方弹出提交详情浮层（不透明底色，不遮挡图谱）：完整哈希（点击复制）、作者 / 时间 / 父提交、提交信息、变更文件列表与单文件 diff；
- 滚动到底自动加载下一页；行虚拟化，几千条提交也不卡。

除「切换分支」与两个 `git fetch --all --prune` 入口外全部只读：不 commit、不 reset、不 rebase、不 push；切换分支会先过守卫（见下），有未提交改动会被覆盖时直接拒绝。

## 分支胶囊：看当前分支、直接切换

输入框工具栏里、切换到模型按钮的左边有一枚分支胶囊：图标 + 当前分支名，工作区有改动时带一个黄点，悬停可看到仓库路径与改动数。

- 点开是分支弹层（360px 宽、最高 460px，宽度不够时最多收到 220px）：顶部显示当前分支（完整名，过长省略并可悬停查看）、仓库名、`HEAD 提交` 短哈希、远程名与工作区状态（干净 / N 个文件有改动 / 冲突 / 进行中的 merge、rebase）；中部是搜索框 + 可滚动的本地分支列表（当前分支置顶并高亮，28px 行高），列表下方一行显示匹配数/总数；底部「拉取远程」「打开 Git 图谱」两个等宽按钮。点击分支即 `git switch` 切换；切换成功后胶囊立即刷新。弹层朝输入框上方展开，上方空间不足时改用下方较大的一侧并让列表收缩，不会只剩一条缝。
- 底栏两个动作：「拉取远程」（`git fetch --all --prune`，不受 `enableFetch` 开关限制）、「打开 Git 图谱」。
- 守卫：分支不存在 / 名字非法 / 分支已在别的 worktree 检出 / 有未完成的 Git 操作 / 有未解决冲突 / 有改动会被覆盖——都直接报出原因，不碰 index。
- 胶囊跟随当前会话目录；不在 Git 仓库里的会话不显示胶囊。状态每 20 秒刷新，窗口重新获得焦点时也会刷新。

## 打开

1. 打开任意会话，点击会话标题栏右侧的 **Git 图谱** 图标（分支图形），或在右侧栏的 `+` 标签列表里选择「Git 图谱」。
2. **标签页跟着会话走**：它读取当前会话的工作目录，切到另一个仓库里的会话时自动切换图谱（目录下发到 Host，由 git 自己判断是否在仓库里，子目录、嵌套仓库、worktree 都能正确解析）。没有会话目录时退回 Harness 默认工作目录；只有配置了 `workingDirectory` 时才固定在那个仓库。

## 配置

`cordis.patch.yml` 里 `git-graph-panel` 行的 `config`（也可在插件设置里改；字段声明为 volatile，保存即生效）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `workingDirectory` | `''` | 固定查看的仓库路径（或其子目录）。留空 = 跟随当前会话的工作目录，没有会话时用 Harness 默认工作目录 |
| `pageSize` | `200` | 每页读取的提交数（20–3000） |
| `enableFetch` | `false` | 工具栏是否提供「拉取远程」（会执行 `git fetch --all --prune`） |

## 实现

- **Host 半区** `lib/index.js` + `lib/git.js`：唯一路由 `/api/dsh-git-graph`，只挂 `connection.fetch` 精确路由（Connection 已就绪时**同步**注册，否则走 `ctx.inject` 等待，注册成功即不再撤销；`webServer` 仅在完全没有 Connection 的 profile 里作为兜底，而且是**精确**路由——在 `webServer` 里注册 `/api/...` 前缀会按最长前缀抢走 Connection 的 `/api` 路由，桌面壳就不再补齐浏览器标记，所有请求直接 403）。`GET` 下发每次加载签发的页面令牌与仓库探测结果，`POST` 走 `state.rpc`（`repo` / `graph` / `branches` / `commit` / `diff` / `fetch` / `health`）。git 只通过固定 argv 形态调用：`LC_ALL=C`、20s 超时、输出上限、`--no-pager`、`GIT_TERMINAL_PROMPT=0`，参数里的提交号必须是十六进制、路径不能以 `-` 开头。
- **Client 半区** `client.js`：`window.__ModuleLoader__.load` 的纯 JS 工厂，只 `require('react')`，不依赖任何 Harness 客户端包；注册三处：
  - `sidebarRightTabs.register({ id, kind, title, guide })` —— 让右侧栏的 `+` 列表认识这个标签（服务不存在时自动跳过）；
  - `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title`，key 为 `git-graph` —— 标签正文与标题；
  - `conversation.input.left` —— 输入框工具栏左侧的分支胶囊与切换弹层（模型选择器左边）。宿主给输入框自己保留了合成层（`will-change: transform`），它因此是 `position: fixed` 后代的包含块：弹层**portal 到 `document.body`**，视口坐标才成立，也不会被输入框下沿裁掉；位置在 commit 后用 layout effect 直接写成弹层的内联样式（不经过 React state），窗口 resize、输入框换行导致胶囊移动时只重新写样式，所以测量不会反过来触发渲染。
  - `conversation.session.header.utilities` —— 标题栏里的打开按钮（调用 `sidebarRight.openTab('git-graph')`）。
  颜色只用 `--dsw-alias-*` 主题变量（泳道 10 色是唯一的装饰色），深浅色跟随宿主；文案走 locale 服务并有中英内置字典兜底；渲染异常由错误边界兜住，不让 slot 崩溃。

## 安装

```sh
npm install dsh-plugin-git-graph
```

（包发布在内网源 `https://npm.ledupeiyou.com/`，本机 `~/.npmrc` 已配置。）装进 Harness profile 后，用 `dsh` 的插件管理机制启用（或在 profile 的 `package.json` 里把它加进 `dsh.profile.bundles`，再补上 `cordis.patch.yml` 里的 `git-graph-panel` 行）。**Host 半区不会热替换**：装好或升级后要重启 Harness 进程。

## 开发与验证

```sh
npm run check   # node --check 三个文件
npm test        # node --test 'test/*.spec.mjs'：临时仓库上的真实 git 断言 + 路由/令牌断言
```

测试在 `test/` 下自建临时仓库（分支、合并、注释标签、远程追踪引用），结束后删除。`test/node_modules/schemastery` 是一个空壳包，供 checkout 直接跑测试用；profile 里用的是 Harness 自带的真包。

## 已知边界

- 只提供 `git switch <分支>` 与 `git fetch`：不 commit / reset / rebase / push；切换分支有守卫，改动会被覆盖时拒绝而不强切。
- 需要重启宿主进程后才会加载这个新版本（Host 半区不会热替换）；页面刷新只刷新浏览器一侧。
- 仓库取自**当前会话的工作目录**（浏览器通过槽位标准属性 `useSessions` / `sessionId` 下发，Host 不接收任意路径之外的目录）；未打开会话或会话目录不是 Git 仓库时显示引导空态。想在会话之外固定看某个仓库，配置 `workingDirectory`。
- `git fetch` 默认关闭，开启后由用户点击触发，不会自动联网。
- `CVS`/`SVN` 等其他版本库不在范围内。

## License

MIT © choukin
