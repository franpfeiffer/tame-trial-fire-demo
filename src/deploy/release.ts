export interface DeployRequest {
  service: string;
  environment: "staging" | "production";
  risk_score: number;
}

export function deployService(request: DeployRequest): string {
  return `deployed ${request.service} to ${request.environment}`;
}
