import { existsSync } from "node:fs";

const huskyPackage = new URL("../node_modules/husky/package.json", import.meta.url);

// Production-only installs omit the Husky development dependency. In a full
// development install, preserve Husky's normal hook setup and surface failures.
if (existsSync(huskyPackage)) {
  const { default: husky } = await import("husky");
  const message = husky();
  if (message) console.log(message);
}
