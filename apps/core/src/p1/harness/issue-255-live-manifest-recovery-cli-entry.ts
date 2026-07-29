import { runIssue255LiveManifestRecoveryCli } from './issue-255-live-collector-cli.js';

await runIssue255LiveManifestRecoveryCli({
  argv: process.argv.slice(2),
  env: process.env,
});
