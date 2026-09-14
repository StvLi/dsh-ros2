#!/usr/bin/env bash
# Verification rig — bring the hand-built ~10-node system up or down.
#
#   scripts/verification/system.sh start    # launch every node in the background
#   scripts/verification/system.sh status   # show the nodes the graph reports
#   scripts/verification/system.sh stop     # stop everything this rig started
#
# Used by docs/verification-toolchain-efficiency.md (toolchain vs CLI study) and
# by the journey acceptance measurement (issue #19). The rig is deliberately
# hand-built rather than a demo: turtlesim + three hand-written nodes + the
# demo_nodes_cpp / action_tutorials_cpp nodes + a latched static TF edge give a
# graph with real pub/sub, services, actions, parameters and a two-edge TF tree.
# NB: no `set -u` — the ROS setup scripts reference unset variables.
set -o pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${VERIF_RUN_DIR:-/tmp/dsh-ros2-verification}"
LOG_DIR="$RUN_DIR/log"
PID_FILE="$RUN_DIR/pids"
ROS_SETUP="${ROS_SETUP:-/opt/ros/jazzy/setup.bash}"

export ROS_LOG_DIR="$LOG_DIR"
export ROS_HOME="$RUN_DIR/ros_home"
# FastDDS prints shared-memory errors to stdout when /dev/shm is unavailable;
# over UDP-only transport the graph is smaller and the logs stay clean.
export FASTDDS_BUILTIN_TRANSPORTS="${FASTDDS_BUILTIN_TRANSPORTS:-UDPv4}"

start() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(head -1 "$PID_FILE")" 2>/dev/null; then
    echo "already running (pids in $PID_FILE); run '$0 stop' first" >&2
    exit 1
  fi
  mkdir -p "$LOG_DIR" "$ROS_HOME"
  : > "$PID_FILE"
  # shellcheck disable=SC1090
  source "$ROS_SETUP"

  python3 "$HERE/lab_sensor.py"                          >"$LOG_DIR/lab_sensor.log" 2>&1 &
  echo $! >> "$PID_FILE"
  python3 "$HERE/lab_service.py"                         >"$LOG_DIR/lab_service.log" 2>&1 &
  echo $! >> "$PID_FILE"
  python3 "$HERE/lab_action.py"                          >"$LOG_DIR/lab_action.log" 2>&1 &
  echo $! >> "$PID_FILE"
  ros2 run turtlesim turtlesim_node                      >"$LOG_DIR/turtlesim.log" 2>&1 &
  echo $! >> "$PID_FILE"
  ros2 run demo_nodes_cpp talker                         >"$LOG_DIR/talker.log" 2>&1 &
  echo $! >> "$PID_FILE"
  ros2 run demo_nodes_cpp listener                       >"$LOG_DIR/listener.log" 2>&1 &
  echo $! >> "$PID_FILE"
  ros2 run demo_nodes_cpp add_two_ints_server            >"$LOG_DIR/add_two_ints_server.log" 2>&1 &
  echo $! >> "$PID_FILE"
  ros2 run demo_nodes_cpp parameter_blackboard           >"$LOG_DIR/parameter_blackboard.log" 2>&1 &
  echo $! >> "$PID_FILE"
  ros2 run action_tutorials_cpp fibonacci_action_server  >"$LOG_DIR/fibonacci_action_server.log" 2>&1 &
  echo $! >> "$PID_FILE"
  ros2 run tf2_ros static_transform_publisher \
    --x 0.1 --y 0 --z 0.5 --frame-id base_link --child-frame-id camera_link \
    >"$LOG_DIR/static_transform.log" 2>&1 &
  echo $! >> "$PID_FILE"

  echo "started $(wc -l < "$PID_FILE") nodes; logs in $LOG_DIR"
  sleep 8
}

status() {
  # shellcheck disable=SC1090
  source "$ROS_SETUP"
  echo "nodes: $(ros2 node list 2>/dev/null | wc -l)"
  ros2 node list 2>/dev/null | sort
  echo "topics: $(ros2 topic list 2>/dev/null | wc -l)  services: $(ros2 service list 2>/dev/null | wc -l)  actions: $(ros2 action list 2>/dev/null | wc -l)"
}

stop() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "nothing to stop ($PID_FILE missing)"
    return 0
  fi
  while read -r pid; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null
  done < "$PID_FILE"
  # The `ros2 run` wrappers fork the real node; clean those up too.
  pkill -f "$HERE/lab_" 2>/dev/null
  pkill -f "turtlesim_node" 2>/dev/null
  pkill -f "demo_nodes_cpp" 2>/dev/null
  pkill -f "fibonacci_action_server" 2>/dev/null
  pkill -f "static_transform_publisher" 2>/dev/null
  rm -f "$PID_FILE"
  echo "stopped"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
