// Post-build: write dist/_redirects for Cloudflare Pages.
// - bare /journia (and trailing slash) → the default user
// - SPA fallback so deep links like /journia/alex serve the app's index.html
import { mkdirSync, writeFileSync } from "node:fs";

const rules = `/journia            /journia/alex          302
/journia/           /journia/alex          302
/journia/*          /journia/index.html    200
`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/_redirects", rules);
console.log("wrote dist/_redirects");
