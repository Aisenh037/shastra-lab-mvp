import { legal } from "@/config/legal";
import { A, H2, LegalLayout, UL } from "@/components/legal/LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        This policy explains what personal data {legal.brand} collects, why, who it is shared with, how long it is kept, and
        the rights you have under India's Digital Personal Data Protection Act, 2023 (DPDP Act) and the DPDP Rules, 2025.
        {legal.brand} is run by <strong>{legal.operator}</strong>, {legal.address} ("we"). For this data we are the
        <em> Data Fiduciary</em>.
      </p>

      <H2>In short</H2>
      <UL>
        <li>We use your answers to evaluate them for you, and for nothing unrelated to that.</li>
        <li>We don't sell your data, show ads, or use advertising or tracking cookies.</li>
        <li>Your answers are sent to AI model providers to be scored. We configure them not to train models on your answers.</li>
        <li>You can download all your data or delete your account at any time from <A href="/settings">Settings</A>.</li>
      </UL>

      <H2>1. What we collect</H2>
      <UL>
        <li><strong>Account:</strong> email address, name (if you give it), and a securely hashed password. If you sign in with Google: your name, email and profile picture from Google.</li>
        <li><strong>Your practice content:</strong> answers you type, photos or scanned PDFs of handwritten answers, the text we read from them, the questions you add, mock tests, and the scores and feedback we generate.</li>
        <li><strong>Progress:</strong> practice streaks, achievements and weak-area summaries derived from your answers.</li>
        <li><strong>Payments:</strong> which pack you bought, amount, date, and Razorpay's order and payment IDs. Card, UPI and bank details go directly to Razorpay; we never see or store them.</li>
        <li><strong>Consent records:</strong> which version of these policies you accepted and when, and your confirmation that you are 18 or older.</li>
        <li><strong>Technical:</strong> sign-in times, IP address and browser information in our hosting providers' security logs, and daily usage counters (e.g. photos read per day) used to prevent abuse.</li>
      </UL>

      <H2>2. Why we use it</H2>
      <UL>
        <li>To run your account and evaluate your answers (the service you ask for).</li>
        <li>To process payments and add evaluation credits.</li>
        <li>To keep the service secure, prevent abuse and enforce fair-use limits.</li>
        <li>To check and improve scoring accuracy: our team may review a sample of evaluations to catch scoring errors. Reviewed answers are not published or shared.</li>
        <li>To send account emails (confirmation, password reset, receipts) and, only if you switch them on, progress reports.</li>
        <li>To meet legal obligations (for example tax records).</li>
      </UL>
      <p>
        We process your data on the basis of the consent you give when you sign up, and for the legitimate uses the DPDP Act
        allows (such as complying with law). You can withdraw consent at any time (see section 6); this does not affect what
        we did before you withdrew it.
      </p>

      <H2>3. Who we share it with</H2>
      <p>We use these service providers (<em>Data Processors</em>) only to run {legal.brand}, under their data-protection terms:</p>
      <UL>
        <li><strong>Supabase</strong>: database, sign-in and file storage, hosted in the AWS Mumbai (ap-south-1) region, India.</li>
        <li><strong>AI model providers</strong> (currently Groq and OpenRouter, United States): receive the question, your answer text and answer photos to produce the evaluation. We configure these requests to exclude providers that train on or store prompts where the provider offers that control. Your name and email are not sent.</li>
        <li><strong>Razorpay</strong> (India): payment processing.</li>
        <li><strong>Render</strong>: hosts the website (it does not receive your practice content).</li>
        <li><strong>Our email provider</strong>: delivers account emails.</li>
      </UL>
      <p>
        Some processing (AI evaluation) happens outside India. The DPDP Act allows this except to countries the Government
        restricts; we will stop any transfer to a restricted country. We disclose data to authorities only when Indian law
        requires it.
      </p>

      <H2>4. How long we keep it</H2>
      <UL>
        <li>Account and practice data: while your account is open. When you delete your account, it is erased immediately from our live systems and from backups within 30 days.</li>
        <li>Inactive accounts: if you don't sign in for 3 years, we email you and delete the account 30 days later unless you sign in.</li>
        <li>Payment records: kept for as long as tax and accounting laws require (currently up to 8 years), without your name or email attached once your account is deleted.</li>
        <li>Security logs: kept by our hosting providers for a limited period (typically up to 90 days).</li>
      </UL>

      <H2>5. How we protect it</H2>
      <p>
        Encryption in transit (HTTPS) and at rest; database rules that let each account see only its own data; private
        storage for answer photos; payment confirmation checked by cryptographic signatures; and access to production data
        limited to the people who run {legal.brand}. If a breach affects your data, we will tell you and the Data Protection
        Board of India as the DPDP Rules require, with what happened, the likely impact and what we're doing about it.
      </p>

      <H2>6. Your rights</H2>
      <UL>
        <li><strong>Access:</strong> download everything we hold about you from <A href="/settings">Settings → Your data</A>.</li>
        <li><strong>Correction:</strong> change your name in Settings, or email us to correct anything else.</li>
        <li><strong>Erasure and withdrawing consent:</strong> delete your account in Settings, or email us.</li>
        <li><strong>Nomination:</strong> you can name a person to exercise these rights if you die or become unable to; email us with their details.</li>
        <li><strong>Grievances:</strong> contact our Grievance Officer (below). We respond within 90 days, and usually within a few working days.</li>
        <li><strong>Complaint:</strong> if you're not satisfied, you may complain to the Data Protection Board of India.</li>
      </UL>

      <H2>7. Age</H2>
      <p>
        {legal.brand} is only for people aged 18 and over (the minimum age for the Civil Services Examination is 21). We
        don't knowingly collect data from anyone younger. If you believe a child has an account, tell us and we'll delete it.
      </p>

      <H2>8. Cookies and browser storage</H2>
      <p>
        We don't use advertising or tracking cookies. Your browser stores your sign-in session and display preferences (like
        dark mode) so the app works; clearing site data signs you out.
      </p>

      <H2>9. Changes</H2>
      <p>
        If we change this policy materially, we'll show you the new version in the app and ask you to accept it before you
        continue. The effective date at the top shows the current version.
      </p>

      <H2 id="grievance">10. Contact and Grievance Officer</H2>
      <p>
        Grievance Officer: <strong>{legal.grievanceOfficer}</strong>, {legal.operator}, {legal.address}.<br />
        Email: <A href={`mailto:${legal.grievanceEmail}`}>{legal.grievanceEmail}</A>. General support: <A href={`mailto:${legal.email}`}>{legal.email}</A>.
      </p>
    </LegalLayout>
  );
}
