# dsh-ros2 架构

> 版本 0.1.0 · 配套 `README.md`（使用）· `compatibility.md`（兼容基线）

## 分层

```
┌─ DSH 会话（Agent / 用户）───────────────────────────────┐
│  tools 服务                        skills 服务          │
└───────────────┬──────────────────────────┬─────────────┘
                │ ctx.tools.register        │ ctx.skills.register
┌───────────────▼──────────────────────────▼─────────────┐
│ 插件入口 src/index.ts（name / inject / apply）            │
│   inject: tools, skills, approval, jobs                  │
└───────────────┬─────────────────────────────────────────┘
                │ createRos2Tools({run, approval, jobs, gui, vision})
┌───────────────▼─────────────────────────────────────────┐
│ 工具层 src/tools.ts（33 个工具）                          │
│  L1 只读诊断 ×17 │ L2 管理 ×7 │ L3 可视化/交互 ×9         │
└──────┬──────────────┬──────────────┬──────────┬─────────┘
       │              │              │          │
  ┌────▼────┐   ┌─────▼─────┐  ┌─────▼────┐  ┌──▼─────────┐
  │ runner  │   │ approval  │  │ gui      │  │ vision     │
  │ src/    │   │ (DSH 服务) │  │ src/gui  │  │ src/vision │
  │ runner  │   │ fail-closed│  │ .ts      │  │ .ts        │
  │ .ts     │   │ L2 写操作  │  │ GUI 生命周期│  │ Gemini/    │
  │ ros2/   │   │           │  │ + X11 截图 │  │ OpenAI/mock│
  │ colcon/ │   │           │  │ (Pillow)  │  │ 可插拔      │
  │ rosdep  │   └───────────┘  └───────────┘  └────────────┘
  └─────────┘
```

## 执行缝隙（seams）

所有外部依赖都通过 `ToolDeps` 注入，插件入口组装真实实现、测试注入 fake：

| deps 字段 | 用途 | 生产实现 | 测试 |
| --- | --- | --- | --- |
| `run` | 跑 `ros2`/`colcon`/`rosdep` CLI | `runCommand`（超时/杀进程/环境） | mock 返回夹具 |
| `approval` | L2 写操作审批 | `ctx.approval.request` | allowed-once / rejected |
| `jobs` | L2 后台任务（colcon build） | `ctx.jobs.start` + `spawnJob` | fake registry |
| `gui` | L3 GUI 生命周期 + 截图 + **xdotool 交互**（`interact` 缝隙） | `GuiManager`（spawn/wmctrl/Pillow/xdotool） | fake spawn/windowCmd/screenshot/interact |
| `vision` | L3 多模态描述 | `GeminiProvider`/`OpenAiVisionProvider`/`MockVisionProvider` | Mock |

## 工具清单（33）

- **L1 只读诊断（17）**：`ros2_pkg_list` / `ros2_colcon_list` / `ros2_rosdep_check` / `ros2_node_list` / `ros2_node_info` / `ros2_topic_list` / `ros2_topic_info` / `ros2_topic_echo` / `ros2_service_list` / `ros2_action_list` / `ros2_param_list` / `ros2_interface_show` / `ros2_graph` / `ros2_tf_list` / `ros2_tf_echo` / `ros2_doctor` / `ros2_bag_info`
- **L2 管理（7）**：`ros2_colcon_build`（后台任务）/ `ros2_rosdep_install` / `ros2_interface_create` / `ros2_param_set` / `ros2_bag_record` / `ros2_jobs_list` / `ros2_job_status`
- **L3 可视化（6）**：`ros2_gui_start` / `ros2_gui_list` / `ros2_gui_close` / `ros2_screenshot` / `ros2_vision_describe` / `ros2_gui_observe`
- **L3 交互（3，P4）**：`ros2_gui_click` / `ros2_gui_drag` / `ros2_gui_key`（xdotool 点击/拖拽/键鼠；`GuiManager` 增加可注入 `InteractFn` 缝隙）

## 安全模型

- L1：纯只读，无审批
- L2：写操作一律 `ctx.approval.request`，仅 `allowed-once` 放行；无审批服务/无 agent/异常 → fail-closed；reason 含完整命令预览
- L3：本地 GUI 进程、截图与 xdotool 交互（点击/键鼠）属良性操作，无审批；视觉 API key 用户自备（`vision.apiKey`），不落盘明文
