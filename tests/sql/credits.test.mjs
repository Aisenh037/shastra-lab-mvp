import { check, done, freshDb, throws } from "./harness.mjs";

const { q, as, user } = await freshDb();
const a = await user("a@x.in");
const adm = await user("admin@x.in");
await q(`insert into user_roles(user_id, role) values ('${adm}','admin')`);
const one = async (sql) => Object.values((await q(sql))[0])[0];

await as(a);
check("new user sees 1 free trial credit", (await one(`select my_credit_balance()`)) === 1);
check("consuming the trial leaves 0", (await one(`select consume_evaluation_credit('${a}','e1')`)) === 0);
check("no credit left returns -1", (await one(`select consume_evaluation_credit('${a}','e2')`)) === -1);
check("non-admin can't grant credits", await throws(() => q(`select grant_credits('a@x.in',10,'pay_1')`)));
await as(adm);
check("admin grant (email case/space-insensitive)", (await one(`select grant_credits('A@X.in ',10,'pay_1','₹199')`)) === 10);
check("same payment id twice doesn't double-credit", (await one(`select grant_credits('a@x.in',10,'pay_1')`)) === 10);
check("unknown email is an error", await throws(() => q(`select grant_credits('nobody@x.in',10,'pay_2')`)));
check("refund adds one back", (await one(`select refund_evaluation_credit('${a}','e3')`)) === 11);
const ledger = (await q(`select reason||':'||delta s from credit_ledger where user_id='${a}' order by created_at`)).map((r) => r.s).join(",");
check("ledger records every change", ledger === "free_trial:1,evaluation:-1,purchase:10,refund:1", ledger);
done();
