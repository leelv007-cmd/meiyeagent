import { runIssue255LiveReconciliationCli } from './issue-255-live-collector-cli.js';

runIssue255LiveReconciliationCli({
  argv: process.argv.slice(2),
  env: process.env,
}).then(
  () => {},
  (error: unknown) => {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : 'Recovery failed.');
  },
);
