/**
 * Supervises `pdf-parse-worker.ts`: spawns it, waits for its one line of JSON,
 * and retries once if the process died without producing one.
 *
 * The retry is the point. The worker's dependencies segfault intermittently
 * under Bun, and a segfault leaves nothing to catch — no exception, no result,
 * just an exit code. Retrying a crash turns a ~1-in-5 failure into a ~1-in-25
 * one, and the second attempt is idempotent because every object it writes is
 * keyed by document id, so it simply overwrites the first attempt's partial work.
 *
 * A worker that *reports* a failure (a scan, a corrupt file) is not retried —
 * that answer won't change.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESULT_SENTINEL, type ParseJob, type ParseJobResult } from "./pdf-parse-protocol";

const WORKER_PATH = fileURLToPath(new URL("./pdf-parse-worker.ts", import.meta.url));

/** The app root, so the child resolves `.storage` and `.env` exactly as we do. */
const API_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Generous: a dense 10-page PDF rasterizes in a few seconds on a slow machine. */
const TIMEOUT_MS = 90_000;

export async function parsePdfIsolated(job: ParseJob): Promise<ParseJobResult> {
  const first = await spawnWorker(job);
  if (first) return first;

  console.warn(`[pdf] parse worker died without a result for ${job.documentId}, retrying`);
  const second = await spawnWorker(job);
  if (second) return second;

  return { ok: false, code: "INTERNAL", message: "Could not process this PDF. Please try again." };
}

/** Resolves to null when the worker produced no result — crash or timeout. */
async function spawnWorker(job: ParseJob): Promise<ParseJobResult | null> {
  // node:child_process rather than Bun.spawn: same behaviour for this, already
  // typed by @types/node, and portable if the API ever runs on Node.
  const child = spawn(process.execPath, [WORKER_PATH, JSON.stringify(job)], {
    cwd: API_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
  try {
    // `close` rather than `exit`, so both pipes have flushed before we read them.
    // `error` covers a spawn that never got off the ground.
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", (error: Error) => {
        stderr += `spawn failed: ${error.message}\n`;
        resolve();
      });
    });
  } finally {
    clearTimeout(timer);
  }

  // pdfjs prints warnings to stdout, so the result is found by sentinel rather
  // than by assuming it's the only thing there.
  const line = stdout
    .split("\n")
    .find((candidate) => candidate.startsWith(RESULT_SENTINEL));

  if (!line) {
    if (stderr.trim()) console.warn(`[pdf] parse worker stderr:\n${stderr.trim().slice(0, 2000)}`);
    return null;
  }

  try {
    return JSON.parse(line.slice(RESULT_SENTINEL.length)) as ParseJobResult;
  } catch {
    return null;
  }
}
