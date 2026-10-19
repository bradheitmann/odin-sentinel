/** Deployment selection controls registration, never the authority of a role.
 * Full capability inventory is the default. Empty lists and unknown names fail closed.
 */
export const MCP_CAPABILITIES = Object.freeze(["protocol", "governance", "telemetry"] as const);
export type McpCapability = (typeof MCP_CAPABILITIES)[number];

export function resolveMcpCapabilities(selection: unknown = MCP_CAPABILITIES): ReadonlySet<McpCapability> {
  if (!Array.isArray(selection) || selection.length === 0) {
    throw new TypeError("capabilities must be a non-empty array of protocol, governance, telemetry");
  }
  const result = new Set<McpCapability>();
  for (const value of selection) {
    if (typeof value !== "string" || !(MCP_CAPABILITIES as readonly string[]).includes(value) || result.has(value as McpCapability)) {
      throw new TypeError("capabilities contains an unknown or duplicate capability");
    }
    result.add(value as McpCapability);
  }
  return result;
}

export const MCP_TOOL_CAPABILITIES: Readonly<Record<string, McpCapability>> = Object.freeze({
  "odin_append_event": "governance",
  "odin_query_events": "governance",
  "odin.get_delegation_packet": "protocol",
  "odin.validate_delegation_packet": "governance",
  "odin.get_version": "protocol",
  "odin.get_boot_receipt_schema": "protocol",
  "odin.get_boot_receipt_examples": "protocol",
  "odin.get_runtime_notice": "protocol",
  "odin.get_startup_packet": "protocol",
  "odin.get_role_profile": "protocol",
  "odin.get_role_card": "protocol",
  "odin.validate_boot_receipt": "governance",
  "odin.validate_bring_up_plan": "governance",
  "odin.evaluate_escalation_gate": "governance",
  "odin.validate_remediation_packet": "governance",
  "odin.validate_fallback_contract": "governance",
  "odin.validate_successor_contract": "governance",
  "odin.validate_outage_handoff": "governance",
  "odin.validate_closure_independence": "governance",
  "odin.validate_commit_gate": "governance",
  "odin.validate_control_recipe": "governance",
  "odin.validate_authority_action": "governance",
  "odin.evaluate_blocked_pod_rollover": "governance",
  "odin.evaluate_slice_health": "governance",
  "odin.validate_harness_control_recipe": "governance",
  "odin.validate_delivery_verification": "governance",
  "odin.evaluate_oversized_slice_sentinel": "governance",
  "odin.evaluate_qa_timeout_sentinel": "governance",
  "odin.evaluate_spec_defect_sentinel": "governance",
  "odin.validate_team_manifest": "governance",
  "odin.validate_cmux_delivery_proof": "governance",
  "odin.validate_instruction_read_proof": "governance",
  "odin.get_activation_gates": "protocol",
  "odin.evaluate_readiness_gate": "governance",
  "odin.get_active_watch_packet": "protocol",
  "odin.get_harness_probe_matrix": "protocol",
  "odin.get_onboarding_plan": "protocol",
  "odin.get_closeout_checklist": "protocol",
  "odin.export_protocol_snapshot": "protocol",
  "odin.compute_surface_layout": "governance",
  "odin.compute_human_cmux_quad_layout": "governance",
  "odin.compute_surface_layout_gate": "governance",
  "odin.get_bootstrap_skill": "protocol",
  "odin.get_telemetry_config": "telemetry",
  "odin.compile_session_report": "telemetry",
  "odin.preview_telemetry_redaction": "telemetry",
  "odin.submit_session_report": "telemetry",
  "odin.get_mission_frontrun_pack": "protocol",
});
