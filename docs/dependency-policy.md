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

选项 2 要把 devDep 提到宿主版本。实测 `pnpm install` 直接失败：

```console
$ pnpm install            # devDep 提到 dsh-skill@0.1.5-rc.1 之后
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for
  @deepseek-ai/dsh-scope@>=0.1.5 <0.2.0-0 while fetching it from https://registry.npmjs.org/
```

注意两点：`@deepseek-ai/dsh-scope@0.1.5-rc.1` **在 npm 上是存在的**，
但 pnpm 把 `^0.1.5-rc.1` 规范化成 `>=0.1.5 <0.2.0-0`（丢了预发布标记），于是找不到任何**稳定** 0.1.5。
这是证明 1 那个语义陷阱在**依赖解析器**里的同一个形状。

试着绕开——关掉 peer 自动安装（`auto-install-peers=false`）确实能让 `dsh-skill@0.1.5-rc.1` 装上，
但**会把真正需要的包一起拆掉**：

```console
$ ./node_modules/.bin/vitest run          # auto-install-peers=false
Error: Cannot find package '@deepseek-ai/dsh-scope' imported from
  …/.pnpm/@deepseek-ai+dsh-tools@0.1.0-rc.6…/dsh-tools/lib/index.js
```

`@deepseek-ai/dsh-tools` 在**运行期真的 import** 了 `dsh-scope` / `dsh-llm` / `dsh-session` 等 9 个 harness 包；
它们平时是靠 peer 自动安装补齐的。顺带暴露出一个**既有的隐性依赖**：vitest 的 `vite` peer
也是靠自动安装补上的（关掉后 `ERR_MODULE_NOT_FOUND`）。

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
2. **`dsh-tools@0.1.0-rc.6` 的运行期 import 会把 9 个 harness 包拉进仓库的 `node_modules`**
   （证明 2 暴露）。也就是除 harness 自己那份之外，还有一份平行副本。
   当前工作正常，但这决定了"关掉 peer 自动安装"这条路走不通。
3. **本文所有数字都可以独立重算**——凡是区间语义的结论都附了可复制的 `node -e` 命令，
   凡是安装行为都附了真实报错。
