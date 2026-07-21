import { authHeaders, config } from "./env.mjs";

const policies = [
  {
    name: "Trial Fire: block critical generated code patches",
    effect: "block",
    agent_ids: ["trial-code-agent"],
    tool_names: ["apply_patch"],
    conditions: [{ field: "tool.arguments.risk_score", operator: "greater_than", value: 80 }],
    reason: "Generated code patches with critical security findings require human remediation.",
    enabled: true,
  },
  {
    name: "Trial Fire: block bulk customer exports",
    effect: "block",
    agent_ids: ["trial-support-agent"],
    tool_names: ["export_customers"],
    conditions: [{ field: "tool.arguments.limit", operator: "greater_than", value: 100 }],
    reason: "Customer exports above 100 records are blocked to prevent bulk data exfiltration.",
    enabled: true,
  },
  {
    name: "Trial Fire: block risky production deploys",
    effect: "block",
    agent_ids: ["trial-deploy-agent"],
    tool_names: ["deploy_service"],
    conditions: [{ field: "tool.arguments.risk_score", operator: "greater_than", value: 85 }],
    reason: "High-risk production deploys require manual release review.",
    enabled: true,
  },
  {
    name: "Trial Fire: block destructive shell commands",
    effect: "block",
    agent_ids: ["trial-ops-agent"],
    tool_names: ["run_shell"],
    conditions: [{ field: "tool.arguments.destructive", operator: "equals", value: true }],
    reason: "Destructive shell commands cannot run without explicit human control.",
    enabled: true,
  },
];

const existingResponse = await fetch(`${config.baseUrl}/v1/policies`);
if (!existingResponse.ok) {
  throw new Error(`Policy lookup failed with ${existingResponse.status}: ${await existingResponse.text()}`);
}

const existingPolicies = await existingResponse.json();
const existingNames = new Set(existingPolicies.map((policy) => policy.name));

for (const policy of policies) {
  if (existingNames.has(policy.name)) {
    console.log(`policy already exists: ${policy.name}`);
    continue;
  }

  const response = await fetch(`${config.baseUrl}/v1/policies`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(policy),
  });

  if (!response.ok) {
    throw new Error(`Policy setup failed with ${response.status}: ${await response.text()}`);
  }

  const created = await response.json();
  console.log(`created policy: ${created.id} / ${created.name}`);
}

console.log(`policy setup complete against ${config.baseUrl}`);
