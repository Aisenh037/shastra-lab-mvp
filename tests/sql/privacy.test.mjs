import { check, done, freshDb, throws } from "./harness.mjs";

// Plant a template whose owner is from an old project, just before the privacy migration runs.
const { q } = await freshDb({
  before: async (file, db) => {
    if (file.includes("privacy_dpdp")) {
      await db.exec(`insert into mock_tests(id,user_id,title,is_template) values (gen_random_uuid(), gen_random_uuid(), 'GS2 template', true)`);
    }
  },
});
check("stale template kept as shared (user_id cleared)", (await q(`select user_id from mock_tests where title='GS2 template'`))[0]?.user_id===null);
const u = (await q(`insert into auth.users(email, raw_user_meta_data) values ('a@x.in', '{"terms_version":"2026-11-25","privacy_version":"2026-11-25","age_confirmed":true}') returning id`))[0].id;
const g = (await q(`insert into auth.users(email, raw_user_meta_data) values ('g@x.in', '{"full_name":"G"}') returning id`))[0].id;
check("email signup consent recorded by trigger", (await q(`select source, terms_version, age_confirmed from user_consents where user_id='${u}'`))[0]?.source==='signup');
check("google signup: no consent until asked", (await q(`select count(*)::int n from user_consents where user_id='${g}'`))[0].n===0);
await q(`select set_config('request.jwt.claim.sub','${g}',false)`);
let threw=false; try { await q(`select record_consent('2026-11-25','2026-11-25', false)`); } catch { threw=true; }
check("consent refused without 18+ confirmation", threw);
await q(`select record_consent('2026-11-25','2026-11-25', true)`);
check("in-app consent recorded for the caller", (await q(`select source from user_consents where user_id='${g}'`))[0]?.source==='in_app');
await q(`select set_config('request.jwt.claim.sub','',false)`);
// give user u data everywhere
const pq = (await q(`insert into practice_questions(user_id, question_text, subject) values ('${u}','Q?','GS2') returning id`))[0].id;
await q(`insert into answer_submissions(user_id, question_id, answer_text, status) values ('${u}','${pq}','ans','evaluated')`);
await q(`insert into mock_tests(user_id,title) values ('${u}','my test')`);
await q(`insert into payment_orders(id,user_id,pack_id,credits,amount_paise,status,payment_id) values ('order_D','${u}','starter',5,9900,'paid','pay_D')`);
await q(`insert into payment_orders(id,user_id,pack_id,credits,amount_paise) values ('order_E','${u}','starter',5,9900)`);
await q(`select ensure_credit_account('${u}')`);
await q(`delete from auth.users where id='${u}'`);
const left = await q(`select (select count(*) from answer_submissions)::int a, (select count(*) from practice_questions where user_id is not null)::int p,
  (select count(*) from mock_tests where not is_template)::int m, (select count(*) from evaluation_credits)::int c, (select count(*) from credit_ledger)::int l,
  (select count(*) from user_consents where terms_version<>'x' and user_id='${u}')::int uc`);
check("account deletion removes the user's data", JSON.stringify(left[0])===JSON.stringify({a:0,p:0,m:0,c:0,l:0,uc:0}), left);
const orders = await q(`select id, user_id, amount_paise from payment_orders order by id`);
check("payment records kept, detached from the person", orders.length===2 && orders.every(o=>o.user_id===null), orders);
const r = (await q(`select fulfil_payment_order('order_E','pay_E',9900,'webhook') r`))[0].r;
check("payment for a deleted account: recorded, nobody credited", r.outcome==='user_deleted' && (await q(`select status from payment_orders where id='order_E'`))[0].status==='paid', r);
const v = (await q(`insert into auth.users(email) values ('r@x.in') returning id`))[0].id;
await q(`select ensure_credit_account('${v}')`);
await q(`update evaluation_credits set balance=10 where user_id='${v}'`);
await q(`insert into payment_orders(id,user_id,pack_id,credits,amount_paise,status,payment_id) values ('order_R','${v}','standard',10,19900,'paid','pay_R')`);
const rr = (await q(`select refund_payment('pay_R','rfnd_R',11900) r`))[0].r;
check("₹119 of ₹199 refund takes back 6 credits (matches Refund Policy)", rr.credits_taken===6, rr);
const rd = (await q(`select refund_payment('pay_D','rfnd_D',9900) r`))[0].r;
check("refund on a deleted account's payment is recorded", rd.outcome==='refunded' && rd.credits_taken===0, rd);
done();
