const requiredMajor = 24;
const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (major !== requiredMajor) {
  console.error(`Node.js ${requiredMajor}.x is required for release checks; found ${process.version}. Use mise or nvm before continuing.`);
  process.exit(1);
}
