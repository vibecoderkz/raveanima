import { main } from "./cli.js";

main().catch((e: Error) => {
  process.stderr.write(`raveanima: ${e.message}\n`);
  process.exit(1);
});
