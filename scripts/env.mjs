import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(".env");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...valueParts] = trimmed.split("=");
    process.env[key] ??= valueParts.join("=").replace(/^['"]|['"]$/g, "");
  }
}

export const config = {
  baseUrl: (process.env.TAME_BASE_URL ?? "https://tameapp.vercel.app").replace(/\/$/, ""),
  webUrl: (process.env.TAME_WEB_URL ?? process.env.TAME_BASE_URL ?? "https://tameapp.vercel.app").replace(/\/$/, ""),
  apiKey: process.env.TAME_API_KEY ?? "tame_test_local",
  environment: process.env.TAME_ENVIRONMENT ?? "trial-fire",
  githubRepo: process.env.TAME_TRIAL_GITHUB_REPO ?? "franpfeiffer/tame-trial-fire-demo",
};

export function authHeaders() {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
}
