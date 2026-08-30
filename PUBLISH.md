# dsh-ros2 开源发布清单（M4）

> 目标：GitHub 公开仓库（已建：https://github.com/StvLi/dsh-ros2）+ npm 发布 + DSH 社区目录收录（MIT）

## 1. GitHub 仓库（已建，本地已 init + feat commit）

1. 仓库已建：**https://github.com/StvLi/dsh-ros2**，本地 `dsh-ros2/` 已 `git init` + `feat:` 提交。
2. 只需推送（首次 push 后 CI 自动跑：Node 22/24 → typecheck/test/build/pack 校验）：

```bash
cd /home/stvli/Desktop/embody_agent_ws/dsh-ros2
git remote -v                                   # 确认 origin 指向 https://github.com/StvLi/dsh-ros2.git
git push -u origin main
```

## 2. npm 发布（monorepo：7 个包，0.1.0）

仓库已拆分为 pnpm monorepo（`packages/*`，见 `docs/plugin-split-plan.md`），
发布 7 个 npm 包：`dsh-ros2-common`（纯库）+ 5 个 cordis bundle
（core/profile/moveit/safety/vision）+ `dsh-ros2`（聚合包）。

```bash
# 0) 一次登录（token 写入 ~/.npmrc，勿进仓库）
npm login --registry=https://registry.npmjs.org
# 1) 工作区全绿
pnpm install
CI=true pnpm run typecheck && CI=true pnpm run test && CI=true pnpm run build
# 2) 按依赖序发布（common 先行；pnpm publish 会自动把 workspace: 重写为 ^0.1.0）
cd packages/common && pnpm publish --registry=https://registry.npmjs.org --access public
cd ../core && pnpm publish --registry=https://registry.npmjs.org --access public
cd ../profile && pnpm publish --registry=https://registry.npmjs.org --access public
cd ../moveit && pnpm publish --registry=https://registry.npmjs.org --access public
cd ../safety && pnpm publish --registry=https://registry.npmjs.org --access public
cd ../vision && pnpm publish --registry=https://registry.npmjs.org --access public
cd ../dsh-ros2 && pnpm publish --registry=https://registry.npmjs.org --access public
# 3) 验证
npm view dsh-ros2-core version --registry=https://registry.npmjs.org
```

> 注意：
> - 本机 npm registry 可能是镜像（npmmirror）——发布必须显式
>   `--registry=https://registry.npmjs.org`；
> - 每个 cordis bundle 的 tarball 必须含 `cordis.patch.yml` 与 `lib/`；
>   `dsh-ros2-vision` 的 `files` 含 `vlm/` + `offscreen/`（修复了单体发布缺陷）；
>   `dsh-ros2-common` 含 `scripts/robot_profile.py`；CI 会自动校验这些。
> - 版本管理：每包独立 `pnpm version patch/minor/major`，GitHub Release 指向对应 tag。

## 3. 社区目录收录（已具备条件：`dsh.bundle` manifest ✅ / `dsh-plugin` topic ✅）

### 3.1 awesome-dsh-plugin（首选目录，https://github.com/awesome-dsh-plugin/awesome-dsh-plugin）

**收录硬性要求（CI 自动检查）**：
- ✅ `package.json` 声明 `dsh.bundle`（已加：`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）
- ✅ 真实代码、MIT、`dsh-plugin` topic（已加）
- ⚠️ **仓库创建满 1 天 + 提交数 ≥ 10**（当前提交数未达，继续迭代即可；未达标提交会被自动检查拦下，重提不受影响）

**投稿方式**（PR，只加一个文件）：

```bash
# fork https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
git clone git@github.com:<你>/awesome-dsh-plugin.git && cd awesome-dsh-plugin
git checkout -b add-dsh-ros2
```

创建 `data/plugins/StvLi__dsh-ros2.yml`：

```yaml
url: https://github.com/StvLi/dsh-ros2
name: StvLi/dsh-ros2
category: tools
description:
  en: "ROS2 debugging toolset for DeepSeek Harness: node/topic/service/interface/TF enumeration, graph JSON, rosdep checks, approval-gated builds and message scaffolding, plus GUI screenshot and multimodal vision observation."
  zh: "面向 DeepSeek Harness 的 ROS2 调试工具集：节点/话题/服务/接口/TF 枚举、拓扑图 JSON、依赖检查，审批门控的构建与消息骨架生成，以及 GUI 截图与多模态视觉观察。"
```

重新生成 README 后提交 PR：

```bash
npm ci && node scripts/generate-readme.mjs
git add -A && git commit -m "add dsh-ros2" && git push -u origin add-dsh-ros2
# 打开 PR（描述简述功能 + 附 CI 通过的仓库 Actions 链接）
```

### 3.2 dsh-market（应用内插件市场，https://github.com/dsh-market/dsh-market）

npm 发布后即可在应用内市场搜索安装（`dsh plugin --profile web add dshmarket`）。市场数据源覆盖 awesome 列表与 npm，通常自动出现；若需手动登记按该仓库 README 提交。

### 3.3 dsh-suite（https://github.com/whyihaveyou/dsh-suite）

插件活目录（每小时刷新、每日兼容实测）。npm 发布 + GitHub 有 `dsh-plugin` topic 后大概率自动收录；如需主动登记，按其 README 的提交格式（npm 包名 + 仓库地址 + 简介）开 PR/issue。

### 3.4 dsh-community-plugins / Oh-My-DSH（可选）

- `dsh-community-plugins`：装它只是让 Agent 学会发现插件的 skill，不是收录渠道本身
- Oh-My-DSH（`data/plugins.json`）：按其仓库格式追加条目并 PR

### 3.5 一次性执行（仓库侧已就绪）

```bash
# ① 发布 npm（一切的前提）
npm login
pnpm publish --access public
# ② 确认 topic（已加）
gh repo edit StvLi/dsh-ros2 --add-topic dsh-plugin
```

## 4. 发布前自检

- [ ] `pnpm run typecheck` / `pnpm run test` / `pnpm run build` 全绿
- [ ] `pnpm pack` 通过，tarball 含 `lib/`、`cordis.patch.yml`、`README.md`、`LICENSE`
- [ ] 本机接入实测：`dsh plugin --profile web add dsh-ros2` + patch 注入 + 重启，L1/L2/L3 工具可用
- [ ] README / docs/architecture.md / docs/compatibility.md / CHANGELOG.md 齐全
- [ ] LICENSE 为 MIT（Copyright 行可改为你的名字）

## 5. 后续迭代节奏建议

- M3 已含"先能看"（截图+多模态读取）；交互（xdotool 级）留 P4 迭代
- 社区反馈 → 版本迭代 → CHANGELOG 记录 → `pnpm version` + GitHub Release
