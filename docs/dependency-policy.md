# 依赖下界策略（issue #56 的决策）

> 决策日期：2026-10-10 · 适用对象：本仓库 9 个包的全部 `peerDependencies` / `devDependencies`
> / `dependencies` 版本声明。
> 本文是 issue #56 的结论，也是 Dependabot 版本更新的判据。

## 一句话结论

| 类别 | 规则 | 理由 |
| --- | --- | --- |
| **规则 A · peer** | 声明必须**被真正装载它的宿主满足**（harness 提供什么，就声明什么） | peer 是"宿主契约"，不是"我开发时用的版本"。声明一个宿主并不提供的区间，等于声明一个假的契约。 |
| **规则 B · devDep** | 必须**能被 pnpm 解析安装**；装不到宿主版本时停在最后一个可安装版本，并把漂移写进文档 | 装不上的 pin 会让 `pnpm install` 直接失败，把"策略"变成"故障"。 |
| **规则 C · 运行时替身类型包**（`@types/node`） | 钉 **`engines` 下界**，不追最新 | 用最老受支持运行时做类型检查，才能拦住"只在新运行时存在"的 API。追最新恰好放行这类错误。 |

三条规则合起来是一句话：**声明对宿主诚实，编译面对下界保守。**

## 本轮实测基线（决策依据，可复现）

### 宿主到底提供什么

本机运行中的 harness = `@deepseek-ai/dsh@0.1.5-rc.1`（`systemd --user` 的 `dsh-web.service`）。
从 harness 自己的解析根读取：

```console
$ node -e "console.log(require('@deepseek-ai/cordis/package.json').version)"     # → 4.0.2
$ node -e "console.log(require('@deepseek-ai/dsh-skill/package.json').version)"  # → 0.1.5-rc.1
$ node -e "console.log(require('@deepseek-ai/dsh-tools/package.json').version)"  # → 0.1.5-rc.1
```

| 包 | harness 提供 | 仓库原来声明（peer / devDep） |
| --- | --- | --- |
| `@deepseek-ai/cordis` | **4.0.2** | `^4.0.1` / `4.0.1` |
| `@deepseek-ai/dsh-skill` | **0.1.5-rc.1** | `0.1.0-rc.6` / `0.1.0-rc.6` |
| `@deepseek-ai/dsh-tools` | **0.1.5-rc.1** | （只有 `dependencies`）`0.1.0-rc.6` |

### 这两个 peer 是"仅类型"的（import type）

```console
$ grep -rl "@deepseek-ai/cordis\|@deepseek-ai/dsh-skill" packages/*/lib/*.js   # 0 个文件
```

唯一一处命中是 `packages/core/lib/index.js` 里的**注释文字**，不是 import。
源码侧全部是 `import type`：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
```

**⇒ peer 区间是编译期契约，运行期不会因为区间写错而崩。**

### 本仓库就是"线上加载的那份代码"

`~/.dsh/profiles/web/node_modules/dsh-ros2-*` 全部是**指向本仓库 `packages/*` 的符号链接**，
且插件的运行期依赖直接从本仓库的 `node_modules` 解析：

```console
$ node -e "…resolve('@deepseek-ai/dsh-tools/package.json', {paths:['packages/core']})"
…/embody_agent_ws/dsh-ros2/node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1.0-rc.6…/dsh-tools/package.json
```

**⇒ 本仓库的 pin 不是"文档"，就是线上真正加载的版本。**

## 为什么 issue #56 给的三个选项都不能直接用

issue #56 列了三个策略。本轮把三个**都实测了一遍**，结论是
**选项 1 不可表达、选项 2 不可安装、选项 3 无收益**。

### 证明 1 · 选项 1（下界 = 最小支持）对预发布版**不可表达**

选项 1 要求"peer 区间保持不动、只动 devDependencies"。但对 `@deepseek-ai/dsh-skill`
来说，"保持不动"保的是一个**精确钉住的预发布版** `0.1.0-rc.6`——而宿主提供 `0.1.5-rc.1`。

想把它改成一个**同时覆盖二者**的区间，semver 做不到。node-semver 的预发布排除规则要求：
带预发布的版本只有在"比较器集合里存在**同一 `[major,minor,patch]` 且带预发布**的比较器"时才被接受。
`0.1.5-rc.1` 的 tuple 是 `0.1.5`，而任何以 `0.1.0-rc.6` 为下界的比较器 tuple 都是 `0.1.0`：

```console
$ node -e "const s=require('semver'); for (const r of ['0.1.0-rc.6','^0.1.0-rc.6','>=0.1.0-rc.6 <0.2.0','*'])
             console.log(r.padEnd(20), s.satisfies('0.1.0-rc.6',r), s.satisfies('0.1.5-rc.1',r))"
0.1.0-rc.6           true  false
^0.1.0-rc.6          true  false      ← 直觉上"放宽了"，实际没有
>=0.1.0-rc.6 <0.2.0  true  false
*                    true  false      ← 连 * 都不接受预发布
```

**⇒ "保持下界"和"覆盖宿主"在预发布上是互斥的；选项 1 无法写出它自己想要的那个区间。**

### 证明 2 · 选项 2（跟随 harness）在本工作区**不可安装**

> **测量时间：2026-10-10（第十八轮重新实测）。** 本节第一次写下时（2026-10-01）记录的
> 报错里失败的包是 `@deepseek-ai/dsh-scope`；今天在**同一个工作区**复现时，报错里的包
> 换成了 `@deepseek-ai/dsh-llm`。**换的是名字，不是机制**：pnpm 会挑它先撞上的那个
> 只有预发布版的 peer。下面是今天的原文。

选项 2 要把 devDep 提到宿主版本（`dsh-skill@0.1.5-rc.1`）。`pnpm install` 直接失败：

```console
$ pnpm install            # 把 8 个包的 devDep 提到 dsh-skill@0.1.5-rc.1 之后
packages/core:
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for
  @deepseek-ai/dsh-llm@>=0.1.5 <0.2.0-0 while fetching it from https://registry.npmjs.org/
  The latest release of @deepseek-ai/dsh-llm is "0.0.1-rc.1" …
```

关键在于这个区间**不是**包的声明。`dsh-skill@0.1.5-rc.1` 自己写的是 `^0.1.5-rc.1`：

```console
$ node -e "…dsh-skill/package.json…"      # peerDependencies
{ "@deepseek-ai/cordis": "^4.0.2",
  "@deepseek-ai/dsh-llm": "^0.1.5-rc.1",
  "@deepseek-ai/dsh-scope": "^0.1.5-rc.1" }
```

而 `0.1.5-rc.1/rc.2/rc.3` **在 npm 上确实存在**（`dist-tags.latest` 却是 `0.0.1-rc.1`）。
pnpm 把 `^0.1.5-rc.1` 规范化成了 **`>=0.1.5 <0.2.0-0`**——**预发布标记被丢掉了**，
于是它只接受**稳定版** 0.1.5，而稳定版 0.1.5 从不存在。
这是证明 1 那个语义陷阱在**依赖解析器**里的同一个形状。

**一处必须写清楚的边界（本轮实测的修正）**：同一个 `dsh-skill@0.1.5-rc.1` 在
**空目录**里 `pnpm install` **是成功的**（会装出 `dsh-llm@0.1.5-rc.3`）。
差别在于工作区已有的 lockfile / peer 自动安装路径。
⇒ 准确的结论是"**选项 2 在*本工作区*不可安装**"，而不是"这个依赖图本身不可解析"。
把失败条件写宽一度，就会变成一个不经检验也会被引用的错误结论。

试着绕开——关掉 peer 自动安装（`autoInstallPeers: false`）**确实**能让 `dsh-skill@0.1.5-rc.1` 装上：

```console
$ pnpm install            # autoInstallPeers: false
Packages: +5 -26          # 装上了，但同时拆掉了 26 个包
Done in 7.6s
$ ls node_modules/.pnpm | grep dsh-skill
@deepseek-ai+dsh-skill@0.1.5-rc.1_@deepseek-ai+cordis@4.0.2
```

代价是**工具链当场断掉**，而且断在两个方向上：

```console
$ pnpm run build          # 类型面
packages/core/src/index.ts(92,55): error TS2339:
  Property 'name' does not exist on type 'ToolDefinition'.
packages/profile/src/index.ts(33,55): error TS2339: （同上）
packages/dsh-ros2-state build: Failed

$ pnpm -r test            # 运行面
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from
  …/vitest@5.0.3…/vitest/dist/chunks/index.DpLw24bj.js
```

**`TS2339` 这条比原文举的例子更有信息量**：它证明那两个"仅类型"的 peer
**在编译期是真的被用到的**——关掉自动安装，harness 的类型就没了，`ToolDefinition`
上的 `name` 立刻解析不了。这正是规则 A 的另一面：peer 区间是编译期契约，
所以它**必须**被宿主真正满足。运行面则印证了 vitest 的 `vite` peer 也是靠自动安装补上的。

`@deepseek-ai/dsh-tools` 在**运行期真的 import** 了 `dsh-scope` / `dsh-llm` / `dsh-session` 等
harness 包（见文末「残留观察」第 2 条）；它们平时就是靠 peer 自动安装补齐的。

**⇒ harness 的依赖图在本工作区里无法独立解析。选项 2 需要额外声明约 10 个 harness 包才能成立，
代价大于收益。**

### 证明 3 · 选项 3（照 Dependabot 合并）没有收益

- `#42` 把 cordis peer 抬到 `^4.0.4`，而**宿主是 4.0.2**——新下界悬在部署之上；
  且 `^4.0.2`（下面采用的区间）**本来就已经包含 4.0.4**，抬 floor 纯属多余。
- `#46` 把 dsh-skill 抬到 `0.1.0-rc.8`，**仍然是精确钉预发布版**，**仍然不满足宿主 0.1.5-rc.1**。
- `#58` 把 `@types/node` 抬到 `^26`，而 `engines` 下界是 `22.19`——按 26 检查，Node-26-only 的 API 会**通过** typecheck，
  然后在最老受支持运行时上 `TypeError`。

### 关键前提：CI 的"绿"证明不了这件事

CI 装的是**这个 PR 自己抬上去的那个 devDependency**。所以 `check (22)/(24)` 全绿的含义是
"代码能跟 cordis 4.0.4 一起编译"，**不是**"4.0.4 是正确下界"。
三个 PR 全绿且可合并——**这不是下界决策的证据**。

## 采用的方案（规则 A + B + C 的落地）

7 个 bundle 包（core / dsh-ros2 / dsh-ros2-state / moveit / profile / safety / vision）统一：

```jsonc
"peerDependencies": {
  "@deepseek-ai/cordis":    "^4.0.2",      // 规则 A：宿主提供 4.0.2
  "@deepseek-ai/dsh-skill": "^0.1.5-rc.1"  // 规则 A：宿主提供 0.1.5-rc.1
},
"devDependencies": {
  "@deepseek-ai/cordis":    "4.0.2",       // 规则 B：可安装（稳定版），与 peer 下界一致
  "@deepseek-ai/dsh-skill": "0.1.0-rc.6",  // 规则 B：**唯一可安装的**编译靶面，见下
  "@types/node":            "^22.19.0"     // 规则 C：= engines 下界
}
```

`dsh-skill` 的 peer 与 devDep **故意不一致**，这是证明 1/2 的直接后果，不是笔误：

- **peer `^0.1.5-rc.1`** —— 声明对宿主诚实（宿主就是 0.1.5-rc.1）；
- **devDep `0.1.0-rc.6`** —— 宿主版本在本工作区装不上（证明 2），停在最后一个可安装版本。
  这个方向是**保守**的：编译面比宿主更旧 ⇒ 只可能"少用"类型，不可能"用了宿主没有的类型"。

`@deepseek-ai/cordis` 因为 4.0.2 是**稳定版**，可以两者一致，就直接统一到 `4.0.2` ——
顺带把仓库与宿主的 cordis 漂移**归零**。

`dsh-ros2-common` / `dsh-ros2-sidecar` 没有 cordis/dsh-skill peer，只改 `@types/node`。

## 各 PR 的处置（决策表）

| PR | Dependabot 提议 | 处置 | 依据 |
| --- | --- | --- | --- |
| **#42** | cordis peer `^4.0.1` → `^4.0.4` | **拒绝**；改为 `^4.0.2`（= 宿主） | 规则 A + 证明 3：4.0.4 高于宿主，且 `^4.0.2` 已包含 4.0.4 |
| **#46** | dsh-skill `0.1.0-rc.6` → `0.1.0-rc.8`（精确） | **拒绝**；peer 改为 `^0.1.5-rc.1` | 规则 A；rc.8 仍是不可满足的精确预发布 pin |
| **#58** | `@types/node` `^24.13.3` → `^26.6.3` | **拒绝**；改为 `^22.19.0`（向下） | 规则 C：`engines` 下界是 `^22.19.0` |
| **#59** | `dsh-tools` `0.1.0-rc.6` → `0.1.0-rc.8` | **暂不合并** | 运行期依赖，`rc.8` 既非宿主版本也无缺陷证据；宿主版本装不上（证明 2） |

## 生效的验收

改动后本机全绿（Node 24.16.0 / pnpm 11.22.0）：

```console
$ pnpm run typecheck     # 9 包全绿 —— 说明仓库**没有**用到 Node 24+ 独有 API
$ pnpm -r test           # 354 passed / 0 failed（与改动前逐字相同）
$ pnpm run build         # 全绿
```

`@types/node` 从 24 降到 22 **没有引发任何类型错误**，这本身就是一个有价值的结论：
"把类型下界收到 `engines` 下界"在当前代码上是**零成本**的，因此没有理由继续按 24 检查。

## 防复发：Dependabot 的 ignore

策略写进文档还不够——不配置的话，这三个 PR 会**每周重开**。`.github/dependabot.yml`
为"宿主供给"的包加了 `ignore`（见该文件内的注释）：

- `@deepseek-ai/cordis` / `@deepseek-ai/dsh-skill` / `@deepseek-ai/dsh-tools`
  —— **它们要跟随的是 harness，而不是 npm 的最新版**；harness 升级时**手工**一起改；
- `@types/node` 的 `version-update:semver-major` —— 允许 22.x 内的 patch/minor，挡住 23/24/25/26 的大版本。

## 残留观察（本轮未改，留证据）

1. **`@deepseek-ai/schemastery` 仓库 floor `^3.18.4` 高于宿主提供的 `3.18.2`。**
   它是**普通 dependencies**（不是 peer），所以插件会从自己的 `node_modules` 解析 3.18.4，
   即进程里存在**两份 schemastery**。schema 对象是鸭子类型，本轮**没有观测到**故障，
   但"仓库比宿主新"这种方向与规则 A 相反，值得下一轮带着证据再判。
   > **第二十三轮已带证据判定（本条到此为止）。** 证据来自 Dependabot PR #82
   > （floor `^3.18.4` → `^3.18.5`）：CI `check (22)` / `check (24)` 双红，4 个包的
   > **声明产出**失败——
   > `error TS2883: The inferred type of 'Config' cannot be named without a reference to
   > 'Schema' from '.pnpm/@deepseek-ai+schemastery@3.18.4/…'`。
   > 报错里点名的是 **3.18.4** 那份副本，而声明它的 **7** 个包（9 个包里有 7 个）
   > 此刻声明的是 `^3.18.5` ⇒ 工作区里同时存在两份。
   >
   > **但"两份"是这种改法的后果，不是升级的必然后果——上一版写在这里的宽结论是错的。**
   > 本工作区还有一条开发链的边：
   > `@deepseek-ai/dsh-tools@0.1.0-rc.6 → dsh-invariants@0.1.0-rc.8 → schemastery ^3.18.1`，
   > 它被 lockfile 钉在 3.18.4；只抬 7 个 workspace floor 动不到它，于是分叉。
   > 实测：加一条全局 `overrides: {'@deepseek-ai/schemastery': '^3.18.5'}` 让整图一起动之后，
   > lockfile 里只剩 **一个** `schemastery@3.18.5`，`pnpm run build` **全绿**。
   > ⇒ 准确的规则是 **"升一条被两条链共同解析的包，必须整图一起动"**；
   > "floor 不能高于开发链解析出的那一份"把一次 lockfile 惯性说成了硬约束。
   >
   > **仍然拒绝 PR #82**，理由换成下面两条（都可复现）：
   > ① **升级零收益**——把两个 tarball 解开逐字节比：文件清单相同，除 `package.json` 外
   > **全部文件字节相同**（含 `lib/types/index.d.ts`，正是 TS2883 关心的那份声明），
   > `package.json` 只有 `"version"` 与 `@deepseek-ai/cosmokit` `~1.8.5` → `~1.8.6` 两处差异；
   > 而 `pnpm audit` 三档在 3.18.4 + cosmokit 1.8.5 上全绿（没有任何公告指向它们）。
   > ② **方向与规则 A 相反**——宿主提供 3.18.2，floor 已高出两档，再抬一档只会更远。
   > 机械半边：`@deepseek-ai/schemastery` 已进 `.github/dependabot.yml` 的 `ignore`，
   > 免得同一条 patch 每周重开一次（`ignore` 只作用于版本更新，安全更新照旧会报）。
   > 完整实测与判定见维护日志第二十三轮。
2. **`dsh-tools@0.1.0-rc.6` 的运行期 import 会把 9 个 harness 包拉进仓库的 `node_modules`**
   （证明 2 暴露）。也就是除 harness 自己那份之外，还有一份平行副本。
   当前工作正常，但这决定了"关掉 peer 自动安装"这条路走不通。
3. **本文所有数字都可以独立重算**——凡是区间语义的结论都附了可复制的 `node -e` 命令，
   凡是安装行为都附了真实报错。

## 规则 D · peer 解析出来的开发工具要显式声明下界（第二十三轮新增）

规则 A/B/C 管的是**自己写的**声明。还有一种版本**没有任何 importer 写它**：peer。

`vitest` 把 `vite` 声明为 **peer**（`^6.4.0 || ^7.0.0 || ^8.0.0`，非 optional），而本工作区
没有任何包声明过 `vite`。pnpm 于是按"自动安装 peer"的规则，在写 lockfile 那一刻挑了当时
最新的 7.x —— `vite@7.3.6`。这个版本随后被 2026-10-20/21 公布的五条公告覆盖，全部修在 **7.3.7**
（下表是 `pnpm run audit:all` 在 `vite@7.3.6` 上**实测**报出的五条，不是抄来的清单）：

| GHSA | 严重度 | 内容 |
| --- | --- | --- |
| `GHSA-9jrq-w75r-8gcw` | low | Vite：自定义 middleware 导致的跨源脚本执行 |
| `GHSA-rq7h-c2jc-7f22` | moderate | Vite：`server.fs.allow` 之外的文件可被服务（非 Windows） |
| `GHSA-r825-w8mm-5pxw` | moderate | launch-editor：编辑器 CLI 参数误解析 ⇒ 对部分编辑器可任意执行命令 |
| `GHSA-698v-4r3x-3vcv` | moderate | launch-editor：`escapeCmdArgs()` 在 Windows 上不转义 `%` |
| `GHSA-587h-7wmj-h5pm` | **high** | launch-editor：`fs.existsSync()` 存在性检查在 Windows 上可被绕过 |

> **一处必须写清的边界**：五条里两条（`698v…`/`587h…`，含唯一那条 high）是 **Windows-only**，
> 另一条（`r825…`）只在"某些编辑器 + 起 dev server"时可达；而本工作区**从不跑 vite dev server**
> （vitest 只把 vite 当 transform/pool 后端）。所以这个 floor 的收益是
> **关掉 5 个告警 + 不给将来启 dev server 的人留地雷**，不是"修掉一条当前可打的洞"。
> 把它当成后者写，就是第二十二轮那条教训的反面——**结论要覆盖它真正证明的那一段**。

**为什么三个自动渠道都没解决它：**

| 渠道 | 结果 | 原因 |
| --- | --- | --- |
| `pnpm update vite` | **no-op** | peer 不是任何 importer 的依赖边，`update <pkg>` 没有可改的 specifier |
| Dependabot 版本更新 | 没开 PR | 同上：没有 importer 可改 |
| Dependabot **安全**更新 | **连跑三次全失败**（2026-10-23/24） | 同上；它只能改 lockfile，改不动一个没有边的包 |
| `pnpm run audit:all` | ✅ 抓到了（5 条） | 但只在本地手动跑，没人跑就等于没有 |

**规则 D：凡是"只有 peer 边"的开发工具，必须在 `pnpm-workspace.yaml` 的 `overrides`
里写下界，并在注释里写清"为什么不能用 `parent>child` 收窄"。** 本轮落地：

```yaml
overrides:
  'postcss>source-map-js': '^1.2.2'   # 有 importer 边 ⇒ 可以按父包收窄
  'vite': '^7.3.7'                    # 只有 peer 边 ⇒ 无法收窄，只能全局声明
```

**可证伪（两个方向都实测过，第二十三轮）**：把 `'vite': '^7.3.7'` 改成精确的 `'7.3.6'`
重解 lockfile 之后——

| 命令 | `vite@7.3.6` | `vite@7.3.7` |
| --- | --- | --- |
| `pnpm run audit`（**prod**, high） | `No known vulnerabilities found`，**exit 0** | 同左 |
| `pnpm run audit:dev-high`（dev, high） | 报 1 条 high，**exit 1** | `No known…`，exit 0 |
| `pnpm run audit:all` | **5 vulnerabilities**（1 low / 3 moderate / 1 high），exit 1 | `No known…`，exit 0 |

> **第二行与第一行的对比就是这条规则存在的全部理由**：既有的 CI 门禁是
> `audit --prod --audit-level high`，它在 `vite@7.3.6` 上**照样绿**——因为 `vite` 只经
> `vitest` 的 peer 边存在，在被 audit 的图里**不是 prod 依赖**。所以"CI 绿"从来没覆盖过它，
> 这不属于 CI 失效，而属于**门禁的可见范围从来没包括这一块**。

## 防复发 2 · 定时复核（第二十三轮新增）

上面那张表真正的缺口不是"哪个命令不好用"，而是**没有任何东西在无 push 的情况下复核依赖图**：
CI 只在 push 时跑，CodeQL 只读源码，Dependabot 报警了但修不动。于是新增
`.github/workflows/audit.yml`：每周一 `cron: '41 2 * * 1'`（与 CodeQL 同一天、不同分钟）
跑 `pnpm run audit` + `pnpm run audit:dev-high`（新增脚本，dev 图只卡 high/critical）。

只卡 high/critical 是刻意的：dev 图的公告流被 Windows-only、dev-server 类的中低危塞满
（launch-editor、`server.fs` 路径），而这些包的消费者根本到不了那些代码路径。
把它们也做成门禁，就等于把这条 job 永久涂红——那正是"噪声淹没信号"的教科书做法。

确实无解的那一条，**写进 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas` 并留下理由**，
而不是删掉这个 job。

> **第二十三轮修正（上一版这里写的是 `package.json` 的 `pnpm.auditConfig`，那是错的）**：
> pnpm 11 **不再读 `package.json` 的 `pnpm` 字段**——本仓库 `pnpm-workspace.yaml` 顶部的注释
> 早就写了这件事，而这条运维指示恰好违反了它。实测（把两处都写上，看 pnpm 认哪个）：
>
> ```console
> $ # package.json: {"pnpm":{"auditConfig":{"ignoreGhsas":["GHSA-…"]}}}  +  pnpm-workspace.yaml 同名条目
> $ pnpm install --frozen-lockfile
> [WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were
>        ignored: "pnpm.auditConfig". See https://pnpm.io/settings for the new home of each setting.
> $ pnpm config list | grep -A3 auditConfig
>   "auditConfig": { "ignoreGhsas": [ "GHSA-test-from-workspace-yaml" ] }    # ← 只有 workspace.yaml 那份生效
> ```
>
> 这条修正的价值不在措辞：**按旧写法操作，ignore 会静默不生效**，于是 job 永远红着，
> 而人以为已经"合法豁免"过了——正是这个 workflow 本身要防的那个失败模式。
