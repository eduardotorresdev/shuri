import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { waitForFixtures, type Fixtures } from "./fixtures.ts";

export type Mode = "docker" | "local";
export type Adapter = "memory" | "mongo";

export interface SutOptions {
  mode: Mode;
  adapter: Adapter;
  auth: boolean;
  port: number;
  posts: number;
  sessions: number;
  /** Where the SUT's stdout/stderr go, one file per boot. */
  logFile: string;
}

export interface RunningSut {
  baseUrl: string;
  fixtures: Fixtures;
  stop(): Promise<void>;
}

/** `benchmarking/`, whatever the runner's cwd is. */
export const PACKAGE_DIR = path.resolve(import.meta.dirname, "../..");
const COMPOSE_FILE = path.join(PACKAGE_DIR, "docker-compose.yml");

/**
 * Runs `docker compose ...` against this package's compose file, inheriting the runner's stdio so
 * build output stays visible, with `BENCH_*` from `env` visible to the file's `${...}` defaults.
 * @param args - The compose subcommand and its arguments.
 * @param env - Extra environment for the compose process.
 * @param capture - Capture stdout instead of inheriting it (for `logs`).
 * @returns The captured stdout, empty unless `capture`.
 */
export function compose(
  args: string[],
  env: Record<string, string> = {},
  capture = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, ...env },
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`docker compose ${args.join(" ")} exited with ${code}`)),
    );
  });
}

function composeArgs(adapter: Adapter, rest: string[]): string[] {
  return adapter === "mongo" ? ["--profile", "mongo", ...rest] : rest;
}

function sutEnv(options: SutOptions): Record<string, string> {
  return {
    BENCH_ADAPTER: options.adapter,
    BENCH_AUTH: options.auth ? "on" : "off",
    BENCH_POSTS: String(options.posts),
    BENCH_SESSIONS: String(options.sessions),
    BENCH_PORT: String(options.port),
    PORT: String(options.port),
  };
}

/**
 * Builds the SUT image once per run, so a profile switch (open -> auth) only restarts a container.
 * @returns Nothing.
 */
export async function buildDockerImage(): Promise<void> {
  await compose(["build", "sut"]);
}

/**
 * Brings the whole compose stack down, Mongo included. The last thing a docker run does.
 * @returns Nothing.
 */
export async function teardownDocker(): Promise<void> {
  await compose(["--profile", "mongo", "down", "--remove-orphans"]);
}

/**
 * Local mode still gets Mongo from compose — a bench against a database nobody has to install by
 * hand. Docker mode doesn't need this: the `sut` service depends on `mongo` when the profile is on.
 * @returns Nothing.
 */
export async function ensureLocalMongo(): Promise<void> {
  await compose(["--profile", "mongo", "up", "-d", "mongo"]);
}

async function startDocker(options: SutOptions): Promise<RunningSut> {
  const env = sutEnv(options);
  await compose(composeArgs(options.adapter, ["up", "-d", "sut"]), env);
  const baseUrl = `http://127.0.0.1:${options.port}`;
  let fixtures: Fixtures;
  try {
    fixtures = await waitForFixtures(baseUrl);
  } catch (error) {
    await writeFile(
      options.logFile,
      await compose(["logs", "--no-color", "sut"], env, true),
    );
    throw error;
  }
  return {
    baseUrl,
    fixtures,
    async stop() {
      await writeFile(
        options.logFile,
        await compose(["logs", "--no-color", "sut"], env, true),
      );
      await compose(composeArgs(options.adapter, ["rm", "-sf", "sut"]), env);
    },
  };
}

/** The heap cap standing in for the container's 1 GB in local mode. Approximate: the RSS is not capped, and nothing pins a core. */
export const LOCAL_MAX_OLD_SPACE_MB = 1024;

async function startLocal(options: SutOptions): Promise<RunningSut> {
  const log: WriteStream = createWriteStream(options.logFile);
  const child: ChildProcess = spawn(
    process.execPath,
    [`--max-old-space-size=${LOCAL_MAX_OLD_SPACE_MB}`, "src/sut/server.ts"],
    {
      cwd: PACKAGE_DIR,
      env: { ...process.env, ...sutEnv(options) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));

  const baseUrl = `http://127.0.0.1:${options.port}`;
  const fixtures = await Promise.race([
    waitForFixtures(baseUrl),
    exited.then(() => {
      throw new Error(`local SUT exited before becoming ready; see ${options.logFile}`);
    }),
  ]);
  return {
    baseUrl,
    fixtures,
    async stop() {
      child.kill("SIGTERM");
      await exited;
      log.end();
    },
  };
}

/**
 * Boots the SUT in the chosen mode and waits for its fixtures, i.e. for the seed to finish.
 * @param options - Mode, adapter, profile and sizes.
 * @returns The running SUT, with its fixtures and a `stop`.
 */
export function startSut(options: SutOptions): Promise<RunningSut> {
  return options.mode === "docker" ? startDocker(options) : startLocal(options);
}
