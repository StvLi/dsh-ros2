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

## 2. npm 发布

```bash
npm login                              # 你的 npm 账号
pnpm run typecheck && pnpm run test && pnpm run build
pnpm publish --access public           # package.json 已含 publishConfig.access=public
npm view dsh-ros2                      # 验证
```

> 前置：`package.json` 的 `name: dsh-ros2` 需在 npm 上未被占用（`npm view dsh-ros2` 返回 404 即可发）。
> 版本管理：后续用 `pnpm version patch/minor/major` 打 tag，GitHub 建 Release 指向 v0.1.0。

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
