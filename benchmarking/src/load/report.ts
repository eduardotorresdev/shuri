import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type Cell = number | string;
export type Row = Record<string, Cell>;

export interface ScenarioReport {
  id: string;
  sut: "open" | "auth";
  description: string;
  columns: string[];
  rows: Row[];
  /** Set when the scenario threw; the rows collected until then are kept. */
  error?: string;
}

export interface RunReport {
  startedAt: string;
  finishedAt?: string;
  mode: "docker" | "local";
  adapter: "memory" | "mongo";
  options: {
    connections: number[];
    subscribers: number[];
    duration: number;
    warmup: number;
    posts: number;
    sessions: number;
    port: number;
  };
  host: { platform: string; arch: string; cpus: number; cpu: string; node: string };
  /** What confines the SUT, as a sentence for the report. */
  budget: string;
  caveats: string[];
  scenarios: ScenarioReport[];
}

/**
 * Formats a cell for the markdown table: integers as they are, latencies and MB with one decimal,
 * ratios with two.
 * @param column - The column name, which decides the precision.
 * @param value - The cell.
 * @returns The cell as text.
 */
function formatCell(column: string, value: Cell): string {
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "-";
  if (column === "ELU") return value.toFixed(2);
  if (/ms|MB/.test(column)) return value.toFixed(1);
  return Math.round(value).toLocaleString("en-US");
}

/**
 * One markdown table per scenario, in the order they ran.
 * @param report - The run.
 * @returns The markdown document.
 */
export function renderMarkdown(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark — ${report.mode}, ${report.adapter} adapter`, "");
  lines.push(
    `- Started: ${report.startedAt}${report.finishedAt ? `, finished: ${report.finishedAt}` : " (in progress)"}`,
  );
  lines.push(`- SUT budget: ${report.budget}`);
  lines.push(
    `- Load: ${report.options.duration}s measured after ${report.options.warmup}s warmup; sweep over c = ${report.options.connections.join(", ")}; SSE subscribers ${report.options.subscribers.join(", ")}`,
  );
  lines.push(
    `- Seed: ${report.options.posts.toLocaleString("en-US")} posts, ${report.options.sessions.toLocaleString("en-US")} sessions (auth profile)`,
  );
  lines.push(
    `- Runner host: ${report.host.platform}/${report.host.arch}, ${report.host.cpus} cpus (${report.host.cpu}), node ${report.host.node}`,
  );
  for (const caveat of report.caveats) lines.push(`- Caveat: ${caveat}`);
  lines.push("");

  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.id} (${scenario.sut})`, "", scenario.description, "");
    if (scenario.rows.length > 0) {
      lines.push(`| ${scenario.columns.join(" | ")} |`);
      lines.push(`| ${scenario.columns.map(() => "---:").join(" | ")} |`);
      for (const row of scenario.rows) {
        lines.push(
          `| ${scenario.columns.map((column) => formatCell(column, row[column] ?? "-")).join(" | ")} |`,
        );
      }
      lines.push("");
    }
    if (scenario.error) lines.push(`**Failed:** ${scenario.error}`, "");
  }
  return lines.join("\n");
}

/**
 * Writes `results.json` and `report.md` into `dir`. Called after every scenario, so a run that
 * dies halfway still leaves everything measured so far on disk.
 * @param dir - The run's output directory.
 * @param report - The run so far.
 * @returns Nothing.
 */
export async function writeReport(dir: string, report: RunReport): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "results.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(dir, "report.md"), renderMarkdown(report));
}
