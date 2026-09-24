import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "branchout-node-ui-"));
const appPath = join(directory, "app");
const dataPath = join(directory, "data");
const repoPath = join(directory, "example-project");
const graphVersionId = "11111111-1111-4111-8111-111111111111";
const targetCommit = "a".repeat(40);
const targetUrl = "https://github.com/example/target-repository";
const graphMarkup = `<!doctype html><html><body><button data-node-id="review-step">查看节点</button><script>window.__bridgeReady=true;document.addEventListener('click',function(event){const node=event.target.closest('[data-node-id]');if(node)window.parent.postMessage({channel:'branchout.archify',version:1,type:'node-selected',nodeId:node.dataset.nodeId},'*')})</script></body></html>`;
const graphWorker = `const port=process.parentPort;port.on('message',({data})=>{if(data.type!=='generate_graph')return;const now=new Date().toISOString();const graph={graphVersionId:${JSON.stringify(graphVersionId)},projectId:data.projectId,projectLabel:data.projectLabel,direction:data.direction,generatedAt:now,projectState:{gitCommitId:'${targetCommit}',hasUncommittedChanges:true,inputSnapshotId:'fixture-snapshot',generatedAt:now},graphSource:{diagram_type:'workflow'},viewArtifact:${JSON.stringify(graphMarkup)},nodes:{'review-step':{nodeId:'review-step',title:'查看阅读步骤',summary:'比较阅读步骤的组织方式。',graphSourceRefs:[],facts:[{statement:'本项目按顺序展示阅读步骤。',evidence:[{relativePath:'src/view.ts',range:'L1',quote:'export const steps',contentDigest:'${"b".repeat(64)}',inputSnapshotId:'fixture-snapshot',workingTree:true}]}],suitability:{status:'suitable',reason:'有明确的步骤组织和代码依据。'},analysisDescription:'比较阅读步骤的顺序、导航方式和目标仓库中的实现依据。'}}};port.postMessage({type:'graph_result',taskId:data.taskId,graph});port.postMessage({type:'completed',taskId:data.taskId})});`;
const analysisWorker = `const port=process.parentPort;port.on('message',({data})=>{if(data.type!=='analyze_repository')return;port.postMessage({type:'analysis_result',taskId:data.taskId,resultId:'22222222-2222-4222-8222-222222222222',result:{targetRepositoryUrl:data.targetRepositoryUrl,targetCommit:'${targetCommit}',checkedScope:['README.md'],status:'matched',conclusion:'目标仓库提供了可比较的阅读步骤。',evidence:[{commitId:'${targetCommit}',relativePath:'README.md',range:'line 1',quote:'Reading steps'}],comparisons:[{point:'步骤组织',projectApproach:'按顺序展示步骤',targetApproach:'列出阅读步骤',difference:'入口位置不同',projectEvidence:[{path:'src/view.ts',range:'L1',quote:'export const steps',contentDigest:'${"b".repeat(64)}'}],targetEvidence:[{commitId:'${targetCommit}',relativePath:'README.md',range:'line 1',quote:'Reading steps'}]}]}});port.postMessage({type:'completed',taskId:data.taskId})});`;
const server = createServer((_request, response) => { response.writeHead(200, {"content-type":"application/json"}); response.end("{}"); });
let application;
try {
  await mkdir(repoPath);
  execFileSync("git", ["init", "-q", repoPath]);
  await mkdir(join(repoPath, "src"));
  await writeFile(join(repoPath, "README.md"), "# Example project\nReading flow.\n");
  await writeFile(join(repoPath, "src/view.ts"), "export const steps = ['open', 'read'];\n");
  execFileSync("git", ["-C", repoPath, "add", "."]);
  execFileSync("git", ["-C", repoPath, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "fixture"]);
  await mkdir(appPath);
  await cp("dist", join(appPath, "dist"), { recursive: true });
  await symlink(resolve("node_modules"), join(appPath, "node_modules"));
  await writeFile(join(appPath, "package.json"), JSON.stringify({name:"branchout-node-ui-test",main:"dist/main/main.cjs"}));
  await writeFile(join(appPath, "dist/worker/exploration-worker.mjs"), graphWorker);
  await writeFile(join(appPath, "dist/worker/analysis-worker.mjs"), analysisWorker);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  application = await electron.launch({args:[appPath],env:{...process.env,BRANCHOUT_TEST_DATA:dataPath}});
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const origin = `http://127.0.0.1:${server.address().port}/v1`;
  const saved = await page.evaluate((baseUrl) => window.branchout.saveModel({method:"generic_api",baseUrl,api:"openai-completions",modelId:"fixture",apiKey:"fixture-key"}), origin);
  assert.equal(saved.ok, true, saved.message);
  await page.getByRole("button", {name:"项目", exact:true}).click();
  await application.evaluate(({dialog}, path) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[path]});}, repoPath);
  await page.getByRole("button", {name:"添加项目"}).click();
  await page.getByText("example-project", {exact:true}).waitFor();
  await page.getByRole("button", {name:"UI/UX", exact:true}).click();
  const projectId = (await page.evaluate(() => window.branchout.exploration())).value.projects[0].projectId;
  await page.getByRole("combobox", {name:"选择项目"}).selectOption(projectId);
  await page.frameLocator("iframe.graph-frame").getByRole("button", {name:"查看节点"}).click();
  assert.equal(
    await page.frameLocator("iframe.graph-frame").locator("body").evaluate(() => window.__bridgeReady),
    true,
    "Graph script should run in its isolated document",
  );
  await page.getByRole("heading", {name:"查看阅读步骤"}).waitFor();
  await page.getByText("比较阅读步骤的顺序、导航方式和目标仓库中的实现依据。").waitFor();
  await page.getByLabel("目标仓库").fill(targetUrl);
  await page.getByRole("button", {name:"分析仓库"}).click();
  await page.getByRole("button", {name:"查看素材"}).click();
  await page.getByText("目标仓库提供了可比较的阅读步骤。").waitFor();
  await page.getByRole("button", {name:"回看项目图节点"}).click();
  await page.getByRole("dialog", {name:"历史项目图"}).waitFor();
  await page.getByRole("button", {name:"关闭历史项目图"}).click();
  await page.getByRole("button", {name:"项目", exact:true}).click();
  await page.getByRole("button", {name:"移除example-project"}).click();
  await page.getByRole("button", {name:"确认"}).click();
  await page.getByText("还没有项目").waitFor();
  const state = await page.evaluate(() => window.branchout.exploration());
  assert.equal(state.value.projects.length, 0);
  await page.getByRole("button", {name:"素材", exact:true}).click();
  await page.getByRole("button", {name:/查看阅读步骤/}).click();
  await page.getByRole("button", {name:"回看项目图节点"}).click();
  await page.getByRole("dialog", {name:"历史项目图"}).waitFor();
  assert.deepEqual(errors, []);
  console.log("Node workspace UI passed: bind, graph click, analysis material, historical graph after unbind.");
} finally {
  if (application) await application.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, {recursive:true,force:true});
}
