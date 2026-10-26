# 资产库（Asset Library）设计与实施计划

> 状态：已实现（2026-10-26）
> 范围：`packages/web`（控制台后端 + Web UI）
> 与「资产测绘」的关系：资产测绘是 FOFA / 360 Quake / 奇安信 Hunter 的查询与流水（`assets.db`），本功能是 Agent 主动上报的资产台账（`asset-library.db`），两者互不读写。

## 1. 摘要

给 Agent 增加一套项目级资产台账：

- Agent 用 `asset_report` 上报实际接触过的域名、IP、端口服务、URL；
- 用 `asset_note` 给资产追加测试记录（无发现 / 可疑 / 有漏洞 / 不可达 / 备注）；
- 同一资产按项目自动去重合并，测试记录按时间线累积；
- 资产与记录不设容量上限；列表分页，导出全量；
- 控制台新增「资产库」页：筛选、详情、改状态与标签、加记录、批量删除、导出 Markdown；
- 漏洞中枢可选关联网站资产，资产详情反查漏洞，两边可互相跳转。

设计原则与漏洞中枢保持一致：Agent 只写事实，操作员做判定；数据放 agent 配置目录，不放容器可写的 `/work`；删项目即删记录。

## 2. 目标与非目标

### 2.1 目标

| # | 目标 | 验收方式 |
| --- | --- | --- |
| G1 | Agent 能上报四类资产并自动去重 | 同名资产重复上报只增一条记录 |
| G2 | 测试记录形成可读时间线 | 详情与导出都能按时间列出结论、方法、备注、来源 |
| G3 | 操作员能筛选、判定、删除、导出 | 页面可用，删除有影响预览 |
| G4 | 漏洞与资产双向关联 | `vuln_submit` 可带资产编号，资产详情列出关联漏洞 |
| G5 | 权限可收紧 | 关闭 `asset_library_write` 后上报工具不再挂载 |
| G6 | 来源可追溯 | 每条记录带主代理 / 子代理 runId / 工程任务 |
| G7 | 数据生命周期正确 | 删项目连同资产、时间线、资产链接一起清理 |

### 2.2 非目标（本期不做）

- 不把 FOFA / Quake / Hunter 的查询结果自动灌进资产库；后续可加操作员按钮或 `asset_import` 工具。
- 不做 DNS 解析、不做域名到 IP 的自动关链、不自动创建父资产。
- 不做端口扫描或任何主动探测；工具只记录 Agent 已经做过的事。
- 不做跨项目共享资产；资产严格按项目隔离。
- 不做手工新增资产（操作员只能改状态、标签、备注、删除）。
- 不做移动端资产（包名 / bundleId）；`kind` 预留扩展。
- 不做 JSON / CSV 导入导出；本期只有 Markdown 导出。
- 不设资产数、记录数、导出条数上限；列表用服务端分页，导出包含当前筛选的全部记录。

## 3. 用户流程

### 3.1 Agent 侦察流程

```text
asset_list（继续之前的工作时先看已有什么）
  -> asset_report（第一次实际接触：解析、连接、访问）
  -> asset_note（每完成一次验证：result + method + text）
  -> vuln_submit（确认漏洞时带 asset: "E2E-A0001"）
```

约束：

- 只上报实际接触过的资产。测绘平台返回的、字典里出现的、别人提到的，都不算。
- 一次调用一条资产，避免一次提交里混多个端点。
- 服务优先用 `IP:port` 形式；只有不知道 IP 时才用 `域名:port`，因为两者是不同的记录。
- 测试出漏洞必须走 `vuln_submit`，不要只在资产时间线里写「有漏洞」。

### 3.2 操作员流程

```text
侧栏「资产库」
  -> 看统计与列表，按类型 / 状态 / 是否已测试 / 关键字筛选
  -> 点开详情：字段、时间线、关联漏洞
  -> 改状态（待测试 / 测试中 / 已测试 / 范围外）、改标签、加记录（备注或复核结论）
  -> 勾选删除（先看影响预览）或导出当前筛选的 Markdown
```

## 4. 数据模型

### 4.1 存储位置

- 新模块：`packages/web/src/asset-library.ts`
- 新数据库：`<agentDir>/asset-library.db`（与 `vulnerabilities.db`、`assets.db` 同级）
- 理由：项目工作目录挂进容器，Agent 的 bash 能读写；台账必须在容器外，否则「Agent 写了什么」不可信。
- SQLite 打开后启用 `PRAGMA journal_mode = WAL`（与漏洞中枢一致），支持测试里另开连接读取。

### 4.2 表结构

```sql
CREATE TABLE IF NOT EXISTS asset_library (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  number        INTEGER NOT NULL,
  project_id    TEXT NOT NULL,
  project_name  TEXT NOT NULL,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  dedupe_key    TEXT NOT NULL,
  host          TEXT NOT NULL,
  domain        TEXT,
  ip            TEXT,
  port          INTEGER,
  transport     TEXT,
  protocol      TEXT,
  url           TEXT,
  title         TEXT,
  server        TEXT,
  tech          TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'pending',
  source        TEXT NOT NULL,
  session_id    TEXT,
  engine_id     TEXT,
  task_id       TEXT,
  session_name  TEXT,
  test_count    INTEGER NOT NULL DEFAULT 0,
  last_outcome  TEXT,
  last_tested_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(project_id, dedupe_key),
  UNIQUE(project_id, label)
);

CREATE INDEX IF NOT EXISTS idx_asset_library_project
  ON asset_library(project_id, last_seen_at DESC, number DESC);
CREATE INDEX IF NOT EXISTS idx_asset_library_kind
  ON asset_library(project_id, kind, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_library_status
  ON asset_library(project_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS asset_library_entries (
  asset_id   TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'record',
  at         TEXT NOT NULL,
  author     TEXT NOT NULL,
  source     TEXT,
  outcome    TEXT NOT NULL,
  method     TEXT,
  text       TEXT NOT NULL,
  vuln_label TEXT,
  PRIMARY KEY (asset_id, seq)
);

CREATE TABLE IF NOT EXISTS asset_library_sequences (
  project_id  TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL
);
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `kind` | `domain` / `ip` / `service` / `url` |
| `name` | 规范化后的展示标识，如 `admin.example.com`、`10.0.0.5:443`、`https://x/login` |
| `host` | 归属主机：域名/IP 记录为主机本身；服务为不带端口的 IP/域名；URL 为 `u.host`（含非默认端口）。用于将来分组 |
| `domain` / `ip` / `port` / `transport` / `protocol` / `url` | 结构化端点字段，按 `kind` 取舍 |
| `tags` | JSON 字符串数组，展示与搜索用 |
| `status` | `pending` / `testing` / `tested` / `out_of_scope` |
| `test_count` | `kind='record'` 的条目数（测试与备注），不含状态变更 |
| `last_outcome` | 最近一条**结论性**记录的结论（`clean` / `suspicious` / `vulnerable` / `unreachable`）；备注不覆盖它 |
| `last_tested_at` | 最近一条结论性记录的时间；与 `last_outcome` 同步 |
| `first_seen_at` / `last_seen_at` | 首次与最近一次 **Agent** 上报/记录时间；操作员改状态、标签、备注只刷新 `updated_at` |
| `created_at` / `updated_at` | 入库时间与最后一次修改时间；将来导入历史数据时 `created_at` 可能晚于 `first_seen_at` |
| 来源字段 | 首次上报时的会话/工程归属，快照保存，不随会话删除失效 |

`asset_library_entries` 字段：

| 字段 | 说明 |
| --- | --- |
| `kind` | `record`（测试记录/备注，计入 `test_count`）或 `status`（操作员状态变更，不计入） |
| `author` | `agent` / `operator` |
| `source` | Agent 侧来源：`主代理`、`子代理 <runId>`、`工程任务「…」`；操作员为空 |
| `outcome` | `note` / `clean` / `suspicious` / `vulnerable` / `unreachable` |
| `method` | 实际使用的方法或命令，如 `nmap -sV`、`curl /login` |
| `text` | 观察与结论，可多行 |
| `vuln_label` | 由漏洞提交自动写入的关联编号，用于时间线展示 |

### 4.3 编号与序列

- 编号格式：`<项目前缀>-A0001`，项目前缀复用漏洞中枢的 slug 规则（大写、非字母数字转 `-`、截断 20 字符、空则 `ASSET`）。
- 例：项目 `E2E PROJECT` 的第 3 条资产是 `E2E-PROJECT-A0003`。
- `asset_library_sequences` 保证删除资产后编号不复用；`UNIQUE(project_id, label)` 兜底。
- 删项目时同时删除 `asset_library_sequences` 行。

### 4.4 容量、分页与校验

- 资产数、单资产记录数、导出条数都不设上限。
- 列表用服务端分页：`page` / `pageSize`，默认 50；`pageSize` 最大 200 只是渲染控制，不是库容量限制。分页影响的是「一次读多少」，不影响「能存多少」。
- Agent 的 `asset_list` 用 `limit` 控制单次输出条数（默认 50），输出到 8000 字符就停止拼接并提示收窄。两者都只约束一次输出的体积，库中数据量不受影响。
- 详情一次返回该资产的全部时间线；导出包含当前筛选的全部资产与全部时间线，不做截断。
- 字段只做结构校验，不做长度截断：端口 1-65535、IP 合法、域名符合 DNS 规则（含 253 上限，这是协议约束）、URL 可解析且 scheme 允许、标签按逗号拆分后去重。文本、标题、URL 长度、标签数量都不截断。
- 深分页的 `OFFSET` 会随页数变慢；真正到百万级资产时再加键集分页与 FTS（见第 16 节），今天不预留人为上限。

## 5. 规范化与去重

### 5.1 身份推断

工具与 store 共用 `resolveAssetIdentity(input)`；不合法时抛 `AssetInputError`，消息直接给模型看。所有字符串先 trim，空字符串视为未提供。

| url | port | ip | domain | 结果 |
| --- | --- | --- | --- | --- |
| 有 | - | - | - | `url` |
| - | 有 | 有 | - | `service` |
| - | 有 | - | 有 | `service` |
| - | - | 有 | - | `ip` |
| - | - | - | 有 | `domain` |
| 有 | 任意 | 任意 | 任意 | 拒绝：URL 自带主机与端口，不要再传 |
| - | 有 | 有 | 有 | 拒绝：域名和 IP 分两次上报 |
| - | 有 | - | - | 拒绝：服务必须有 ip 或 domain |
| - | 无 | 有 | 有 | 拒绝：域名和 IP 分两次上报 |
| - | - | - | - | 拒绝：至少给 url、ip、domain 之一 |

`transport` / `protocol` 只允许随 `service` 出现；单独给 `ip` / `domain` / `url` 时拒绝，避免无意义的字段。

### 5.2 规范化规则

域名：

- 去首尾空白，转小写，去掉一个末尾点。
- 拒绝含 `/`、`?`、`#`、`@`、空格、`*`（通配符不是资产）的输入。
- `net.isIP(value) !== 0` 时拒绝，提示改用 `ip`。
- 用 `new URL("http://" + value)` 转 punycode 并校验；单标签主机（`intranet`）与下划线允许。
- 长度 <= 253，每段 1-63。

IP：

- 去掉 IPv6 方括号；`net.isIP` 只接受 4 / 6。
- IPv6 用 `new URL("http://[" + value + "]/").hostname` 归一化后去括号并转小写。
- 拒绝 CIDR（`10.0.0.0/24`），提示逐条上报。

服务：

- `port` 必须是 1-65535 的整数。
- `transport` 只允许 `tcp` / `udp`，默认 `tcp`，输入转小写。
- `protocol` 转小写、去尾部 `:`，只允许 `[a-z0-9][a-z0-9+._-]{0,39}`；如 `http`、`https`、`ssh`、`microsoft-ds`。
- `name`：IPv4 / 域名用 `host:port`；IPv6 用 `[::1]:443`。
- `host` 为 IP 或域名本身。

URL：

- 只允许 `http`、`https`、`ws`、`wss`。
- 用 `new URL` 解析；去掉 userinfo 与 fragment，保留 query。
- 存储 URL = `${protocol}//${host}${pathname}${search}`，`host` 含非默认端口。
- 默认端口：http/ws 80，https/wss 443；显式默认端口由 URL 归一化掉。
- `protocol` = scheme；`domain` = 主机名（若为域名）；`ip` = 主机名（若为 IP，去括号）；`port` = 有效端口。
- 不设 URL 长度上限；只要 `new URL` 能解析且 scheme 允许就收。
- URL 中的账号密码被剥离，工具结果里提示「已移除 URL 中的账号密码」。

### 5.3 去重键

| kind | dedupe_key | 示例 |
| --- | --- | --- |
| domain | `domain:<规范化域名>` | `domain:admin.example.com` |
| ip | `ip:<规范化 IP>` | `ip:` + `::1` = `ip:::1`（IPv6 原样，前缀冒号与地址冒号相连） |
| service | `service:<name>/<transport>` | `service:10.0.0.5:443/tcp` |
| url | `url:<protocol>//<host><pathname>`（query、fragment 不参与） | `url:https://x/login` |

URL 的 query 不参与去重是刻意的：`/product?id=1` 与 `/product?id=2` 是同一个端点。存储的 `url` 保留首次上报时的 query；后续合并不会改它。

键冲突时合并，不新建。`UNIQUE(project_id, dedupe_key)` 是最后一道防线。

### 5.4 合并规则

首次创建：

- 写入身份字段、描述字段、标签、来源快照；
- `first_seen_at = last_seen_at = now`；
- `status = pending`；
- 若本次带测试记录，追加一条并可能触发状态自动流转。

再次上报同一键：

| 字段 | 规则 |
| --- | --- |
| 身份字段（kind/name/host/domain/ip/port/transport/url） | 不可变，保留首次值 |
| `protocol` | 非空时最新值覆盖（允许 Agent 修正误报；身份键不含它） |
| `title` / `server` / `tech` | 非空时最新值覆盖 |
| `tags` | 并集（大小写不敏感去重） |
| `status` | 上报不改；只有新增结论性记录时 `pending -> tested` |
| 来源字段 | 保留首次快照 |
| `first_seen_at` | 不变 |
| `last_seen_at` | Agent 上报、Agent 记录、漏洞关联都刷新 |
| `updated_at` | 任何修改都刷新，包括操作员改状态/标签/备注 |
| 测试记录 | 有则追加 |

操作员改过的状态不会被 Agent 的上报覆盖；操作员删掉的标签可能被后续上报重新加回（标签是观察，不是判定）。

`asset_report` 带 `note` 而不带 `result` 时，记录按 `result = "note"` 写入；带 `result` 但不带 `note` / `method` 时允许写入空正文，正文列是空串而不是 NULL。`asset_note` 要求 `method` 与 `text` 至少一个非空。

### 5.5 状态流转

```text
pending ──(首条结论性测试记录: clean / suspicious / vulnerable / unreachable)──> tested
pending / testing / tested / out_of_scope <──操作员可任意设置──>
```

- Agent 没有直接改状态的能力。
- 只有 `clean` / `suspicious` / `vulnerable` / `unreachable` 算「结论性」；`note` 不改变状态，也不写 `last_outcome` / `last_tested_at`。
- 结论性记录的作者可以是 agent，也可以是操作员（人工复核）；两者都触发同样的自动流转。
- 由 `vuln_submit` 自动追加的关联记录按 `vulnerable` 处理，会触发同样的自动流转。
- `testing` 与 `out_of_scope` 只由操作员设置。
- 自动流转不额外写时间线条目，测试记录本身就是依据。
- 操作员把状态改回 `pending` 后，下一条结论性记录会再次自动置为 `tested`。

## 6. Agent 工具

### 6.1 工具清单

| 工具 | 权限 | 作用 |
| --- | --- | --- |
| `asset_report` | `asset_library_write` | 上报 / 合并一条资产，可带首条测试记录 |
| `asset_note` | `asset_library_write` | 给已有资产追加测试记录 |
| `asset_list` | `asset_library_read` | 查询当前项目资产 |
| `asset_get` | `asset_library_read` | 读一条资产、时间线与关联漏洞 |

### 6.2 `asset_report`

参数（TypeBox）：

```ts
{
  url?: string;          // 只允许 http/https/ws/wss；不能与 ip/domain/port 同时出现
  ip?: string;
  domain?: string;
  port?: number;         // 1..65535；与 ip 或 domain 之一组成 service
  transport?: "tcp" | "udp";
  protocol?: string;
  title?: string;
  server?: string;
  tech?: string;
  tags?: string[];
  note?: string;         // 可选的同次观察
  method?: string;
  result?: "note" | "clean" | "suspicious" | "vulnerable" | "unreachable";
}
```

工具描述（模型可见，英文）：

> Report one asset into this project's asset library: a domain you resolved, an IP you scanned, an IP:port service you probed, or a URL you fetched. Call it as soon as the asset is actually touched, not at the end of the run. The library is project-scoped and deduplicated: re-reporting the same endpoint merges into its existing record instead of creating a second one. Do not report assets that only appeared in a search-engine result or a wordlist; those are not yours yet. Pass a URL by itself: it already carries its host, port and scheme.

`promptGuidelines`：

- Report an asset the first time you actually resolve, connect to, or fetch it; do not wait for the final summary.
- One call = one endpoint: a URL, a host:port service, a bare IP, or a bare domain.
- Prefer the IP:port form for a service whose IP you know; host:port and IP:port are separate records.
- Never bulk-report FOFA / Quake / Hunter results; report only what you touched, unless the operator explicitly asks for an import.
- Call `asset_list` first when continuing previous work, so you reuse existing labels instead of guessing.
- After a test, record the outcome with `asset_note`; when it confirms a flaw, submit it with `vuln_submit` and pass this asset's label.
- Keep credentials out of reported URLs; the tool strips them, but do not put them there in the first place.

结果文本：

- 新建：`已上报资产 E2E-A0001（新建）：服务 10.0.0.5:443/tcp https。项目内共 12 条资产。`
- 合并：`已合并到资产 E2E-A0001（已存在，最近发现时间已更新）：服务 10.0.0.5:443/tcp https。`
- 带记录：追加 `已记录测试记录：无发现（nmap -sV）。`
- 警告（URL 去账号密码、标签按逗号拆分、重名标签去重）逐条附后。

失败文本必须给出改法：

- `同时给了域名和 IP：请把域名和 IP 分成两次上报，或只保留你实际使用的主机名。`
- `给了 port 但没有 ip/domain：服务必须有主机。`
- `URL 已自带主机与端口，不要再传 ip/domain/port。`
- `10.0.0.0/24 是网段：请逐条上报具体 IP。`
- `该资产不存在：先用 asset_report 上报，或 asset_list 查编号。`

### 6.3 `asset_note`

```ts
{
  asset: string;          // id 或编号，如 "E2E-A0001"
  result: "note" | "clean" | "suspicious" | "vulnerable" | "unreachable";
  method?: string;
  text?: string;          // method 与 text 至少一个非空
}
```

描述：

> Append one test record to an asset already in this project's library. Use it after each validation attempt (port scan, HTTP request, login test, manual check) so the asset's timeline tells the next pass what was already done. Records are append-only: to correct an earlier conclusion, append a new record that says so. A conclusive result on a pending asset marks it as tested; it does not change an operator-set status.

结果文本：`已记录到 E2E-A0001：有漏洞 · 手动 SQL 注入。关联测试记录 4 条，状态：已测试。`

### 6.4 `asset_list`

```ts
{
  kind?: "domain" | "ip" | "service" | "url";
  status?: "pending" | "testing" | "tested" | "out_of_scope";
  tested?: boolean;       // true 只看有结论性记录的；false 只看没有的
  search?: string;        // 编号 / 名称 / URL / 标题 / 标签 / 来源
  limit?: number;         // 单次输出条数，默认 50，最大 200；只约束输出，不约束库
}
```

输出每行：`编号 | 类型 | 名称 | 状态 | 测试记录数 · 最近结论（无结论时写“无结论”） | 最近发现 | 来源`。
超过 `limit` 时提示用筛选收窄；总数为 0 时明确说「当前项目还没有资产」；输出超过 8000 字符时截断并提示收窄条件。

### 6.5 `asset_get`

```ts
{ asset: string }
```

输出：身份字段、描述字段、标签、来源、首次/最近发现、完整时间线、关联漏洞（编号、等级、状态、标题）。最近结论为 `vulnerable` 但没有关联漏洞时追加一行提醒补交 `vuln_submit`。超过 8000 字符截断。

### 6.6 挂载与来源

- 主 Agent：`sentinel-session.ts` 的 `customTools` 中挂载。
- 子 Agent：给 `SubagentToolOptions` 增加可选 `createAssetTools?: (getSource: () => string) => ToolDefinition[]`，与 `createVulnTools` 同形，来源标签为 `子代理 <runId>`。
- 工程任务会话：与漏洞工具同范围；来源 `工程任务「标题」`，并带 `engineId` / `taskId`。
- 工具写库不产生网络请求，不过审批门；与 `vuln_submit` 同级。`tool-audit` 仍会记录调用。
- 工程 worker 的追加提示补一句：`Report every asset you actually touch with asset_report, and record each test with asset_note.`
- 子代理面板的工具摘要字段：`asset_report: ["url", "ip", "domain"]`、`asset_note: ["asset", "result"]`、`asset_list: ["search"]`、`asset_get: ["asset"]`。
- 工具选项：

```ts
export interface AssetLibraryToolOptions {
  store: AssetLibraryStore;
  /** 会话创建时捕获的项目；切换项目不影响已在跑的会话。 */
  getProject: () => { id: string; name: string } | undefined;
  /** 由工厂在挂载前过滤：写工具看 write，读工具看 read。 */
  permissions: SentinelPermissionSet;
  getSessionId: () => string | undefined;
  getSessionName?: () => string | undefined;
  getEngineRef?: () => { engineId: string; taskId: string } | undefined;
  /** 主代理 / 子代理 <runId> / 工程任务「…」。 */
  getSource: () => string;
  /** asset_get 的关联漏洞；没有漏洞库时返回空数组。 */
  listVulnsByAsset?: (assetId: string) => SentinelVulnSummary[];
  onChange?: () => void;
}
```

工厂返回已过滤的工具集合；两个权限都关时返回空数组。这样工具测试可以直接断言挂载集合，不必经过运行时私有方法。

### 6.7 权限

新增两个键：

| 键 | 标签 | 说明 | 标准 | 只读侦察 | 全部禁用 |
| --- | --- | --- | --- | --- | --- |
| `asset_library_write` | `asset_report / asset_note 资产库上报` | 写资产与测试记录 | 开 | 关 | 关 |
| `asset_library_read` | `asset_list / asset_get 资产库查询` | 读资产与时间线 | 开 | 开 | 关 |

- `PERMISSION_KEYS`、`fullSet`、`emptySet`、`reconSet`、`excludeToolsFor` 同步更新。
- `excludeToolsFor`：写关闭时排除 `asset_report`、`asset_note`；读关闭时排除 `asset_list`、`asset_get`。
- 现有规则：权限文件里没有新键时读作关。因此升级后需要在「设置 → 权限」打开。
- 顺带修复（可单独砍掉）：权限面板目前没有 `vuln_submit` / `vuln_read` / `asset_read` 三个开关，但后端一直在用它们；本次把这三个与新开关一起补进 `SWITCHES`，否则新键在旧配置下没有入口打开。

## 7. 漏洞联动

### 7.1 表结构变更

`vulnerabilities` 增加两列（构造函数里 `PRAGMA table_info` 后 `ALTER TABLE`，与现有迁移方式一致）：

```sql
ALTER TABLE vulnerabilities ADD COLUMN asset_id TEXT;
ALTER TABLE vulnerabilities ADD COLUMN asset_label TEXT;
```

老记录保持 `NULL`，不回填。资产编号是快照，资产删除后：

- 资产删除流程先把关联漏洞的 `asset_id` / `asset_label` 置空（只解除关联，不删漏洞）；
- 漏洞自身的 `target` 文本不受影响。

### 7.2 `vuln_submit` 变更

- 参数新增 `asset?: string`（id 或编号）。
- 提交前解析：找不到资产直接报错，不创建漏洞，避免半个关联。
- 创建漏洞时写入 `asset_id` / `asset_label`。
- 创建成功后给资产追加一条时间线：

```text
author: agent
source: 漏洞的 source
outcome: vulnerable
method: vuln_submit
text: 提交漏洞 <漏洞编号>：<标题>
vuln_label: <漏洞编号>
```

- 时间线追加失败不影响漏洞记录（已经入库），只丢失一条关联记录；实现上捕获异常。
- `vuln_list` 输出在目标后附 ` | 资产 <编号>`；`vuln_get` 输出增加「关联资产」一行。

`VulnerabilityToolOptions` 增加两个可选回调，由 `sentinel-session.ts` 绑定：

```ts
/** 解析 id 或编号；限定项目，找不到返回 undefined。 */
resolveAsset?: (ref: string) => { id: string; label: string } | undefined;
/** 漏洞创建成功后追加资产时间线；失败不影响返回值。 */
linkAsset?: (assetId: string, vuln: SentinelVulnerability) => void;
```

提交顺序：先 `resolveAsset` 校验，再 `store.create` 写入 `asset_id` / `asset_label`，最后 `linkAsset`。`linkAsset` 内部调用 `AssetLibraryStore.appendEntry` 并触发 `hooks.onAssetChange`。

权限关系：只有 `asset_library_write` 打开时才绑定这两个回调。关闭时 `vuln_submit` 仍可提交漏洞，但带 `asset` 参数会返回「资产库上报未开启」，避免绕过写权限向资产时间线写记录。工具要区分两种失败：回调不存在 = 权限未开；回调返回 `undefined` = 资产不存在。同理，`asset_get` 的关联漏洞只在 `vuln_read` 打开时填充；关闭时输出「未开启漏洞读取，关联漏洞未显示」。

### 7.3 反向查询

`VulnerabilityStore` 新增：

```ts
listByAsset(projectId: string, assetId: string): SentinelVulnSummary[];
linkedByAsset(projectId: string): Map<string, SentinelVulnSummary[]>;
countLinkedToAssets(projectId: string, assetIds: readonly string[]): number;
unlinkAssets(projectId: string, assetIds: readonly string[]): number;
```

- 详情：`listByAsset`。
- 导出：`linkedByAsset` 一次查出，避免 N+1。
- 删除预览：`countLinkedToAssets`。
- 删除资产：`unlinkAssets`。

### 7.4 协议与 UI

- `SentinelVulnerability` / `SentinelVulnSummary` 增加可选 `assetId` / `assetLabel`。
- `SentinelVulnFilters` 预留可选 `assetId`（本期页面不做筛选控件，便于后续）。
- 漏洞列表：目标旁显示资产编号小标签（不可点击，避免与行点击冲突）。
- 漏洞详情：元信息区显示「关联资产」按钮，点击跳到资产库并打开该资产。
- 资产详情：关联漏洞列表，点击跳到漏洞中枢并打开该记录。
- Markdown 漏洞报告：元信息增加 `- 关联资产：E2E-A0001`。

## 8. 协议

`packages/web/src/protocol.ts` 与 `webui/src/types.ts` 同步增加。

### 8.1 类型

```ts
export type SentinelAssetKind = "domain" | "ip" | "service" | "url";
export type SentinelAssetState = "pending" | "testing" | "tested" | "out_of_scope";
export type SentinelAssetOutcome = "note" | "clean" | "suspicious" | "vulnerable" | "unreachable";

export interface SentinelAssetEntry {
  seq: number;
  /** record = 测试记录/备注；status = 操作员状态变更。 */
  kind: "record" | "status";
  at: string;
  author: "agent" | "operator";
  source?: string;
  outcome: SentinelAssetOutcome;
  method?: string;
  text: string;
  vulnLabel?: string;
}

export interface SentinelAssetSummary {
  id: string;
  label: string;
  number: number;
  projectId: string;
  projectName: string;
  kind: SentinelAssetKind;
  name: string;
  host: string;
  domain?: string;
  ip?: string;
  port?: number;
  transport?: "tcp" | "udp";
  protocol?: string;
  url?: string;
  title?: string;
  server?: string;
  tech?: string;
  tags: string[];
  status: SentinelAssetState;
  source: string;
  sessionId?: string;
  engineId?: string;
  taskId?: string;
  sessionName?: string;
  testCount: number;
  lastOutcome?: SentinelAssetOutcome;
  lastTestedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SentinelAsset extends SentinelAssetSummary {
  entries: SentinelAssetEntry[];
}

export interface SentinelAssetDetail {
  asset: SentinelAsset;
  vulns: SentinelVulnSummary[];
}

export interface SentinelAssetFilters {
  kind?: SentinelAssetKind;
  status?: SentinelAssetState;
  tested?: boolean;
  search?: string;
}

export interface SentinelAssetUpdate {
  status?: SentinelAssetState;
  /** 整体替换；空数组表示清空。 */
  tags?: string[];
  /**
   * 追加一条操作员记录。outcome 缺省为 note；给结论性值时与 Agent 记录一样
   * 更新 last_outcome / last_tested_at，并在资产还是 pending 时自动置为 tested。
   */
  outcome?: SentinelAssetOutcome;
  /** 记录正文；与 status 同时提交时合并进同一条时间线。 */
  note?: string;
}

export interface SentinelAssetStats {
  total: number;
  byKind: Record<SentinelAssetKind, number>;
  /** 操作员状态分布，四项之和等于 total。 */
  byStatus: Record<SentinelAssetState, number>;
  /** 至少有一条结论性记录（与 status 无关）。UI 文案为「有结论」。 */
  tested: number;
  /** total - tested。UI 文案为「无结论」。 */
  untested: number;
}

export interface SentinelAssetDeletePreview {
  count: number;
  records: number;
  vulns: number;
}
```

### 8.2 客户端消息

```ts
| { type: "list_assets"; filters?: SentinelAssetFilters; page?: number; pageSize?: number }
| { type: "get_asset"; id: string }
| { type: "update_asset"; id: string; patch: SentinelAssetUpdate }
| { type: "preview_asset_delete"; ids: string[] }
| { type: "delete_assets"; ids: string[] }
| { type: "export_assets"; filters?: SentinelAssetFilters }
```

### 8.3 服务端消息

```ts
| {
    type: "assets";
    items: SentinelAssetSummary[];
    stats: SentinelAssetStats;
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }
| { type: "assets_changed" }
| { type: "asset"; detail: SentinelAssetDetail }
| { type: "asset_result"; action: string; id?: string; ok: boolean; error?: string }
| { type: "asset_delete_preview"; count: number; records: number; vulns: number }
| { type: "assets_deleted"; count: number }
| { type: "assets_export"; filename: string; markdown: string }
```

`total` 是当前筛选命中的总条数（不是本页条数）；`stats` 是项目全量统计。`assets_changed` 是写操作后的轻量广播：客户端用自己的筛选与页码重新 `list_assets`，避免服务端替每个客户端猜当前页。

`get_asset` 要求 `id`，但 store 的 `find` 同时接受编号；WS 层只暴露 id，编号入口只给 Agent 工具。

### 8.4 项目信息

`SentinelProjectInfo` 增加 `assetCount?: number`，删除项目弹窗的元信息加 `{count} 条资产`，说明文字补一句「资产库记录与漏洞链接会一并删除」。

## 9. 运行时与服务端

### 9.1 `AssetLibraryStore` API

```ts
export interface AssetIdentityInput {
  url?: string;
  ip?: string;
  domain?: string;
  port?: number;
  transport?: "tcp" | "udp";
  protocol?: string;
}

export interface AssetEntryInput {
  author: "agent" | "operator";
  /** Agent 侧来源标签；操作员记录为空。 */
  source?: string;
  outcome: SentinelAssetOutcome;
  method?: string;
  /** 允许空串；多行原样保存。 */
  text: string;
  /** 由漏洞提交自动写入。 */
  vulnLabel?: string;
}

export interface AssetUpsertInput {
  projectId: string;
  projectName: string;
  source: string;
  sessionId?: string;
  engineId?: string;
  taskId?: string;
  sessionName?: string;
  identity: AssetIdentityInput;
  title?: string;
  server?: string;
  tech?: string;
  tags?: string[];
  /** 可选的同次观察，写入时间线；作者固定为 agent，来源取上面的 source。 */
  record?: Pick<AssetEntryInput, "outcome" | "method" | "text">;
}

/** 输入不合法；message 直接返回给模型。 */
export class AssetInputError extends Error {}

export class AssetLibraryStore {
  constructor(path: string, now?: () => Date);
  close(): void;

  upsert(input: AssetUpsertInput): { created: boolean; asset: SentinelAsset; warnings: string[] };
  get(id: string): SentinelAsset | undefined;
  /** 按 id 或编号查，编号大小写不敏感；限定项目。 */
  find(projectId: string, idOrLabel: string): SentinelAsset | undefined;
  list(projectId: string, filters?: SentinelAssetFilters, page?: number, pageSize?: number): {
    items: SentinelAssetSummary[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
  stats(projectId: string): SentinelAssetStats;

  appendEntry(assetId: string, entry: AssetEntryInput): SentinelAsset | undefined;
  update(id: string, patch: SentinelAssetUpdate): SentinelAsset | undefined;

  deletePreview(projectId: string, ids: readonly string[]): { count: number; records: number };
  deleteMany(projectId: string, ids: readonly string[]): number;
  deleteByProject(projectId: string): number;
  countByProject(projectId: string): number;
}
```

- `upsert` 在一个事务里完成：取号、写资产、写首条记录、更新计数。不检查项目资产总数；资产和记录可以无限增长。
- `appendEntry` 只写 `kind='record'` 的条目，内部处理 `test_count` / 结论性字段 / 状态自动流转。不设单资产记录数上限。
- `update` 只允许操作员字段：状态、标签、记录（`outcome` + `note`）。状态变化写一条 `kind='status'` 的 `operator` 条目（正文 `状态 待测试 → 已测试`）；记录写一条 `kind='record'` 的条目；两者同一次提交时按顺序写两条。只给 `note` 不给 `outcome` 时按 `note` 记。显式给 `status` 时以它为准；没给状态时，结论性记录仍按 pending→tested 自动流转。标签变化不写时间线。状态、标签、结果非法时抛 `AssetInputError`，由 WS 层转成错误消息。
- `deleteMany` 事务内先删 entries 再删资产；关联漏洞由运行时层解除；序列不回收。
- `deleteByProject` 同时删 entries、资产与序列行。
- 时间戳统一 ISO UTC；`now` 可注入以便测试。
- 搜索用 `LIKE ... ESCAPE '\'`，`%` / `_` 按字面匹配；搜索覆盖编号、名称、host、域名、IP、URL、标题、服务、技术栈、标签、来源。
- `tags` 列 JSON 解析失败时读作空数组，不抛错。
- `list` 按 `last_seen_at DESC, number DESC` 排序，`page` 从 1 开始，`pageSize` 默认 50、上限 200（渲染控制）；`total` 是筛选命中总数，不是本页条数；`page` 越界时返回空 `items` 并保留真实 `total`。
- 深分页用 `LIMIT/OFFSET`；百万级资产时换成键集分页（第 16 节），当前不加数据量上限。
- `stats` 是项目全量统计，不受筛选影响。`tested` = `last_tested_at IS NOT NULL`，`untested` = `total - tested`（包含 `testing` 与 `out_of_scope`）。
- 同模块导出 `ASSET_KINDS` / `ASSET_STATES` / `ASSET_OUTCOMES`、`ASSET_KIND_LABELS` / `ASSET_STATE_LABELS` / `ASSET_OUTCOME_LABELS`、`emptyAssetStats()`、`assetLibraryDbPath(agentDir)`，供工具、导出、测试复用。
- `assetPrefix(projectName)` 复用漏洞中枢的 slug 规则但独立实现，避免把资产编号与漏洞编号耦合。

### 9.2 `SentinelRuntime`

新增字段 `private readonly assetLibrary: AssetLibraryStore`，构造时 `new AssetLibraryStore(assetLibraryDbPath(this.agentDir))`，`dispose()` 关闭。

新增方法：

```ts
listAssets(filters?: SentinelAssetFilters, page?: number, pageSize?: number): {
  items: SentinelAssetSummary[];
  stats: SentinelAssetStats;
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};
getAsset(id: string): SentinelAssetDetail | undefined;
updateAsset(id: string, patch: SentinelAssetUpdate): SentinelAssetDetail | undefined;
previewAssetDelete(ids: readonly string[]): SentinelAssetDeletePreview;
deleteAssets(ids: readonly string[]): number;
exportAssets(filters?: SentinelAssetFilters): { filename: string; markdown: string };
countProjectAssets(projectId: string): number;
purgeProjectAssetLibrary(projectId: string): number;
```

- 所有读写都限定在 `activeProjectId`；没有项目时返回空 / `undefined`。`getAsset` 用 `find(projectId, id)`，不能用全局 `get(id)`，否则另一个项目的 id 也能读到。
- `getAsset` 组装 `vulns: this.vulnerabilities.listByAsset(projectId, asset.id)`。
- `previewAssetDelete` = store 的 `{count, records}` + `vulnerabilities.countLinkedToAssets(projectId, ids)`。
- `deleteAssets`：
  1. `unlinkAssets` 解除漏洞关联；
  2. `assetLibrary.deleteMany`；
  3. 有变化时 `hooks.onAssetChange()`，解除过关联再 `hooks.onVulnChange()`。
- `purgeProjectAssetLibrary` 删除资产、时间线、序列，并解除该项目的资产关联（项目删除时漏洞也会被清掉，解除是防御性的）。
- 现有 `purgeProjectAssets`（测绘流水）改名 `purgeProjectAssetQueries`，与新的台账方法区分；只有一个调用点。
- 广播与漏洞中枢一致：只广播当前项目视图；后台会话给别的项目写资产时，不影响当前页面内容。
- 漏洞被删除时不会触发 `onAssetChange`；前端在收到 `vulns_deleted` 后如果资产详情开着，主动重取一次 `get_asset`，避免关联列表残留。

Hook 增加：

```ts
onAssetChange(): void;
```

### 9.3 `server.ts`

- 增加 `broadcastAssetsChanged()`：只广播 `{type:"assets_changed"}`，不携带列表。分页后服务端不知道每个客户端停在第几页，让客户端用自己的筛选与页码重查。
- hooks：`onAssetChange: () => broadcastAssetsChanged()`。
- 消息处理按现有 `list_vulns` / `get_vuln` / ... 的模式实现六个新消息；`list_assets` 透传 `page` / `pageSize`，响应带分页字段；`update_asset` 返回 `asset` + `asset_result`。
- `update_asset` 把 `AssetInputError`（非法状态 / 标签 / 结果）转成 `{type:"asset_result", action:"更新", ok:false, error}`，不写库。
- `get_asset` / `update_asset` 找不到记录时返回「该资产不存在（可能属于其他项目，或已被删除）」。
- `projectInfos()` 增加 `assetCount: runtime.countProjectAssets(id)`。
- 删除项目的分支增加 `const purgedLibraryAssets = runtime.purgeProjectAssetLibrary(message.id);`，并计入日志/结果。
- 现有资产测绘的 `purgeProjectAssets` 调用改为新名字。

### 9.4 工具装配

`sentinel-session.ts`：

```ts
/** 运行时绑定；导入的工厂叫 createAssetLibraryTools，私有方法不重名。 */
private createAssetTools(options: {
  project: { id: string; name: string } | undefined;
  permissions: SentinelPermissionSet;
  getSessionId: () => string | undefined;
  getSessionName: () => string | undefined;
  getEngineRef?: () => { engineId: string; taskId: string } | undefined;
  getSource: () => string;
}): ToolDefinition[] {
  if (!options.permissions.asset_library_write && !options.permissions.asset_library_read) return [];
  return createAssetLibraryTools({
    store: this.assetLibrary,
    getProject: () => options.project,
    permissions: options.permissions,
    getSessionId: options.getSessionId,
    getSessionName: options.getSessionName,
    ...(options.getEngineRef ? { getEngineRef: options.getEngineRef } : {}),
    getSource: options.getSource,
    ...(options.permissions.vuln_read
      ? {
          listVulnsByAsset: (assetId: string) => {
            const project = options.project;
            return project ? this.vulnerabilities.listByAsset(project.id, assetId) : [];
          },
        }
      : {}),
    onChange: () => this.hooks.onAssetChange(),
  });
}
```

- 主会话 `customTools` 加 `...this.createAssetTools({...})`。
- 子代理 `createAssetTools` 传同样的工厂，`getSource` 用 runId 标签。
- 漏洞工具创建处按 `asset_library_write` 决定是否传 `resolveAsset` / `linkAsset`，见 7.2。

`subagent.ts`：`SubagentToolOptions.createAssetTools?`，`customTools: [...vulnTools, ...(options.createAssetTools?.(getSource) ?? []), ...extraTools]`。

## 10. 控制台页面

### 10.1 入口与命名

- 页面 id：`"assets"`（与设置里的 `"settings.assets"` 区分）。
- 侧栏「工作台」顺序：对话 / 项目 / 漏洞 / **资产库** / 业务建模 / ...
- 页面标题：`资产库`。
- CSS 前缀：`asset-lib-*`。**不能用 `asset-*`**：`.asset-page` / `.asset-table` / `.asset-row` 已被「设置 → 资产测绘」占用。
- 图标：新增 `AssetsIcon`，使用 lucide `Boxes`。
- 「设置 → 资产测绘」页顶部补一句区分：`这里配置测绘平台；Agent 上报的资产与测试记录在侧栏「资产库」。`

### 10.2 页头与统计

```text
资产库  靶场-01 · 共 12 条 · 待测试 7
[全选本页] [删除选中 (N)] [导出 Markdown]
```

统计条分两组：

- 类型：`域名 2 · IP 3 · 服务 6 · URL 1`。
- 状态：`待测试 7 · 测试中 0 · 已测试 5 · 范围外 0`（`byStatus` 四项，和等于总数）。
- 「有结论 / 无结论」只用于筛选与导出摘要，不放进页头，避免与状态里的「已测试」混淆。
- 有筛选条件时，标题副行追加 `筛选命中 N 条`（`assets.total`），与项目总数区分。
- 列表底部显示 `第 P / T 页 · 共 N 条`，`T` 由 `total` 与 `pageSize` 计算；页大小可选 20 / 50 / 100 / 200，默认 50。

### 10.3 筛选

一行筛选：

- 搜索框：占位「搜索编号 / 名称 / URL / 标题 / 标签 / 来源」；Enter 生效。
- 类型：全部 / 域名 / IP / 服务 / URL。
- 状态：全部 / 待测试 / 测试中 / 已测试 / 范围外（操作员状态）。
- 结论：全部 / 有结论 / 无结论（只看有没有结论性测试记录，与状态无关）。
- 「重置」。

筛选状态、页码、页大小保存在 App；任何筛选变化、切项目、页大小变化都把页码重置为 1。`assetFiltersRef` / `assetPageRef` 供 `assets_changed` 后重查使用。

### 10.4 列表

| 列 | 内容 |
| --- | --- |
| 勾选 | 批量删除；点勾选不打开详情 |
| 编号 | `E2E-A0001`，等宽字体 |
| 类型 | 域名 / IP / 服务 / URL 彩色标签 |
| 资产 | `name`，过长时用 CSS 省略号显示（数据不截断）；副行显示 `title` |
| 协议 | 服务显示 `protocol`，URL 显示 scheme，其余 `—` |
| 状态 | 状态标签 |
| 测试 | `3 条 · 无发现`；有记录但无结论显示 `2 条 · 无结论`；无记录显示 `—` |
| 最近发现 | 本地时间 `MM-DD HH:mm` |
| 来源 | 主代理 / 子代理 / 工程任务 |

选择态：

- 勾选不打开详情；表头全选只作用于**本页**，不是全部筛选结果（数据量无上限，跨页全选容易误删）。
- 翻页、改筛选、改页大小时清空选择；列表刷新后把已不存在的 id 从选择集里剔除。
- 没有选择时「删除选中」禁用；没有记录时「导出」仍可用（导出空清单）。
- 分页控件：上一页 / 下一页 / 页码输入；`hasMore` 为 false 时禁用下一页。删除最后一页的全部记录后自动退回上一页。

空状态：

- 没有项目：`尚未选择项目` + `资产库按项目隔离，请先在侧栏顶部选择或创建一个项目`。
- 项目内没有资产：`还没有资产记录` + `Agent 在探测目标时用 asset_report 上报；需要在「设置 → 权限」开启 asset_library_write`。
- 筛选无结果：`没有符合条件的资产` + `调整搜索或筛选条件`。

### 10.5 详情抽屉

用 `Overlay`，标题 `E2E-A0001 · 10.0.0.5:443`。

- 头部动作：复制名称、复制 URL、删除。
- 元信息网格：类型、状态、域名、IP、端口、传输、协议、URL、标题、服务、技术栈、标签、来源、会话名、首次发现、最近发现、测试记录数。工程/任务以来源文本（`工程任务「…」`）展示，不显示裸 id。
- 状态：下拉即时保存。
- 标签：逗号分隔输入 + 保存；空文本清空；不限制数量与长度（逗号拆分成多个标签，重名去重）。
- 记录：结论下拉（备注 / 无发现 / 可疑 / 有漏洞 / 不可达，默认备注）+ 多行输入 + 「添加记录」；保存后追加 operator 时间线。只写备注、不改结论时选「备注」。
- 时间线：按 `seq` 升序；`record` 条目显示时间、作者/来源、结论标签、方法、正文（`white-space: pre-wrap`）；`status` 条目用弱化样式显示「状态」与变更正文；`vuln_label` 显示为漏洞编号。
- 关联漏洞：编号、等级、状态、标题；点击跳漏洞中枢并打开详情。
- 一致性提示：`lastOutcome === "vulnerable"` 且没有关联漏洞时，显示 `最近一次测试结论为「有漏洞」，但没有关联的漏洞中枢记录`，提醒操作员核实或让 Agent 补提交。
- 无测试记录：`还没有测试记录：Agent 测试后用 asset_note 记录，操作员也可以加备注`。
- 窄屏：详情占满宽度，元信息网格变单列，列表横向滚动；行可用键盘 Enter / 空格打开。
- 入口旁边不新增角标（首版不做无结论计数角标）。

### 10.6 删除

- 勾选一条或多条 → `preview_asset_delete` → 弹窗：
  - `将删除 N 条资产。`
  - `M 条测试记录`
  - `K 条漏洞的关联会被解除（漏洞本身保留）`
  - 提示：`删除后不可恢复；关联漏洞只解除关联，不删除漏洞记录。`
- 确认后 `delete_assets`，关闭详情，按当前筛选与页码重查；若当前页已空且 `page > 1`，自动请求上一页。

### 10.7 导出

- 按钮发送 `export_assets`，带当前筛选。
- 收到 Markdown 后用 Blob 下载（与漏洞导出同一套代码）。
- 文件名：`<项目前缀>-asset-inventory-<YYYYMMDDHHmm>.md`。

### 10.8 双向跳转

- App 增加 `openAsset(id)`：`setPage("assets")` + `send({type:"get_asset", id})`。
- 复用 App 现有的 `openVuln(id)`，再加一层 `goToVuln(id)`：`setPage("vulns")` + `openVuln(id)`。
- `VulnPage` 详情接受 `onOpenAsset`；`AssetLibraryPage` 详情接受 `onOpenVuln`。
- 只允许跳当前项目内的记录（服务器已按项目限定）。

### 10.9 刷新

- 进入资产页、切项目、改筛选、翻页、改页大小时发送 `list_assets`，带当前 `filters` / `page` / `pageSize`。没有侧栏角标，因此连接建立时不预取。
- `onAssetChange` 只广播 `{type:"assets_changed"}`。客户端在资产页打开时按当前筛选与页码重查；详情打开时重新 `get_asset`。
- 详情不在当前页/当前筛选里时不主动关闭（详情可能来自漏洞页跳转）；本控制台发起的删除会在确认后显式关闭。
- 当前页重新进入（`refreshPage`）时按当前筛选与页码重查。
- 漏洞被删除（`vulns_deleted`）时若资产详情开着，重新 `get_asset` 刷新关联列表。

## 11. 导出格式

`packages/web/src/asset-markdown.ts` 提供纯函数：

```ts
buildAssetReport(input: {
  projectName: string;
  /** 已按当前筛选取出的资产（含时间线）。 */
  assets: SentinelAsset[];
  /** 资产 id -> 关联漏洞；一次查询的结果。 */
  vulnsByAsset: Map<string, SentinelVulnSummary[]>;
  /** 可注入，便于测试时间与文件名。 */
  generatedAt?: Date;
}): { filename: string; markdown: string };
```

运行时 `exportAssets(filters)` 负责查数据、调用它，返回给 WS 层。

```markdown
# 资产清单 — E2E

- 生成时间：2026-10-26 13:30:00
- 项目：E2E
- 资产总数：12（域名 2 / IP 3 / 服务 6 / URL 1）
- 测试情况：有结论记录 5 · 无结论记录 7（状态：待测试 6 · 范围外 1）

## 域名

### E2E-A0001 admin.example.com

- 状态：已测试
- 来源：主代理 · 会话「10.0.0.5 侦察」
- 首次发现：2026-10-26 10:00 · 最近发现：2026-10-26 12:30
- 标签：OA、后台
- 测试记录：
  - 2026-10-26 12:30 主代理 · 无发现 · nmap -sV：仅 80/443 开放
- 关联漏洞：PROJ-0003（高危）后台登录处 SQL 注入

## 服务

### E2E-A0002 10.0.0.5:443

...
```

没有资产时，标题与元信息照常输出，正文只有一行：`本次导出没有资产记录。`

导出不分页、不截断：取当前筛选命中的全部资产与全部时间线。数据量很大时文件也很大，生成与下载会变慢，但不丢记录。

- 分组顺序：域名、IP、服务、URL。
- 组内按 `last_seen_at` 倒序。
- 空字段不输出。
- 时间线按时间升序；多行正文缩进两个空格；`kind='status'` 的条目写成 `- 时间 操作员 · 状态：<正文>`。
- 关联漏洞只列编号、等级、状态、标题。
- 最近结论为 `vulnerable` 但没有关联漏洞时，追加一行 `- 注意：最近一次测试结论为「有漏洞」，但没有关联的漏洞中枢记录。`
- 使用 `t()` 输出中英文标签，时间用服务端语言格式化。
- 文件内容可能包含内部域名、URL query 中的令牌；导出文件按敏感材料处理，不做任何外发。

## 12. 错误与边界

| 场景 | 行为 |
| --- | --- |
| 没有项目 | 工具返回中文错误；页面显示项目提示；WS 列表返回空 |
| 资产/记录很多 | 不设上限；列表分页，详情与导出全量 |
| 列表页码越界 | 返回空 `items`，`total` 与 `page` 保留；前端退回上一页 |
| 深分页变慢 | `LIMIT/OFFSET` 的已知代价；百万级时换键集分页，不提前设上限 |
| 单次工具输出 | `limit` + 8000 字符截断只约束模型看到的内容，不约束库中数据 |
| 超长文本 / URL / 标签 | 原样保存与展示，不截断 |
| URL 带账号密码 | 剥离并警告，不入库 |
| URL query 带令牌 | 原样保存（它可能是复现所需），导出文件按敏感材料处理 |
| 标签里带逗号 | 按逗号拆成多个标签；重名去重 |
| IPv6 | 归一化；服务名带方括号；去重键一致 |
| 通配符域名 | 拒绝并提示报具体主机 |
| CIDR / 端口范围 | 拒绝并提示逐条 |
| 同一资产并发上报 | 单进程同步写 + 唯一约束；合并而不是报错 |
| 后台会话上报另一个项目 | 记录归属该会话创建时捕获的项目；`assets_changed` 只让当前资产页重查 |
| 会话/工程已删除 | 记录保留来源快照，详情显示快照名 |
| 资产被删后漏洞仍存在 | 删除时解除关联；漏洞正文不受影响 |
| 漏洞被删后资产仍在 | 资产时间线里的历史 `vuln_label` 保留为文本（不追删历史），关联漏洞列表里不再出现 |
| 项目被删 | 资产、时间线、序列、漏洞关联一起清理 |
| 数据库行损坏（tags 非 JSON） | 读作空数组，不抛 |
| 服务端收到非法状态/结果 | 拒绝并返回错误，不写库 |

## 13. 测试计划

### 13.1 单元测试

`packages/web/test/asset-library.test.ts`：

- 四种 kind 的创建、编号、标签前缀。
- 去重：域名大小写/末尾点；IP/IPv6；服务 transport 与 protocol；URL 默认端口、query、fragment、账号密码。
- 合并：身份字段不可变；protocol/title/server/tech 非空最新覆盖；tags 并集；last_seen 刷新；来源保留。
- 状态：首条结论性记录自动 `pending -> tested`；`note` 不触发也不写 `last_outcome`；`testing` / `out_of_scope` 不被覆盖。
- 时间线：seq 递增、`record` / `status` 两类、操作员记录、关联漏洞条目；Agent 记录刷新 `last_seen_at`，操作员记录只刷新 `updated_at`；备注不覆盖 `last_outcome`；`test_count` 不含 `status`。
- 查询：kind/status/tested/search 筛选；排序；stats 中 `tested` / `untested` 的定义。
- 分页：`page` / `pageSize`、`total` / `hasMore`、越界页返回空、筛选与分页组合。
- 无上限：一次写入超过 200 条资产、单个资产超过 500 条记录都不报错（用较小循环验证，不追求跑满）。
- 不截断：超长文本、超长 URL、很多标签原样存取。
- 操作员更新：状态、标签、记录；结论性记录更新 `last_outcome` 并触发 pending→tested；状态变化与记录分别写 `status` / `record` 两条；无变化时幂等。
- 删除：按项目限定；预览计数；序列不复用；删项目清理。
- 非法输入：模糊身份、URL 带主机字段、CIDR、通配符、非法端口、非法协议。

`packages/web/test/asset-library-tool.test.ts`：

- 四个工具的参数校验与输出文本。
- 合并时返回同一编号。
- `asset_note` 找不到资产时报错。
- `asset_list` 过滤、`limit` 与 8000 字符截断提示（截断的是输出，不是库）。
- 没有项目时报错。
- 权限过滤：只读 / 只写 / 全关时挂载的工具集合。

`packages/web/test/asset-markdown.test.ts`：

- 分组、排序、空字段省略、时间线缩进、`status` 条目格式、关联漏洞行、空库文案、文件名。

`packages/web/test/vuln-tool.test.ts` 扩展：

- 带 `asset` 提交写入 `assetId` / `assetLabel` 并追加时间线。
- 未知资产拒绝且不创建漏洞。
- `vuln_list` 输出包含资产编号。

`packages/web/test/vuln-hub.test.ts` 扩展：

- 老库自动加列；`listByAsset` / `linkedByAsset` / `unlinkAssets`。

### 13.2 协议/服务端测试

`packages/web/test/asset-library-server.test.ts`（模仿 `vuln-delete-server.test.ts`，用 fake docker）：

- 建项目、切项目、列表为空。
- 另开一个 `AssetLibraryStore` 播种资产，通过 WS 列出。
- 分页：播种 3 条，`pageSize=2` 两页，`total` / `hasMore` 正确；越界页返回空且 `total` 不变。
- `get_asset` 返回时间线与关联漏洞。
- `update_asset` 改状态并返回时间线。
- `preview_asset_delete` 不删除；`delete_assets` 精确删除。
- 删除带关联漏洞的资产后，漏洞仍在但 `assetId` 为空。
- `export_assets` 返回当前筛选的全部记录（播种数大于一页时仍全量）。
- `assets_changed` 在写操作后广播。
- 删项目后列表为空。

### 13.3 UI 测试

`packages/web/webui/src/components/AssetLibraryPage.test.tsx`：

- 没有项目时的提示。
- 空列表与筛选空结果两种空状态。
- 列表渲染编号、类型、状态、测试数；有记录但无结论显示「无结论」。
- 分页控件：上一页 / 下一页、页大小、`hasMore` 为 false 时禁用下一页；翻页清空选择。
- 选择集在列表刷新后剔除不存在的 id。
- 删除弹窗展示三类计数。
- 详情渲染时间线（`record` 与 `status` 两种样式）与关联漏洞。
- `lastOutcome === "vulnerable"` 且没有关联漏洞时显示一致性提示。

`PermissionsPanel.render.test.tsx` 更新 fixture；`subagent-process.test.ts` 增加 `asset_report` 摘要。

### 13.4 命令

```bash
cd packages/web
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run \
  test/asset-library.test.ts \
  test/asset-library-tool.test.ts \
  test/asset-markdown.test.ts \
  test/asset-library-server.test.ts \
  test/vuln-tool.test.ts \
  test/vuln-hub.test.ts \
  test/permissions.test.ts
```

```bash
# 仓库根目录；会跑 biome、tsc、webui tsc 与 browser smoke
npm run check
```

按仓库规则不运行 `npm run build` / `npm test`，需要手动看页面时先与操作员确认再构建。

## 14. 实施阶段与验收

### 阶段 1：存储、规范化、工具

- [ ] `src/asset-library.ts`
- [ ] `src/asset-library-tool.ts`
- [ ] `src/permissions.ts`（键、标签、预设、排除）
- [ ] `webui/src/types.ts`（权限键同步）
- [ ] `webui/src/components/PermissionsPanel.tsx`（新开关；含三个缺口的建议修复）
- [ ] `test/asset-library.test.ts`、`test/asset-library-tool.test.ts`
- [ ] `webui/src/subagent-process.ts` 摘要字段
- 验收：目标测试通过；`npm run check` 无类型错误。

### 阶段 2：协议、运行时、漏洞联动、服务端、导出

- [ ] `src/protocol.ts` 类型与消息
- [ ] `src/vulnerabilities.ts` 列迁移、创建参数、反查、解除关联
- [ ] `src/vuln-tool.ts` `asset` 参数与回调
- [ ] `src/vulnerability-markdown.ts` 关联资产行
- [ ] `src/sentinel-session.ts` store、运行时方法、hook、工具装配、子代理工厂
- [ ] `src/subagent.ts` `createAssetTools`
- [ ] `src/worker.ts` 提示
- [ ] `src/server.ts` 广播、处理器、项目计数、删项目清理、改名
- [ ] `src/asset-markdown.ts`
- [ ] `test/asset-markdown.test.ts`、`test/asset-library-server.test.ts`、漏洞测试扩展
- 验收：服务端测试通过（含分页与 `assets_changed`）；`npm run check` 通过。

### 阶段 3：Web UI

- [ ] `webui/src/types.ts` 资产类型与标签
- [ ] `webui/src/components/icons.tsx` `AssetsIcon`
- [ ] `webui/src/components/AppSider.tsx` 入口
- [ ] `webui/src/components/AssetLibraryPage.tsx`
- [ ] `webui/src/App.tsx` 状态、WS、页面、跳转、导出
- [ ] `webui/src/components/VulnPage.tsx` 资产标签与跳转
- [ ] `webui/src/components/ProjectDeleteDialog.tsx` 资产计数
- [ ] `webui/src/components/AssetPanel.tsx` 顶部区分提示
- [ ] `webui/src/style.css`、`webui/src/styles/workspace-pages.css`（`asset-lib-*`，并把 `.asset-lib-page` 加进共享选择器）
- [ ] `src/i18n-messages.ts` 英文条目
- [ ] UI 测试
- 验收：页面测试通过（含分页与选择态）；`npm run check` 通过；构建后手动验证（需确认）：
  1. 新建项目与容器，打开「设置 → 权限」确认 `asset_library_write` / `asset_library_read` 已开。
  2. 让 Agent 上报 `10.0.0.5:443`（https）与 `https://10.0.0.5/login`，确认是两条资产。
  3. 重复上报 `10.0.0.5:443` 并带 `title`，确认合并成一条且编号不变。
  4. 让 Agent 用 `asset_note` 记录 `clean`，确认状态自动变「已测试」。
  5. 提交一个带 `asset` 的漏洞，确认资产详情出现关联漏洞，漏洞详情出现资产编号，两边可互相跳转。
  6. 改状态、加标签、加备注，刷新页面确认保留。
  7. 筛选「有结论 / 无结论」、类型与状态，确认列表与计数一致；翻页与改页大小后选择清空。
  8. 导出 Markdown（在有筛选、跨多页时），确认导出的是全部命中记录而不是当前页，分组、时间线、关联漏洞、空字段省略。
  9. 删除资产，确认漏洞仍在但关联消失；删项目，确认记录清空。

### 阶段 4：文档与收尾

- [ ] `README.md` / `README.en.md` 功能条目
- [ ] `README.md` 安全边界补一句：资产库数据在控制台本机（`asset-library.db`），导出仅本地下载，工具不发起外部请求
- [ ] `packages/web/CHANGELOG.md` Unreleased → Added（注明旧权限文件需要打开两个新开关）
- [ ] 复查工具描述与提示词，确认不会鼓励批量刷资产
- [ ] 全量目标测试 + `npm run check`

## 15. 决策记录

| 决策 | 选择 | 理由 / 放弃的方案 |
| --- | --- | --- |
| 数据模型 | 单表 + 类型字段，主机归属用 `host` | 两级模型要求 Agent 先建主机，多一次调用与一类重复；FLAT 更适合边打边报 |
| 测试记录 | 资产时间线 | 独立记录实体需要跨资产引用与更重的 UI；时间线足够回答「测过什么」 |
| 上报范围 | 只报实际接触过的 | 测绘结果批量入库会淹没台账；需要时再显式导入 |
| 状态归属 | 操作员所有；结论性记录自动 pending→tested | Agent 直接改状态会与操作员判定打架 |
| 状态 vs 结论 | 状态是工作流，结论是证据；页面分开显示 | 操作员可以没有记录就标「已测试」，所以两者不能合并成一个计数 |
| 操作员记录 | 可选结论，默认 `note` | 人工复核也是证据；只允许备注会让「有结论」统计漏掉复核结果 |
| 时间线类型 | `record` 与 `status` 分开 | 状态变更不是测试；混在一起会让「测试记录数」虚高 |
| 服务身份 | `ip:port` 与 `域名:port` 是两条记录 | 避免 DNS 解析与多 IP 归属的复杂度；在提示词里说明 |
| URL 去重 | 忽略 query 与 fragment，保留 path | query 是参数不是端点；避免动态参数把资产表打爆 |
| URL 凭据 | 剥离 userinfo | 台账与导出不应保存密码 |
| 编号 | `<前缀>-A0001` + 序列表 | 删除后不复用；与漏洞编号区分 |
| `last_outcome` | 只记结论性结果，备注不覆盖 | 列表要回答「最近测出什么」；备注是过程不是结论 |
| 有漏洞但无关联漏洞 | 详情与导出显示提示，不阻断 | Agent 可能漏提交；提示让操作员核实，而不是伪造关联 |
| 存储 | 独立 `asset-library.db` | 与测绘流水 `assets.db` 语义不同，生命周期也不同 |
| 删除资产 | 解除漏洞关联，不删漏洞 | 漏洞是独立证据，不应因资产清理而消失 |
| 通知 | 不做资产推送 | 资产是过程数据，不像高危漏洞需要即时推送 |
| 容量 | 资产数、记录数、导出条数都不设上限 | 资产库是台账，先到的人为上限会逼操作员删数据；规模问题用分页与索引解决 |
| 分页 | 列表服务端分页；详情与导出全量 | 不限制存多少，只限制一次读多少；导出必须完整 |
| 字段长度 | 不截断，只做结构校验 | 文本是证据，截断会丢信息；URL/域名/端口按协议规则校验 |
| 广播 | `assets_changed` + 客户端重查 | 分页后服务端不知道每个客户端在第几页，推全量会错位 |
| 权限默认 | 旧配置读作关，面板可开 | 沿用现有「未同意即关」的规则，不静默扩权 |
| CSS | `asset-lib-*` | `.asset-*` 已被资产测绘设置页占用 |

## 16. 实现记录（2026-10-26）

落地与本文的差异，均已在代码中体现：

- 分页与 `assets_changed`：服务端分页；写操作只广播变更，客户端按自己的筛选与页码重查。
- 无容量上限：项目资产数、单资产记录数、导出条数都不设上限；`asset_list` 的 `limit` 与 8000 字符输出截断只约束模型上下文。
- 时间线加 `kind`：状态变更与测试记录分开计数；操作员记录可选结论。
- 「设置 → 权限」补上了 `vuln_submit` / `vuln_read` / `asset_read` 三个此前缺失的开关，以及两个新开关。
- `vuln_submit` 的 `asset` 关联受 `asset_library_write` 控制；`asset_get` 的关联漏洞受 `vuln_read` 控制。
- 删除预览里的记录数包含状态变更，页面文案写作「时间线记录」。
- 主要文件：`src/asset-library.ts`、`src/asset-library-tool.ts`、`src/asset-markdown.ts`、`webui/src/components/AssetLibraryPage.tsx`、`test/asset-library*.test.ts`、`test/asset-markdown.test.ts`、`test/asset-library-server.test.ts`。

验证：资产库与受影响目标的 116 项测试通过；`npm run check` 通过（biome、tsc、webui tsc、browser smoke）。全量 `./test.sh` 中与本功能无关的既有失败（`packages/ai` 模型目录、`packages/coding-agent` SSH、Web e2e 超时）未处理。

## 17. 未来扩展

- FOFA / Quake / Hunter 结果一键导入（操作员按钮或 `asset_import` 工具），复用同一去重与合并逻辑。
- DNS 解析与域名/IP 关联；`host` 字段已经为此预留。
- 与工程任务的目标清单联动，自动建立初始范围。
- 百万级数据下的键集分页、虚拟滚动、FTS 搜索与跨项目搜索。
- 超长时间线的详情分页与流式导出（当前详情与导出都一次取全量）。
- JSON / CSV 导入导出，便于与外部资产平台对接。
- 测试记录附带证据文件路径（复用漏洞中枢的 `/work` 证据预览）。
- 移动端资产：`kind: android | ios` + 包名 / bundleId。
- 资产关系图（域名 → IP → 服务 → URL）。
- 无结论资产的侧栏角标与批量「标记已测试」。
