import { useEffect, useState } from "react";
import { legal } from "@/config/legal";
import { A, H2, LegalLayout, UL } from "@/components/legal/LegalLayout";
import { loadPacks, type Pack } from "@/lib/payments";

/** Shown if the price list can't be loaded; keep in step with credit_packs. */
const FALLBACK: Pack[] = [
  { id: "starter", credits: 5, pricePaise: 9900 },
  { id: "standard", credits: 10, pricePaise: 19900 },
  { id: "serious", credits: 30, pricePaise: 49900 },
];

const rupees = (paise: number) => `₹${Math.round(paise / 100)}`;

export default function About() {
  const [packs, setPacks] = useState<Pack[]>(FALLBACK);
  useEffect(() => {
    loadPacks().then((p) => p.length && setPacks(p));
  }, []);

  return (
    <LegalLayout title="About ShastraLab" dated={false}>
      <p>
        {legal.brand} gives UPSC Civil Services aspirants examiner-style feedback on Mains answers in minutes instead of
        days. Write an answer (or photograph your handwritten sheet) and get marks, the points you covered and missed, and
        specific fixes, checked against a rubric for what each question demands.
      </p>
      <p>
        {legal.brand} is run by {legal.operator} from {legal.address}. It is independent and not affiliated with UPSC.
      </p>

      <H2 id="pricing">Pricing</H2>
      <p>Your first evaluation is free. After that, buy a pack of evaluation credits. One credit = one answer evaluated.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left border rounded-lg">
          <thead className="bg-muted">
            <tr>
              <th className="p-3">Pack</th>
              <th className="p-3">Evaluations</th>
              <th className="p-3">Price</th>
              <th className="p-3">Per answer</th>
            </tr>
          </thead>
          <tbody>
            {packs.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3 capitalize">{p.id}</td>
                <td className="p-3">{p.credits}</td>
                <td className="p-3 font-semibold">{rupees(p.pricePaise)}</td>
                <td className="p-3">{rupees(p.pricePaise / p.credits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <UL>
        <li>Prices in Indian Rupees, inclusive of applicable taxes. Pay by UPI, card or netbanking via Razorpay.</li>
        <li>One-time purchase, no subscription. Credits don't expire while your account is open.</li>
        <li>Reading photos and scanned PDFs is free (fair-use daily limit).</li>
        <li>Refunds: see the <A href="/refunds">Refund Policy</A>.</li>
      </UL>

      <H2>Questions?</H2>
      <p>
        <A href="/contact">Contact us</A> at <A href={`mailto:${legal.email}`}>{legal.email}</A>.
      </p>
    </LegalLayout>
  );
}
