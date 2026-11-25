import { legal } from "@/config/legal";
import { A, H2, LegalLayout, UL } from "@/components/legal/LegalLayout";

export default function Refunds() {
  return (
    <LegalLayout title="Refund & Cancellation Policy">
      <p>
        Your first evaluation is free, so you can try {legal.brand} before paying. After that, credit packs are one-time
        purchases. There are no subscriptions to cancel.
      </p>

      <H2>When you get a refund</H2>
      <UL>
        <li><strong>Unused pack, within 7 days:</strong> if you haven't used any credits from a pack, ask within 7 days of purchase for a full refund.</li>
        <li><strong>Partly used pack, within 7 days:</strong> we refund the unused credits pro rata (for example, 6 of 10 credits unused on a ₹199 pack refunds ₹119).</li>
        <li><strong>Charged but no credits:</strong> if money left your account and the credits didn't arrive within 1 hour, contact us. We'll add the credits or refund in full; this has no time limit.</li>
        <li><strong>Charged twice:</strong> duplicate payments are refunded in full.</li>
        <li><strong>Our error:</strong> if an evaluation failed or was clearly wrong because of a fault on our side, we return the credit (failed evaluations are returned automatically).</li>
      </UL>
      <p>
        Credits used for evaluations that worked as described aren't refundable after 7 days, since the service has been
        delivered.
      </p>

      <H2>How to ask</H2>
      <p>
        Email <A href={`mailto:${legal.email}`}>{legal.email}</A> from your account email with your Razorpay payment ID (in your
        payment confirmation) or the purchase date. We reply within {legal.refundResponseDays} working days.
      </p>

      <H2>How refunds are paid</H2>
      <p>
        Approved refunds go back to the original payment method (UPI, card or bank account) through Razorpay. They usually
        reach you within {legal.refundCreditDays} working days of approval, depending on your bank. When a refund is issued,
        the refunded credits are removed from your account.
      </p>

      <H2>Cancellation</H2>
      <p>
        Packs don't renew, so there's nothing to cancel. If you close the payment window before paying, no money is taken.
        You can delete your account at any time in <A href="/settings">Settings</A>; request any refund first.
      </p>
    </LegalLayout>
  );
}
