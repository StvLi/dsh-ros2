# 版本对应关系：GitHub 仓库 ↔ npm 包

> 防止用户在仓库 tag 与 npm 包版本之间"迷路"的权威对照。
> 更新时间：2026-08-31（monorepo 拆分后）

## 一句话结论

- **npm 上的 `dsh-ros2@0.1.0` 就是 GitHub 仓库当前（monorepo 布局）的版本**，没有滞后。
- **GitHub 上的 `v0.8.0 ~ v0.15.0` 标签是已废弃的旧单体布局历史版本，从未发布到 npm**——不要用它们对照 npm 版本。
- 版本号在 2026-08-26 的 monorepo 拆分时被**重新基线**：所有包从 0.1.0 重新开始，旧版本号序列作废。

## 对照表

| GitHub 侧 | npm 侧 | 布局 | 说明 |
| --- | --- | --- | --- |
| tag `v0.8.0` … `v0.15.0`（21 个，2026-08 前） | （无对应 npm 版本） | **旧单体布局**：插件在仓库根，`src/` + `scripts/` + `safety/` | 历史迭代（CHANGELOG 中 0.8.x ~ 0.15.0 条目），只发过 GitHub release，**从未发布 npm** |
| tag `v0.1.0-plugins`（2026-08-26） | `dsh-ros2@0.1.0` 等 **9 个包** | **当前 monorepo**：`packages/*` | 拆分后的 0.1.0 包集标记；npm 于 2026-08-30 发布 |
| `main`（拆分后未打 tag，最新开发线） | 同上（0.1.0） | 当前 monorepo | 当前所有开发都在此；下一批功能发布时应打新 tag |

### npm 上的 9 个包（全部 0.1.0）

| npm 包 | 角色 |
| --- | --- |
| `dsh-ros2` | **聚合包**（应用内市场安装入口）——聚合 6 个核心 bundle，含 `cordis.patch.yml` |
| `dsh-ros2-common` | 纯库：`robot_profile.py` 等共享脚本与工具 |
| `dsh-ros2-core` | cordis bundle：核心诊断工具 |
| `dsh-ros2-profile` | cordis bundle：机器人档案注册/加载/拓扑 |
| `dsh-ros2-moveit` | cordis bundle：MoveIt 运动接口 |
| `dsh-ros2-safety` | cordis bundle：安全框架 |
| `dsh-ros2-vision` | cordis bundle：视觉流水线（含 `vlm/` + `offscreen/`） |
| `dsh-ros2-state` | cordis bundle：控制面状态客户端（sidecar 数据面的读取端） |
| `dsh-ros2-sidecar` | 纯包：sidecar 数据面守护进程（python） |

## 为什么会"看起来"乱

1. **版本重基线**：拆分前单体包迭代到 0.15.0（GitHub tag）；拆分后 9 个包各自从 0.1.0 开始。
   所以"仓库最新是 0.15.0"是拆分前的说法，当前仓库版本是 **0.1.0（monorepo）**。
2. **发布渠道不对称**：旧系列只发 GitHub release（tag），从未 npm 发布；npm 只在拆分后发过 0.1.0。
3. **新旧 0.1.0 同名**：GitHub 的 `v0.1.0-plugins`（2026-08-26）与 npm `0.1.0`（2026-08-30）都是
   新 monorepo 时代的标记；旧的"插件 v0.1.0"只存在于 CHANGELOG 历史中，与当前无关。

## 如何判断你看到的是哪个时代

- 仓库根目录有 `packages/`（common/core/profile/moveit/safety/vision/state/sidecar/dsh-ros2）+
  `pnpm-workspace.yaml` → **当前 monorepo**，版本对照看本表第二/三行。
- 仓库根目录直接是 `src/` + `scripts/` + `safety/`（无 `packages/`）→ **旧单体布局**，
  对应 tag `v0.8.0 ~ v0.15.0`，npm 无对应版本。

## 版本策略（往前看）

- 按 `PUBLISH.md`：每包独立 `pnpm version patch/minor/major`，GitHub release 指向对应 tag。
- 应用内市场（dsh-market）数据源为 npm + awesome 列表——**npm 发布后市场自动同步**
  （镜像如 npmmirror 有传播延迟，验证用 `--registry=https://registry.npmjs.org`）。
- 下次功能发布时：bump 受影响包的版本 → npm 发布 → GitHub 打对应 tag，让两侧重新对齐。

## 已加载版本 vs 磁盘版本（陈旧进程自检）

同一个包有**两个**版本，问题几乎都出在二者不一致时：

| | 含义 | 何时改变 |
| --- | --- | --- |
| **loaded（已加载）** | 进程启动时从磁盘读入内存的那份代码 | 只在挂载 bundle 的那一刻确定；之后更新磁盘**不会**改变它 |
| **installed（已安装）** | 当前磁盘上 `package.json` 记录的版本 | 每次 `pnpm build` / `npm install` / 更新包时 |

bundle 是**一次性加载**的：磁盘更新后，运行中的 harness 仍是旧代码。旧版本只有在
真正调用时才暴露症状——`Error: unknown tool "ros2_topology"`，或会话技能目录少了几项载体。
拆分方案里的"profile 迁移需重启生效"是同样的约束。

**怎么查**：每个 bundle 在挂载时都会报告自己（并打一行启动日志
`dsh-ros2: loaded bundle dsh-ros2-<x>@<version>`）。只读诊断入口是 `ros2_env_check`：

```jsonc
{
  "data": {
    "bundles": {
      "loaded":  [{ "name": "dsh-ros2-core", "version": "0.1.5" }],
      "drift":   [{ "name": "dsh-ros2-core", "loaded": "0.1.5", "installed": "0.1.6", "drifted": true }],
      "stale":   true,           // 任一 bundle 的 loaded ≠ installed
      "unresolved": []           // package.json 已不可读，无法判断的 bundle
    }
  },
  "warnings": ["检测到磁盘上的 dsh-ros2 bundle 已更新，但运行中的进程仍是旧代码：… 请重启 harness 后重试。"]
}
```

`stale: true` 的处理：**重启 harness**（装了 dsh-phoenix 时会优雅重启并在空闲边界执行）。
不要靠"再调一次工具"绕过——新工具在旧进程里根本不存在。

> 一个诚实的边界：这个自检本身也需要在**重启后**才会生效。若当前进程早于本功能，
> `ros2_env_check` 不会返回 `bundles` 段（会给出"未记录到任何已加载的 dsh-ros2 bundle"告警）；
> 重启一次之后，后续每次更新都能被看到。

**开发时的自查**（不依赖运行中的 dsh）：

```bash
pnpm run build   # 忘记 build 就会留下陈旧的 lib/ —— 这正是本机制要发现问题
node -e "import('dsh-ros2-common').then(m=>console.log(m.listLoadedBundles()))"
```

