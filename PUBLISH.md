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

## 3. 社区目录收录（各一个 PR/Issue）

### awesome-dsh-plugin（https://github.com/awesome-dsh-plugin/awesome-dsh-plugin）

在插件列表追加一行：

```markdown
| [dsh-ros2](https://github.com/StvLi/dsh-ros2) | ROS2 调试工具集与诊断 skill：节点/话题/服务/动作/参数/接口枚举、topic 采样、TF、图拓扑 JSON、rosdep 依赖检查、ros2doctor；审批门控的 colcon build（后台任务）/rosdep install/自定义消息骨架/param set/bag record；X11 截图 + 可插拔多模态视觉（Gemini/OpenAI）观察 RViz2/rqt_graph |
```

### dsh-suite（https://github.com/whyihaveyou/dsh-suite）

按其 README 的提交格式提供：`dsh-ros2`、npm 包名、GitHub 地址、简介一句话、兼容基线（DSH `0.1.0-rc.6`、Node `^22.19 || >=24`）。

### dsh-community-plugins / dshmarket（https://github.com/HubaKing/dsh-community-plugins）

注册 `dsh-community-plugins` skill 后按插件市场格式提交：`name: dsh-ros2`、`repo: https://github.com/StvLi/dsh-ros2`、`desc: ROS2 调试工具集（诊断 + 审批管理 + GUI 视觉观察）`。

## 4. 发布前自检

- [ ] `pnpm run typecheck` / `pnpm run test` / `pnpm run build` 全绿
- [ ] `pnpm pack` 通过，tarball 含 `lib/`、`cordis.patch.yml`、`README.md`、`LICENSE`
- [ ] 本机接入实测：`dsh plugin --profile web add dsh-ros2` + patch 注入 + 重启，L1/L2/L3 工具可用
- [ ] README / docs/architecture.md / docs/compatibility.md / CHANGELOG.md 齐全
- [ ] LICENSE 为 MIT（Copyright 行可改为你的名字）

## 5. 后续迭代节奏建议

- M3 已含"先能看"（截图+多模态读取）；交互（xdotool 级）留 P4 迭代
- 社区反馈 → 版本迭代 → CHANGELOG 记录 → `pnpm version` + GitHub Release
