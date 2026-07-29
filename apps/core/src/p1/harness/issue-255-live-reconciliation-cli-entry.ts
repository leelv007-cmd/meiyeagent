import { runIssue255LiveReconciliationCli } from './issue-255-live-collector-cli.js';

await runIssue255LiveReconciliationCli({
  argv: process.argv.slice(2),
  env: process.env,
});
