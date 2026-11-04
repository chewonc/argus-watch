// Live check of the NVD and OSV fetchers (read-only; nothing is ingested). Run: node --import tsx scripts/checks/sources-live.mts
import { fetchNvd, itemFromNvd } from "../../lib/sources/nvd";
import { getVuln, itemFromOsv, queryBatch } from "../../lib/sources/osv";
const until = new Date(); const since = new Date(Date.now() - 6 * 3600e3);
const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, ".000Z");
const cves = await fetchNvd(iso(since), iso(until));
const kept = cves.map((c) => itemFromNvd(c, until.toISOString())).filter(Boolean);
console.log(`NVD: ${cves.length} CVE change(s) in the last 6 h, ${kept.length} in software/AI scope`);
for (const it of kept.slice(0, 3)) console.log(`  ${it!.title.slice(0, 110)}`);
const res = await queryBatch([{ ecosystem: "npm", name: "next", version: "14.2.10" }, { ecosystem: "npm", name: "jsonwebtoken", version: "8.5.1" }, { ecosystem: "npm", name: "left-pad", version: "1.3.0" }]);
console.log(`OSV: next@14.2.10 -> ${res[0].length} vuln(s); jsonwebtoken@8.5.1 -> ${res[1].length}; left-pad@1.3.0 -> ${res[2].length}`);
const v = await getVuln(res[0][0].id);
const it = itemFromOsv(v!, until.toISOString());
console.log(`  first: ${it.title.slice(0, 100)} | ids ${it.ids.join(",")} | packages ${JSON.stringify(it.packages)}`);
