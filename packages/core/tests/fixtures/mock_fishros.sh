#!/bin/bash
# 模拟鱼香ROS一键安装的交互菜单（测试 fixture，不真正安装任何东西）
echo "=== FishROS 一键安装(模拟) ==="
echo "---众多工具，等君来用---"
echo "1. 一键安装:ROS(支持ROS/ROS2)"
echo "2. 一键安装:rosdep"
echo "3. 一键配置:ROS环境"
echo -n "请输入数字: "
read choice1
echo "你选择了: $choice1"
if [ "$choice1" = "1" ]; then
  echo "=== 选择ROS版本 ==="
  echo "1. ROS2 Humble"
  echo "2. ROS2 Jazzy"
  echo "3. ROS1 Noetic"
  echo -n "请输入数字: "
  read choice2
  echo "你选择了: $choice2"
  echo "正在安装 ROS2 (模拟) ..."
  sleep 1
  echo "=== 安装完成 (模拟) ==="
else
  echo "=== 完成 (模拟) ==="
fi
