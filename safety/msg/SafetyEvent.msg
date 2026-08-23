# One safety event (published on /safety/event, volatile).
string cause       # preset cause string
string severity    # WARNING | CRITICAL
string detail      # human-readable detail
int64 stamp_ms     # event time (unix ms)
