import { legal } from "@/config/legal";
import { A, H2, LegalLayout } from "@/components/legal/LegalLayout";

export default function Delivery() {
  return (
    <LegalLayout title="Shipping & Delivery Policy">
      <p>{legal.brand} is an online service. Nothing is shipped; there are no physical products and no delivery charges.</p>

      <H2>When you receive what you paid for</H2>
      <p>
        Evaluation credits are added to your account automatically as soon as the payment is confirmed, normally within a
        few seconds. You'll see the new balance in the sidebar. Evaluations are then delivered in the app, usually within a
        few minutes of submitting an answer.
      </p>

      <H2>If something doesn't arrive</H2>
      <p>
        If credits haven't appeared within 1 hour of a successful payment, email{" "}
        <A href={`mailto:${legal.email}`}>{legal.email}</A> with your Razorpay payment ID. We'll add them or refund you in
        full; see the <A href="/refunds">Refund Policy</A>.
      </p>

      <H2>Where we serve</H2>
      <p>The service is available online anywhere in India. Payments are accepted in Indian Rupees.</p>
    </LegalLayout>
  );
}
