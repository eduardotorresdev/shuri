// Process entry behind bin/shuri-migrate.js: wires the real terminal into `runCli`.
import { createInterface } from "node:readline/promises";
import { runCli } from "./cli.js";

const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
  cwd: process.cwd(),
  isTTY,
  prompt: async (question) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(question)).trim());
    } finally {
      rl.close();
    }
  },
});
