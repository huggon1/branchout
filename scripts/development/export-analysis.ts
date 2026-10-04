import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { projectStateSchema } from "../../src/shared/project-contracts";
const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
if (args.includes("--help")) {
  console.log(
    "Usage: npm run review:export -- --profile PATH --output PATH [--report REPORT_ID]\nExports saved reports and prompt guidance locally; credentials and raw conversations stay in the profile.",
  );
} else {
  try {
    const profile = value("--profile"),
      output = value("--output");
    if (!profile || !output)
      throw new Error("Select --profile and --output paths");
    const state = projectStateSchema.parse(
      JSON.parse(
        await readFile(join(resolve(profile), "projects.json"), "utf8"),
      ),
    );
    const id = value("--report");
    const reports = state.analysisReports.filter(
      (r) => !id || r.analysisReportId === id,
    );
    if (!reports.length) throw new Error("No matching saved analysis reports");
    await mkdir(resolve(output), { recursive: true, mode: 0o700 });
    for (const report of reports) {
      const base = join(resolve(output), report.analysisReportId);
      await writeFile(`${base}.json`, JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
      const en = report.outputLanguage === "en";
      const cards = report.suggestions
        .map(
          (s, i) =>
            `### ${i + 1}. ${s.kind === "create" ? (en ? "New card" : "新增关注卡") : en ? "Update card" : "更新关注卡"}\n\n${s.content}\n\n${s.reason}`,
        )
        .join("\n\n");
      const evidence = report.findings
        .map(
          (f, i) =>
            `### [${i + 1}] ${f.title}\n\n${f.content}\n\n${f.evidence.map((e) => `${e.location}\n\n> ${e.quote.replace(/\n/g, "\n> ")}`).join("\n\n")}`,
        )
        .join("\n\n");
      await writeFile(
        `${base}.md`,
        `# ${report.projectLabel}\n\n${report.generatedAt}\n\n${report.summary ?? ""}\n\n---\n\n${en ? "## Supporting evidence" : "## 报告依据"}\n\n${evidence}\n\n---\n\n${en ? "## Focus-card suggestions" : "## 关注卡建议"}\n\n${cards}\n`,
        { mode: 0o600 },
      );
    }
    console.log(`Exported ${reports.length} saved reports`);
  } catch {
    console.error(
      "Analysis export failed; check selected paths and report identity.",
    );
    process.exitCode = 1;
  }
}
