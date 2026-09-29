import { help, listSessions, parseCli, prepareInput, repositoryRoot } from "./common";

try {
  const options = parseCli(process.argv.slice(2), "preview");
  if ("help" in options) process.stdout.write(help("preview"));
  else if (options.list) await listSessions(await repositoryRoot(options.repository));
  else {
    const prepared = await prepareInput(options);
    process.stdout.write(`Conversation preview: ${prepared.directory}/conversation.xml\nActual model prompts: ${prepared.directory}/prompts/\nInput summary: ${prepared.directory}/input.json\n`);
  }
} catch (error) {
  process.stderr.write(`Conversation preview failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
