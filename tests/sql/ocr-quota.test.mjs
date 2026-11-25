import { check, done, freshDb, throws } from "./harness.mjs";

const { q } = await freshDb();
const u = (await q(`insert into auth.users(email) values ('a@x.in') returning id`))[0].id;
const r = async (n,l=5) => (await q(`select reserve_ocr_pages('${u}',${n},${l}) as r`))[0].r;
check("first reservation leaves limit-1", await r(1)===4);
check("multi-page reservation", await r(3)===1);
check("over-limit refused, nothing reserved", await r(2)===-1);
check("exact fit allowed", await r(1)===0);
check("at zero, refused", await r(1)===-1);
await q(`select release_ocr_pages('${u}',2)`);
check("release gives pages back", await r(2)===0);
await q(`select release_ocr_pages('${u}',99)`);
check("release never goes negative", (await q(`select pages from ocr_usage`))[0].pages===0);
let threw=false; try { await r(0); } catch { threw=true; }
check("zero pages rejected", threw);
const grants = await q(`select routine_name, grantee from information_schema.routine_privileges where routine_name in ('reserve_ocr_pages','release_ocr_pages') and grantee<>'postgres' order by 1`);
check("service_role only", grants.every(g=>g.grantee==="service_role") && grants.length===2, grants);
done();
