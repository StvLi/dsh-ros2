// rviz_offscreen_node — headless RViz2 scene renderer for dsh-ros2.
//
// Drives the *real* rviz rendering stack (rviz_common::VisualizationManager +
// OGRE) and publishes the rendered scene as sensor_msgs/Image. Runs under a
// virtual X display (Xvfb, no physical screen) with Qt's offscreen platform;
// the image comes from the render kernel (RenderWindow::captureScreenShot),
// never from X screenshots or window stacking.
//
// Usage:
//   ros2 run dsh_ros2_rviz_offscreen rviz_offscreen_node --ros-args \
//     -p config_path:=/path/to/scene.rviz \
//     -p topic:=/rviz/scene -p width:=800 -p height:=600 -p rate:=5.0

#include <png.h>

#include <QApplication>
#include <QMetaObject>
#include <QtWidgets/QWidget>

#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/image.hpp>

#include <rviz_common/config.hpp>
#include <rviz_common/display_group.hpp>
#include <rviz_common/render_panel.hpp>
#include <rviz_common/ros_integration/ros_node_abstraction.hpp>
#include <rviz_common/visualization_manager.hpp>
#include <rviz_common/window_manager_interface.hpp>
#include <rviz_common/yaml_config_reader.hpp>
#include <rviz_rendering/render_window.hpp>
#include <rviz_rendering/render_system.hpp>

// rviz 的 OGRE vendor（include 路径为 .../include/OGRE，故不带 OGRE/ 前缀；
// 若带前缀会回退到系统 OGRE 1.9 导致类型冲突）
#include <OgreRoot.h>
#include <OgreRenderSystem.h>
#include <OgreRenderTarget.h>
#include <OgrePixelFormat.h>

namespace
{

/// Minimal WindowManagerInterface: headless mode has no panes/status bar.
class NoopWindowManager : public rviz_common::WindowManagerInterface
{
public:
  QWidget * getParentWindow() override { return nullptr; }
  rviz_common::PanelDockWidget * addPane(
    const QString &, QWidget *, Qt::DockWidgetArea, bool) override
  {
    return nullptr;
  }
  void setStatus(const QString &) override {}
};

/// Decode a PNG file into raw RGB (8-bit) using libpng.
bool decodePng(const std::string & path, std::vector<uint8_t> & rgb, uint32_t & width, uint32_t & height)
{  FILE * f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, nullptr, nullptr, nullptr);
  png_infop info = png ? png_create_info_struct(png) : nullptr;
  if (!png || !info || setjmp(png_jmpbuf(png))) {
    if (png) png_destroy_read_struct(&png, info ? &info : nullptr, nullptr);
    std::fclose(f);
    return false;
  }
  png_init_io(png, f);
  png_read_info(png, info);
  width = png_get_image_width(png, info);
  height = png_get_image_height(png, info);
  png_byte color = png_get_color_type(png, info);
  png_byte depth = png_get_bit_depth(png, info);
  if (depth == 16) png_set_strip_16(png);
  if (color == PNG_COLOR_TYPE_PALETTE) png_set_palette_to_rgb(png);
  if (color == PNG_COLOR_TYPE_GRAY && depth < 8) png_set_expand_gray_1_2_4_to_8(png);
  if (png_get_valid(png, info, PNG_INFO_tRNS)) png_set_tRNS_to_alpha(png);
  if (color == PNG_COLOR_TYPE_RGB || color == PNG_COLOR_TYPE_GRAY || color == PNG_COLOR_TYPE_PALETTE) {
    png_set_filler(png, 0xFF, PNG_FILLER_AFTER);
  }
  if (color == PNG_COLOR_TYPE_GRAY || color == PNG_COLOR_TYPE_GRAY_ALPHA) {
    png_set_gray_to_rgb(png);
  }
  png_read_update_info(png, info);
  const uint32_t stride = width * 4;
  std::vector<png_bytep> rows(height);
  std::vector<uint8_t> raw(stride * height);
  for (uint32_t y = 0; y < height; ++y) rows[y] = raw.data() + y * stride;
  png_read_image(png, rows.data());
  png_destroy_read_struct(&png, &info, nullptr);
  std::fclose(f);
  // RGBA -> RGB
  rgb.resize(width * height * 3);
  for (uint32_t y = 0; y < height; ++y) {
    const uint8_t * src = raw.data() + y * stride;
    uint8_t * dst = rgb.data() + y * width * 3;
    for (uint32_t x = 0; x < width; ++x) {
      dst[x * 3] = src[x * 4];
      dst[x * 3 + 1] = src[x * 4 + 1];
      dst[x * 3 + 2] = src[x * 4 + 2];
    }
  }
  return true;
}

/// Find the OGRE render target of the offscreen window (matched by size).
/// Used to read pixels directly instead of round-tripping through PNG.
Ogre::RenderTarget * findRenderTarget(uint32_t width, uint32_t height)
{
  Ogre::Root * root = Ogre::Root::getSingletonPtr();
  if (!root || !root->getRenderSystem()) return nullptr;
  auto it = root->getRenderSystem()->getRenderTargetIterator();
  while (it.hasMoreElements()) {
    Ogre::RenderTarget * t = it.getNext();
    if (t && t->getWidth() == width && t->getHeight() == height) return t;
  }
  return nullptr;
}

/// Copy the render target's current frame into a RGB buffer (no PNG round-trip).
/// Returns false on failure.
bool copyRenderTargetToRgb(Ogre::RenderTarget * rt, std::vector<uint8_t> & rgb, uint32_t width, uint32_t height)
{
  if (!rt) return false;
  rgb.resize(static_cast<size_t>(width) * height * 3);
  Ogre::PixelBox pb(Ogre::Box(0, 0, width, height), Ogre::PF_BYTE_RGB, rgb.data());
  rt->copyContentsToMemory(pb);
  return true;
}

}  // namespace

int main(int argc, char ** argv)
{
  // Runs under a virtual X display (Xvfb): Qt uses the default xcb platform so
  // OGRE gets a real (virtual) X window id for its GLX context; the window is
  // never visible to a human and the image we publish comes from the render
  // kernel (captureScreenShot), not from X screenshots or window stacking.

  QApplication app(argc, argv);
  // GPU (NVIDIA) GLX: FSAA=4 selects 32-bit ARGB visual fbconfigs whose
  // GL 3.0 core contexts NVIDIA refuses (BadValue). Disabling AA lets OGRE
  // pick a 24-bit config (verified: only 24-bit / samples=0 configs create
  // GLX contexts on NVIDIA). No visual downside for offscreen rendering.
  rviz_rendering::RenderSystem::disableAntiAliasing();
  rclcpp::init(argc, argv);
  auto node = std::make_shared<rclcpp::Node>("rviz_offscreen_node");
  node->declare_parameter<std::string>("config_path", "");
  node->declare_parameter<std::string>("topic", "/rviz/scene");
  node->declare_parameter<int>("width", 800);
  node->declare_parameter<int>("height", 600);
  node->declare_parameter<double>("rate", 5.0);
  const std::string config_path = node->get_parameter("config_path").as_string();
  const std::string topic = node->get_parameter("topic").as_string();
  const int width = node->get_parameter("width").as_int();
  const int height = node->get_parameter("height").as_int();
  const double rate_hz = node->get_parameter("rate").as_double();

  // Real rviz stack: render panel + central visualization manager.
  // NOTE: VisualizationManager owns a private SingleThreadedExecutor that
  // holds the raw node (add_node in its ctor) and spins it from onUpdate()
  // (executor_->spin_some). Do NOT spin the raw node ourselves — rclcpp
  // rejects a node that already belongs to another executor.
  auto ros_abs = std::make_shared<rviz_common::ros_integration::RosNodeAbstraction>("rviz_offscreen_ros");
  auto panel = std::make_unique<rviz_common::RenderPanel>();
  panel->resize(width, height);
  panel->show();  // virtual X: mapped but never visible to a human
  auto * render_window = panel->getRenderWindow();
  if (render_window) {
    render_window->initialize();  // creates the OGRE scene manager + camera
  }
  NoopWindowManager wm;
  rviz_common::VisualizationManager vm(panel.get(), ros_abs, &wm, node->get_clock());
  vm.initialize();
  // Creates the rviz viewport + default camera on the render window.
  panel->initialize(&vm);
  // No startUpdate(): we drive the update pipeline explicitly via
  // QMetaObject::invokeMethod(vm, "onUpdate") in the main loop.

  if (!config_path.empty()) {
    rviz_common::YamlConfigReader reader;
    rviz_common::Config root_cfg;
    reader.readFile(root_cfg, QString::fromStdString(config_path));
    // vm.load() expects the "Visualization Manager" section of the .rviz file.
    rviz_common::Config vm_cfg = root_cfg.mapGetChild("Visualization Manager");
    if (!vm_cfg.isValid()) {
      RCLCPP_ERROR(node->get_logger(), "no 'Visualization Manager' section in %s", config_path.c_str());
    } else {
      vm.load(vm_cfg);
      RCLCPP_INFO(node->get_logger(), "loaded rviz config: %s", config_path.c_str());
      // Diagnostics: list displays and the RobotModel's subscribed topic.
      auto * group = vm.getRootDisplayGroup();
      if (group) {
        RCLCPP_INFO(node->get_logger(), "displays loaded: %d", group->numDisplays());
        for (int i = 0; i < group->numDisplays(); ++i) {
          auto * display = group->getDisplayAt(i);
          QString desc = display ? display->getDescription() : QString("?");
          RCLCPP_INFO(node->get_logger(), "display[%d] %s children=%d", i, desc.toStdString().c_str(),
            display ? display->numChildren() : -1);
          if (display) {
            for (int p = 0; p < display->numChildren(); ++p) {
              auto * child = display->childAt(p);
              if (!child) continue;
              QString name = child->getName();
              QString val = child->getValue().toString();
              RCLCPP_INFO(node->get_logger(), "  prop[%d] %s = %s", p, name.toStdString().c_str(), val.toStdString().c_str());
            }
          }
        }
      }
    }
  }

  auto pub = node->create_publisher<sensor_msgs::msg::Image>(
    topic, rclcpp::QoS(1).transient_local());
  rclcpp::Rate loop(rate_hz > 0 ? rate_hz : 5.0);
  const std::string tmp_png = "/tmp/rviz_offscreen_frame.png";

  RCLCPP_INFO(node->get_logger(), "rviz_offscreen_node: publishing %s at %.1f Hz (%dx%d)", topic.c_str(), rate_hz, width, height);
  bool first_frame = true;
  uint64_t frame_idx = 0;
  while (rclcpp::ok()) {
    // Drive the rviz update pipeline explicitly (it is normally a 30 Hz QTimer
    // slot): updates Displays + FrameManager + spins rviz's ROS node so TF and
    // topic data flow in, then render the kernel and publish the frame.
    // NOTE: onUpdate() already renders (ogre_root_->renderOneFrame() inside
    // VisualizationManager::onUpdate, gated by render_requested_ / >10ms wall
    // time). Do NOT call win->render() afterwards: that was a second render of
    // the same scene every frame (~31ms extra, halved the achievable rate).
    // Verified: without win->render() the frame comes out identical (pixel
    // stats equal) and 30 Hz requests reach ~23 Hz instead of ~11 Hz.
    const auto t_loop0 = std::chrono::steady_clock::now();
    std::chrono::steady_clock::time_point t_end_loop;
    auto t_render0 = t_loop0;
    auto t_end = t_loop0;
    const bool invoked = QMetaObject::invokeMethod(&vm, "onUpdate", Qt::DirectConnection);
    const auto t_upd1 = std::chrono::steady_clock::now();
    // Qt events only need low-frequency handling headless: processing them every
    // frame can trigger extra OGRE renders (paint events) that double the work.
    if (frame_idx % 5 == 0) app.processEvents();
    const auto t_pe1 = std::chrono::steady_clock::now();
    rclcpp::spin_some(node);
    if (first_frame) {
      auto * group = vm.getRootDisplayGroup();
      RCLCPP_INFO(
        node->get_logger(), "diagnostic: invokeMethod(onUpdate)=%d displays=%d",
        invoked ? 1 : 0, group ? group->numDisplays() : -1);
      first_frame = false;
    }
    // FrameManager diagnostics: which transformer is active and does rviz's
    // own TF buffer actually resolve the robot frames? The detailed dump runs
    // once after warmup (a few seconds, when TF has arrived); a one-line
    // frames count keeps running so a later TF loss is visible in the log.
    if (frame_idx == 15 || (frame_idx % 100 == 0)) {
      auto * fm = vm.getFrameManager();
      if (fm) {
        std::string err;
        std::string tf_id = fm->getTransformer() ? fm->getTransformer()->getClassId().toStdString() : "<none>";
        auto names = fm->getAllFrameNames();
        RCLCPP_INFO(
          node->get_logger(), "FM: transformer=%s fixed=%s frames=%zu",
          tf_id.c_str(), fm->getFixedFrame().c_str(), names.size());
        if (frame_idx == 15) {
          for (size_t i = 0; i < names.size(); ++i) {
            RCLCPP_INFO(node->get_logger(), "FM frame[%zu]: %s", i, names[i].c_str());
          }
          for (const auto & f : {"chest", "left_shoulder_pitch", "left_elbow_pitch",
                                 "right_wrist_yaw", "head", "base_link"}) {
            err.clear();
            bool bad = fm->transformHasProblems(f, err);
            RCLCPP_INFO(node->get_logger(), "FM transformHasProblems(%s)=%d %s", f, bad ? 1 : 0, err.c_str());
          }
        }
      }
    }
    ++frame_idx;
    auto * win = panel->getRenderWindow();
    if (win) {
      // Per-frame timing breakdown (logged every 25 frames): render / capture /
      // publish — identifies where the frame budget goes. No win->render()
      // here: onUpdate() already rendered (see loop comment above).
      t_render0 = std::chrono::steady_clock::now();
      // Read pixels directly from the OGRE render target (no PNG round-trip);
      // fall back to captureScreenShot + libpng decode if the target is not
      // reachable yet (first frame).
      static Ogre::RenderTarget * rt = nullptr;
      if (!rt) rt = findRenderTarget(static_cast<uint32_t>(width), static_cast<uint32_t>(height));
      std::vector<uint8_t> rgb;
      uint32_t w = width, h = height;
      const auto t_cap0 = std::chrono::steady_clock::now();
      bool ok = rt && copyRenderTargetToRgb(rt, rgb, w, h);
      if (!ok) {
        win->captureScreenShot(tmp_png);
        ok = decodePng(tmp_png, rgb, w, h);
        std::remove(tmp_png.c_str());
      }
      const auto t_pub0 = std::chrono::steady_clock::now();
      if (ok) {
        sensor_msgs::msg::Image msg;
        msg.header.stamp = node->now();
        msg.header.frame_id = "rviz";
        msg.height = h;
        msg.width = w;
        msg.encoding = "rgb8";
        msg.step = w * 3;
        msg.data = std::move(rgb);
        pub->publish(msg);
        t_end = std::chrono::steady_clock::now();
      } else {
        RCLCPP_WARN_THROTTLE(node->get_logger(), *node->get_clock(), 5000, "frame capture failed");
      }
    }
    loop.sleep();
    t_end_loop = std::chrono::steady_clock::now();
    if (frame_idx % 100 == 0) {  // 每 100 帧打印一次循环耗时
      auto ms = [](auto a, auto b) { return std::chrono::duration_cast<std::chrono::milliseconds>(b - a).count(); };
      RCLCPP_INFO(node->get_logger(),
        "loop-timing: loop=%lldms onupdate=%lldms events=%lldms spin=%lldms frame=%lldms sleep=%lldms",
        ms(t_loop0, t_end_loop), ms(t_loop0, t_upd1), ms(t_upd1, t_pe1),
        ms(t_pe1, t_render0), ms(t_render0, t_end), ms(t_end, t_end_loop));
    }
  }
  vm.stopUpdate();
  rclcpp::shutdown();
  return 0;
}
