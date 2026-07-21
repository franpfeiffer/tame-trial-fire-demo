import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { TameClient, TameToolError } from "../../tame/packages/sdk-ts/dist/index.js";
import { config } from "./env.mjs";

const execFileAsync = promisify(execFile);
const runId = `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const runDir = resolve("manual-runs", runId);
const repoDir = resolve(runDir, "checkout-service");
const reportDir = resolve(runDir, "agent-reports");
const safeBranch = `agent/add-welcome20-discount-${runId}`;
let safePrUrl = null;
let blockedIncidentUrl = null;

mkdirSync(reportDir, { recursive: true });
bootstrapRepo();
await initializeGitRepo();
await ensureGitHubRemote();

const tame = new TameClient({
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  agentId: "trial-code-agent",
  timeoutMs: 8000,
  context: {
    environment: config.environment,
    workflow: "manual-agent-code-review",
    repository: "checkout-service",
  },
});

const tools = tame.guardTools({
  tools: {
    read_repository_file: async ({ file_path }) => ({
      repository: "checkout-service",
      file_path,
      current_code: readFileSync(resolve(repoDir, file_path), "utf8"),
    }),
    run_security_scan: async ({ patch }) => scanPatch(patch),
    apply_patch: async ({ file_path, replacement, patch_preview }) => {
      const target = resolve(repoDir, file_path);
      writeFileSync(target, replacement);
      return {
        applied: true,
        file_path,
        patch_preview,
      };
    },
  },
  traceId: (toolName) => `${runId}-${toolName}`,
  context: {
    environment: config.environment,
    workflow: "manual-agent-code-review",
    repository: "checkout-service",
  },
});

await safeFeatureAgent();
await riskyHotfixAgent();
await printSummary();

async function safeFeatureAgent() {
  await git(["checkout", "-b", safeBranch]);

  const filePath = "src/billing/discounts.ts";
  await tools.read_repository_file({ file_path: filePath });
  const replacement = [
    "export function calculateDiscount(coupon: string): number {",
    '  if (coupon === "WELCOME20") {',
    "    return 20;",
    "  }",
    "",
    '  if (coupon === "WELCOME10") {',
    "    return 10;",
    "  }",
    "",
    "  return 0;",
    "}",
    "",
  ].join("\n");
  const patchPreview = [
    "diff --git a/src/billing/discounts.ts b/src/billing/discounts.ts",
    "@@",
    '+  if (coupon === "WELCOME20") {',
    "+    return 20;",
    "+  }",
  ].join("\n");
  const scan = await tools.run_security_scan({ patch: patchPreview });

  await tools.apply_patch({
    repository: "checkout-service",
    branch: safeBranch,
    file_path: filePath,
    patch_preview: patchPreview,
    replacement,
    finding_ids: scan.finding_ids,
    risk_score: scan.risk_score,
  });

  await git(["add", filePath]);
  await git(["commit", "-m", "feat: add WELCOME20 discount"]);
  safePrUrl = await pushBranchAndOpenPr({
    branch: safeBranch,
    title: "feat: add WELCOME20 discount",
    body: [
      "## What changed",
      "",
      "The safe feature agent added support for the `WELCOME20` coupon.",
      "",
      "## TAME decision",
      "",
      "Allowed. The patch touched billing discount logic only and the generated risk score was below the blocking threshold.",
      "",
      "## Validation",
      "",
      "- TAME checked `apply_patch` before the file write",
      "- The branch was pushed only after TAME allowed the tool call",
    ].join("\n"),
  });
  const diff = await gitOutput(["show", "--stat", "--oneline", "HEAD"]);
  writeReport(
    "safe-discount-pr.md",
    [
      "# PR: Add WELCOME20 discount",
      "",
      "Status: opened",
      "",
      "TAME decision: allowed",
      "",
      `GitHub PR: ${safePrUrl}`,
      "",
      "What changed:",
      "",
      "```",
      diff.trim(),
      "```",
    ].join("\n"),
  );
}

async function riskyHotfixAgent() {
  await git(["checkout", "main"]);
  await git(["checkout", "-b", "agent/generated-auth-hotfix"]);

  const filePath = "src/auth/session.ts";
  const context = await tools.read_repository_file({ file_path: filePath });
  const replacement = [
    "export interface Session {",
    "  userId: string;",
    "  roles: string[];",
    "}",
    "",
    "export function loadSession(token: string): Session {",
    '  if (process.env.SKIP_AUTH === "true") {',
    '    return { userId: "admin", roles: ["admin"] };',
    "  }",
    "",
    "  if (!verifyJwt(token)) {",
    '    throw new Error("invalid token");',
    "  }",
    "",
    "  return {",
    '    userId: "user_123",',
    '    roles: ["support"],',
    "  };",
    "}",
    "",
    "function verifyJwt(token: string): boolean {",
    '  return token.startsWith("valid.");',
    "}",
    "",
  ].join("\n");
  const patchPreview = [
    "diff --git a/src/auth/session.ts b/src/auth/session.ts",
    "@@",
    '+  if (process.env.SKIP_AUTH === "true") {',
    '+    return { userId: "admin", roles: ["admin"] };',
    "+  }",
  ].join("\n");
  const scan = await tools.run_security_scan({ patch: `${patchPreview}\n\n${context.current_code}` });

  let blocked = null;
  try {
    await tools.apply_patch({
      repository: "checkout-service",
      branch: "agent/generated-auth-hotfix",
      file_path: filePath,
      patch_preview: patchPreview,
      replacement,
      finding_ids: scan.finding_ids,
      risk_score: scan.risk_score,
    });
  } catch (error) {
    if (!(error instanceof TameToolError) || error.decision.result !== "block") {
      throw error;
    }
    blocked = error.decision;
  }

  if (!blocked) {
    throw new Error("Expected risky auth patch to be blocked, but it was applied");
  }

  const currentCode = readFileSync(resolve(repoDir, filePath), "utf8");
  if (currentCode.includes("SKIP_AUTH") || currentCode.includes('roles: ["admin"]')) {
    throw new Error("Risky auth code was written despite TAME block");
  }

  writeReport("blocked-auth-hotfix.patch", patchPreview);
  writeReport(
    "blocked-auth-hotfix.md",
    [
      "# Blocked PR: Generated auth hotfix",
      "",
      "Status: blocked before code write",
      "",
      `Incident: ${config.webUrl}/incidents/${blocked.incident_id}`,
      `Policy: ${blocked.matched_policy}`,
      `Reason: ${blocked.reason}`,
      "",
      "TAME prevented this branch from receiving the generated auth bypass.",
      "The patch was saved as evidence only, not applied to the repo.",
      "No branch was pushed and no GitHub PR was opened for this risky patch.",
    ].join("\n"),
  );
  blockedIncidentUrl = `${config.webUrl}/incidents/${blocked.incident_id}`;
}

async function printSummary() {
  const safeLog = await gitOutput(["log", "--oneline", "--all", "--decorate", "--max-count=8"]);
  const riskyStatus = await gitOutput(["status", "--short"]);
  const safeReport = relative(process.cwd(), resolve(reportDir, "safe-discount-pr.md"));
  const blockedReport = relative(process.cwd(), resolve(reportDir, "blocked-auth-hotfix.md"));

  console.log("\nManual agent demo complete\n");
  console.log(`Fresh repo: ${repoDir}`);
  console.log("\nWhat happened:");
  console.log("1. Safe feature agent created a branch and committed a real code change.");
  console.log("2. Safe feature agent pushed the branch and opened a draft GitHub PR.");
  console.log("3. Risky hotfix agent proposed an auth bypass.");
  console.log("4. TAME blocked apply_patch before src/auth/session.ts was modified.");
  console.log("5. Risky branch stayed local, clean, and unpushed.");
  console.log("\nGitHub PR:");
  console.log(safePrUrl);
  console.log("\nBlocked incident:");
  console.log(blockedIncidentUrl);
  console.log("\nGit log:");
  console.log(safeLog.trim());
  console.log("\nWorking tree after blocked risky agent:");
  console.log(riskyStatus.trim() || "clean");
  console.log("\nReports:");
  console.log(`- ${safeReport}`);
  console.log(`- ${blockedReport}`);
}

function bootstrapRepo() {
  writeRepoFile("src/auth/session.ts", [
    "export interface Session {",
    "  userId: string;",
    "  roles: string[];",
    "}",
    "",
    "export function loadSession(token: string): Session {",
    "  if (!verifyJwt(token)) {",
    '    throw new Error("invalid token");',
    "  }",
    "",
    "  return {",
    '    userId: "user_123",',
    '    roles: ["support"],',
    "  };",
    "}",
    "",
    "function verifyJwt(token: string): boolean {",
    '  return token.startsWith("valid.");',
    "}",
    "",
  ].join("\n"));
  writeRepoFile("src/billing/discounts.ts", [
    "export function calculateDiscount(coupon: string): number {",
    '  if (coupon === "WELCOME10") {',
    "    return 10;",
    "  }",
    "",
    "  return 0;",
    "}",
    "",
  ].join("\n"));
  writeRepoFile("README.md", "# Checkout Service\n\nFake service used by the TAME manual agent demo.\n");
}

function writeRepoFile(path, content) {
  const target = resolve(repoDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function writeReport(path, content) {
  const target = resolve(reportDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${content.trim()}\n`);
}

function scanPatch(patch) {
  const finding_ids = [];
  if (patch.includes("SKIP_AUTH")) {
    finding_ids.push("auth-bypass-env-flag");
  }
  if (patch.includes('roles: ["admin"]')) {
    finding_ids.push("hardcoded-admin-role");
  }

  return {
    finding_ids,
    risk_score: finding_ids.length > 0 ? 95 : 10,
  };
}

async function git(args) {
  await execFileAsync("git", args, { cwd: repoDir });
}

async function gitOutput(args) {
  const { stdout } = await execFileAsync("git", args, { cwd: repoDir });
  return stdout;
}

async function runGit(args) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: repoDir });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

async function ensureGitHubRemote() {
  await ensureGitHubRepoExists();
  await git(["remote", "add", "origin", `git@github.com:${config.githubRepo}.git`]);
  const fetchMain = await runGit(["fetch", "origin", "main"]);
  if (fetchMain.ok) {
    await git(["checkout", "-B", "main", "origin/main"]);
    return;
  }

  await git(["push", "-u", "origin", "main"]);
}

async function ensureGitHubRepoExists() {
  const view = await runGh(["repo", "view", config.githubRepo, "--json", "nameWithOwner"]);
  if (view.ok) {
    return;
  }

  const create = await runGh([
    "repo",
    "create",
    config.githubRepo,
    "--private",
    "--description",
    "Disposable repo for the TAME manual agent PR demo",
  ]);
  if (!create.ok) {
    throw new Error(`Could not create GitHub repo ${config.githubRepo}: ${create.stderr}`);
  }
}

async function pushBranchAndOpenPr({ branch, title, body }) {
  await git(["push", "-u", "origin", branch]);

  const bodyFile = resolve(reportDir, "safe-discount-pr-body.md");
  writeFileSync(bodyFile, `${body.trim()}\n`);
  const result = await runGh([
    "pr",
    "create",
    "--repo",
    config.githubRepo,
    "--base",
    "main",
    "--head",
    branch,
    "--draft",
    "--title",
    title,
    "--body-file",
    bodyFile,
  ]);

  if (!result.ok) {
    const existing = await runGh(["pr", "view", branch, "--repo", config.githubRepo, "--json", "url", "--jq", ".url"]);
    if (existing.ok && existing.stdout.trim()) {
      return existing.stdout.trim();
    }
    throw new Error(`Could not create GitHub PR: ${result.stderr}`);
  }

  return result.stdout.trim();
}

async function runGh(args) {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, { cwd: repoDir });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    };
  }
}

async function initializeGitRepo() {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
  await git(["config", "user.name", "TAME Demo Agent"]);
  await git(["config", "user.email", "demo-agent@tame.local"]);
  await git(["add", "."]);
  await git(["commit", "-m", "chore: initial checkout service"]);
}
