/**
 * Generates the contribution snake without touching the GitHub GraphQL API.
 *
 * Upstream snk reads the calendar via GraphQL, which now fails with
 * "Resource limits for this query exceeded". The public contributions
 * fragment at /users/<name>/contributions carries the same data as HTML,
 * needs no token, and has no such limit. Everything after the fetch is
 * upstream's own solver and renderer.
 */
import { parseArgs } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { getBestRoute } from "@snk/solver/getBestRoute";
import { getPathToPose } from "@snk/solver/getPathToPose";
import { createSvg } from "@snk/svg-creator";
import { snake4 } from "@snk/types/__fixtures__/snake";
import { cellsToGrid } from "./packages/generate-snake-animation/cellsToGrid";
import { parseOutputsOption } from "./packages/generate-snake-animation/outputsOptions";

type Cell = { x: number; y: number; date: string; count: number; level: number };

const scrapeContributions = async (userName: string): Promise<Cell[]> => {
  const url = `https://github.com/users/${encodeURIComponent(userName)}/contributions`;
  const res = await fetch(url, {
    headers: { "User-Agent": "snk-html-fallback", "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const html = await res.text();

  const days: { date: string; level: number }[] = [];
  // <td ... data-date="2026-07-18" data-level="2" ...> — attribute order varies.
  for (const [, cell] of html.matchAll(/<td\b([^>]*\bdata-date=[^>]*)>/g)) {
    const date = cell.match(/data-date="([\d-]+)"/)?.[1];
    const level = cell.match(/data-level="(\d+)"/)?.[1];
    if (date && level !== undefined) days.push({ date, level: Number(level) });
  }
  if (!days.length) throw new Error("no contribution cells found — page markup may have changed");

  days.sort((a, b) => a.date.localeCompare(b.date));

  // GitHub renders one column per week, each starting on Sunday. Anchor x to
  // the Sunday on or before the first day so partial leading weeks line up.
  const first = new Date(days[0].date + "T00:00:00Z");
  const origin = new Date(first);
  origin.setUTCDate(origin.getUTCDate() - first.getUTCDay());

  return days.map(({ date, level }) => {
    const d = new Date(date + "T00:00:00Z");
    const dayIndex = Math.round((+d - +origin) / 86400000);
    return { x: Math.floor(dayIndex / 7), y: d.getUTCDay(), date, count: level, level };
  });
};

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { github_user: { type: "string" }, output: { type: "string", multiple: true } },
});
if (!values.github_user) throw new Error("--github_user is required");

const outputs = parseOutputsOption(values.output ?? []);

console.log(`🎣 fetching contributions for ${values.github_user} (html)`);
const cells = await scrapeContributions(values.github_user);
console.log(`   ${cells.length} days, ${cells.filter((c) => c.level > 0).length} with contributions`);

const grid = cellsToGrid(cells);
console.log("📡 computing best route");
const chain = getBestRoute(grid, snake4)!;
chain.push(...getPathToPose(chain.slice(-1)[0], snake4)!);

for (const out of outputs) {
  if (!out) continue;
  if (out.format !== "svg") {
    console.log(`⏭  skipping ${out.filename} (only svg supported here)`);
    continue;
  }
  const svg = createSvg(grid, cells, chain, out.drawOptions, out.animationOptions);
  fs.mkdirSync(path.dirname(out.filename), { recursive: true });
  fs.writeFileSync(out.filename, svg);
  console.log(`💾 ${out.filename}`);
}
