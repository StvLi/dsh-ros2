cmake_minimum_required(VERSION 3.8)
project(dsh_ros2_rviz_offscreen)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(rviz_common REQUIRED)
find_package(rviz_rendering REQUIRED)
find_package(rviz_default_plugins REQUIRED)
find_package(rviz_ogre_vendor REQUIRED)
# 使用 rviz 的 OGRE vendor 头（优先于系统 OGRE 1.9，避免版本冲突）
include_directories(BEFORE ${OGRE_INCLUDE_DIRS})
find_package(Qt5 REQUIRED COMPONENTS Widgets)
find_package(PNG REQUIRED)

add_executable(rviz_offscreen_node src/rviz_offscreen_node.cpp)
ament_target_dependencies(rviz_offscreen_node
  rclcpp sensor_msgs rviz_common rviz_rendering rviz_default_plugins)
target_link_libraries(rviz_offscreen_node Qt5::Widgets PNG::PNG rviz_ogre_vendor::OgreMain)

install(TARGETS rviz_offscreen_node
  DESTINATION lib/${PROJECT_NAME})

ament_package()
