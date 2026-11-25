import { legal } from "@/config/legal";
import { A, H2, LegalLayout, UL } from "@/components/legal/LegalLayout";

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These terms are an agreement between you and <strong>{legal.operator}</strong>, {legal.address}, which runs
        {" "}{legal.brand} ("we", "us"). By creating an account or using {legal.brand}, you agree to them and to our{" "}
        <A href="/privacy">Privacy Policy</A>.
      </p>

      <H2>1. The service</H2>
      <p>
        {legal.brand} evaluates practice answers for UPSC Civil Services Mains and similar written exams. You type an answer
        or upload a photo of a handwritten one; we return marks, point-by-point coverage and feedback generated with AI
        models and checked against a marking rubric.
      </p>

      <H2>2. Eligibility and your account</H2>
      <UL>
        <li>You must be 18 or older and able to enter a binding contract under Indian law.</li>
        <li>Give accurate details, keep your password private, and tell us if you think someone else has used your account.</li>
        <li>One person per account. Accounts can't be shared, sold or transferred.</li>
      </UL>

      <H2>3. Evaluations are practice feedback, not official results</H2>
      <UL>
        <li>{legal.brand} is independent and is <strong>not affiliated with, endorsed by or connected to the Union Public Service Commission (UPSC)</strong>.</li>
        <li>Marks are an estimate of how an examiner might score the answer. AI can make mistakes; real examiners differ from each other too.</li>
        <li>We don't guarantee any exam score, rank or selection. Use the feedback as one input to your preparation.</li>
        <li>If an evaluation looks clearly wrong, tell us; we'll review it and, if it was our error, return the credit.</li>
      </UL>

      <H2>4. Credits, prices and payment</H2>
      <UL>
        <li>Your first evaluation is free. After that, each evaluation uses one credit, bought in packs listed on the <A href="/about">pricing page</A>. Prices are in Indian Rupees and include applicable taxes.</li>
        <li>Packs are one-time purchases, not subscriptions; nothing renews automatically.</li>
        <li>Credits stay in your account while it's open, have no cash value, and can't be transferred.</li>
        <li>If an evaluation fails on our side, the credit is returned automatically.</li>
        <li>Payments are processed by Razorpay. Refunds are covered by our <A href="/refunds">Refund Policy</A>.</li>
        <li>Photo and PDF reading is free but limited per day to keep the service fair for everyone.</li>
      </UL>

      <H2>5. Your content</H2>
      <p>
        Your answers stay yours. You give us permission to store, process and send them to our service providers only to run
        {" "}{legal.brand} for you, as described in the Privacy Policy. Only upload content you wrote or have the right to use.
      </p>

      <H2>6. Acceptable use</H2>
      <p>Don't:</p>
      <UL>
        <li>use {legal.brand} to cheat in any live examination or assessment;</li>
        <li>upload content that is unlawful, infringes someone else's rights, or contains someone else's personal data without permission;</li>
        <li>try to break, overload, scrape, reverse-engineer or get around the limits or security of the service;</li>
        <li>resell or redistribute evaluations, model answers or rubrics.</li>
      </UL>
      <p>We may suspend accounts that break these rules. Where reasonable, we'll warn you first and refund unused credits.</p>

      <H2>7. Our content</H2>
      <p>
        Rubrics, model answers, feedback text, software and branding are ours or our licensors'. You may use them for your own
        preparation. Questions from past UPSC papers are public and are reproduced for practice.
      </p>

      <H2>8. Availability and changes</H2>
      <p>
        We aim to keep {legal.brand} running but don't promise it will always be available or error-free. We may change or
        stop features; if we shut down the paid service, we'll refund unused credits.
      </p>

      <H2>9. Liability</H2>
      <p>
        To the extent the law allows, we're not liable for indirect or consequential loss, or for decisions you make based on
        an evaluation. Our total liability to you is limited to the amount you paid us in the 12 months before the claim.
        Nothing in these terms limits rights you have under the Consumer Protection Act, 2019 that can't be limited.
      </p>

      <H2>10. Ending your account</H2>
      <p>
        You can delete your account at any time in <A href="/settings">Settings</A>. Unused credits in a pack bought in the
        last 7 days can be refunded under our <A href="/refunds">Refund Policy</A> before you delete.
      </p>

      <H2>11. Law and disputes</H2>
      <p>
        These terms are governed by the laws of India. Write to us first; most problems are solved quickly. If not, the
        courts at {legal.jurisdiction} have jurisdiction, without affecting your right to approach a consumer commission.
      </p>

      <H2>12. Changes to these terms</H2>
      <p>If we change these terms materially, we'll ask you to accept the new version in the app before you continue.</p>

      <H2>13. Contact</H2>
      <p>
        {legal.operator}, {legal.address}. Email <A href={`mailto:${legal.email}`}>{legal.email}</A>, phone {legal.phone}.
        Grievances: see <A href="/contact">Contact</A>.
      </p>
    </LegalLayout>
  );
}
