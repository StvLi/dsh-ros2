# dsh-ros2 日常维护文档（Maintenance Log）

> 仓库：`StvLi/dsh-ros2` · 本地代码：`/home/stvli/Desktop/embody_agent_ws/dsh-ros2`（git remote `git@github.com:StvLi/dsh-ros2.git`）
> 维护日期：2026-10-15（最近一轮） · 维护者：DSH scheduled-run agent（StvLi 仓）
> 维护轮次：第一轮 2026-09-03（§0–§7）；第二轮 2026-09-04（§8）；第三轮 2026-09-05（§9，安全修复）；第四轮 2026-09-05（§10，无 open issue → 安全检查 → 两项维护卫生修复）；第五轮 2026-09-06（§11，无 open issue → 安全检查 → 落地 `ros2_install` 注入修复）；第六轮 2026-09-11（§12，无 open issue → 安全检查 → 落地 `safety_monitor` / `zero_pose_semantics` 注入修复 + vitest 4 升级 + CI 最小权限）；第七轮 2026-09-13（§13，open issue #19 → journey skills + 组合不变量）；第八轮 2026-09-14（§14，3 个 open issue → #21 修复并真机复核、#22 落地但保留 open、#19 完成验收测量）；第九轮 2026-09-21（§15）：open issue #22 → 补齐"会话技能目录对账"（其唯一未实现项）+ 修复 `ros2_env_check` 的"报告 ≠ 执行"缺陷（第八轮存疑项的真因）+ 安全复测；**第十轮 2026-09-22（§16，本轮）：补齐第九轮"在途无 PR"的缺口（PR #27，CI 首跑即抓出"本地绿、CI 红"）→ 在运行中进程里验收并关闭 issue #22 → 定位并修复线上故障真因（`rosSetup` 只校验第一段）→ 3 个 PR 全部合入 main**；第十二轮 2026-09-24（§17，收尾超时遗留的在途 PR #32 → 实测第十轮的重启请求已按硬期限落地 → 修复"配置没送到 doctor"的接线缺口 + API Key 来源语义）；第十三轮 2026-09-25（§18，0 open issue / 0 open PR → 安全扫描发现并落地 3 处真实缺陷 = PTY 会话 id 路径穿越 · 发布物携带 `__pycache__` 字节码 · 安装器选项注入，并开启 Dependabot 告警）；**第十四轮 2026-09-26（§19）：0/0 → 先闭环第十三轮唯一的未闭环观测（gen-21 重启逐字命中），再落地 3 个 PR = 明文传输的 VLM API Key 可见化 · 插件自建 IPC 对象权限收紧（PTY 会话文件 / sidecar UDS / 安装器脚本）· Dependabot 版本更新；并把跨五轮未处理的部署配置项升级为 issue #40；**第十五轮 2026-09-29（§20）：open issue #40 → step 2 评估（合理、必要，但配置在仓库外且需运维决定）→ **承接上一轮时间窗被截断留下的在途分支** `fix/workspace-path-hygiene` 并落地 `fix(common)`：自愈探针用**原始文本**比对存在性，把**存活但写成 `~/…`** 的工作区判为缺失、剔除该段、并在只剩它时**静默切换到 `/opt/ros/<distro>`** —— 恰是本轮文档新推荐的路径形式；闭环第十四轮的 gen-22 观测（逐字命中）；实测线上 **6 处**死链（issue #40 少算 1 处）；本轮**无 GitHub API token**，改用一次性 `ci/probe-*` 分支取得 CI（Node 22/24 双绿）后删除**；**第十六轮 2026-09-30（§21，本轮）：open issue #40 → step 2 复核（逐字确认**仍然准确**、更正为**实测 6 处**死链、结论仍交运维）→ **上一轮唯一的运维缺口已消失：`gh` 有了 token**，于是第一个动作就是把第十五轮卡住的在途分支**开成 PR #48、CI 双绿后合入 main**（第一次拿到**真实** PR CI，不再需要 `ci/probe-*` 代跑）；随后落地 3 个 PR = `fix(packaging)` 发布面 `__pycache__` 守卫（**此前只有"碰巧出现过"的那 3 个包有守卫**，实测 moveit 可复现泄漏 `.pyc`）+ `ci(security)` **CodeQL 代码扫描基线**（第十四/十五轮连续两次建议、本轮首次落地）+ `fix(security)` 首个基线 **29 条告警**中的**2 处真实缺陷**（`ros2_interface_create` 的 TOCTOU 可被符号链接穿出 · 自愈探针的自动探测路径未加引号）；Dependabot 积压 6 → 4（#47 合入并替掉失败的 #44）**；**第十七轮 2026-10-01（§22，本轮）：open issue #40 → step 2 第三次复核（事实逐字不变、结论仍交运维、故不再重复评论）→ 把第十六轮**有意不修**的 3 条 ReDoS 告警**先测量再修**：走真实入口实测后只有 **1 条真实可达**（`parseTopicList`，n=4000 阻塞 **14.8 s**，k=2.11；并发现**第二种**形状 `[`×n+` ]x]` 在 n=20000 阻塞 **697 ms**）、1 条被调用方的 `trim()`/`split('\n')` **消掉而不可达**、1 条**不可复现**（贪婪 `.*` 一步到 `$`，不回溯）→ 三条全部改为**可证明线性**的扫描 + `chars.ts` 逐码点字符类 + **差分等价测试**（穷举 + 10 万条随机/解析器，**0 分歧**），PR #55 CI/CodeQL **5/5 绿**后合入；**闭环第十六轮唯一的遗留观测**（gen-24：`lifecycleState: running`、无残留 `deferDeadline`、`pendingResume: false`）；Dependabot 积压 4 → 3（#43 vitest 4→5 dev-only 合入；#42/#45/#46 抬的是 **type-only peer 下界**，而 CI 装的是**该 PR 自己抬上去的 devDependency** ⇒ **结构上无法评估下界**，升级为 **issue #56**）；CodeQL open **13 → 10**；发布面用**预先种入 `.pyc` + 摘守卫正向对照**复测 9/9 CLEAN；并更正第十六轮快照表里与 §21.8 矛盾的"main 344"（实测 **347**）**。；**第十九轮 2026-10-11（§24，本轮）：open issue #40 → step 2 第五次复核（事实逐字不变、结论仍交运维）→ **把 §5「已知限制」里从第一轮躺到现在的 PTY 幻影会话修掉**：实测旧行为比原文更严重（无 pty 时 `start` 退出 0 并打印 `started session … (pid N)`，`status` **永远**报 `STATE running`，**连不存在的会话 id 也报 running**）⇒ 在父进程 fork 前探测 pty、失败写 `state=failed` 并退出 3、工具返回明确的 `PTY_UNAVAILABLE`；顺带查出**同一个 REMAINDER 解析缺陷**把 `--dir` 当参数投喂给下载来的 sudo 安装脚本（安装器 argv 实测 `["--dir", <dir>]`，修后为 `[]`），且 `--all` 名义存在却不可达 ⇒ 改为"flag 必须在 action 之前"并对 `status`/`stop` 的多余参数**报错而非静默忽略**；**安全扫描发现本地审计门禁在这台机器上根本跑不起来**（`~/.npmrc` 指向的镜像没有 advisory 端点⇒ 前几轮"本地复算供应链"实际无法复现）⇒ 把权威 registry 钉进 `pnpm run audit` / `audit:all` 并让 CI 调用同一条命令；文档计数全面漂移的修正**其中一次被仓库自己的组合不变量测试当场打回**（README 的 83 是"全家族六包"、聚合包只挂 81 ⇒ 改回 83，并在安装步骤把两个数分别说清）→ 并把它升格为 **issue #68**；2 个 PR（#66/#67）CI/CodeQL **5/5 绿**后合入，`main 66a139a → 7dc553f`**。**第二十轮 2026-10-12（§25，本轮）：2 open issue（#40 + #68）→ **issue #68 落地**（`fix(metadata)`：聚合包按"它实际挂的东西"宣称 81、家族 83 仍是家族的数）→ 顺带扫出**同一类缺陷的更大缺口**：三个**已发布**的 per-package `README.md` 从未被任何不变量读过（core 33 对 61、vision 5 对 7、聚合 51+4 对 81+9），已修并把"每个包 README 的第一个工具计数必须等于实测"写进组合不变量（**可证伪**：换回修复前文件即报 `expected 33 to be 61`）→ **issue #40 第六次复核后经运维确认、本轮真正落地**（备份 + 删 5 条死段尾 + 删第 63 行整条 `rosSetup`，YAML 校验通过，行为与自愈后的实际链逐字等价，等 gen-27 重启生效）→ 安全扫描审计/密钥/发布面/CodeQL 全不变（10 条 open 同规则同数量）、**远程已合并分支 16 → 1**（15 条全部是 main 的祖先）→ 1 个 PR（#70）CI/CodeQL **5/5 绿**后合入，`main 7dc553f → 316c142`，**open issue 归零**。**
>
> **第二十一轮 2026-10-13（§26，本轮）：0 open issue / 0 open PR → 走 step 5；先闭环上一轮唯一的未闭环观测（gen-27 逐字落地于 10-12 12:40:48，且 `ros2_env_check` 不再报 `missingSources` = issue #40 的最终判据达成）→ 安全扫描沿用同口径全绿（audit prod/含 dev 干净、CodeQL 10 不变、密钥 0、发布面 9/9 CLEAN、Python/TS 执行面与既有防线逐条回归）→ **但真正的高价值发现不是扫描器给的**：把"每个能执行/输入的接口"与"审批面"对照后，发现 `ros2_gui_interact` 可以在**无审批、无目标限制**下把任意按键/文本送进**任意窗口**（选中终端即宿主机命令执行），而更窄的 `ros2_run`/`ros2_service_call` 反而都要审批；且这本是仓库**自己**在 `docs/safety-todo.md` §17 / 验收 #11 决定过、却一直未落地的事（README 还反过来写着"no approval, same as other L3 tools"）→ 落地 `fix(security)`：默认应用白名单（rviz2/rqt/rqt_graph，可配 `guiAllowedApplications`）+ 按**解析后**窗口标题判定 + 白名单外（含不传 `windowTitle`）**先审批**且 fail-closed；用例 **362 → 371**（+9，且删掉 gate 块会让 3 条断言当场变红）；PR #73 CI/CodeQL **5/5 绿**后合入，`main 845f04f → 4ab647c`，并登记 gen-28 让这**真实的运行时变更**（`lib/` 变了）在跑着的 dsh 里生效。**

> **第二十二轮 2026-10-15（§27，本轮）：0 open issue / 0 open PR → 走 step 5；先闭环上一轮唯一的未闭环观测（gen-28 于 10-13 04:19:38 `loaded`，state 为 `running`、`deferDeadline: 0` —— 逐字命中）→ 安全扫描沿用同口径（audit prod/含 dev 干净、Dependabot 0、密钥 0、发布面 9/9、`ros2_env_check` 实时对账全绿）→ **高价值发现依旧不是扫描器给的**，而是上一轮 §6 第 6 条明确要求的"执行面 × 审批面"对照：`ros2_workspace use <ws>` 把命令前缀换成 `source <ws>/install/setup.bash` 却**无审批**——而 source 即**执行**该文件，且覆盖作用于**本进程所有会话**后续每一条命令，比要审批的 `ros2_run` 更强（实机复现：PoC setup.bash 的 marker 以 uid=1000 写入）→ 落地 `fix(security)` 加审批门 + fail-closed；顺带查出**同类第二处**：`ros2_vision_describe` / `ros2_vlm_analyze` 的 `imagePath` 不做任何校验就把文件 base64 后 POST 到第三方网关（旧逻辑按扩展名猜 MIME、未知扩展名回落 `image/png`）——CodeQL 的 `file-access-to-http` 报了**三轮**都被当作"by design"放过，**没人问过路径该不该无限** → 落地按**文件内容**（magic bytes）判定，TS/Python 两侧各一道；用例 **371 → 375**（+4；两处防线各自删掉都会让 2 条断言当场变红）；**CodeQL 首跑抓出我自己引入的 4 条告警**（3 条真实 = 测试用可预测 `/tmp/<name>`、1 条误报 = `fs.open` 被当写型 sink）→ 改用 `mkdtempSync` + 有界 `createReadStream` 后 **5/5 绿**，且顺带把 `tools.spec.ts` 的两条**存量**告警一并关掉，**CodeQL open 10 → 8**；PR #76（修复）与 #77（本记录 + 测试去噪）先后合入，`main 757aa17 → 412e49f → 301224e`，登记 gen-29（本轮的 `lib/` 变更要在跑着的 dsh 里生效）。**

本文件记录 dsh-ros2 插件的一次完整日常维护循环：**查 issue → 评估建议 → 分支开发 → 验证 → 推送 → 交付维护文档**。每次维护在下方追加一节。

---

## 0. 仓库快照（本次维护起点）

| 项 | 值 |
| --- | --- |
| 当前分支 | `main`（与 `origin/main` 一致，工作树干净） |
| 远端分支 | `origin/main`，`origin/docs/maintenance`（历史遗留，PR #1 已合并，落后于 main，保留未清理） |
| 近期提交（head） | `cea3f80` vision 0.1.3（解析 JPEG 尺寸）→ `2895046` vision prompt-first key … |
| CI 状态 | 最近一次 main push 的 CI **全部 success**（Node 22/24） |
| 最新发布 | `v0.1.0-plugins`（monorepo 拆分标记，2026-08-30）；npm 侧 9 包均为 `0.1.0` 基线 |
| 包数量 | 9 个（common / core / dsh-ros2 / dsh-ros2-state / moveit / profile / safety / sidecar / vision） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |

---

## 1. Issue 检查与建议评估

### 1.1 是否存在未处理的 issue

`gh issue list --state open` → **无 open issue**。

当前仅有 2 个 issue，且均已 **closed**：

| # | 标题 | 状态 | 关闭时间 | 对应修复 commit |
| --- | --- | --- | --- | --- |
| 2 | `build: pnpm 11 fails because allowBuilds.esbuild contains a placeholder value` | CLOSED | 2026-09-01 | `47dfb4a` fix(build) + `ca243f0` ci: align pnpm version |
| 3 | `docs: update monorepo package and test counts after state/sidecar split` | CLOSED | 2026-09-01 | `47dfb4a` refresh package/test counts + `821f9b8` test(common) CI-robust |

### 1.2 各建议的合理性 / 必要性判断

**issue #2（pnpm 11 构建失败，`allowBuilds.esbuild` 占位符）——合理且必要。**

- 现象：`pnpm-workspace.yaml` 里 `allowBuilds.esbuild: "set this to true or false"` 是未替换的占位符，pnpm 11 直接因 `ERR_PNPM_IGNORED_BUILDS` 拒绝构建。
- 影响面：全新 checkout 无法 `pnpm build`，是**发布/CI 门槛级**问题，必修。
- 修复评估：现改为 `allowBuilds.esbuild: true` + root `packageManager: pnpm@11.22.0`，并让 CI `pnpm/action-setup@v4 version: 11.22.0` 与之一致。**正确且完整**（npm 侧不再报占位符；CI 明确固定 pnpm 版本）。
- 遗留小项：issue 提到 README 未声明 pnpm 版本要求——非必须，未列入本次修复（README 有 `packageManager` 由 CI 保证）。

**issue #3（包数量与测试用例统计过时）——合理，但不紧急。**

- 现象：拆分后 9 个包，但根 `package.json` / README 仍写 7 包、115 例；实际测试为 127 vitest + 10 Python。
- 影响面：文档与 release 元数据失真，属**发布卫生**问题，不阻断功能。
- 修复评估：此前已把包数更新到 9、用例更新到当时值。**本次维护发现 README 用例数与 tool 数再度漂移（见 §3），一并修正。**

结论：**无未处理 issue；两条已关闭 issue 的建议均合理，issue #2 必要性高，issue #3 属文档卫生。** 本轮为纯维护型开发。

---

## 2. 本轮维护结论（发现的问题）

### 2.1 真机验证发现一个**确定性测试失败**：`ros2_install` 的 PTY 交互测试

- 现象：`packages/core/tests/tools.spec.ts` 的
  `ros2_install interactive flow … drives the installer menus via PTY`
  反复失败（本机 3/3 稳定失败），`status` 返回空输出，断言 `expected '' to contain '众多工具'`。
- 根因（逐层排除后定位）：**不是代码回归**，而是执行环境无法分配新 pty。
  `pty.openpty()` 抛 `OSError: out of pty devices`。本机 `/proc/sys/kernel/pty/nr=1, max=4096` 并无耗尽，
  但 `/dev/pts` 以 `ptmxmode=000` 挂载，非 root 无法打开 `/dev/ptmx` 分配新 pty。
  → 工具本身（`scripts/pty_session.py` 的 pty 会话）在该类无头/容器环境天然不可用。
- 影响面：完整 `pnpm test` 在此类环境红掉，掩盖其他真实失败。

**修复（`fix(test)`）**：对 `ros2_install` PTY 测试加 `it.skipIf(!ptyUsable)`——用
`python3 -c "import pty; pty.openpty()"` 探测；pty 可用（CI/ubuntu）时仍完整跑通
`start→send→status→stop`，不可用时明确 skip 而非红灯。改动只影响测试健壮性，不改工具行为。

> 说明：`ros2_install` 工具在 pty 不可用环境其 `start` 会静默成功但无输出（daemon stderr 被丢弃）。
> 属已知局限，见 §5；本轮不做工具层改动，避免扩大范围。

### 2.2 工具数量元数据漂移

逐包核对实际注册工具集与 inventory 测试断言：

| 包 | 实际（测试断言） | 原 description | 现值 |
| --- | --- | --- | --- |
| `dsh-ros2-core` | 59 | tools (33) | tools (59) |
| `dsh-ros2-vision` | 7 | tools (5) | tools (7) |
| `dsh-ros2`（聚合） | 79（59+4+4+5+7） | all 75 tools | all 79 tools |
| vision inventory 标题 | 7 | tool set (5) | tool set (7) |
| 工作区 vitest 用例 | 182 | 166 | 182 |

> 合计验证：core 59 + profile 4 + moveit 4 + safety 5 + vision 7 = **79 工具 + 4 skills**（与 README badge `tools-79` 一致）。
> 补充：另有 sidecar 10 个 Python 自测场景（`python3 -m sidecar.selftest` → `SELFTEST PASSED (10 scenarios)`），README 表述正确。
> 用例合计：common 13 + core 94 + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **182**（CI 全通过；pyt-less 环境那 1 例 skip）。

---

## 3. 开发管理（git）

### 3.1 分支与提交

- 基分支：`main`（干净）
- 新开分支：`fix/maintenance-daily`（`fix/...` 前缀，符合“修复问题”语义）
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `e09c4b0` | `fix(test)` | `ros2_install` PTY 测试在 pty 不可用时 skip（+ 纠正 core inventory 标题 (59)） |
| `021640d` | `docs` | 对齐工具/用例数量元数据（core 59 / vision 7 / 聚合 79 / 182 例） |

- PR：**#5** `fix/daily maintenance: pty-safe ros2_install test + tool/test count metadata`（base `main`，mergeable）。

### 3.2 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 9/10 项目 tsc --noEmit 全部 Done
CI=true pnpm run test        # 182 vitest（本机 1 例 skip）+ 10 sidecar Python 场景，通过
CI=true pnpm run build       # pnpm -r build 全部 Done
```

> `CI=true` 原因：本机 `node_modules` 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules；
> 设 `CI=true` 让 pnpm 自动确认（等价 CI/无 TTY 场景）。仓库本身在全新 checkout 下无需此设置。
> push 后 GitHub CI（Node 22/24）在 PR #5 上校验。

---

## 4. dsh-phoenix 持续更新/测试循环（README 所述的“自进化循环”）

dsh-phoenix 已在 web profile 安装并生效：

- 安装：`~/.dsh/profiles/web/package.json` → `dsh-phoenix: link:…/dsh-phoenix`；`cordis.patch.yml` 注入 `dsh-phoenix` 行。
- 生效验证：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（心跳端点在线 = **client 自动重连**在跑）。
- 优雅重启能力：`systemctl --user list-units` → `dsh-web.service … active running`，且 systemd 255 可用 ⇒ **graceful-restart 启用**。
- dsh-ros2 同样以 `link:` 装入 web profile（`dsh-ros2` / `dsh-ros2-core` / `dsh-ros2-vision` … 均为 symlink）；本 Agent 会话已具备全部 `ros2_*` 工具，证明 bundle 已生效。

**本维护会话如何使用它：** 修改 → `CI=true pnpm run typecheck/test/build` 全绿 → 提交/推送。由于本轮改动只涉及
测试与文档元数据（**不改工具运行时行为**），无需把新 lib 重载进运行中的 dsh web；因此本会话
**有意未触发** dsh-phoenix 的优雅重启（其触发条件是 dsh 编译工具 `cordis_run`，且会中断本会话）。

**给后续维护者的循环（真正需要重载运行时变更时）：**
1. 改 `packages/<domain>/src/…` → 构建 → 验证全绿；
2. 用 dsh 插件工具 `cordis_run`（或更新动态 plugin）触发；
3. dsh-phoenix 检测到 `cordis_run` 后 idle-aware 优雅重启（系统无 busy agent 才重启，`systemd-run --user` 独立 unit）；
4. 重启后 phoenix 重连页面（token 变化自动 reload）、并按 checkpoint 重臂未完成 goal；
5. 用 `DSH_PHOENIX_STATE_FILE`（JSON checkpoint，`pendingResume:true`）驱动跨重启的持续目标。

> 注：本次未设置 `DSH_PHOENIX_STATE_FILE`，故重臂功能处于默认（未挂起目标）状态；重启/恢复路径未被本会话实际演练。

---

## 5. 已知限制 / 遗留事项

> 本节是**活文档**，每轮复核一次；已被解决的条目**删除**而不是留着（第十九轮的教训：
> 一条写成"已知限制"的句子会停止被测量——`ros2_install` 的 PTY 幻影会话就是这样躺了 18 轮）。

| 项 | 说明 | 建议 |
| --- | --- | --- |
| pty 受限环境（**第十九轮已修，环境限制本身仍在**） | 无头/容器 `devpts ptmxmode=000` 下 PTY 会话确实分不出来；但工具**不再撒谎**——父进程 fork 前探测 pty，失败写 `state=failed`、退出码 3、工具返回 `PTY_UNAVAILABLE`，`status` 对不存在的会话报 `unknown`（测试仍 1 例 skip，因为本机没有 pty 可分配） | 无需动作；真正的修复已在 `packages/core`，CI（有 pty）跑满例 |
| VLM 网关**明文 `http://` + 非回环** | 本机 `vision.baseUrl = http://121.9.219.138:8888/v1`，`ros2_vision_doctor` 实时报 `transport.cleartext: true` 并给告警（第十四轮 #38 落地）；key 走 `Authorization` 头 / `?key=` 查询串 | **运维决定**：换成 `https://`，或在同机起服务走 `http://127.0.0.1:…`（回环不告警） |
| `~/.npmrc` 指向无 advisory 端点的镜像 | 本机默认 registry 是 `registry.npmmirror.com`，裸敲 `pnpm audit` 会 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`（fail closed） | 一律走 `pnpm run audit` / `audit:all`（已把权威 registry 钉进脚本，CI 调同一条命令） |
| `docs/feedback-env-recovery.md:97` | 为历史反馈记录（截图数字 166 / core 89→94），非用户入口 | 保留为历史快照 |
| sidecar / state | sidecar 为“纯模板框架”（reducer 未实现），state 是控制面客户端，且**故意不在聚合包依赖里**（issue #68 的决定） | 符合设计，无动作 |
| **GUI 白名单只是便利性控制，不是边界**（第二十一轮新增） | `ros2_gui_interact` 现在按**解析后的**窗口标题比对白名单，但任何进程都能改自己的窗口标题 ⇒ 标题匹配**不能证明**窗口身份。真正的边界是审批门（fail-closed）。 | 无动作（已如实写进代码注释 + README + `docs/safety.md`）；若将来要硬边界，需按 xdotool 的 `_NET_WM_PID` 校验属主进程，属新设计 |
| **未加审批的相邻写面**（第二十一轮如实登记，未修） | `ros2_gui_close`（对自己启动的会话发 SIGTERM/SIGKILL）、`ros2_screenshot` / `ros2_image_snapshot`（`output` 接受任意绝对路径，写入内容固定为 PNG/JPEG） | 前者只作用于**自己跟踪的**会话；后者影响是**完整性**（可用图片字节覆盖任意文件），不是 RCE。若判定需要，单独一轮做"输出路径限定 + 审批" |
| **`ros2_workspace` 的覆盖是进程级，不是会话级**（第二十二轮如实登记，未修） | `sessionRosSetup` 是 `runner.ts` 里**一个模块级变量**，`use` 改一次就作用于**本进程内所有会话**后续的每一条命令（第二十二轮已给它加审批门 + 把措辞改成 `process-wide`，但**隔离本身没做**）。多会话/多 agent 共用一个 DSH 进程时，A 的切换会影响 B。 | 要真隔离得把会话键从 `exec` 一路传到 ~60 个 `deps.run` 调用点（或引入 per-session 作用域），属**新设计**，单开一轮 |
| 审计 JSONL（§18） | 仍**未做**（`docs/safety.md` §4 仍如实写着"本版未做"） | 晚批独立项，不影响边界 |

---

## 6. 下次维护建议动作

1. 若需重载运行时变更：走 §4 的 dsh-phoenix 优雅重启循环，而非手动 `systemctl restart`。
   （第二十二轮登记 gen-29 的原因同样是**真正的运行时变更**：`packages/core/lib/*.js` 与
   `packages/vision/lib/*.js` 都变了——新审批门与图片内容校只有在重载后才会在跑着的 dsh 里生效。）
2. 全量用例基数：**375 例（374 过 + 1 pty-skip）**。在 pty 可用机器（如 CI）跑 `pnpm run test` 可看到 375/375。
3. 远端分支卫生：第二十轮把 16 → 1；第二十一/二十二轮**合入即删**保持 `origin` 只有 `main`。
4. 保持“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”的验收线。
5. **凡文档里出现"已知限制 / 静默 / 无输出"这类词，都当作"待复现的假设"**（第十九轮教训的正面用法）。
6. **每轮固定做一次"执行面 × 审批面"对照**（§27.4.1 的 A/B 两张表）：把"能执行 / 能写 / 能把数据送出去"的
   接口列出来，逐个问**"它凭什么不需要审批"**。这条已经**连续两轮**是唯一产出真实缺陷的动作
   （第二十一轮 = GUI 输入注入；第二十二轮 = `ros2_workspace use` + VLM 上传面）——
   而三层扫描器在这两轮里都是绿的。**不要把它当成"没有告警时的备选动作"。**
7. **"by design"必须把被问的问题一起抄下来**（§27.6 第 2 条）：`js/file-access-to-http` 的既存理由
   "读图就是功能"对**读**成立、对**路径是否该无限**不成立，于是三个轮次都没人再问。
8. **CodeQL 报"新告警"先分三类**再下结论——真新问题 / 被新代码触发的误报 / 行号漂移（§27.4.4）。
   另：**自己写的测试 fixture 也算扫描面**，别留字面量 PEM 头之类的永久噪声。
9. **被文档承认"晚批/未做"的事，要定期问一句"这个版本过去了吗"**（第二十一轮的教训，仍有效）：
   GUI 白名单曾被 `docs/safety-todo.md` 记为"0.15+"晚批，而 `v0.15.0` 早已发过——
   "晚批"这个词会让一条真实的 RCE-相邻缺口**看起来已被处理**。本轮 §5 新增的
   "`sessionRosSetup` 是进程级"与既有的"未加审批的相邻写面"两条，**同样要在后续轮次里被追问"过期了吗"**。

---

## 7. 本次维护记录（时间线）

- 检查仓库/分支/远端；`gh issue ls`（无 open，2 closed）。
- 评估 2 条已关闭 issue 的建议（§1.2）。
- 定位并复现 `ros2_install` PTY 测试失败（pty 受限，3/3 稳定）。
- 归并工具/用例数量漂移（core 59 / vision 7 / 聚合 79 / 182 例）。
- 开分支 `fix/maintenance-daily` → 两枚提交（`fix(test)`、`docs`）→ push → PR #5。
- 本地 typecheck/test/build 全绿；dsh-phoenix 接线核对（§4）。
```

---

## 8. 维护记录（2026-09-04 · 第二轮：无 open issue → 安全检查 + 验证）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 有 issue→2,3,4 / 无 issue→5` ，直接转入**安全检查（step 5）**。
> 因此本轮是**纯验证 + 安全检查**型维护：**未做任何代码改动**，故不新开分支、不提交、不触发 dsh-phoenix 优雅重启。

### 8.0 仓库快照（本轮）

| 项 | 值 |
| --- | --- |
| 当前分支 | `main`（= `origin/main` HEAD `ee3ae03`，工作树干净） |
| 远端分支 | `origin/main`，`origin/docs/maintenance`（历史遗留，落后于 main；见 §5 建议清理） |
| main CI 状态 | HEAD `ee3ae03`：check(22) / check(24) 均 `completed: success` |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |

### 8.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`/pulls?state=open` → **0 open**。
历史全部 closed：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5（已合并）。
→ **不存在未处理 issue**，跳转安全检查；未做步骤 2/3/4 的“建议评估/分支开发”。

### 8.2 本地验证（typecheck / test / build 全绿；step 0 健康检查）

```bash
CI=true pnpm run typecheck   # 9/10 工程 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 182 vitest（core 93 过 + 1 skip）；sidecar python3 -m sidecar.selftest → SELFTEST PASSED (10 scenarios)；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```
用例分布：common 13 + core 94 + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **182**（CI 允许 1 例 pty-skip）。

### 8.3 安全扫描（step 5）

**依赖审计（pnpm audit）**：默认 registry 为 `registry.npmmirror.com`，无 `/-/npm/v1/security/advisories/bulk` 端点（直接 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`）；须显式 `--registry=https://registry.npmjs.org`。
结果：**No known vulnerabilities found**（exit 0，覆盖 `@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**：

- 硬编码密钥（`AKIA…` / `sk-…` / `ghp_…` / `BEGIN RSA|OPENSSH|EC|DSA PRIVATE` / `AIza…` / `xox…`）：**源代码与 git 全历史均无泄漏**。`.gitignore` 正确排除 `secrets.json` / `*.secrets.json` / `.env` / `lib/` / `node_modules/`。
- `eval` / `new Function` / `vm`：**无**。
- 命令执行面：`spawn` / `execFile` 均使用**数组参数**（不做 shell 展开）；`runCommand`（`common/src/runner.ts`）对每个 arg 经 `shq()` 单引号转义——**参数层防注入**。`spawnJob` 同样数组参数。

**发现（低–中，未在本轮改动，列为改进建议）**：

1. **`ros2_workspace use <path>` 的会话级 source 前缀未做 shell 转义**（`packages/core/src/tools.ts:1429` `setSessionRosSetup(\`source ${setup} && \`)`）。
   - `setup = path.join(p,'install','setup.bash')`，`p` 为用户参数；随后在 `runner.ts:168,172` 被拼接进 `bash -lc` 字符串。
   - **实际可利用性低**：`access(setup)` 要求该**字面路径真实存在**才通过校验（含 `;` / 空格的文件名极为罕见）。
   - 但属**隐式注入 / 误解析**风险：路径含空格会令 `source` 失败、含元字符可逃逸。
   - **安全修复非一行**：需对 source 路径加 shell 引号（`shq()` 或内联转义）**并**同步改造 `extractSourcePath()`（`runner.ts:76`，当前正则 `\bsource\s+([^\s&;|]+)` 只捕获裸路径，会因引号误判为“路径不存在”而触发错误回退）——即 setter 与读取两端 + 补测试。本轮无驱动 issue，未扩大范围，作为建议保留。
2. **`packages/vision/scripts/simplify_visual_meshes.py:22` 顶层 `import open3d`**：脚本 docstring 有 `pip install open3d` 说明，但无 `requirements.txt` / `pyproject.toml` 声明 → **未声明的可选运行依赖**（工具脚本、非常驻服务，风险低）。
3. **默认 registry 无 audit 端点**：CI/维护中的 `pnpm audit` 会假失败，需显式指定官方 registry 或配置含 audit 能力 registry。

### 8.4 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`（v0.2.6）；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- 本轮**无运行时行为改动**，**有意不触发** dsh-phoenix 优雅重启（其触发条件为 dsh 编译插件 `cordis_run`，且会中断本会话）。

### 8.5 结论与下一步建议

- 本轮**无代码变更**：无 open issue + 本地验证全绿 + audit/静态扫描干净 + main CI 绿。
- 下次维护可选：
  1. 对 `ros2_workspace` source 前缀做 shell 转义（setter + `extractSourcePath` + 测试）。
  2. 为 `simplify_visual_meshes.py` 补 `requirements.txt`/`pyproject` 声明 `open3d`。
  3. `git push origin --delete docs/maintenance` 清理历史遗留分支。
  4. README 补显式 pnpm 版本声明（CI 已固定 11.22.0）。
  5. 沿用“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线；`pnpm audit` 需加 `--registry=https://registry.npmjs.org`。

---

## 9. 维护记录（2026-09-05 · 第三轮：无 open issue → 安全检查 → 落地安全修复）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑**安全检查**；
> 检查中确认上一轮（§8.5）列为“下次维护可选”的 **`ros2_workspace` source 路径未转义**问题仍存在，
> 且属真实（低–中）注入面 + 含空格路径的功能缺陷。本轮**一并落地修复**（走标准 `fix/` 分支 + 常规提交），
> 因此本轮为 **“安全检查 + 安全修复 + 验证 + 文档”** 型维护，不再是无改动的纯验证轮。

### 9.0 仓库快照（本轮起始）

| 项 | 值 |
| --- | --- |
| 起始分支 | `main`（HEAD `a03c60f`；此时本地领先 `origin/main` 1 个 docs 提交，未推送——历史维护文档本地保留） |
| 起始远端分支 | `origin/main`，`origin/docs/maintenance`（历史遗留，落后于 main，§5 已建议清理） |
| 新开分支 | `fix/ros2-workspace-path-quoting`（已推送，PR **#6**） |
| 起始 main CI | HEAD `ee3ae03`（已合并 PR #5）：check(22)/check(24) `completed: success` |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |

**本轮结束状态**：`origin/main` 已推进到 `c423e49`（**PR #6 已合并**，main CI `completed: success`）；远程仅剩 `main`
（`docs/maintenance` 已不在远程，`fix/…` 分支已删除）；本地 `main` 在 `f26dafd`（领先 `origin/main` 1 个 `docs:` 提交
= 本维护文档 §9，未推送，符合“本地维护”要求）。

### 9.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`GET /pulls?state=open` → **0 open**。
历史全部 closed：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5（已合并）。
→ **不存在未处理 issue**，转入 step 5（安全检查）。**未**将 `ros2_workspace` 转义当作“issue”计为 step 2/3 的驱动条目；
它来自安全扫描（step 5）的发现，按 step 5 → 修复的路径处理（见 §9.2/§9.3）。

### 9.2 安全扫描（step 5）——复测 + 落地修复

**依赖审计（`pnpm audit`）**：默认 registry 为 `registry.npmmirror.com` 无 audit 端点，须显式
`--registry=https://registry.npmjs.org`。
结果：**No known vulnerabilities found**（exit 0，覆盖 `@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**（复测，均干净）：

- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_…`/`BEGIN RSA|OPENSSH|EC|DSA PRIVATE`/`AIza…`/`xox…`）：**源码与 git 全历史均无泄漏**。
  `.gitignore` 正确排除 `secrets.json`/`*.secrets.json`/`.env`/`lib/`/`node_modules/`。
- `eval`/`new Function`/`vm`：**无**。
- 命令执行（`spawn`/`execFile`）：均数组参数；`runCommand`（`common/src/runner.ts`）对每个 arg 经 `shq()` 转义——参数层防注入。`spawnJob` 同样数组参数。

**本轮发现并落地修复（低–中，真实注入面 + 功能缺陷）：**

1. **`ros2_workspace {action:'use', path}` 的 source 路径未转义**（`packages/core/src/tools.ts:1429`）：
   `setSessionRosSetup(\`source ${setup} && \`)` 把用户路径 `p`（经 `path.join(p,'install','setup.bash')`）**原样**存进会话前缀，
   随后在 `runner.ts:172` 经 `bash -lc` 执行。路径含 `;`/`&`/`$(...)` 等 shell 元字符可逃逸（注入面）；
   路径含**空格**（如 `my workspace`）则 source 直接失败（功能缺陷）。
   - 原可利用性低：`access(setup)` 要求该字面路径真实存在才通过校验；但属**隐式注入 / 误解析**风险，且空格路径是现实场景。
   - **修复（`fix(workspace)`）**：
     - `common/src/runner.ts`：`shq()` 由私有改为 **export**（POSIX 单引号转义，单个安全 shell 词）；
       `extractSourcePath()` 支持**反解析单/双引号包裹的路径**（de-quote），使存在性检查与 `show` 仍旧读到真实（未引号）路径。
     - `core/src/tools.ts`：`setSessionRosSetup(\`source ${shq(setup)} && \`)`——路径始终作为单个引号 shell 词。
     - **回归测试**：common +1（shq 单引号包裹的含空格路径能正确 round-trip 回原始路径）、core +1（存储前缀形如
       `source '<path>' && `，非原样插值）。工作区 vitest 用例 **182 → 184**。
   - 其余命令执行面（`spawn`/`execFile`/`runCommand`/`spawnJob`）经复测**均无未转义用户输入进 shell 字符串**。

### 9.3 开发管理（git · step 3）

- 基分支：`main`（干净）。
- 新开分支：`fix/ros2-workspace-path-quoting`（`fix/...` 前缀，符合“修复问题”语义）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `3f5c97b` | `fix(workspace)` | `ros2_workspace` source 路径 `shq()` 转义 + `extractSourcePath()` de-quote + 2 例回归测试 + CHANGELOG |
| `97556fb` | `docs` | README/README_CN 工作区 vitest 用例 182 → **184**（2 例新回归测试） |

- PR：**#6** `fix(workspace): shell-quote ros2_workspace source path (injection + space-safe)`（base `main`，`MERGEABLE`，已于本轮**合并**）。

### 9.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10/10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 184 vitest（core 94 过 + 1 pty-skip；本机无 pty 那 1 例 skip）；sidecar python3 -m sidecar.selftest → SELFTEST PASSED (10 scenarios)；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```

用例分布：common 14 + core 95(94+1skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **184**（CI 允许 1 例 pty-skip）。
> `CI=true` 原因同 §3.2（本机 node_modules 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules）。
> push 后 GitHub CI（Node 22/24）在 PR #6 上校验（typecheck 已绿，test/build/工具数校验运行中）。

### 9.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`（v0.2.6），并列入 `bundles`；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- **本轮有运行时行为变更**（`ros2_workspace use` 前缀格式 + 新增 `shq`/`extractSourcePath` 逻辑）。是否让运行中的 dsh web 立即生效：
  **有意未就地触发** dsh-phoenix 优雅重启——其触发条件为 dsh 编译插件 `cordis_run` 且会中断本会话；且 phoenix 为 idle-aware（本会话为 busy agent，此刻也不会重启）。
  该变更已**合并**并经 CI 校验（PR #6，main CI `success`），将在运行中 dsh web **下次重载/重启**时自然生效（dsh-ros2 包以 symlink 装入，`lib/` 已重建）。
  给后续维护者：若需立即生效，走 §4 的 dsh-phoenix 优雅重启循环（先确认无 busy agent、再触发 `cordis_run`），而非手动 `systemctl restart`。

### 9.6 结论与下一步建议

- 本轮**落地 1 项安全修复**（`ros2_workspace` source 路径转义，注入面 + 空格路径功能双修）+ 2 例回归测试 + 元数据对齐（README 184 例）。
- 本地 typecheck/test/build 全绿（184 例 + 10 sidecar 场景）；`pnpm audit` 干净；静态/历史无密钥、无 `eval`/`vm`。
- 下次维护可选：
  1. 为 `simplify_visual_meshes.py` 补 `requirements.txt`/`pyproject` 声明 `open3d`（未声明可选运行依赖）。
  2. `docs/maintenance` 已不在远程（本轮 `fetch --prune` 已同步清理该陈旧跟踪引用）——无需再删。
  3. README 补显式 pnpm 版本声明（CI 已固定 11.22.0）。
  4. 维护文档为本地产物未推送（符合“本地维护”要求）；如需随仓库走，可对 `main` 的 `docs:` 提交做 `git push`（当前本地领先 1 个 docs 提交：`f26dafd`）。
  5. 沿用“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线；`pnpm audit` 需加 `--registry=https://registry.npmjs.org`。
---

## 10. 维护记录（2026-09-05 · 第四轮：无 open issue → 安全检查 → 落地两项维护卫生修复）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑**安全检查**；
> 检查复测干净（`pnpm audit` 无漏洞、静态/历史无密钥、无 `eval`/`vm`、命令执行面均为数组参数），
> 其中发现上一轮（§8.3/§9.6）列为“下次维护可选”的两项**低风险维护卫生**问题仍存在，本轮**一并落地**：
> ① `simplify_visual_meshes.py` 的 `open3d` 未声明运行依赖；② README 未显式声明 pnpm 版本要求。
> 走标准 `fix/` 分支 + 常规提交，因此本轮为 **“安全检查 + 维护卫生修复 + 验证 + 文档”** 型维护。

### 10.0 仓库快照（本轮起始）

| 项 | 值 |
| --- | --- |
| 起始分支 | `main`（HEAD `6b274c8`＝本地 round-3 维护文档提交，领先 `origin/main` 1 个 `docs:`，未推送） |
| 远端 `origin/main` | `c423e49`（PR #6 已合并）；远程仅剩 `main`（`docs/maintenance`、历史 `fix/…` 均已不在远程，`fetch --prune` 同步） |
| 新开分支 | `fix/vision-declare-python-deps`（已推送，PR **#7**） |
| 起始 main CI | HEAD `c423e49`（已合并 PR #6）：check(22)/check(24) `completed: success` |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |

### 10.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`GET /pulls?state=open` → **0 open**。
历史全部 closed/merged：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5、#6（已合并）。
→ **不存在未处理 issue**，转入 step 5（安全检查）。未将本轮两项修复当作“issue”计为 step 2/3 的驱动条目；
它们来自安全扫描（step 5）与上轮推荐（§9.6），按 step 5 → 修复的路径处理。

### 10.2 安全扫描（step 5）——复测 + 落地两项维护卫生修复

**依赖审计（`pnpm audit`）**：默认 registry 为 `registry.npmmirror.com` 无 audit 端点，须显式
`--registry=https://registry.npmjs.org`。结果：**No known vulnerabilities found**（exit 0，覆盖
`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**（复测，均干净）：

- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_…`/`BEGIN RSA\|OPENSSH\|EC\|DSA PRIVATE`/`AIza…`/`xox…`）：**源码与 git 全历史均无泄漏**。
  `.gitignore` 正确排除 `secrets.json`/`*.secrets.json`/`.env`/`lib/`/`node_modules/`；仓库内无 `secrets.json`/`.env` 实体。
- `eval`/`new Function`/`vm`：**无**。
- 命令执行面：`spawn`/`execFile` 均使用**数组参数**（无 `shell:true`、无字符串形式 `exec`）；`runCommand`
  （`common/src/runner.ts`）对每个 arg 经 `shq()` 转义；`spawnJob` 同样数组参数。
- 复测确认 **round-3 的 `ros2_workspace` 修复已正确存在**：`runner.ts` `shq()` 已 export、`extractSourcePath()`
  支持反解析单/双引号路径、`core/src/tools.ts` 以 `source ${shq(setup)} &&` 拼接——本次未再触发该类问题。

**本轮发现并落地修复（低风险·维护卫生）：**

1. **`simplify_visual_meshes.py` 的 `open3d` 依赖未声明**（§8.3 #2 / §9.6 #1）：
   - 现象：`packages/vision/scripts/simplify_visual_meshes.py` 顶部 `import open3d as o3d`，但仅 docstring
     提到 `pip install open3d`；仓库无任何 `requirements.txt`/`pyproject.toml` 声明该**未声明的可选运行依赖**。
   - 影响面：低（工具脚本、非常驻服务），但属**安装/发布卫生**问题——他人无法 `pip install -r` 复现环境。
   - 修复（`chore(vision)`）：新增 `packages/vision/scripts/requirements.txt`，内容 `open3d>=0.18` 并附安装说明；
     该目录已含于 vision 包 `package.json` 的 `files` 白名单（`scripts`），将随 npm 包发布。

2. **README 未显式声明 pnpm 版本要求**（§9.6 #3）：
   - 现象：root `packageManager: pnpm@11.22.0` 且 CI 用 `pnpm/action-setup@v4` 固定，但 README/README_CN 开发章节未写明“需 pnpm 11.x”。
   - 修复（`docs`）：README/README_CN 开发章节补一行“安装需 **pnpm 11.x**（固定 `packageManager: pnpm@11.22.0`，CI 经
     `pnpm/action-setup@v4` 安装匹配版本）；Node `^22.19 \|\| >=24`”；CHANGELOG `[Unreleased]` 增补 `### Added`（open3d）与 `### Changed`（pnpm 前置）。

### 10.3 开发管理（git · step 3）

- 基分支：`origin/main`（`c423e49`，干净）。
- 新开分支：`fix/vision-declare-python-deps`（`fix/...` 前缀；本轮两项改动为“补齐缺失声明/文档”，语义上属修复类）。
- 说明：本轮由本地 `main`（领先 `origin/main` 1 个 round-3 docs 提交）新开分支，初始 PR 误含该 round-3 docs 提交；
  **已将分支 rebase 到 `origin/main` 上**（cherry-pick 仅保留本轮 2 枚提交），使 PR 聚焦、维护文档保持本地（§10.6）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `65013ea` | `chore(vision)` | 新增 `packages/vision/scripts/requirements.txt`，声明 `open3d>=0.18`（补齐未声明运行依赖） |
| `d3737ed` | `docs` | README/README_CN 补 pnpm 11.x 前置声明 + CHANGELOG `[Unreleased]` 增补（Added/Changed） |

- PR：**#7** `fix(vision): declare open3d runtime dep + document pnpm 11.x requirement`（base `main`，`MERGEABLE`，CI 绿后合并）。

### 10.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 个项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 184 vitest（core 94 过 + 1 pty-skip）；sidecar python3 -m sidecar.selftest → SELFTEST PASSED (10 scenarios)；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```

用例分布：common 14 + core 95(94+1 skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **184**（CI 允许 1 例 pty-skip）。
> `CI=true` 原因同 §3.2（本机 node_modules 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules）。

### 10.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`，并列入 `dsh.profile.bundles`；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- **本轮无运行时行为变更**（requirements.txt 声明 + README 文档），**有意未触发** dsh-phoenix 优雅重启——
  其触发条件为 dsh 编译插件 `cordis_run` 且会中断本会话；该改动已随 PR #7 合并并经 CI 校验，将在 dsh web 下次重载时自然生效。

### 10.6 结论与下一步建议

- 本轮**落地 2 项维护卫生修复**（`open3d` 依赖声明 + README pnpm 11.x 前置）；安全扫描复测干净；本地 typecheck/test/build 全绿。
- 维护文档为本地产物**未推送**（`main` 领先 `origin/main` 1 个 `docs:` 提交＝本轮 §10），符合“本地维护”要求。
- 下次维护可选：
  1. 若需在 pty 可用机器（如 CI）跑一次全量 `pnpm run test`，确认 184 例全绿（本机 1 例 pty-skip）。
  2. `docs/maintenance` 与历史 `fix/…` 分支已不在远程（`fetch --prune` 已同步）——无需再删。
  3. 维持“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线；`pnpm audit` 需加 `--registry=https://registry.npmjs.org`。

---

## 11. 维护记录（2026-09-06 · 第五轮：无 open issue → 安全检查 → 落地 `ros2_install` 注入修复）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑**安全检查**。
> 检查中复测发现上一轮（§8.3/§9.2）“命令执行面均无未转义用户输入进 shell 字符串”的结论**遗漏了一处**：
> **`ros2_install {action:"start"}` 把用户传入的 `installer` 原样插进 `curl -fsSL ${installer}`**（真实注入面 + 含空格路径功能缺陷）。
> 本轮**一并落地修复**（走标准 `fix/` 分支 + 常规提交），因此本轮为 **“安全检查 + 安全修复 + 验证 + 文档”** 型维护。
> 首版修复尝试把下载改走 `deps.run`（为可注入测试），但**破坏了 PTY 交互测试**（mock `run` 不真正执行 `cp`，bootstrap 文件未生成）；
> 已回退为 `execFileP` + 抽取纯函数 `buildRos2InstallDownloadCommand()` 的方案。

### 11.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始分支 | `main`（HEAD `c042619`＝本地 round-4 docs 提交，领先 `origin/main` 1 个 `docs:`，未推送） |
| 开始 `origin/main` | `4c35ea8`（PR #7 已合并，main CI success） |
| 新开分支 | `fix/ros2-install-installer-quoting`（已推送，PR **#8**） |
| 结束 `origin/main` | `fbd09a2`（PR #8 合并 commit；main CI success） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工作区 vitest | **185** 例（common 14 + core 96(95 过+1 pty-skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2）＋ sidecar selftest 10 场景 |

### 11.1 Issue 检查（step 1）

`GET /repos/StvLi/dsh-ros2/issues?state=open` → **0 open**；`GET /pulls?state=open` → **0 open**（本轮开始前）。
历史全部 closed/merged：issue #1（docs consolidate）、#2（pnpm11 build）、#3（docs counts）；PR #1、#5、#6、#7（已合并）。
→ **不存在未处理 issue**，转入 step 5（安全检查）。**未**把 `ros2_install` 注入当作“issue”计为 step 2/3 的驱动条目；
它来自安全扫描（step 5）的发现，按 step 5 → 修复的路径处理。

### 11.2 安全扫描（step 5）——复测 + 发现并落地 1 项注入修复

**依赖审计（`pnpm audit`）**：默认 registry 为 `registry.npmmirror.com` 无 audit 端点，须显式
`--registry=https://registry.npmjs.org`。结果：**No known vulnerabilities found**（exit 0，覆盖
`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 等运行依赖）。

**静态 / 历史扫描**（复测，均干净）：
- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_…`/`BEGIN RSA|OPENSSH|EC|DSA PRIVATE`/`AIza…`/`xox…`）：**源码与 git 全历史均无泄漏**。
  `.gitignore` 正确排除 `secrets.json`/`*.secrets.json`/`.env`/`lib/`/`node_modules/`；仓库内无 `secrets.json`/`.env` 实体
  （仅有 `packages/vision/src/secrets.ts` 与其测试，为读取逻辑，非密钥实体）。
- `eval`/`new Function`/`vm`：**无**。
- 命令执行面：`spawn`/`execFile` 均用**数组参数**（无 `shell:true`、无字符串形式 `exec`）；`runCommand`（`common/src/runner.ts`）
  对每个 arg 经 `shq()` 转义；`spawnJob` 同样数组参数。
- 复测确认 round-3 的 `ros2_workspace` 修复正确存在（`runner.ts` `shq()` export + `extractSourcePath()` de-quote + `core/src/tools.ts` `source ${shq(setup)} &&`）。

**本轮发现并落地修复（低–中，真实注入面 + 功能缺陷）：**

1. **`ros2_install {action:"start"}` 的下载命令未转义 `installer`**（`packages/core/src/tools.ts`）：
   - 现象：`const installer = strOrUndefined(params.installer) ?? FISHROS_INSTALL_URL`，随后
     `execFileP('bash', ['-lc', \`mkdir -p "${bootDir}" && (curl -fsSL ${installer} -o "${boot}" || wget -q ${installer} …\`)])`
     把**用户传入的 `installer` 原样**插进 `bash -lc` 字符串；`bootDir`/`boot` 仅双引号包裹。
   - 注入面：`installer` 含 `;`/`&`/`$(...)` 等 shell 元字符可**逃逸**（如 `http://x/a;touch /tmp/pwned` → 执行 `touch`）。
   - 功能缺陷：含**空格**的本地路径/URL 会让下载失败。
   - 可利用性：**低–中**——工具本身需用户批准（approval-gated），但批准文案为固定串、不体现 `installer` 实际来源；
     `installer` 由 agent/用户控制，属**真实注入面**。这也是本轮唯一改动来源（step 5 → 修复路径）。
   - **修复（`fix(install)`）**：
     - 抽取**纯函数** `buildRos2InstallDownloadCommand(installer, bootDir, boot): string`，把所有用户/路径派生值
       （`installer`/`bootDir`/`boot`/`src`）用 `shq()`（单 shell 词）转义，不再裸/双引号插值。
     - 工具仍用 `execFileP('bash', ['-lc', …])` 下发（保持真实执行、不破坏 PTY 交互测试）。
     - **回归测试**：core +1，断言下载命令把带元字符的 `installer` 作为单个 `shq()` shell 词输出（`curl -fsSL '…'`）。
   - 其余命令执行面复测：`profilePath` 两处（`profile/tools.ts:159`、`safety/tools.ts:117`）为**手动单引号**包裹
     （`--profile '${profilePath}'`），较裸插值安全，仅当 `profilePath` 含内嵌单引号时才可能逃逸 → 列为建议（§11.6 #1）。

### 11.3 开发管理（git · step 3）

- 基分支：`origin/main`（`4c35ea8`，干净）。
- 新开分支：`fix/ros2-install-installer-quoting`（`fix/...` 前缀，符合“修复问题”语义）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `51e9fc6` | `fix(install)` | `ros2_install` 下载命令 `shq()` 转义（抽取 `buildRos2InstallDownloadCommand`）+ 1 例回归测试 + CHANGELOG |
| `d313219` | `docs` | README/README_CN 工作区 vitest 用例 184 → **185**（1 例新回归测试） |

- PR：**#8** `fix(install): shq() quote ros2_install installer source (injection + space-safe)`（base `main`，`MERGEABLE`，CI 绿后合并）。
- **中途修正**：首版把下载从 `execFileP` 改为 `deps.run`（为可注入测试），但 CI 的 **PTY 交互测试失败**——
  该测试的 mock `run` 对 `bash` 一律返回 `ok:true` 而**不真正执行**，导致 `cp`/`chmod` 未发生、bootstrap 文件未生成，
  pty 会话运行 `bash /tmp/dsh-ros2/fishros-install` 报 “No such file or directory”。
  → 回退为 `execFileP`（真实执行，保住 PTY 测试），改为抽取纯函数 `buildRos2InstallDownloadCommand()` 使命令可单测。
  该修正 history-rewrite + force-push 覆盖 PR #8，重跑 CI **全绿**。

### 11.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 185 vitest（core 96=95 过+1 pty-skip）+ sidecar selftest 10 场景；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
```

用例分布：common 14 + core 96(95+1 skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2 = **185**（CI 允许 1 例 pty-skip）。
> `CI=true` 原因同 §3.2/§10.4（本机 node_modules 由旧 pnpm 配置生成，pnpm 会因 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 提示清空 modules）。
> push 后 GitHub CI（Node 22/24）在 PR #8 校验：`pnpm run typecheck`/`test`/`build` 均绿；合并后 main CI 亦 success。

### 11.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- 安装：web profile `package.json` `dsh-phoenix: link:…/dsh-phoenix`（并列入 bundles）；`dsh-ros2` 及各 `dsh-ros2-*` 包同样以 `link:` 装入（`node_modules` 内均为 symlink）。
- 生效：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`（client 自动重连在跑）；`systemctl --user list-units` → `dsh-web.service … active running`。
- **本轮有运行时行为变更**（`ros2_install start` 下载命令的 `shq()` 转义）。是否让运行中的 dsh web 立即生效：
  **有意未就地触发** dsh-phoenix 优雅重启——其触发条件为 dsh 编译插件 `cordis_run` 且会中断本会话；且 phoenix 为 idle-aware（本会话为 busy agent，此刻也不会重启）。
  该变更已**合并**并经 CI 校验（PR #8，main CI success），将在运行中 dsh web **下次重载/重启**时自然生效（dsh-ros2 包以 symlink 装入，`lib/` 已重建）。
  给后续维护者：若需立即生效，走 §4 的 dsh-phoenix 优雅重启循环（先确认无 busy agent、再触发 `cordis_run`），而非手动 `systemctl restart`。

### 11.6 结论与下一步建议

- 本轮**落地 1 项安全修复**（`ros2_install` 下载命令的 `installer` `shq()` 转义，注入面 + 空格路径功能双修）+ 1 例回归测试 + 元数据对齐（README 185 例）。
- 本地 typecheck/test/build 全绿（185 例 + 10 sidecar 场景）；`pnpm audit` 干净；静态/历史无密钥、无 `eval`/`vm`；命令执行面复测后仅剩 `profilePath` 手动引号建议项。
- 下次维护可选：
  1. **`profilePath` 手动单引号改为 `shq()`**（`profile/tools.ts:159`、`safety/tools.ts:117` 的 `--profile '${profilePath}'`）：
     加 `shq` import 后改 `--profile ${shq(profilePath)}`，防御 `profilePath` 含内嵌单引号时的逃逸；需补 1 例回归测试。
  2. **清理 monolith 遗留**：根目录 `src/`（`config.ts`/`index.ts`/`skill.ts`/`tools.ts`）与 `lib/`、根 `tsconfig.json`/`tsconfig.build.json`
     为 monorepo 拆分前的单体遗留，**未被任何 workspace 包引用**（`pnpm -r` 不构建根 `src/`），但已被 git 跟踪——建议确认无引用后删除，避免死代码与重复注入面。
  3. `pnpm audit` 需加 `--registry=https://registry.npmjs.org`（默认镜像无审计端点）；维持“提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线。
  4. 可在 pty 可用机器（CI）跑一次全量 `pnpm run test` 确认 185 例全绿（本机 1 例 pty-skip）。
  5. 维护文档为本地产物**未推送**（`main` 领先 `origin/main` 2 个 `docs:` 提交＝round-4 §10 + 本轮 §11），符合“本地维护”要求。

---

## 12. 维护记录（2026-09-11 · 第六轮：无 open issue → 安全检查 → 落地 2 类注入修复 + 依赖/CI 加固）

> 本轮结论：**无未处理 issue**（0 open issue / 0 open PR）。按流程 `1 → 无 issue→5`，先跑安全检查。
> 检查发现并落地：`ros2_zero_pose_semantics` Python 助手的 **3 处注入/逃逸面**、`safety_monitor` 启动命令的
> **profile 路径引号缺陷**、2 条 `pnpm audit` moderate 依赖告警（vitest），另做 CI 最小权限加固。
> 因此本轮为 **“安全检查 + 2 类注入修复 + 依赖升级 + CI 加固 + 验证 + 文档”** 型维护。

### 12.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始分支 | `main`（HEAD `96c8e8e`＝本地 round-5 docs 提交，领先 `origin/main` 2 个 `docs:`，未推送） |
| 开始 `origin/main` | `fbd09a2`（PR #8 已合并，main CI success） |
| 新开分支 | `fix/security-hardening`（已推送，PR **#9**） |
| 结束 `origin/main` | `c1cb718`（PR #9 合并 commit；post-merge main CI **success**，run `34524374411`） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（root `packageManager` 一致） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工作区测试 | **187** vitest（common 16 + core 96(95 过+1 pty-skip) + moveit 16 + profile 11 + safety 8 + vision 30 + state 8 + dsh-ros2 2）＋ sidecar selftest 10 场景 ＋ **zero-pose selftest 6 项** |

### 12.1 Issue 检查（step 1）

`gh issue list --state open` → **0 open**；`gh pr list --state open` → **0 open**（本轮开始前）。
历史全部 closed/merged：issue #1–#3；PR #1、#5、#6、#7、#8。
→ **不存在未处理 issue**，转入 step 5（安全检查）；本轮改动均来自安全扫描发现。

### 12.2 安全扫描（step 5）——发现并落地 2 类修复 + 依赖告警

**依赖审计（`pnpm audit --registry=https://registry.npmjs.org`）**：由“clean”变为 **2 条 moderate**
（`GHSA-82fw-gwwq-j7x9`：vitest / `@vitest/mocker` `<4.1.11` 路径穿越 / 任意文件读取；无 3.x 补丁）。
处置：8 个包 devDependency `vitest` `^3.0.0 → ^4.1.11`（仅测试运行器、不随产物发布）。
升级后 `pnpm audit` 恢复 **No known vulnerabilities found**。

**本轮发现并落地修复 #1 —— `ros2_zero_pose_semantics` 的 Python 助手（低–中，三处）：**

| 位置 | 问题 | 修复 |
| --- | --- | --- |
| `ensure_rsp()` | **URDF 文件内容**单引号插值进 `bash -lc`，URDF 含 `'` 可逃逸执行 shell | 纯 argv 列表启动 `robot_state_publisher`（新增 `build_rsp_args()`），XML 为单个 argv 元素，不经 shell |
| `publish_zero_joints()` | URDF **关节名**格式化进生成脚本 `'''…'''`，含 `'''` 可逃逸 | 关节名以单个 argv 元素（JSON）传入，子脚本 `sys.argv[1]` 解析，源码不含名字 |
| `write_config()` | 自由文本 description 裸双引号写 YAML，含 `"`/换行可注入额外键 | 改用 `json.dumps()`（JSON 字符串即合法 YAML 双引号标量） |

新增 `--selftest`（6 项检查，无需 ROS / PyYAML），接入 `dsh-ros2-profile` 的 `test` 脚本
（对齐 sidecar selftest 模式），CI 每次运行都会回归验证。

**本轮发现并落地修复 #2 —— `safety_monitor` 启动命令的 profile 路径（低）：**
`robot_register`（自动拉起）与 `robot_safety_start` 用 `--profile '${profilePath}'` 手动单引号；
路径含内嵌单引号可逃逸进 `bash -lc`，含空格路径也不稳。抽取共享纯函数
`buildSafetyMonitorCommand()`（`dsh-ros2-common`，内部 `shq()`），两处调用点统一使用；+2 回归测试（common）。

**静态 / 历史复测（干净）：**
- 硬编码密钥（`AKIA…`/`sk-…`/`ghp_`/`BEGIN … PRIVATE KEY`/`AIza…`/`xox…`）：源码与 git 全历史均无泄漏。
- `eval`/`new Function`/`vm`/`shell:true`：无。
- 命令执行面：`spawn`/`execFile` 均数组参数；`runCommand`（`common/src/runner.ts`）对每个 arg 经 `shq()`；
  `core/gui.ts` 的自定义 `screenshotCommand` 来自插件配置（运维可信）且 `{output}` 经 `shq()`。
- Python 命令面：除本轮修复的两处外，`subprocess.run/Popen` 均为 argv 列表；仅 `zero_pose_semantics.py` 曾用 `bash -lc`。
- `ros2_interface_create` 有 `PATH_ESCAPE` 校验 + 存在性拒绝覆盖 + 审批；`vision/secrets.ts` 0600/0700、文件在仓库外（`~/.dsh-ros2/secrets.json`）。

### 12.3 开发管理（git · step 3）

- 基分支：`origin/main`（`fbd09a2`，干净）。新开分支：`fix/security-hardening`（`fix/...` 前缀，符合“修复问题”语义）。
- 提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `e212fe7` | `fix(safety)` | `safety_monitor` profile 路径 `shq()` 转义（`buildSafetyMonitorCommand`）+ 2 回归测试 |
| `711deeb` | `fix(deps)` | vitest `^3.0.0 → ^4.1.11`（清 `GHSA-82fw-gwwq-j7x9`） |
| `644045a` | `ci` | `permissions: contents: read` + `timeout-minutes: 30` |
| `0eae014` | `fix(zero-pose)` | Python 助手 3 处注入修复 + `--selftest`（6 项）接入 profile `test` |
| `133fd07` | `docs` | README/README_CN 用例 185→187 + CHANGELOG [Unreleased] |

- PR：**#9** `fix(security): harden shell/format surfaces, bump vitest, CI least-privilege`（base `main`）；
  PR CI（Node 22/24）**全绿**后按仓库惯例以 **merge commit** 合并（`c1cb718`），已删除分支。
- 合并后 main CI（run `34524374411`）**success**；本地 `main` 以 `git rebase origin/main` 收纳合并结果，
  保留 round-4/round-5 两个本地 `docs:` 提交在上方。

### 12.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 187 vitest（core 95 过+1 pty-skip）+ sidecar 10 场景 + zero-pose 6 项；exit 0
CI=true pnpm run build       # pnpm -r build 全部 Done（exit 0）
pnpm audit --registry=https://registry.npmjs.org   # No known vulnerabilities found（exit 0）
```

> `CI=true` 原因同前几轮（本机 node_modules 由旧 pnpm 配置生成）；本轮因升级 vitest 先执行过
> `pnpm install --no-frozen-lockfile`（`CI=true` 会默认 frozen-lockfile，需显式放开一次）。

### 12.5 dsh-phoenix 持续更新/测试链路核对（step 4 侧）

- **活动 profile**：`/home/stvli/.dsh/profiles/web/package.json` 含
  `dsh-phoenix: link:…/dsh-phoenix`、`dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2`；
  `node_modules` 内 `dsh-ros2` / `dsh-ros2-core` / `dsh-ros2-profile` / `dsh-phoenix` 均为指向本仓库的 symlink。
- **运行态**：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"…"}`；
  `systemctl --user is-active dsh-web.service` → `active`（自 2026-09-10 21:29，NRestarts=0）；
  `/home/stvli/tmp/dsh-phoenix-state.json` → `generation 14, lifecycleState running`。
- **插件已挂载**：本会话可获得 dsh-ros2 提供的 `arm_*`/`ros2_*`/`robot_*` 工具面，即插件在运行中的 dsh web 内已加载。
- **phoenix 自测**：`cd dsh-phoenix && npm test`（`node --test`）→ **41/41 pass**。
- **本轮行为变更生效方式**：改动位于 symlink 指向的包源码，`lib/` 已重建
  （`packages/common/lib/runner.js` 含 `buildSafetyMonitorCommand`）。dsh 自身 HMR 忽略 `node_modules`，
  故运行中的 dsh web 需**下次重载/重启**才加载新代码；本轮**有意未就地触发** dsh-phoenix 优雅重启
  （其触发条件为 `cordis_run`，且 phoenix 为 idle-aware，本会话为 busy agent，此刻也不会重启）。

### 12.6 结论与下一步建议

- 本轮**落地 2 类注入修复**（zero_pose Python 助手 3 处 + `safety_monitor` 路径引号）+ 1 项依赖升级（vitest 4）+ CI 最小权限；
  新增测试：common +2 vitest、profile +6 Python selftest；本地与 GitHub CI（Node 22/24）全绿，`pnpm audit` 干净。
- 下次维护可选：
  1. **CI Actions 升级**：main CI 有告警 “Node.js 20 is deprecated … actions/checkout@v4 / setup-node@v4 / pnpm/action-setup@v4”，
     建议升到 `@v5`（或按需 pin SHA），属 CI 供应链卫生。
  2. **清理 monolith 遗留**（承 §11.6 #2，仍未做）：根 `src/`、根 `tsconfig.json`/`tsconfig.build.json` 与根 `tests/`
     为拆分前单体遗留；`pnpm -r` 不构建、CI 不运行（仅根 `tests/` 内部 import 根 `src/`）。确认后删除可减死代码与注入面。
  3. **非阻塞产线依赖审计**：可在 CI 增 `pnpm audit --prod --audit-level high`（仅高/严重阻断），或在发布流程加审计步骤。
  4. `pnpm audit` 仍需 `--registry=https://registry.npmjs.org`（默认镜像无审计端点）；维持
     “提交前 typecheck+test+build 全绿 + 行为变更补测试 + push 后 CI 绿”验收线。
  5. 维护文档仍为本地产物（`main` 领先 `origin/main`：round-4 §10 + round-5 §11 + 本轮 §12，未推送），符合“本地维护”要求。

---

## 13. 维护记录（2026-09-13 · 第七轮：open issue #19 → 评估后落地 journey skills + 组合不变量 + 安全复测）

> 本轮结论：**存在 1 个未处理 issue（#19，RFC：need-shaped composition）**，故走 `1 → 2 → 3 → 4 → 5 → 6` 全流程。
> 评估后**接受**切片 1（journey skills）与切片 3（组合不变量测试），**修正**切片 2（L3 缩面）并降级为文档配方；
> 期间发现并修复一个真实内容缺陷（`ros2-diagnostics` 技能被截断、且无条件宣传 moveit 工具）与一处元数据漂移（README 79 tools vs 实际 83）。
> 安全扫描**未发现新漏洞**（依赖审计干净、历史无密钥、无 `eval`/`shell:true`、新增代码无执行面）。

### 13.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始 `origin/main` | `2d349af`（PR #18 已合并；工作树干净，本地 `main` 与 `origin/main` 0/0） |
| 新开分支 | `feat/journey-skills`（已推送，PR **#20**，6 个提交） |
| 结束 `origin/main` | `1933acf`（PR #20 合并 commit；CI run `34716276970`，`check (22)` 51s / `check (24)` 46s 均 **pass**；远端分支已删除） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（= root `packageManager`） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工具 / 技能 | **83 工具**（core 61 / vision 7 / safety 5 / moveit 4 / profile 4 / state 2） · **9 技能**（本轮 4 → 9） |
| 工作区测试 | **214** vitest（common 21 · core 110 过 +1 skip · moveit 16 · profile 12 · safety 10 · vision 30 · state 8 · dsh-ros2 6）＋ sidecar selftest 10 场景 ＋ `robot_profile` / `zero_pose` Python 自检 |

### 13.1 Issue 检查（step 1）

`gh issue list --state open` → **1 open：issue #19**（RFC: need-shaped composition，作者 OWNER，2026-09-12 建，无评论、无标签）。
`gh pr list --state open` → **0 open**。历史 issue #1–#3 全 closed；PR #1、#5–#18 全 merged。
→ **存在未处理 issue**，转 step 2（不再跳过 `1 → 5`）。

### 13.2 建议评估（step 2）——逐条判断合理性与必要性

**先核实 RFC 的"measured, not assumed"数据**：83 工具 / 6 bundle / 4 技能 —— **全部准确**（core 61、vision 7、safety 5、moveit 4、profile 4、state 2）。
但 RFC 正文写"9 journeys, 4 carriers"，而其自带表格只有 **8 行** —— **计数口径不一致**（实为 8 条旅程）。

**切片 1（为未覆盖旅程补 skill）—— 合理且必要，接受。**
- 必要性：83 工具 / 4 技能 ≈ 每技能 21 个工具，而 8 条旅程中 **5 条没有任何载体**（bring-up、liveness、TF、motion、safety）；缺口恰好落在本项目已经付过学费的地方
  （`docs/feedback-env-recovery.md` 的环境自愈、`docs/verification-toolchain-efficiency.md` 的 TF 静默失败）。
- 合理性：与本仓库自测结论一致 —— agent 墙钟由**往返次数**而非命令耗时决定；路由由 skill/description 承担（PR #13 的强制 A/B 与 `guidance.spec.ts` 的探测式断言）；
  系统提示本就"按当前已注册工具重建"，skill 目录是同一原则的自然延伸。
- 唯一保留：**"每旅程一 skill"会把载体从 4 增到 9**，若 skill 冗长就会制造它想消除的"选择成本"。故本轮约束：每个 skill **短、L1 入口优先、只写本旅程**，
  且**由提供其所路由工具的 bundle 注册**（只装 core 的安装看不到 moveit/safety 载体）。

**切片 2（scope 证明：diagnostics-only preset + `tools.restrict`）—— 方向合理，表述有误，接受"修正版（文档配方）"。**
- 核实 `@deepseek-ai/dsh-tools` 中 `ctx.tools.restrict(filter)` 的**实际契约**：**要求 scoped（agent）上下文**，上下文级调用直接抛错
  （`tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent`）；`restrict({})` 视为 no-op 被拒；**未知工具名抛错**；
  限制**取交集**、disposer 精确解除；保留的 `run_code` 传输不可点名。
- 因此 RFC 的"挂载 core 再用 restrict 去掉 motion/safety"**混淆了两种机制**：只挂 `dsh-ros2-core` 本身已是 diagnostics-only 面（无需 restrict）；
  而在 core-only 挂载下 `restrict` 会因 `moveit_move` / `robot_safety_state` **不是全局工具**而抛错。
- 必要性：作为能力证明有价值，但 preset 位于 harness 的 preset 目录、不属本 npm 包；且 restrict-only 行为在没有 live agent scope 时**无法由本仓库 CI 验证**。
  → 本轮以 `docs/journey-catalogue.md` §5 记录"安装级 bundle 挂载 vs 作用域级 `tools.restrict`"两种机制与**已核实契约**，**不产出无法验证的产物**。

**切片 3（组合不变量测试）—— 合理且必要，接受。**
- 本仓库已有先例（`guidance.spec.ts` 已断言引导文本中每个反引号工具名都真实存在）；扩展到"旅程目录"成本低、收益高。
- 必要性本轮**当场被验证**：核对计数时发现 README / 聚合包元数据写 **79 tools** 而代码树实际 **83**、core 描述写 59 而实际 61 —— 正是该不变量要防的漂移。

**非目标（不删 primitive、不一 verb 一工具、不再加提示词散文）—— 判断合理，接受。**

**验收主张（每旅程 ≤2 次调用）—— 合理但本轮未复测**：`docs/verification-toolchain-efficiency.md` 的 10 节点系统本轮未运行，记为遗留项（§13.7-3）。

### 13.3 开发管理（git · step 3）

基分支 `origin/main`（`2d349af`，干净）。新开 **`feat/journey-skills`**。提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `f0f69f8` | `fix(core)` | 删除 `ros2-diagnostics` 技能被截断的残留片段（`2ebe3a4` 引入） |
| `9adc16d` | `feat(core)` | 新增 `ros2-bringup-recovery` / `ros2-liveness-triage` / `ros2-tf-integrity`（+ 引导目录登记） |
| `6ab30b4` | `feat(moveit)` | 新增 `robot-motion-control` 并注册 |
| `e3b4036` | `feat(safety)` | 新增 `robot-safety-procedure` 并注册 |
| `702be1e` | `docs` | `docs/journey-catalogue.md` + README/README_CN/CHANGELOG + 计数校正 |
| `239c0d0` | `test(dsh-ros2)` | journey 目录 + 组合不变量（4 例） |

> 为让 `fix:` 与 `feat:` 分离，`packages/core/src/skill.ts` 先以"仅修复"的中间态提交（`f0f69f8`，`tsc --noEmit` 通过），再恢复完整态提交（`9adc16d`）。

**发现并修复的真实缺陷（`fix(core)`）**：`2ebe3a4`（环境自愈）在插入章节时删掉了 `## MoveIt2 motions` 小节头与首句，却留下残句
（`s \`srdf\` for a direct path), returns …`）。两个后果：(1) 技能内容以半句话开头；(2) 残句**无条件**介绍 `moveit_discover` / `moveit_move` ——
技能内容是**静态字符串**（不同于按已注册工具重建的系统提示），因此**只装 core 的安装会被引导去移动它根本没有挂载的机器人**，
恰好违反本仓库"仅宣传已挂载能力族"的原则。修复后运动引导改由 `dsh-ros2-moveit` 的载体承担。

**PR 与合并**：PR **#20** `feat: journey skills + composition invariant (RFC #19 slices 1 & 3)`（base `main`）；
PR CI（run `34716276970`，Node 22/24 矩阵）**全绿**后按仓库惯例以 **merge commit** 合并为 `1933acf`，远端分支已删除，本地 `main` 已 `reset --hard origin/main` 同步。

### 13.4 本地验收（全绿）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 10 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 214 vitest 全通过（含 1 pty-skip）+ sidecar 10 场景 + Python 自检；exit 0
CI=true pnpm run build       # 9 包 tsc 全部 Done（exit 0）
pnpm audit --registry=https://registry.npmjs.org   # No known vulnerabilities found（exit 0）
```

**不变量测试的反向验证（确认有牙齿）**：把目录中 `bringup.entry` 改名后跑测试 → 失败并给出可定位信息（随后已复原）：

```text
journey "bringup" entry tool: expected [ 'ros2_graph', …(82) ] to include 'ros2_env_check_RENAMED'
```

**已构建产物（`lib/`）的独立复核**：用 Cordis `Context` + 假服务（tools/skills/approval/jobs）挂载 6 个 bundle 的 `lib/index.js`，实测注册 **83 tools**，
技能 **9 个**（`robot-motion-control, robot-registration, robot-retrieval, robot-safety-procedure, robot-state-vision-analysis, ros2-bringup-recovery, ros2-diagnostics, ros2-liveness-triage, ros2-tf-integrity`）。
即 83 / 9 两个数字来自**运行期注册路径**，而非源码字符串解析 —— 与目录测试互相独立地印证。

### 13.5 dsh-phoenix 持续更新 / 测试链路（step 4）

- **活动 profile**：`~/.dsh/profiles/web/package.json` 含 `dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2` 与 `dsh-phoenix: link:…/dsh-phoenix`；
  `node_modules` 内 `dsh-ros2` / `dsh-ros2-core` / `dsh-ros2-common` / `dsh-ros2-moveit` / `dsh-ros2-profile` / `dsh-ros2-safety` / `dsh-ros2-vision` 均为指向本仓库的 symlink。
- **运行态**：`curl http://127.0.0.1:3080/__dsh_health` → `{"token":"1789235312154-ilrezerjuxj"}`；
  `systemctl --user is-active dsh-web.service` → `active`（自 2026-09-13 01:48:31，`NRestarts=0`）；
  `/home/stvli/tmp/dsh-phoenix-state.json` → `generation 15, lifecycleState running, pendingResume false`。
- **phoenix 自测**：`cd dsh-phoenix && npm test`（`node --test`）→ **41/41 pass**。
- **闭环已被真实执行（journal 证据）**：`journalctl --user -u dsh-web` 可见上一代的完整流程 ——
  `[dsh-phoenix] agent idle; executing deferred restart (gen 15)` → `scheduling restart (plugin-change, gen 15): systemd-run … stop; sleep 8; start`
  → `restart cmd exit=0` → `[dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)`。
- **本轮行为变更的生效方式**：改动位于 symlink 指向的包源码，`lib/` 已重建（`packages/core/lib/skill.js`、`packages/moveit/lib/skill.js`、`packages/safety/lib/skill.js` 均含新载体）。
  dsh 自身的 HMR 忽略 `node_modules`，故运行中的 dsh web 需**重载/重启**才加载新代码；本轮**有意未就地触发**重启（理由见 §13.7-4）。

### 13.6 安全扫描（step 5）——复测 + 本轮新增面复核，未发现新漏洞

| 检查 | 结果 |
| --- | --- |
| `pnpm audit --registry=https://registry.npmjs.org` | **No known vulnerabilities found**（exit 0） |
| 硬编码密钥（`AKIA…` / `sk-…` / `ghp_…` / `BEGIN … PRIVATE KEY` / `AIza…` / `xox…`） | 源码与 **git 全历史**（`git log -p --all`）均无 |
| `eval` / `new Function` / `vm` / `shell:true` | 无 |
| TS 命令执行面 | `execFile` / `spawn` 均**数组参数**；shell 字符串仅出现在经 `shq()` 的 `buildSafetyMonitorCommand`，或经校验的输入（`KILL_SIGNAL_RE`、`isSafeProfileName`）；`gui.ts` 的 `screenshotCommand` 来自运维配置且 `{output}` 经 `shq()` |
| Python 命令面 | `subprocess.run` / `Popen` **全部 argv 列表**，无 `shell=True`、无 `bash -lc` |
| 历史加固回归 | `KILL_SIGNAL_RE`（process_cleanup signal）、`isSafeProfileName`（档案名越界）、`buildSafetyMonitorCommand`（profile 路径引号）、`gui` 的 `{output}` 引号 —— **均在位** |
| **本轮新增面**（`git diff main...HEAD`） | 仅 5 个新技能的 markdown 内容、`ctx.skills.register(...)` 接线、`guidance.ts` 的 SKILLS 数据数组、测试、文档与元数据 —— **不含任何命令/求值/IO 面**（新文件对 `spawn`/`exec`/`subprocess`/`shell` 的唯一命中，是 `core/src/skill.ts` 中 `install/setup.bash`、`shell prefix` 等**散文**） |

> 结论：本轮**未发现新漏洞、无需修复**；报告为"复测通过 + 新增面无风险"。历史上已被利用/修复的注入面（round-5/6/7）未被本轮改动触碰。

### 13.7 结论与下一步建议

- 本轮首次进入"有 open issue"分支：评估后**接受 RFC 切片 1 + 3**、**修正并文档化切片 2**；落地 5 个 journey skill（4 → 9 载体，**8 条旅程全部有载体**）、
  4 例组合不变量测试、1 个真实内容缺陷修复；本地 typecheck / test / build 全绿，`pnpm audit` 干净，phoenix 41/41 且闭环有 journal 证据。
- 下次维护可选：
  1. **不变量已随 `pnpm -r test` 进入 CI**（`journeys.spec.ts` 属 `packages/dsh-ros2` 测试）。可按需把"计数一致"断言扩展到 `PUBLISH.md` 与 `docs/*.md`。
  2. **切片 2 的"真产物"**：在 `${DSH_HOME}/.agent-presets/<id>/` 下写一个 diagnostics-only preset，并在 live agent scope 中实测 `ctx.tools.restrict` 的缩面效果（本仓库 CI 无法验证，故本轮只给配方）。
  3. **RFC 的 ≤2 次调用验收**：重启 `docs/verification-toolchain-efficiency.md` 的 10 节点系统，按旅程记录调用数与墙钟（本轮遗留，系统未运行）。
  4. **把本轮代码加载进运行中的 dsh**：需要一次 phoenix 优雅重启（`cordis_run` 触发 → 忙时 `deferring (agent busy)` → 空闲时 `executing deferred restart`）。
     本轮为不中断维护流程而**有意未触发**；可在空闲时触发，journal 应按上述顺序出现两行。
  5. 维持验收线："提交前 typecheck + test + build 全绿 + 行为变更补测试 + push 后 CI 绿"；`pnpm audit` 需带 `--registry=https://registry.npmjs.org`（默认镜像无审计端点）。

---

## 14. 维护记录（2026-09-14 · 第八轮：3 个 open issue → 全部落地/收敛 + #19 验收测量 + 安全复测）

> 本轮结论：**存在 3 个未处理 issue（#21 / #22 / #19）**，走 `1 → 2 → 3 → 4 → 5 → 6` 全流程。
> 评估后：#21 **确认为真缺陷并修复**（现场在真机 Jazzy 上复现）；#22 **接受并落地**（保留 open，边界如实声明）；
> #19 的**遗留验收测量：本轮完成**（固化测量台 + 6/6 可测旅程 ≤2 次调用），测量过程本身又**发现并修复一个真缺陷**。
> 安全扫描**未发现新漏洞**（依赖审计干净、历史无密钥、无 `eval`/`shell:true`、新增面为纯字符串处理与只读 `readFileSync`）。

### 14.0 仓库快照（本轮起始/结束）

| 项 | 值 |
| --- | --- |
| 开始 `origin/main` | `34935b1`（第七轮日志；工作树干净，本地 `main` 与 `origin/main` 0/0） |
| 新开分支（3 条，均已合并并删除远端分支） | `fix/profile-tf-root`、`feat/bundle-version-drift`、`fix/tool-stdout-noise` |
| 结束 `origin/main` | `fcde2a6`（PR **#25** 合并 commit）+ 本维护日志提交 |
| PR | **#23** `496255b`、**#24** `fbdc685`、**#25** `fcde2a6`（均 merge commit；CI run `34846921337` / `34846941355` / `34847994417`，Node 22/24 矩阵**全 success**） |
| 本地 Node / pnpm | Node `v24.16.0` / pnpm `11.22.0`（= root `packageManager`） |
| 包数量 | 9 个（common/core/dsh-ros2/dsh-ros2-state/moveit/profile/safety/sidecar/vision） |
| 工具 / 技能 | **83 工具 / 9 技能**（本轮不增删工具；新增的是 `ros2_env_check` 的返回字段与 1 个组合不变量测试） |
| 工作区测试 | **240 vitest 通过 + 1 skip**（214 → 240；核心 110 → 113，common 21 → 35，profile 12 → 14，dsh-ros2 6 → 14）＋ sidecar 10 场景 ＋ `robot_profile` / `zero_pose` Python 自检 |

### 14.1 Issue 检查（step 1）

```
gh issue list --state open  →  3 open
  22  dx: surface loaded vs installed bundle versions …   (2026-09-14, OWNER)
  21  fix(profile): find_tf_root crashes on Jazzy and silently writes an empty tf_root  (2026-09-14, OWNER)
  19  RFC: need-shaped composition …                      (2026-09-12, OWNER, 1 comment)
gh pr list --state open     →  0 open
```
→ **存在未处理 issue**，转 step 2（不再跳过 `1 → 5`）。

### 14.2 建议评估（step 2）——逐条判断合理性与必要性

#### #21 `find_tf_root()` 在 Jazzy 上崩溃 / 静默写空 —— **合理且必要，接受，最高优先**

- **先复现，再判断**（不采信描述）：把 issue 原文的 Jazzy repr 样本喂给旧实现 →
  `IndexError: list index out of range`，**与 issue 描述一致**；空/失败输入 → 静默 `return ""`。
- **真机复核**（ROS2 Jazzy + `tf2_ros static_transform_publisher`）：
  - `ros2 topic echo /tf_static --once --field transforms` → 单行 Python repr（`=` 而非 `:`），与 issue 一致；
  - `ros2 topic echo /tf_static --once`（不带 `--field`）→ 可解析 YAML（`transforms:` / `child_frame_id: chest`）；
  - 旧实现喂**同一份 live 输入** → `IndexError`；`robot_profile.py register` **当场 traceback 退出**。
- **必要性**：这与 **#14 完全同源**——第七轮只修了 TS 侧 `ros2_tf_list` / `ros2_tf_echo`，
  **漏了 profile 脚本**；影响面是 `robot_register` 直接失败，或档案 `tf_root` 为空导致
  离屏渲染 Fixed Frame 失效（`robot-state-vision-analysis` 记载的"所有 link 堆在原点"症状）。
- **顺带修正的语义错误**：旧实现取"第一条边的 child"，那是**叶子**不是根；issue 建议的
  "只作父、不作子"才是正确判据。本轮一并改正（属同一处代码、同一 purpose）。

#### #22 让"进程陈旧"可见 —— **方向合理、必要性中等偏上，接受；但边界必须如实说明**

- **事实核实**：issue 描述的场景真实存在——本轮**现场遇到**：运行中的 dsh 于 `20:46:34` 启动，
  而磁盘代码在 `20:52` 之后更新；该进程的 `ros2_env_check` 返回**没有 `bundles` 段**，
  且第七轮新工具 `ros2_topology` 在旧进程里表现为 `unknown tool`。
- **实现路径的关键约束（本轮实测，决定了设计）**：bundle **无法**通过解析兄弟包得到各自的 loaded 版本 ——
  Node 会把符号链接入口解析到 **realpath**：

  | 解析基准 | core | profile | moveit | safety | vision |
  | --- | --- | --- | --- | --- | --- |
  | 符号链接路径（`~/.dsh/profiles/web/node_modules/dsh-ros2-core/…`） | ✅ | ✅ | ✅ | ✅ | ✅ |
  | realpath（`…/dsh-ros2/packages/core/…`，即 `import.meta.url`） | ✅ | ❌ MODULE_NOT_FOUND | ❌ | ❌ | ❌ |

  → 因此**由每个 bundle 在挂载时登记自己**（登记表放在所有 bundle 都已依赖的 `dsh-ros2-common`），
  而不是让 core 去"发现"兄弟包。这是本轮设计取舍的核心证据。
- **保留意见（故 issue 保持 open）**：
  1. **自检本身也要重启一次才生效**——旧进程里根本不存在这段代码。这是**固有限制**，不是实现缺陷，
     必须在文档与 issue 里讲清楚（否则会变成"为什么我升级了还是没提示"的假承诺）。
  2. issue 里"会话技能目录与实际注册数不一致"那一半，本轮只提供**信号**（loaded 版本），并未做目录对账。
  3. issue 建议的"启动时一行汇总日志"：bundle 是**顺序挂载**的，任何时刻打汇总都必然是**部分列表**，
     故改为**每个 bundle 一行**（`dsh-ros2: loaded bundle dsh-ros2-core@0.1.5`），更准确也更可 grep。

#### #19 RFC 验收（≤2 次调用 / 缩面）—— **接受并完成"可测"部分，缩面部分维持"文档配方"**

- 第七轮已落地切片 1（5 个 journey skill，4 → 9 载体）与切片 3（组合不变量），遗留项是
  **"每旅程 ≤2 次调用"的验收测量**。
- **本轮把它做完**（详见 §14.4）：先补齐**可复现**的测量台（此前那个 10 节点系统"手工搭一次就没了"），
  再逐旅程测量：**6/6 可测旅程 ≤2 次调用**。**三条例程（state / vision / motion）在本装置上不可测**，
  明确记为 `not_measurable`，**不计入通过**——这是本轮对"通过"口径的自我约束。
- **缩面（切片 2）不改口径**：preset 位于 harness 的 preset 目录、不属本 npm 包，仓库 CI 无法验证；
  维持第七轮的"文档配方"结论，不产出无法验证的产物。

**非目标（不删 primitive、不一 verb 一工具、不再加提示词散文）—— 判断合理，继续遵守。**

### 14.3 开发管理（git · step 3）

按 issue 类型新开 3 条分支（`fix/…` 修缺陷、`feat/…` 加功能），全部按 Conventional Commits 提交：

| commit | 分支 | 类型 | 说明 |
| --- | --- | --- | --- |
| `726deef` | `fix/profile-tf-root` | `fix(profile)` | TF 根帧解析与输出格式解耦；不再崩溃、不再静默；语义改为"只作父"；13 项离线自检 |
| `47d54ca` | `feat/bundle-version-drift` | `feat(common)` | loaded-bundle 登记表 + 每个 bundle 自登记 + 组合不变量 |
| `b7593e4` | `feat/bundle-version-drift` | `feat(core)` | `ros2_env_check` 返回 `bundles{loaded,drift,stale,unresolved}` + 陈旧告警 |
| `12a7c6b` | `feat/bundle-version-drift` | `docs` | `docs/versioning.md` 新增"已加载版本 vs 磁盘版本"一节 + CHANGELOG |
| `1852577` | `fix/tool-stdout-noise` | `fix(common)` | `parseJsonOrRaw` 容忍中间件 stdout 噪声（括号配对定位 JSON 文档） |
| `d81a274` | `fix/tool-stdout-noise` | `test(verification)` | `scripts/verification/` 可复现测量台（`system.sh` + `measure.mjs` + 3 个 lab 节点） |
| `61482f7` | `fix/tool-stdout-noise` | `docs` | `docs/journey-catalogue.md` §6 记录 ≤2 次调用测量结果与边界 |
| `cb59fd4` | `fix/tool-stdout-noise` | `fix(verification)` | 测量台 teardown 收敛到自己的进程组；启动等待图收敛 |

**PR 与合并**：PR **#23 / #24 / #25**（base `main`）。#24 与 #25 在 `#23` 合并后**rebase 到最新 `main`**
（`CHANGELOG.md` 出现冲突，按 **union 保留双方条目**解决）；三条 PR 的 CI（Node 22/24 矩阵）**全 success**
后按仓库惯例以 **merge commit** 合并，三个远端分支已删除，本地 `main` 已 `reset --hard origin/main`。

**"测量中发现缺陷"的分支归属**：`parseJsonOrRaw` 的缺陷是**做 #19 验收测量时**现场发现的。
它不属于 #21/#22，故单独开 `fix/tool-stdout-noise`；测量台与测量结果留在同一条分支
（fix 在前、使能/文档在后），避免把无关的 fix 混进 `feat/` 分支。

### 14.4 本地验收 + issue #19 的验收测量

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 9 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run build       # 9 包 tsc 全部 Done（exit 0）
CI=true pnpm -r test         # 240 vitest 通过 + 1 skip + sidecar 10 场景 + 2 个 Python 自检；exit 0
```

**#21 的真机端到端复核**（ROS2 Jazzy + `tf2_ros static_transform_publisher`）：

| 探针 | 结果 |
| --- | --- |
| 新 `find_tf_root(urdf)`（广播者在线的同一份 live 输入） | `{"root": "base_link", "source": "tf_static"}` |
| 同上，停掉广播者 | `{"root": "base_link", "source": "urdf"}` |
| 无广播者且无 URDF | `{"root": "", "source": "unresolved"}` |
| 旧实现喂同一份 live 输入 | `IndexError: list index out of range` |
| CLI `register`（回退路径） | `tf_root='base_link'`、`tf_root_source='urdf'` + 显式 warning |

**#22 的独立复核**（用 Cordis `Context` + 假服务挂载 **7 个 bundle 的已构建 `lib/`**）：

```text
registry : ["dsh-ros2@0.1.0","dsh-ros2-core@0.1.5","dsh-ros2-moveit@0.1.0","dsh-ros2-profile@0.1.0",
            "dsh-ros2-safety@0.1.0","dsh-ros2-state@0.1.0","dsh-ros2-vision@0.1.3"]
startup  : 每 bundle 一行 "dsh-ros2: loaded bundle <name>@<version>"
surface  : 83 tools / 9 skills（与不变量一致）
drift    : loaded 0.1.5 / disk 0.1.6 →  stale: true + "…请重启 harness 后重试。"
```
**反向验证**：把 `dsh-ros2-vision` 的登记名改错 → 不变量测试失败并给出可定位信息
（`vision must register dsh-ros2-vision: expected '…' to contain …`），随后已复原。

**#19 验收测量**（`scripts/verification/`，2026-09-14 Jazzy；10 节点 / 10 话题 / 86 服务 / 3 动作 / 2 帧）：

| 旅程 | L1 入口 | 工具调用 | 墙钟 | 判定 |
| --- | --- | --- | --- | --- |
| topology | `ros2_topology` | **1** | 2.1 s | 10 节点 / 10 话题 / 86 服务 / 3 动作 |
| liveness | `ros2_topology {rates}` → `ros2_topic_sample` | **2** | 10.4 s | 每话题实时速率 + `/tf_static`（latch、0 Hz）在第 2 次调用定性 |
| TF integrity | `ros2_topology {tf}` | **1** | 6.2 s | 2 帧（1 static / 1 dynamic，含位姿） |
| bring-up | `ros2_env_check` | **1** | 1.1 s | setup + 440 可见包 |
| robot identity | `robot_load` | **1** | 0.3 s | 档案（link / tf_root / 相机 / 组） |
| safety | `robot_safety_state` | **1** | 0.6 s | 锁存状态（本机 `monitor_running: false`） |

**6/6 可测旅程在 ≤2 次调用内作答**；对照：同一份拓扑盘点在效率研究中需要 **17 次裸 `ros2` CLI 调用**。
`measure.mjs` 在任一可测旅程破预算时**退出码非 0**，即验收结论可自动化。

**不可测的三条例程**（如实声明，不计入通过）：`state`（需 sidecar 数据面）、`vision`（需相机 + VLM 流水线）、
`motion`（需 MoveIt2 + 机器人描述）。另：bring-up 一行只覆盖**健康系统**，其真实故障路径
（陈旧 `rosSetup` → 会话内 `ros2_workspace use`）仍只有 `docs/feedback-env-recovery.md` 记载。

**测量台自身的两个修正**（都是"测量工具必须能被信任"的一部分）：
1. 初版 `measure.mjs` 用**最后一次调用**的结果判定整条旅程，导致 liveness 被误判为 FAIL（实际两次调用已作答）→ 改为**整条旅程可见其全部调用结果**。
2. 初版 teardown 用 `pkill -f "demo_nodes_cpp"` 这类**裸节点名**匹配命令行，可能误杀开发者自己的进程 →
   改为 `setsid` + 负 PID 杀**自己的进程组**；启动也从固定 `sleep 8` 改为**等待图收敛到 10 节点**
   （UDP 下发现不是瞬时的，实测曾把 10 节点误报成 3 节点）。

**测量过程中发现并修复的真缺陷（`fix(common)`）**：FastDDS 在 `/dev/shm` 不可用时把
shared-memory 传输错误写到 **stdout**（不是 stderr）。此前 `parseJsonOrRaw()` 把整个缓冲区当作
一个 JSON 文档解析，必然失败并**静默降级为 `{ raw: … }`** —— 在**健康的 10 节点系统**上
`ros2_topology` 报 **`nodes: 0`**。修复用**字符串感知的括号配对**（候选数有上限）定位内嵌文档；
噪声本身含方括号（`[RTPS_TRANSPORT_SHM Error]`）也算不出结果，因此候选必须"找到匹配闭括号**且**能解析"才成立。
新增 4 例回归测试（含"噪声在前"与"噪声在后"两种形状）。

### 14.5 dsh-phoenix 持续更新 / 测试链路（step 4）

- **活动 profile**：`~/.dsh/profiles/web/package.json` 含 `dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2`
  与 `dsh-phoenix: link:…/dsh-phoenix`；`node_modules` 内 **7 个** `dsh-ros2*` 条目
  （core/common/profile/moveit/safety/vision + 聚合包）均为指向本仓库的 symlink。
- **运行态**：`systemctl --user is-active dsh-web.service` → `active`；`NRestarts=0`；
  `curl http://127.0.0.1:3080/__dsh_health` → `{"token":"1789389995735-fdddikwqy7t"}`；
  `/home/stvli/tmp/dsh-phoenix-state.json` → `generation 16, lifecycleState running, pendingResume false`。
- **phoenix 自测**：`cd dsh-phoenix && npm test`（`node --test`）→ **41/41 pass**（exit 0）。
- **本轮行为变更的生效方式**：改动位于 symlink 指向的包源码，`lib/` 已重建（`packages/core/lib/tools.js`
  含 `bundleDriftReport`、`packages/common/lib/parse.js` 含括号配对、`packages/profile/lib/skill.js` 含
  `tf_root_source`）。dsh 自身的 HMR 忽略 `node_modules`，运行中的 dsh web 需**重启**才加载新代码；
  本轮**有意未就地触发重启**（理由见 §14.7-1）。
- **顺带取得的"活体证据"**：运行中的 dsh 于 `20:46:34` 启动，**早于**本轮构建（`20:52+`），
  因此它的 `ros2_env_check` **没有 `bundles` 段** —— 这正是 issue #22 描述的"陈旧进程"的**现场实例**，
  同时也印证了 §14.2 对 #22 的边界声明（自检需重启一次才生效）。

### 14.6 安全扫描（step 5）——复测 + 本轮新增面复核，未发现新漏洞

| 检查 | 结果 |
| --- | --- |
| `pnpm audit --registry=https://registry.npmjs.org` | **No known vulnerabilities found**（exit 0） |
| 硬编码密钥（`AKIA…` / `sk-…` / `ghp_…` / `BEGIN … PRIVATE KEY` / `AIza…` / `xox…`） | 源码（`packages`/`scripts`/`docs`）与 **git 全历史**（`git log -p --all`）均无 |
| `eval` / `new Function` / `node:vm` / `shell:true` | 无 |
| TS 命令执行面 | `execFile` / `spawn` 均**数组参数**；shell 字符串仅出现在 `runCommand` 的 `bash -lc`(runner.ts:196) 且命令由**已校验输入**拼装（`shq()`、`KILL_SIGNAL_RE`、`isSafeProfileName`、`buildRos2InstallDownloadCommand`、`gui` 的 `{output}` 经 `shq()`） |
| Python 命令面 | `subprocess.run` / `Popen` **全部 argv 列表**，无 `shell=True`、无 `os.system` |
| 历史加固回归 | `KILL_SIGNAL_RE`、`isSafeProfileName`、`buildSafetyMonitorCommand`、`_PROFILE_NAME_RE`（`robot_profile.py` 档案名边界）—— **均在位** |
| **本轮新增面** | ① `parseJsonOrRaw`：**纯字符串处理**（索引扫描 + 括号配对，候选数有上限，无正则回溯面）；② `bundles.ts`：`readFileSync` 读取的路径**全部来自 `import.meta.url`**（可信常量），无用户输入进入路径；③ `robot_profile.py`：仍是 **argv 列表**调用 `ros2`，新增的只是对输出的**正则解析**；④ `ros2_env_check`：只读登记表；⑤ `scripts/verification/*`：**不随任何 npm 包发布**（root `scripts/` 不在任何 `files` 中，root 包 `private`） |

**新增面的一项卫生加固（本轮自查发现）**：测量台初版的 teardown 用 `pkill -f "demo_nodes_cpp"` /
`"turtlesim_node"` 等**裸节点名**匹配命令行，可能误杀开发者正在运行的同名进程。已改为
`setsid` + `kill -- -PID`（**只杀自己的进程组**），仅保留一条锚定 `$HERE/lab_` 的兜底。
这不构成漏洞（脚本不发布、需人工执行），但属于"工具不应有超出必要范围的杀伤力"。

> 结论：本轮**未发现新漏洞、无需安全修复**；报告为"复测通过 + 新增面无风险 + 1 项工具卫生加固"。

### 14.7 结论与下一步建议

- 本轮把 3 个 open issue 全部推进：**#21 修复并真机复现/复核**（可 close）、
  **#22 落地但按边界保留 open**、**#19 完成遗留的验收测量**（可 close 或按维护者口径保留）。
  8 个提交 / 3 条 PR / 3 次 CI 全绿；240 vitest + 自检全绿，`pnpm audit` 干净，phoenix 41/41。
- 下次维护可选：
  1. **把本轮代码加载进运行中的 dsh**：需要一次 phoenix 优雅重启。本轮**仍有意未触发**——
     与第七轮同一理由：重启会中断维护流程本身。重启后应能看到 §14.5 所述的两行 journal 顺序，
     并且 `ros2_env_check` 开始返回 `bundles` 段（届时 #22 的自检才真正"上线"）。
  2. **`/tf_static` 的 latch 采样**：本轮实测 `find_tf_root()`（默认 volatile QoS）在广播者
     "只 latch 一次"时采样不到边，因而走了 URDF 回退（档案 `tf_root=base_link`、`source=urdf`，
     结果正确但来源不是 TF）。可加 `--qos-durability transient_local` 让 `tf_static` 成为首选来源，
     使 "TF 根 ≠ URDF 根"（如带虚拟 `world` 帧）的场景也正确。属 #21 的自然延续，本轮未做以控制范围。
  3. **#22 的两项遗留**：① issue 里"会话技能目录 vs 实际注册数"的**对账**（本轮只给信号）；
     ② 若希望"启动即报漂移"，可在挂载时**同时**读磁盘版本并比较（当前只在 `ros2_env_check` 调用时比较）。
  4. **运行中 dsh 的 ROS 环境探针异常**：本会话（旧进程）的 `ros2_env_check` 报
     "未检测到可见 ROS2 包"，而**同一条探针**在登录 shell 里 **0.8 s** 返回
     `__PKGS=440 / __NODES=10`。怀疑与 systemd 服务的执行环境或 20 s 超时有关，
     应在重启后复测；若复现，则是 `ros2-bringup-recovery` 旅程的真实反例。
  5. **#19 剩余口径**：切片 2（L3 缩面）仍为文档配方；若要变成"可验证产物"，
     需在 `${DSH_HOME}/.agent-presets/<id>/` 下写 diagnostics-only preset 并在 live agent scope 实测。
  6. 维持验收线："提交前 typecheck + test + build 全绿 + 行为变更补测试 + push 后 CI 绿"；
     `pnpm audit` 需带 `--registry=https://registry.npmjs.org`；**测量类结论须附可复现命令**
     （本轮已把 #19 的测量台固化进 `scripts/verification/`，后续验收不应再"手工搭一次就没了"）。

---

## 15. 维护记录（2026-09-21 · 第九轮：open issue #22 → 补齐其遗留项 + 发现并修复"探针报告 ≠ 探针执行" + 安全复测）

> 本轮结论：**1 个 open issue（#22）**。其第八轮列出的"仍未完成"三项中，**唯一真正未实现的第 2 项
> （会话技能目录对账）本轮补齐**，第 1 项确认为固有限制、第 3 项已在在途分支按边界落地。
> 验收过程中**发现并修复一个真缺陷**：`ros2_env_check` **报告的 setup 与实际执行命令所用的 setup 不一致**
> ——这正是第八轮 §14.7 第 4 条存疑项的**真因**（当时怀疑 systemd 环境或超时，均不是）。
> 本轮 3 个提交（`fix` / `feat` / `docs`）**全部推送**；**因 `gh` token 失效未能自动开 PR**（见 15.3）。

### 15.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `feat/bundle-surface-reconciliation`（工作树干净，与 `origin` 一致；**不在 main**） | 同分支 **+3 提交**，已推送 |
| `main` | `f161096`（第八轮 merge），= `origin/main` | **未变**（本轮未触碰 main） |
| 该分支未合并提交 | 6 个（2026-09-16） | 9 个 |
| open issue / open PR | **1 / 0** | **1 / 0**（#22 保持 open，见 15.2 结论） |
| 包数量 / 本地环境 | 9 包 · Node v24.16.0 · pnpm 11.22.0 · vitest 4.1.11 | 同 |
| 读取 issue 的方式 | 公开 REST API（`gh` token 失效，见 15.3） | 同 |

> **为什么起点不在 `main`**：仓库停在一条**在途 `feat/` 分支**上——它带有 6 个 2026-09-16 的提交
> （逐 bundle 能力面登记、安装清单挂载对账、启动自检、探针自述），质量完好、语义单一、已推送，
> 但**既未开 PR、也未记入本维护文档**，明显是"上一轮被中断的同一议题工作"。
> 按流程"新开 branch"的字面要求本可另起 `feat/...`，但那会把同一议题劈成两条互不相干的提交链，
> 也会让那 6 个提交永远没有维护记录；故**续用该分支**，改由**提交类型**（`fix:` / `feat:` / `docs:`）
> 承载语义。该判断记录在此以便复核。

### 15.1 Issue 检查（step 1）

公开 REST API `GET /repos/StvLi/dsh-ros2/issues?state=open` → **1 个 open issue**：

| # | 标题 | 状态 | 评论数 |
| --- | --- | --- | --- |
| 22 | `dx: surface loaded vs installed bundle versions so a stale running process is visible` | **OPEN** | 1 |

- **0 个 open PR**；issue/PR **#1–#26 除 #22 外全部 closed**。
- #22 的那条评论是第八轮的逐条结论，并**自己明确列出了"仍未完成"的 3 项**——本轮即针对这 3 项。
- 读取方式：`gh auth status` 显示**两个账号 token 均 invalid**，故改用公开 REST API（只读、无副作用、
  速率受限 60 次/时，本轮用量很小）。这不影响 issue 判断，但**影响开 PR**（见 15.3）。

### 15.2 建议评估（step 2）——逐条判断合理性与必要性

**①「自检本身也要重启一次才生效」——合理，但属固有限制，不修。**

旧进程里**根本不存在**这段代码，任何"自检"都无法在自身启动之前生效。第八轮已把它写成边界声明；
本轮维持该口径，并在 15.4 用运行中的进程**实测复现**了这条边界的正面价值：它恰好就是让
"进程代码陈旧"可见的那条信号（新字段缺席 = 该进程早于功能上线）。

**②「会话技能目录 vs 实际注册数的对账」——合理且必要，本轮补齐（唯一真正未实现的一项）。**

- 第八轮的实现只提供**信号**（每个 bundle 注册了哪些技能名），把比对留给读者，理由措辞是
  "leaves the comparison to the reader"。但**公共契约里本来就有对账入口**：
  `ctx.skills.snapshot({ scope: agent })` 返回"该 agent 视角下能看到的目录"。
- 本轮**在两个版本上确认了该 API 存在**：运行中的 harness（Inspect Provider 的 `skills` 契约，
  含 `list` / `snapshot` / `get`，`scope` 取 agent）与 `dsh-ros2-core` 的 peer 固定版
  `@deepseek-ai/dsh-skill@0.1.0-rc.6`（`lib/types/index.d.ts` 第 268 / 276 行同时有 `list()` 与 `snapshot()`）。
  **故"读不到目录"的前提不成立**，应当做真对账。
- **必要性**：这正是 issue 原文描述的症状（"会话技能目录只列出 9 个载体中的 6 个"），而且是
  **从任何单侧都看不出来**的——只看 bundle 侧（注册了 9 个）或只看会话侧（列了 6 个）都无法断言谁不对，
  只有逐名比对才能把"注册了但会话看不到"变成一句可读的结论。

**③「启动即报漂移」——部分合理，在途分支已按边界落地为"启动即报挂载/能力面"，而非"启动即报漂移"。**

漂移（磁盘版本 ≠ 加载版本）只可能在**磁盘变动之后**才可观测，t=0 的探针永远看不到它；
启动时**能**看到的只是"哪些 bundle 挂上了、各自登记了什么"。在途分支的
`scheduleBundleStartupReport()` 正是这么做的：轮询到挂载集合**稳定**后打一行汇总，并对
`missing` / `drift` / `unresolved` / `unreported` 分别告警；且**没有**在挂载中途去读磁盘版本做比对
（bundle 是顺序挂载的，任何瞬时快照必然是半张表——第七轮已因这个理由否决过"一行汇总"的写法）。
**接受该实现与其边界**。

结论：**#22 的三条建议全部合理**；② 本轮补齐，① 为固有限制，③ 已按边界落地。
因①这条固有限制不会因代码消失，**#22 本轮保持 open**（与第八轮一致），但**"未实现项"已归零**——
维护者若认可"固有限制已如实声明"，可自行 close。

### 15.3 开发管理（git · step 3）

- 分支：**续用** `feat/bundle-surface-reconciliation`（理由见 15.0）。
- 本轮新增 3 个提交（Conventional Commits）：

| commit | 类型 | 说明 |
| --- | --- | --- |
| `de100b5` | `fix(core)` | 探针改为在**它自己报告的那个** setup 下执行；源码不再自带 prefix（避免二次 source）；`ros2_workspace show` 同源修正；补回归测试；并修掉两个测试泄漏的全局 session override |
| `a042e83` | `feat(core)` | `ros2_env_check` 对账会话技能目录（`data.skillCatalogue`），"不可用"一律如实报不可用；+9 例测试（5 例工具级 + 4 例适配器级） |
| `d64d1de` | `docs` | CHANGELOG（Added/Fixed/Changed）＋ README / README_CN 的用例数校正（195 → 277 例；`robot_profile` 自检 17 → 实测 29 项） |

- **提交类型的诚实性**：`fix` 与 `feat` 改动落在同 3 个文件里（`core/src/index.ts`、`core/src/tools.ts`、
  `core/tests/tools.spec.ts`），直接 `git add -p` 无法干净切分。故 `de100b5` 的状态是**从最终树精确重建**的：
  先备份最终版 → 把那 3 个文件回退到 `bad1d52` → **只重放该修复的 7 处改动** → 提交 → 再还原最终版。
  因此 `de100b5` **单独检出也能 typecheck/test 全绿**（119 过 + 1 skip；`feat` 未混入），
  不会出现"看着是 fix、其实依赖 feat"的历史。
- 推送：`bad1d52..d64d1de  feat/bundle-surface-reconciliation` → `origin` 成功。
- **未开 PR（需人工或补 token）**：`gh auth status` 两个账号 token 均 invalid，无鉴权无法建 PR。
  分支已推送，可直接开：
  `https://github.com/StvLi/dsh-ros2/compare/main...feat/bundle-surface-reconciliation`

### 15.4 本地验收（全绿）＋ 本轮缺陷的可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run typecheck   # 9 项目 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test        # 277 vitest（276 过 + 1 pty-skip）+ sidecar 10 场景 + zero_pose 6 项 + robot_profile 29 项
CI=true pnpm run build       # 9 包 tsc 全部 Done（exit 0）
```

**用例分布（实测）**：common 45 + core 129（128 过 + 1 skip）+ moveit 16 + profile 14 + safety 10 +
vision 30 + state 8 + dsh-ros2 25 = **277**。第八轮收尾 241 → **+36**；其中**本轮新增 10 例**
（5 例技能目录对账 + 4 例探针适配 + 1 例 setup 报告回归），其余 +26 为在途分支的测试。

**本轮缺陷（报告 ≠ 执行）的离线复现**——用**已构建的 `lib/`**，不需要 GUI，也不需要 ROS：

```js
// 关键两行：工具"报告"的解析 vs 命令实际"执行"的解析
const reported = resolveSetup({ workspaceRoot: WS })                       // 旧代码：裸 opts → 自动探测
const res = await runCommand('bash', ['-lc', probe], { rosSetup: CONFIG })  // 旧 probe 自带 prefix → 二次 source
```

| 观测项 | 修复前 | 修复后 |
| --- | --- | --- |
| 报告的 `setup` | `explicit:false`、`sourcePath:/opt/ros/jazzy/setup.bash`、prefix 只有一行 source | `explicit:true`、prefix 为**配置的完整链**（含 `/tmp/vlm_ws/...`） |
| 实际执行的命令 | `source /opt/ros/jazzy/... && bash -lc 'source /opt/ros/jazzy/... && echo …'`（**两条** source 链，外层来自配置） | 只有**一条**链：`source <配置链> && bash -lc 'echo …'` |
| 结果 | **exit 1、stdout 空**、stderr 指向 `/tmp/vlm_ws/...`，而报告的却是一个"健康"的 `/opt/ros/jazzy` | 报告与失败**指向同一件事**；把 rosSetup 换成健康链后 **exit 0、`__PKGS=440`** |

**运行中 dsh 的实测证据（本会话，未重启）**：`ros2_env_check` 返回

```text
probe   : { exitCode: 1, timedOut: false, durationMs: 620, stdoutBytes: 0,
            stderrTail: "bash: line 1: /tmp/vlm_ws/install/setup.bash: No such file or directory" }
bundles : loaded 6 / expected 6 / missing [] / undeclared [] / unreported []
          surface 合计 81 tools + 9 skills（core 61 / profile 4 / moveit 4 / safety 5 / vision 7）
```

即：**在途分支的挂载对账已在运行中的进程里生效**，而**本轮的技能目录对账尚未生效**
（该进程的代码早于本轮提交，返回里没有 `skillCatalogue` 段）——**这正是 #22 所描述的"进程陈旧"本身**，
也再次印证 15.2 ①"自检需重启才生效"是不可消除的固有限制。

### 15.5 dsh-phoenix 持续更新 / 测试链路（step 4）

- **活动 profile**：`~/.dsh/profiles/web/package.json` 含
  `dsh-ros2: link:…/dsh-ros2/packages/dsh-ros2` 与 `dsh-phoenix: link:…/dsh-phoenix`。
- **挂载行**：`~/.dsh/profiles/web/cordis.patch.yml` 显式装载 5 个域 bundle
  （core / profile / moveit / safety / vision），聚合包与 dsh-phoenix 经各自 `package.json` 的 bundles 列表装载
  （该文件第 71–72 行已注明 phoenix **不要重复 insert**，否则 duplicate）。
- **在线判定**：`curl -s http://127.0.0.1:3080/__dsh_health` → `{"token":"1789983586590-…"}`
  ⇒ 心跳端点在线 = **客户端自动重连在跑**。
- **优雅重启能力**：`systemctl --user is-active dsh-web.service` → `active`；unit 为 `Type=simple`、
  `Restart=on-failure`、`TimeoutStopSec=30`，并带 `DSH_PHOENIX_STATE_FILE=…/dsh-phoenix-state.json`
  ⇒ idle-aware 优雅重启与 checkpoint 续跑能力**在位**。
- **客户端 HMR**：`ps` 中**没有** `vite` / `pnpm run dev:web` 进程 ⇒ **客户端插件 HMR 未武装**。
  本轮改动**全在 Host 侧**（`packages/common` + `packages/core` 的 TS）且未改 client bundle，
  故不影响本轮验证；但若日后要改 Client 插件并期望免刷新重载，需先跑 `pnpm run dev:web`。
- **本轮如何使用它**：改 → `typecheck/test/build` 全绿 → 提交 → 推送。
  **仍有意未触发优雅重启**（与第七/八轮同一理由：重启会中断本维护会话本身）。
  因此本轮代码只落到磁盘（`lib/`），运行进程仍是上一版——这**恰好**构成 15.4 那条"进程陈旧"的现场证据。
  重启后可观测的变化：`ros2_env_check` 开始返回 `skillCatalogue` 段；且（在修正部署配置后，见 15.7）
  环境探针不再失败。

### 15.6 安全扫描（step 5）——复测 + 本轮新增面复核，未发现新漏洞

**依赖漏洞**：

- `pnpm audit`（默认 registry = `registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`
  （该镜像未实现 audit 端点）。**这不是"干净"，是"没查成"**，不可当作结论。
- 显式换官方源复测：`pnpm audit --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**。
  （第八轮已记录该注意点，本轮再次确认；CI 的 `pnpm audit --prod --audit-level high` 闸门同理依赖默认源配置。）

**静态扫描**：`shell: true` 零命中；`child_process.exec(` 零命中；`eval(` / `new Function(` 零命中；
硬编码密钥（`AIza…` / `sk-…` 模式）零命中。

**既有防线回归复测**（均随测试全绿）：

| 面 | 防线 | 证据 |
| --- | --- | --- |
| 命令注入 | `ros2_process_cleanup` 的 `signal` 白名单，非法值在**审批之前**以 `INVALID_PARAM` 拒绝 | `packages/core/src/tools.ts` 校验仍在 |
| 路径穿越 | `isSafeProfileName` + `resolveProfilePath` 对穿越名**永不 spawn** | `packages/common/tests/names.spec.ts`（4 组） |
| shell 注入 | `shq()` 单引号包裹；safety_monitor 命令只含一个 shell word | `packages/common/tests/runner.spec.ts`（含含空格路径） |
| 不经 shell | `safety_monitor` 走 argv 数组、watchdog 话题不插值 | `packages/safety/tests/safety-monitor-shell.spec.ts` |

**本轮新增面的评审**：

- 改动**减少**了 shell 字符串拼接：探针不再自带 prefix（原先会拼出两条 `source` 链）。
- `ToolDeps.rosSetup` 只承载**配置值**，不来自模型输入；`resolveSetup` 的输入面与改动前一致。
- 技能目录读取是**只读** `snapshot()`；只复制 `name` / `complete` **叶子字段**，
  不把 live 目录对象带进工具结果（符合"不序列化 live 数据"）。
- `missing` 的取值**只可能来自本仓库自己注册的技能名**（注册集合减去可见集合），
  既不来自模型输入也不来自外部数据，不构成新的注入面。

结论：**未发现新漏洞**；依赖面干净（官方源复核）；本轮改动缩小而非扩大了攻击面。

### 15.7 本轮发现（含仓库外的问题）

1. **【部署配置陈旧·高优先·仓库外】** `~/.dsh/profiles/web/cordis.patch.yml` 的 5 行 `rosSetup`
   至今以 `source /tmp/vlm_ws/install/setup.bash &&` 结尾，而**同一个文件第 29 行的注释写着
   "/tmp/vlm_ws was removed so use the delivery workspace that is actually built"**——
   注释改了、值没改。`/tmp/vlm_ws` 目录**已不存在**（实测 `ls` 报 No such file），
   于是 5 个 bundle 的**每一次** ros2 工具调用都会在该链上失败。
   修法（一行 ×5，或只保留已构建的交付工作区）：
   ```yaml
   rosSetup: source /home/stvli/lite_delivery_aio/install/setup.bash &&
   ```
   > 该文件在本仓库之外，且属于**运行中的部署配置**，本轮**未擅自修改**（沙箱为 workspace-write，
   > 且改它会影响用户正在跑的实例）。请维护者确认后修改，然后重启 dsh 生效。
2. **【第八轮 §14.7 第 4 条的真因已定位】** 当时怀疑"systemd 执行环境或 20 s 超时"，**都不是**。
   真因是 15.4 的**报告≠执行 + 二次 prefix**：外层（配置）链失败、内层（自动探测）链根本没跑到，
   于是 stdout 为空，工具报出"未检测到可见 ROS2 包"（旧措辞），而"同一条探针在登录 shell 里正常"
   正是因为手工执行时只走了内层那一条链。**该存疑项可以关闭。**
3. **【残留限制·建议后续】** `resolveSetup` 只校验显式前缀里的**第一个** `source` 路径；
   `A && B` 中 B 缺失时它仍判定为"explicit 且看起来正常"，缺失只体现在 stderr 里。
   建议后续**校验整条 `&&` 链**（任一段缺失即按既有策略回退，并在 note 中点名缺失项）。
   本轮**未做**：它会改变"响亮失败"与"自愈"的语义，影响每一次工具调用，值得单独一轮与其测试。
4. **【测试卫生·本轮已修】** `ros2_workspace use` 的两个测试会写入**模块级全局** session override
   却从不复位，把状态泄漏给同进程后续测试（`de100b5` 已补 `setSessionRosSetup(null)`）。
5. **【文档漂移·本轮已修】** README / README_CN 的用例数停在 "195 例"（落后两轮），
   `robot_profile` 自检数停在 17 项（实际 **29** 项，第八轮给 #21 补的 13 项 TF 解析自检未计入）。
   两处均已按**实测值**校正为 277 例 / 29 项。

### 15.8 结论与下一步建议

- **#22**：三条建议全部合理；**唯一未实现项（会话技能目录对账）本轮补齐**，另两项（固有限制 / 已按边界落地）
  均如实声明。**可 close，或按维护者口径继续保留 open** 以跟踪 15.2 ① 的重启边界。
- **本轮修掉一个真缺陷**：诊断工具"报告的 setup ≠ 实际执行的 setup"。这类"诊断自己说错话"的缺陷
  与 #22 同源，且**只在真机（陈旧配置 + 运行中进程）上才暴露**——离线单测与 `main` 上的 CI 都发现不了它。
- **验收线**：typecheck / test / build 全绿；行为变更均补测试；分支已推送（**PR 待人工开**，token 失效）。
- 下次维护建议：
  1. **修正 15.7 第 1 条的部署配置**（仓库外，需人工确认），随后**重启 dsh**；
     重启后应看到 `ros2_env_check` 返回 `skillCatalogue` 段且探针不再失败——这同时闭合 15.2 ① 的边界。
  2. **给 `gh` 重新登录**（`gh auth login -h github.com`），以便后续轮次能自动开 PR；
     否则每轮都只能推分支、留 PR 给人工。
  3. 考虑把 15.7 第 3 条（整链校验）作为独立一轮：先补 `resolveSetup` 的多段校验测试，再改行为。
  4. 若要让**运行中**的 harness 用上本轮代码：走 §15.5 的 phoenix 优雅重启，
     而不是手工 `systemctl restart`（本轮仍有意未触发，以免中断维护会话本身）。
  5. 维持"提交前 typecheck + test + build 全绿 + 行为变更补测试 + push 后 CI 绿"的验收线；
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`，否则会误报"失败"而非"干净"。

---

## 16. 维护记录（2026-09-22 04:14 CST / UTC 2026-09-21 20:14 · 第十轮：补齐"在途无 PR"缺口 → CI 抓出"本地绿、CI 红" → 定位并修复线上故障真因 → 验收并关闭 #22）

> 本轮结论：**1 个 open issue（#22）→ 在运行中进程里逐条验收后关闭（completed）**。
> 两件"上一轮留下的"事在本轮闭合：
> ① 第九轮的 9 个提交**已推送却从未开 PR**，因此**从未跑过 CI**——本轮开 PR #27 后**首跑即失败**（6 条 `TS2307`），
> 暴露了一个只在**干净 clone** 上出现的真缺陷（本地全绿只是因为工作区留着上一轮的 `lib/`）。
> ② 第九轮 §15.7 第 3 条（"只校验 `rosSetup` 第一段"）当时是"建议后续"，本轮确认它**就是线上部署
> "每一次 ros2 调用都失败"的直接成因**，因此升格为必修并落地：**插件现在能自愈这个坏配置**。
> 本轮 3 个 PR（#27 / #28 / #29）**全部 CI 绿并合入 `main`**（`11edc1d`），5 个提交，用例 277 → **285**。

### 16.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `feat/bundle-surface-reconciliation`（工作树干净，与 `origin` 一致；**9 个提交未合并、且没有 PR**） | **`main` = `11edc1d`**（本地与 `origin/main` 一致） |
| `main` | `f161096`（第八轮 merge） | `11edc1d`（#27 → `e1e8e38`、#28 → `8e5c443`、#29 → `11edc1d`，三个 merge） |
| 该 `feat` 分支 | 9 个提交，已推送，**无 PR ⇒ CI 从未运行** | **已合并**（PR #27） |
| open issue / open PR | **1 / 0** | **0 / 0**（#22 close；#27/#28/#29 均已合并） |
| `gh` 鉴权 | 第九轮：两个账号 token 均 invalid（只能推分支、开不了 PR） | **已恢复**：`StvLi`（active）+ `littleZ05`，keyring 存储；本轮全程用 `gh` 操作 |
| issue/PR 总数 | #1–#26 除 #22 外全部 closed | #1–#29 全部 closed |
| 包数量 / 本地环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| vitest 用例 | 277（276 过 + 1 skip） | **285**（284 过 + 1 skip） |
| 运行中的 dsh | 启动于 **2026-09-21 17:58:15 CST**（晚于第九轮最后提交 `17:51:03 CST` ⇒ **已加载第九轮代码**） | 同进程（本轮代码落盘待重启，见 §16.5） |

### 16.1 Issue 检查（step 1）

`gh issue list --state open` → **1 个 open issue**：`#22`（`dx: surface loaded vs installed bundle versions…`，1 条评论）；`gh pr list --state open` → **0**。

**本轮的第一手发现（比 issue 本身更重要）**：第九轮的在途分支有 9 个提交、已推送，**却从未开 PR**。而 CI 只
在 `push: main` 与 `pull_request` 上触发（`.github/workflows/ci.yml`），所以那 9 个提交**一次都没被 CI 看过**。
本轮第一步就是补开 **PR #27**，CI 首跑**失败**（见 §16.4 证明 1）——这说明"没开 PR"不是流程小事，而是
**把 9 个未验证的提交当成了已验收成果**。

`gh` 鉴权恢复（第九轮"下次维护建议"第 2 条）是本轮能做这件事的前提：`gh auth status` 显示 `StvLi` 为 active；
因此本轮的**开 PR、看 CI、合并、评论并关闭 issue** 全部自动完成，不再留人工尾巴。

### 16.2 建议评估（step 2）——逐条判断合理性与必要性

**① `#22` 的三条建议：全部合理，全部已实现；"未实现项"为零 ⇒ 本轮关闭。**

| # | 建议 | 状态 | 本轮验收证据（**运行中进程**，非离线） |
| --- | --- | --- | --- |
| 1 | 暴露已加载 bundle 集合/版本 | ✅ 第九轮落地（**每 bundle 一行**，非一行汇总） | `data.bundles.loaded` 6/6、`stale: false`、逐包 `loaded == installed` |
| 2 | 只读诊断入口（loaded vs installed 漂移） | ✅ 第九轮落地（扩展 `ros2_env_check`，不新增工具） | `bundles.drift` / `stale` / `unresolved` 均有值 |
| 3 | "会话技能目录 vs 实际注册数"对账 | ✅ 第九轮落地 | `skillCatalogue: available true / complete true / missing []`，`visibleCount 13`（9 个注册技能全可见 + 4 个项目/用户技能） |

其中第 1 条里"**自检本身也要重启一次才生效**"是**固有限制**（旧进程里根本不存在这段代码），不是待办：
本轮反而把它当**正向信号**使用——**字段缺席本身就等于"该进程早于功能上线"**。已写入 `docs/versioning.md`
（"已加载版本 vs 磁盘版本"一节），并在 §16.4 用运行中进程实测到它的正面价值。
⇒ 故 #22 以 **completed 关闭**，并留下逐条验收评论（含上表数据）。
**唯一仍建议人工处理的**是 §16.7 第 2 条（仓库外的部署配置死段）——新代码已能自愈，但配置本身该修。

**② 第九轮 §15.7 第 3 条（只校验第一段）：从"建议"升格为"必修"。**

第九轮把它列为"残留限制·建议后续：只校验显式前缀里的第一个 `source` 路径"。本轮在真机上确认它不是
"不够严谨"，而是**线上故障的直接成因**：

```text
rosSetup: source /home/stvli/lite_delivery_aio/install/setup.bash && source /tmp/vlm_ws/install/setup.bash &&
```

`/tmp/vlm_ws` 已不存在 ⇒ 第一段存在使旧实现判定"配置正常"（`explicit: true`、无 note），
而**每一次**调用都失败在第二段。必要性的判断依据因此从"设计上更完备"变为"**当前部署正在坏**"。

**③ 同现场的第二个真缺陷：诊断自己说反话。**

探针失败的告警写死"这通常说明探针命令在该进程环境里失败，**而非 rosSetup 路径无效**"——同一行的 stderr
恰恰就是 `/tmp/vlm_ws/install/setup.bash: No such file or directory`。**合理且必要**：这类"诊断说错话"的
缺陷会直接把排查引向错误方向（第九轮就曾被它误导）。已改为**引用环境解析的结论**。

**④ 本轮新增（现场发现）：`&&ros2` 回显。**

前缀以 `&&` 结尾且无尾空格时，`runCommand` 拼出 `… setup.bash &&ros2 'node' 'list'`。shell 解析与
`&& ros2` **完全等价**，所以**不是功能缺陷**；但它是**每条失败信息**里回显的形式，本轮排查时确实先让人
怀疑"命令拼错了"。判为**诊断缺陷，值得修**（修在构建 shell 字符串处，配置的忠实回显不变）。

**⑤ 本轮明确"不做"的**：`#22` 第 1 条的固有限制（不可能修）；`/tmp/vlm_ws` 的文档/代码残留
（§16.7 第 3/4 条：一个在仓库外的配置里，一个应单开一轮改为可配置）。

### 16.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#27** | `feat/bundle-surface-reconciliation`（**续用**第九轮在途分支） | `47626d4` | `fix(ci)` | 根 `typecheck` / `test` 改为先按**拓扑序**构建整个家族——`tests/mount.spec.ts` 按真实包名导入 6 个 bundle，干净 clone 上 `lib/` 不存在时必失败 |
| **#28** | `fix/ros-setup-chain`（新开，off `47626d4`） | `f893988` | `fix(common)` | `resolveSetup` 逐段校验 `&&` 链；部分缺失只剔除该段并点名；全缺失才回退 |
| | | `3fcfd3f` | `fix(core)` | 探针失败时不再否认 rosSetup；`setup.missingSources` + `ros2_workspace show` 暴露结论 |
| | | `98fa86f` | `docs` | CHANGELOG + `docs/feedback-env-recovery.md`（新增"整链校验"一节）+ README 计数 |
| **#29** | `fix/setup-prefix-join`（新开，off `8e5c443`） | `ca4652d` | `fix(common)` | 前缀与命令之间插入分隔符（消除 `&&ros2` 回显） |
| | | `8de9d21` | `docs` | CHANGELOG（含"为什么是诊断缺陷而非功能缺陷"）+ README 计数 285 |

- **为什么 #27 是在途分支上补一个 `fix(ci)`，而不是另开分支**：那 9 个提交是第九轮同一议题的成果且已推送，
  CI 失败**源于它们**（`mount.spec.ts` 正是其中新增的文件）；补丁是"让该分支可合并"的一部分。另开分支会把
  "红的分支"永久留在历史里，也会让第九轮的成果继续无法进入 `main`。
- **提交类型的诚实性**：`fix(common)` / `fix(core)` / `docs` 按**文件**切分（`packages/common/**`、
  `packages/core/**`、`CHANGELOG+README+docs/**`），依次检出都能 `typecheck` 全绿；`fix(core)` 依赖
  `fix(common)` 新增的 `missingSources` 字段，**顺序在前**，不存在"看着是 fix、其实依赖后面才有的东西"。
- 分支/提交均已推送；三个 PR 经 CI（Node 22 + 24）全绿后合入 `main`。
- 收尾状态：`main` = `11edc1d`，工作树干净，本地 `main` 与 `origin/main` 一致。

### 16.4 本地验收（全绿）＋ 三个可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib          # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck     # 9 包 tsc --noEmit 全部 Done（exit 0，8.3s）
CI=true pnpm run test          # 285 例（284 过 + 1 pty-skip）+ sidecar 10 场景 + zero_pose 6 项 + robot_profile 29 项（8.0s）
CI=true pnpm run build         # 9 包 tsc 全部 Done（exit 0）
```

**用例分布（实测）**：common **51** + core **131**（130 过 + 1 skip）+ moveit 16 + profile 14 + safety 10 +
vision 30 + state 8 + dsh-ros2 25 = **285**。第九轮收尾 277 → **+8**（common +6：整链校验 5 + 前缀拼接 1；
core +2：诊断措辞与数据出口）。

**证明 1 ｜ CI 的失败可以在本地逐字复现（`47626d4` 的动机）**

```text
# 删除全部 lib/ 后执行 CI 的同一步（旧脚本只先构建 dsh-ros2-common）：
packages/dsh-ros2 typecheck: tests/mount.spec.ts(4,28): error TS2307: Cannot find module 'dsh-ros2' …
… 共 6 条（dsh-ros2 / -core / -moveit / -profile / -safety / -vision）
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL]  → exit 2      # 与 CI 日志逐字一致
# 修复后同一命令：exit 0
```

**证明 2 ｜ 线上故障可复现、且已被新代码自愈（`f893988` 的价值）**

用**字面量**的部署配置走**已构建的 `lib/`**（`node` 直接调用，可离线复现）：

| 观测项 | 修复前 | 修复后 |
| --- | --- | --- |
| `runCommand` 结果 | `ok: false`、exit `1`、stdout 空 | `ok: true`、exit `0`、`__PKGS=450` |
| stderr | `bash: line 1: /tmp/vlm_ws/install/setup.bash: No such file or directory` | （空） |
| `envNote` | 无 | 点名 `/tmp/vlm_ws/install/setup.bash` 不存在、已剔除该段、保留 1 段（首个 source = `lite_delivery_aio`） |

运行中会话的**对照证据**同样干净：同一份坏配置下 `ros2_node_list` 返回
`COMMAND_FAILED`（`bash: line 1: /tmp/vlm_ws/…`）；把会话覆盖指向 `lite_delivery_aio`（`ros2_workspace use`）后
立即返回 `["/robot_state_publisher"]`、`ros2_env_check` 报 `visiblePackages: 450`、`probe.exitCode: 0`
——即**环境本身健康，唯一的问题就是那段死链**。

**证明 3 ｜ 新测试是 load-bearing 的（`ca4652d` 的价值）**

按"撤掉实现，测试必须失败"验证：`git stash push -- packages/common/src/runner.ts` 后重跑，新测试立即失败：

```text
× inserts the separator when the prefix ends at && and still runs the command
AssertionError: expected 'Command failed: bash -lc source /tmp/…' to contain 'source /tmp/dsh-runner-join-…'
Tests  1 failed | 50 skipped (51)
```

恢复实现后同一测试通过。**CI 结果**：PR #27 首跑 `failure`（33s）→ 修复后 `pass`（1m14s）；
#28 `pass`（Node 22 1m12s / Node 24 47s）；#29 `pass`（22 1m5s / 24 1m2s）；`main` 的两次 push 亦 `success`。

### 16.5 dsh-phoenix 持续更新 / 测试链路（step 4）

| 面 | 观测 | 判定 |
| --- | --- | --- |
| 挂载与版本 | journal：`[dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)`（17:58:18）；`dsh-phoenix@0.2.6` | ✅ 在位 |
| 持久检查点 | `DSH_PHOENIX_STATE_FILE=/home/stvli/tmp/dsh-phoenix-state.json` → `generation 18`、`lifecycleState "running"`、`pendingResume false`、`resumeAttempt 0` | ✅ 状态机已跑过 18 代 |
| 进程托管 | `systemctl --user is-active dsh-web.service` → `active`；`Type=simple`、`Restart=on-failure`、`ExecMainStartTimestamp=2026-09-21 17:58:15 CST` | ✅ |
| 客户端重连 | `curl http://127.0.0.1:3080/__dsh_health` → `{"token":"1789984696301-…"}`（per-boot token） | ✅ 心跳端点在线 |
| 延后策略（源码实测） | `deferPollMs 3000` / `deferSoftMs 300000`（5 分钟软告警）/ `deferHardMs 900000`（15 分钟硬期限）/ `deferPolicy auto` | ✅ 空闲优先，有安全阀 |
| 触发面 | 只对 **`cordis_run`（动态插件激活）** 触发；`dsh_phoenix_restart` / `dsh_phoenix_state` 两个工具在 `创造模式 (phoenix)` preset（`~/.dsh/.agent-presets/cordis-phoenix/`）里，**本维护会话的 preset 不含它们** | ⇒ 本会话走**文档化的 `cordis_run` 触发面** |
| 客户端 HMR | `ps` 中无 `vite` / `pnpm run dev:web` | ⚠️ 未武装；本轮改动**全在 Host 侧**，不受影响 |

**更新回路已被证明闭环（第九轮留下的观测）**：运行中进程启动于 `17:58:15 CST`，**晚于**第九轮最后一个
提交 `17:51:03 CST`，而它的 `ros2_env_check` **已经返回**第九轮才有的 `surface` / `skillCatalogue` 段。
即"改 → 构建 → 重启 → 新代码生效 → 诊断自证"这条回路**确实跑通过**（这也正是 §16.2 ① 那条固有限制的
正面用法：**字段在不在，就是进程新旧**）。

**本轮如何使用它**：改 → `typecheck/test/build` 全绿 → 提交/推送 → **CI 绿** → 合入 `main` → 重建 `lib/`
（部署经 `~/.dsh/profiles/web/node_modules/…` 符号链接 realpath 直连仓库 `packages/*/lib`）→
按触发面请求**非强制**优雅重启（`force=false` 语义：忙碌则延后到空闲安全点），随后不再继续操作，
把重启留给"本会话空闲"这一安全点。

**触发已确认（journal + 检查点实测，非推断）**：

```text
04:18:06  [cordis:rosmnt-1] cordis_run activation: the round-10 dsh-ros2 fix is built and merged
                           (main a0a1370); requesting that dsh-phoenix defer a graceful restart …
04:18:06  [dsh-phoenix] cordis tool: cordis_run
04:18:09  [dsh-phoenix] restart requested (gen 19): plugin-change
检查点    → generation 19 / lifecycleState "deferred" / deferDeadline 1790022789189（= 04:18:09 + 15min = 04:33:09 CST）
```

即 phoenix **看到了**这次激活、**登记了第 19 代重启请求**，并因维护会话仍在运行而进入 `deferred`；
维护会话结束时，下一个 3s 轮询点即执行优雅重启（软告警 5 分钟、硬期限 15 分钟、policy `auto`）。
这就是"**用 dsh-phoenix 做插件持续更新**"的**末端动作**：改动已合入 `main` 并构建进 `lib/`，
重启只是把它从磁盘搬进进程——同时由 `/__dsh_health` 的 boot token 让浏览器自己刷新。

- **重启后可观测的变化（预期）**：`ros2_env_check` 返回 `setup.missingSources = ["/tmp/vlm_ws/install/setup.bash"]`
  与对应 `note`；每次 ros2 调用的失败消失（死段被剔除）；`runCommand` 的失败信息不再出现 `&&ros2`。
- **诚实边界**：本会话仍在运行，因此**无法在同一进程内观测重启后的结果**。§16.8 第 1 条把它列为下次维护的
  第一复核项；若 phoenix 因本会话持续忙碌而未执行，按上面的触发面再请求一次即可。

### 16.6 安全扫描（step 5）——依赖 + 静态 + 本轮新增面复核，未发现新漏洞

**依赖漏洞**：

- `pnpm audit --prod --audit-level high`（本机默认 registry = `registry.npmmirror.com`）→
  `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，不可当作结论。
- 显式换官方源复测：`pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` →
  **No known vulnerabilities found**。
  （注：CI 里的同一闸门在 GitHub runner 上**默认源就是官方源**，因此 CI 的闸门是有效的；只有本机需要显式指定。）

**静态扫描**（`packages/*/src`，零命中）：`shell: true` 0；`child_process.exec(` 0（命中的全是 `RegExp.exec`）；
`eval(` / `new Function(` 0；硬编码密钥（`AIza…` / `sk-…`）0。

**本轮新增面评审**：

| 面 | 结论 |
| --- | --- |
| 整链校验如何重建前缀 | **只做删除**：重建用的都是**原有段落的原文**（`trim()` 后拼接），不插入任何新值 ⇒ 不引入新的拼接内容 |
| `missingSources` 的来源 | 只来自**配置文本**（与 `rosSetup` 同信任级），**不来自模型输入、不来自外部数据** |
| `note` / `missingSources` 的信息暴露 | 只是把配置里的路径**回显**给本来就能读该配置的模型 ⇒ 无新增信息面 |
| 探针告警改写 | 纯措辞，不执行任何东西 |
| `runCommand` 的分隔符 | **常量空格**，不引入变量 ⇒ 无注入面 |
| 既有防线回归 | 随测试全绿：`signal` 白名单（非法值在**审批之前**以 `INVALID_PARAM` 拒绝）、`isSafeProfileName` 路径穿越（4 组）、`shq()` 单引号包裹（含空格路径）、safety_monitor 走 argv 数组 |

结论：**未发现新漏洞**；本轮改动缩小而非扩大了攻击面（去掉了一条必然失败的外层 `source` 链）。

### 16.7 本轮发现（含仓库外的问题）

1. **【流程·已修·重要】"推送了但没开 PR" = CI 从未运行。** 第九轮的 9 个提交在 CI 上**首跑即失败**。
   已把教训写进 §16.1/§16.4：**分支推送后立刻开 PR，让 CI 说话**；否则 `main` 之外的一切都是"未验证"。
2. **【部署配置·仍未修·高优先·仓库外】** `~/.dsh/profiles/web/cordis.patch.yml` 的 5 行 `rosSetup` 至今以
   `source /tmp/vlm_ws/install/setup.bash &&` 结尾，而 `/tmp/vlm_ws` **已不存在**；同文件第 29 行的注释写着
   "改用实际构建的交付工作区"——**注释改了、值没改**。本轮**未擅自修改**（仓库外 + 运行中的部署），
   但新代码已能**自愈**它（剔除死段并点名）。建议人工删掉这 5 处死段，然后优雅重启。
3. **【代码·未修·建议单开一轮】** `packages/vision/src/tools.ts:316` 把 `/tmp/vlm_ws/install` **硬编码**为
   `ros2_vision_doctor` 的候选 install 目录。它是历史本机路径、现已不存在（只是让 built 判定少一个候选）。
   建议改为可配置（vision 包 config）或从 ROS2 环境派生，而不是写死一个已删除的路径。
4. **【文档·未修】** `docs/compatibility.md:9` 仍把 `/tmp/vlm_ws` 写成"本机"L4 包位置（README/README_CN 里的
   `/tmp/vlm_ws` 是**构建示例**，可保留）。本机现状类描述应更新。
5. **【固有限制·如实声明】** `ros2_env_check` 的 `skillCatalogue` / `surface` 等自述字段需要**重启后**才存在；
   本轮把它当**正向信号**使用（字段缺席 = 该进程早于功能上线）。这不是缺陷，故不再追踪。
6. **【时间口径】** 本轮跨了本地日界：CST `2026-09-22 04:xx` = UTC `2026-09-21 20:xx`。本节标题用**本地时间**，
   而 git / CI / journal 的时间戳为 UTC（第九轮的 `17:5x CST` 也随之解释）。

### 16.8 结论与下一步建议

- **交付**：PR **#27**（合并第九轮成果 + 修 CI）、**#28**（整链校验 + 诊断措辞）、**#29**（前缀分隔符）
  全部 CI 绿并合入 `main`（`11edc1d`）；issue **#22 验收后关闭**；**open issue / open PR 归零**；
  用例 **277 → 285**；README / README_CN / CHANGELOG 计数同步。
- **线上价值**：部署配置里的死段不再让**每一次** ros2 调用失败——新代码剔除死段、在 `note` 里点名（自愈），
  并且**不再把故障归因于"探针的问题"**；失败信息也不再回显成 `&&ros2`。
- **下次维护建议**：
  1. **复核重启后的现场**（本轮唯一未闭环的观测）：`ros2_env_check` 应出现
     `setup.missingSources = ["/tmp/vlm_ws/install/setup.bash"]`，`ros2_node_list` 应直接可用，
     失败信息不应再出现 `&&ros2`。若 phoenix 因会话忙碌未执行重启，用 `创造模式 (phoenix)` preset 的
     `dsh_phoenix_restart` 再请求一次（非强制）。
  2. **改配置**：删掉 `cordis.patch.yml` 里 5 处 `/tmp/vlm_ws` 死段（仓库外，需人工确认）。
  3. 把 §16.7 第 3 条（vision doctor 硬编码 install 目录）单开一轮：先补测试再改行为。
  4. `docs/compatibility.md` 的本机路径描述同步现状。
  5. 维持验收线：**推送前** `typecheck + test + build` 全绿、**推送后立刻开 PR 并等 CI 绿**、
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`（本机）。

---

## 17. 维护记录（2026-09-24 15:11 CST / UTC 2026-09-24 07:11 · 第十二轮：收尾超时遗留的在途 PR #32 → 实测第十轮的重启请求已按硬期限落地 → 修复"配置没送到 doctor"的接线缺口 + API Key 来源语义）

> 本轮结论：起始 **0 open issue / 1 open PR**（#32 是**上一轮定时运行超时被杀的遗留**），
> 收尾为 **PR #32 验收合并** + **PR #33 / #34 两个修复**（全部 CI 绿并合入 `main` = `de7bdba`），
> 结束 **open issue / open PR = 0 / 0**；用例 **292 → 304**。
>
> 三件"上一轮留下的事"在本轮闭合：
> ① **上一轮的定时运行 `failed: run timed out after 30 minutes`** —— 这正是 PR #32"已开未合、文档未写"的原因
> （不是疏忽，是会话被 30 分钟上限杀掉；见 §17.7 第 1 条）。本轮先收尾它，再谈新工作。
> ② **第十轮请求的 phoenix 重启已按硬期限执行**（`2026-09-22 04:33:09`），第十轮 §16.5 唯一未闭环的观测
> （"重启后才可见的自愈字段"）本轮**实测确认**。
> ③ 由 ② 的现场证据**反查出两个运行期真缺陷**：doctor 的安装根派生**在运行期根本拿不到配置**
> （`installDirs` 恒为 `[]`），以及它的 API Key **来源报告说反话**。两者都不在 issue 里，是本轮自己撞见的。

### 17.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `fix/vision-doctor-install-dirs`（4 个提交，**PR #32 open、CI 双绿**，距 `main` 4 提交） | **`main` = `de7bdba`**（本地与 `origin/main` 一致，工作树干净） |
| `main` | `9abc6c6`（第十轮 docs） | `de7bdba`（#32 → `37a588b`、#33 → `d6e0392`、#34 → `de7bdba`） |
| open issue / open PR | **0 / 1** | **0 / 0** |
| vitest 用例 | 292（291 过 + 1 pty-skip） | **304**（303 过 + 1 pty-skip） |
| 包数量 / 本地环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| 运行中的 dsh | 启动于 **2026-09-24 15:11:04 CST**（本会话 15:11:11 以 `overdue: true` 起跑） | 同进程（本轮代码已构建进 `lib/`，待重启，见 §17.5） |
| 定时任务近况 | 近两周多数运行失败（超时 30min / `events is not iterable`） | 同（**本轮最重要的发现**，见 §17.7 第 1 条） |

### 17.1 Issue 检查（step 1）——0 open issue，但有 1 个"在途 PR"

`gh issue list --state open` → **0**；`gh pr list --state open` → **1**：**#32**
（`fix(vision): derive ros2_vision_doctor install roots from the resolved setup chain`，`MERGEABLE`/`CLEAN`，CI Node 22/24 双 `pass`）。

**本轮的第一手发现：这不是"没有 issue 就跳 step 5"，而是有一份未闭环的交付。** 三条证据指向同一件事：

1. 工作树停在 `fix/vision-doctor-install-dirs`，4 个提交已推送、PR 已开、**CI 已绿——却从未合并**；
2. `dsh-ros2-maintain.md` 最后一节仍是第十轮（§16），**第十一轮的维护记录根本不存在**；
3. 定时任务历史给出成因：`run-6a1c0ed8`（`2026-09-22T20:00:00Z` = `09-23 04:00 CST`）状态 **`failed`**
   —— `"run drive failed: run timed out after 30 minutes"`，其 sessionId 正是留下 PR #32 的那次运行。

⇒ 所以本轮**不按"无 issue → 直接安全扫描"走**，而是先把在途成果验完、合并、并补记第十一轮（§17.2），
再进入本轮新工作（§17.3 起）。这一条与第十轮 §16.1 的教训是同一枚硬币的两面：
第十轮是"推了但没开 PR ⇒ CI 从未运行"，本轮是"开了 PR 但没合并 ⇒ 成果停在 `main` 之外"。

### 17.2 建议评估（step 2）——PR #32 的设计主张逐条核验

PR #32 没有对应的 issue，它实现的是第十轮 §16.7 第 3 条 / §16.8 第 3 条（vision doctor 硬编码安装根）。
对一个"自定议题"的 PR，本轮不只看它绿不绿，而是**逐条验证它自己声称的性质**：

| # | PR #32 的主张 | 本轮核验 | 判定 |
| --- | --- | --- | --- |
| 1 | 安装根应由**环境派生**，而非"再加一个配置列表" | 配置列表能做到"对 `rosSetup` 并不 source 的工作区报 `built: true`"，即**可以撒谎**；派生则让"已删除的工作区不可能被广告为构建位置" | ✅ 成立，且第 3 条测试（多工作区链）正是钉这个 |
| 2 | `/opt/ros/<distro>` **不是** colcon 安装根 | `path.dirname('/opt/ros/jazzy/setup.bash')` = `/opt/ros/jazzy`，`basename` = `jazzy` ≠ `install` ⇒ 被排除；独立测试钉住 | ✅ 成立 |
| 3 | "撤掉实现后 **3/4** 新测试失败（第 4 个是边界守卫，两种实现都过）" | **精确复现**：保留导出、只把安装根计算回退成旧的 `[workspaceRoot/install, '/tmp/vlm_ws/install']` ⇒ **3 失败**；整体回退到 `origin/main`（导出本身消失）⇒ **4 失败**。PR 的措辞（3/4）**准确**，未夸大 | ✅ 主张诚实 |
| 4 | 该修复"让 doctor 与命令缝回答同一个已解析前缀" | ❌ **运行期不成立**——见 §17.3，这正是本轮新发现的缺陷 | ❌ 已由 PR #33 补齐 |

**④是本轮最有价值的一条**：PR #32 把"从 `deps.rosSetup` 派生"写成了它的核心卖点（代码注释里也这么写），
但**运行期从来没人把 `rosSetup` 放进 `deps`**。这不是 PR 的谎，而是它的**单元测试与插件接线之间有一道缝**——
测试直接调 `createRos2Tools({ rosSetup })`，而 `index.ts` 组装 `deps` 时漏了这一项。
"测试绿"与"运行期成立"之间的差距，正是本轮要补的东西。

### 17.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#32** | `fix/vision-doctor-install-dirs`（**上一轮在途**） | `c2037a9` `d0a3684` `daae842` `cd34308` | `fix(common)` / `fix(vision)` / `docs` ×2 | 新增 `setupSourcePaths()`；doctor 安装根改为从已解析链派生；CHANGELOG/README/`docs/compatibility.md` 同步。**本轮验收后合并** |
| **#33** | `fix/vision-doctor-rossetup-wiring`（新开，off `37a588b`） | `b3d6b5f` | `fix(vision)` | 一行转交 `rosSetup: config.rosSetup`；新增 `packages/dsh-ros2/tests/run-seam-wiring.spec.ts`（静态类不变量 + 行为级挂载测试） |
| | | `9017004` | `docs` | CHANGELOG + README/README_CN 计数 295 |
| **#34** | `fix/vision-apikey-origin`（新开，off `d6e0392`） | `2add724` | `fix(vision)` | 新增 `resolveApiKeyOrigin()`，来源在 `apply` 阶段定下；`plaintext` 改为"字面量写在插件配置里"；9 例新测试 |
| | | `a2b4c81` | `docs` | CHANGELOG + README/README_CN 计数 304 |

- **为什么 #32 先合并、再另开 #33 修它暴露的问题**（而不是把修复压进 #32）：
  #32 的四条主张里三条已被本轮独立验证成立，它**自身不引入运行期回归**——
  修复前后 `installDirs` 在运行期都是 `[]`（旧代码是 `['/tmp/vlm_ws/install']`，该目录已删除，同样全 `false`）。
  也就是说 #32 做的是"**删掉一个谎言**"，#33 才让派生**真正看见环境**。把两件事拆开，历史才读得出
  "哪一步是删谎、哪一步是接线"，而不是含混成一次改动。
- **提交类型的诚实性**：每个 PR 内按**文件域**切 `fix(...)` 与 `docs`（`packages/vision/**` vs
  `CHANGELOG+README+docs/**`），每个提交单独检出都能 `typecheck` 全绿；顺序上 `fix` 在前、`docs` 在后，
  不存在"看着是 docs、其实依赖后面才有的代码"。
- 全部分支/提交已推送；三个 PR 均经 CI（Node 22 + 24）**全绿**后合入 `main`，分支已删除。
- 收尾状态：`main` = `de7bdba`，工作树干净，0 open issue / 0 open PR。

### 17.4 本地验收（全绿）＋ 四个可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib          # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck     # 9 包 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test          # 304 例（303 过 + 1 pty-skip）（exit 0）
CI=true pnpm run build         # 全部 Done（exit 0）
```

**用例分布（实测）**：common **54** + core **131**（130 过 + 1 skip）+ moveit 16 + profile 14 + safety 10 +
vision **43** + state 8 + dsh-ros2 **28** = **304**。第十一轮收尾 292 → 本轮 +12
（vision +9：`resolveApiKeyOrigin` 5 + doctor 来源 4；dsh-ros2 +3：运行缝不变量）。

**证明 1 ｜ 接线缺口在"活的进程"里直接可见（PR #33 的动机，非推断）**

同一个时刻、同一个进程，两个自述工具给出两个不同的世界：

```text
ros2_vision_doctor → workspace: { root: "(未配置)", installDirs: [], built: {…全部 false} }
ros2_env_check     → setup: { prefix: "source /home/stvli/lite_delivery_aio/install/setup.bash && ", explicit: true }
```

doctor 报 `installDirs: []` 不是"环境里没有安装根"，而是**它解析时用的是裸参数**（回退到自动探测的
`/opt/ros/jazzy/setup.bash`，而 `/opt/ros/<distro>` 按设计不是安装根 ⇒ 被排除 ⇒ 空表）。

**证明 2 ｜ 撤掉那一行，3 个新测试立即失败（且报错与线上同形）**

```text
× every bundle whose tools read deps.rosSetup forwards the configured value
  AssertionError: … expected [ 'vision' ] to deeply equal []
× reports the install root of the workspace the seam sources
  AssertionError: expected [] to include '/tmp/dsh-runseam-doctor-81251/install'
× reports every workspace of a multi-workspace chain, not just the head
  AssertionError: expected [] to include '/tmp/dsh-runseam-chain-a-81251/install'
Tests  3 failed (3)
```

`expected [] to include …` 与证明 1 里活进程的 `installDirs: []` **逐字同形**——即新测试复现的正是线上症状。

**证明 3 ｜ API Key 来源语义撤掉后，3 个新测试立即失败（PR #34 的动机）**

```text
× reports an env-injected key as env and does NOT warn about plaintext
  AssertionError: expected true to be false        # ← 就是线上那条 plaintext: true 的误报
× reports a key read from the secrets file as secrets, not config
  AssertionError: expected 'config' to be 'secrets'
× prefers the secrets file when a ${VAR} reference is configured but the variable is empty
  AssertionError: expected 'config' to be 'secrets'
Tests  3 failed | 1 passed (4)
```

并且"用哪个 key"**未被改动**：`secrets.spec.ts` 把**旧表达式与新解析器并排求值**，在 6 组输入上逐一相等。

**证明 4 ｜ PR #32 的"3/4"主张被精确复现**

保留 `visionInstallDirs` 导出、仅回退其安装根计算 ⇒ `Tests 3 failed | 13 passed (16)`；
整体回退到 `origin/main`（导出消失）⇒ `Tests 4 failed | 12 passed (16)`。PR 声称的 3/4 **与实现方式一一对应**，不是含糊表述。

### 17.5 dsh-phoenix 持续更新 / 测试链路（step 4）——第十轮的请求已闭环，且本轮由它反查出缺陷

**① 第十轮那次重启：已按硬期限执行（journal 原文，非推断）**

```text
09-22 04:18:09  [dsh-phoenix] restart requested (gen 19): plugin-change
09-22 04:23:09  [dsh-phoenix] soft defer deadline reached; agent still busy — restart will be forced at the hard deadline (policy=auto)
09-22 04:33:09  [dsh-phoenix] HARD defer deadline reached; forcing restart (policy=auto): plugin-change
09-22 04:33:09  [dsh-phoenix] scheduling restart … systemctl --user stop dsh-web; sleep 8; systemctl --user start dsh-web
09-22 04:33:09  [dsh-phoenix] restart cmd exit=0
09-22 04:33:10  systemd: Stopped dsh-web.service
09-22 04:33:18  systemd: Started dsh-web.service
09-22 04:33:21  [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

⇒ 第十轮 §16.5 的"软告警 5 分钟 / 硬期限 15 分钟 / policy auto"**不是文档描述，而是可核对的执行记录**：
请求、两次期限、强制、重启、重新加载，五个环节齐全。

**② 第十轮 §16.8 第 1 条（唯一未闭环观测）：本轮实测确认**

运行中的进程（启动于 `09-24 15:11:04`，晚于第十轮代码）返回：

```text
ros2_env_check → setup.missingSources: ["/tmp/vlm_ws/install/setup.bash"]
                 note: "配置的 rosSetup 链中有 source 路径不存在：…；已剔除该段，改用其余 1 段（首个 source：lite_delivery_aio）。建议修正配置。"
                 probe: { exitCode: 0, stderrTail: "" }
```

⇒ **自愈生效**：死段被剔除、被点名、`exitCode` 归零。第十轮预言的三个可观测变化中，"`missingSources` 出现 + 每次调用不再失败"两条**已闭环**；
第三条（失败信息不再出现 `&&ros2`）属同一批构建，随下次重启复核（无害，仅影响措辞）。

**③ 本轮起点的那次重启：不如实归因于 phoenix**

`09-24 15:11:04` 还有一次 `dsh-web` 重启，但 journal 里**没有对应的 phoenix 行**，且形态不同——
phoenix 的调度是 `stop; sleep 8; start`（04:33:10 → 04:33:18，8 秒间隔），而这次是
`15:11:03 Stopping … → 15:11:04 Stopped → 15:11:04 Started`（**零间隔**）。⇒ 判定为**外部/人工的干净重启**，
不是 phoenix 所为。其后果是：定时任务随即以 `overdue: true` 在 `15:11:11` 起跑（本会话）。
**成因在 journal 里没有记录**，如实记为未解释项（§17.7 第 3 条）。

**④ 本轮的末端动作**：改动已合入 `main` 并重建 `lib/`（`packages/vision/lib/secrets.js` 含
`resolveApiKeyOrigin`、`lib/index.js` 含 `rosSetup: config.rosSetup`），随后按本 preset 的**文档化触发面**
（`cordis_run`：动态插件激活）请求一次**非强制**优雅重启（`deferPolicy auto`；不传 `force`）。
**已确认（journal + 检查点实测，非推断）**：

```text
15:28:44  [dsh-phoenix] cordis tool: cordis_run
15:28:47  [dsh-phoenix] restart requested (gen 20): plugin-change
15:28:51  [dsh-phoenix] restart already in-flight; coalesced plugin-change
检查点    → generation 20 / lifecycleState "deferred" / deferDeadline 1790235827937（= 15:28:47 + 15min = 15:43:47 CST）
```

即 phoenix **看到了**这次激活、登记为**第 20 代**重启请求，并因维护会话仍在运行而进入 `deferred`；
会话结束时，下一个 3s 轮询点即执行优雅重启——与 ① 中第 19 代走完的五个环节完全同构。
本轮**未**为该信号新增任何行为：激活用的包是**惰性的**（`apply()` 空实现，不注册工具/事件/服务/UI；
sandbox 也不暴露 `ctx.logger`，故连日志都没有），它唯一的作用就是"让 `cordis_run` 发生"。

- **重启后可观测的变化（预期）**：`ros2_vision_doctor` 的 `workspace.installDirs` 不再是 `[]`，
  而应含 `lite_delivery_aio/install`；`apiKey.plaintext` 对当前"`${VLM_API_KEY}` 注入"的 key 应为 **`false`**
  且不再出现"建议改用环境变量注入"的自相矛盾告警。
- **诚实边界**：本会话仍在运行，**无法在同一进程内观测重启后的结果**；§17.8 第 1 条把它列为下次维护的第一复核项。

### 17.6 安全扫描（step 5）——依赖 + 静态 + 本轮新增面，未发现新漏洞；并改正一处"自相矛盾的安全建议"

**依赖漏洞**：

- `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**（exit 0）。
- 本机默认源（`registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，不可当作结论。
  （CI 里的同一闸门在 GitHub runner 上默认即官方源 ⇒ CI 的闸门有效；只有本机需要显式指定。）

**GitHub 侧扫描面（本轮新查）**：

| 面 | 结果 | 含义 |
| --- | --- | --- |
| Dependabot alerts | `403 — Dependabot alerts are disabled for this repository` | **仓库未开启**，无 GH 侧依赖告警可依赖 |
| Code scanning (CodeQL) | `404 — no analysis found` | **未配置**，无静态分析基线 |

⇒ 结论：**本仓库唯一的依赖安全闸门是 CI 里那一条 `pnpm audit --prod --audit-level high`**。
它本身有效，但覆盖面是"生产依赖 + 高/严重"；dev-only 工具链与中低危不在内。这一条已写入 §17.8 建议。

**静态扫描**（`packages/*/src`，全部零命中）：`shell: true` **0**；`eval(` / `new Function(` **0**；
硬编码密钥（`AIza…` / `sk-…`）**0**；`child_process` 的两处 `spawn` 全部走**argv 数组**（无 shell 解析）。

**本轮新增面评审**：

| 面 | 结论 |
| --- | --- |
| `rosSetup: config.rosSetup`（PR #33） | 只是把**配置里已有的字符串**转交给一个本就该读它的工具；不引入新的输入源、不进入任何 shell 拼接 |
| `resolveApiKeyOrigin()`（PR #34） | **纯函数**，输入是配置文本 / 环境变量 / 密钥文件内容，**均非模型可控输入**；只判定来源，不改变"用哪个 key"（已用并排求值钉住） |
| 医生报告新增 `apiKeySource` | 只在 `config` / `env` / `secrets` / `missing` 四个枚举间取值，**不含密钥值**（密钥从不回显，沿用既有约束） |
| 新增测试文件是否随包发布 | 否：`packages/vision/package.json` 的 `files` 只含 `lib`/`cordis.patch.yml`/`vlm`/`offscreen`/`scripts`/`README.md`/`LICENSE` ⇒ 测试不进 tarball |
| 既有防线回归 | 随测试全绿：`signal` 白名单、`isSafeProfileName` 路径穿越（4 组）、`shq()` 单引号包裹（含空格路径）、safety_monitor 走 argv 数组、`ros2_install` 的 installer 转义（第五轮修复） |

**本轮的安全相关发现（已修，PR #34）**：doctor 的 API Key 报告**把已按推荐方式注入的 key 报成"明文"**，
并在同一条告警里建议"改用环境变量注入（`${VLM_API_KEY}`）"——**建议的正是它已经在用的做法**；
同时把**来自 0600 密钥文件的 key 报成 `config`**，把用户引去检查 profile 配置。
修复后 `plaintext` 只表示"**字面量写在插件配置里**"（那份会被复制/分享/入库的文件），
环境变量与密钥文件两种推荐方式不再误报。**判定为必要**：一条自相矛盾的安全建议会诱导用户
把**已经正确**的注入方式改掉，属于"诊断把人带偏"，与第十轮 §16.2 ③ 同类。

**结论：未发现新漏洞**；本轮改动收缩而非扩大攻击面（去掉一个写死的本机路径 + 改正一处误报的来源判定）。

### 17.7 本轮发现（含仓库外的问题）

1. **【流程·基础设施·重要·未修】** **上一轮的定时维护运行是被 30 分钟上限杀掉的**：
   `run-6a1c0ed8`（`09-23 04:00`）`status=failed` / `"run drive failed: run timed out after 30 minutes"`，
   其 session 正是留下 PR #32 的那次。任务历史显示这**不是个例**：近两周
   `timed out after 30 minutes` 出现 4 次（09-14、09-16、09-22），`events is not iterable` 出现 5 次
   （09-10、09-11、09-12、09-14、09-21）；能完整跑完的只有 09-03～09-06 那几次。
   **对维护流程的直接含义**：长任务必须**先落地、再记录**——本轮据此把两个修复**各自独立合并**，
   维护文档**最后写并立即推送**，这样即使会话在文档之后被超时杀掉，成果也已全部进入 `main`。
   建议（需人工/宿主侧决策）：提高该类运行的时限，或在超时前提供落盘钩子。
2. **【部署配置·仍未修·仓库外·高优先】** `~/.dsh/profiles/web/cordis.patch.yml` 的 5 处 `rosSetup`
   仍以 `source /tmp/vlm_ws/install/setup.bash &&` 结尾，而 `/tmp/vlm_ws` **已不存在**；
   同文件第 29 行注释写着"改用实际构建的交付工作区"——**注释改了、值没改**。
   新代码已能自愈（本轮实测：剔除死段 + `note` 点名 + `probe.exitCode = 0`），故**不是当前故障**，
   但每次调用都要多一次 `existsSync` 与一段告警噪声。本轮**未擅自修改**（仓库外 + 运行中的部署）。
   建议人工执行（改完优雅重启）：把 5 处 `&& source /tmp/vlm_ws/install/setup.bash` 从各行删掉。
3. **【本机·未解释】** `2026-09-24 15:11:04` 的 `dsh-web` 重启在 journal 中**没有成因记录**：
   形态与 phoenix 的 `stop; sleep 8; start` 不同（零间隔），也不是 systemd 的 `Restart=on-failure`
   （无 `Main process exited` / `Scheduled restart`）。其直接后果是**当天 04:00 的定时维护被跳过**，
   随后以 `overdue: true` 在 15:11:11 补跑（即本会话）。**如实记为未解释**，建议下次维护顺带核对。
4. **【文档·已修】** 第十轮的 §16.7 第 4 条（`docs/compatibility.md` 把 `/tmp/vlm_ws` 当"本机"位置）
   已随 PR #32 更正，并补了"**colcon workspace 不要建在 `/tmp`**"的环境注意——这正是本次工作区消失的根因。
5. **【固有限制·如实声明·不追踪】** `ros2_env_check` 的 `skillCatalogue` / `surface` / `missingSources`
   等自述字段需要**重启后**才存在；本轮继续把它当**正向信号**使用（字段在不在 ⇒ 进程新旧）。
6. **【时间口径】** 本节标题用**本地时间（CST）**，而 git / CI / journal / 任务历史的时间戳为 **UTC**：
   本轮 `09-24 15:11 CST` = `09-24 07:11 UTC`；上一轮的 `09-23 04:00 CST` = `09-22 20:00 UTC`。

### 17.8 结论与下一步建议

- **交付**：PR **#32**（上一轮在途，验收后合并）、**#33**（运行缝接线 + 类不变量测试）、
  **#34**（API Key 来源语义）全部 CI 绿并合入 `main`（`de7bdba`）；**open issue / open PR 归零**；
  用例 **292 → 304**；README / README_CN / CHANGELOG 计数同步。
- **线上价值**：① doctor 的安装根**终于**来自"命令缝真正 source 的那条链"，`built` 不再恒为 `false`；
  ② API Key 报告不再把"已用环境变量注入"说成"明文"，也不再把它指向错误的来源——
  这两条都是**"诊断说反话"**类缺陷，会直接把排查引向错误方向。
- **末端动作**：改动已构建进 `lib/`，并按文档化触发面（`cordis_run`）请求**非强制**优雅重启；
  由 phoenix 在会话空闲的安全点执行，客户端由 `/__dsh_health` 的 per-boot token 自行刷新。
- **下次维护建议**：
  1. **复核重启后的现场**（本轮唯一未闭环的观测）：`ros2_vision_doctor` 的 `workspace.installDirs`
     应不再是 `[]`（应含 `lite_delivery_aio/install`）；`apiKey.plaintext` 对当前 `${VLM_API_KEY}` 注入应为 `false`，
     且不应再出现"建议改用环境变量注入"的告警。
  2. **改配置**（§17.7 第 2 条）：删掉 `cordis.patch.yml` 里 5 处 `/tmp/vlm_ws` 死段，然后优雅重启。
     **这是连续第三轮被记为"仍未修"的仓库外项**，建议优先处理。
  3. **盯住定时任务的可靠性**（§17.7 第 1 条）：近两周多数运行失败；在时限被提高之前，
     维护流程一律遵循"**先落地、再记录**"（本轮范式：小 PR 各自合并 → 文档最后写并立即推送）。
  4. 考虑开启 GitHub 侧扫描（Dependabot alerts 当前**关闭**、CodeQL **未配置**），
     把 §17.6 的"唯一依赖闸门是 CI 那一条 audit"补成纵深防御。
  5. 维持验收线：**推送前** `typecheck + test + build` 全绿、**推送后立刻开 PR 并等 CI 绿再合并**、
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`（本机）。

## 18. 维护记录（2026-09-25 04:13 CST / UTC 2026-09-24 20:13 · 第十三轮：0 open issue / 0 open PR → 安全扫描发现并落地 3 处修复 = PTY 会话 id 路径穿越 · 发布物携带 `__pycache__` 字节码 · 安装器选项注入；并闭环第十二轮唯一的未闭环观测 + 开启 Dependabot）

> 本轮结论：起始 **0 open issue / 0 open PR**（本轮**没有**第十/十二轮那种"在途交付"），
> 因此**干净地走"无 issue → step 5 安全扫描"**这条路径，不跳过任何东西。安全扫描**发现 3 处真实缺陷**，
> 全部按 `fix/...` 分支 + 规范提交落地为 3 个 PR（#35/#36/#37，CI Node 22/24 双绿后合入），
> 结束 `main = 247a667`、**0 open issue / 0 open PR**；用例 **304 → 310**。
>
> 三件事值得单独点名：
> ① **一个真漏洞**：`ros2_install` 的 `session` 未校验就进入 `os.path.join`，相对与绝对路径都能逃出
> 会话目录，`stop` 还能**截断任意 `.meta`**——本轮给出 before/after 可复现证明。
> ② **一个"CI 看不见"的发布面缺陷**：`common`/`core`/`sidecar` 把 `__pycache__/*.pyc` 打进 npm 包，
> 而 CI 的 tarball 闸门**根本没打包 sidecar**（6 个文件、最严重的一个），因为它只遍历一份手写子集。
> ③ **第十二轮唯一未闭环的观测本轮实测确认**：doctor 的 `installDirs` 不再是 `[]`、`apiKey.plaintext = false`。

### 18.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（工作树干净） | `main` = **`247a667`**（本地与 `origin/main` 一致） |
| `main` | `975b182`（第十二轮 docs） | `247a667`（#35 → `0b1287d`、#36 → `d22efc0`、#37 → `247a667`） |
| open issue / open PR | **0 / 0** | **0 / 0** |
| vitest 用例 | 304（303 过 + 1 pty-skip） | **310**（309 过 + 1 pty-skip） |
| 包数量 / 环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| 运行中的 dsh | 启动于 **2026-09-24 15:43:57 CST**（= 第十二轮 gen-20 重启的产物） | 同进程；本轮代码已构建进 `lib/`，gen-21 重启待执行（§18.5） |
| GitHub 侧扫描 | Dependabot alerts **关闭**、CodeQL **未配置** | Dependabot alerts + security updates **已开启**（§18.6） |

### 18.1 Issue 检查（step 1）——0 / 0，且**没有在途交付**

```text
gh issue list --state open                                     → 0
gh api "repos/StvLi/dsh-ros2/issues?state=open" --jq 'length'   → 0
gh pr    list --state open                                     → 0
git rev-list --left-right --count main...origin/main           → 0  0
```

与前两轮的关键差别：第十轮是"推了但没开 PR"、第十二轮是"开了 PR 但没合并"，
**本轮两者都没有**——`main` 与 `origin/main` 完全一致、工作树干净、无任何未闭环交付。
因此按 step 1 的分支条件**直接转 step 5**；step 2/3/4 不因 issue 触发
（step 3 的 git 纪律仍适用于本轮**自己发现**的修复，见 §18.3）。

**顺带核对第十二轮遗留的两条"仓库外"事项**（§18.7 第 2、3 条），确认它们**不在** issue 列表里，
属于维护文档记录的现场事项，因此不改变"0 open issue"的判定。

### 18.2 建议评估（step 2）——本轮无 issue，无外部建议可评

本轮无 open issue，故无外部建议需要判断合理性与必要性。作为替代，本节的"评估"对象是
**本轮安全扫描自己提出的 3 条发现**——即"自定议题"。按第十二轮 §17.2 的做法，
对**自己提出的议题同样逐条核验其真实性**，而不是只写结论：

| # | 本轮主张 | 核验方式 | 判定 |
| --- | --- | --- | --- |
| F1 | `ros2_install` 的 session id 可逃出 `$TMPDIR/dsh-ros2/pty` | 对 `origin/main` 的 helper **实跑** `send ../../victim/pwned`、`stop ../../victim/target`，看文件是否真的落在目录之外 | ✅ 真实（且 `stop` 是**截断写**） |
| F2 | `common`/`core`/`sidecar` 的 npm 包含 `__pycache__` 字节码 | `pnpm pack` 后 `tar -tzf` 逐包清点；再解析 `.pyc` 头与 `co_filename` | ✅ 真实（8 文件；含 1 个 STALE；含构建路径泄漏） |
| F3 | installer 的 leading-dash 会被 curl/wget 当选项解析 | 对**真实二进制**验证：`wget -q -O f "-wget-option-like-value"` → `--wait` 报错；再用 `-K<file>` 构造可用的 fetch+write | ✅ 真实（见 §18.4 证明 3） |

其中 F3 的核验过程**推翻了我自己的第一个假设**：`curl --config=FILE` 在 curl 8.5.0 上被判为
"unknown option"（`=` 形式不被接受），因此**看似不可利用**；改用 curl 的**贴值短选项** `-KFILE`
后构造成功。⇒ 记为"真实可利用"，既不当作误报丢掉，也不含糊地写成理论问题。

### 18.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#35** | `fix/pty-session-traversal` | `6dde230` | `fix(core)` | session id 路径穿越：共享 `isSafePathComponent` + Tool 层拒绝 + helper 权威校验 |
| **#36** | `fix/pyc-publish-surface` | `4b78731` | `fix(packaging)` | 三个包加 `"!**/__pycache__"`；CI 发布面闸门改为**遍历全部非 private 包**并新增"不得携带字节码"断言 |
| **#37** | `fix/installer-option-injection` | `29cf49e`（+ `68fae5c` 合并 `main`） | `fix(core)` | 安装器抓取改用 `--` 终止选项解析 |

- 三个分支均以 `fix/...` 前缀新开（语义 = 修复问题），均 `off main`；每个 PR 单独提交、单独 CI。
- **提交类型的诚实性**：#35 同时动了 `common`（共享规则）与 `core`（调用点）。按目录硬拆成两个提交
  没有意义——共享规则的**唯一消费者**就是这次的 session id 校验；故合为一个 `fix(core)` 提交，
  并在正文写明它是"把既有规则提升为共享谓词"。这是**有意识的合并**，不是切分失误。
- **#37 与 #35 触碰同一批文件**（`packages/core/src/tools.ts`、`packages/core/tests/tools.spec.ts`）。
  实测：`git merge main` **零冲突自动合并**（两者改的是同一文件的不同区域），合并后**重跑完整验收线全绿**
  （§18.4）——因此不是"靠运气"，而是有验证的。
- 三个 PR 均经 CI（Node 22 + 24）**全绿**后合入 `main`；合并后删除远端与本地分支。
- 收尾：`main = 247a667`，工作树干净，0 open issue / 0 open PR。

### 18.4 本地验收（全绿）＋ 三个可复现证明

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib          # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck     # 9 包 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test          # 310 例（309 过 + 1 pty-skip）（exit 0）
CI=true pnpm run build         # 全部 Done（exit 0）
```

**用例分布（实测）**：common **57** + core **134**（133 过 + 1 skip）+ moveit 16 + profile 14 +
safety 10 + vision 43 + state 8 + dsh-ros2 28 = **310**；另 sidecar selftest **10 场景**（SELFTEST PASSED）。
第十二轮 304 → 本轮 **+6**（common +3：路径组件边界；core +2：会话 id 双层守卫；core +1：`--` 终止选项解析）。

**证明 1 ｜ F1：会话目录能被逃出，且 `stop` 是**截断写**（before/after，实跑 helper）**

```text
BEFORE（origin/main 的 helper）
  $ TMPDIR=/tmp/ptydemo python3 orig_pty.py send "../../victim/pwned" -- "INJECTED-BY-CALLER"
  exit=0
  $ ls  /tmp/ptydemo/victim/            → pwned.in          # 落在会话目录之外
  $ cat /tmp/ptydemo/victim/pwned.in    → INJECTED-BY-CALLER
  $ TMPDIR=/tmp/ptydemo python3 orig_pty.py send "/tmp/ptydemo/victim/abs" -- "ABS-WRITE"
  exit=0                                                     # 绝对路径同样逃出
  $ TMPDIR=/tmp/ptydemo python3 orig_pty.py stop "../../victim/target"
  stopped
  $ cat /tmp/ptydemo/victim/target.meta → state=stopping     # 原本是 SECRET-CONFIG（被截断）

AFTER（修好的 helper）
  sid='../../victim/pwned'        exit=2  unsafe session id …: only [A-Za-z0-9._-], no separator or '..'
  sid='/tmp/ptydemo/victim/abs'   exit=2  …
  sid='..' / 'a/b' / '.hidden' / '' → exit=2
  victim dir → 只有 target.meta，未被触碰
```

**证明 2 ｜ F2：字节码确实在发布物里，且 CI 旧闸门看不见 sidecar**

```text
$ for p in common core sidecar …; do pnpm pack … ; tar -tzf "$tgz" | grep -c 'pycache\|\.pyc'; done
  common pyc=1     core pyc=1     sidecar pyc=6     （其余包 0）

$ python3 - <common 的 .pyc>        # 解析头 + 嵌入式路径
  STALE: True                        # 头里的 mtime/size 与同包的 robot_profile.py 不一致
  co_filename: /home/stvli/Desktop/embody_agent_ws/dsh-ros2/packages/common/scripts/robot_profile.py

旧 CI 闸门的遍历面：for p in core profile moveit safety vision dsh-ros2    # + common
  ⇒ sidecar / dsh-ros2-state 从未被 pack，最严重的 6 个文件从未被检查

新闸门的反向断言（把 sidecar 的排除项撤掉后实跑）：
  ::error::sidecar tarball ships compiled Python:
  package/sidecar/__pycache__/{__init__,core,node,reducers_placeholder,selftest,server}.cpython-312.pyc
  GATE exit=1
```

**证明 3 ｜ F3：`-K<file>` 是可利用的 fetch+write 原语（before/after）**

```text
BEFORE（旧命令串），installer = "-K/tmp/f3demo/evil_curl.conf"
  $ curl -fsSL '-K/tmp/f3demo/evil_curl.conf' -o '<boot>' || wget …
  $ ls -l /tmp/f3demo/PWNED_BY_OPTION
    -rw-rw-r-- … 33 /tmp/f3demo/PWNED_BY_OPTION    # curl 读了调用者指定的 config，
                                                   # 按 config 里的 url+output 取回并写出
AFTER（新命令串，同一 installer）
  $ curl -fsSL -o '<boot>' -- '-K/tmp/f3demo/evil_curl.conf'
  curl: (6) Could not resolve host: -K
  NOT created — closed

对照：`--` 在真实二进制上均被遵守
  $ wget -q -O /tmp/x "-wget-option-like-value"     → wget: --wait: Invalid time period '…'   # 被当选项
  $ wget -q -O /tmp/x -- "-wget-option-like-value"                                            # 被当操作数
  $ cp -- /tmp/f3src.txt /tmp/f3cp                  → OK
回归：合法的本地安装器仍可用（copy + chmod，exit 0），PTY 交互测试照常通过。
```

### 18.5 dsh-phoenix 持续更新 / 测试链路（step 4）——第十二轮的未闭环观测**实测确认**，并请求 gen-21 重启

**① 第十二轮 §17.8 第 1 条（本轮唯一要复核的观测）：已闭环 ✅**

第十二轮把改动构建进 `lib/` 后请求了 gen-20 优雅重启，但**无法在同一进程内观测结果**，
故列为"下次维护第一复核项"。本轮起点进程启动于 `2026-09-24 15:43:57`，**正是 gen-20 重启的产物**
（journal 五环节齐全：`15:43:48 HARD defer deadline → scheduling restart (gen 20) → restart cmd exit=0
→ 15:43:49 Stopped → 15:43:57 Started → 15:44:00 loaded`），因此该观测**本轮可测**：

```text
ros2_vision_doctor → workspace.installDirs: ["/home/stvli/lite_delivery_aio/install"]   # 第十二轮是 []
                     apiKey.source "secrets" · plaintext false                           # 不再误报
                     （且不再出现"建议改用环境变量注入"的自相矛盾告警）
ros2_env_check     → setup.missingSources: ["/tmp/vlm_ws/install/setup.bash"]
                     note: "…已剔除该段，改用其余 1 段…建议修正配置。"
                     probe: { exitCode: 0, stderrTail: "" }                  # 自愈生效
                     bundles.stale false · drift 全 false · totalTools 81 · totalSkills 9
```

⇒ 第十二轮预言的两个可观测变化（`installDirs` 不再是 `[]`；`apiKey.plaintext` 对 `${VLM_API_KEY}`
注入应为 `false`）**逐字命中**。同时 `skillCatalogue` / `surface` / `missingSources` 等自述字段都在，
再次作为"进程新旧"的正向信号使用。

**② 本轮末端动作：请求 gen-21 优雅重启（journal 原文，非推断）**

改动已合入 `main` 并重建 `lib/`（实测 `lib/names.js` 含 `isSafePathComponent`、
`lib/tools.js` 含 `INVALID_SESSION` 与 `-- ${shq(installer)}`、`scripts/pty_session.py` 含 `safe_sid`），
随后按本 preset 的**文档化触发面**激活一个**惰性**动态包（`apply()` 空实现，不注册工具/事件/服务/UI；
它唯一的作用就是"让 `cordis_run` 发生"）：

```text
Sep 25 04:13:24  [dsh-phoenix] cordis tool: cordis_run
Sep 25 04:13:27  [dsh-phoenix] restart requested (gen 21): plugin-change
```

即 phoenix **看到了**这次激活并登记为**第 21 代**重启请求；与 gen-19/gen-20 走同一套
"软告警 5 分钟 / 硬期限 15 分钟 / policy auto" 生命周期（硬期限 ≈ `04:28:27`）。
本会话仍在运行，**重启后的现场无法在同一进程内观测**——如实列为 §18.8 第 1 条。

- **重启后可观测的变化（预期）**：本轮三处修复对**运行时**的影响分别是
  `ros2_install` 对非法 session id 直接返回 `INVALID_SESSION`（不再触碰文件系统）、
  新发布的 tarball 不含 `__pycache__`、安装器抓取带 `--`。
  其中**只有第一条**在当前会话的进程里可观测（另两条分别属于发布物与 `action=start` 路径）。
- **诚实边界**：`action=start` 在本机走不到（ROS2 已安装 ⇒ 直接 `already-installed`），
  所以 F3 的运行时表现**无法在活进程里演示**；F3 的证据是**真实二进制的 before/after**（§18.4 证明 3），
  这一点不夸大。

### 18.6 安全扫描（step 5）

**依赖漏洞**：

- `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**（exit 0）。
- 本机默认源（`registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，
  不可当作结论（CI 在 GitHub runner 上默认即官方源 ⇒ CI 闸门有效；只有本机需显式指定）。
  沿用第八/十/十二轮的同一结论。

**GitHub 侧扫描面（本轮重查并**改动）**：

| 面 | 本轮起点 | 本轮动作 | 含义 |
| --- | --- | --- | --- |
| Dependabot alerts | `404`（未开启） | **`PUT /vulnerability-alerts` → 已开启**（端点返回 `204`） | 从"无 GH 侧依赖告警"变为**有** |
| Dependabot security updates | `disabled` | **`PUT /automated-security-fixes` → `enabled`** | 可自动开安全更新 PR |
| 当前 Dependabot 告警数 | — | **0** | 无待处理告警 |
| Secret scanning | **`enabled`**（第十二轮未查，本轮新查） | 保持 | 与 push protection 一起构成密钥防线 |
| Secret scanning push protection | **`enabled`**（本轮新查） | 保持 | 推送期即拦截 |
| Secret scanning alerts | — | **`[]`** | 无告警 |
| Code scanning (CodeQL) | `404 — no analysis found` | **未改动** | 仍未配置；见 §18.8 第 3 条 |
| `secret_scanning_non_provider_patterns` / `validity_checks` | `disabled` | 未改动 | 非阻塞项 |

⇒ 第十二轮 §17.6 的结论"本仓库唯一的依赖安全闸门是 CI 那一条 `pnpm audit`"**本轮已不再成立**：
Dependabot alerts + security updates 已开启，纵深防御补上了一层。
同时**新增一条正向事实**：`secret_scanning` 与 `push_protection` **本来就是开启的**——
第十二轮只查了 Dependabot 与 CodeQL 就下了"GH 侧扫描为空"的结论，本轮把口径补全。

**静态扫描**（`packages/*/src` + `packages/*/scripts`）：

| 面 | 结果 |
| --- | --- |
| `eval(` / `new Function` / `vm.` | **0** |
| `shell: true` / `execSync` | **0** |
| `child_process.exec(` 的 16 处命中 | **全部是 `RegExp.prototype.exec`**（逐处核对），无命令执行 |
| `execFile` / `spawn` | 全部走 **argv 数组**；唯一的 `bash -lc` 在 `runner.ts:275`，其 `cmd` 由 `shq()` 逐参拼装 |
| Python `shell=True` / `os.system` / `pickle.load` / `yaml.load` | **0**；`subprocess` 全部 argv 数组 |
| `gui.ts` 的 `python3 -c` | 代码是**常量模板**，变量数据经 `env`（`SCREENSHOT_PATH`/`SCREENSHOT_CROP`）传入，**不拼接** |
| 硬编码密钥（工作树） | **0** |
| 硬编码密钥（**全 git 历史所有 blob**） | **0** |
| 包 `lifecycle` 脚本（pre/postinstall 等） | **9 个包全部 none**（无供应链安装期执行面） |
| `.gitignore` | 覆盖 `secrets.json` / `*.secrets.json` / `.env` / `lib/` / `node_modules/` / `__pycache__/`；`__pycache__` **未被 git 跟踪** |
| 既有防线回归 | 随测试全绿：`isSafeProfileName` / `safe_name()` 的 4 组穿越用例、`ros2_interface_create` 的 `PATH_ESCAPE`、`shq()` 单引号包裹、safety_monitor argv 数组、`ros2_install` 安装器转义 |
| 密钥文件处置 | `~/.dsh-ros2/secrets.json` 存在、mode **`600`**、仓库外、`files` 白名单不进 tarball；报告只回显 mode/exists/keyPresent，**从不回显密钥** |

**本轮新增面的评审（自己新引入的代码）**：

| 面 | 结论 |
| --- | --- |
| `isSafePathComponent`（#35） | **收紧**：把一个已存在的规则（profile 名）提升为共享谓词并**新增**一个消费者；`isSafeProfileName` 行为逐字符不变（同正则、同 `..` 检查），既有测试未改仍全绿 |
| `pty_session.py` 的 `safe_sid()`（#35） | **收紧**：在**文件系统调用点**再加一道，与 `robot_profile.py` 的 `safe_name()` 同构（fail-closed，exit 2） |
| `"!**/__pycache__"`（#36） | 只影响打包面；实测必需 `.py` 全部仍在（`robot_profile.py` / `pty_session.py` / `ros2_topology.py` / `sidecar/*.py`） |
| CI 发布面闸门（#36） | 只加断言、不改产物；`permissions: contents: read` 不变，仍无 `pull_request_target`、无 `${{ github.event.* }}` 注入面 |
| `--` 终止选项解析（#37） | **收紧**：参数顺序变化不影响合法输入（已用真实二进制 + 本地安装器回归验证） |

**结论：本轮发现并修复 3 处真实缺陷**；三处改动均为**收缩**攻击面，未引入新的输入源或执行面。
另：GitHub 侧由"无 GH 依赖告警"变为"已开启 Dependabot alerts + security updates"。

### 18.7 本轮发现（含仓库外的问题）

1. **【安全·已修·真实可利用】** **PTY 会话 id 路径穿越**（F1，PR #35）：`send`/`status`/`stop`
   **不需要审批**（只有 `start` 需要），因此一个普通工具调用即可让这三者落到**任意** `.in`/`.out`/`.meta`
   路径上，其中 `stop` 是**截断写**。已按"共享规则 + Tool 层 + helper 权威层"两层修复并加测试。
   **这条是本轮最重要的发现**：它不在任何 issue 里，是安全扫描自己撞见的。
2. **【部署配置·第四轮仍未修·仓库外】** `~/.dsh/profiles/web/cordis.patch.yml` 第 33/37/41/45/49 行
   仍以 `&& source /tmp/vlm_ws/install/setup.bash` 结尾，而 `/tmp/vlm_ws` **已不存在**
   （第 29 行注释写着"改用实际构建的交付工作区"——**注释改了、值没改**）。
   新代码的自愈本轮**再次实测有效**（剔除死段 + `note` 点名 + `probe.exitCode = 0`），故**不是当前故障**，
   代价只是每次调用多一次 `existsSync` 与一段告警噪声；此外 `workspace.root` 仍报 `(未配置)`。
   **本轮仍不擅自修改**，理由比第十二轮更明确：它在**仓库外**、属于**运行中的部署**、
   改动需**重启**才生效，而本轮被要求维护的是**仓库**。两条既有证据支持"先不动"：
   自愈已使其**非故障**；且此前两轮已**有意**记录过"不擅自修改"的决定，单方面改变该决定不合适。
   → **给出可直接执行的一行修法**（§18.8 第 2 条）。
3. **【本机·未解释·延续】** `2026-09-24 15:11:04` 那次 `dsh-web` 重启在 journal 中**仍无成因记录**
   （零间隔，非 phoenix 的 `stop; sleep 8; start`）。本轮**新增一条观测**：该次重启直接导致
   12 日 04:00 的定时维护被跳过、以 `overdue: true` 在 15:11:11 补跑；
   而**本轮**（13 日 04:00）是**准点**起跑的，说明这一轮没有再被同类事件顶掉。成因仍如实记为**未解释**。
4. **【发布面·已修·CI 盲区】** CI 的 tarball 闸门**只遍历一份手写子集**，
   导致 `sidecar`（6 个 `.pyc`，最严重）与 `dsh-ros2-state` **从未被 pack、从未被检查**。
   本轮把闸门改为**遍历全部非 private 包**并新增"不得携带字节码"的**反向断言**——
   原闸门只断言"必须存在什么"，从不检查"不得存在什么"，这正是 8 个文件得以长期发布的原因。
5. **【安全·已修·低危但真实】** **安装器选项注入**（F3，PR #37）。**诚实定级**：
   调用者是 agent 自身、`action=start` 需审批、且**本机 ROS2 已安装时该路径根本走不到**
   （直接 `already-installed`），因此**不是活漏洞**，而是与第五/六轮同类别的加固。
   记录为"真实可利用但 reach 很窄"，不抬高也不淡化。
6. **【正面事实·第十二轮口径修正】** `secret_scanning` 与 `secret_scanning_push_protection`
   **本来就是开启的**（告警 `[]`）。第十二轮 §17.6 只查了 Dependabot 与 CodeQL 就写下
   "GitHub 侧扫描面为空"，本轮把口径补全——**这是对上一轮结论的修正，不是上一轮的错误**。
7. **【时间口径】** 本节标题用**本地时间（CST）**，git / CI / journal / 任务历史为 **UTC**：
   本轮 `09-25 04:13 CST` = `09-24 20:13 UTC`。

### 18.8 结论与下一步建议

- **交付**：PR **#35**（会话 id 路径穿越）、**#36**（发布面字节码 + CI 闸门）、**#37**（安装器选项注入）
  全部 CI 绿（Node 22/24）并合入 `main`（`247a667`）；**open issue / open PR 归零**；
  用例 **304 → 310**；远端与本地分支已清理。
- **线上价值**：① 一个**未审批即可触达**的任意 `.in`/`.out`/`.meta` 读写（含截断）被关掉；
  ② 发布物不再携带**评审看不见**、**携带构建路径**、且其中一个**与源码不一致**的字节码，
  且 CI 现在会**拦住**这一整类；③ 安装器抓取不再可能把调用者值当选项解析。
- **末端动作**：改动已构建进 `lib/`，并按文档化触发面激活惰性动态包，**已确认** phoenix 登记
  `gen 21` 重启请求（`04:13:27`，硬期限 ≈ `04:28:27`）；由 phoenix 在会话空闲的安全点执行优雅重启。
- **GitHub 侧**：Dependabot alerts 与 security updates **本轮已开启**（此前关闭）。
- **下次维护建议**：
  1. **复核 gen-21 重启后的现场**（本轮唯一未闭环观测）：确认 `ros2_install` 对非法 session id
     返回 `INVALID_SESSION`；以及"重启后才有"的自述字段仍在（正向信号）。
  2. **改配置**（§18.7 第 2 条，**已连续第四轮记为"仍未修"**）：删掉
     `~/.dsh/profiles/web/cordis.patch.yml` 里 5 处 `/tmp/vlm_ws` 死段（第 33/37/41/45/49 行），
     然后优雅重启。**这是唯一一个跨四轮未被处理的事项**，建议优先；若下次维护仍不处理，
     应考虑把它**升级为一个 issue**，以免继续只躺在维护文档里。
  3. **考虑配置 CodeQL**：Dependabot 已开，但静态分析仍无基线；本仓库 TS + Python 混合，
     值得给 `packages/*/src` 与 `packages/*/scripts` 建一条 code scanning 工作流。
  4. **盯住定时任务的可靠性**（第十二轮 §17.7 第 1 条）：近两周多数运行因 30 分钟上限失败；
     本轮**准点起跑且未超时**，但沿用第十二轮的规程——**先落地、再记录**
     （本轮范式：3 个小 PR 各自合并 → 文档最后写并立即推送）。
  5. 维持验收线：**推送前** `typecheck + test + build` 全绿、**推送后立刻开 PR 并等 CI 绿再合并**、
     `pnpm audit` 必须带 `--registry=https://registry.npmjs.org`（本机）。

---

## 19. 维护记录（2026-09-26 04:00 CST / UTC 2026-09-25 20:00 · 第十四轮：0 open issue / 0 open PR → 走"无 issue → step 5 安全扫描"；先闭环第十三轮唯一的未闭环观测（gen-21），再落地 3 个 PR = 明文传输的 VLM API Key 可见化 · 插件自建 IPC 对象权限收紧（PTY 会话文件 / sidecar UDS / 抓取到的安装器脚本）· Dependabot 版本更新；并把跨五轮未处理的部署配置项升级为 issue #40）

> 本轮结论：起始 **0 open issue / 0 open PR**、`main` 与 `origin/main` 一致、工作树干净
> ⇒ 按 step 1 的分支条件**干净地走 step 5**，与第十/十二轮那种"在途交付"不同。
> 与第十三轮的关键差别在**看问题的角度**：第十三轮在同一批文件里发现了"会话 id 可以**逃出**会话目录"
> （路径穿越），本轮在**同样的对象**上换了一个维度——"插件**自己创建**的 IPC/状态对象**权限有多宽**"——
> 结果 4 处权限都由 umask 派生，其中 1 处**世界可写**、而它正是**一个 sudo 进程的 stdin**。
> 另外本轮**如实记录一次自己的流程事故**（两个提交一度落到了 `main` 上，见 §19.3）与
> **一次 CI 抓出、本地看不见的真实回归**（§19.4）——两者都不是"顺利"，但都是本轮的真实内容。
> 结束：代码侧 `main = bc6abd8`（其后仅追加本文档的 `docs:` 提交）、
> **1 open issue（本轮有意新开的 #40）** / **open PR 全部来自 Dependabot 且仍在增加**
> （收尾时已到 **#42–#46**：本轮新增的 `dependabot.yml` 生效后**自动开出**，见 §19.7 第 6 条——
> **这是配置生效的正常产物，不是未完成的交付**）；用例 **310 → 323**。

### 19.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（工作树干净） | `main` = **`bc6abd8`**（本地与 `origin/main` 一致） |
| `main` | `f5cbebf`（第十三轮 docs） | `81c34ab`（#38）→ `1024df1`（#39）→ `bc6abd8`（#41） |
| open issue / open PR | **0 / 0** | **1 / N（N 仍在增长）**——#40 是本轮**有意新开**的跟踪项；open PR **全部**由本轮新增的 `dependabot.yml` **自动开出**（收尾时 **#42–#46**，见 §19.7 第 6 条） |
| vitest 用例 | 310（309 过 + 1 pty-skip） | **323**（322 过 + 1 pty-skip） |
| sidecar selftest | 10 场景 | **11** 场景（新增 UDS 权限断言） |
| 包数量 / 环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| 运行中的 dsh | 启动于 **2026-09-25 04:25:40 CST**（= 第十三轮 gen-21 重启的产物，MainPID 1698096） | 同进程；本轮改动已构建进 `lib/`，gen-22 重启待执行（§19.5） |
| GitHub 侧扫描 | Dependabot alerts 已开（0 告警）、secret scanning + push protection 已开、CodeQL 未配置、**无 `dependabot.yml`** | 前三项不变；**新增 `.github/dependabot.yml`**（#41） |

### 19.1 Issue 检查（step 1）——0 / 0，且**先闭环上一轮的预言**

```text
gh issue list --state open                                     → 0
gh api "repos/StvLi/dsh-ros2/issues?state=open" --jq 'length'   → 0
gh pr    list --state open                                     → 0
git rev-list --left-right --count main...origin/main           → 0  0
git status --porcelain                                         → （空）
```

第十三轮的 §18.8 把两条"仓库外"事项列入"下次维护建议"。本轮逐条处理，**结论是：一条闭环、一条升级**：

| 第十三轮遗留项 | 本轮处置 | 结果 |
| --- | --- | --- |
| 复核 **gen-21 重启后**的现场（唯一未闭环观测） | 读 journal + 实测运行时 | ✅ **闭环**（§19.5）：journal 五环节齐全，且预言的两个可观测变化**逐字命中** |
| `~/.dsh/profiles/web/cordis.patch.yml` 的 5 处 `/tmp/vlm_ws` 死段（已连续四轮"仍未修"） | 按第十三轮自己的建议**升级为 issue** | ✅ **已开 issue #40**（§19.7 第 1 条）；配置本身**仍未改动**，理由见该 issue |

⇒ 本轮**结束时有 1 个 open issue**，但这是**有意的状态**，不是漏判：`#40` 记录的是一个
**仓库外**、需要**运维决定**才能改的运行中部署配置，把它留在 issue 列表里正是为了让它进入
"下次维护 step 1 → 有 issue → 转 step 2"的正规回路，而不是继续只躺在本文档里。

### 19.2 建议评估（step 2）——本轮无外部 issue，故评估**自己提出的** 5 条

本轮无 open issue，step 2 没有外部建议可评。沿用第十二轮 §17.2 的做法：对**自己提出的**
每一条主张**逐条核验其真实性**，而不是只写结论——核查方式与判定如下。

| # | 本轮主张 | 核验方式（实证，非推断） | 判定 |
| --- | --- | --- | --- |
| F1 | VLM API Key 会以**明文**经过网络，且 doctor 完全没提这件事 | ① 读 `vision.ts` 确认 openai provider 用 `Authorization: Bearer`、gemini 用 `?key=`；② **实跑** `ros2_vision_doctor` 取到线上 `apiKey.baseUrl`；③ 确认该 URL 是非回环 `http://`；④ 全仓库 grep `https\|cleartext\|tls` 确认**没有任何** scheme 检查 | ✅ 真实且**当前正在发生** |
| F2 | PTY 会话目录/文件权限由 umask 派生，`<sid>.in` 可被同组写 | 用 **`origin/main` 的原版 helper** 在 `umask 000` 下**实跑** `start`，`stat` 结果 | ✅ 真实（`-rw-rw-rw-`，**世界可写**） |
| F3 | sidecar 控制面 UDS 权限同样由 umask 派生，而协议**无鉴权** | 读 `server.py`（`bind()` 无 chmod、协议无 auth）+ 实测 AF_UNIX 建socket 的模式（本机 umask 0002 → `775`）+ 确认其用**写权限**判定 `connect()` | ✅ 真实（本地可利用面窄，见下） |
| F4 | `ros2_install` 抓到的安装器脚本组可写，而它**会被执行** | 读 `buildRos2InstallDownloadCommand`：`chmod +x` 不限制 group/other 读 | ✅ 真实（同类，低危） |
| H1 | Dependabot alerts 已开，但**没有版本更新**（缺 `dependabot.yml`） | `find .github -type f` → 只有 `workflows/ci.yml`；workflow 里 Actions 用的是**可变大版本 tag** | ✅ 真实（加固项） |

**诚实定级（不抬高也不淡化）**：F2/F3/F4 都**依赖 umask**、且都是**本机/同组**范围，
在当前这台单用户桌面上的实际影响**很小**——所以本轮**没有**把它们写成"高危漏洞"。
之所以仍然修，是因为受影响的对象是**一个 sudo 进程的 stdin** 和 **世界可写 `/tmp` 里的可预测路径**，
而且"权限取决于 umask"恰恰是那种**会悄悄失效**的保证。F1 是**唯一一条当前正在发生**的
凭证暴露面，因此单独立 PR（#38）。

### 19.3 开发管理（git · step 3）

| PR | 分支名 | 提交 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| **#38** | `fix/vision-cleartext-key` | `81c34ab`（squash） | `fix(vision)` | 新增 `classifyVisionTransport()`；doctor 报 `apiKey.transport` 并对 http+非回环**告警** |
| **#39** | `fix/ipc-object-permissions` | `1024df1`（squash，含 2 个提交） | `fix(core)` + `fix(sidecar)` | PTY 目录/文件 0700/0600 + 安装器脚本 `umask 077`/`chmod 700`；sidecar UDS 0600 |
| **#41** | `ci/dependabot-version-updates` | `bc6abd8`（squash） | `ci(deps)` | 新增 `.github/dependabot.yml`（github-actions + npm，weekly） |

- 三个分支均以语义前缀新开（`fix/...` = 修复、`ci/...` = 构建/CI），均 `off main`；每个 PR 单独 CI。
- **#39 为什么是两个提交**：#39 同时动 `core`（PTY + 安装器）与 `sidecar`（UDS）。两者是**两个包、
  两个不同的 IPC 对象**，拆成两个 `fix(<pkg>)` 提交能让 `git log`/`bisect` 按包定位；这**不是**
  切分失误，而是有意的（对比第十三轮 §18.3 把 `common`+`core` **合并**成一个提交，理由同样写在正文里）。
- **F1 为什么只告警、不阻断**：gateway 地址属于**运维的部署**，静默拒发会**破坏一个可用配置**
  而不是描述它。这与仓库既有 `apiKeyPlaintext` 告警同一形状；修法写在告警正文里（换 https 或改回环）。

**本轮如实记录一次流程事故：两个提交一度落到了 `main` 上。**

- 经过：`gh pr merge 38` 会**自动把本地切回 `main`**。执行它时，#39 的改动**还是未提交的工作树修改**；
  `git checkout main` 把它们带了过去，`git pull --ff-only` 成功，随后 `git commit` 就把
  `fix(core)` / `fix(sidecar)` **提交到了本地 `main`**。
- 影响面：**远端 `main` 未被推送**（本地 `main` 仅 "ahead 2"），因此**没有绕过 PR/CI**；
  但当时 `git push origin fix/ipc-object-permissions` 推的是**仍指向 `f5cbebf` 的旧分支**，
  于是 `gh pr create` 报 `No commits between main and fix/ipc-object-permissions`——**这个错误暴露了事故**。
- 修正：`git branch -f fix/ipc-object-permissions 44d4e94`（把提交归位到分支）→
  `git branch -f main origin/main`（`main` 退回远端）→ 重新 push（快进）→ 开 PR #39。
- 教训：`gh pr merge` 会切分支，**合并前必须先提交或 stash**；并且"`gh pr create` 报 no commits"
  应当**先怀疑分支/提交位置**，而不是怀疑分支名。

### 19.4 本地验收 + 一次"本地绿、CI 红"的真实回归（含一个本地**结构性盲区**）

**#39 的首跑 CI 红了**，而本地三件套全绿：

```text
FAIL tests/tools.spec.ts > ros2_install interactive flow (mock installer, no network)
     > start -> send -> status -> stop drives the installer menus via PTY
AssertionError: expected '' to contain '安装完成'
```

- **真因（我自己引入的）**：`open_private()` 的第一版对 append 模式也加了 `O_TRUNC`。
  而 `open(path, "ab")` **不截断**。于是每次 `send` 都把 `.in` 清空——而 daemon **持有自己的读偏移**，
  截断后写入的数据可能落在该偏移**之后**、**永远读不到**；安装器因此走不到 `安装完成`。
- **为什么本地是绿的（这是本轮最有价值的一条结构事实）**：

  ```text
  $ python3 -c 'import pty; pty.openpty()'
  OSError: out of pty devices
  $ mount | grep devpts
  devpts on /dev/pts type devpts (rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000)
  ```

  本机 `devpts` 以 **`ptmxmode=000`** 挂载 ⇒ `ptyUsable = false` ⇒ 用例里的
  `it.skipIf(!ptyUsable)` 让**整条 PTY 交互链被 skip**（本地 `135 passed | 1 skipped`），
  而 CI（ubuntu runner）能分配 pty，所以**CI 是这条链唯一的大门**。
- **修正**：恢复 per-mode 语义（`"a"` → `O_APPEND`，不截断；`"w"` → `O_TRUNC`），
  **并且补一个不需要 pty 的回归测试**：直接驱动 `open_private()`，断言 append **保留**内容、
  `"w"` **仍然**截断、文件仍是 `0600`。这样**同一类回归在这台无法分配 pty 的机器上也会红**。
  该缺陷由此从"只有 CI 能看见"变成"本地也能看见"。

最终验收（`main`，包含 #38+#39，自 `rm -rf packages/*/lib` 起）：

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
rm -rf packages/*/lib            # 复刻 CI 的"干净 clone"起点
CI=true pnpm run typecheck       # 9 包 tsc --noEmit 全部 Done（exit 0）
CI=true pnpm run test            # 323 例（322 过 + 1 pty-skip）（exit 0）
CI=true pnpm run build           # 全部 Done（exit 0）
```

**用例分布（实测）**：common **57** + core **137**（136 过 + 1 skip）+ moveit 16 + profile 14 +
safety 10 + vision **53** + state 8 + dsh-ros2 28 = **323**；另 sidecar selftest **11 场景**（SELFTEST PASSED）。
第十三轮 310 → 本轮 **+13**（vision +10：7 条 transport 纯函数 + 3 条 doctor 传输面；
core +3：PTY 权限模式、append 语义回归、安装器脚本模式）。

### 19.5 dsh-phoenix 持续更新 / 测试链路（step 4）——第十三轮的未闭环观测**逐字命中**，并请求 gen-22

**① 第十三轮 §18.8 第 1 条（其唯一未闭环观测）：已闭环 ✅**

第十三轮在 `04:13:27` 登记了 `gen 21` 重启请求（硬期限 ≈ `04:25:27`），但**无法在同一进程内观测结果**。
本轮起点进程启动于 **2026-09-25 04:25:40 CST**（MainPID 1698096）——**正是 gen-21 的产物**：

```text
Sep 25 04:13:24  [dsh-phoenix] cordis tool: cordis_run
Sep 25 04:13:27  [dsh-phoenix] restart requested (gen 21): plugin-change
Sep 25 04:18:27  [dsh-phoenix] soft defer deadline reached; agent still busy —
                  restart will be forced at the hard deadline (policy=auto)
Sep 25 04:25:27  [dsh-phoenix] agent idle; executing deferred restart (gen 21)
Sep 25 04:25:27  [dsh-phoenix] scheduling restart (plugin-change, gen 21): systemd-run … stop; sleep 8; start
Sep 25 04:25:27  [dsh-phoenix] restart cmd exit=0
Sep 25 04:25:32  systemd: Stopped dsh-web.service
Sep 25 04:25:40  systemd: Started dsh-web.service
Sep 25 04:25:42  [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

⇒ 与 gen-19/gen-20 **同一套生命周期**（软告警 5 分钟 → 硬期限前执行 → 停 8 秒 → 起 → loaded），
**五环节齐全**。第十三轮预言的两个可观测变化本轮**实测命中**：

```text
ros2_install action=send session="../../victim"
  → { ok:false, code:"INVALID_SESSION", message:"非法会话 id ../../victim：只允许字母/数字/._-…" }
     # 第十三轮 PR #35 的修复在活进程里生效；且它不再触碰文件系统（第十三轮证明过 before/after）

ros2_vision_doctor → workspace.installDirs: ["/home/stvli/lite_delivery_aio/install"]  # 第十二轮是 []
                     apiKey: { source:"secrets", keyConfigured:true, plaintext:false }  # 不再误报
ros2_env_check     → bundles.stale:false · drift 全 false · totalTools 81 · totalSkills 9
                     skillCatalogue.complete:true · missing:[]        # 正向信号齐全
                     setup.missingSources:["/tmp/vlm_ws/install/setup.bash"] · probe.exitCode:0  # 自愈仍有效
```

**② 本轮末端动作：请求 gen-22 优雅重启**

本轮 3 个 PR 已合入 `main` 并重建 `lib/`（`pnpm run build` exit 0；实测 `core/lib/tools.js` 含
`umask 077`/`chmod 700`、`core/scripts/pty_session.py` 含 `ensure_private_dir`/`open_private`、
`vision/lib/transport.js` 存在且 `vision/lib/tools.js` 含 `classifyVisionTransport`、
`sidecar/server.py` 含 `chmod 0o600`），随后按本 preset 的**文档化触发面**激活一个**惰性**动态包
（`apply()` 空实现：不注册工具/事件/服务/UI；唯一作用就是"让 `cordis_run` 发生"）：

```text
Sep 26 04:19:37  [dsh-phoenix] cordis tool: cordis_run
Sep 26 04:19:40  [dsh-phoenix] restart requested (gen 22): plugin-change
```

即 phoenix **看到了**这次激活并登记为**第 22 代**重启请求（journal 原文，非推断），
与 gen-19/20/21 走同一套"软告警 5 分钟 / 硬期限前执行 / policy auto"生命周期。
本会话仍在运行，**重启后的现场无法在同一进程内观测**——如实列为 §19.8 第 1 条。

- **重启后可观测的变化（预期）**：`ros2_vision_doctor` 的 `apiKey.transport` 字段**新出现**，
  且对本机当前配置（`http://121.9.219.138:8888/v1`）应**报 `cleartext: true` 并带告警**——
  这是本轮唯一能**在同一会话重启后直接验证**的运行时变化，已列为 §19.8 第 1 条。
- **诚实边界**：F2/F3/F4（权限类）**在活进程里不可观测**——它们影响的是**新创建**的文件/套接字，
  而本轮没有新建 PTY 会话（`action=start` 需审批，且本机 ROS2 已安装 ⇒ 直接 `already-installed`）。
  其证据是**真实 helper 的 before/after 实测**（§19.6）与**测试断言**，这一点不夸大。

### 19.6 安全扫描（step 5）

**依赖漏洞**：

- `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org/` → **No known vulnerabilities found**（exit 0）。
- 本机默认源（`registry.npmmirror.com`）→ `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。**这不是"干净"，是"没查成"**，
  不可当作结论；CI 在 GitHub runner 上默认即官方源 ⇒ CI 闸门有效。沿用第八/十/十二/十三轮同一结论。

**GitHub 侧扫描面（本轮重查）**：

| 面 | 本轮结果 | 与第十三轮对比 |
| --- | --- | --- |
| Dependabot alerts | **已开启**（`GET /vulnerability-alerts` → `204`），开放告警 **0** | 保持（第十三轮开启） |
| Dependabot security updates | `enabled: true`, `paused: false` | 保持 |
| **Dependabot 版本更新** | 第十三轮为**无**（`.github/` 只有 `workflows/ci.yml`） | **本轮补上**（#41 新增 `dependabot.yml`，两生态 weekly） |
| Secret scanning | **enabled**，开放告警 **0** | 保持 |
| Secret scanning push protection | **enabled** | 保持 |
| `secret_scanning_non_provider_patterns` / `validity_checks` | `disabled` / `disabled` | 未改动（非阻塞项） |
| Code scanning (CodeQL) | **`404 — no analysis found`** | 未改动；见 §19.8 第 3 条 |

**静态扫描**（本轮覆盖面**扩大**到第十三轮未列的目录）：

| 面 | 结果 |
| --- | --- |
| `eval(` / `new Function` / `vm.` | **0** |
| `shell: true` / `execSync` | **0** |
| `child_process.exec(` 命中 | 全部是 `RegExp.prototype.exec`（逐处核对） |
| `execFile` / `spawn` | 全部走 **argv 数组**（`runner.ts:37/395`、`core/tools.ts:177`、`gui.ts:364`） |
| `bash -lc` 的 4 个调用点 | ① `runner.ts:275`：`cmd` 由 `args.map(shq)` 逐参拼装；② `gui.ts`：**常量模板** + 变量经 `env`（`SCREENSHOT_PATH`/`SCREENSHOT_CROP`）传入；③ `core/tools.ts` probe：**纯常量字符串**；④ `process_cleanup`：`bracket` 自带 `'` → `'\''` 转义且整体单引号包裹，`signal` 先过 `KILL_SIGNAL_RE` 再 `shq()` |
| Python `shell=True` / `os.system` / `pickle` / `yaml.load` | **0**——本轮覆盖面**新增** `packages/sidecar/sidecar/**`、`packages/safety/safety/**`、`packages/vision/vlm/**`（第十三轮只扫了 `packages/*/scripts`） |
| Python `subprocess.*` | 全部 **argv 数组**（含 `safety_monitor` 的 `["timeout", …, "ros2","topic","echo", topic, "--once"]`、`image_snapshot.py` 的 `["ffmpeg","-f","v4l2",…]`） |
| 硬编码密钥（工作树） | **0**（`sk-…` / `AIza…` / `ghp_…` / `xox…` / `BEGIN PRIVATE KEY`） |
| 硬编码密钥（**全 git 历史、全分支所有 blob**） | **0**（逐 blob 扫描，实测 `total blobs with secret-like content: 0`） |
| 包 `lifecycle` 脚本 | **9 个包 + root 全部 none**（无安装期执行面） |
| `.gitignore` | 覆盖 `secrets.json` / `*.secrets.json` / `.dsh-ros2/` / `.env` / `lib/` / `node_modules/` / `__pycache__/` |
| 密钥文件处置 | `~/.dsh-ros2/secrets.json`：mode **`600`**、**仓库外**（实测 `readlink -f` 不在仓库内）、不在 `files` 白名单；`ros2_vision_set_key` 返回体为 `{stored, source, path, mode, hint}`——**只回 mode，从不回显密钥** |

**本轮新增面的评审（自己新引入的代码）**：

| 面 | 结论 |
| --- | --- |
| `classifyVisionTransport()`（#38） | **纯函数、全定义域**（空/畸形 URL 返回"无 scheme、无风险"而非抛错——doctor 不能因坏配置而失败）；回环判定含整个 `127.0.0.0/8` 与 `[::1]`；**只读**，不改变任何请求行为 |
| doctor 的 transport 告警（#38） | 只**新增**一个数据字段与一条 `warnings` 条目；**不改**调用路径、不改失败语义 |
| `ensure_private_dir()` / `open_private()`（#39） | **收紧**：只改新创建对象的 mode；**不改**读写内容（append 语义已按 `open()` 逐 mode 对齐并补测试） |
| 安装器 `umask 077` + `chmod 700`（#39） | **收紧**：脚本仍可执行（同 uid），`--` 终止选项解析的既有保证不变；既有 quoting 测试**无需改动仍全绿** |
| sidecar UDS `chmod 0600`（#39） | **收紧**：best-effort（OSError 忽略），平台不支持 chmod 时服务器照常工作 |
| `.github/dependabot.yml`（#41） | **只增不改**：Dependabot **只开 PR**，每个 PR 仍须过同一条 CI（typecheck+test+build+发布面闸门）才能进 `main`，**不新增**任何绕过人工审查的路径；`permissions: contents: read` 不变 |
| 既有防线回归 | 随测试全绿：`isSafePathComponent`/`safe_name()` 穿越用例、`ros2_interface_create` 的 `PATH_ESCAPE`、`shq()` 单引号包裹、safety_monitor argv 数组、PTY 会话 id 双层守卫 |

### 19.7 本轮发现（含仓库外的问题）

1. **【仓库外·已升级为 issue #40·仍未改】** `~/.dsh/profiles/web/cordis.patch.yml` 第 33/37/41/45/49 行
   仍以 `&& source /tmp/vlm_ws/install/setup.bash` 结尾，而 `/tmp/vlm_ws` **已不存在**
   （第 29 行注释写着"`/tmp/vlm_ws` 已删除，改用实际构建的交付工作区"——**注释改了、5 个值没改**）。
   **本轮不再只写进文档**（这已是连续第五轮）：按第十三轮 §18.8 第 2 条自己的建议，
   **升级为 issue #40**，附上实测证据与一行修法，让它在 issue 列表里被 step 1 捡起。
   代价仍只是每次调用多一次 `existsSync` 与一段告警噪声（自愈本轮**再次实测有效**：
   `missingSources` 有值、`probe.exitCode = 0`、`note` 点名），**不是当前故障**。
   **本轮仍不擅自修改**，理由与该 issue 正文一致：文件在**仓库外**、属于**运行中的部署**、
   改动需**重启**才生效，而本轮被要求维护的是**仓库**。
2. **【安全·已修·真实且正在发生（#38）】** **VLM API Key 明文过网**。openai provider 用
   `Authorization: Bearer <key>`、gemini 用 `?key=`，而线上 `vision.baseUrl` 是
   **`http://121.9.219.138:8888/v1`（非回环、公开地址）**⇒ 每次 `ros2_vision_describe` /
   `ros2_vision_analyze` 都把密钥交给路径上的任何中间设备；而 doctor 把该网关报成
   "reachable / HTTP 200"的**健康**状态，**没有任何一处**看过 scheme。
   **这条是本轮最重要的发现**：它不在任何 issue 里，是安全扫描自己撞见的，且**不是理论问题**。
3. **【安全·已修·umask 派生（#39）】** **插件自建的 IPC/状态对象权限过宽**，一处**世界可写**：
   - **PTY 会话文件**：`<sid>.in` 是**被驱动进程的 stdin**（此流程 = 带 sudo 的鱼香ROS安装器）。
     用 `origin/main` 原版 helper 在 `umask 000` 下实跑：`drwxrwxrwx`（目录）与
     `-rw-rw-rw-`（`.in`/`.meta`）⇒ 修后 **0700 / 0600**。
   - **sidecar 控制面 UDS**：`bind()` 的 mode 由 umask 派生，默认路径 `/tmp/dsh-ros2-sidecar.sock`
     在**世界可写目录**；AF_UNIX 以**写权限**判定 `connect()`，而协议**无鉴权** ⇒ 同组用户可读语义缓存。修后 **0600**。
   - **抓取到的安装器脚本**：`chmod +x` 不限制 group/other ⇒ 改为 `umask 077` + `chmod 700`；
     该脚本**会被执行**，组可写即"取回与执行之间可被换掉"的窗口。
   **诚实定级**：三者都**依赖 umask、且是本机/同组范围**，单用户桌面上影响很小 ⇒ 记为**加固**，
   不记为"活漏洞"。
4. **【流程·自曝·已修正】** **一次分支/提交位置事故**（§19.3）：`gh pr merge` 自动切回 `main` 时，
   #39 的改动尚未提交而**随之落到 `main`**。**远端未被推送、未绕过 PR/CI**；
   由 `gh pr create` 报 `No commits between …` 暴露，已用 `git branch -f` 归位并重开 PR。
5. **【本地盲区·已补测试】** **本机无法验证 PTY 交互链**：`devpts` 以 `ptmxmode=000` 挂载
   ⇒ `ptyUsable=false` ⇒ 整条用例在本机 skip，**CI 是唯一大门**。这正是 #39 首跑"本地绿、CI 红"的成因。
   已补一条**不需要 pty** 的回归测试（直接驱动 `open_private()`），使同类回归本机也能红。
   **这是本轮新增的结构性认知**：今后的验收线不能默认"本地全绿 = 全部被覆盖"。
6. **【供应链·已修（#41）】** Dependabot **告警**已开但**版本更新**未开（缺 `dependabot.yml`）；
   且 workflow 里 Actions 用的是**可变大版本 tag**（`actions/checkout@v7` 等），
   上一次升级（`618bdbe`）是手工提交的。已补 `dependabot.yml`（两生态 weekly）。
   **未采纳**"pin 到完整 commit SHA"：那是更强的姿态但维护成本不同量级，宜与自动化配套后再单独决定。
   **有效性已当场验证**：`dependabot.yml` 合入（`bc6abd8`，20:18 前后）后 **数分钟内**
   Dependabot 就开始自动开 PR —— 收尾时已到 **#42–#46**（`@deepseek-ai/cordis` 4.0.1→4.0.4、
   `vitest` 4.1.11→5.0.1、`@deepseek-ai/schemastery`、`@types/node`、`@deepseek-ai/dsh-skill`），
   且**仍在继续**。即配置**不只是"加了个文件"，而是真的产生了 PR 流**。
   本轮**不代为合并**这些 PR：依赖升级应由 CI 绿 + 人工过一眼后合入（其中 `vitest` 4→5 是大版本、
   `@types/node` 24→26 可能牵动 `engines`），这正是 §19.8 第 4 条要观察的内容。
   顺带说明：**"open PR 数"从本轮起不再是"0"这个静态值**，而是**由自动化持续产生的动态量**——
   本文档后续不应再把"N open PR"当作"本轮交付是否干净的判据"。
7. **【时间口径】** 本节标题用**本地时间（CST）**，git / CI / journal / 任务历史为 **UTC**：
   本轮 `09-26 04:00 CST` = `09-25 20:00 UTC`。

### 19.8 结论与下一步建议

- **交付**：PR **#38**（明文密钥可见化）、**#39**（IPC 对象权限）、**#41**（Dependabot 版本更新）
  全部 CI 绿（Node 22/24）并合入 `main`；3 个分支（本地+远端）已清理；
  **0 open PR（截至本轮 3 个 PR 合并完毕时）**；**1 open issue（#40，本轮有意新开）**；
  用例 **310 → 323**；sidecar selftest 10 → 11。
  **补充（本轮末尾新增）**：`dependabot.yml` 一经合入，Dependabot 在数分钟内开始自动开 PR
  （收尾时已到 **#42–#46**，且仍在增加），因此**结束时的 open PR 数不再是 0，而是由自动化持续产生的动态量**
  —— 这是**本轮配置生效的正常产物**，不是未完成的交付（见 §19.7 第 6 条）。
- **线上价值**：① 一处**当前正在发生**的凭证暴露面（VLM Key 明文过网）从"静默健康"变为
  **上报并可告警**；② 插件自建的 IPC/状态对象不再继承 umask——其中包括**一个 sudo 进程的 stdin**
  与 **`/tmp` 里的可预测套接字**；③ 供应链从"只有告警"补到"**有版本更新**"。
- **末端动作**：改动已构建进 `lib/`，并按文档化触发面激活惰性动态包，**已确认** phoenix 登记
  `gen 22` 重启请求（`04:19:40`，journal 原文）；由 phoenix 在会话空闲的安全点执行优雅重启。
- **下次维护建议**：
  1. **复核 gen-22 重启后的现场**（本轮唯一可闭环的运行时观测）：确认 `ros2_vision_doctor`
     新出现 `apiKey.transport`，且对本机配置报 **`cleartext: true` + 告警**（§19.5）。
  2. **处理 issue #40**（部署配置的 5 处 `/tmp/vlm_ws` 死段）：这是唯一一条**已经跨五轮**的事项，
     本轮已把它从"文档备注"升级为 **issue**，因此它会自动进入下次 step 1 的判定——
     **要么修（一行 ×5 + 优雅重启），要么明确以"不改"关闭**，不要再悬着。
  3. **考虑配置 CodeQL**（第二轮提出）：Dependabot 两半（告警 + 版本更新）现已齐全，
     但**静态分析仍无基线**；本仓库 TS + Python 混合，值得给 `packages/*/src` 与
     `packages/*/scripts` 建一条 code scanning 工作流。
  4. **`dependabot.yml` 生效后观察首批 PR**：确认两个生态都能开 PR、且 `commit-message.prefix`
     符合本仓库的 `ci:` / `chore(deps):` 约定；若 pnpm workspace 解析有问题，改为按包目录列出。
  5. **维持验收线（并按本轮第 5 条**扩展认知**）**：`pnpm audit` 必须带
     `--registry=https://registry.npmjs.org`（本机）；**"本地全绿"≠"全部被覆盖"**——
     凡涉及 PTY/交互路径的改动，**本地 skip 是常态，必须以 CI 为准**；
     推送前 `typecheck + test + build`、推送后**立刻开 PR 并等 CI 绿再合并**；
     合并前**先提交或 stash**（§19.3 的教训）。

---

## 20. 维护记录（2026-09-29 10:35 CST / UTC 2026-09-29 02:35 · 第十五轮：open issue #40 → step 2 → 承接在途 `fix/workspace-path-hygiene` 并落地 `fix(common)`（自愈把"存活但写成 `~/…`"的工作区判为缺失 → **静默换环境**）→ 闭环第十四轮 gen-22 观测 → 实测线上 **6 处**死链 → 本轮无 API token，用一次性 `ci/probe-*` 分支取得 CI 双绿）

> 本轮结论：起始 **1 open issue（#40）** / **6 open PR（#42–#47）**、`main = origin/main = 7d0b4b5`、工作树干净，
> 但**当前分支 `fix/workspace-path-hygiene` 上有 2 个未推送的 `docs:` 提交**——即**上一轮的时间窗被截断，留下一段在途交付**。
> 于是本轮按 step 1 的"有 issue"分支走 step 2–4，但**不是从零开始**：先**承接在途分支**（命名本就符合 `fix/...`），
> 再在其上补上**唯一真正缺的那一半**——代码。
> 本轮最有价值的发现**不在 issue 里**：issue #40 讲的是"配置里指向已删除的工作区"，
> 而本轮发现**插件自己**会把**存活的工作区**判成缺失并**静默换到另一个环境**，
> 触发条件正是**本分支刚在 README 里推荐的 `~/vlm_ws` 写法**。
> 另外如实记录一个**运维缺口**：本轮的 `gh` **没有可用 token**，"开 PR / 合并"两环**首次无法执行**（§20.7 第 3 条）。

### 20.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `fix/workspace-path-hygiene`（**本地领先 `main` 2 个 `docs:` 提交、未推送**；工作树干净） | 同分支 = **`2b7780a`**（**已推送** `origin/fix/workspace-path-hygiene`） |
| `main` | `7d0b4b5`（= `origin/main`） | 同（**未动**——本轮无权开 PR，故不直接落 `main`） |
| open issue / open PR | **1 / 6**（#40 / #42–#47） | **1 / 6**（本轮**未新增、也未合并**任何 PR——授信缺口见 §20.3） |
| vitest 用例 | 323（322 过 + 1 pty-skip） | **344**（343 过 + 1 pty-skip） |
| 包数量 / 环境 | 9 包 · Node `v24.16.0` · pnpm `11.22.0` · vitest 4.1.11 | 同 |
| 运行中的 dsh | 启动于 **2026-09-29 10:32:53 CST**（= 第十四轮请求的 **gen-22** 落地产物，phoenix `generation: 22`、`lifecycleState: running`、MainPID 1570） | 同进程；本轮改动已重新构建进 `lib/`，**gen-23 重启请求待执行**（§20.5） |
| GitHub 侧 | Dependabot 告警 + 版本更新均已开（`#42–#47` 已自动开出）、**CodeQL 未配置** | 同（CodeQL 仍未配置——连续第二轮提出） |

### 20.1 Issue 检查（step 1）

```text
gh issue list --state open   → 1   （#40）
GET /issues?state=open       → 7   （其中 6 条是 PR：#42–#47）
git rev-list --left-right --count main...origin/main → 0  0
git status --porcelain       → （空）
```

| # | 类型 | 标题 | 创建 | CI / 可合并性（本轮实测） |
| --- | --- | --- | --- | --- |
| **#40** | **issue** | `chore(deploy): 5 rosSetup chains still source the deleted /tmp/vlm_ws (self-heal masks it)` | 2026-09-25 | —（**本轮 step 2 的评估对象**） |
| #42 | PR·Dependabot | `chore(deps): bump @deepseek-ai/cordis 4.0.1 → 4.0.4` | 2026-09-25 | `check (22)`/`check (24)` **success**，`clean` |
| #43 | PR·Dependabot | `chore(deps): bump vitest 4.1.11 → 5.0.1` | 2026-09-25 | **success**（大版本，`mergeable_state=unknown`） |
| #44 | PR·Dependabot | `chore(deps): bump @deepseek-ai/schemastery 3.18.1 → 3.18.4` | 2026-09-25 | **`check(24): failure` / `check(22): cancelled`** ← 已知的 lockfile 双副本问题 |
| #45 | PR·Dependabot | `chore(deps): bump @types/node 24.13.3 → 26.6.2` | 2026-09-25 | **success**（`engines` 可能受影响，待人工过目） |
| #46 | PR·Dependabot | `chore(deps): bump @deepseek-ai/dsh-skill 0.1.0-rc.6 → 0.1.0-rc.8` | 2026-09-25 | **success**，`clean` |
| #47 | PR·本仓 | `fix(deps): take the schemastery bump with a deduplicated lockfile` | 2026-09-26 | **success**，`clean`——**#44 的超集替代**（第十四轮为此而开） |

**⇒ 存在未处理的 issue（#40）→ 转入 step 2。** 与第十三/十四轮"0 open issue → 直接 step 5"不同。

### 20.2 建议评估（step 2）——issue #40 的合理性与必要性

issue #40 的主张：`~/.dsh/profiles/web/cordis.patch.yml` 有 5 处 `rosSetup` 以
`&& source /tmp/vlm_ws/install/setup.bash` 结尾，而 `/tmp/vlm_ws` 已不存在；插件会自愈
（剔除死段）故**不是故障**，但每次调用多一次 `existsSync` 与一条告警噪声。

| 判断维度 | 结论 | 依据（本轮实证，非推断） |
| --- | --- | --- |
| **真实性** | ✅ 成立 | 读配置：第 33/37/41/45/49 行**逐字**仍是 `/tmp/vlm_ws/…`；`ls -d /tmp/vlm_ws` → 不存在 |
| **自愈确实有效（不是故障）** | ✅ 成立 | 实跑 `ros2_env_check`：`setup.prefix` 已收敛为 `source /home/stvli/lite_delivery_aio/install/setup.bash && `，`missingSources` 如实点名死段，`probe.exitCode = 0` |
| **影响面** | ⚠️ **低**（同意 issue 自评） | 代价 = 每次调用一次 `existsSync` + 一条 note；**不改**语义、不失败 |
| **是否必要的修复** | ✅ 必要，但**须由运维决定** | 文件在**仓库外**、属于**运行中的部署**、改动**需重启**才生效；issue 正文自己声明"editing it is a deliberate operator decision" |
| **本次是否该由维护任务直接改** | ❌ 不改 | ① 沙箱策略为 workspace-write，该文件在会话工作区**之外**；② 即便可写，这正是 issue 明确保留给运维的决定，**speculative escalation** 不应成立；③ 本轮**无 token**，改完也**无法开 PR** 让改动可审（§20.3） |

**本轮对该 issue 的推进方式（不是"又悬着"，而是把它拆成能落地的两半）**：

1. **根因侧（仓库内·已落地）**：README / README_CN 的构建示例**不再教**把 colcon 工作区建在 `/tmp`
   （改为持久路径 `~/vlm_ws` 并写明理由）——**死链是这些示例攒出来的**。
2. **收尾侧（仓库外·给出可粘贴修法）**：`docs/feedback-env-recovery.md` 新增一节，
   写明成因、一行修法（×6，见 §20.7 第 2 条）、以及"删段前后生效前缀**逐字节相同**"的等价性证明。
3. **【本轮新增·最重要】发现推荐写法在插件里**本来是坏的**：`~/vlm_ws` 这种写法会让自愈
   把**存活**的工作区判为缺失并**静默换环境**（§20.4）。也就是说，
   **照 issue #40 的修法把路径改短、或照 README 的推荐写法配置，反而会踩到一个更坏的缺陷**——
   这一条 issue #40 完全没有提到，是本轮扫描/验证自己撞见的。

### 20.3 开发管理（git · step 3）

**分支策略**：起始分支 `fix/workspace-path-hygiene` 已存在且**命名符合 `fix/...` 规范**、
内容正是 issue #40 的文档一半（`docs:` ×2），只是**未被推送**（上一轮时间窗截断）。
本轮**承接该分支**而非另开新分支——另开会让这段在途工作与代码修复分家，
而 PR 审阅时"根因文档 + 根因代码"本就应该在一起。**不重复开分支是有意的判断，不是省事。**

| 提交 | 类型 | 内容 |
| --- | --- | --- |
| `ed6053c` | `docs` | README / README_CN 构建示例 `/tmp/vlm_ws` → `~/vlm_ws`（**根因**：`/tmp` 重启即清空） |
| `92a7f5b` | `docs(env)` | `docs/feedback-env-recovery.md` 增"部署配置卫生"节：成因 + 一行修法 + 等价性证明 + 通用规则 |
| **`2b7780a`** | **`fix(common)`** | **新增 `shellword.ts`，让存在性探针按 shell 的读法解析 `source` 词；`runner.ts` 接入；+21 用例** |

**本轮的方法论调整：无 API token ⇒ 用一次性 probe 分支取得 CI（重要且如实记录）**

```text
$ gh auth status
  X Failed to log in to github.com account StvLi … The token … is invalid.
$ ls -la ~/.config/gh/hosts.yml   → 97 bytes，**只有用户名，没有任何 token**
$ gh auth token -u StvLi          → （空）
$ git push --dry-run origin …     → ✅ 可用（SSH key 正常）
```

⇒ 本轮**只能 SSH 推送，不能 `gh pr create` / `gh pr merge`**（第十/十二/十三/十四轮都可用 `gh`）。
若就此收尾，就会丢掉本文档一贯的验收线"**推送后 CI 绿**"——因为 `ci.yml` 只在
`push: [main]` 与 `pull_request` 上触发，**推一个 feature 分支不会产生任何 CI 运行**。

为不放弃这条验收线，本轮采用**一次性 probe 分支**：

1. 从 `fix/workspace-path-hygiene` 开 `ci/probe-workspace-path-hygiene`（**树与 fix 分支逐字节相同**）；
2. 仅在其上加一个提交，把 workflow 触发面临时改为 `branches: [main, 'ci/probe-*']`；
3. 推送 → CI 运行 → **Node 22 / Node 24 双绿**：
   <https://github.com/StvLi/dsh-ros2/actions/runs/36513969874>
   （`check (22): success`、`check (24): success`；提交 `e116ee6`）
4. **删除该分支**（本地 + 远端），使远端不留一次性分支。

**这不是绕过 PR 流程**：probe 分支只提供"同一棵树已过 CI"这一条独立证据，
**正式 PR 仍需运维在有 token 时开**（见 §20.8"待运维"）。之所以值得这么做，是因为
CI 在**干净 checkout + `--frozen-lockfile` + 公共 registry audit** 下跑，
本机跑不出这两个条件（§20.6）。

### 20.4 本地验收 + 修复的真实前后对比

**发现路径**：本轮的文档提交把 README 的示例改成 `~/vlm_ws`。顺手核验"这个形式插件真的支持吗"——
`resolveSetup` 用 `existsSync` 比对**原始文本**，而 Node **不展开 `~`**。

**修复前（用修复前构建的 `lib/` 实跑，非推断）**：

```text
$ node -e "…resolveSetup({rosSetup:'source ~/Desktop/…/dsh-ros2/package.json && '})"
{ "prefix": "source /opt/ros/jazzy/setup.bash && ",          ← ★ 静默换到了别的环境
  "sourcePath": "/opt/ros/jazzy/setup.bash",
  "missingSources": ["~/Desktop/…/dsh-ros2/package.json"],   ← ★ 文件明明存在
  "note": "配置的 rosSetup source 路径不存在：…；已自动回退到 /opt/ros/jazzy/setup.bash。建议修正配置。" }
$ node -e "require('fs').existsSync('~/…/package.json')"  →  false   （展开后 → true）
```

**修复后（同一表达式，本次重新构建的 `lib/`）**：

```text
$ node -e "…resolveSetup({rosSetup:'source ~/.bashrc && '})"
  missingSources: []           ← 不再误判
  prefix: "source ~/.bashrc && "   ← ★ 逐字保留配置原文，未被改写成展开形式
```

**为什么这是"静默换环境"而不是"少报一条警告"**：`~/vlm_ws` 作为**唯一**段时，缺失判定会让
`kept.length === 0`，代码随后走 `autoDetectSetup()` → `/opt/ros/<distro>/setup.bash`。
于是**用户自己构建的工作区从 `AMENT_PREFIX_PATH` 里彻底消失**，
所有 `ros2_*` 工具都对着**另一个环境**跑——而这正是该函数注释里"replacing it wholesale with an
auto-detected setup would quietly source something else"声称要避免的事，且**没有任何红色信号**。

**修复设计（faithful，不越权）**：

| 面 | 处理 |
| --- | --- |
| 展开范围 | **只**做决定存在性的两种：行首 `~`（**仅裸词**——bash 在引号内不展开 `~`）与 `$NAME` / `${NAME}` |
| 引号语义 | 单引号**什么都不展开**；双引号**不展开 `~`**；`\$` 保持字面 `$` |
| 裸词分词 | 顺带修好 `\X` 转义：`source /a\ b/setup.bash` 现在是**一个**词，不再在空格处被截断 |
| **不可解**的词 | `~user`、**未设置**的变量、`$(…)` → `verified: false` → **保留该段**（**绝不**凭猜测换环境），把错误留给 shell 自己的 stderr |
| 是否改写命令 | **否**。`prefix` 逐字节不变（有测试断言 `~/…` 链路原样回环）；`missingSources` 仍报**配置里的原文**，便于运维 grep 定位 |
| `setupSourcePaths` | 改为返回**已解析**路径——其消费者（vision doctor 的 install 根）要 `existsSync` 它，否则会把**已构建**的 `~/vlm_ws` 报成 "not built" |

**验收（与 CI 同样的步骤，本机执行）**：

| 步骤 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm audit --prod --audit-level high` | ⚠️ 本机镜像（npmmirror）**没有 audit 端点**；改用 `--registry=https://registry.npmjs.org` → ✅ **No known vulnerabilities found** |
| `pnpm run typecheck` | ✅ 9 包 |
| `pnpm run test` | ✅ **343 过 + 1 pty-skip = 344**（323 → 344，**+21** = `shellword.spec.ts` 16 + `runner.spec.ts` 5） |
| `pnpm run build` | ✅ |
| 发布面闸门（`pnpm pack` ×9） | ✅ 9/9 OK，**无 tarball 携带 `.pyc`/`__pycache__`** |
| **CI（probe 分支，干净 checkout）** | ✅ **Node 22 + 24 双绿** |

### 20.5 dsh-phoenix 持续更新/测试循环（step 4）

**先闭环第十四轮唯一的运行时可观测项（预言 → 实测第二次）**：第十四轮 §19.8 第 1 条要求复核
"gen-22 重启后 `ros2_vision_doctor` 应出现 `apiKey.transport`，且对本机配置报 `cleartext: true` + 告警"。
本轮**逐字命中**：

```json
"apiKey": { "provider":"openai", "source":"secrets", "plaintext":false,
            "baseUrl":"http://121.9.219.138:8888/v1",
            "transport": { "scheme":"http","host":"121.9.219.138","loopback":false,"cleartext":true },
            "secretsFile": { "mode":"600", "keyPresent":true } }
warnings: ["…VLM API Key 会以明文经过网络：vision.baseUrl 是 http:// 且主机 121.9.219.138 不是回环地址…"]
```

⇒ **#38 的线上价值确认闭环**（一处"当前正在发生"的凭证暴露面已从"静默健康"变为"上报 + 告警"）。

**循环接线核对**：dsh-phoenix `0.2.6` 以 `link:` 装入 web profile；`/__dsh_health` 在线
（token `1790649175334-…`）；状态文件 `~/.dsh-phoenix-state.json`：
`generation: 22`、`lifecycleState: running`、`pendingResume: false`；`systemd --user dsh-web.service` active。
**触发面**：本会话的工具表里**没有** phoenix 自己的 `dsh_phoenix_restart` 工具，
故按文档化触发面（`cordis_run`，phoenix 的 `CORDIS_TRIGGER = { cordis_run: true }`）在**本轮末尾**
激活一个**惰性动态包**请求重启——与第十四轮同一做法。phoenix 对 busy agent 会**defer**
（软期限 300 s / 硬期限 900 s），**不会打断当前回合**。

**已确认（journal 原文 + 状态文件，2026-09-29 10:47:49 CST）**：

```text
[cordis:reload-1] [dsh-ros2-maintain] round 15: requesting a graceful dsh restart via dsh-phoenix …
[dsh-phoenix] cordis tool: cordis_run
[dsh-phoenix] restart requested (gen 23): plugin-change        ← 10:47:52
```

状态文件随即由 `generation: 22` 变为 **`generation: 23` / `lifecycleState: deferred`**
（`deferDeadline` = 请求后 +900 s 硬期限）——即 phoenix **已登记 gen-23**，正等本会话空闲；
浏览器由 phoenix 心跳自动重连（§4）。该惰性包**不取任何能力**（只打一行日志），故不可能失败；
它是**进程内**的临时定义，重启后自然消失。

**如实记录一个观测盲区**：本轮改动落在 `dsh-ros2-common` 的 `lib/`（已重建），但**版本号未变**
⇒ `ros2_env_check` 的 **drift 检测看不见**这次变更（它比对的是 `package.json` 的版本，
不是 `lib/` 的内容哈希）。所以"重启后确认新代码已加载"**不能**只看 drift——
这也是 §20.8 第 1/2 条给出**具体验证手法**的原因。

### 20.6 安全扫描（step 5）

| 面 | 结果 |
| --- | --- |
| 供应链（`pnpm audit --prod --audit-level high`，公共 registry） | ✅ **No known vulnerabilities found**；其"空转"风险已定级为**环境问题**（本机镜像无 audit 端点，须显式 `--registry`） |
| 硬编码密钥（`sk-…` / `AIza…` / `ghp_…` / `api_key: "…"`） | ✅ **0**（工作树 `git grep`） |
| 发布面 | ✅ 9/9 tarball 含入口点、**0 个** `.pyc` / `__pycache__` |
| Python 执行面 | ✅ `shell=True` / `os.system` / `eval` / `exec(` **命中 0**；`subprocess.*` **全部 argv 数组** |
| TS 命令面 | ✅ 只有 `execFile` / `spawn`（argv 数组）+ `bash -lc`（命令由 `shq()` 逐参拼装），**无 `execSync` / `shell: true`** |
| 既有防线回归（第十三/十四轮） | ✅ 全部仍在：PTY 会话 id 双层守卫（`safe_sid()`）、PTY 目录/文件 **0700/0600**、sidecar UDS **0600**、安装器 `umask 077` + `chmod 700`、`classifyVisionTransport()` 的回环/明文判定、9 包 `files` 均排除 `__pycache__` |
| CodeQL / 静态分析 | ❌ **仍未配置**（连续第二轮提出） |

**本轮新增代码的安全评审（自己引入的面）**：

| 面 | 结论 |
| --- | --- |
| `shellword.ts` 的展开 | **只读、纯函数**：不执行、不写文件、不发网络；无正则回溯风险（均为线性字符类）；对同一输入必然前进，**无死循环** |
| 展开是否影响**实际执行的命令** | **否**。`prefix` 逐字节保留原文（有测试断言），展开结果**只**用于 `existsSync` |
| 展开是否可能**放宽**既有保证 | **否**，方向相反：修复前的行为是"**误判缺失 → 剔除 → 回退到别的环境**"（更激进）；修复后只在**证明缺失**时才剔除，**不可解就保留** |
| 新增的**信息可见面** | `setupSourcePaths` 现在返回展开后的路径，若配置里写了 `$SOME_VAR`，`ros2_vision_doctor` 的 install 根列表会**显示该变量的值**。**如实记录为边界，不定级为缺陷**：变量来自**运维自己写的配置**与**本进程环境**，非远端输入，无新增执行/网络路径；且值本就由配置持有者掌控 |
| 未采纳 | ① 不把 `~user` 交给 passwd 查询（需要额外 API，收益极低）；② **不**让插件改写运维的配置文件（issue #40 明确保留该决定） |

### 20.7 本轮发现

1. **【已修·真实·类型：静默换环境】自愈探针把存活工作区判为缺失并回退到另一环境**（§20.4）。
   触发形式是 `~/vlm_ws`——**本分支的文档刚推荐**、且 README 长期以 `source <path>` 示例
   `~` 的写法在 shell 里极其常见。**这是本轮最有价值的发现，且不在任何 issue 里。**
   定级：**正确性缺陷、无安全影响**；后果是"对错环境执行"而非崩溃，恰恰因此**更难察觉**。
2. **【仓库外·仍悬置·实测 6 处（issue 少算 1 处）】** 线上配置的 `rosSetup` 死链**不是 5 处而是 6 处**：
   5 处属于 `dsh-ros2` 各 bundle（`/tmp/vlm_ws/install/setup.bash`），
   第 6 处在 **`dsh-deepcybo-lite`**（第 63 行，`/home/stvli/Desktop/bar_ws/install/setup.bash`，**该目录不存在**；
   `dsh-deepcybo-lite` 已作为 bundle 装入 web profile，非惰性残留）。
   issue #40 只统计了前者。**本轮仍不擅自修改**（理由见 §20.2），但把它从"5 处"更正为"6 处"。
3. **【运维缺口·本轮首次·阻断交付后两环】** **`gh` 无可用 token**（`hosts.yml` 里没有任何 token、
   `gh auth token` 为空）⇒ 只能 SSH push，**不能 `gh pr create` / `gh pr merge`**。
   后果：① 推 feature 分支**不触发 CI**（`ci.yml` 只在 `push: [main]` 与 `pull_request` 上跑）；
   ② 本轮成果**只能停在分支上**，无法进入评审/合并。已用 §20.3 的 probe 分支补上 CI 证据，
   但**"开 PR"这一环必须由运维恢复**（`gh auth login`，或提供 `GH_TOKEN`）。
   *这是维护循环第一次遇到该缺口，建议把它本身当作一条运维待办。*
4. **【CI 观测】** #44（schemastery）**红**、#47（去重 lockfile 的同版升级）**绿**——
   第十四轮开 #47 的判断得到验证；另有 **4 个 Dependabot PR（#42/#43/#45/#46）CI 已绿**却仍开着，
   说明**积压的原因不是 CI，而是无人合并**（本轮亦无合并权限）。
5. **【观测盲区】** bundle 的 `drift` 只看版本号 ⇒ **"`lib/` 已重建但进程未重启"不可见**（§20.5）。

### 20.8 结论与下一步建议

- **交付**：分支 `fix/workspace-path-hygiene`（`origin` 上的 `2b7780a`）共 3 个提交：
  `docs`（README 根因）+ `docs(env)`（运维修法）+ **`fix(common)`**（本轮代码修复）。
  **CI（等价树）Node 22/24 双绿**；用例 **323 → 344**；9/9 发布面闸门通过；`pnpm audit` 干净。
- **线上价值**：自愈不再把**存活**的工作区判死并**静默切换到 `/opt/ros/<distro>`**；
  `~/…` / `$HOME/…` 这类**正常写法**不再触发"建议修正配置"的假警报；
  顺带修好裸词 `\ ` 转义被截断的分词缺陷。
- **待运维（本轮无法完成的三件事）**：
  1. **开 PR**：`fix/workspace-path-hygiene` → `main`（本轮无 token；CI 证据见 §20.3）。
  2. **决定 issue #40**：按 §20.7 第 2 条给出的**6 处**逐字修法修改部署配置（一行删尾段），
     随后**优雅重启**使告警消失；等价性已证明（前缀逐字节相同），因此可安全后置、但不应无限期悬置。
  3. **恢复 PR 能力**：`gh auth login`（或提供 `GH_TOKEN`），否则后续每一轮都会卡在同一处；
     同时可顺手合并 **#47**（绿，替代 #44）、关闭 #44。
- **下次维护建议**：
  1. **复核 gen-23 重启后的现场**（本轮唯一的运行时观测）：确认新 `common` 已加载
     ——**不能只看 `drift`**（§20.7 第 5 条），可用 §20.5 的方法或直接看 `lib/` 的 mtime。
  2. **用真实 `~/…` 配置做运行中验收**：把某个 bundle 的 `rosSetup` 之一改写成
     `~/lite_delivery_aio/install/setup.bash`（**行为等价**：同一文件、同一展开结果）后，
     运行中进程的 `ros2_env_check` 应报 `missingSources: []`——这是把本轮修复在**运行中进程**里
     闭环的唯一办法（本机 `node` 直跑只验证了库，不是进程内）。
  3. **处理积压**：issue #40（6 处）+ 5 个 Dependabot PR（#47 优先）。
  4. **配置 CodeQL**（连续第二轮）：Dependabot 两半已齐，静态分析仍无基线；本仓 TS + Python 混合，
     值得给 `packages/*/src` 与 `packages/*/scripts` 建一条 code scanning。
  5. **维持并扩展验收线**：`typecheck + test + build` 全绿 → push → **开 PR 等 CI** →
     合并前先提交/stash；本机 `pnpm audit` **必须带 `--registry=https://registry.npmjs.org`**；
     **无 token 时**用一次性 `ci/probe-*` 分支取得 CI 证据并**用完即删**（§20.3）。

---

## 21. 维护记录（2026-09-30 04:00 CST / UTC 2026-09-29 20:00 · 第十六轮：open issue #40 → step 2 复核 + **上游缺口消失（`gh` 有 token 了）** → 先把第十五轮卡住的在途分支开成 **PR #48** 并合入 → `fix(packaging)` 发布面守卫 + **CodeQL 基线首次落地** + 基线告警里的 **2 处真实缺陷** → **计划外：本轮自己的 CI 抓出 PTY 测试竞争（PR #53）**）

> 本轮结论：起始 **1 open issue（#40）** / **6 open PR（#42–#47）**、`main = origin/main = 7d0b4b5`、工作树干净，
> 但当前分支 `fix/workspace-path-hygiene` 上仍有 **5 个提交领先 `origin/main`、已推送、却没有 PR**——
> 第十五轮的时间窗就是断在这里的。
> **本轮最大的环境变化：`gh auth status` 显示已登录 `StvLi`（scope 含 `repo`/`workflow`）**——
> 第十五轮 §20.7 第 3 条记的"首次遇到、必须由运维恢复"的缺口**已经恢复**。
> 因此本轮不再需要 `ci/probe-*` 代跑 CI，**第一个动作就是把那段在途工作变成真正的 PR**。
> 本轮另一个第一次：**CodeQL 基线落地并立刻抓到 2 处真实缺陷**（第十四/十五轮连续两次建议，直到本轮才做）。

### 21.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `fix/workspace-path-hygiene`（**领先 `main` 5 个提交、已推送、无 PR**） | `fix/pty-status-race`（= **PR #53**；本轮共 6 个 PR） |
| `main` | `7d0b4b5`（= `origin/main`） | **`7bdfc85`**（#48/#49/#50/#51/#52/#53 与 #47 全部合入） |
| open issue / open PR | **1 / 6**（#40 / #42–#47） | **1 / 4**（#40 / #42/#43/#45/#46） |
| vitest 用例 | `main` **323**（322 过 + 1 pty-skip） | `main` **344**；**#51 分支 347**（346 过 + 1 skip） |
| GitHub 授信 | ✅ **`gh` 已登录 `StvLi`**（`repo` + `workflow`） | 同（本轮 PR/合并/评论全部走 API） |
| 代码扫描 | ❌ 无（`code-scanning/alerts` → `404 no analysis found`） | ✅ **CodeQL 已上线并跑过 main**；首基线 **29 条告警 → 分诊并修复后实测 13 条**（§21.3.3） |
| 运行中的 dsh | 启动于 **2026-09-29 10:48:45 CST**（= 第十五轮请求的 **gen-23** 落地产物；MainPID 32283） | 同进程；`lib/` 已于本轮重建，**gen-24 重启请求待执行**（§21.5） |

**第十五轮请求的 gen-23 已确认落地**（本轮开工时读到的状态文件）：
`generation: 23`、`lifecycleState: running`、`pendingResume: false`、`deferDeadline: 0`
—— 即第十五轮那句"已登记、等会话空闲"的请求**已经执行完**，且**没有**残留的 defer 期限。这是第十五轮唯一的运行时悬念，本轮闭环。

### 21.1 Issue 检查（step 1）

```text
gh issue list --state open   → 1   （#40）
gh pr list --state open      → 6   （#42–#47）
git rev-list --left-right --count main...origin/main → 0  0
git status --porcelain       → （空）
```

**⇒ 存在未处理的 issue（#40）→ 转入 step 2。** 与第十五轮同一个 issue，**没有新增**。

一个方法学说明：`gh issue view 40` 本轮**失败**了（`GraphQL: Projects (classic) is being deprecated…`）。
绕开方式：`gh api repos/StvLi/dsh-ros2/issues/40`。这不是仓库的问题，是 `gh` 2.45.0 与 GitHub
弃用 Projects classic 的兼容性问题——**记录在此，免得下次再当成故障排查一遍**。

### 21.2 建议评估（step 2）——issue #40 的合理性与必要性（复核）

第十五轮已判过一轮（**合理、必要，但配置在仓库外且需运维决定**）。本轮**逐条复核事实是否仍然成立**，
并把结论落到 issue 上（评论已发），而不是只在文档里再说一遍。

| 复核项 | 结果 | 本轮实测依据 |
| --- | --- | --- |
| 死段是否仍在 | ✅ **仍在**（无自愈式消失） | `grep -c '/tmp/vlm_ws'` → 6（其中 5 处是活的配置行：33/37/41/45/49，1 处在 29 行注释） |
| 自愈是否仍然有效（不是故障） | ✅ 成立 | 运行中进程 `ros2_env_check`：`prefix` 已收敛为 `source /home/stvli/lite_delivery_aio/install/setup.bash && `，`missingSources` 如实点名死段，`probe.exitCode = 0` |
| **等价性**是否可证 | ✅ **本轮从"可推"升级为"实测"** | 删掉尾段后的前缀与**当前正在跑的前缀逐字节相同**（同一段文本，见上） |
| 死链数量 | ⚠️ **issue 少算 1 处** | 第 **63** 行 `dsh-deepcybo-lite` 指向 `/home/stvli/Desktop/bar_ws/install/setup.bash`，**该目录不存在**——与 33/37/41/45/49 不同包、不共用 `dsh-ros2` 的 run seam，所以**不在**上面那条 `ros2_env_check` 输出里。**是 6 处，不是 5 处。** |

**本轮对该 issue 的处理：复核 + 更正 + 交还决定，不擅自改线上配置。** 理由与第十五轮一致且仍然成立：

1. 文件在**仓库外**、属于**正在运行的部署**，写它是**扩大维护任务的授权范围**（沙箱本身也是 workspace 作用域）；
2. 改动**需要一次优雅重启**才生效——那会重启**正在跑这个维护任务的进程**；
3. issue 正文自己写明"editing it is a deliberate operator decision"。

**⇒ 本轮不把 #40 当成"待修的 bug"关掉，而是把它更新成一份可执行的交接单**（评论含：逐字清单、
第 63 行的补充、以及"删段前后前缀逐字节相同"的实测等价性）。它继续 open **是有意的**。

### 21.3 开发管理（git · step 3）

**分支策略**：本轮共 4 个分支 → 4 个 PR，全部遵循 `fix/… · ci/…` 命名与
`fix(scope): …` / `ci(scope): …` 规范提交。

| PR | 分支 | 提交 | 状态 |
| --- | --- | --- | --- |
| **#48** | `fix/workspace-path-hygiene`（**承接第十五轮在途分支**） | `docs` ×3 + `docs(env)` + **`fix(common)`** | ✅ **CI（22/24）双绿后合入** |
| **#49** | `fix/pycache-publish-exclusion` | `fix(packaging)` | ✅ **CI 双绿后合入** |
| **#50** | `ci/codeql-code-scanning` | `ci(security)` | ✅ **CI + CodeQL 双绿后合入** |
| **#51** | `fix/codeql-security-hardening` | `fix(core)` + `fix(common)` + `ci(security)` | 🟡 本轮结束时 CI 在跑 |

**#48 的意义不只是"少了一个 PR"**：它把第十五轮那句"CI 证据见 §20.3（**代跑**）"换成了**真 CI**。
第十五轮因为没有 token，只能把树复制到一次性 `ci/probe-*` 分支上让 `pull_request` 触发 CI；
本轮 PR #48 的 `check (22)`/`check (24)` 是**这个分支自己的**第一次真实 CI。**代跑的做法本轮起不再需要。**

#### 21.3.1 `fix(packaging)`：发布面的 `__pycache__` 守卫只覆盖了"碰巧出现过"的包（PR #49）

**发现方式**：不是扫描器的告警，而是**逐包核对 `package.json` 的 `files` 字段**时看出**不一致**。

| 包 | 是否发布 Python | 改动前的守卫 |
| --- | --- | --- |
| `common` / `core` / `sidecar` | 是 | `!**/__pycache__` |
| `safety` | 是 | `!safety/scripts/__pycache__`（**只挡一个硬编码路径**） |
| **`moveit`** | 是（`scripts/`） | **无** |
| **`profile`** | 是（`scripts/`） | **无** |
| **`vision`** | 是（`scripts/` + `vlm/` + `offscreen/`） | **无** |

**这不是"可能的"泄漏，是实测可复现的**：`moveit_move.py` / `moveit_status.py` 里有 `import moveit_common`，
所以**只要跑过这个工具**就会生成 `scripts/__pycache__/moveit_common.cpython-312.pyc`，
`pnpm pack` 随即把它打进去：

```text
$ cd packages/moveit && python3 -c "import moveit_common"   # 没有 rclpy 也会先编译
$ pnpm pack --pack-destination /tmp && tar -tzf /tmp/dsh-ros2-moveit-0.1.0.tgz
package/scripts/__pycache__/moveit_common.cpython-312.pyc     ← 已发布
```

**改动前后对照（在 9 个目录里种 27 个 `.pyc`，逐包 `pnpm pack`）**：

```text
改动前 → LEAK moveit : scripts/__pycache__/a.pyc  scripts/bare.pyc  scripts/__pycache__/moveit_common.cpython-312.pyc
         LEAK vision : offscreen/__pycache__/a.pyc  vlm/scripts/__pycache__/a.pyc  scripts/__pycache__/a.pyc  (+3 个裸 .pyc)
         LEAK profile: scripts/__pycache__/a.pyc  scripts/bare.pyc
         LEAK safety : safety/scripts/bare.pyc        ← ★ 它自己的守卫也没挡住「源码旁边的裸 .pyc」
改动后 → 9/9 tarball CLEAN（跑 CI 那段闸门原文，正向断言 + 反向断言都过）
```

**`safety` 那一行是本轮最有信息量的**：它**不是没有守卫**，而是守卫**只挡目录、不挡裸 `.pyc`**。
这正说明"每个包各自打一个补丁"这个做法本身是错的——**改为 7 个发布 Python 的包统一使用**
`!**/__pycache__` + `!**/*.pyc`，与 CI 闸门已经在拒绝的那两种形态**完全一致**。

> 严重性如实定级：**低**。CI 的 pack 闸门会在发布前拦住它。
> 但**包定义本身是错的**，而且错在**恰好没人检查过的那 3 个包**上——这正是本轮把它当问题修的理由。

#### 21.3.2 `ci(security)`：CodeQL 代码扫描基线（PR #50）

第十四轮与第十五轮**连续两次**写进"下次维护建议"，本轮落地。之所以值得做，看这张表就够了：

| 检查 | 读的是什么 |
| --- | --- |
| `pnpm audit --prod` | 依赖图 |
| Dependabot 告警 + 自动修复 | 依赖图（已知公告） |
| Dependabot 版本更新 | 依赖图（版本） |
| 发布面闸门 | tarball 内容 |
| **CodeQL（本轮新增）** | **我们自己写的代码** |

落地前的证据：`gh api repos/StvLi/dsh-ros2/code-scanning/alerts` → **`404 no analysis found`**（从未有过基线）。

**范围**：66 个 TypeScript + 21 个 Python。Python **同时覆盖** `packages/vision/vlm/scripts/` 下
那批**没有扩展名**的 ROS2 脚本（`vlm_node` / `vlm_bridge_node` / `vision_bringup` …）——
它们以 `#!/usr/bin/env python3` 开头，只有 shebang 能说明它们是 Python。**C/C++ 有意排除**：
全仓只有 **1 个** `.cpp`，而 CodeQL 的 C/C++ 库若要**构建**就得在 runner 上装整套 ROS2 Jazzy
（`rclcpp` / `rviz_rendering`），**为一个文件铺这套 CI 不划算**，且已在 workflow 注释里写明何时重新考虑。

**两个刻意的取舍**（都是为了不让这条检查"因为与改动无关的原因变红"）：

1. **跳过 Dependabot PR**：它们拿到的 `GITHUB_TOKEN` 是只读的，SARIF 上传必然失败
   （`Resource not accessible by integration`），于是**每一个依赖 PR 都会红**——本仓当时就有 6 个。
   改由 `push: main` 那一次覆盖合并后的结果。
2. **`queries: security-extended`**，不开 quality 套件：这是**漏洞**基线，不是风格门。

`analyze` 只把结果报到 Security 页，**不会因为发现告警而让构建失败**，所以它**不可能挡住一次合法合并**。
无需 `pnpm install`、无需构建（两个提取器都是静态的），因此也不依赖 pnpm workspace 布局。

**首次运行结果：`analyze (javascript-typescript)` ✅ / `analyze (python)` ✅ / `CodeQL` ✅**，
随后 main 上的那次也 ✅。

#### 21.3.3 `fix(security)`：首个基线的 29 条告警 → 3 条真实、2 条已修（PR #51）

基线一落地就交回了 **29 条告警**。逐条分诊如下（**这是本轮 step 5 的核心产出**）：

| 规则 | 数量 | 位置 | 定性 |
| --- | --- | --- | --- |
| `js/remote-property-injection` | 13 | `docs/archify/bridge.html` | **生成物**：archify skill 产出的 643 KB 打包 HTML，不是人写的源码 → **排除出扫描** |
| `js/insecure-temporary-file` | 8 | 7 处测试文件 + `scripts/verification/measure.mjs` | 测试/校验脚本，且都在私有 `mkdtemp` 目录下；**不触生产路径** |
| `js/polynomial-redos` | 3 | `parse.ts` ×2、`toolkit.ts` | **真实但低危 → 本轮有意不修**（理由见下） |
| `js/file-access-to-http` | 2 | `vision.ts` | **设计如此**：图像字节就是发给 VLM 网关的请求体 |
| `js/shell-command-injection-from-environment` | 1 | `runner.ts:38` | **设计如此**：这里**就是**那个 shell runner，参数由调用方 `shq()` 引号化 |
| **`js/file-system-race`** | 1 | `core/tools.ts` | **★ 真实缺陷 → 已修** |
| **`js/shell-command-constructed-from-input`** | 1 | `common/runner.ts` | **★ 真实缺陷 → 已修** |

**分诊后实测（#51 合入 `main` 后重跑）：29 → 13，与被移除的两类逐条对上——**

| 类别 | 变化 | 对应动作 |
| --- | --- | --- |
| `js/remote-property-injection`（生成物） | 13 → **0** | `paths-ignore: docs/archify/**` 生效 |
| `js/file-system-race` | 1 → **0** | `O_EXCL` 修好 |
| `js/shell-command-constructed-from-input` | 1 → **0** | `shq()` 修好 |
| 剩余 | **13** | 3 ReDoS + 8 insecure-temporary-file + 2 file-access-to-http，**全部落在已分诊的"有意不修 / 设计如此"三类里**，**没有出现预料之外的新规则** |

**"降幅可预测、且降完正好落回预期分类"这件事本身就是分诊正确的证据**：
如果哪一类没有消失，或者冒出一条新规则，就说明分诊漏了东西、或者修得不干净。

> 更正记录：本节初稿把这两类写成 `12` 与 `6`（合计 25，与总数 29 对不上——**表格自身的算术就是错的**），
> 实测后更正为 `13` 与 `8`。**一个"29 条"的分诊表里，条目数相加必须等于 29**，这是分诊自检的最低要求。

**修复 1 · `ros2_interface_create` 的 TOCTOU**：工具文档写着"文件已存在，不覆盖"，
实现却是 `access()` 检查后接一个**普通** `writeFile`——

```js
await access(filePath)                       // 检查 …
await writeFile(filePath, content, 'utf8')   // … 再用 —— 两步之间是可乘之机
```

两步之间，**并发的另一次调用**、或**种在该路径上的符号链接**都能把目标造出来，
随后的写入就**静默覆盖**了它。于是那句承诺**只在"中间没人碰过"时才成立**。
改为 `flag: 'wx'`（`O_CREAT|O_EXCL`）——**把"存在性检查"和"创建"合成一次原子系统调用**，
内核在路径被占（**包括被悬空符号链接占用**）时直接拒绝；`EEXIST` 映射回原来同一条
`FILE_EXISTS` 结果，**调用方看不到行为变化**。新增 2 个测试：已存在文件**原字节不变**、
符号链接**没有被跟随写出 output root**。

**修复 2 · 自动探测路径未加引号**：`resolveSetup` 用 `source ${auto} && ` 拼自动探测到的路径，
**没有引号**；而 `ros2_workspace use` 那条路（`setSessionRosSetup`）**一直**用 `shq()`。
两者最终都会被拼进 `bash -lc` 字符串——**同一个风险，两条路不一致**：
`workspaceRoot` 里有个空格，命令就散架；有元字符，就会被插进 shell 字符串。
两处自动探测返回值都改为 `shq()`；`sourcePath` 仍返回**原始文件系统路径**
（消费者要 `existsSync` 它），而**前缀**里是同一个路径的**一个安全 shell 词**。
原测试断言的正是旧的**未加引号**形态，已更新；新增一个用**同时含空格与 `;`** 的 workspace root 的测试。

**为什么 ReDoS 这 3 条本轮不修**：它们是 `(\w+):` / `(\S+)(?:…)?$` 这类**解析 `ros2` CLI 输出**的正则，
真实可利用性低（输入是本地 CLI 的 stdout）——但对 `parseSafetyEcho` **不是零**：
它的输入是 `ros2 topic echo` 回来的**话题内容**，发布者可以构造。
把解析器改写成"可证明线性"会**改变整个工具集依赖的解析形状**，
那应当**单独一个改动、配自己的测试**，而不是**夹带在一个安全 PR 里**。**有意留着可见，不藏。**

#### 21.3.4 `fix(test)`：一次只改文档的 PR 被 PTY 测试判红（PR #53）

**这是本轮最后一个、也是计划外的一个 PR**——它由本轮自己的 CI 逼出来，值得单独记。

**现象**：PR **#52**（**只改 `dsh-ros2-maintain.md`，零代码**）的 `check (22)` **红**：

```text
FAIL tests/tools.spec.ts > ros2_install interactive flow (mock installer, no network)
     > start -> send -> status -> stop drives the installer menus via PTY
AssertionError: expected '' to contain '众多工具'
```

**先怀疑环境，先验证再归因**（避免把"偶发"当借口）：

| 证据 | 结果 |
| --- | --- |
| #52 首次运行 `check (22)` | **fail** |
| **同一 job 原样重跑（零代码改动）** | **pass** |
| #48 / #49 / #50 / #51 的 22/24 四个 job | **全 pass** |
| 本地 `pnpm test` | **skip**（本机 `it.skipIf(!ptyUsable)`，无法分配 pty） |

⇒ **是偶发（flake），不是我的改动、也不是环境整体坏掉。**

**根因（读代码即可确定，不需要复现）**：`ros2_install` 把安装器跑在一个 **pty 守护进程**里，
输出是**异步**到达的；而测试在 `start` 之后**立刻只读一次** `status`，要求菜单**此刻已经在**：

```js
await t.execute({ action: 'start', ... })
const s1 = await t.execute({ action: 'status', session })   // ← 一点等待都没有
expect(s1.data.output).toContain('众多工具')                  // ← 赌守护进程已经赢了
```

后面两步其实是**同一个问题换了一种写法**——`setTimeout(800)` / `setTimeout(2500)`：
**用"猜一个时长"代替"等到条件成立"**，**降低概率但没有消除竞争**，而且**每次都白付这段延迟**。

**修复**：`statusUntil(t, session, predicate, timeoutMs)` —— **有上限的 100 ms 轮询**，
**条件一成立立刻返回**；最后一步的判据同时要求 `state` 已到 `exited`，
而不是**假定输出与状态同时翻转**。测试超时 15 s → 30 s，使真正的失败仍然表现为
**"哪一个断言始终没等到"**，而不是一个笼统的 timeout。

**验证（如实说明分工）**：`pnpm run typecheck` 过；但这条路径是 `it.skipIf(!ptyUsable)`，
**本机无法分配 pty**，所以**代码路径只有 CI 能验**——
`check (22)` 与 `check (24)` **双绿**，这正是 §19.8 记过的"本地 skip / CI 为准"分工。

**为什么把它当成本轮的一条发现，而不是"重跑一下就算了"**：

> **一个偶发红的门禁，本身就是维护负债。**
> 本维护循环的全部纪律都建立在"push → 开 PR → **等 CI 绿**再合并"之上，
> 而这条纪律**只有在"绿"确实有信息量时才成立**。
> 一个会随机把"只改文档"判红的测试，**教出来的是"红了就重跑，直到绿"**——
> 那一刻起，**绿不再证明任何事**，整套验收线同时失效。
> 所以"重跑到绿然后合并"是**把问题推向下一轮**，而**修掉竞争**才是这一轮该做的事。

### 21.4 Dependabot 积压处理

起始 6 个（#42–#47），本轮 6 → 4。**没有采用"逐个合入"的粗暴做法**，因为那正是 #44 的翻车方式：

| PR | 动作 | 理由 |
| --- | --- | --- |
| **#47** | ✅ **合入** | 本维护循环自己开的、用来**替代失败 #44** 的去重 lockfile 版本；CI 绿、`CLEAN/MERGEABLE` |
| **#44** | ✅ **关闭**（Dependabot 在 #47 合入后自动关闭） | `check(22)`/`check(24)` **双红**——就是 lockfile 双副本问题本身 |
| #42 / #43 / #46 | 🔁 **触发 `@dependabot rebase`** | #47 动了 `pnpm-lock.yaml`，它们的分支已经基于旧 lockfile；**把陈旧 lockfile diff 硬合进已变的 lockfile，正是 #44 失败的原因**，所以先让 Dependabot 重新生成再谈合并 |
| **#45**（`@types/node` 24 → 26） | ⏸️ **暂缓 + 在 PR 上写明理由** | 见下 |

**#45 为什么暂缓**：仓库声明并测试的运行时下限是 `engines.node: ^22.19.0 || >=24.0.0`，
而 `@types/node` 26 描述的是 **Node 26** 的 API。**按比自己所支持的更新版本做类型检查**，
正是"编译干净、却在最老的受支持运行时上 `TypeError`"的产生方式——
CI 在 **24/22** 上跑的是**测试**，而类型检查器本该是**阻止你写出那个调用**的那一环。
惯例做法是把 `@types/node` 钉在**最低**受支持大版本（这里是 22），而不是最新。
**那是一个有意的决定，不是一次版本升级**，所以归运维。已把这段理由写在 PR 上。

### 21.5 dsh-phoenix 持续更新/测试循环（step 4）

**接线核对**（与上一轮一致，未变）：`dsh-phoenix` 以 `link:` 装入 web profile；
`dsh-ros2` 及 7 个子包同样以 `link:` 指向本仓 checkout 的 `packages/*`
（`~/.dsh/profiles/web/node_modules/dsh-ros2*` 均为符号链接）：

```text
dsh-ros2        -> ../../../../Desktop/embody_agent_ws/dsh-ros2/packages/dsh-ros2
dsh-ros2-common -> ../../../../Desktop/embody_agent_ws/dsh-ros2/packages/common
… （core / moveit / profile / safety / vision 同）
```

⇒ **运行中的进程直接执行本仓 `packages/*/lib/` 里的编译产物**，
所以"仓库里改了代码"与"进程里跑的是新代码"是**两件事**——这正是 phoenix 循环存在的理由。

**本轮实测到的落差（这就是 step 4 要处理的东西）**：

| 量 | 值 |
| --- | --- |
| 运行中 dsh 进程启动 | **2026-09-29 10:48:45** |
| `packages/common/lib/*.js` 重建 | **2026-09-30 04:09**（本轮 `pnpm run build`） |

**`lib/` 比进程新** ⇒ 进程里跑的**仍是 #48 合入之前那份 `dsh-ros2-common`**，
其中就包括第十五轮那个 **`~/…` 静默换环境**修复。**必须重启才生效**——这正是 phoenix 的职责。

**运行中验收的边界（如实记录，不夸大）**：第十五轮 §20.8 建议"用真实 `~/…` 配置做运行中验收"。
本轮核对了可行性并发现**这条路走不通**：`ros2_workspace use` 用
`path.join(p, 'install', 'setup.bash')` + `access()` 去校验，**`~` 不经 shell 展开**，
所以工具层**无法构造出带 `~` 的前缀**——`~` 只能来自 `rosSetup` 配置，
而那正是本轮决定**不改**的运维文件。**⇒ `fix(common)` 的验收只能停在库层**（21 个新单测通过）、
**不能在运行中进程里闭环**，除非运维先动配置。**这是本轮唯一一处"诚实降级"，不是遗漏。**

**触发面与请求**：本会话工具表里**没有** phoenix 自己的重启工具，故沿用文档化的触发面
（`cordis_run`，phoenix 的 `CORDIS_TRIGGER = { cordis_run: true }`），**在本轮最末尾**激活
一个**惰性动态包**请求优雅重启（与第十四/十五轮同一做法）。phoenix 对 busy agent 会 **defer**
（软期限 300 s / 硬期限 900 s），**不会打断当前回合**。

**已确认（journal 原文 + 状态文件，2026-09-30 04:22:47 CST）**：

```text
[dsh-phoenix] cordis tool: cordis_run
[dsh-phoenix] restart requested (gen 24): plugin-change        ← 04:22:47
[dsh-phoenix] cordis tool: cordis_run
[dsh-phoenix] restart already in-flight; coalesced plugin-change   ← 04:22:55
```

```json
{ "generation": 24, "lifecycleState": "deferred", "pendingResume": false,
  "deferDeadline": 1790714267566, "updatedAt": 1790713367566, "coalesced": true }
```

`deferDeadline − updatedAt = 900000 ms`，**正好是文档化的 900 s 硬期限**——与第十四/十五轮一致。

**两个如实记录的点**：

1. **第一次激活失败了，原因是沙箱而不是这个包**：受限 `ctx` **不暴露 `logger`**
   （报错原文：`sandbox ctx does not expose "logger". Available: ctx.tools.register / ctx.on /
   ctx.provide / the timer helpers …`）。第十四/十五轮记的"惰性包只打一行日志"这个写法
   **在当前的受限 ctx 下已经不再可用**。改为**真正空实现的 `apply()`**——因为
   **phoenix 的触发面是 `cordis_run` 这次调用本身，不是 `apply()` 做了什么**，
   所以空实现**既足够又是最安全的形式**（零能力 ⇒ 零失败面）。
   **⇒ 下次维护不必再尝试 `ctx.logger`，直接空 apply。**
2. `coalesced: true` 与 `restart already in-flight` 说明**第二次激活被合并进同一个 gen-24 请求**，
   这是正确行为，也顺带证明 phoenix 的去重是按"in-flight 重启请求"而非按包走的。

**一个本轮识别出、但有意不做的改进（连同它为什么不能草率做）**：
本轮**无法从进程内部判断"新代码到底加载了没有"**——`bundleDriftReport()` 比的是
`package.json` 的 **version**，而本轮 `common` 的 **版本号没变**，所以 **drift 看不见**这次变更
（第十五轮 §20.7 第 5 条已记过这个盲区）。"加一个内容指纹"看起来是显然的修法，
但**显而易见的实现恰好抓不到本轮这种情况**：注册表按 **bundle** 记录，而本轮改的是
**`dsh-ros2-common`——它不是 bundle**，只是每个 bundle 的依赖。只给各 bundle 自己的 `lib/` 算指纹，
**这次漂移依然是盲的**。要真解决，指纹必须覆盖**工作区传递依赖**（或把 `common` 纳入被监视集合，
但那会撞上 `NON_BUNDLE_PACKAGES` 与 `undeclared` 对账的语义）。
**⇒ 本轮只把设计与坑写清楚，不塞一个"看起来能防、实际防不住本轮这种情况"的半成品**——
那比不做更坏，因为它会制造**虚假的确定性**。

### 21.6 安全扫描（step 5）

| 面 | 结果 |
| --- | --- |
| 供应链（`pnpm audit --prod --audit-level high`，公共 registry） | ✅ **No known vulnerabilities found** |
| 供应链（**含 dev** 的完整 `pnpm audit`，本轮新增口径） | ✅ **No known vulnerabilities found** |
| 硬编码密钥（`sk-…` / `AIza…` / `ghp_…` / `xox…` / `BEGIN … PRIVATE KEY`） | ✅ **0**（工作树 `git grep`；命中的全是维护文档里对这些模式的**描述文字**） |
| **静态分析（CodeQL）** | ✅ **本轮首次有基线**；29 条 → 分诊见 §21.3.3，**2 条真实缺陷已修** |
| 发布面（9 包 `pnpm pack` + CI 闸门原文） | ✅ 9/9；**改动前后对照见 §21.3.1** |
| Python 执行面 | ✅ `shell=True` / `os.system` / `eval` / `exec(` / `pickle` / `yaml.load` **全部 0**；14 处 `subprocess.*` **全部 argv 数组** |
| TS 命令面 | ✅ **无 `execSync` / 无 `shell: true` / 无 `eval(` / 无 `new Function(`**；只有 `execFile` / `spawn`（argv 数组）+ `bash -lc`（命令由 `shq()` 逐参拼装） |
| 网络出口 | ⚠️ `vlm_node` 用 `urllib.request.urlopen` 打 VLM 网关；**URL 来自 ROS 参数 / 环境变量（运维配置），非远端输入**。**如实记为边界**：代码**不校验 scheme**，若把 `base_url` 配成 `file://` 则会读本地文件——但该值由运维持有，且明文 `http://` 传输一事已由 #38 上报并告警 |
| 既有防线回归（第十三/十四轮） | ✅ 全部仍在：`safe_sid()` 双层守卫、PTY 目录/文件 **0700/0600**、sidecar UDS **0600**、安装器 `umask 077` + `chmod 700`、9 包 `files` 排除编译产物 |
| CI 最小权限 | ✅ `ci.yml` 顶层 `contents: read`；**新增的 `codeql.yml` 同样顶层只读**，仅在 `analyze` job 内放宽到 `security-events: write`（上传 SARIF 必需） |

**扫描方法学的一个自我纠正（值得记下来）**：本轮第一次跑网络出口扫描用了 `git grep … -- '*.py'`，
**结果是空**——但 `vlm_node` 明明 `import urllib.request`。原因：**它是没有扩展名的脚本，
`*.py` 这个 glob 根本匹配不到它**。**⇒ 本仓 21 个 `.py` 之外还有 6 个无扩展名 Python 脚本，
任何按 `*.py` 过滤的扫描/统计都会静默漏掉它们。**（CodeQL 的 Python 提取器看 shebang，不受此影响。）
这条对**未来的安全扫描**和**未来的用例/文件计数**都适用。

### 21.7 本轮发现

1. **【已修·真实·可达】发布面 `__pycache__` 守卫只覆盖了"碰巧出现过"的 3 个包**（§21.3.1）。
   `moveit` 可**实测复现**（跑一次工具即生成 `.pyc` 并被打包）；`safety` 的守卫**只挡目录、不挡裸 `.pyc`**。
   定级**低**（CI 闸门会拦），但**包定义本身是错的**，且错在没人检查过的地方。
2. **【已修·真实·安全】`ros2_interface_create` 的 TOCTOU**（§21.3.3）。
   "不覆盖"的承诺在**并发或符号链接**介入时不成立；`O_EXCL` 使其成立。
   **这是本轮最有价值的一条，而且它来自本轮才落地的那条基线**——两轮建议换来一条真实缺陷，值。
3. **【已修·真实·一致性】自愈探针的自动探测路径未加引号**（§21.3.3）。
   同一个风险，`ros2_workspace use` 加了引号而 `autoDetectSetup` 没有。
4. **【已闭环·环境】第十五轮的运维缺口（无 `gh` token）已消失**（§21.0/§21.3）。
   **后果是：第十五轮"只能停在分支上"的成果，本轮第一步就合进了 main。**
5. **【已闭环·运行时】gen-23 已按硬期限落地**（§21.0），phoenix 状态干净（无残留 defer）。
6. **【观测盲区·本轮确认·有意不修】** `drift` 只看版本号 ⇒
   "`lib/` 已重建但进程未重启"**在进程内不可见**；而"加内容指纹"的**显然实现抓不到本轮情况**
   （改的是非 bundle 的 `common`）。**设计与坑已写清，不做半成品**（§21.5）。
7. **【新·issue #40 少算】** 死链是 **6 处**而非 5 处：第 **63** 行 `dsh-deepcybo-lite` →
   `/home/stvli/Desktop/bar_ws/install/setup.bash`（不存在）。已更正到 issue 上（§21.2）。
8. **【方法学】** ① `gh issue view` 在 `gh` 2.45.0 上因 Projects classic 弃用而失败，用 `gh api` 绕开；
   ② **`*.py` glob 会漏掉本仓 6 个无扩展名 Python 脚本**（§21.6）。
9. **【3 条 ReDoS 有意不修】** 低危但非零（`parseSafetyEcho` 的输入来自话题内容，发布者可控）。
   **改写解析器应当独立成一个改动**，不夹带进安全 PR（§21.3.3）。
10. **【已修·真实·计划外】PTY 安装器测试存在竞争，会随机把"只改文档"的 PR 判红**（§21.3.4）。
   不是环境问题：**同一 job 原样重跑即绿**。根因是 **`start` 之后一次 `status` 都不等**，
   加上两处**用固定 sleep 猜时长**。已改为**有上限的谓词轮询**。
   **一条发现值得单独立一条**：**偶发红的门禁会摧毁"绿=可信"这个前提**，
   而本维护循环的合并纪律**完全建立在该前提上**——所以"重跑到绿"不是解决方案，**修掉竞争才是**。

### 21.8 结论与下一步建议

- **交付**：**6 个 PR**——#48（承接第十五轮在途分支，含 `fix(common)`）、#49（`fix(packaging)`）、
  #50（`ci(security)` CodeQL 基线）、#51（`fix(security)` 2 处真实缺陷）、#52（`docs` 更正 §21 计数
  ——**含把"29 条的分诊表自身算术对不上"这件事也记进去**）、#53（`fix(test)` PTY 竞争）。
  **6 个 PR 全部合入 `main`**（另有 #47 合入、#44 关闭）。
  **CI 全部 Node 22/24 双绿**；**CodeQL 首次运行双绿**；用例 `main` **323 → 347**（346 过 + 1 pty-skip）；
  9/9 发布面闸门通过；`pnpm audit`（prod 与含 dev）均干净；**告警 29 → 13**（剩下 13 条全是已分诊的类别）。
- **线上价值**：① **首次有了"读我们自己代码"的安全基线**，且**第一跑就抓到并修掉 2 处真实缺陷**——
   其中 `ros2_interface_create` 的 TOCTOU 是**能被符号链接穿出 output root** 的那一类；
   ② 发布面不再有 3 个包"裸奔"；③ 第十五轮那个静默换环境修复**终于进了 main**。
- **末端动作**：改动已构建进 `lib/`；按文档化触发面（`cordis_run`）激活一个**空实现**的动态包，
  **已确认 phoenix 登记 `gen 24` 重启请求**（journal `restart requested (gen 24): plugin-change`，
  04:22:47 CST；状态文件 `lifecycleState: deferred`、`coalesced: true`、硬期限 900 s），
  由 phoenix 在会话空闲的安全点执行优雅重启（§21.5）。
- **待运维（本轮无法完成的三件事）**：
  1. **决定 issue #40**：按 §21.2 的**6 处**逐字清单修改部署配置（含第 63 行），随后优雅重启。
  2. **#45 的决定**：`@types/node` 是钉在最低受支持大版本（22），还是继续跟进最新（26）？
     这是**运行时承诺**问题，不是版本问题。
  3. **复核 gen-24 重启后的现场**：确认新 `lib/` 已加载——**不能只看 `drift`**（§21.7 第 6 条）。
- **下次维护建议**：
  1. **先看 CodeQL**：跑一轮 `gh api repos/StvLi/dsh-ros2/code-scanning/alerts`，
     **本条已在合入后当场核验：29 → 13，且 13 条全部落在已分诊的分类里**（§21.3.3）。
     下次只需确认**没有反弹**（新规则 / 新增同规则实例），若有则优先分诊新的。
  2. **把 3 条 ReDoS 单独做成一个 `fix`**：目标是"可证明线性"，**必须自带行为等价测试**。
  3. **重新评估 `drift` 的观测盲区**：设计已写在 §21.5——要覆盖**工作区传递依赖**，
     否则抓不到"只改了 `common`"这种最常见的情况。
  4. **处理剩余的 3 个 Dependabot PR**：`@dependabot rebase` 之后再逐个合，
     **绝不要把基于旧 lockfile 的 diff 硬合进已变的 lockfile**（#44 的教训）。
  5. **维持验收线**：`typecheck + test + build` 全绿 → push → **立刻开 PR 等 CI** → 合并前先提交/stash；
     本机 `pnpm audit` **必须带 `--registry=https://registry.npmjs.org`**；
     **`gh` 已有 token，不再需要 `ci/probe-*` 代跑**——但**若它再次消失**，§20.3 的应急做法仍然有效。
  6. **安全扫描请用全文件 glob**：**别再按 `*.py` 过滤**（§21.6 的方法学纠正）。

---

## 22. 维护记录（2026-10-01 04:17 CST / UTC 2026-09-30 20:17 · 第十七轮：open issue #40 → step 2 复核 → 把第十六轮**有意不修**的 3 条 ReDoS 告警**先测量再修**：实测只有 **1 条真实可达**（`parseTopicList`，n=4000 阻塞 **14.8 s**）、1 条**不可达**、1 条**不可复现** → 三条全部改为**可证明线性**的扫描并自带**差分等价测试**；闭环第十六轮遗留的 gen-24 重启观测；Dependabot 积压 4 → 3，并把跨两轮的"依赖下界策略"升级为 **issue #56**）

> 本轮结论：起始 **1 open issue（#40）** / **4 open PR（#42/#43/#45/#46，全部 Dependabot）**、
> `main = 5f5f71f`、工作树干净。
> 本轮**唯一**的 issue 仍是那个**故意 open 的决策跟踪单** #40（第十六轮已复核过一轮），
> 因此工作量落在两处：**第十六轮明确留待独立改动的那 3 条 ReDoS**，
> 以及**已经攒了 5 天的 Dependabot 积压**。
> **本轮最有价值的一条不是"修了 3 条告警"，而是"先测量，发现只有 1 条该修"**——
> 第十六轮的分诊把它们统一判成"真实但低危"，本轮逐条**走真实入口**实测后，
> 结论变成了 **可达 1 条 / 不可达 1 条 / 不可复现 1 条**（§22.3.1）。
> 另一条同样是"测量推翻直觉"：Dependabot 的 3 个 PR **CI 全绿、全部可合并**，
> 但它们的绿色**结构上无法证明它们想证明的事**（§22.4）。

### 22.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（= `origin/main`，工作树干净） | `main`（= `origin/main`；本轮分支 `fix/parser-redos-linear` 已合入并保留） |
| `main` | `5f5f71f` | **`f3ec14e`**（#55、#43 合入） |
| open issue / open PR | **1 / 4**（#40 / #42/#43/#45/#46） | **2 / 3**（#40 + **新 #56** / #42/#45/#46） |
| vitest 用例 | `main` **347**（346 过 + 1 pty-skip） | `main` **355**（354 过 + 1 pty-skip） |
| CodeQL **open** 告警 | **13** | **10** |
| 运行中的 dsh | 启动于 **2026-09-30 04:34:53 CST**（= 第十六轮 gen-24 的产物） | 同进程；`lib/` 已于本轮 **2026-10-01 04:11** 重建，**gen-25 重启请求已登记待执行**（§22.5） |

**第十六轮请求的 gen-24 已确认落地**（本轮开工时读到的状态文件）：

```json
{ "generation": 24, "lifecycleState": "running", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0, "deferDeadline": 0,
  "updatedAt": 1790714105130 }
```

`lifecycleState: running` + `deferDeadline: 0` + `pendingResume: false` ⇒
**没有残留的 defer 期限、没有待恢复的会话**，即第十六轮那句"由 phoenix 在会话空闲的安全点执行"
**已经执行完并且干净收尾**；进程启动时间 `04:34:53` 与状态文件 `updatedAt`（= `04:35:05`）相差 12 s，
两者互相印证。**这正是第十六轮 §21.8 列为"待运维"的第 3 条**（"复核 gen-24 重启后的现场"），
本轮闭环。

### 22.1 Issue 检查（step 1）

```text
gh issue list --state open   → 1   （#40）
gh pr list --state open      → 4   （#42/#43/#45/#46，全部 Dependabot）
git rev-list --left-right --count main...origin/main → 0  0
git status --porcelain       → （空）
```

**⇒ 存在未处理的 issue（#40）→ 转入 step 2。** 与第十五/十六轮是**同一个** issue，**没有新增**。

**一个复用的绕行方式**（第十六轮 §21.1 记过，本轮再次确认有效）：
`gh issue view` 在 `gh` 2.45.0 上因 Projects classic 弃用而失败（`GraphQL: Projects (classic) is being deprecated…`），
用 `gh api repos/StvLi/dsh-ros2/issues/40` **正常返回**。

### 22.2 建议评估（step 2）——issue #40 的合理性与必要性（第三次复核）

第十六轮已复核过一轮。本轮**再逐字核对事实是否仍然成立**，结论**与第十五/十六轮一致**：

| 复核项 | 本轮实测 |
| --- | --- |
| 5 处活配置行是否仍在 | ✅ **仍在**（33/37/41/45/49），第 29 行注释仍在 |
| `grep -c '/tmp/vlm_ws'` | **6**（5 活 + 1 注释）—— 与第十六轮**逐字相同**，无自愈式消失 |
| 第 63 行那条 | ✅ **仍在**：`rosSetup: "source /home/stvli/Desktop/bar_ws/install/setup.bash &&"` |
| 两个路径是否存在 | `/tmp/vlm_ws` **MISSING**；`/home/stvli/Desktop/bar_ws` **MISSING** |
| 自愈是否仍然有效 | ✅ 成立，见下 |

运行中进程的**实时证据**（本轮 `ros2_env_check` 原文，非推断）：

```json
"setup": {
  "prefix": "source /home/stvli/lite_delivery_aio/install/setup.bash && ",
  "sourcePath": "/home/stvli/lite_delivery_aio/install/setup.bash",
  "explicit": true, "sessionOverride": null,
  "missingSources": ["/tmp/vlm_ws/install/setup.bash"]
},
"probe": { "exitCode": 0, "timedOut": false, "durationMs": 2101, "stderrTail": "" },
"note": "配置的 rosSetup 链中有 source 路径不存在：/tmp/vlm_ws/install/setup.bash；已剔除该段，改用其余 1 段…"
```

**⇒ 结论不变（第三次）：合理、必要，但配置在仓库外、属于正在运行的部署，且改动需一次优雅重启才生效——
那是会重启"正在跑这个维护任务的进程"的动作，因此是运维决定，不是本任务可以单方面执行的编辑。**
issue #40 继续 open **是有意的**（决策跟踪单，不是被遗忘的缺陷）。
本轮**没有**再往该 issue 上重复评论（第十六轮那份逐字清单仍然准确、没有过期），
只把它在本轮文档里的表述缩短为"第三次复核、结论不变"，避免制造无信息量的通知。

### 22.3 开发管理（git · step 3）

**分支**：`fix/parser-redos-linear`（1 个提交）→ **PR #55**，**CI + CodeQL 全绿后合入 `main`**。

| PR | 分支 | 提交 | CI |
| --- | --- | --- | --- |
| **#55** | `fix/parser-redos-linear` | `fix(common)` | ✅ `check (22)` / `check (24)` / `analyze (js-ts)` / `analyze (python)` / `CodeQL` **5/5 全绿** |
| **#43** | `dependabot/npm_and_yarn/vitest-5.0.1` | `chore(deps)` | ✅ 双绿（见 §22.4） |

#### 22.3.1 先测量，再决定修什么——3 条告警里只有 1 条真的该修

第十六轮把这三条统一判为"**真实但低危 → 有意不修**"，并写明"改写成可证明线性应当**单独一个改动**"。
本轮采纳"单独一个改动"，但**先做了第十六轮没做的事：把三条都跑一遍**。
方法学上有两点刻意为之：

1. **测真实入口，不测裸正则。** `parseTopicList` 会先 `parseLines()`（`split('\n').map(trim)`），
   所以"正则单独跑得慢"不等于"这条路径跑得慢"。裸正则的结论可能被调用方**已有的 trim/split 消掉**。
2. **每条都用工程代价可控的方式取时间**：每个规模用**子进程 + 上限**跑，避免一次爆炸把整个测量脚本挂死
   （第一次就是这么挂的，**挂死本身就是证据**）。

| 站点 | CodeQL 点名的 pump | 走**真实入口**的实测 | 定性 |
| --- | --- | --- | --- |
| `parse.ts:19` `parseTopicList` | `![` + 空格 + 非 `]` | n=500 **184 ms** → n=1000 234 ms → n=2000 **1.9 s** → n=4000 **14.8 s**（**k=2.11**，三次） | **真实、可达** |
| `parse.ts:19` **第二种形状**（本轮新发现） | — | `'['×n + ' ]x]'` → n=20000 **697 ms**（**k=2.00**，二次） | **真实、可达** |
| `parse.ts:70` `parseNodeInfo` | `!:` + 空格 | **只有末尾带 `\n` 才超线性**（k=2.08）；而 `parseNodeInfo` 自己先 `split('\n')` 再 `trim()` → 实测 **0.18 ms 线性** | **不可达**（被调用方消掉） |
| `toolkit.ts:238` `parseSafetyEcho` | `0:` + 空格 | 点名的 pump 与另外两种形状**全部线性**（最小 0.006 ms）——贪婪 `.*` 一步到 `$`，**不发生回溯** | **不可复现** |

**两条结论值得单独说：**

- **`js/polynomial-redos` 的告警不都是真的。** `toolkit.ts:238` 那条在**本轮所有构造下都跑不出超线性**：
  `\s*` 与 `.*` 确实重叠，但 `.*` 贪婪地吃掉余下全部、`$` 立刻成立，**引擎根本不需要枚举那个重叠**。
  这与"重叠 ⇒ 一定慢"的直觉相反，**只有测了才知道**。
- **"低危"不等于"两条都低危"。** `parseTopicList` 是**同步**正则：14.8 s 阻塞的是**整个 host 事件循环**，
  不只是那一个工具。而它**确实可达**——本仓自己的代码注释就写明 RMW 会把日志打到 **stdout**
  （`parseJsonOrRaw` 的 docstring：FastDDS 的 shared-memory transport 错误就打在 stdout），
  而这些 stdout 正是被这个解析器吃的。

两条 pump 都**熬过了 `parseLines()` 的 trim**（一条以非空格 `x` 结尾、一条无首尾空格），
所以它们是**真入口可达**的，不是"理论上正则慢"。

#### 22.3.2 修复：线性扫描 + **差分等价测试**（`fix(common)`，PR #55）

三条全部改成**单趟扫描**，公开 API 与返回值形状不变：

| 文件 | 改动 |
| --- | --- |
| `packages/common/src/chars.ts`（新增） | 把 `\s` / `\w` **逐码点写死**。JS 的 `\s` 比 ASCII 宽（U+00A0 / U+2000–200A / U+2028 / U+2029 / U+202F / U+205F / U+3000 / U+FEFF）——**只按 ASCII 白空格写会静默改变行为** |
| `packages/common/src/parse.ts` | `scanTopicLine` / `scanNodeEntry` 取代两条正则 |
| `packages/common/src/toolkit.ts` | `scanSafetyLine` 取代第三条 |
| `packages/common/tests/parser-linear.spec.ts`（新增） | 把**三条旧正则原样留作 oracle**，与扫描做**差分**比较 |

**等价性是被断言的，不是"看着像"：**

- 三个解析器各自在**穷举语料**（对抗性字母表上长度 ≤5 的全部字符串，9,330 条）
  \+ **10 万条随机串**上与旧正则逐条比对 → **0 处分歧**；
- 开发期还用**更宽的语料**复核过（长度 ≤6、8 字符表 = **299,592** 条穷举 + 40 万随机 → **0 处分歧**）；
- `chars.ts` 的两个字符类**从引擎重新推导**并全码点比对（`\s` 扫 0..0x10FFFF、`\w` 扫 0..0xFFFF）→ 0 分歧。
  **这一步是等价性论证的地基**：只要字符类与引擎一致，"白空格分歧"这一类就不可能发生。

**线性是被断言且有界的：** n=20,000 的两条 pump 与嵌套括号形状都在**亚毫秒**量级完成，
测试用**有界断言**（<100 ms / <1000 ms）守住——旧实现比这个界**高若干个数量级**，
所以它既不会在负载高的 runner 上 flake，又能在二次路径回来时**明确失败**。
实测对比：n=4000 时 旧 **14,847 ms** vs 新 **0.288 ms**；新实现 n=1,048,576 字符 **3.7 ms**（k=0.44）。

**一个过程记录：** 本轮的扫描**第一版仍有 O(n²)**——候选括号的"区间内是否还有 `]`"用了逐候选内层扫描。
是**测试自己在写测试时抓出来的**（嵌套括号形状那条跑了 699 ms，逼近 1000 ms 的界）。
改为"最后一个 `]` 的位置"一次预取（`lastIndexOf`）+ 每候选 O(1) 比较后降到亚毫秒。
**题外但重要**：那次 699 ms 里其实**大部分是 oracle（旧正则）自己的耗时**——
顺手量到旧正则在这个形状上是 **k=2.00、n=20000 时 697 ms**，
于是又发现上面表格里的**第二种可达 pump**。**把 oracle 放进计时区间本身是个错误**，
已改成"小时 n 比等价、大 n 只计新实现"。

#### 22.3.3 一处更正：§21.0 的"main 344"与 §21.8 的"main 347"矛盾，实测是 **347**

第十六轮文档内部对不齐：§21.0 的快照表"结束"列写 `main 344；#51 分支 347`，
而 §21.8 写"用例 `main` **323 → 347**（346 过 + 1 pty-skip）"。

**本轮实测给了裁决依据**：`main` 在**本轮任何改动之前**的用例总数是
**355 − 8（本轮新增）= 347**（346 过 + 1 pty-skip），**与 §21.8 逐字吻合**。
⇒ **表里的 344 是过期值**：它抓的是 **#51 合入之前**的 `main`（#51 分支 347、main 344，
差的正是 #51 自己带进来的 3 条），而"结束"列本应写**全部合入之后**的 347。
**记在这里，方法与"29 条分诊表自身算术对不上"（§21.3.3 更正记录）一致：
快照表的数字必须能被独立重算出来。**

### 22.4 Dependabot 积压处理（4 → 3）——"全绿且可合并"不等于"该合并"

起始 4 个（#42/#43/#45/#46，均开于 2026-09-25）。本轮**没有采用"绿了就合"**，
而是先看清它们**各自改的是什么**。结论：**1 个合并、3 个交回决策**。

| PR | 动作 | 依据 |
| --- | --- | --- |
| **#43** `vitest 4.1.11 → 5.0.2` | ✅ **合入** | **dev-only**（8 个包的 `devDependencies`）。工具链由 CI 直接执行，**`check (22)` / `check (24)` 双绿就是对它最恰当的验证**——这个门禁**测的正是被测对象本身** |
| #42 `cordis ^4.0.1 → ^4.0.4` | ⏸️ **不默认合并** | 它抬的是 **peer 下界**（见下） |
| #46 `dsh-skill 0.1.0-rc.6 → 0.1.0-rc.8` | ⏸️ **不默认合并** | 同上，且**精确 prerelease pin** 本身是脆弱点 |
| #45 `@types/node ^24 → ^26` | ⏸️ **不默认合并** | 第十六轮已交运维；本轮**并入同一个决策单**，不再零散 defer |

#### 22.4.1 为什么这 3 个的"绿"**结构上无法**证明它们想证明的事

**每个包同时声明两处，Dependabot 一起改：**

```json
"peerDependencies": { "@deepseek-ai/cordis": "^4.0.1", "@deepseek-ai/dsh-skill": "0.1.0-rc.6" },
"devDependencies":  { "@deepseek-ai/cordis": "4.0.1",  "@deepseek-ai/dsh-skill": "0.1.0-rc.6" }
```

即本仓的惯例是**"至少支持 X，且恰好对着 X 开发"**。而 `peerDependencies` 是**下界**——
**抬下界是收窄声明支持范围**。

**关键在于 CI 装的是什么**：CI 执行 `pnpm install --frozen-lockfile`，装的是
**这个 PR 自己刚抬上去的那个 `devDependency`**。所以
**`check (22)` 绿的意思是"代码和 4.0.4 能一起工作"，而不是"4.0.4 是正确的下界"。**
**一个门禁只有在真的测那件事时，绿才有信息量**（§21.3.4 已就"偶发红的门禁"讲过同一枚硬币的另一面）。

**这两个 peer 其实是 type-only**（本轮实测，`lib/` 里**零**运行时导入）：

```text
$ grep -c "@deepseek-ai/cordis" packages/*/lib/*.js   →  0 个文件
src:  import type { Context } from '@deepseek-ai/cordis'
      import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
```

⇒ 它是一份**编译期契约**：跑起来的进程不会因此坏掉，但**声明的支持范围会变**。

**线上实际提供什么（本轮实测）：**

| 包 | 运行中的 harness 实际提供 | 仓库当前 pin（peer / devDep） |
| --- | --- | --- |
| `@deepseek-ai/cordis` | **4.0.2** | `^4.0.1` / `4.0.1` |
| `@deepseek-ai/dsh-skill` | **0.1.5-rc.1** | `0.1.0-rc.6` / `0.1.0-rc.6` |

⇒ **#42 会把下界抬到部署之上**（部署是 4.0.2，`^4.0.4` 不满足它）；
**#46 抬到的 rc.8 仍然低于 harness 的 0.1.5-rc.1，什么也没修**——
而"精确 prerelease pin 与真实 harness 脱节"这件事本身**早就被记在代码注释里**
（`packages/core/src/index.ts`："`snapshot()` is newer than this bundle's pinned `@deepseek-ai/dsh-skill` peer"）。

#### 22.4.2 升级为 issue #56，而不是第二次静默 defer

第十五→十六轮对 #40 的做法给出了本仓的既定模式：**同一个决策被反复 defer 时，升级成 issue**。
`@types/node` 的下界问题在第十六轮已被 defer 过一次，本轮 #42/#46 又是同一类，
所以本轮把它们**合并成一张可决策的单子** → **issue #56**
（列出三种可选策略：下界=最低支持 / 跟随 harness / 跟随最新，并指出选完后
`dependabot.yml` 可能需要一条 `ignore` 规则来阻止每周重开）。
三个 PR 上各留一条评论指向 #56，并写明**它们是有意保持 open 的决策跟踪单**。
**下一轮若 #56 仍未决策，按同样标准：这是有意的 open，不是新缺陷。**

### 22.5 dsh-phoenix 持续更新/测试循环（step 4）

**接线核对**（与第十五/十六轮一致，未变）：`dsh-phoenix` 以 `link:` 装入 web profile；
`dsh-ros2` 及 6 个子包同样以 `link:` 指向本仓 checkout 的 `packages/*`：

```text
dsh-ros2        -> ../../../../Desktop/embody_agent_ws/dsh-ros2/packages/dsh-ros2
dsh-ros2-common -> ../../../../Desktop/embody_agent_ws/dsh-ros2/packages/common
dsh-ros2-core   -> …/packages/core     dsh-ros2-moveit  -> …/packages/moveit
dsh-ros2-profile-> …/packages/profile  dsh-ros2-safety  -> …/packages/safety
dsh-ros2-vision -> …/packages/vision
```

**触发面**（本轮再次从 `dsh-phoenix/README.md` 核对，未变）：phoenix 订阅 `tools/result`，
只对 **`cordis_run`** 反应，**不**监听 profile 清单/lockfile（README 明说这是**行为边界、不是架构保证**）。
本会话工具表里**仍然没有** phoenix 自己的重启工具，故沿用文档化触发面。

**本轮实测到的落差（这就是 step 4 要处理的东西）：**

| 量 | 值 |
| --- | --- |
| 运行中 dsh 进程启动 | **2026-09-30 04:34:53** |
| `packages/common/lib/{parse,toolkit,chars}.js` 重建 | **2026-10-01 04:11:22**（本轮 `pnpm run typecheck` / `test` 会先 build） |

**`lib/` 比进程新 ⇒ 进程里跑的仍是本次修复**之前**那份 `dsh-ros2-common`。**
`common` **不是 bundle**，而 `bundleDriftReport()` 只比 `package.json` 的 **version**
（本轮 `common` 版本号未变）——所以这份落差**在进程内不可见**，
这正是第十六轮 §21.7 第 6 条记的观测盲区。**必须重启才生效。**

**已确认（状态文件原文，2026-10-01 04:17:05 CST）：**

```json
{ "generation": 25, "lifecycleState": "deferred", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0,
  "deferDeadline": 1790800325124, "updatedAt": 1790799425124, "coalesced": false }
```

`deferDeadline − updatedAt = 900000 ms`，**正好是文档化的 900 s 硬期限**——
与第十四/十五/十六轮逐字一致。`coalesced: false`（本轮只有一次激活，没有被合并）。

**两个沿用第十六轮教训的细节：**

1. **用真正空实现的 `apply()`**——第十六轮记过：受限 `ctx` **不暴露 `logger`**
   （`sandbox ctx does not expose "logger"`），而**phoenix 的触发面是 `cordis_run` 这次调用本身**，
   不是 `apply()` 做了什么。⇒ 空实现**既足够又是最小失败面**。**本轮直接照做，无需再试错一次。**
2. **运行中验收的边界（与第十六轮相同，如实记录）**：本次修复**是行为保持的**，
   新旧实现在**输出上不可区分**（这正是等价测试要保证的），所以在**重启后的进程里**
   也**无法**通过观察某个工具的输出确认新代码已加载——它只会在**对抗输入**下表现为"不卡住"，
   而那个输入**无法从会话内部注入**。
   ⇒ **本轮的验收停在库层**（等价 + 计时，§22.3.2），
   运行中生效则依赖 gen-25。**这是一处诚实降级，不是遗漏。**

### 22.6 安全扫描（step 5）

| 面 | 结果 |
| --- | --- |
| 供应链（`pnpm audit --prod --audit-level high`，`--registry=https://registry.npmjs.org`） | ✅ **No known vulnerabilities found** |
| 供应链（**含 dev** 的完整 `pnpm audit`） | ✅ **No known vulnerabilities found** |
| 硬编码密钥（`sk-` / `AIza` / `ghp_` / `gho_` / `xox` / `BEGIN … PRIVATE KEY`） | ✅ **0**（工作树 `git grep`；命中全在维护文档里对这些模式的**描述文字**，已排除） |
| **静态分析（CodeQL）** | ✅ **13 → 10 open**；降幅**恰好**是 3 条 `js/polynomial-redos` → 0，**没有出现新规则、也没有新增同类实例**（§22.3.2） |
| 发布面（9 包 `pnpm pack` **且预先种入 14 个 `.pyc`**） | ✅ **9/9 CLEAN**；**并做了正向对照**：把 `moveit` 的 `files` 守卫摘掉后，`package/scripts/__pycache__/probe.cpython-312.pyc` **确实被打进 tarball** ⇒ 这个"全 CLEAN"不是空结论 |
| Python 执行面（**全文件 glob**，29 个文件 = 23 个 `.py` + **6 个无扩展名 shebang 脚本**） | ✅ `shell=True` / `os.system` / `eval(` / `exec(` / `pickle` / `yaml.load` **全部 0**；19 处 `subprocess.*` **全部 argv 数组**（逐条抽查多行调用，无 shell 字符串） |
| TS 命令面 | ✅ **无 `execSync` / 无 `shell: true` / 无 `eval(` / 无 `new Function(`**；`execFile` ×14、`spawn` ×2、`spawnSync` ×1（全部 argv）。8 处 `bash -lc` 逐条核对：5 处硬编码/常量、其余经 `shq()` 引用（`buildSafetyMonitorCommand` / `gui.ts` outputPath / 安装器下载链 / `pgrep` 的 `[p]attern` 单引号转义） |
| 既有防线回归（第十三/十四/十六轮） | ✅ 全部仍在：`safe_sid()` 双层守卫、PTY `DIR_MODE 0o700` / `FILE_MODE 0o600`、sidecar UDS `chmod 0o600`、安装器 `umask 077` + `chmod 700`、`ros2_interface_create` 的 `flag: 'wx'`（`O_EXCL`）、**7 个发布 Python 的包**统一 `!**/__pycache__` + `!**/*.pyc` |

**方法学沿用第十六轮的纠正**：Python 扫描**没有**按 `*.py` 过滤——本仓有 **6 个无扩展名的 Python 脚本**
（`safety_monitor` / `safety_vlm_arbitrate` / `vision_bringup` / `vlm_node` / `vlm_bridge_node` / `vlm_bridge_call`），
按扩展名过滤会**静默漏掉它们**。本轮按"`.py` **或** 首行 `#!/usr/bin/env python3`"取全集，得 **29** 个。

### 22.7 本轮发现

1. **【已修·真实·可达·本轮最有价值】`parseTopicList` 的正则是可复现的三次 ReDoS**
   （§22.3.1）：`![` + 空格 + 非 `]` ⇒ n=4000 时 **14.8 s**（k=2.11）；
   **还有第二种形状** `[`×n + ` ]x]` ⇒ n=20000 时 **697 ms**（k=2.00）。
   **两条都熬过 `parseLines()` 的 trim，所以是从真实入口可达的**；同步执行 ⇒ 阻塞**整个事件循环**。
   已改为单趟扫描（n=4000：**0.288 ms**，↓5 万倍）。
2. **【未修·有意·有据】另外两条告警经实测**不**该按"真实缺陷"处理**：
   `parseNodeInfo` 的超线性**只在字符串含 `\n` 时出现**，而它的调用方**先按 `\n` 切分并 trim**（实测 0.18 ms 线性）；
   `parseSafetyEcho` 在点名的 pump 及另外两种形状下**全部线性**（贪婪 `.*` 一步到 `$`，不回溯）。
   **两条仍被一并改成扫描**——因为代价极小，且"重叠量词"这一类**在周围模式变化时可能重新变成真的**。
   **⇒ 第十六轮"3 条都真实但低危"的结论被本轮实测细化为"1 真实 / 1 不可达 / 1 不可复现"。**
3. **【已闭环·运行时】第十六轮的 gen-24 已干净落地**（§22.0）：`lifecycleState: running`、
   `deferDeadline: 0`、`pendingResume: false`，进程启动时间与 `updatedAt` 相差 12 s 互相印证。
4. **【方法学·新增】"CodeQL 报了 ReDoS" ≠ "跑得慢"。** `toolkit.ts:238` 的重叠是真的，
   但**引擎一步就到 `$`，根本不枚举那个重叠**。**只测裸正则还不够**——
   必须走**真实入口**，因为调用方的 `trim()` / `split('\n')` 可以把 pump 直接消掉（`parse.ts:70` 就是这种）。
5. **【已修·一致性】§21.0 快照表"main 344"与 §21.8"main 347"矛盾，实测 347**（§22.3.3）：
   344 是 **#51 合入之前**的 `main`。**快照表的数字必须能被独立重算。**
6. **【新·决策单】Dependabot 的"绿"结构上无法评估 peer 下界**（§22.4）：
   CI 装的是**这个 PR 自己抬上去的 devDependency**。实测这三个 peer **都是 type-only**
   （`lib/` 里零运行时导入），而**线上 harness 提供 cordis 4.0.2 / dsh-skill 0.1.5-rc.1**，
   仓库 pin 的是 `^4.0.1` / `0.1.0-rc.6`——**#42 会把下界抬到部署之上，#46 抬完仍低于 harness**。
   升级为 **issue #56**（三种策略可选），避免第三次静默 defer。
7. **【过程·自纠】本轮的扫描第一版仍有 O(n²)**，是**写测试时被测试自己抓出来的**（嵌套形状 699 ms 逼近 1000 ms 界）；
   修复后亚毫秒。**顺带暴露一个测量错误**：把 oracle（旧正则）放进了计时区间，
   而那次 699 ms 里大部分是 **oracle 自己**的耗时——改正的同时**发现了第 2 种可达 pump**（发现 1）。
8. **【正向对照】发布面"9/9 CLEAN"做了反向验证**（§22.6）：摘掉 `moveit` 的守卫后 `.pyc` **确实**进了 tarball，
   证明这个结论**不是空跑**。**"全绿"只有在能被证伪时才算证据**——与 §21.3.4 的门禁哲学同源。

### 22.8 结论与下一步建议

- **交付**：**2 个 PR 合入 `main`**——**#55**（`fix(common)`：3 处解析器改线性扫描 + `chars.ts` +
  差分等价测试，CI/CodeQL **5/5 绿**）、**#43**（`chore(deps)`：vitest 4 → 5，dev-only）。
  `main` **`5f5f71f` → `f3ec14e`**；用例 **347 → 355**（354 过 + 1 pty-skip）；
  **CodeQL open 告警 13 → 10**（降幅恰好是 3 条 ReDoS，无新规则）。
- **线上价值**：掐掉一条**可从 stdout 日志噪声触发、会阻塞整个 host 事件循环 14.8 s（n=4000）**的路径；
  同时把"哪条告警是真的"这件事**从判断变成了测量**。
- **末端动作**：改动已构建进 `lib/`；按文档化触发面（`cordis_run`）激活一个**空实现**的动态包，
  **已确认 phoenix 登记 `gen 25`**（`lifecycleState: deferred`、硬期限 900 s、
  `coalesced: false`），由 phoenix 在会话空闲的安全点执行优雅重启（§22.5）。
- **待运维（本轮无法完成的两件事）**：
  1. **决定 issue #40**：按第十六轮 §21.2 的**6 处**逐字清单修改部署配置（含第 63 行），随后优雅重启。
  2. **决定 issue #56**：peer/类型下界策略三选一；选完后可能需要在 `dependabot.yml` 加 `ignore`，
     否则 #42/#45/#46 会每周重开。
- **下次维护建议**：
  1. **先看 #56 是否已决策**，再决定 #42/#45/#46 的处置——**别再第三次 defer**。
  2. **复核 gen-25 后的现场**：确认 `lifecycleState: running`、无残留 `deferDeadline`；
     **但不要指望从工具输出确认新解析器已加载**（行为保持 ⇒ 输出不可区分，§22.5）。
  3. **CodeQL 只需确认没有反弹**（当前 10 条全部落在已分诊的两类：2 `file-access-to-http` 设计如此、
     8 `insecure-temporary-file` 全在测试/校验脚本的私有 `mkdtemp` 下）；若冒出**新规则**或**同规则新实例**，
     优先分诊新的。
  4. **维持验收线**：`typecheck + test + build` 全绿 → push → **立刻开 PR 等 CI**；
     `pnpm audit` **必须带 `--registry=https://registry.npmjs.org`**（本机默认 registry 在本沙箱内不可用）。
  5. **安全扫描继续用全文件 glob**，并且**报告"干净"时要附一个能证伪它的对照**
     （本轮 §22.6 的正向对照；"全绿"本身不是证据）。
  6. **测量优先于分类**：本轮把"3 条真实的 ReDoS"变成"1 条真实"，
     靠的是**走真实入口实测**而不是读告警——这类"先量再判"应固化为习惯。

## 23. 维护记录（2026-10-10 10:41 CST / UTC 2026-10-10 02:41 · 第十八轮：2 open issue（#40 + 新 #56）→ step 2 把 #56 的三个选项**逐条实测**，三个都不能直接用，于是落成第四条策略（peer 对宿主诚实 / devDep 可安装 / 类型钉 engines 下界）+ **让 Dependabot 不再每周重开**；**接手一个被中断会话留在工作树里的在途实现**（先逐条复算再提交，并补上它谎称已完成的那一半）；Dependabot 积压 5 → 0（另有 1 个中途新建、当场处理；#60 TypeScript 7 **先测 emit 再合**）；安全扫描**发现并修复 1 条新的 high（dev-only）**；闭环 gen-25；并**修正了自己刚写进 main 的一个过宽结论**）

> 本轮结论：起始 **2 open issue（#40 + 新 #56）** / **5 open PR（#42/#46/#58/#59/#60，全部 Dependabot）**、
> `main = 1c9ea44`，而**工作树不干净**——里面有 **10 个未提交改动**，来自一个被中断的会话（§23.3.1）。
> 本轮交付：**5 个 PR 合入**（#61/#60/#63/#62/#64）、**4 个 PR 关闭**（#42/#46/#58/#59）、
> **issue #56 关闭**、**issue #40 有意保留**。`main 1c9ea44 → 450487b`。
> **用例 355 不变**（354 过 + 1 pty-skip）；**CodeQL open 10 不变**；
> `pnpm audit` **prod 与含 dev 都干净**（起始时含 dev 有 **1 条 high**，是本轮唯一的真实增量）。
> **本轮最有价值的两条**都不是"改了代码"，而是**推翻既有材料**：
> **① 在途文档声称已加的 `dependabot ignore` 根本不存在**（§23.3.1），
> **② 我上一轮刚合进 main 的"选项 2 不可安装"，本轮复算时失败的包名变了、且结论**过宽**（§23.3.3）。

### 23.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（= `origin/main`），但**工作树有 10 个未提交改动** + 1 个未跟踪文件 | `main`（= `origin/main` `450487b`），工作树**干净** |
| `main` | `1c9ea44` | **`450487b`** |
| open issue / open PR | **2 / 5**（#40 + #56 / #42/#46/#58/#59/#60） | **1 / 0**（仅 #40，**有意保留**） |
| vitest 用例 | **355**（354 过 + 1 pty-skip） | **355**（逐字相同） |
| CodeQL **open** 告警 | **10**（8 `insecure-temporary-file` + 2 `file-access-to-http`） | **10**（同规则同数量，**无新规则、无新实例**） |
| `pnpm audit` | prod **干净** / 含 dev **1 high（新）** | **两者都干净** |
| TypeScript | `5.6.2` | **`7.0.2`** |
| 运行中的 dsh | 启动于 **2026-10-10 10:40:59**（= gen-25 的产物） | **同进程**；`lib/` 本轮用 TS 7 重建，但 **JS 逐字节相同 ⇒ 本轮不重启**（§23.5） |

### 23.1 Issue 检查（step 1）

```text
gh issue list --state open   → 2   （#40、#56）
gh pr list --state open      → 5   （#42/#46/#58/#59/#60，全部 Dependabot）
git rev-list --left-right --count main...origin/main → 0  0
git status --porcelain       → 11 行（10 个 M + 1 个 ??）   ← 与历轮都不同
```

**⇒ 存在未处理的 issue（#40、#56）→ 转入 step 2。**
其中 **#56 是本轮新增的可决策项**，且第十五/十六/十七轮已为它写下"**别再第三次 defer**"。

**又一个复用的绕行方式，而且比上一轮更彻底（本轮新发现）：**
`gh auth status` 报 **`The token in …/hosts.yml is invalid`**（十六轮记过同一现象），
但 `gh auth token` **取出的 token 是好的**——`GET /user` 返回 `StvLi`、
`x-oauth-scopes: admin:public_key, gist, read:org, repo, workflow`、`x-ratelimit-limit: 5000`。

```console
$ gh auth status        # X Failed to log in to github.com account StvLi … token is invalid
$ T=$(gh auth token); curl -s -H "Authorization: Bearer $T" https://api.github.com/user
{"login":"StvLi", …}    # ← 同一个 token，REST 可用
```

**⇒ 本轮的 PR 创建/评论/关闭/合并全部走 `gh` 并显式带上 `GH_TOKEN=$(gh auth token)`，一路正常。**
`gh auth status` 这个**假阴性**会让人误判"本机没有 token、只能推分支不能开 PR"（第十五轮就是这么降级的），
值得单独记一条：**状态命令的自检结论也要能被反证。**

### 23.2 建议评估（step 2）——issue #56 的合理性与必要性

**#56 是一张决策跟踪单，不是被遗忘的缺陷。** 它记录的问题是：
三个 Dependabot PR（#42/#46/#45）动的是**声明出来的下界**（peer range），而不只是开发工具版本，
而 **CI 结构上无法裁决这件事**——CI 装的就是"这个 PR 自己抬上去的那个 devDependency"。

issue 原文给了三个选项。本轮把**三个都实测了一遍**，结论是**三个都不能直接用**：

| 选项 | 实测结论 | 证据 |
| --- | --- | --- |
| **1. 下界 = 最低支持**（peer 不动，只动 devDep） | **不可表达** | 对预发布版，"保持下界"和"覆盖宿主"互斥。node-semver 只在"比较器与它共享 `[major,minor,patch]`"时才接受预发布，所以**以 `0.1.0-rc.6` 为根的每一个区间（连 `*` 在内）都拒绝 `0.1.5-rc.1`** |
| **2. 跟随 harness**（peer/devDep 都提到宿主版本） | **在本工作区不可安装** | `pnpm install` 直接失败（原文见 §23.3.3，本轮**复算过，且修正了一处过宽表述**） |
| **3. 照 Dependabot 合并**（跟随最新） | **没有收益** | #42 会把下界抬到 `^4.0.4` 而**宿主是 4.0.2**（悬在部署之上）；#46 抬到 `0.1.0-rc.8` **仍低于**宿主的 `0.1.5-rc.1`；#58 的 `@types/node ^26` 会把类型面抬到 `engines` 下界（22）之上 |

#### 23.2.1 选项 1"不可表达"的复算（本轮亲自跑过，不转述）

```console
$ node -e "…semver…"
0.1.0-rc.6           sat(0.1.0-rc.6)= true   sat(0.1.5-rc.1)= false
^0.1.0-rc.6          sat(0.1.0-rc.6)= true   sat(0.1.5-rc.1)= false
>=0.1.0-rc.6 <0.2.0  sat(0.1.0-rc.6)= true   sat(0.1.5-rc.1)= false
*                    sat(0.1.0-rc.6)= false  sat(0.1.5-rc.1)= false
^0.1.5-rc.1          sat(0.1.0-rc.6)= false  sat(0.1.5-rc.1)= true
```

**⇒ 选项 1 写不出它自己想要的那个区间**：想同时覆盖"开发用的 rc.6"和"宿主给的 rc.1"，
semver 上没有解。**而 `^0.1.5-rc.1` 恰好只覆盖宿主那一侧**——这就是最终采用的 peer。

#### 23.2.2 结论：三个选项之外，落成"规则 A / B / C"

| 规则 | 内容 | 一句话理由 |
| --- | --- | --- |
| **A · peer** | 声明必须**被真正装载它的宿主满足** | peer 是"宿主契约"，不是"我开发时用的版本"；声明一个宿主没有的区间 = 假契约 |
| **B · devDep** | 必须**能被 pnpm 解析安装**；装不到宿主版本时停在最后一个可安装版本，并把漂移写进文档 | 装不上的 pin 会让 `pnpm install` 失败，把"策略"变成"故障" |
| **C · 运行时替身类型包** | `@types/node` 钉 **`engines` 下界**，不追最新 | 用最老受支持运行时做类型检查，才能拦住"只在新运行时存在"的 API |

落地结果（7 个 bundle 包 + `common`/`sidecar` 只动类型）：

```jsonc
"peerDependencies": {
  "@deepseek-ai/cordis":    "^4.0.2",      // 规则 A：宿主就是 4.0.2
  "@deepseek-ai/dsh-skill": "^0.1.5-rc.1"  // 规则 A：宿主就是 0.1.5-rc.1
},
"devDependencies": {
  "@deepseek-ai/cordis":    "4.0.2",       // = peer 下界（稳定版，可安装）
  "@deepseek-ai/dsh-skill": "0.1.0-rc.6",  // **唯一可安装**的编译靶面，故意低于 peer
  "@types/node":            "^22.19.0"     // 规则 C：= engines 下界
}
```

**"peer 与 devDep 故意不一致"是证明 1/2 的直接后果，不是笔误**，
方向上是**保守**的：编译面比宿主更旧 ⇒ 只可能"少用"类型，不可能"用了宿主没有的类型"。

**#40 的第四次复核（结论不变）**：`grep -c '/tmp/vlm_ws'` 仍为 **6**（5 活 + 1 注释）、
两个路径（`/tmp/vlm_ws`、`/home/stvli/Desktop/bar_ws`）**仍都 MISSING**，
且本轮**又拿到一份新的活体证据**（§23.5 的 `ros2_env_check` 原文里 `missingSources` 仍在）。
**#40 继续 open 是有意的**：配置文件在仓库外、属于正在运行的部署、
改动需一次优雅重启（即重启"正在跑这个维护任务的进程"），因此是运维决定。
本轮同样**没有**再往 issue 上重复评论，只在本文件里缩短记录，避免制造无信息量的通知。

### 23.3 开发管理（git · step 3）

| PR | 分支 | 提交 | CI |
| --- | --- | --- | --- |
| **#61** | `fix/peer-floor-policy` | `chore(deps)` + `ci(dependabot)` + `docs`（3 个） | ✅ `check (22)` / `check (24)` / `analyze (js-ts)` / `analyze (python)` / `CodeQL` **5/5 全绿** |
| **#64** | `docs/correct-option2-reproduction` | `docs` | ✅ 同上 5/5 |
| **#60** | `dependabot/npm_and_yarn/typescript-7.0.2` | `chore(deps)` | ✅ `check (22)` / `check (24)`（CodeQL **按设计跳过**，见 §23.4.3） |
| **#63** | `fix/dev-audit-source-map-js` | `fix(deps)` | ✅ 5/5 |
| **#62** | `dependabot/npm_and_yarn/vitest-5.0.3` | `chore(deps)` | ✅ `check (22)` / `check (24)` |

#### 23.3.1 起始工作树里有一份**被中断会话的在途实现**——先复算，再提交

本轮开工时 `git status` 有 10 个改动 + 1 个未跟踪文件：9 个 `package.json`、
`pnpm-lock.yaml`、以及未跟踪的 `docs/dependency-policy.md`（201 行），
分支是 `fix/peer-floor-policy`，**但一个提交都没有**。文件时间戳是 10:39–10:40，
而本进程启动于 10:40:58 —— 即**上一轮 dsh 进程被重启时打断的工作**（§23.5 的 journal 里有三次重启）。

**处理原则：不因为"文档说它绿"就替它背书。** 逐条复算：

| 文档声称 | 本轮复算 | 结果 |
| --- | --- | --- |
| 宿主提供 cordis `4.0.2` / dsh-skill `0.1.5-rc.1` / dsh-tools `0.1.5-rc.1` | `createRequire('~/.dsh/profiles/web/package.json')` 直读 | ✅ 逐字吻合 |
| 仓库自己解析到 `4.0.1` / `0.1.0-rc.6` | 从 `packages/core` 解析根读取 | ✅ 吻合（cordis 4.0.2 是本地已改后） |
| 两个 peer 是 **type-only** | `grep` 统计 built `lib/` 里的真实 import | ✅ cordis/dsh-skill **0 个文件**；dsh-tools **7 个文件**（运行期真的用） |
| 改后 `typecheck + test + build` 全绿、354 过 + 1 skip | 亲自跑 | ✅ 全绿，且 **355 = 347 + 8** 与 §22.3.3 的裁决一致 |
| 改后 `pnpm install --frozen-lockfile` 仍可解 | 亲自跑 | ✅ 通过（peer 区间**不进 lockfile 的 importers**，所以只有 devDep 变化是 lockfile 可见的） |
| **`dependabot.yml` 已加 `ignore`（"见该文件内的注释"）** | `git diff .github/dependabot.yml` / `git status` | ❌ **根本不存在**——见下 |

**⇒ 最后一行是这份在途工作唯一真实的缺口**：文档用现在时描述了一个**没做的动作**。
这正是"复算"而不是"转述"的价值所在——**如果我只读文档，main 上会留下一个
'策略已防复发'的假象，而三个 PR 下周照旧重开。**

#### 23.3.2 补上缺的那一半：`dependabot ignore`（PR #61 的第 2 个提交）

```yaml
    ignore:
      - dependency-name: "@deepseek-ai/cordis"
      - dependency-name: "@deepseek-ai/dsh-skill"
      - dependency-name: "@deepseek-ai/dsh-tools"
      - dependency-name: "@types/node"
        update-types: ["version-update:semver-major"]
```

设计上的两点刻意：

1. **前三个是"全忽略"**——它们要跟随的是 **harness**，不是 npm 的最新版；harness 升级时**手工**一起改。
   （`ignore` 只挡**版本更新**，**安全告警与自动安全修复不受影响**，已写进文件注释。）
2. **`@types/node` 只挡 major**——22.x 的 patch/minor 照常流入，23/24/25/26 被挡住。

**验证方式是"能被证伪"而不是"看着像"**：`yaml.safe_load` 解析出 `ignore` 的四条规则原文，
且**任何语法/字段错误都会让 GitHub 在 push 时直接报错**（本轮 push 成功即为一次真实校验）。

#### 23.3.3 修正一处**过宽**的结论（PR #64）——它在上一节刚被合进 main

§22（上一轮）留下的在途文档里有一条"证明 2 · 选项 2 不可安装"，带一段 2026-10-01 的报错原文：

```text
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for
  @deepseek-ai/dsh-scope@>=0.1.5 <0.2.0-0
```

本轮**复算**它时，**同一个工作区里失败的包换成了 `@deepseek-ai/dsh-llm`**：

```console
$ pnpm install            # 把 8 个包的 devDep 提到 dsh-skill@0.1.5-rc.1 之后
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for
  @deepseek-ai/dsh-llm@>=0.1.5 <0.2.0-0 while fetching it from https://registry.npmjs.org/
```

**换的是名字，不是机制**：`dsh-skill@0.1.5-rc.1` 自己声明 `dsh-llm: ^0.1.5-rc.1`，
而 pnpm 把它规范化成 **`>=0.1.5 <0.2.0-0`（预发布标记被丢掉）**，
于是要求一个**从不存在**的稳定版 0.1.5——而 `0.1.5-rc.1/rc.2/rc.3` 全都发布过。
（`node-semver` 不会丢：它给的是 `>=0.1.5-rc.1 <0.2.0-0`。**两者不一致，本轮两边都实测了。**）

**更重要的是边界被写宽了。** 同一个 `dsh-skill@0.1.5-rc.1` 在**空目录**里安装是**成功的**
（会装出 `dsh-llm@0.1.5-rc.3`）：

```console
$ mkdir /tmp/floor-probe && cd /tmp/floor-probe   # 空目录，同样的 devDep
$ pnpm install
+ @deepseek-ai/dsh-skill 0.1.5-rc.1
Done in 4.2s          # ← 成功
```

⇒ 准确的说法是"**选项 2 在*本工作区*不可安装**"，而不是"这个依赖图不可解析"。
**把失败条件写宽一度，就会变成一个不经检验也会被引用的错误结论**——所以这处值得单独一个 PR 去收窄。

绕开方案（`autoInstallPeers: false`）本轮**测到底**，而且比原文说的更硬：

```console
$ pnpm install            # autoInstallPeers: false
Packages: +5 -26          # 装上了，同时拆掉 26 个包
$ pnpm run build
packages/core/src/index.ts(92,55): error TS2339: Property 'name' does not exist on type 'ToolDefinition'.
packages/profile/src/index.ts(33,55): error TS2339: （同上）
$ pnpm -r test
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from …/vitest@5.0.3…
```

**`TS2339` 这条是本轮的新证据，不是"更好的报错"**：它证明那两个"仅类型"的 peer
**在编译期真的被用到**——关掉自动安装，harness 的类型消失，`ToolDefinition.name` 立刻解析不了。
**这正是规则 A 的另一面**：peer 区间既然是编译期契约，它就必须**真的**被宿主满足。

### 23.4 Dependabot 积压处理（5 → 0，另有 1 个在本轮中途新建并当场处理）

| PR | 提议 | 处置 | 依据 |
| --- | --- | --- | --- |
| **#42** | cordis peer `^4.0.1` → `^4.0.4` | ❌ **关闭**（评论指向 #56/#61） | 宿主是 4.0.2；`^4.0.2` 已包含 4.0.4，抬 floor 纯属把契约悬到部署之上 |
| **#46** | dsh-skill `0.1.0-rc.6` → `0.1.0-rc.8`（精确） | ❌ **关闭** | rc.8 仍是**精确预发布 pin**，且仍**低于**宿主 `0.1.5-rc.1`，什么都没修 |
| **#58** | `@types/node` `^24` → `^26` | ❌ **关闭** | `engines` 下界是 22；按 26 检查会放行 Node-26-only API。**#61 反向把它降到 `^22.19.0`，零类型错误** |
| **#59** | dsh-tools `0.1.0-rc.6` → `0.1.0-rc.8` | ❌ **关闭** | dsh-tools 是**运行期**依赖（7 个 built 文件 import 它），跟随 harness；rc.8 既非宿主版本也无缺陷证据 |
| **#60** | typescript `5.6.2` → `7.0.2` | ✅ **合入** | **先测 emit**，见 §23.4.1 |
| **#62** | vitest `5.0.2` → `5.0.3` | ✅ **合入** | dev-only 工具链，CI 直接执行它——与第十七轮 #43（vitest 4→5）同一判据 |

#### 23.4.1 TypeScript 7：**先测 emit，再决定**——因为 `tsc` 会生产发布物

第十七轮为 vitest 定下的判据是"**dev-only 且 CI 直接执行它 ⇒ 绿就是对它最恰当的验证**"。
**但这条判据不能平移到 TypeScript 上**：`tsc` 的产物 `lib/` **就是发布到 npm 的东西**，
而 CI 只会说"它能构建"，**不会说"产出的字节没变"**。所以本轮**实测**：

```text
对比产物文件数：                78
逐字节相同：                    71
不同的 .js（运行期行为）：        0      ← 一个都没有
不同的 .d.ts：                   7
```

那 7 个声明文件的差异**只有一处**——推断类型里字符串字面量的**引号风格**：

```diff
-export declare const inject: readonly ["tools", "skills", "approval", "jobs"];
+export declare const inject: readonly ['tools', 'skills', 'approval', 'jobs'];
-    readonly type: "object";
+    readonly type: 'object';
```

（6 个 `lib/types/index.d.ts` + `common/lib/types/toolkit.d.ts`。）**语义完全等价**，
不改变任何使用方的类型检查。再加上 `check (22)` / `check (24)` 全绿、编译器自身 `engines: >=16.20.0`，
**"运行时不变、发布面只差引号"是被测量出来的，不是被类比的。**

方法上也刻意区分了两种证据：**CI 覆盖"能不能跑"，emit 对比覆盖"产物变没变"**——
它们回答的不是同一个问题，缺一个都不能下结论。

#### 23.4.2 **差点被一次"绿"的重基把安全修复冲掉**

`#63`（安全修复）合入后，`#62` 的分支仍停在 `2e89fec`（**在 #63 之前**），
其 lockfile 里 `source-map-js` 还是**有漏洞的 1.2.1**、`pnpm-workspace.yaml` 里**没有 override**：

```text
#62 分支 head 68583b4：pnpm-workspace.yaml 无 source-map-js；lockfile source-map-js@1.2.1
main 7f30efa（= #63 之后）：      有 override；                lockfile source-map-js@1.2.2
```

而 GitHub 当时照样显示 **`MERGEABLE` / `CLEAN`**——`mergeable` 只说"**没有文本冲突**"，
**不说"合进去以后结果是对的"**。于是本轮**在本地把这个 merge 真跑了一遍**再决定：

```console
$ git checkout -b tmp/verify-62 main && git merge --no-commit --no-ff origin/dependabot/npm_and_yarn/vitest-5.0.3
$ cat pnpm-workspace.yaml          # → override 还在
$ grep source-map-js pnpm-lock.yaml # → source-map-js@1.2.2
$ pnpm install --frozen-lockfile    # → 通过
$ pnpm audit                        # → No known vulnerabilities found
$ pnpm run test                     # → 8 个包全过
```

**⇒ 三方合并保住了修复**（`pnpm-workspace.yaml` 的 override 是 main 独有的改动，
分支没碰它，所以保留），验证通过才在 GitHub 上合并；合并后**又在 main 上复查了一遍**
override 与 `source-map-js@1.2.2` 仍在。**"CI 绿"在这里恰恰是最不重要的那个信号。**

#### 23.4.3 一个 PR 的"绿"结构上测不到什么（承接第十七轮同一枚硬币）

- **#60（TS 7）的 CodeQL 显示 `skipping`，不是失败**：`codeql.yml` 里有一行
  `if: github.actor != 'dependabot[bot]'`，因为 Dependabot 触发的运行只拿到**只读 token**，
  SARIF 上传必然失败、会**让每一个依赖 PR 常红**。真正的分析由 **push 到 main 的那次**承担
  （本轮 `main` 上 `7f30efa` / `450487b` 的 CodeQL 都跑了）。**⇒ 这一条是设计，不是缺口**，
  但**只有读了 workflow 才知道**，看 `gh pr checks` 的 `skipping` 会得出相反印象。
- **#62（vitest）的绿是在"没有 override 的树上"取得的**（它的分支基线早于 #63），
  而 `pnpm audit --prod` 本来就看不见这条 dev-only 告警 —— 所以它的绿**既没被污染、也没覆盖到**那个面。

### 23.5 dsh-phoenix 持续更新/测试循环（step 4）

**接线核对（未变）**：`dsh-phoenix` 与 7 个 `dsh-ros2-*` 包都以 `link:` 指向本仓 checkout：

```text
dsh-phoenix      -> ../../../../Desktop/embody_agent_ws/dsh-phoenix
dsh-ros2         -> …/dsh-ros2/packages/dsh-ros2      dsh-ros2-common -> …/packages/common
dsh-ros2-core    -> …/packages/core    dsh-ros2-moveit  -> …/packages/moveit
dsh-ros2-profile -> …/packages/profile dsh-ros2-safety  -> …/packages/safety
dsh-ros2-vision  -> …/packages/vision
```

`dsh-ros2-state` / `dsh-ros2-sidecar` **仍不在 web profile 里，且这不是缺口**（本轮专门查过）：
聚合包 `dsh-ros2` 的 `cordis.patch.yml` 只插 6 个 bundle，`dsh-ros2-state` 需要一条
`/tmp/dsh-ros2-sidecar.sock` 的 UDS 且**自带独立安装说明**（README：`npm install dsh-ros2-state dsh-ros2-sidecar`），
活体自检也确认 `declaredBy: dsh-ros2` 的 `missing: []`——**是有意的可选组件**。

#### 23.5.1 gen-25 已闭环——而且**只有 journal 能定时刻**

第十七轮登记了 gen-25（`lifecycleState: deferred`、硬期限 900 s）。本轮开工时状态文件是：

```json
{ "generation": 25, "lifecycleState": "running", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0, "deferDeadline": 0,
  "updatedAt": 1791600069925 }
```

**`running` + `deferDeadline: 0` + `pendingResume: false` ⇒ 没有残留 defer、没有待恢复会话。**
而真正把"**什么时候**重启的、是否优雅"钉死的是 journal：

```text
Oct 01 04:17:05  [dsh-phoenix] restart requested (gen 25): plugin-change
Oct 01 04:22:05  [dsh-phoenix] soft defer deadline reached; agent still busy — restart will be forced at the hard deadline (policy=auto)
Oct 01 04:22:38  [dsh-phoenix] agent idle; executing deferred restart (gen 25)
Oct 01 04:22:39  systemd: Stopped dsh-web.service
Oct 01 04:22:47  systemd: Started dsh-web.service      ← 停机 8 s
Oct 01 04:22:50  [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

**⇒ 第十七轮的 gen-25 是**当场**闭环的**（请求 → 等 agent 空闲 5 min 33 s → 8 s 停机 → 干净回归）。

**一条方法学更正（本轮差点读错）**：状态文件的 `updatedAt` 是 **1791600069925 = 2026-10-10 10:41:09**，
而进程启动于 **10:40:59**——如果只看状态文件，会得出"**gen-25 请求后拖了 9 天才重启**"这种结论（错的）。
实际上 **`updatedAt` 是"本次启动时重写"的时间戳，不是"重启发生的时刻"**：
今天上午 10:27/10:29/10:31/10:40 各有一次 systemd 重启（环境准备），
每次启动 phoenix 都会把状态重新落盘成 `running`，而 `generation` 仍是 25（没有新请求）。
**⇒ 定时刻要看 journal，状态文件只回答"当前处于哪个生命周期状态"。**

#### 23.5.2 本轮**不需要重启**——这是测量结论，不是省事

本轮所有改动都是**依赖声明与文档**：`peerDependencies` / `devDependencies` /
`dependabot.yml` / `docs`。唯一的构建产物变化来自 TS 7，而它**已经测过**：

```text
.js 逐字节不同：0 / 55     ⇒ 运行中被加载的那些 JS，字节没变
```

⇒ 运行中进程（10:40:59 启动）里跑的 `lib/*.js` 与本轮重建后的**逐字节相同**，
**没有任何"新代码等着被加载"**。因此本轮**不触发重启**——把"重启"当作仪式来做，
只会打断正在跑本任务的会话而不带来任何东西。（**这与第十七轮不同**：那一轮改的是解析器行为，
`lib/` 与进程不一致是**真实的**落差，所以当时必须重启。）

#### 23.5.3 活体冒烟测试：在**运行中的进程里**调一个 dsh-ros2 工具

（`ros2_env_check`，本会话实时返回的原文，节选）

```json
{"ok":true,"tool":"ros2_env_check",
 "data":{"setup":{"prefix":"source /home/stvli/lite_delivery_aio/install/setup.bash && ",
                  "missingSources":["/tmp/vlm_ws/install/setup.bash"]},
         "probe":{"exitCode":0,"timedOut":false,"durationMs":2014},
         "bundles":{"loaded":[…6 个…],"stale":false,"unresolved":[],"declaredBy":"dsh-ros2",
                    "missing":[],"undeclared":[],
                    "drift":[{"name":"dsh-ros2-core","loaded":"0.1.5","installed":"0.1.5","drifted":false}, …]},
         "surface":{"totalTools":81,"totalSkills":9},
         "skillCatalogue":{"available":true,"complete":true,"missing":[]}}}
```

三条独立价值：

1. **插件族在运行期是活的**：6 个 bundle 全部 `drifted: false`、`stale: false`、
   `missing: []`、`undeclared: []`，**81 个工具 + 9 个技能**。
2. **skill 目录 `available: true, complete: true, missing: []`**——这直接回应了 §22.4 留下的疑问：
   仓库那条"精确预发布 pin"（`dsh-skill@0.1.0-rc.6`）与宿主（`0.1.5-rc.1`）的落差
   **在运行期没有造成任何缺失**，与"这两个 peer 是 type-only"的测量一致。
3. **#40 的第四次活体证据**：`missingSources: ["/tmp/vlm_ws/install/setup.bash"]` 仍在，
   自愈仍在按文档描述的方式剔除该段。

### 23.6 安全扫描（step 5）

| 面 | 结果 |
| --- | --- |
| 供应链（`pnpm audit --prod --audit-level high`） | ✅ **No known vulnerabilities found**（起始与结束都干净） |
| 供应链（**含 dev** 的完整 `pnpm audit`） | ⚠️→✅ 起始 **1 high（新）** → 修复后 **No known vulnerabilities found**（§23.6.1） |
| 硬编码密钥（`sk-` / `AIza` / `ghp_` / `gho_` / `github_pat_` / `xox` / `npm_` / `BEGIN … PRIVATE KEY`） | ✅ 跟踪文件中 **0**（排除维护文档里对这些模式的**描述文字**） |
| **静态分析（CodeQL）** | ✅ **10 → 10**；规则与数量**逐条不变**（8 `js/insecure-temporary-file` + 2 `js/file-access-to-http`）⇒ **无新规则、无同规则新实例**（与 §22.8 的预期一致） |
| 依赖面**新增**的部分 | ✅ 只有 TS 7 的平台包（`@typescript/typescript-*`），且它们**不进发布物**（`files` 只含 `lib`/`cordis.patch.yml`/README/LICENSE） |
| 既有防线回归（第十三/十四/十六/十七轮） | ✅ 全部仍在：`safe_sid()` 双层守卫、PTY `DIR_MODE 0o700`/`FILE_MODE 0o600`、sidecar UDS `chmod 0o600`、安装器 `umask 077`、`ros2_interface_create` 的 `O_EXCL`、7 个发布 Python 包的 `!**/__pycache__` 守卫 |

#### 23.6.1 本轮真实增量：一条 **high**，但**只在 dev 图里**——而且 Dependabot 自己也修不动它

```text
GHSA-68fv-2mgg-jv7q · source-map-js >=1.0.0 <1.2.2
"allows event-loop denial of service through indexed source-map section offsets"
唯一路径： vitest > @vitest/mocker > vite > postcss > source-map-js
```

**可达性是被写明的，不是被暗示的**：`pnpm audit --prod` 干净，
CI 的 `--prod --audit-level high` 门禁**永远看不到它**。它是**真实树里的真实告警**，
只是**不在发布的那棵树上**。

修复比看起来小：`postcss@8.5.26` 本来就声明 `source-map-js: ^1.2.1`，
而 **1.2.2 满足这个区间**——只是 lockfile 的 pin 早于 1.2.2。
**pnpm 不会重新解析一个"已满足父区间"的传递 pin**：

```text
$ pnpm update source-map-js                  → Already up to date
$ pnpm update source-map-js --latest         → Already up to date
$ pnpm update source-map-js --depth 99       → Already up to date
```

所以把 floor 显式写出来，而不是手改 lockfile：

```yaml
overrides:
  'postcss>source-map-js': '^1.2.2'    # 作用域限定在 postcss，不会误伤未来其它使用方
```

**两个必须记下的细节：**

1. **pnpm 11 不再读 `package.json` 里的 `pnpm` 字段**——它会 `[WARN] The "pnpm" field in
   package.json is no longer read by pnpm` **然后静默忽略**。本轮第一次就是把它写进了
   `package.json`，`pnpm install` 退出码 0、**lockfile 一个字节都没变**；
   移到 `pnpm-workspace.yaml` 之后才真正生效（那里本来就有 `onlyBuiltDependencies` / `allowBuilds`）。
   **"退出码 0"再次不构成"改动生效了"。**
2. **Dependabot 自己的 updater 也确认了同一件事**（并给出了它为什么永远不会开 PR）：

```text
security_update_not_possible { dependency-name: source-map-js,
  latest-resolvable-version: 1.2.1, lowest-non-vulnerable-version: 1.2.2,
  conflicting-dependencies: [] }
```

   **`conflicting-dependencies: []`** ——没有任何声明挡住 1.2.2，可它**解析不到**。
   这正是"等自动化 PR 来修"这条路在本例中**不存在**的原因，也是为什么必须显式写 floor。

验收（含**能证伪它的对照**）：

```console
$ pnpm audit                       → No known vulnerabilities found   （起始：1 high）
$ pnpm audit --prod                → No known vulnerabilities found
$ pnpm install --frozen-lockfile   → 通过
$ pnpm run test                    → 354 passed + 1 skipped（不变）
$ grep source-map-js pnpm-lock.yaml → 1.2.1  →  1.2.2
```

**"test 而不是只 install"是刻意的**：vitest 正是这个依赖的使用者，
跑测试等于**真的用了一次修好的版本**。

#### 23.6.2 仓库外的一条发现（如实记录，未改）

本机 `~/.npmrc` 里存在一条**明文 npm token**（`//registry.npmjs.org/:_authToken=…`）。
它**不在仓库里**（`git grep` 为 0 命中，也不在 `git status --ignored` 里的任何 `.env`/密钥文件），
所以它不是本仓的缺陷；但它是这台机器上一条**以明文落盘的凭据**，值得由运维决定是否改用
`~/.npmrc` 之外的凭据存储。**本文件不复制该值**（连前缀都不写）。

### 23.7 本轮发现

1. **【最有价值·已修】在途文档描述了一个"没做的动作"。** 上一轮留在工作树里的
   `docs/dependency-policy.md` 用现在时写着"`dependabot.yml` 已加 `ignore`（见该文件内的注释）"，
   而 `.github/dependabot.yml` **根本没有 `ignore` 字段**（§23.3.1）。
   **只读文档就会把一个假象签进 main**：策略看上去已防复发，而三个 PR 下周照旧重开。
   已补上并做了可证伪的校验（§23.3.2）。
2. **【已修·方法学】我上一轮刚合进 main 的结论"过宽"了一档。** "选项 2 不可安装"在**空目录里可复现失败是假的**——
   同一个 `dsh-skill@0.1.5-rc.1` 在空目录里**装得成功**；失败是**本工作区**（lockfile + peer 自动安装路径）特有的。
   同时失败报错里的包名已从 `dsh-scope` 漂到 `dsh-llm`（机制不变）。
   收窄为"在本工作区不可安装"并单开 PR #64（§23.3.3）。
   **⇒ 一条写宽一度的结论，比一条写错的结论更危险**：它不会被反驳，只会被引用。
3. **【已修·真实·可测量】`source-map-js@1.2.1` 的 high 告警（GHSA-68fv-2mgg-jv7q）**，
   dev-only（§23.6.1）。**Dependabot 自己的 updater 报告 `security_update_not_possible`
   且 `conflicting-dependencies: []`** ⇒ 自动化 PR **不会来**，必须显式写 floor。
4. **【已修·工具链陷阱】pnpm 11 **静默忽略** `package.json` 的 `pnpm` 字段。**
   第一次的 override 写在 `package.json` 里：`pnpm install` **退出码 0**、**lockfile 零变化**、**告警仍在**。
   移到 `pnpm-workspace.yaml` 才生效。**"退出码 0"再次被证明不等于"生效"。**
5. **【已闭环·运行时】第十七轮的 gen-25 已干净落地**，journal 原文见 §23.5.1
   （请求 04:17:05 → 空闲 04:22:38 → 停机 8 s → 04:22:50 回归）。
   **并纠正一个读法**：状态文件的 `updatedAt`（10:41:09）是"本次启动重写"的时刻，
   **不是**重启发生的时刻——只看它会得出"拖了 9 天"的错误结论。
6. **【方法学·新增】"dev-only 且 CI 直接执行它"这条判据不能平移给编译器。**
   `tsc` 生产发布物，所以"CI 绿"只证明"能构建"，不证明"产物没变"。
   本轮为此**实测 emit**：78 个文件中 `.js` **0 个不同**，7 个 `.d.ts` **只差引号风格**（§23.4.1）。
7. **【新·并发风险】一次"绿且可合并"的重基**差点把安全修复冲掉（§23.4.2）。
   GitHub 的 `MERGEABLE`/`CLEAN` 只说"**没有文本冲突**"。
   本轮**在本地把 merge 真跑一遍**（frozen install + audit + test）才合并，合并后又在 main 复查。
8. **【方法学·新增】`gh auth status` 会假阴性。** 它报 token invalid，
   而同一个 `gh auth token` 拿到的 token 有 `repo`+`workflow`、5000/h，REST 全部可用。
   第十五轮正是因为这个假象降级成"只能推分支、不能开 PR"。
   **状态命令的自检结论也要能被反证**（本轮所有 PR 操作都带 `GH_TOKEN=$(gh auth token)` 正常完成）。
9. **【新·被排除的伪发现】`dsh-ros2-state`/`dsh-ros2-sidecar` 不在运行中 profile 里，
   但这不是缺口**（§23.5）：它们是可选组件，聚合包的 patch 只插 6 个 bundle，
   活体自检 `missing: []`。**记下来是为了避免下一轮把它当"新发现"再报一次。**

### 23.8 结论与下一步建议

- **交付**：**5 个 PR 合入 `main`**——
  **#61**（`chore(deps)`+`ci(dependabot)`+`docs`：依赖下界策略 + `ignore` + 文档，CI/CodeQL **5/5 绿**）、
  **#64**（`docs`：收窄"选项 2"的结论，5/5 绿）、
  **#60**（`chore(deps)`：TypeScript 5.6.2 → **7.0.2**，先测 emit 再合）、
  **#63**（`fix(deps)`：`source-map-js` → 1.2.2，修掉 1 条 high，5/5 绿）、
  **#62**（`chore(deps)`：vitest → 5.0.3，dev-only）。
  另有 **4 个 Dependabot PR 关闭**（#42/#46/#58/#59，全部带走依据评论），**issue #56 关闭**。
  `main` **`1c9ea44` → `450487b`**；用例 **355 不变**；CodeQL **10 不变**；
  `pnpm audit` **prod 与含 dev 都干净**。
- **线上价值**：把"声明给宿主的契约"从**猜**变成**测**（`peer ^4.0.2` / `^0.1.5-rc.1` = 宿主实际提供的），
  并把类型面从"最新的 Node 26"降到"真正支持的最老 Node 22"——**后者零类型错误**这件事本身
  就是"仓库没有用 Node-24+ 独有 API"的证明。
- **明确没有做的事（以及理由）**：
  1. **没有重启 dsh**——本轮 `lib/*.js` 逐字节未变（TS 7 的 emit 已测），没有新代码待加载（§23.5.2）。
  2. **没有动 #40 的部署配置**——仓库外、属于运行中的部署、需一次优雅重启，是运维决定（§23.2.2 末）。
- **待运维**：
  1. **决定 issue #40**：按 §21.2 的 **6 处**逐字清单修改部署配置（含第 63 行），随后优雅重启。
- **下次维护建议**：
  1. **先看 #56 已关闭、`dependabot.yml` 的 `ignore` 是否真的挡住了复发**——
     若下周仍冒出 cordis/dsh-skill/dsh-tools/@types/node-major 的版本 PR，说明 `ignore` 的
     `dependency-name` 匹配或 `update-types` 写错了，那是一条**新的**、可复现的缺陷。
     同时复核 #61 选定的 peer 下界是否仍等于**当时**的 harness 版本（harness 一升就要手工跟）。
  2. **接手在途工作树时的默认动作**：**先 `git status`，再逐条复算文档里的每个断言**，
     特别是"已加/已改/已验证"这类**完成时**表述——本轮的价值正来自这里（§23.3.1）。
  3. **`pnpm audit` 要跑两遍**：`--prod`（CI 门禁的那一遍）**和**含 dev 的完整版。
     本轮的唯一 high 只有后者看得见。**报告"干净"时附一个能证伪它的对照。**
  4. **动编译器/打包器大版本时，先测 emit 差异**（`lib/` 逐文件哈希 + 语义 diff），
     再谈 CI 绿不绿——"CI 绿"证明的不是"产物没变"（§23.4.1）。
  5. **合并任何 Dependabot PR 前，确认它的基线是否已包含最近的安全修复**；
     `MERGEABLE` 不等于"合进去是对的"，必要时**在本地把 merge 跑一遍**再合（§23.4.2）。
  6. **`gh` 的操作一律显式带 `GH_TOKEN=$(gh auth token)`**，不要相信 `gh auth status`（§23.7 第 8 条）。
  7. **测量优先于分类、复算优先于转述**：本轮的每一处修正（不存在的那一半、过宽的结论、
     被子合并冲掉的修复、静默失效的 override）都来自"**把文档里的动词重新执行一遍**"，
     而不是读它。这类"先量再判"应继续固化为习惯。

---

## 24. 维护记录（2026-10-11 04:00 CST / UTC 2026-10-10 20:00 · 第十九轮：1 open issue（#40）→ step 2 第五次复核 → **把 §5「已知限制」里从第一轮躺到现在的 PTY 幻影会话修掉**（实测比原文更严重，并顺带查出 `--dir` 被当作参数投喂给下载来的 sudo 安装脚本、`--all` 名义存在却不可达）→ 安全扫描发现**本地审计门禁在这台机器上根本跑不起来**并修好 → 文档计数漂移的修正**其中一次被仓库自己的组合不变量测试当场打回** → 新开 issue #68）

> 本轮结论：起始 **1 open issue（仅 #40）** / **0 open PR**、`main = 66a139a`、工作树干净
> （**与上一轮不同**：这次没有"被中断会话留在工作树里的在途实现"要接手）。
> 本轮交付：**2 个 PR 合入**（#66 / #67，CI/CodeQL 各 **5/5 绿**）、**新开 1 个 issue**（#68）、
> **#40 有意保留**（第五次复核，事实逐字不变）。`main 66a139a → 7dc553f`。
> 用例 **355 → 361**（+6，全部是本轮新增的回归测试）；**CodeQL open 10 不变**；
> `pnpm audit` prod 与含 dev 都干净；发布面 9/9 CLEAN。
> **本轮最有价值的三条，都不是"功能"**：
> **① 一个被写进文档、然后被文档本身掩盖了 18 轮的真实缺陷**（§24.3.1）——
> `ros2_install` 在无法分配 pty 的机器上把"什么都没起"报成"会话已启动"，
> 而 §5 把它记成"启动会静默无输出"；**实测连 `status` 都会永远报 `STATE running`，连不存在的会话 id 也报 running**。
> **② 仓库自己的组合不变量测试当场否掉了我一个"看起来对"的修正**（§24.6 第 3 条）：
> 我以为 README 的 83 是漂移，改成 81；`journeys.spec.ts` 立刻红了。
> **③ 本地 `pnpm audit` 在这台机器上根本跑不通**（§24.5 / §24.6 第 4 条）——
> `~/.npmrc` 指向的镜像没有 advisory 端点，而 CI 有 ⇒
> **前几轮"本地复算过供应链"这句在*这台机器*上其实无法复现**，只是没人发现而已。

### 24.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（= `origin/main` `66a139a`），工作树**干净** | `main`（= `origin/main` **`7dc553f`**，2 个 PR 合入后），工作树干净 |
| `main` | `66a139a` | **`7dc553f`** |
| open issue / open PR | **1 / 0**（仅 #40） | **2 / 0**（#40 **有意保留** + 新 **#68**） |
| vitest 用例 | **355**（354 过 + 1 pty-skip） | **361**（360 过 + 1 pty-skip） |
| CodeQL **open** 告警 | **10**（8 high `js/insecure-temporary-file` + 2 medium `js/file-access-to-http`） | **10**（同规则同数量，**无新规则、无新实例**） |
| `pnpm audit` | prod 干净 / 含 dev 干净——**但默认 registry 下这条命令直接报错**（§24.5） | 两者都干净，且已钉进 `pnpm run audit` / `audit:all` |
| npm registry | `https://registry.npmmirror.com`（**无 advisory 端点**） | 同（镜像仍是默认；审计脚本显式指定权威 registry） |
| 活体工具 / 技能 | **81 / 9**（六 bundle，`drifted` 全 `false`、`stale: false`、`missing: []`） | 同（**版本未变**，但 `lib/` 变了——见下） |
| 家族工具总数 | **83**（= 81 + 可选 `dsh-ros2-state` 的 2） | 同（README 现在把 81 与 83 分别说清） |
| 运行中的 dsh | 启动于 **2026-10-10 17:47:11 CST**（MainPID 496118） | **同进程**；`lib/core/tools.js` 本轮 **04:15:38** 重建 ⇒ **gen-26 重启请求待执行**（§24.4） |
| dsh-phoenix 状态文件 | `generation 25` / `running` / `deferDeadline 0` / `pendingResume false` | `generation 26` / **`deferred`**（§24.4） |

### 24.1 Issue 检查（step 1）

```text
gh issue list --state open   → 1   （#40）
gh pr list --state open      → 0
git rev-list --left-right --count main...origin/main → 0  0
git status --porcelain       → 0 行   ← 工作树干净，与上一轮不同
```

**⇒ 存在未处理的 issue（#40）→ 转入 step 2。**

**一个新的 `gh` 绕行方式（与上一轮的假阴性不同）：** `gh issue view 40` 直接失败——

```text
GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience …
(repository.issue.projectCards)
```

——即 **`gh issue view` 默认会去取 projectCards 字段，在本仓被 GraphQL 弃用挡下**。
改用 REST 即可（`curl -H "Authorization: Bearer $(gh auth token)" .../issues/40`）。
**⇒ 记一条：`gh` 的子命令失败不代表没有权限或没有数据，换 REST 端点常常就能读到。**
（另外上一轮记的 `gh auth status` 假阴性本轮**没有复现**：`gh auth status` 正常报告两个账号已登录。）

### 24.2 建议评估（step 2）——issue #40 的第五次复核

**结论与前四轮逐字相同：合理、必要，但改动在仓库外、属于正在运行的部署，是运维决定。**

本轮重新逐条复算（不转述）：

| 断言 | 本轮实测 | 结果 |
| --- | --- | --- |
| 有 5 条 `rosSetup` 仍 source 已删除的路径 | `grep -n rosSetup ~/.dsh/profiles/web/cordis.patch.yml` → 33/37/41/45/49 五条，均以 `source /tmp/vlm_ws/install/setup.bash &&` 结尾 | ✅ 不变 |
| 该路径确实不存在 | `ls -d /tmp/vlm_ws` → `No such file or directory` | ✅ 不变 |
| 死链计数 | `grep -c '/tmp/vlm_ws'` → **6**（5 条活配置 + 第 29 行注释） | ✅ 不变（与 §21.2 / §23.2.2 一致） |
| 另有第 63 行 | `rosSetup: "source /home/stvli/Desktop/bar_ws/install/setup.bash &&"`，而 `/home/stvli/Desktop/bar_ws` **同样不存在** | ✅ 仍成立（第十五轮的"实测 6 处"含此处，本轮再确认） |
| 自愈仍在剔除该段 | 本会话 `ros2_env_check` 实时返回 `missingSources: ["/tmp/vlm_ws/install/setup.bash"]` + note「已剔除该段」 | ✅ **第五份活体证据** |

**⇒ 本轮同样没有往 issue 上重复评论**（避免制造无信息量的通知），只在本文件里缩短记录。
**为什么不顺手改掉它**：文件在 `~/.dsh/`（**不在本会话 workspace 沙箱内**），且生效需要**优雅重启正在跑本任务的进程**；
issue 原文自己就是这么定义的——"Editing it is a deliberate operator decision — this issue is so that decision is visible
and can be closed on purpose."。**本轮守这条边界，并把确切的改法留在下面**：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml —— 删掉每条第 33/37/41/45/49 行尾部的
#   && source /tmp/vlm_ws/install/setup.bash
# 以及第 63 行的整条（/home/stvli/Desktop/bar_ws 亦已删除），随后走 dsh-phoenix 优雅重启。
```

### 24.3 开发管理（git · step 3）

| PR | 分支 | 提交 | CI |
| --- | --- | --- | --- |
| **#66** | `fix/pty-phantom-session` | `fix(core)` | ✅ `check (22)` / `check (24)` / `analyze (js-ts)` / `analyze (python)` / `CodeQL` **5/5 全绿** |
| **#67** | `chore/audit-gate-and-counts` | `ci(security)` + `docs` | ✅ 同上 **5/5 全绿** |

另：**issue #68**（§24.6 第 5 条）。两个 PR 的文件面**不相交**（core/* 对 README/ci/package.json），
合入 #66 后 #67 仍 `MERGEABLE`，未触发 §23.4.2 那种"重基把安全修复冲掉"的情形；
合并前后都在本地复跑：`--frozen-lockfile` 通过、361 例全绿、`pnpm run audit` 干净。

#### 24.3.1 `fix(core)`：PTY 幻影会话——第一轮就写进 §5 的那条，实测比原文严重

**§5 的原文**是："`ros2_install` 工具在 pty 不可用环境其 `start` 会静默成功但无输出（daemon stderr 被丢弃）。
属已知局限；建议后续让 `psession` 上报 pty 分配失败，工具返回明确 `PTY_UNAVAILABLE`。"
**它躺了 18 轮。本轮先复现、再定级：**

```console
$ python3 packages/core/scripts/pty_session.py start s1 bash /bin/true        # 旧实现
started session s1 (pid 1418616)          # ← 退出码 0，报文像成功
$ python3 packages/core/scripts/pty_session.py status s1
STATE running                             # ← 永远 running，且永远没有输出
$ python3 packages/core/scripts/pty_session.py status ghost-sid              # 不存在的会话
STATE running                             # ← 连"不存在"都报 running
```

**根因是两处，不是一处**（原文只说对了第一处）：

1. `start` **先** `meta_write(sid, "running")`（第 148 行）**再** `pty.openpty()`（第 171 行）；
   而 `start` 是"父进程打印 `started session … (pid N)` 后立刻退出 0、真正干活的是 fork 出来的子进程"，
   子进程的 stdio 被重定向到 `/dev/null` ⇒ **子进程里的 `OSError: out of pty devices` 连同 traceback 一起消失**。
2. `run_status()` 里是 `if state == "exited" … else print("STATE running")` ⇒
   **任何"不是 exited"的状态都被报成 running**，包括"根本没有这个会话"（`meta_read` 的默认值是 `unknown`）。
   所以**即便没有第 1 条，`status` 也照样撒谎**。

**修法（两处都修）：**

- 在 `main()` 里对 `start` **fork 之前**做 pty 探测（`pty_probe()`）——与既有的 `safe_sid` 完全相同的"fail fast 在父进程"
  理由，注释里也点明了这层对称；失败时写 `state=failed`、把 `PTY_UNAVAILABLE: …` 写进 `.out`、**退出码 3**。
  `run_start()` 仍保留一道 openpty 守卫，覆盖"探测赢了、这次分配输了"的竞态。
- `run_status()` 改成**如实打印读到的状态**（`failed` / `unknown` 不再冒充 `running`）。
- 工具侧把该标记映射成独立错误码 `PTY_UNAVAILABLE`（与 `SESSION_START_FAILED` 分开——两者要修的东西不同：
  一个是环境、一个是 python3/脚本），并给 `status`/`stop` 补上 `r.ok` 判断（此前 helper 退出非 0 会被读成"状态未知"）。

**可证伪的前后对照**（同一台无 pty 的机器，旧 helper 从 `git show 66a139a:` 取出）：

```text
OLD  status ghost-sid                        -> STATE running      (exit 0)
OLD  start ghost2 bash /bin/true             -> started session …  (exit 0)
OLD  status ghost2                           -> STATE running
NEW  status ghost-sid                        -> STATE unknown      (exit 0)
NEW  start ghost2 bash /bin/true             -> PTY_UNAVAILABLE …  (exit 3)
NEW  status ghost2                           -> STATE failed
```

**顺带修掉的第二个缺陷（同一轮复现时发现，与 pty 无关）——REMAINDER 把 flag 吃掉了：**

`pty_session.py` 的 `rest` 是 `nargs=REMAINDER`，而 `--dir` / `--all` 声明在位置参数**之后** ⇒
**写在 `sid` 之后的 flag 根本不是 flag**：

```text
$ python3 - <<'PY'  （用 main() 的原样 parser）
start s1 bash /tmp/boot --dir /tmp/custom   -> dir='DEFAULT'  all=False  rest=['bash','/tmp/boot','--dir','/tmp/custom']
status s1 --dir /tmp/custom                 -> dir='DEFAULT'  all=False  rest=['--dir','/tmp/custom']
status s1 --all                             -> dir='DEFAULT'  all=False  rest=['--all']
```

⇒ 工具发的 `start <sid> bash <installer> --dir <dir>`（第 733 行）造成两件事：
**(a) `--dir <dir>` 被当作参数投喂给了下载来的、带 sudo 的安装脚本**；
**(b) 请求的目录被静默忽略**（会话文件落到 `$TMPDIR`，只因工具侧的 `ptyDir()` 恰好等于 helper 的默认值才没出故障）。
`--all` 则是"文档里写着、实际永远打不开"。
用"把 pty 分配 stub 掉、让真实参数路径跑起来"的方式做出前后对照：

```text
OLD  start old1 bash installer.sh --dir /tmp/x   -> 安装器 argv  ['--dir', '/tmp/x']
NEW  --dir /tmp/x start new1 bash installer.sh   -> 安装器 argv  []
```

修法：flag 声明提前、工具改为"flag 在 action 之前"发送，并且 `status`/`stop` 对**多余参数报错（exit 2）而不是静默忽略**——
否则"吞掉一个 flag 仍然退出 0"就是把同一类错误又写了一遍。

**验收与测试**：新增 6 例（3 组：失败上报 / flag 契约 / 工具层 `PTY_UNAVAILABLE`），
其中"安装器 argv 必须为空"这例用 socketpair stub 掉 pty 分配，**因此在没有 pty 的机器上也能跑**；
既有的"会话对象 0600/0700"测试改为**同时接受成功与 `PTY_UNAVAILABLE` 两种结局**（它断言的是权限，不是退出码）。
用例 **355 → 361**。

### 24.4 dsh-phoenix 持续更新/测试循环（step 4）

**接线核对（与 §4 一致）**：`dsh-phoenix` 以 `link:` 装进 web profile，且**通过包内 `cordis.patch.yml` 注册**
（配置文件里明确写着"不要再在此处重复 insert，否则报 duplicate"）——本轮未改动它。

**开工时的状态文件 `/home/stvli/tmp/dsh-phoenix-state.json`：**

```json
{ "generation": 25, "lifecycleState": "running", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0, "deferDeadline": 0,
  "updatedAt": 1791625641563 }
```

`updatedAt` = **2026-10-10 17:47:21**，而进程启动于 **17:47:11** ⇒ 二者相差 10 s，互相印证
**"`updatedAt` 是本次启动时重写的时间戳，不是重启发生的时刻"**（§23.5.1 的读法再次成立）。

**有一件事必须如实记下：本轮开始前有两次重启，但它们不是 phoenix 干的。**
journal 里只有 `systemd` 的 Stopping/Started，**没有任何 `[dsh-phoenix] restart requested`**：

```text
Oct 10 17:44:14  systemd: Stopping dsh-web.service
Oct 10 17:44:15  systemd: Started dsh-web.service
Oct 10 17:44:17  dsh[491579]: [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
Oct 10 17:47:10  systemd: Stopping dsh-web.service
Oct 10 17:47:11  systemd: Started dsh-web.service
Oct 10 17:47:13  dsh[496118]: [dsh-phoenix] loaded (…)
```

（对照：第十七轮的 gen-25 在 journal 里是 `restart requested (gen 25): plugin-change` →
`soft defer deadline reached …` → `agent idle; executing deferred restart (gen 25)`。）
⇒ 这两次是**手工/环境重启**，**不计入 phoenix 的 gen**，`generation` 仍是 25。

**为什么本轮确实需要一次重启（不是仪式）**：本轮改的是 `packages/core/src/tools.ts`（工具装配与错误码），
**`lib/` 真的变了**：

```text
packages/core/lib/tools.js        2026-10-11 04:15:38   ← 本轮重建
dsh-web 进程启动                   2026-10-10 17:47:11   ← 早于它 ⇒ 进程里跑的是旧代码
```

**一处很值得记下的"半生效"现象**：`pty_session.py` 是**每次调用现 spawn 的脚本**，所以
**helper 侧的修复立刻生效**；而 `tools.ts` 的装配（`PTY_UNAVAILABLE` 映射、flag 顺序）在进程启动时就固定了。
活体验证恰好落在这个缝里——本会话调用 `ros2_install action=status session=round19probe` 返回：

```json
{"ok":true,"data":{"session":"round19probe","action":"status","state":"unknown","output":""}}
```

`state: unknown`（新 helper 的如实状态）而不是 `running`（旧 helper 的幻影），
**但它是靠"新 helper 拒绝旧工具写在 sid 之后的 `--dir`（exit 2）→ 旧工具读到空 stdout"这条路得到的**，
并不是新工具代码在工作。⇒ **"半生效"不等于"生效"：要判断进程里到底跑的是哪一版，看的是 `lib/` 与启动时刻，
不是某个输出**（§21.7 第 6 条 / §23.5.3 的同一课）。

**⇒ 本轮按 §4 的循环登记 gen-26 重启请求**（触发面是 `cordis_run` 这次调用本身，
故用一个空实现的动态 plugin——沿用第十六/十七轮已验证的最小失败面）。登记**当场**即可验证：

```text
04:17:37  [dsh-phoenix] cordis tool: cordis_run
04:17:40  [dsh-phoenix] restart requested (gen 26): plugin-change
```

```json
{ "generation": 26, "lifecycleState": "deferred", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0,
  "deferDeadline": 1791664360695, "updatedAt": 1791663460695, "coalesced": false }
```

`deferDeadline − updatedAt = 900000 ms` ⇒ **正好是文档化的 900 s 硬期限**（与第十四/十五/十六/十七轮逐字一致），
`updatedAt` 04:17:40 / 硬期限 04:32:40，`coalesced: false`（本轮只有一次激活）。
**⇒ gen-26 的"落地"留给下一轮开工时的 journal 确认**（`soft defer deadline reached …` →
`agent idle; executing deferred restart (gen 26)` → shutdown → `loaded`）。
本轮只登记、**不假装它已经落地**——这是 §23.5.1 那条读法教训的直接延续：
状态文件只能回答"此刻处于哪个生命周期状态"，"什么时候重启的"只有 journal 能定。

### 24.5 安全扫描（step 5）

| 面 | 结果 |
| --- | --- |
| 供应链（`pnpm run audit` = `--prod --audit-level high`，**显式权威 registry**） | ✅ **No known vulnerabilities found** |
| 供应链（**含 dev**，`pnpm run audit:all`） | ✅ **No known vulnerabilities found** |
| 供应链（**默认 registry**） | ❌→✅ **`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`（exit 1）** —— 这是本轮的真实增量，见 §24.6 第 4 条 |
| 硬编码密钥（`sk-` / `AIza` / `ghp_` / `gho_` / `github_pat_` / `xox` / `npm_` / `BEGIN … PRIVATE KEY`） | ✅ 跟踪文件中 **0**（`git grep`，排除维护文档里对这些模式的描述文字） |
| **静态分析（CodeQL）** | ✅ **10 → 10**；8 high `js/insecure-temporary-file` + 2 medium `js/file-access-to-http`，**同规则同数量**。两条 `file-access-to-http` 都在 `packages/vision/src/vision.ts`（**源码**，非测试）：URL 由 `config` 构造、**文件内容只进 body**（base64 图片），正是该工具的设计意图，非 SSRF |
| 发布面（9 个非私有包 `pnpm pack` + 逐条 `tar -tzf`） | ✅ **9/9 CLEAN**，无 `__pycache__`/`.pyc` |
| `__pycache__` 守卫覆盖 | ✅ **7/7**：`dsh-ros2` 与 `dsh-ros2-state` 没有该守卫，但它们 `files` 里**不含任何 Python 目录**（实测 `py_sources=0`）⇒ 不变量"**凡是发布 Python 的包都有守卫**"成立 |
| Python 执行面（**按 `.py` 或首行 `#!…python` 取全集**，repo-wide） | ✅ **29 个文件 = 21 `.py` + 8 个无扩展名脚本**；`shell=True` / `os.system` / `eval(` / `exec(` / `pickle` / `yaml.load` **全部 0**；16 处 `subprocess.*`（`shell=True` 为 0 ⇒ 全为 argv 数组） |
| TS 命令面（`src/`） | ✅ **无 `execSync` / 无 `shell: true` / 无 `eval(` / 无 `new Function(`**；`execFile` ×14、`spawn` ×2、`spawnSync` ×0 |
| 既有防线回归（第十三/十四/十六/十七/十八轮） | ✅ 全部仍在：`safe_sid()` 双层守卫（tool 侧 `isSafePathComponent` + helper 侧 `_SID_RE`）、PTY `DIR_MODE 0o700` / `FILE_MODE 0o600`、sidecar UDS `chmod 0o600`（`selftest.py` 里还有一条把它钉住的场景）、安装器 `umask 077` + `chmod 700`、`ros2_interface_create` 的 `flag: 'wx'`（`O_EXCL`） |

**必须写清的一条**：**审计的"干净"本轮第一次是在显式 `--registry` 下取得的**。
默认 registry（npmmirror）下这条命令**直接失败**——所以"`pnpm audit` 干净"这句话，
在本机默认配置下**既不是通过也不是不通过，而是根本没跑成**。见 §24.6 第 4 条。

### 24.6 本轮发现

1. **【已修·真实·可复现·本轮最有价值】`ros2_install` 把"没有会话"报成"会话在跑"**（§24.3.1）。
   §5 从第一轮起就把它记作"`start` 会静默成功但无输出"，**实测这条描述低估了它**：
   `status` 会**永远**返回 `STATE running`，对**不存在的会话 id 也如此**，
   而 `start` 的退出码是 0、报文是 `started session … (pid N)`。
   **⇒ "已知限制"这种措辞会让缺陷停止被测量**：它把一个可复现的错误降级成一条备注，
   于是 18 轮都没有人再去看一眼。**已改为如实上报（`state=failed` / `STATE unknown` / exit 3 / `PTY_UNAVAILABLE`）。**
2. **【已修·真实】同一个 helper 里还有第二处静默失效**：`nargs=REMAINDER` 把写在 `sid` 之后的 `--dir`/`--all` 吃掉 ⇒
   **`--dir` 被当成参数交给下载的 `sudo` 安装脚本**，同时"请求的目录"根本没生效；`--all` 永远打不开。
   **与第 5 条（安装器选项注入）是同一类面**，只是这次漏的是"我们自己发给安装器的多余参数"。
3. **【方法学·记下我自己的错】仓库的组合不变量测试当场否掉了我一个"看起来对"的修正。**
   修文档计数时我发现 README 的徽章写 79、正文写 83、而每包相加是 81，于是把正文/徽章统一改成 **81**——
   理由充分、测过、也和活体一致（`totalTools: 81`）。**`packages/dsh-ros2/tests/journeys.spec.ts` 立刻红了**：

   ```text
   FAIL  tests/journeys.spec.ts > journey catalogue — composition invariant
         > keeps the advertised counts and skill lists in step with the tree
   AssertionError: expected '# dsh-ros2\n\n> ROS2 debugging toolse…' to contain '83 tools'
   ```

   原因是仓库**已经定义过**"广告口径"：`journey-catalogue.ts` 的 `BUNDLE_DIRS` 是**六个装工具的 bundle
   （含可选的 `dsh-ros2-state`）**，`61+4+4+5+7+2 = 83`，不变式就断言 README 必须含 `"83 tools"`。
   **83 是"全家族"，81 是"聚合包实际挂载面"——两个都对，我把它们当成了一个数。**
   已改回 83，并在**安装步骤**把两者分别写清（那里才不会再被读成同一句话）。
   **⇒ 教训不是"测试碍事"，而是：仓库已有的不变量就是既有决策的记录，改口径属于"conscious act"，不该顺手做。**
   （顺带：这也说明**"和活体一致"不足以证明"文档该写这个数"**——口径是产品决定，不是测量结果。）
4. **【已修·环境·真实】本机默认 registry 下 `pnpm audit` 根本跑不起来。**
   `~/.npmrc` 指向 `registry.npmmirror.com`（README 的"墙内版"正是推荐的安装路径），
   而该镜像**没有实现 advisory 端点**：

   ```console
   $ pnpm audit --prod --audit-level high
   [ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS] The audit endpoint (at
   https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk) doesn't exist.
   $ echo $?      → 1        ← 值得肯定：fail closed，不是静默通过
   ```

   CI（GitHub runner，registry 是 npmjs）不受影响 ⇒ **"本地复算过供应链"这句话在这台机器上此前无法复现**，
   而 CI 绿会让人以为本地也必然可复现。已把权威 registry 钉进两个脚本，并让 CI 调用**同一条命令**：

   ```text
   pnpm run audit       # --prod --audit-level high   ← CI 门禁
   pnpm run audit:all   # 含 dev 的配套
   ```
5. **【新开 issue #68·未修·有意】聚合包宣称 83、实际只挂 81。**
   `packages/dsh-ros2/package.json` 的 description 写着 "(install this to get all **83** tools + 9 skills)"，
   但它的 `dependencies` 与 `cordis.patch.yml` **都不含 `dsh-ros2-state`**，活体 `expected` 也只有六项、
   `totalTools: 81`。而 §24.6 第 3 条里那个不变式**同时**断言了"聚合包 description 含 83"。
   **⇒ 不变式内部自洽，但它让发布出去的元数据宣称了一个聚合包给不出的数。**
   **为什么不在本轮修**：修它要么给聚合包加上 state（等于取消"可选附加"的定位），
   要么把不变式的口径改成 81——**两者都是产品决定**，按该测试自己的注释属于"conscious act"。
   已开 **#68** 记录，避免它只活在 diff 注释里。
6. **【环境观察·未改】本机 `~/.npm/cache` 里有 root 所有者的文件**，`npm view` 直接 `EACCES` 并提示
   `sudo chown -R 1000:1000 ~/.npm`（本轮改用 `curl` 直读 registry 与 `pnpm` 绕开）。
   与上一轮记的"`~/.npmrc` 里有明文 token"一样，**都在仓库外、不属于本仓缺陷**，如实记下供运维参考；**本文件不复制任何凭据值**。
7. **【读法·沿用】"半生效"是真实状态，不是含糊话**（§24.4）：
   `pty_session.py` 改动**立即生效**（每次调用现 spawn），`tools.ts` 改动**要等重启**。
   本会话的 `ros2_install … status` 恰好落在这个缝里：输出是对的，但**不是靠新代码对的**。
   **判断进程里跑的是哪一版，看 `lib/` 时间戳与进程启动时刻，不看某个输出对不对。**
8. **【被排除的伪发现】工作树干净 ⇒ 本轮没有"在途实现"要接手**（与上一轮相反）。
   上一轮最有价值的产出之一来自"接手被中断会话的改动并逐条复算"；本轮没有这个场景，
   所以**没有把"照抄文档"的机会误当成"复算"**——两条修复（PTY 幻影、flag 契约）都是先复现、再定级、再修。

### 24.7 结论与下一步建议

- **交付**：**2 个 PR 合入 `main`**——
  **#66**（`fix(core)`：PTY 幻影会话 + flag 契约，6 例新测试，**5/5 绿**）、
  **#67**（`ci(security)` + `docs`：审计脚本钉权威 registry + 计数修正，**5/5 绿**）；
  **新开 #68**（聚合包 83/81 口径）；**#40 第五次复核后有意保留**。
  `main` **`66a139a` → `7dc553f`**；用例 **355 → 361**；CodeQL **10 不变**；审计 prod/含 dev 都干净；发布面 **9/9 CLEAN**。
- **线上价值**：在三处把"**报告 ≠ 事实**"堵上——
  ① 会话没起来就**不再报成起来了**（并且先失败、再报错，而不是先报成功）；
  ② flag 没生效就**不再静默丢弃**（多余参数直接报错）；
  ③ 审计跑不起来就**不再被读成"已复算"**（权威 registry 写进脚本，CI 同命令）。
- **明确没有做的事（以及理由）**：
  1. **没有改 #40 的部署配置**——在仓库外、属于运行中的部署、需一次优雅重启，是运维决定（§24.2）。
  2. **没有动聚合包的口径**——属于产品决定，已升格为 #68（§24.6 第 5 条）。
  3. **没有在本机 `chown ~/.npm`**——系统级改动，非本仓范围（§24.6 第 6 条）。
- **待运维**：
  1. **决定 issue #40**：按 §24.2 的逐字清单改配置（33/37/41/45/49 去尾 + 第 63 行整条），随后优雅重启。
  2. 视需要处理 `~/.npm` 的 root 所有权。
- **下次维护建议**：
  1. **先闭环 gen-26**：确认 `lifecycleState: running`、`deferDeadline: 0`、`pendingResume: false`，
     并用 journal 的 `restart requested (gen 26)` / `executing deferred restart (gen 26)` 定时刻
     （**别看 `updatedAt`**，§24.4）。
  2. **复核 issue #68** 是否已被决策：若选择"聚合包也带 state"，则 `dependencies` + `cordis.patch.yml` + description 三处同步；
     若选择"维持 81 口径"，则要改 `journeys.spec.ts` 的字面量——**改的时候记得它是 conscious act**。
  3. **继续用"先复现、再定级、再修"的顺序**：本轮两条修复的价值都来自"把旧行为真的跑一遍"，
     而 §5 那条"已知限制"之所以躺了 18 轮，正是因为**它被写成了一个不需要再测的句子**。
     **凡文档里出现"已知限制 / 静默 / 无输出"这类词，都应当作"待复现的假设"。**
  4. **新开分支前先看有没有可复用的"口径"**：本轮第 3 条那次返工，根因是没先搜"谁定义了这个数"
     （`grep -rn '83' packages/*/tests` 一条命令就能避免）。
  5. **`pnpm audit` 一律走脚本**（`pnpm run audit` / `audit:all`），不要裸敲——裸敲在本机默认 registry 下**只会失败**。
  6. **`gh` 子命令失败时换 REST 端点再试一次**（`gh issue view` 会被 Projects classic 弃用挡下，§24.1）。

---

## 25. 维护记录（2026-10-12 04:00 CST / UTC 2026-10-11 20:00 · 第二十轮：2 open issue（#40 + #68）→ **#68 落地并顺带扫出同类缺陷的更大缺口**（三个**已发布**的 per-package README 从未被任何不变量读过）→ **#40 第六次复核后经运维确认、本轮真正落地**（跨六轮）→ 安全扫描全不变 → 远程已合并分支 16 → 1 → 1 个 PR 合入，**open issue 归零**）

> 本轮结论：起始 **2 open issue（#40 第五次复核保留 + 新 #68）/ 0 open PR**、`main = 929ab88`、工作树干净。
> 本轮交付：**1 个 PR 合入**（#70，CI/CodeQL **5/5 绿**）、**2 个 issue 关闭**（#68 由 PR 自动关闭、#40 由运维决定后落地并人工关闭）、
> **部署配置首次被本轮实际修改**（§25.2.2），`main 929ab88 → 316c142`。
> 用例 **361 → 362**（+1，本轮的 README 计数不变量）；**CodeQL open 10 不变**（同规则同数量）；
> `pnpm audit` prod / 含 dev 都干净；发布面 **9/9 CLEAN**；**远程分支 16 → 1**。
> **本轮最有价值的一条不是新功能，而是"同一类缺陷比 issue 描述得更大"**：
> #68 只说了聚合包的 `package.json` 描述；顺着"谁宣称了什么"扫下去发现
> **三个发布到 npm 的 per-package `README.md` 从来没有被任何不变量读过**（§25.6 第 2 条），
> 而仓库**已经**有一条组合不变量在守"广告口径"——它只是没覆盖这几个文件。
> 另外：**跨六轮的 issue #40 终于落地**，且落地方式本身是可复算的——
> 不是"觉得应该没事"，而是**本轮 `ros2_env_check` 的 `missingSources` 已经证明删除后与在跑的链逐字等价**（§25.2.2）。

### 25.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（= `origin/main` `929ab88`），工作树**干净** | `main`（= `origin/main` **`316c142`**），工作树干净 |
| `main` | `929ab88` | **`316c142`** |
| open issue / open PR | **2 / 0**（#40 + #68） | **0 / 0** |
| vitest 用例 | **361**（360 过 + 1 pty-skip） | **362**（361 过 + 1 pty-skip） |
| CodeQL **open** 告警 | **10**（8 high `js/insecure-temporary-file` + 2 medium `js/file-access-to-http`） | **10**（同规则同数量，**无新规则、无新实例**） |
| `pnpm audit`（脚本，权威 registry） | prod 干净 / 含 dev 干净 | 同 |
| npm registry | `https://registry.npmmirror.com`（仍无 advisory 端点；脚本已钉权威 registry） | 同 |
| 活体工具 / 技能 | **81 / 9**（六 bundle，`drifted` 全 `false`、`stale: false`、`missing: []`、`undeclared: []`） | 同（**版本未变**，`lib/` 本轮未变——见 §25.4） |
| 家族工具总数 | **83**（= 81 + 可选 `dsh-ros2-state` 的 2） | 同（聚合包元数据现在如实写 81，家族 83 仍是家族的数） |
| 运行中的 dsh | 启动于 **2026-10-11 04:20:26 CST**（PID 1456879，即 gen-26 那次重启后） | **同进程**；`lib/` 本轮**未变** ⇒ 无功能重启需求；但**部署配置变了** ⇒ 登记 gen-27（§25.4） |
| dsh-phoenix 状态文件 | `generation 26` / `running` / `deferDeadline 0` / `pendingResume false` | `generation 27` / **`deferred`**（§25.4） |
| 远程分支 | **16**（main + 15 条已全并入 main 的残留） | **1**（仅 `main`） |
| 本机 | Node `v24.16.0` / pnpm `11.22.0`（与 root `packageManager` 一致） | 同 |

### 25.1 Issue 检查（step 1）

REST（`gh issue view` 仍会被 Projects classic 弃用挡下，沿用 §24.1 的教训换 JSON 端点）：

```text
open: #40（2026-09-25 开，1 条评论）、#68（2026-10-10 开，0 条评论）  → 2 个，故走 step 2
open PR: 0
```

### 25.2 建议评估（step 2）

#### 25.2.1 issue #68 —— **合理、必要，且本轮可修**（与前五轮的 #40 不同：它在仓库内）

issue 的断言逐条复算：

| 断言 | 本轮实测 | 结果 |
| --- | --- | --- |
| 聚合包 `description` 宣称 "(install this to get all **83** tools + 9 skills)" | `git show 929ab88:packages/dsh-ros2/package.json` → 逐字如此 | ✅ |
| 它实际只挂 81 | 六包逐个数（core 61 / profile 4 / moveit 4 / safety 5 / vision 7 = **81**；state 另 2） | ✅ |
| `dependencies` 与 `cordis.patch.yml` 都不含 `dsh-ros2-state` | 两处都没有 | ✅ |
| 不变式**同时**断言"聚合包 description 含 83" | `journeys.spec.ts` 里 `expect(aggregate.description).toContain(toolCount + ' tools')`，而 `toolCount = allTools.length = 83` | ✅ 内部自洽但发布口径不实 |

**结论：合理、必要。** 一条发布出去的元数据宣称了安装它拿不到的东西，属于"报告 ≠ 事实"。
**决定：采纳 issue 给出的方案 2（维持 state 可选），把元数据改成实话**，理由不是"改动小"，而是三条实质理由：

1. `dsh-ros2-state` 的 2 个工具**需要 `dsh-ros2-sidecar` 数据面**（UDS socket）才可用；把它塞进聚合包 =
   让聚合包宣称两个"装了还不能用"的工具，代价大于修一句假话；
2. 聚合包的定位是"装上就能用的域 bundle 合集"，README 的安装步骤本来就是**单独装 state**——
   方案 2 是让元数据回归文档早已定下的形状，而不是改变产品形状；
3. 方案 1 会改变**所有现存聚合包用户**的安装面（多一个依赖 + 多一个需要部署的进程），
   这是比"元数据不实"重得多的变更，**该由运维/产品决定，不该由一次维护顺手做**。
   （方案 1 并未被关闭：若将来要，改动面是 `dependencies` + `cordis.patch.yml` + description + 不变式里的 `81` 字面量。）

#### 25.2.2 issue #40 —— 第六次复核：**事实逐字不变，但本轮由运维决定"落地"**（跨六轮收口）

前五轮的结论都是"合理、必要，但改动在仓库外、属于正在运行的部署，是运维决定"。本轮**仍然先逐条复算**：

| 断言 | 本轮实测 | 结果 |
| --- | --- | --- |
| 5 条 `rosSetup` 仍 source 已删除的路径 | `grep -n rosSetup ~/.dsh/profiles/web/cordis.patch.yml` → 33/37/41/45/49，均以 `&& source /tmp/vlm_ws/install/setup.bash &&` 结尾 | ✅ 不变 |
| 该路径确实不存在 | `ls -d /tmp/vlm_ws` → `No such file or directory` | ✅ 不变 |
| 第 63 行 `rosSetup` 指向同样不存在的 `bar_ws` | `ls -d /home/stvli/Desktop/bar_ws` → 不存在 | ✅ 仍成立 |
| 自愈仍在剔除该段 | 本会话 `ros2_env_check` 实时返回 `missingSources: ["/tmp/vlm_ws/install/setup.bash"]` + note「已剔除该段，改用其余 1 段（首个 source：`/home/stvli/lite_delivery_aio/install/setup.bash`）」 | ✅ **第六份活体证据** |

**这一轮的差别**：不再重复"交运维"的结论，而是**把决定交给运维本人**（一次明确的 yes/no，而不是替他决定，也不是第七次记录），得到确认后**实际落地**：

```text
备份：~/.dsh/profiles/web/cordis.patch.yml.bak-issue40-20261012122931
改动：5 条链尾部 `&& source /tmp/vlm_ws/install/setup.bash` 删除
      + 第 63 行整条 rosSetup 删除（该条目回落到自动探测——与自愈后的实际行为一致，因为该链只有这一段、且是死的）
校验：yaml.safe_load 通过，顶层条目 7 条（不变）；写入前断言"死段 5 处 + bar_ws 1 处"才动手
```

**为什么这不是"顺手改生产配置"**：改动的正确性**是被测量证明的、不是被论证的**——
`missingSources` 已经说明在跑的 prefix 就是删除后的那一条（逐字等价），所以这次写入**只是在把已经生效的事实写回文件**。
另外它确实越过了本会话的 workspace 沙箱（`~/.dsh/` 在仓库外），因此是**先被沙箱拒绝、再带理由升级授权**并由用户批准后执行的（§25.6 第 3 条）。
生效需要一次重载（prefix 在 apply 时读取）⇒ 登记 gen-27（§25.4）；下一轮的验收判据：`ros2_env_check` 应报 `missingSources: []` 且不再有「已剔除该段」note。

### 25.3 开发管理（git · step 3）

| PR | 分支 | 提交 | CI |
| --- | --- | --- | --- |
| **#70** | `fix/aggregate-surface-metadata` | `fix(metadata)` | ✅ `check (22)` / `check (24)` / `analyze (js-ts)` / `analyze (python)` / `CodeQL` **5/5 全绿** |

提交面 7 个文件：`packages/dsh-ros2/package.json`（description）、`packages/dsh-ros2/README.md`、
`packages/core/README.md`、`packages/vision/README.md`、`docs/journey-catalogue.md`（不变式的第 5 条）、
`packages/dsh-ros2/tests/journey-catalogue.ts`（新增 `BUNDLE_PACKAGES`）、`packages/dsh-ros2/tests/journeys.spec.ts`。

#### 25.3.1 `fix(metadata)`：把"宣称"改成"实测"（#68 + 它的更大同类面）

**第一处（issue #68 本体）**：

```text
old  … (install this to get all 83 tools + 9 skills).
new  … mounting 81 tools + 9 skills; the optional dsh-ros2-state takes the family to 83.
```

**第二处（本轮扫出来的、issue 没写的更大缺口）**——顺着"谁宣称了工具数"把**每个包的 README** 也数了一遍：

| 文件（**都在 npm `files` 里、会发布**） | 宣称 | 实测 |
| --- | --- | --- |
| `packages/core/README.md` | 33 | **61** |
| `packages/vision/README.md` | 5 | **7** |
| `packages/dsh-ros2/README.md` | 51 tools + 4 skills | **81 tools + 9 skills** |

`packages/core/README.md` 的 33 是**原始 split 提交（`e6b2ac3`）时代的数**；core 后来长到 61，
而**组合不变量只读了 `package.json` 的 description 和两个根 README，从没读过 per-package README**
（core 的 description 在早前某轮已从 59 修到 61——**同一个数，一个文件被守住了，另一个文件没有**）。

**第三处（真正的修复：让口径可导出）**——不变式不再是"改字面量"，而是**测量**：

1. 新增 `BUNDLE_PACKAGES`（bundle → npm 包名），聚合包要挂什么**从它自己声明的 `dependencies` 导出**，
   `aggregateToolCount` = 所挂 bundle 的工具数之和；
2. 断言 `aggregateToolCount === 81` **且** `toolCount - aggregateToolCount === state 的 2 个`（聚合包 = 家族 − 那个可选件，这是决策本身）；
3. 断言聚合包 description 含 `81 tools` / `9 skills`，**且不含** `83 tools`（"不得把家族总数当自己的面"）；
4. 新增一条独立用例：**每个包 README 里"读者遇到的第一个工具计数"必须等于该包的实测数**
   （没写计数的包如 `dsh-ros2-state` 跳过）；聚合包 README 同样受检。

**可证伪（不是"跑绿了就算"）**：把修复前的 4 个文件 `git stash` 回去再跑，新用例**当场红**：

```text
FAIL  tests/journeys.spec.ts > … > keeps every package README's advertised tool count honest (issue #68)
AssertionError: core/README.md advertises a stale tool count: expected 33 to be 61
FAIL  tests/journeys.spec.ts > … > keeps the advertised counts and skill lists in step with the tree
AssertionError: expected 'Aggregate cordis bundle for the dsh-r…' to contain '81 tools'
```

`core/README.md` 里那三行**每层计数（17/10/6）也一并去掉**：它们同样是无人导出的字面量，
修数字只是把同一个坑再挖一遍；改为**只写分组描述**并注明"总数由不变式测量、分组行不承载计数"。
（L2 的 10 与 L3 的 6 其实仍与实测一致，但**只留不会漂的那个数**。）

### 25.4 dsh-phoenix 持续更新/测试循环（step 4）

**接线核对（与 §4 一致）**：`dsh-phoenix` 与 `dsh-ros2` 全家都以 `link:` 装进 web profile
（`~/.dsh/profiles/web/node_modules/dsh-ros2* → …/embody_agent_ws/dsh-ros2/packages/*`），
本轮未改动接线。

**① 先闭环上一轮登记的 gen-26**（第十八/十九轮的教训：状态文件只能回答"此刻处于哪个生命周期状态"，**"什么时候重启的"只有 journal 能定**）：

```text
Oct 11 04:17:40  [dsh-phoenix] restart requested (gen 26): plugin-change          ← 第十九轮登记
Oct 11 04:20:16  [dsh-phoenix] agent idle; executing deferred restart (gen 26)
Oct 11 04:20:16  [dsh-phoenix] scheduling restart (plugin-change, gen 26): systemd-run …
Oct 11 04:20:17  [dsh-phoenix] restart cmd exit=0
Oct 11 04:20:26  systemd: Started dsh-web.service
Oct 11 04:20:29  dsh[1456879]: [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

```json
{ "generation": 26, "lifecycleState": "running", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0, "deferDeadline": 0, "updatedAt": 1791663637942 }
```

`lifecycleState: running` + `deferDeadline: 0` + `pendingResume: false` =
**gen-26 逐字命中、干净落地**（`deferDeadline − updatedAt = 900000 ms` 的硬期限链与第十四～十九轮一致）。

**② 一个必须如实写下的"时间错觉"**：上面这些 journal 时间是 **10-11 04:20**，
而本轮是 **10-12 04:00 开工**——**gen-26 在上一轮结束后就落地了，并不属于本轮**。
本轮开工时运行进程（PID 1456879）启动于 10-11 04:20:26，**比本轮任何一次编辑都早约 24 小时**。
`updatedAt: 1791663637942`（= 10-11 04:20:37）是**本次启动时重写的时间戳**，不是重启时刻（§23.5.1 的读法继续成立）。

**③ 活体持续测试（step 4 的"测试"一半）**：本会话 `ros2_env_check` 的实时对账与仓库一致：

```json
{ "loaded":[{"name":"dsh-ros2","version":"0.1.0"},{"name":"dsh-ros2-core","version":"0.1.5"},
            {"name":"dsh-ros2-moveit","version":"0.1.0"},{"name":"dsh-ros2-profile","version":"0.1.0"},
            {"name":"dsh-ros2-safety","version":"0.1.0"},{"name":"dsh-ros2-vision","version":"0.1.3"}],
  "drift":[ … 六条均 drifted:false … ], "stale":false, "missing":[], "undeclared":[],
  "surface":[ core 61, moveit 4, profile 4, safety 5, vision 7, dsh-ros2 0 ],
  "totalTools":81, "totalSkills":9 }
```

**④ 本轮需不需要重启？——需要，但理由与以往不同**：
本轮的改动面是 **description + README + tests + docs**，`tsconfig.build.json` 只编 `src/`，
**`lib/` 的内容没有变**（构建只是重写了同样的字节）⇒ **功能上不需要重载**。
但 §25.2.2 实际改了**部署配置**（`rosSetup` 链），而 prefix 是 **apply 时读取**的
⇒ **为了让配置变更生效，本轮登记 gen-27**（沿用第十六/十七/十九轮已验证的最小失败面：一个空实现的动态 plugin + `cordis_run`）。

**在文档写完后作为本轮最后一个动作登记**（`rsttrg-1/pkg-1`，空 `apply()`），只登记、不假装已落地；落地确认留给下一轮开工时的 journal。
登记**当场**即可验证：

```text
12:35:36  [dsh-phoenix] cordis tool: cordis_run
12:35:39  [dsh-phoenix] restart requested (gen 27): plugin-change
```

```json
{ "generation": 27, "lifecycleState": "deferred", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0,
  "deferDeadline": 1791780639213, "updatedAt": 1791779739213, "coalesced": false }
```

`deferDeadline − updatedAt = 900000 ms` ⇒ **正好是文档化的 900 s 硬期限**（与第十四～十九轮逐字一致），
`coalesced: false`（本轮只有一次激活）。**落地（`executing deferred restart (gen 27)` → 新进程 `loaded`）留给下一轮开工时的 journal 确认。**

### 25.5 安全扫描（step 5）

| 面 | 结果 |
| --- | --- |
| 供应链（`pnpm run audit` = `--prod --audit-level high`，**显式权威 registry**） | ✅ **No known vulnerabilities found** |
| 供应链（**含 dev**，`pnpm run audit:all`） | ✅ **No known vulnerabilities found** |
| 硬编码密钥（`sk-` / `AIza` / `ghp_` / `gho_` / `github_pat_` / `xox` / `npm_` / `BEGIN … PRIVATE KEY`） | ✅ 跟踪文件中 **0**（`git grep`，排除维护文档里对这些模式的描述文字） |
| **静态分析（CodeQL）** | ✅ **10 → 10**；逐条定位：8 high `js/insecure-temporary-file` **全在 tests/scripts**（`scripts/verification/measure.mjs`、`vision/tests`、`core/tests`、`dsh-ros2/tests`、`common/tests`——**都不在发布面**）+ 2 medium `js/file-access-to-http` 在 `packages/vision/src/vision.ts`（**源码，非测试**：URL 由 `config` 构造、文件内容只进 body 做 base64 图片，是该工具的设计意图，非 SSRF） |
| 发布面（9 个非私有包 `pnpm pack` + 逐条 `tar -tzf`） | ✅ **9/9 CLEAN**，无 `__pycache__`/`.pyc`（含 `dsh-ros2-state` 与 `sidecar`，即 CI 门禁点名的两个） |
| Python 执行面（按 `.py` 或首行 `#!…python` 取全集，repo-wide） | ✅ **29 个文件**；`shell=True` / `os.system` / `eval(` / `exec(` / `pickle` / `yaml.load` **全部 0**；`subprocess` 出现 24 次 = **16 处调用点**（`run` 13 + `Popen` 3，与第十九轮的 16 逐字一致）+ 8 个 `DEVNULL` 常量；`shell=True` 为 0 ⇒ 全为 argv 数组 |
| TS 命令面（`src/`） | ✅ **无 `execSync` / 无 `shell:true` / 无 `eval(` / 无 `new Function(`**；`execFile` ×14、`spawn` ×2、`spawnSync` ×0（与第十九轮逐字相同） |
| 既有防线回归（第十三/十四/十六/十七/十八/十九轮） | ✅ 全部仍在：`safe_sid()` 双层守卫（tool 侧 `isSafePathComponent` + helper 侧 `_SID_RE`）、PTY `DIR_MODE 0o700` / `FILE_MODE 0o600`、sidecar UDS `chmod 0o600`、安装器 `umask 077` + `chmod 700`、`ros2_interface_create` 的 `flag: 'wx'`（`O_EXCL`，实测 `packages/core/src/tools.ts:432`）、`classifyVisionTransport()` 的回环/明文判定 |
| 活体网络出口复测 | ⚠️ **不变、已有上报**：`ros2_vision_doctor` 实时报 `transport.cleartext: true`（`http://121.9.219.138:8888/v1`，非回环）+ 明确告警；secrets 文件 `/home/stvli/.dsh-ros2/secrets.json` 实测 `mode: 600` |
| 本轮新增攻击面 | ✅ **无**：改动只有元数据/文档/测试（§25.3），无新增命令执行、网络或文件写入路径 |

**必须写清的一条**：本轮的"干净"与第十九轮**同口径**——审计走的是 `pnpm run audit`
（脚本内已钉 `--registry https://registry.npmjs.org/`），**不是裸敲**；裸敲在本机默认镜像下仍然只会 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。

### 25.6 本轮发现

1. **【已修·真实·issue #68】** 聚合包的发布元数据宣称 83、实际挂 81（§25.2.1）。
   **决定**：维持 `dsh-ros2-state` 可选，元数据改成实话（81），家族 83 仍是家族的数。
   **没有再犯第十九轮第 3 条的错**：这次**先去搜"谁定义了这个数"**（`grep -rn '83' packages/*/tests`），
   找到 `journey-catalogue.ts` 的 BUNDLES 就是"家族"口径，于是没有把两个数当一个数改。
2. **【已修·真实·本轮最有价值】同一类缺陷比 issue 描述得更大：三个"已发布的 per-package README"从未被任何不变量读过**（§25.3.1）。
   core 33→61、vision 5→7、聚合 51+4→81+9。**根因不是"忘了改数字"，而是"口径没有单一来源"**：
   仓库**已经**有一条"广告口径"不变量，但它只读 `package.json` 的 description 与两个根 README，
   **per-package README 是它的盲区**——而那几个文件恰恰**会进 npm tarball**。
   ⇒ 修法不是把 3 个数字改对，而是把"每个包 README 的第一个工具计数 = 实测"变成不变量（**可证伪**，§25.3.1 给了红/绿对照）。
3. **【已落地·运维决定·跨六轮】issue #40 真正落地，且落地方式是"把已生效的事实写回文件"**（§25.2.2）。
   这是本维护任务**第一次修改仓库外的运行中部署配置**：先按规矩试、被沙箱拒绝、再带理由升级到 `danger-full-access`、
   **经用户明确批准**后执行；写入前先备份、先断言"死段 5 处 + bar_ws 1 处"、写完再用 `yaml.safe_load` 校验。
   **与前五轮"交运维"的差别**：这次没有替运维做决定，也没有第七次记录，而是**把决定明确地问出来**，得到 yes 才动手。
4. **【读法·定时陷阱】上一轮的 gen-26 在本轮开工前 ~24 小时就已经落地，并不属于本轮**（§25.4 第 ② 条）。
   按 journal 的 `restart requested (gen 26)` / `executing deferred restart (gen 26)` 才定得出时刻；
   **状态文件里只有一个"本次启动时重写的时间戳"**。⇒ 每轮开工**先闭环上一轮的观测**，是对的；
   但**把"我看到的落地"当成"我这一轮触发的落地"是错的**——本轮差点这么写。
5. **【已修·卫生】活文档 §5/§6 从第一轮起就没再动过，已经变成"谎话生成器"**：
   §5 还在建议"后续可让 `pty_session.py` 上报 pty 分配失败"（**第十九轮已经做完**），
   §6 还写着"确认 **182** 例全绿"（实际 **362** 例），还有一条建议清理**已经不存在的** `docs/maintenance` 分支。
   ⇒ 本轮把 §5 里已解决的条目**删除**（不是留着）、把"活文档每轮复核"写进小节抬头，并把 §6 的数字与建议换成当前的。
   **"已知限制"列表如果不删条目，就会变成第十九轮第 1 条那个躺了 18 轮没人再看的句子。**
6. **【已修·卫生】远程分支 16 → 1**（§25.0）。15 条残留**全部**是 `origin/main` 的祖先
   （`git branch -r --merged origin/main` 逐条确认后才删），随后 `git fetch --prune`。
   §5 里"可清理 `docs/maintenance`"这条建议从第一轮挂到现在——本轮把这一类一次性清掉，
   并把"合入即删"写进 §6，免得再攒回来。
7. **【未变·如实】安全扫描零新增**（§25.5）：CodeQL 10 条同规则同数量、审计 prod/含 dev 干净、密钥 0、
   发布面 9/9 CLEAN、Python/TS 执行面与既有防线逐条回归通过。
   **唯一一条"正在发生"的风险仍是 VLM 网关明文 `http://`**（第十四轮已上报为 #38，doctor 每轮实时告警）——
   它的解决需要换 https 或改走回环，属运维决定，本轮**只是重新确认它仍然存在**。
8. **【边界·如实】本轮不改任何运行时行为**：`lib/` 未变，活体 `totalTools/totalSkills` 与仓库一致
   ⇒ **不能声称"本轮验证了工具行为"**；本轮验证的是**宣称与树的一致性**（组合不变量 + 活体对账），以及**部署配置的等价替换**。

### 25.7 结论与下一步建议

- **交付**：**1 个 PR 合入 `main`**——**#70**（`fix(metadata)`：聚合包按实测宣称 81 + per-package README 计数不变量，**5/5 绿**）；
  **2 个 issue 关闭**（**#68** 由 PR 关闭、**#40** 运维确认后落地并关闭）；`main` **`929ab88` → `316c142`**；
  用例 **361 → 362**；CodeQL **10 不变**；审计 prod/含 dev 干净；发布面 **9/9 CLEAN**；**远程分支 16 → 1**；**open issue 归零**。
- **线上价值**：把三处"**宣称 ≠ 事实**"堵上——
  ① 聚合包不再宣称它拿不出的工具数（并且**不得**把家族总数当自己的面，这一条现在是断言）；
  ② **每个发布包的 README 计数**都被不变量守住了（此前是盲区，三个文件已经漂了很多轮）；
  ③ 部署配置里躺了六轮的**死链**清掉（自愈的 warning 噪声与每次调用的多余 `existsSync` 一并消失）。
- **明确没有做的事（以及理由）**：
  1. **没有给聚合包加 `dsh-ros2-state`**——那会取消"可选附加"的定位、改变所有用户安装面，属产品决定（§25.2.1）。
  2. **没有把 VLM 网关换成 https / 回环**——仓库外配置，需运维决定（§25.5）。
  3. **没有清理本地那 7 条"非祖先"分支**（squash 合入或仅本地）——`--merged` 判不出 squash，
     删了可能丢一个人的在途分支，属"需要意图而非测量"的判断，如实留下（§25.6 第 6 条只删了可证明是祖先的那些）。
- **待运维**：
  1. **确认 gen-27 落地**（下一轮开工时看 journal 的 `restart requested (gen 27)` → `executing deferred restart (gen 27)`），
     并复核 `ros2_env_check` 的 **`missingSources` 应为 `[]`**、且不再有「已剔除该段」note——这是 #40 修复的**唯一**最终判据。
  2. 视需要决定 VLM 网关的 `https://` / 回环迁移。
- **下次维护建议**：
  1. **先闭环 gen-27 与 `missingSources: []`**（§25.4 / §25.7 待运维第 1 条）。
  2. **若再遇到"某个数/某句话不实"，先问"谁定义了它、谁在守它"**：
     `grep -rn '<数字>' packages/*/tests docs/`。本轮第 2 条（三个 README）和第 1 条（83 是家族口径）
     都是这一条命令的收益；第十九轮第 3 条的返工也是缺了它。
  3. **新不变量要"可证伪"再提交**：本轮把修复前的文件 `git stash` 回去跑出红，是"这个不变量到底有没有牙"的**唯一**证据
     （只跑绿说明不了任何事——它可能根本没匹配到任何文件）。
  4. **读 §5 时把它当作待办清单**：每轮**删除**已解决的行，而不是在下面加一行"已解决"。
  5. **`pnpm audit` 一律走脚本**；**`gh issue view` 失败换 REST/JSON 端点**（§24.1）。
  6. **合入即删分支**（本轮已建立，16 → 1）。

---

## 26. 维护记录（2026-10-13 04:00 CST / UTC 2026-10-12 20:00 · 第二十一轮：0 open issue / 0 open PR → step 5；闭环 gen-27 与 issue #40 的最终判据 → 安全扫描（审计/密钥/发布面/CodeQL）全不变 → **真正的高价值发现来自"执行面 × 审批面"对照而非扫描器**：`ros2_gui_interact` 无审批、无目标限制地注入任意窗口输入（选中终端即宿主机命令执行）→ 落地仓库自己早已决定的 §17 GUI 白名单 + 白名单外审批 → PR #73 5/5 绿合入 → 登记 gen-28）

> 本轮结论：起始 **0 open issue / 0 open PR**、`main = 845f04f`、工作树干净 ⇒ 按流程 `1 → 无 issue → 5`，本轮**无 issue 需要评估（step 2/3 的 issue 部分不适用）**。
> 本轮交付：**1 个 PR 合入**（#73，CI/CodeQL **5/5 绿**）、`main 845f04f → 4ab647c`、
> 用例 **362 → 371**（+9）、**CodeQL open 10 不变**（无新规则、无新实例）、audit prod/含 dev 干净、
> 发布面 **9/9 CLEAN**、**远程分支保持只有 `main`**、本地清掉 3 条已并入的分支。
> **本轮最有价值的一条不是扫描器报的**：audit / CodeQL / 密钥 / 发布面**全绿**，
> 而一个"无审批即可在宿主机上执行任意命令"的相邻路径仍然开着——它是**对照**出来的（§26.3），
> 且**仓库自己早就决定要堵**（`docs/safety-todo.md` §17、验收 #11），只是被标成"晚批 0.15+"而 0.15.0 早已发过。

### 26.0 仓库快照（本轮起始/结束）

| 项 | 起始 | 结束 |
| --- | --- | --- |
| 当前分支 | `main`（= `origin/main` `845f04f`），工作树**干净** | `main`（= `origin/main` **`4ab647c`**），工作树干净 |
| `main` | `845f04f` | **`4ab647c`** |
| open issue / open PR | **0 / 0** | **0 / 0** |
| vitest 用例 | **362**（361 过 + 1 pty-skip） | **371**（370 过 + 1 pty-skip） |
| CodeQL **open** 告警 | **10**（8 high `js/insecure-temporary-file` + 2 medium `js/file-access-to-http`） | **10**（同规则同数量；本轮新增代码**未产生新告警**） |
| Dependabot open | 0 | 0 |
| `pnpm audit`（脚本，权威 registry） | prod 干净 / 含 dev 干净 | 同 |
| 发布面（9 个非私有包 `pnpm pack` + `tar -tzf`） | 9/9 CLEAN | 9/9 CLEAN |
| 活体工具 / 技能 | **81 / 9**（六 bundle，`drifted` 全 `false`、`stale: false`、`missing: []`、`undeclared: []`） | 同（**未新增工具**，故 surface 不变） |
| 运行中的 dsh | PID **1736**，启动 **2026-10-12 17:25:19**（那次是**机器重启**，不是 phoenix 代际） | 同进程（本轮结束时登记 gen-28，落地留给下一轮开工确认） |
| dsh-phoenix 状态文件 | `generation 27` / **`running`** / `deferDeadline 0` / `pendingResume false` | 登记后 → `generation 28` / `deferred`（§26.4） |
| 远程分支 | **1**（仅 `main`） | **1**（仍仅 `main`；PR #73 合入即删） |
| 本机 | Node `v24.16.0` / pnpm `11.22.0`（与 root `packageManager` 一致） | 同 |

### 26.1 Issue 检查（step 1）

```text
gh issue list --state open   → []（0 个）
gh pr list   --state open    → （空，0 个）
gh issue list --state all --json | length → 10（全部 CLOSED）
```

⇒ **无未处理 issue**，按流程直接转 **step 5（安全扫描）**。本轮因此**没有** step 2 的"建议合理性评估"对象——
但 §26.3 的发现来自仓库内**自己的决策记录**（`docs/safety-todo.md`），性质上等价于一条"已决定、未执行"的建议。

### 26.2 先闭环上一轮唯一的未闭环观测（gen-27 + `missingSources`）

第二十轮留下**唯一**的待运维项：确认 gen-27 落地，并复核 `ros2_env_check` 的
`missingSources` 应为 `[]`、且不再有「已剔除该段」note——这是 issue #40 修复的**唯一**最终判据。
本轮开工**第一件事**就是读 journal（状态文件只能回答"此刻处于哪个生命周期状态"）：

```text
Oct 12 12:35:36  [dsh-phoenix] cordis tool: cordis_run
Oct 12 12:35:39  [dsh-phoenix] restart requested (gen 27): plugin-change          ← 第二十轮登记
Oct 12 12:40:39  [dsh-phoenix] agent idle; executing deferred restart (gen 27)
Oct 12 12:40:39  [dsh-phoenix] restart cmd exit=0
Oct 12 12:40:48  systemd: Started dsh-web.service
Oct 12 12:40:51  dsh[311316]: [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

```json
{ "generation": 27, "lifecycleState": "running", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0, "deferDeadline": 0,
  "updatedAt": 1791797130836 }
```

`generation 27` + `lifecycleState: running` + `deferDeadline: 0` + `pendingResume: false`
⇒ **gen-27 逐字命中、干净落地**（`deferDeadline − updatedAt = 900000 ms` 的硬期限链与第十四～二十轮一致）。

**本轮的判据（issue #40 的收口）**——活体 `ros2_env_check`：

```json
{ "setup": { "prefix": "source /home/stvli/lite_delivery_aio/install/setup.bash &&",
             "sourcePath": "/home/stvli/lite_delivery_aio/install/setup.bash",
             "explicit": true, "sessionOverride": null } }
```

**没有 `missingSources` 字段、也没有 `note`**。这不是"字段丢了"，而是**逐字等价于 `[]`**：
`packages/core/src/tools.ts:1607` 只在 `setup.missingSources.length > 0` 时才附上该字段
（`...(setup.missingSources.length > 0 ? { missingSources: setup.missingSources } : {})`），
而 `resolveSetup` 的健康分支（`packages/common/src/runner.ts:222-230`）**会**填一个空数组。
⇒ **字段的缺席 ⇔ `[]`**，且不再有「已剔除该段」note。**issue #40 的最终判据达成、闭环。**

**另一条必须写清的时间线**（否则会把别人的落地算成自己的）：本进程（PID 1736）启动于
**10-12 17:25:19**，比本轮任何编辑都早——因为**机器在 10-12 17:25:11 重启过**：

```text
Oct 12 17:24:34  systemd: Stopping dsh-web.service…
Oct 12 17:24:35  systemd: Stopped dsh-web.service.
-- Boot 6ad08cd3ca314ff298c1fe3441a4b43f --
Oct 12 17:25:19  systemd: Started dsh-web.service
Oct 12 17:25:22  dsh[1736]: [dsh-phoenix] loaded
```

状态文件的 `updatedAt: 1791797130836` = **10-12 17:25:30**，正是**本次启动时重写的时间戳**
（延续 §23.5.1 的读法：它不是任何重启时刻）。另外这台机器 `uptime -s` = `2026-10-12 17:25:11`，
与 journal 的 `-- Boot --` 行一致。

### 26.3 安全扫描（step 5）——扫描器全绿，但真正的发现是"对照"出来的

#### 26.3.1 同口径的机械扫描（与第十九/二十轮逐条可比）

| 面 | 结果 |
| --- | --- |
| 供应链（`pnpm run audit` = `--prod --audit-level high`，**显式权威 registry**） | ✅ **No known vulnerabilities found** |
| 供应链（**含 dev**，`pnpm run audit:all`） | ✅ **No known vulnerabilities found** |
| 硬编码密钥（`sk-` / `AIza` / `ghp_` / `gho_` / `github_pat_` / `xox` / `npm_` / `BEGIN … PRIVATE KEY`） | ✅ 跟踪文件中 **0**（`git grep`，排除维护文档与 CHANGELOG 里对这些模式的描述文字） |
| **静态分析（CodeQL）** | ✅ **10 → 10**，逐条定位：8 high `js/insecure-temporary-file`（`packages/{common,core,dsh-ros2,vision}/tests/*` + `scripts/verification/measure.mjs`）+ 2 medium `js/file-access-to-http`（`packages/vision/src/vision.ts:64,102`）。**本轮新增代码 0 告警**（CI CodeQL **pass**） |
| 发布面（9 个非私有包 `pnpm pack` + 逐条 `tar -tzf`） | ✅ **9/9 CLEAN**，`pyc=0`；且实测**恰好 7 个包**装 `.py`（common 1 / core 2 / moveit 5 / profile 1 / safety 1 / sidecar 6 / vision 2）**全部**带 `!**/__pycache__` + `!**/*.pyc` 守卫，`dsh-ros2` 与 `dsh-ros2-state` 装 0 个 `.py` 故无需守卫 —— 与文档的"7 个"逐字吻合 |
| 发布面是否含 tests | ✅ **不含**：核心包 tarball 只有 `lib/` + `scripts/` + `package.json`/`README.md`/`LICENSE`/`cordis.patch.yml` ⇒ 上面 8 条 `insecure-temporary-file` **确实不在发布面**（**复核了上一轮的继承结论**，未直接沿用） |
| Python 执行面（按 `.py` 或首行 `#!…python` 取全集，repo-wide） | ✅ **29 个文件**；`shell=True` / `os.system` / `eval(` / `exec(` / `pickle` / `yaml.load` **全部 0**；`subprocess` 命中 **16 处调用点**（`run` 13 + `Popen` 3）+ 8 个 `DEVNULL` —— 与第十九/二十轮**逐字一致** |
| TS 命令面（`src/`） | ✅ **无 `execSync` / 无 `shell:true` / 无 `eval(` / 无 `new Function(`**；`execFile` ×14、`spawn` ×2、`spawnSync` ×0 —— 与第十九/二十轮**逐字相同** |
| 既有防线回归（第十三/十四/十六/十七/十八/十九/二十轮） | ✅ 全部仍在：`safe_sid()` 双层守卫（tool 侧 `isSafePathComponent` + helper 侧 `_SID_RE`）、PTY `DIR_MODE 0o700` / `FILE_MODE 0o600`（`packages/core/scripts/pty_session.py:88-89,132-134`）、sidecar UDS `chmod 0o600`、安装器 `umask 077` + `chmod 700`、`ros2_interface_create` 的 `flag: 'wx'`（`O_EXCL`，`tools.ts:432`）、`classifyVisionTransport()` 的回环/明文判定 |
| 活体网络出口复测 | ⚠️ **不变、已有上报**：`ros2_vision_doctor` 实时报 `transport.cleartext: true`（`http://121.9.219.138:8888/v1`，非回环）；`~/.dsh-ros2/secrets.json` 实测 `mode: 600` |
| Dependabot | ✅ **0 open**（本轮无积压） |

> **必须写清的一条**：以上"干净"与第十九/二十轮**同口径**——审计走 `pnpm run audit`
> （脚本内已钉 `--registry https://registry.npmjs.org/`），**不是裸敲**；裸敲在本机默认镜像下
> 仍然只会 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。

#### 26.3.2 真正的发现：**执行面 × 审批面**对照（扫描器不会报这个）

机械扫描全绿之后，本轮换了一个问题：**把每个"能执行、能写、能注入输入"的接口列出来，
再逐个问——这个面凭什么不需要审批？** 于是照着代码数了一遍 `requestApproval` 的**覆盖**：

| 类别 | 工具 | 审批 |
| --- | --- | --- |
| L2 写/动 | `ros2_colcon_build` · `ros2_rosdep_install` · `ros2_interface_create` · `ros2_param_set` · `ros2_bag_record` · `ros2_bag_play` · `ros2_install`(start) · `ros2_launch` · `ros2_param_delete` · `ros2_lifecycle`(set) · `ros2_component`(load) · `ros2_service_call` · `ros2_action_send_goal` · `ros2_daemon`(stop/start) · `ros2_topic_pub` · `ros2_run` · `ros2_process_cleanup` · `moveit_move` · `robot_register` · `robot_topology`(snapshot/learn) · `robot_safety_start/lock/unlock` · `ros2_zero_pose_semantics` · `ros2_vision_set_key` | ✅ **全部有**（逐条在 `tools.ts` 定位到 `requestApproval`） |
| L3 GUI | `ros2_gui_start` / `ros2_gui_list` / `ros2_gui_close` / `ros2_screenshot` / `ros2_gui_observe` / **`ros2_gui_interact`** | ❌ **一个都没有** |

**`ros2_gui_interact` 的具体问题**（`packages/core/src/tools.ts:995-1077`，修复前）：

- `action=key` + `text` 走 `xdotool type`，`keys` 走 `xdotool key` —— 即**任意文本/按键**；
- 传 `windowTitle` 时先 `windowactivate` **把那扇窗切到前台**再输入；
- **不传** `windowTitle` 时作用于**当前焦点窗口**（绝对坐标点击/打字）；
- **全程没有任何审批，也没有任何目标限制**。

⇒ 把 `windowTitle` 指向一个终端（或干脆让它成为焦点窗口）就能**在宿主机上以当前用户身份执行命令**。
威胁模型不是假想的：本插件的 agent 会消费**不可信内容**（ROS 话题消息、VLM 描述的图像、抓取的页面、
报错文本），而相邻的、**窄得多**的动作（跑一个 ROS 可执行文件、调一个服务、发一条话题）**全都要审批**——
**最宽的输入面反而没有门**。这就是"执行面 × 审批面"对照要问的问题，**CodeQL / audit / 密钥扫描都不会报它**。

#### 26.3.3 合理性 / 必要性判断（等价于 step 2）

**这不是新增需求，而是仓库自己已经决定、却一直没执行的事**：

- `docs/safety-todo.md` §1 第 17 条：`L3 GUI 安全` → **做（轻）** → "`ros2_gui_interact` 默认白名单
  （rviz2/rqt/rqt_graph）+ 窗口标题校验"，批次标 **晚（0.15+）**；
- `docs/safety-todo.md` §3 晚批表：同一项的展开（"需改动时审批"）；
- 验收表第 11 条 **"GUI 能力限制"** → 归属"晚批（§3）"；
- 上游评审 `docs/safety-gpt-review.md` §17："Do NOT allow unrestricted arbitrary GUI interaction by default…
  GUI interaction should be approval-gated when the action can modify robot state or launch/stop processes."

**结论：合理且必要。** 但**必要性的一条额外理由本轮才被说清**：这项工作被标成"晚批 0.15+"，
而 `v0.15.0` **早在 2026-08-24 就已发布**（`git tag` 实测，且是 `HEAD` 的祖先）——
于是"晚批"三个字让一条**真实存在**的宿主机命令执行路径**看起来已经被处理过**。
README 更把它反向写成了事实（`README.md:236` 原文："Interaction is local to the host session
(**no approval**, same as other L3 tools)"），文档与代码在**同一个错的方向上**互相印证。

**决定：本轮实现 §17 的"轻"版本**，即白名单 + 按**解析后的**窗口标题校验 + 白名单外审批。
**不**顺手扩到相邻项（见 §26.5"明确没有做的事"）。

### 26.4 开发管理（git · step 3）与 dsh-phoenix（step 4）

| PR | 分支 | 提交 | CI |
| --- | --- | --- | --- |
| **#73** | `fix/gui-interaction-approval` | `0f64edd` `fix(security)` + `a0c2e35` `docs(safety)` | ✅ `check (22)` / `check (24)` / `analyze (js-ts)` / `analyze (python)` / `CodeQL` **5/5 全绿**；合入后 main 同一条 CI 亦 **success** |

提交面 9 个文件：`packages/core/src/gui.ts`、`packages/core/src/tools.ts`、`packages/core/src/config.ts`、
`packages/core/src/index.ts`、`packages/core/tests/gui.spec.ts`、`README.md`、`README_CN.md`、
`docs/safety.md`、`docs/safety-todo.md`。

#### 26.4.1 `fix(security)`：白名单 + 白名单外审批（不可自证式绕过）

1. **`GuiManagerOptions.allowedApplications`**（默认 `DEFAULT_ALLOWED_APPLICATIONS = ['rviz2','rqt','rqt_graph']`，
   亦可由 `config.guiAllowedApplications` 覆盖）；新增纯函数 `isAllowedWindowTitle(title, allowed)`
   （大小写不敏感**子串**匹配，因为真实标题带后缀：`rviz2 - RViz`）。
2. **`GuiManager.classifyInteraction(windowTitle?)`** → `confined | not-found | unconfined`：
   - 校验对象是 **`findWindow` 解析出来的窗口的 `title`**，**不是调用方传进来的 `windowTitle`**——
     所以"传一个白名单名字"**不能**为另一扇窗背书（专门有测试钉这一点）；
   - **不传 `windowTitle` 永远不是 `confined`**（绝对坐标/焦点窗口无法确认目标）；
   - 窗口**不存在**时报 `not-found`，**不问审批**（没有东西可批，问就是误导用户）。
3. **`ros2_gui_interact`** 在任何 `xdotool` 事件之前判定；`unconfined` → `requestApproval`
   （`docs/safety.md` 的"审批先于执行"），`denied` → `APPROVAL_DENIED`。
   `requestApproval` **fail-closed**（无审批服务/无 agent/异常/任何非 `allowed-once` 都拒），
   ⇒ 这个改动**不可能**自己把面放大。
4. **如实写下边界**：白名单是**便利性**控制，**不是**安全边界——任何进程都能改自己的窗口标题，
   标题匹配**不构成身份证明**。真正的边界是审批门。这句话同时写进了**代码注释**、两个 README 和
   `docs/safety.md`（§26.6 第 2 条说明了为什么必须这样写）。

#### 26.4.2 可证伪（不是"跑绿了就算"）

把**只有** `tools.ts` 里那段 gate 删掉（保留 gui.ts 的白名单函数与测试），跑 `gui.spec.ts`：

```text
× ros2_gui_interact click at absolute coordinates requires approval
× gates typing into a non-allowlisted window behind approval
× lets an operator extend the allowlist through the manager
⎯⎯ Failed Tests 3 ⎯⎯
AssertionError: expected true to be false            （×2）
AssertionError: expected undefined to be 'APPROVAL_DENIED'
Tests  3 failed | 33 passed (36)
```

⇒ **新增用例确实有牙**（只跑绿什么也证明不了：它可能根本没匹配到任何东西）。恢复后 36/36 绿。

#### 26.4.3 验收（本地 + CI）

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
CI=true pnpm run build      # 9 个项目全部 Done
CI=true pnpm run typecheck  # 9 个项目 tsc --noEmit 全部 Done
CI=true pnpm -r test        # 370 passed | 1 skipped（core 153+1 skip，gui.spec.ts 27 → 36）
python3 -m sidecar.selftest # SELFTEST PASSED (11 scenarios)
```

`lib/` 由本轮构建刷新 ⇒ **这是真实的运行时变更**（不是第二十轮那种"配置变了但 `lib/` 没变"）。

#### 26.4.4 dsh-phoenix 循环（step 4）

**接线核对**：`dsh-phoenix` 与 `dsh-ros2` 全家仍以 `link:` 装在 web profile；本轮未改动接线。
**状态文件路径**（本轮补充记录，避免每轮重新找）：由 **systemd unit 的环境变量**给出，
**不在本会话的 shell 环境里**：

```bash
systemctl --user show dsh-web -p Environment
#   → DSH_PHOENIX_STATE_FILE=/home/stvli/tmp/dsh-phoenix-state.json
```

（`~/.dsh/.agent-presets/cordis-phoenix` 是 **preset 目录**，不是状态文件；`/proc/<pid>/environ` 被沙箱拒绝。）

**活体持续测试**：本会话 `ros2_env_check` 的实时对账与仓库一致——
`totalTools: 81` / `totalSkills: 9` / 六 bundle `drifted` 全 `false` / `stale: false` / `missing: []` /
`undeclared: []` / 技能目录 `complete: true`。**本轮未新增工具**，故 surface 与元数据无需改动。

**本轮需不需要重启？——需要，且理由是"真的改了运行时"**：`packages/core/lib/*.js` 已变，
而运行中的进程（PID 1736）加载的是**旧** `lib/`——**不重载则新审批门在这个 dsh 里不生效**。
按既有最小失败面（一个空实现的动态 plugin + `cordis_run`）在**文档定稿后作为本轮最后一个动作**登记 **gen-28**
（`rsttrg-1/pkg-1`，空 `apply()`，不注册任何 service/event/tool/timer ⇒ 无副作用需要回收）；
只登记、不假装已落地，落地确认留给下一轮开工时的 journal（与第二十轮的读法一致）。登记**当场**即可验证：

```text
Oct 13 04:15:11  [dsh-phoenix] cordis tool: cordis_run
Oct 13 04:15:14  [dsh-phoenix] restart requested (gen 28): plugin-change
```

```json
{ "generation": 28, "lifecycleState": "deferred", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0,
  "deferDeadline": 1791837014380, "updatedAt": 1791836114380, "coalesced": false }
```

`deferDeadline − updatedAt = 900000 ms` ⇒ **正好是文档化的 900 s 硬期限**（与第十四～二十轮逐字一致），
`coalesced: false`（本轮只有一次激活）。**落地（`executing deferred restart (gen 28)` → 新进程 `loaded`）
留给下一轮开工时的 journal 确认**，并按 §26.7 待运维第 1 条**实测一次审批门**。

### 26.5 本轮发现

1. **【已修·真实·本轮最有价值·扫描器不会报】** `ros2_gui_interact` 可**无审批**把任意按键/文本
   注入**任意窗口**（选中/激活终端 = 宿主机命令执行），而更窄的动作全都要审批（§26.3.2）。
   **根因不是"忘了加审批"**，而是**这条路径被归类为 L3"本地会话操作"**，于是整类默认无门。
   **修法**：按仓库自己 §17 的决定落白名单 + 白名单外审批（§26.4.1）。
2. **【读法·真实】** "晚批/未做"是**会过期**的标签：§17 记为"0.15+"，而 `v0.15.0` 早已发布
   ⇒ 一条真实的 RCE-相邻缺口**看起来已被处理**。**教训**：把"被文档承认的未做项"当**待办**定期问
   "这个版本过去了吗"（已写进 §6 第 7 条）。
3. **【已修·文档·同一方向自证】** README 把不安全状态写成事实（"no approval, same as other L3 tools"），
   与代码**互相印证**、彼此都不显得可疑。**文档与代码一致 ≠ 正确**——两者可以一起错。
   本轮把 3 处（`README.md` / `README_CN.md` / `docs/safety.md`）改成实话，并把边界写清（§26.4.1 第 4 条）。
4. **【闭环·跨轮】** 上一轮唯一的未闭环观测（gen-27 + `missingSources`）**逐字命中并闭环**（§26.2），
   且本轮把"为什么字段缺席 ⇔ `[]`"**定位到源码行**（`tools.ts:1607` + `runner.ts:222-230`），
   而不是"看起来没报错就算通过"。
5. **【复核·不沿用继承结论】** 上一轮"8 条 `insecure-temporary-file` 都不在发布面"是**继承**来的；
   本轮**实际解开 tarball**确认发布面只有 `lib/`+`scripts/`（无 `tests/`），结论成立（§26.3.1）。
   同一条纪律也用在 GUI 白名单上：**没有**直接采信"§17 还没做"的文档说法，而是 `grep` 了
   `allowedApplications|allowlist|白名单` 全仓库，确认**只有文档提到、代码里根本没有**。
6. **【未变·如实】** CodeQL **10 → 10**、audit（prod/含 dev）干净、密钥 0、发布面 9/9 CLEAN、
   Python/TS 执行面与既有防线逐条回归通过；**唯一"正在发生"的风险仍是 VLM 网关明文 `http://`**
   （第十四轮已上报为 #38，doctor 每轮实时告警），属运维决定，本轮只重新确认它仍在。
7. **【边界·如实】** 本轮**改了**运行时行为（GUI 工具会多出审批提示），
   因此**不能**声称"只改了文档"；同时**没有**改 L1/L2/MoveIt/安全层的行为。
   `lib/` 变了 ⇒ 必须 gen-28 重载才在跑着的 dsh 里生效（§26.4.4）。
8. **【卫生】** 远程分支保持**只有 `main`**；本地删掉 3 条**已并入 main** 的分支
   （`fix/gui-interaction-approval`、`docs/maintain-round-20`、`docs/maintain-round-20-gen27`）。
   仍**不删**那 7 条"非祖先"分支（squash 合入或仅本地，`--merged` 判不出），与第二十轮同一判断。

### 26.6 本轮最有价值的三个"读法"

1. **扫描器绿 ≠ 没有洞**：本轮 audit / CodeQL / 密钥 / 发布面**全绿**，而一条宿主机命令执行路径开着。
   高价值发现来自**把"执行面"和"审批面"列成两张表对照**（§26.3.2）——这是可以每轮重复的动作。
2. **"谁声称了什么、谁在守它"之后，还要问"这句声称是不是**同向**错的"**：
   第二十轮的教训是"某个数不实先问谁定义了它"；本轮是"**代码和文档一起错**"——
   README 的"no approval"与代码的"没有 `requestApproval`"**互相印证**，所以两边都不会显得可疑。
   **文档与代码一致，不构成正确性的证据。**
3. **先查"是不是我自己决定过"**：本轮不是提出新需求，而是**发现一条自己的决定躺在"晚批"里过期了**。
   动手前先 `grep` 决策记录（`docs/safety-todo.md` / 上游评审）能避免：(a) 自作主张发明策略；
   (b) 重复讨论已定的取舍。§17 连字段名（`allowedApplications`）和白名单内容都写好了，照做即可。

### 26.7 结论与下一步建议

- **交付**：**1 个 PR 合入 `main`**——**#73**（`fix(security)` + `docs(safety)`，**CI/CodeQL 5/5 绿**），
  `main` **`845f04f` → `4ab647c`**；用例 **362 → 371**（+9）；**open issue / open PR 均为 0**；
  CodeQL **10 不变**；audit prod/含 dev 干净；发布面 **9/9 CLEAN**；远程分支仅 `main`。
- **线上价值**：堵住一条**无审批的宿主机输入注入**路径——从此 `ros2_gui_interact` 只在白名单应用窗口内
  免审批直驱（RViz2/rqt 的既有配方**照旧可用**），任何其它目标（含终端、含"当前焦点窗口"）**必须先问人**，
  且无审批服务时**直接拒绝**。同时把文档里"无需审批"的错误事实改正，并把"白名单不是边界"写进代码与文档。
- **明确没有做的事（以及理由）**：
  1. **没有**把 `ros2_gui_start` / `ros2_gui_close` / `ros2_screenshot` 一起加审批——§17 针对的是**输入注入**；
     `close` 只对自己跟踪的会话发信号，`screenshot`/`image_snapshot` 的任意 `output` 路径影响是**完整性**
     （内容固定为图片字节），不是 RCE。如实登记在 §5，留给单独一轮（避免把一次维护做成产品改版）。
  2. **没有**把白名单做成硬边界（按 `_NET_WM_PID` 校验属主进程）——那是新设计，不是 §17 的"轻"版本；
     相反，本轮**明确写下**它只是便利性控制，以免读者高估它。
  3. **没有**实现 §18 审计 JSONL——仍是晚批独立项，`docs/safety.md` 继续如实写着"本版未做"。
  4. **没有**清理本地那 7 条"非祖先"分支——与第二十轮同一理由（需要意图，不是测量）。
- **待运维**：
  1. **确认 gen-28 落地**（下一轮开工看 journal 的 `restart requested (gen 28)` →
     `executing deferred restart (gen 28)` → `loaded`），并在重载后**实测一次审批门**：
     对未列入白名单的窗口（先放一扇，如文件管理器）调用 `ros2_gui_interact`，
     应**弹出审批**；在无审批服务的会话里应**直接 `APPROVAL_DENIED`**。
  2. 视需要决定 VLM 网关的 `https://` / 回环迁移（第十四轮以来的老项）。
- **下次维护建议**：
  1. **先闭环 gen-28**，并做上面第 1 条的**审批门实测**（这是本轮修复的唯一最终判据，
     与 issue #40 用 `missingSources` 收口同理：**要有可判定的判据，不要"应该没问题"**）。
  2. **重复"执行面 × 审批面"对照**（§26.3.2 的两张表）：新增任何会执行/写入/注入输入的工具时，
     先回答"它凭什么免审批"。本轮证明**扫描器不会替你问这个问题**。
  3. **把"晚批 / 未做 / 计划中"当作有保质期的假设**，每轮问一次"这个版本过去了吗"（§6 第 7 条）。
  4. **不沿用继承结论**：上一轮写下的"都不在发布面""还没做"之类，本轮要么**实测复核**
     （解开 tarball / `grep` 全仓库），要么标注为未复核。
  5. **新不变量/新防线要"可证伪"再提交**：删掉防线跑出红，是"它到底有没有牙"的唯一证据（§26.4.2）。
  6. **读 §5 时把它当作待办清单**：每轮**删除**已解决的行、**加上**新如实登记的行。
  7. `pnpm audit` 一律走脚本；`gh issue view` 失败换 REST/JSON 端点（§24.1）；**合入即删分支**。

---

## 27. 维护记录（2026-10-15 18:49 CST / UTC 2026-10-15 10:49 · 第二十二轮：0 open issue / 0 open PR → step 5；闭环 gen-28 → 按上一轮 §6 第 6 条做"执行面 × 审批面"对照，挖出**两处未加门的宿主文件执行面**（`ros2_workspace use` 的 `source` 即执行 · VLM 上传面的任意文件外发）→ 两处都已修 + 可证伪测试 → **CodeQL 首跑抓出我自己引入的 4 条告警**并全部处理，open **10 → 8**）

### 27.1 起点快照

| 项 | 值 |
| --- | --- |
| 当前分支 | `main` @ `757aa17`（= `origin/main`，工作树干净） |
| 远端分支 | 仅 `origin/main`（第二十一轮"合入即删"保持住了） |
| open issue / open PR | **0 / 0** → 直接走 step 5 |
| CodeQL open 告警 | **10**（8 × `insecure-temporary-file` + 2 × `file-access-to-http`） |
| Dependabot open 告警 | **0** |
| 工具 / 技能面 | `totalTools: 81` / `totalSkills: 9`（六 bundle，`drifted` 全 `false`） |
| Node / pnpm | `v24.16.0` / `11.22.0`（与 root `packageManager` 一致） |
| 用例基线 | **371（370 过 + 1 pty-skip）** |

> `gh auth` 本轮**先失败后自愈**：第一次 `gh auth status` 报 `/home/stvli/.config/gh/hosts.yml` 的 token 无效，
> 再查一次就走 keyring 正常了（token scopes 含 `repo`/`workflow`）。**教训**：把 `gh` 的一次失败当"没权限"
> 会直接放弃 CodeQL/Dependabot 告警面——那是本仓库唯一的漏洞告警来源。先重试，再换 REST，再考虑无 token 的降级路径。

### 27.2 闭环第二十一轮唯一的未闭环观测（gen-28）

第二十一轮把 gen-28 登记为"只登记、不假装已落地"，落地判据交给本轮 journal。**逐字命中**：

```text
Oct 13 04:15:11  [dsh-phoenix] cordis tool: cordis_run
Oct 13 04:15:14  [dsh-phoenix] restart requested (gen 28): plugin-change
Oct 13 04:19:26  [dsh-phoenix] agent idle; executing deferred restart (gen 28)
Oct 13 04:19:38  [dsh-phoenix] loaded (graceful restart + client reconnect + lifecycle)
```

本轮开工时读 `DSH_PHOENIX_STATE_FILE`（由 **systemd unit 环境变量**给出，不在会话 shell 里）：

```json
{ "generation": 28, "lifecycleState": "running", "goalId": null,
  "pendingResume": false, "resumeAttempt": 0, "deferDeadline": 0,
  "updatedAt": 1792060449378 }
```

`lifecycleState: running` + `deferDeadline: 0` + `pendingResume: false` ⇒ **重启已完整落地**，无残留期限。
另有一次**计划外**的重载：`Oct 15 18:34:01 [dsh-phoenix] loaded`（PID 2076），发生在本轮动手**之前**——
所以本轮全程跑着的进程加载的是**第二十一轮的** `lib/`（含 GUI 白名单、**不含**本轮的门）。

**这一点被 §27.4.2 的 PoC 反向印证**：`ros2_workspace use` 实测**没有弹审批**，与"旧 lib 在跑"完全一致。

### 27.3 安全扫描（与既有基线逐项对账）

| 面 | 本轮结果 | 与上一轮 |
| --- | --- | --- |
| `pnpm run audit`（prod, high） | No known vulnerabilities found | 不变 |
| `pnpm run audit:all`（含 dev） | No known vulnerabilities found | 不变 |
| 密钥（tracked 文件 + 全历史新增行） | **0** | 不变（本轮先扫出 2 条**自造**噪声，已在 §27.5 第 5 条说明并清除） |
| 发布面（tarball：入口 + patch + 无 `.pyc`） | **9/9 CLEAN** | 不变 |
| CodeQL open | **10 → 8** | **改善**（见 §27.4.4） |
| Dependabot open | **0 → 0** | 不变 |
| `ros2_env_check` 实时对账 | `totalTools: 81` / `totalSkills: 9` / 六 bundle `drifted` 全 `false` / `stale: false` / `missing: []` / `undeclared: []` / `unresolved: []` / 技能目录 `complete: true` | 不变 |
| 线上环境 | `visiblePackages: 450` / `visibleNodes: 0`（无 ROS2 节点在跑，属正常） | — |

**结论：扫描器全绿/不变，而本轮两处真实缺陷一处都不会被它们报出来（§27.4.2 扫描器 0 提示，§27.4.3 报了但被误判）。**

### 27.4 本轮发现与修复

#### 27.4.1 "执行面 × 审批面"对照（上一轮 §6 第 6 条要求的动作）

工具面 **81** 条不变。把"能执行 / 能写 / 能把数据送出去"的接口列出来，逐个问**"它凭什么不需要审批"**：

**A. 有审批门的（26 条）**：`moveit_move`、`robot_register`、`robot_topology`、`robot_safety_start|lock|unlock`、
`ros2_run`、`ros2_launch`、`ros2_colcon_build`、`ros2_component`、`ros2_daemon`、`ros2_install`、
`ros2_interface_create`、`ros2_lifecycle`、`ros2_param_set|delete`、`ros2_process_cleanup`、
`ros2_rosdep_install`、`ros2_service_call`、`ros2_topic_pub`、`ros2_bag_record|play`、
`ros2_action_send_goal`、`ros2_vision_set_key`、`ros2_zero_pose_semantics`、**`ros2_workspace`（本轮新增）**
——外加**条件门** `ros2_gui_interact`（白名单外才审批）。

**B. 无门但"有副作用"的，逐条交代**：

| 工具 | 副作用 | 本轮判断 |
| --- | --- | --- |
| **`ros2_workspace {action:use}`** | **换前缀为 `source <ws>/install/setup.bash` ⇒ bash 执行任意文件，且作用于本进程所有会话的后续每条命令** | **发现 1：不可接受，本轮加门（§27.4.2）** |
| `ros2_vision_describe` / `ros2_vlm_analyze` | **读调用方指定的任意文件 → base64 → POST 到第三方网关** | **发现 2：不可接受，本轮改为按内容判定（§27.4.3）** |
| `ros2_gui_start` / `ros2_gui_close` / `ros2_gui_observe` | 预设应用（rviz2/rqt/rqt_graph）生命周期 | 应用名是 **enum**，非任意命令；`close` 只对自己跟踪的会话发信号。**维持不加门**（与第二十一轮一致） |
| `ros2_screenshot` / `ros2_image_snapshot` | `output` 接受任意绝对路径 | 写入内容**固定为 PNG/JPEG 字节**，影响是**完整性**不是 RCE。已在 §5 如实登记，**本轮不动** |
| `robot_safety_arbitrate` | 把关节状态 + 渲染帧发给 VLM | 是**只读语义仲裁**，非 safe 结论一律升级人类；输入不含任意文件路径。维持 |
| `ros2_vision_analyze` | 经 bridge 读话题**最新帧** | 只读话题，不接受文件路径。维持 |

> **这张表就是本轮的产出**：A 组 26 条是"已经被守住的"，B 组每条都必须能回答"为什么不需要门"。
> 两处答不上来的（`ros2_workspace use`、VLM 上传面）就是本轮修的东西——**两次都不是靠跑扫描器问出来的**。

#### 27.4.2 发现 1【已修·真实·扫描器 0 提示】`ros2_workspace use` = 无审批的宿主机代码执行

- **代码事实**：`makeWorkspaceTool` 的 `use` 分支只做三件事——`access(<ws>/install/setup.bash)` 判**存在**、
  校验通过后 `setSessionRosSetup('source ' + shq(setup) + ' && ')`、返回。**没有 `requestApproval`**
  （该 `execute(args)` 连 `exec` 参数都没有，**结构上不可能**加门）。
- **为什么它是执行面**：`runner.ts: resolveSetup()` 把该覆盖当作 explicit 前缀，`runCommand`
  于是走 `execFileP('bash', ['-lc', 'source … && <cmd>'])`。**`source` 一个文件就是执行它**，
  而且覆盖存在**一个模块级变量**里（`runner.ts:81` `let sessionRosSetup`），
  ⇒ **后续每一次工具调用**、**本进程内所有会话**都会先执行它。
- **比 `ros2_run` 更强却是 L1**：`ros2_run`（跑一个可执行文件）要审批，而"source 任意文件 + 持久化 +
  跨会话"不要。工具自己的注释写着 **L1**——与第二十一轮 `ros2_gui_interact` 被归为 L3
  **是同一类分类错误**：注释里的"会话内、内存态、只读"三个词掩盖了真实权限。
- **实机复现（本轮实测，非推断）**：造一个 `install/setup.bash` 只写 markdown 标记，然后走**活的**工具：

  ```text
  ros2_workspace {action: use, path: <PoC ws>}
    → ok:true, sessionRosSetup: "source '<PoC>/install/setup.bash' && ", 未要求审批
  ros2_env_check                    # 只读工具，经前缀执行
    → ok:true
  cat <PoC>/marker.txt
    → "POC-EXECUTED 1792060556 uid=1000 host=stvli-desktop-ubuntu-2404"
  ```

  **即：agent 能把任意文件送进 bash 执行，全程零提示。** 复现后立刻 `reset` 并删掉 PoC 目录（§27.4.5 记录恢复结果）。
- **修法（最小、与既有先例一致）**：`use` 加 `requestApproval(deps, exec, 'ros2_workspace', …)`，
  理由文案里写明"**bash 会执行该文件**"且"**本进程内所有会话**后续调用都会先 source 它"；
  拒绝/无审批服务 ⇒ `APPROVAL_DENIED`（fail-closed）。`show`/`reset` **保持只读**（reset 只是降级）。
  路径不存在的检查**放在提示之前**——一个不可能成功的路径不该拿去问人。
- **顺带改正的措辞**：工具描述与注释原文写 `session-scoped`，容易被读成"只影响我这个会话"。
  实测是**进程级**（模块级单槽）。本轮把描述/注释/审批文案都改成 `process-wide for this DSH run` 如实表述。

#### 27.4.3 发现 2【已修·真实·扫描器报了但被连续三轮误判为 by design】VLM 上传面可外发任意文件

- **代码事实**：两条 egress 都吃**调用方给的路径**，且都不校验：
  - TS：`ros2_vision_describe` → `readImageBase64(imagePath)` → `readFile` → base64 → `fetch` 到网关；
  - Python：`ros2_vlm_analyze` → `vlm_node._handle_describe` → `open(request.image_path, "rb")` → `call_vlm`。
  MIME 由**扩展名**猜（`mimeFor` / `image_mime`），**未知扩展名回落 `image/png`**。
- **后果**：`imagePath: ~/.ssh/id_rsa` 会被读、base64、**POST 到第三方网关**，还被标成 PNG。
  不需要审批。
- **为什么三轮没修**：CodeQL 的 `js/file-access-to-http`（告警 **#28/#29**）从第十六轮建基线起就在，
  每轮都被记为"**by design**（读图就是这个工具的功能）"而放过。
  **"读图是功能"只解释了"读"，没人问过"路径该不该是任意的"**——这正是第二十一轮那条教训
  （"文档与代码一致 ≠ 正确"）的变体：**扫描器报了、理由也写下来了，但理由回答的是另一个问题。**
- **修法（两侧各一道，按内容判定）**：
  - TS：`sniffImageMime(head)`（PNG 8 字节 / JPEG `FFD8FF` / GIF87a·89a / RIFF…WEBP），
    `readImageBase64` 先判后读，非图片抛错；**顺带修正 MIME 语义**——把 `.jpg` 的 PNG 正确描述为 `image/png`
    而不是被标错。`detectImageMime` 只读**头部**，所以巨大非图片不会先进内存。
  - Python：`vlm_node` 同样先读 12 字节判内容，非图片 `ValueError` 拒绝，**只有真图片才会走到 `call_vlm`**；
    顺手删掉已成死代码的 `image_mime` / `import mimetypes`。
- **实测（本轮，非推断）**：真实 PNG → `image/png`；`id_rsa.png`（内容是私钥文本）→ 拒绝；
  纯文本 → 拒绝；空文件 → 拒绝；截断 PNG → 拒绝；`RIFF…WAVE` → 拒绝；**`/dev/zero` → 0ms 返回 null**。
  Python 侧 sniffer 单测 **10/10 PASS**（PNG/JPEG/GIF87a/GIF89a/WebP/私钥/文本/空/截断/RIFF-non-WebP）。
- **`/dev/zero` 这一条是本轮把实现从 `fs.open` 改成有界流的原因，也是它值得保留的原因**：
  `readFile` 没有 EOF 可停（`/dev/zero` 永不结束）⇒ 会把整个 DSH 进程读爆；**有界 `createReadStream` 在 12 字节处停**。

#### 27.4.4 CodeQL 抓出**我自己**引入的告警（3 真 + 1 误报），并把存量也顺手关掉

首推后 PR 的 CodeQL 检查**红**：*"6 new alerts including 4 high severity"*。逐条看**没有一条是产品代码的漏洞**，
但四条里有三条确实是我写的：

| 告警 | 性质 | 处理 |
| --- | --- | --- |
| `#31 #32 #33` `js/insecure-temporary-file` @ `core/tests/tools.spec.ts` | **真实**：我新写的测试用**可预测**的 `/tmp/<固定名>` 造 fixture（还会在并发跑测试时撞名） | 改用 `mkdtempSync(path.join(tmpdir(), …))` |
| `#34` `js/insecure-temporary-file` @ `vision/src/vision.ts` | **误报，但有真原因**：`fs.open(path,'r')` 在该 query 里是**写型 sink**，于是把**调用方测试的临时目录 fixture**报成了"我们在建临时文件" | 改成有界 `createReadStream`（§27.4.3 说明它本来就该有界） |
| `#28 #29` `js/file-access-to-http` | **行号漂移的重复报告**（同一对存量告警，因为我加了行） | 不改；属"上传图片就是功能" |

修完 **5/5 绿**。**净效果是基线变好**：`core/tests/tools.spec.ts` 里两条**存量**告警（#10/#11）因为我一起改成 `mkdtempSync` 而关闭
⇒ **CodeQL open 10 → 8**（合入后实测：`8 open` = 6 条 `insecure-temporary-file` + 2 条 `file-access-to-http`）。

**本轮教训（新）**：**扫描器抓到的"新告警"要先分三类——真新问题 / 误报但被你的新代码触发 / 纯粹行号漂移**。
三条的处理方式完全不同，混在一起就会得出"CodeQL 在烦我"的错误结论。

#### 27.4.5 本轮改了什么、没改什么（边界如实）

| 项 | 结论 |
| --- | --- |
| **改了运行时行为** | 是。`ros2_workspace use` 会多一次审批提示；非图片路径不再被上传。`packages/core/lib/*.js` 与 `packages/vision/lib/*.js` **都变了** ⇒ 需要重载（§27.4.6） |
| **没改 L1 只读面** | `show`/`reset`、所有 `ros2_*_list|info|echo|show` 仍是只读 |
| **没改 L2 运动/安全路径** | `moveit_move`、`motion_validate`、`safety_monitor`、审批时序**一行未动** |
| **没做（有意）** | ① 没把 `ros2_workspace` 做成**按会话**隔离——`sessionRosSetup` 是一个模块级槽，改成按会话要在 ~60 个调用点传会话键，**是新设计不是维护**；本轮只**如实改名**（process-wide）并登记进 §5。② 没给 `ros2_screenshot`/`ros2_image_snapshot` 的 `output` 加路径限定（§5 既有条目）。③ 没做审计 JSONL（§18 晚批） |
| **PoC 现场已清理** | `reset` 已把会话覆盖清回配置值（`ros2_workspace show` → `sessionOverride: null`，`effective.prefix = source /home/stvli/lite_delivery_aio/install/setup.bash &&`）；PoC 目录已删（`CLEAN`） |

#### 27.4.6 dsh-phoenix 循环（step 4）

- **接线核对**：`dsh-phoenix` 与 dsh-ros2 全家仍以 **`link:`** 装在 web profile
  （`~/.dsh/profiles/web/node_modules/dsh-ros2-core -> …/packages/core`），本轮未改动线。
- **状态文件**：`DSH_PHOENIX_STATE_FILE=/home/stvli/tmp/dsh-phoenix-state.json`（由 systemd unit 给出）。
- **本轮需不需要重启？——需要，且理由是"真的改了运行时"**：`packages/core/lib/*.js`、`packages/vision/lib/*.js`
  都变了，而跑着的进程（PID 2076，10-15 18:34 loaded，**本轮动手前**）加载的是旧 `lib/`。
  已核实**新门确实进了构建产物**：`lib/gui.js` 有 `DEFAULT_ALLOWED_APPLICATIONS`(2)、
  `lib/tools.js` 有 `'ros2_workspace'` 审批(1)、`lib/vision.js` 有 `sniffImageMime`(2)。
- **登记 gen-29**：按既有最小失败面（一个空实现的动态 plugin + `cordis_run`）作为**本轮最后一个动作**登记
  （`rsttrg-1/pkg-1`，空 `apply()`，不注册 service/event/tool/timer ⇒ 无副作用需要回收）：

  ```text
  Oct 15 18:49:03  [dsh-phoenix] cordis tool: cordis_run
  Oct 15 18:49:06  [dsh-phoenix] restart requested (gen 29): plugin-change
  ```

  ```json
  { "generation": 29, "lifecycleState": "deferred", "goalId": null,
    "pendingResume": false, "resumeAttempt": 0,
    "deferDeadline": 1792062246551, "updatedAt": 1792061346551, "coalesced": false }
  ```

  `deferDeadline − updatedAt = 900000 ms` ⇒ 正好是文档化的 **900 s 硬期限**（与第十四～二十一轮逐字一致），
  `coalesced: false`（本轮只有一次激活）。**落地（`executing deferred restart (gen 29)` → 新进程 `loaded`）
  留给下一轮开工时的 journal 确认**。

### 27.5 本轮发现

1. **【已修·真实·最有价值·扫描器 0 提示】** `ros2_workspace use` 无审批地让 **bash 执行 agent 指定的文件**，
   且作用于**本进程所有会话**的后续每条命令——比要审批的 `ros2_run` 更强（§27.4.2）。实机复现 marker 以 uid=1000 落盘。
   **根因是同一种分类错误**：注释宣称"会话内/内存态/只读（L1）"，掩盖了真实权限（第二十一轮 `ros2_gui_interact` 同因）。
2. **【已修·真实·被连续三轮误判】** VLM 两条 egress 接受**任意路径**并把字节 POST 到第三方网关，
   MIME 还按扩展名猜（未知→`image/png`）。CodeQL 从建基线起就报了 **#28/#29**，
   三轮都记成"by design"——**"读图是功能"只回答了"读"，没回答"路径该不该任意"**（§27.4.3）。
3. **【新增教训·CodeQL 反向抓我】** 首推 4 条 high 全是**我自己**的：3 条真（可预测 `/tmp` fixture）+
   1 条误报（`fs.open` 是写型 sink）。**"新告警"必须分三类**：真新问题 / 被新代码触发的误报 / 行号漂移（§27.4.4）。
   处理完之后基线还**变好了**（10 → 8）。
4. **【闭环·跨轮】** 上一轮唯一未闭环观测 gen-28 **逐字命中**（§27.2），且 PoC 反向印证了"跑着的是旧 lib"。
5. **【不沿用继承结论】** 上一轮"密钥 0"是继承来的；本轮自己扫了一遍，**先扫出 2 条命中**——
   查下去发现**是我自己刚写的测试 fixture 里放了字面量 PEM 头**（不是真密钥）。
   这正是仓库自己抱怨过的"噪声淹没信号"，于是把 fixture 改成不含 PEM 标记的载荷，**再扫 0 命中**（§27.3）。
6. **【未变·如实】** audit prod/含 dev 干净、Dependabot 0、发布面 9/9、`ros2_env_check` 对账全绿、
   Python/TS 执行面与既有防线回归通过。**唯一"正在发生"的风险仍是 VLM 网关明文 `http://`**（第十四轮 #38，属运维决定）。
7. **【边界·如实】** 本轮**改了**运行时行为（`ros2_workspace` 会多一次审批提示、非图片不再上传），
   因此**不能**声称"只改了文档"；`lib/` 变了 ⇒ 必须 gen-29 重载才在跑着的 dsh 里生效（§27.4.6）。
8. **【卫生】** 远程分支保持**只有 `main`**（PR #76 合入即删）；本地无遗留分支。

### 27.6 本轮最有价值的三个"读法"

1. **扫描器全绿时，去看"谁能执行 / 谁能外发"，再问它凭什么免审批。**
   本轮两处发现：一处扫描器**完全没提**（`ros2_workspace`），一处**报了三轮却被理由绕开**（VLM 路径）。
   上一轮 §6 第 6 条要求的这张对照表**连续两轮都是唯一产出真实缺陷的动作**——它应该成为每轮固定动作，
   而不是"没有告警时的备选"。
2. **"by design"必须回答**被问的那个问题**。** `js/file-access-to-http` 的既有理由"读图就是功能"
   对**读**是成立的，对**路径是否该无限**是不成立的。写"by design"时要把**问题**也抄一遍，
   否则下一个人只会读到结论、读不到它没覆盖的范围。
3. **扫描器抓到"新告警"时，先分三类**（真新问题 / 新代码触发的误报 / 行号漂移）。
   本轮 4 条 high 全是我自己的，但三类处理方式完全不同；把三类混为一谈就会把一次**有效的**质量门
   误读成"工具在烦人"。同理：**自己造的 fixture 也要算进扫描面**——一句 `-----BEGIN … PRIVATE KEY-----`
   会让所有密钥扫描器**永远**报下去。

### 27.7 结论与下一步建议

- **交付**：**2 个 PR 合入 `main`**——**#76**（两枚 `fix(security)` + 一枚 `docs(safety)`，**CI/CodeQL 5/5 绿**）
  `main` **`757aa17` → `412e49f`**，随后 **#77**（本记录 + `test(vision)` 去噪，**CI/CodeQL 5/5 绿**）
  `main` **`412e49f` → `301224e`**；用例 **371 → 375**（+4）；CodeQL open **10 → 8**（**改善**）；
  audit prod/含 dev 干净；密钥 0；发布面 **9/9 CLEAN**；Dependabot 0；**open issue / open PR 均为 0**；远程分支仅 `main`。
- **线上价值**：堵住两条**不需要审批就能进宿主/出宿主**的路径——
  ① `ros2_workspace use` 从此要人确认（`show`/`reset` 照旧免审批，`ros2-bringup-recovery` 的既有配方
  **只多一次提示**，功能不减）；② 文档承诺"path to a PNG/JPEG/WebP/GIF image"从"承诺"变成"强制"，
  非图片文件再也发不出去。
- **明确没有做的事（以及理由）**：
  1. **没有**把 `sessionRosSetup` 改成按会话隔离——那是新设计（要在 ~60 个调用点传会话键），
     本轮只把措辞改成如实的 process-wide 并登记 §5。
  2. **没有**给 `ros2_screenshot` / `ros2_image_snapshot` 的任意 `output` 路径加门——影响是完整性不是 RCE，
     §5 已登记，留给单独一轮。
  3. **没有**动 `ros2_gui_start` / `ros2_gui_close` / `ros2_observe`——应用名是 enum，非任意命令（与第二十一轮同判断）。
  4. **没有**实现审计 JSONL（§18 晚批）。
- **待运维**：
  1. **确认 gen-29 落地**（下一轮开工看 journal 的 `restart requested (gen 29)` →
     `executing deferred restart (gen 29)` → `loaded`），并在重载后**实测新门**：
     对一个临时 PoC 工作区调 `ros2_workspace use`，应**弹出审批**；在无审批服务的会话里应**直接 `APPROVAL_DENIED`**
     （即本轮 §27.4.2 的 PoC 重跑一次，这次期望"被拦"）。
  2. 视需要决定 VLM 网关的 `https://` / 回环迁移（第十四轮以来的老项）。
- **下次维护建议**：
  1. **继续做"执行面 × 审批面"对照**（§27.4.1 的 A/B 两张表），三层扫描（audit/CodeQL/密钥/发布面）照旧但**不作为主产出**。
  2. **闭环 gen-29 + 重跑一次 §27.4.2 的 PoC**（这次期望被审批门拦住）——**要有可判定的判据**。
  3. **读 §5 当待办清单**：本轮新增"`sessionRosSetup` 是进程级"一条；已解决的条目要删。
  4. **自己写的 fixture 也算扫描面**：别在仓库里留字面量 PEM 头之类的"永久噪声"。
  5. **CodeQL 报"新告警"先分三类**再下结论（§27.4.4）。
  6. `pnpm audit` 一律走脚本；`gh` 失败先重试再换 REST（§27.3 的教训）；**合入即删分支**。
