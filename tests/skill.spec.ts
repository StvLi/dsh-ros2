import { describe, expect, it } from 'vitest'
import { robotStateVisionSkill, ros2DiagnosticsSkill } from '../src/skill.js'

describe('skills', () => {
  it('registers the ros2-diagnostics skill with the expected shape', () => {
    expect(ros2DiagnosticsSkill.name).toBe('ros2-diagnostics')
    expect(ros2DiagnosticsSkill.source).toBe('runtime')
    expect(ros2DiagnosticsSkill.invocation?.modelInvocable).toBe(true)
    expect(ros2DiagnosticsSkill.content).toContain('ros2_graph')
    expect(ros2DiagnosticsSkill.content).toContain('ros2_topic_echo')
  })

  it('registers the robot-state-vision-analysis skill covering the full pipeline', () => {
    const skill = robotStateVisionSkill
    expect(skill.name).toBe('robot-state-vision-analysis')
    expect(skill.source).toBe('runtime')
    expect(skill.invocation?.userInvocable).toBe(true)
    // Pipeline stages must all be taught
    expect(skill.content).toContain('ros2_graph')
    expect(skill.content).toContain('ros2_tf_list')
    expect(skill.content).toContain('rviz_offscreen_node')
    expect(skill.content).toContain('/rviz/scene')
    expect(skill.content).toContain('vision_bringup')
    expect(skill.content).toContain('ros2_vision_analyze')
    // Cross-check guidance (zero-pose collinear axes are expected)
    expect(skill.content).toContain('zero')
    expect(skill.content).toContain('Cross-check')
  })
})
