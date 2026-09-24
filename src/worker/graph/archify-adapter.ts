import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const selectionBridge = `\n<script>(function(){\n  var idPattern = /^[A-Za-z0-9_-]{1,96}$/;\n  document.addEventListener('click', function(event) {\n    if (!event.isTrusted || !(event.target instanceof Element)) return;\n    var node = event.target.closest('[data-node-id]');\n    if (!node) return;\n    var nodeId = node.getAttribute('data-node-id');\n    if (!nodeId || !idPattern.test(nodeId)) return;\n    window.parent.postMessage({ channel: 'branchout.archify', version: 1, type: 'node-selected', nodeId: nodeId }, '*');\n  }, true);\n})();</script>\n`;

async function cliPath() {
  const candidates = [
    new URL("./vendor/archify/bin/archify.mjs", import.meta.url),
    new URL("../vendor/archify/bin/archify.mjs", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const path = fileURLToPath(candidate);
      await access(path);
      return path;
    } catch {
      // Continue with the packaged worker and repository source layouts.
    }
  }
  return join(process.cwd(), "src/worker/vendor/archify/bin/archify.mjs");
}

async function runArchify(args: string[], signal?: AbortSignal) {
  try {
    const { stdout } = await exec(
      process.execPath,
      [await cliPath(), ...args],
      {
        timeout: 120_000,
        maxBuffer: 8_000_000,
        windowsHide: true,
        encoding: "utf8",
        signal,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
        },
      },
    );
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    if (signal?.aborted) throw new Error("cancelled");
    throw new Error(`archify_${args[0]}_failed`);
  }
}

export type ArchifyOutput = {
  graphSource: Record<string, unknown>;
  viewArtifact: string;
  nodeIds: string[];
  receipts: {
    validation: Record<string, unknown>;
    delivery: Record<string, unknown>;
  };
};

function graphNodes(
  source: Record<string, unknown>,
): Array<{ id: string; label: string }> {
  const type = source.diagram_type;
  const nodes =
    type === "workflow"
      ? source.nodes
      : type === "architecture"
        ? source.components
        : null;
  if (!Array.isArray(nodes) || !nodes.length)
    throw new Error("graph_nodes_missing");
  return nodes.map((value) => {
    if (!value || typeof value !== "object")
      throw new Error("graph_node_invalid");
    const node = value as Record<string, unknown>;
    if (
      typeof node.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,96}$/.test(node.id) ||
      typeof node.label !== "string"
    )
      throw new Error("graph_node_invalid");
    return { id: node.id, label: node.label };
  });
}

function assertReceipt(value: Record<string, unknown>, command: string) {
  if (value.ok !== true || (command !== "check" && value.command !== command))
    throw new Error(`archify_${command}_failed`);
}

export async function validateAndDeliverGraph(
  graphSource: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ArchifyOutput> {
  const type = graphSource.diagram_type;
  if (type !== "workflow" && type !== "architecture")
    throw new Error("graph_direction_type_mismatch");
  const nodeIds = graphNodes(graphSource).map((node) => node.id);
  const workspace = await mkdtemp(join(tmpdir(), "branchout-archify-"));
  const inputPath = join(workspace, "graph.json");
  const outputPath = join(workspace, "view.html");
  try {
    await writeFile(inputPath, JSON.stringify(graphSource), {
      encoding: "utf8",
      flag: "wx",
    });
    const validation = await runArchify(
      ["validate", type, inputPath, "--quality", "showcase", "--json"],
      signal,
    );
    assertReceipt(validation, "validate");
    const delivery = await runArchify(
      [
        "deliver",
        type,
        inputPath,
        outputPath,
        "--quality",
        "showcase",
        "--json",
      ],
      signal,
    );
    assertReceipt(delivery, "deliver");
    const html = await readFile(outputPath, "utf8");
    if (!html.includes("<svg") || !html.toLowerCase().includes("</body>"))
      throw new Error("archify_html_invalid");
    const bridged = html.replace(/<\/body>/i, `${selectionBridge}</body>`);
    if (bridged === html) throw new Error("archify_bridge_injection_failed");
    await writeFile(outputPath, bridged, { encoding: "utf8", flag: "w" });
    const checked = await runArchify(["check", outputPath], signal);
    assertReceipt(checked, "check");
    return {
      graphSource,
      viewArtifact: bridged,
      nodeIds,
      receipts: { validation, delivery },
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
