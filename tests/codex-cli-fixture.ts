import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// A native Windows fixture exercises stdio without a shell or relay process.
export async function writeCodexFixture(
  bin: string,
  models: { model: string; displayName: string }[],
) {
  if (process.platform !== "win32") {
    await writeFile(
      join(bin, "codex"),
      `#!${process.execPath}
const fs=require('fs'),p=require('path'),rl=require('readline');
if(process.argv.includes('--version')){console.log('codex-cli 9999.0.0');process.exit(0)}
rl.createInterface({input:process.stdin}).on('line',line=>{
  const q=JSON.parse(line);if(q.id===undefined)return;let result={};
  if(q.method==='account/read'){
    result={account:{type:'chatgpt',email:null}};
    if(q.params?.refreshToken)fs.writeFileSync(p.join(process.env.CODEX_HOME,'refresh-observed.json'),JSON.stringify({refreshed:true}));
  }
  if(q.method==='model/list')result={data:${JSON.stringify(models)},nextCursor:null};
  if(q.method==='getAuthStatus')result={authMethod:'chatgpt',authToken:null,requiresOpenaiAuth:true};
  console.log(JSON.stringify({id:q.id,result}));
});`,
      { mode: 0o700 },
    );
    return;
  }
  const encodedModels = Buffer.from(JSON.stringify(models)).toString("base64");
  const source = join(bin, "codex-fixture.cs");
  await writeFile(
    source,
    `
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
class Fixture {
  static int Main(string[] args) {
    if (Array.IndexOf(args, "--version") >= 0) { Console.WriteLine("codex-cli 9999.0.0"); return 0; }
    var json = new JavaScriptSerializer();
    var models = json.DeserializeObject(Encoding.UTF8.GetString(Convert.FromBase64String("${encodedModels}")));
    string line;
    while ((line = Console.ReadLine()) != null) {
      var q = json.Deserialize<Dictionary<string, object>>(line);
      if (!q.ContainsKey("id")) continue;
      object result = new Dictionary<string, object>();
      var method = (string)q["method"];
      if (method == "account/read") {
        result = new { account = new { type = "chatgpt", email = (string)null } };
        object value;
        if (q.TryGetValue("params", out value)) {
          var parameters = (Dictionary<string, object>)value;
          if (parameters.ContainsKey("refreshToken") && (bool)parameters["refreshToken"])
            File.WriteAllText(Path.Combine(Environment.GetEnvironmentVariable("CODEX_HOME"), "refresh-observed.json"), json.Serialize(new { refreshed = true }));
        }
      }
      if (method == "model/list") result = new { data = models, nextCursor = (string)null };
      if (method == "getAuthStatus") result = new { authMethod = "chatgpt", authToken = (string)null, requiresOpenaiAuth = true };
      Console.WriteLine(json.Serialize(new { id = q["id"], result = result }));
    }
    return 0;
  }
}`,
  );
  execFileSync(
    join(
      process.env.SystemRoot!,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    ),
    [
      "/nologo",
      "/target:exe",
      "/reference:System.Web.Extensions.dll",
      `/out:${join(bin, "codex.exe")}`,
      source,
    ],
    { timeout: 30000, windowsHide: true },
  );
}
