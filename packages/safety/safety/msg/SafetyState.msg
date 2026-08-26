# Latched safety state of the robot (published by safety_monitor on
# /safety/state with transient-local QoS, so a late subscriber instantly
# gets the current latched state).
string state       # NORMAL | LOCKED
string severity    # OK | WARNING | CRITICAL
string cause       # preset cause string, empty when none (docs/safety-handover.md §4.7)
string detail      # human-readable detail
int64 stamp_ms     # state update time (unix ms)
