import { runIssue255LiveCollectorCli } from './issue-255-live-collector-cli.js';

await runIssue255LiveCollectorCli({
  argv: process.argv.slice(2),
  env: process.env,
});
