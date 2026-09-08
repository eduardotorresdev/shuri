import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { cannon, type LoadResult } from "./load/autocannon.ts";
import { PACKAGE_DIR, type Mode } from "./load/sut.ts";

/**
 * Measures the reference servers (`sut/reference.ts`) under the same budget and load as the SUT,
 * so the numbers in `BASELINE.md` have a ruler next to them measured on the same box: bare
 * `node:http`, the bridge alone, fastify.
 *
 *   node src/reference.ts --mode docker --connections 32,64 --duration 10 --warmup 3
 */
const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "docker" },
    kinds: { type: "string", default: "node,bridge,fastify" },
    connections: { type: "string", default: "32,64" },
    duration: { type: "string", default: "10" },
    warmup: { type: "string", default: "3" },
    port: { type: "string", default: "3000" },
    out: { type: "string", default: path.join(PACKAGE_DIR, "results") },
  },
});
const mode = values.mode as Mode;
const kinds = values.kinds.split(",");
const connections = values.connections.split(",").map(Number);
const duration = Number(values.duration);
const warmup = Number(values.warmup);
const port = Number(values.port);
const baseUrl = `http://127.0.0.1:${port}`;
const IMAGE = "benchmarking-sut";
const CONTAINER = "benchmarking-reference";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("exit", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${command} ${args.join(" ")} -> ${code}`)),
    );
  });
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/collections/posts/x`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("reference server never became ready");
}

async function start(kind: string): Promise<() => Promise<void>> {
  if (mode === "docker") {
    await run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      CONTAINER,
      "--cpus",
      "1",
      "--memory",
      "1g",
      "--memory-swap",
      "1g",
      "-p",
      `${port}:3000`,
      "-e",
      `BENCH_REFERENCE=${kind}`,
      IMAGE,
      "node",
      "benchmarking/src/sut/reference.ts",
    ]);
    await waitReady();
    return () => run("docker", ["rm", "-f", CONTAINER]).then(() => undefined);
  }
  const child: ChildProcess = spawn(process.execPath, ["src/sut/reference.ts"], {
    cwd: PACKAGE_DIR,
    env: { ...process.env, BENCH_REFERENCE: kind, PORT: String(port) },
    stdio: "ignore",
  });
  await waitReady();
  return async () => {
    child.kill("SIGTERM");
  };
}

interface Row {
  kind: string;
  connections: number;
  load: LoadResult;
}

const rows: Row[] = [];
for (const kind of kinds) {
  const stop = await start(kind);
  try {
    for (const c of connections) {
      console.log(`[reference] ${kind} c=${c}`);
      const requests = [{ method: "GET" as const, path: "/collections/posts/x" }];
      if (warmup > 0)
        await cannon({ url: baseUrl, connections: c, duration: warmup, requests });
      const load = await cannon({ url: baseUrl, connections: c, duration, requests });
      rows.push({ kind, connections: c, load });
      console.log(
        `[reference]   rps=${Math.round(load.rps)} p50=${load.p50} p99=${load.p99} errors=${load.errors}`,
      );
    }
  } finally {
    await stop();
  }
}

const lines = [
  `# Reference servers — ${mode}`,
  "",
  `Same budget as the SUT (${mode === "docker" ? "docker, cpus 1, mem 1g" : "local child process"}), \`GET /collections/posts/x\` returning one JSON record, ${duration}s after ${warmup}s warmup.`,
  "",
  "| server | c | rps | p50 ms | p99 ms | max ms | errors |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...rows.map(
    ({ kind, connections: c, load }) =>
      `| ${kind} | ${c} | ${Math.round(load.rps).toLocaleString("en-US")} | ${load.p50} | ${load.p99} | ${load.max} | ${load.errors} |`,
  ),
  "",
];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(values.out, `${stamp}-reference`);
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "report.md"), lines.join("\n"));
await writeFile(path.join(dir, "results.json"), JSON.stringify({ mode, rows }, null, 2));
console.log(lines.join("\n"));
console.log(`[reference] written to ${dir}`);
