cmake_minimum_required(VERSION 3.8)
project(dsh_ros2_safety)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(rclpy REQUIRED)
find_package(std_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/SafetyState.msg"
  "msg/SafetyEvent.msg"
  "srv/GetSafetyState.srv"
  "srv/Unlock.srv"
  "srv/SetLock.srv"
  DEPENDENCIES builtin_interfaces
)

# Node scripts (Python, installed as executables; they import the generated
# interface modules from the dsh_ros2_safety package and the pure
# safety_core module from their own install directory).
install(PROGRAMS
  scripts/safety_core.py
  scripts/safety_monitor
  scripts/safety_vlm_arbitrate
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
