/**
 * dsh-ros2-sidecar — data-plane sidecar framework (logic-direct, physically
 * separated). The real framework is the Python package in ./sidecar/ (Reducer
 * base + UDS newline-JSON server, --selftest). This TS entry is a stub for
 * npm/workspace compliance only; it ships no plugin/tools (not a bundle).
 */
export const name = 'dsh-ros2-sidecar'
export const version = '0.1.0'
export const framework = 'sidecar/python'  // see sidecar/core.py, server.py, reducers_placeholder.py
