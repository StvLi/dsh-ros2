# dsh-ros2 (aggregate)

Backward-compatible **aggregate bundle** — depends on `dsh-ros2-common` + `dsh-ros2-core` + `dsh-ros2-profile` + `dsh-ros2-moveit` + `dsh-ros2-safety` + `dsh-ros2-vision`. Its `apply()` is empty: all 81 tools + 9 skills come from the domain bundles (whose ids are listed in this package's `cordis.patch.yml`).

The optional `dsh-ros2-state` is deliberately **not** a dependency — its `state_get` / `state_snapshot` tools need the `dsh-ros2-sidecar` data plane, so it is installed separately. Adding it takes the family from 81 to 83 tools (issue #68).

Install this (plus the domain bundles via the patch) to keep the old `dsh-ros2` profile entry working; profiles that care about payload size depend on the domain bundles directly.

