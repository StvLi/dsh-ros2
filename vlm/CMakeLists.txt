cmake_minimum_required(VERSION 3.8)
project(dsh_ros2_vlm)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(rclpy REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "srv/VlmDescribe.srv"
  "msg/VlmDescription.msg"
  DEPENDENCIES builtin_interfaces
)

# Node scripts (Python, installed as executables; import the generated
# interface modules from the dsh_ros2_vlm package).
install(PROGRAMS
  scripts/vlm_node
  scripts/image_snapshot
  scripts/vlm_call
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
