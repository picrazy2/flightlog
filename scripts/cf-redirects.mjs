// Post-build: write dist/_redirects for Cloudflare Pages (served at the root of
// journia.akguo.com).
// - bare "/" → the default user (/alex)
// - SPA fallback so deep links like /alex serve index.html
import { mkdirSync, writeFileSync } from "node:fs";

const rules = `/        /alex          302
/*       /index.html    200
`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/_redirects", rules);
console.log("wrote dist/_redirects");
