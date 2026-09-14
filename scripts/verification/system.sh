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

  # `setsid` puts each node in its own process group (PGID == the recorded
  # PID), so `stop` can kill the group without pattern-matching command lines —
  # `ros2 run` forks the real node, and a `pkill -f demo_nodes_cpp` would hit
  # unrelated processes.
  launch() { # launch <log-name> <command...>
    local log="$LOG_DIR/$1.log"; shift
    setsid "$@" >"$log" 2>&1 &
    echo $! >> "$PID_FILE"
  }

  launch lab_sensor   python3 "$HERE/lab_sensor.py"
  launch lab_service  python3 "$HERE/lab_service.py"
  launch lab_action   python3 "$HERE/lab_action.py"
  launch turtlesim    ros2 run turtlesim turtlesim_node
  launch talker       ros2 run demo_nodes_cpp talker
  launch listener     ros2 run demo_nodes_cpp listener
  launch add_two_ints_server ros2 run demo_nodes_cpp add_two_ints_server
  launch parameter_blackboard ros2 run demo_nodes_cpp parameter_blackboard
  launch fibonacci_action_server ros2 run action_tutorials_cpp fibonacci_action_server
  launch static_transform ros2 run tf2_ros static_transform_publisher \
    --x 0.1 --y 0 --z 0.5 --frame-id base_link --child-frame-id camera_link

  echo "started $(wc -l < "$PID_FILE") nodes; logs in $LOG_DIR"
  # Wait for discovery to settle — over UDP the graph is not complete within a
  # fixed sleep, and a measurement run against a half-discovered graph reports
  # fewer nodes than are actually up.
  local i=0 n=0
  while (( i < 60 )); do
    n="$(ros2 node list 2>/dev/null | wc -l)"
    (( n >= 10 )) && break
    sleep 1; (( i++ ))
  done
  echo "graph reports $n/10 nodes after ${i}s"
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
    [[ -n "$pid" ]] || continue
    # negative PID == the whole process group started by `setsid`
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null
  done < "$PID_FILE"
  # Safety net, anchored to THIS rig's own scripts (never a bare node name).
  pkill -f "$HERE/lab_" 2>/dev/null
  rm -f "$PID_FILE"
  echo "stopped"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
