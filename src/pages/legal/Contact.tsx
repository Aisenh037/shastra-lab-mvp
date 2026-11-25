import { Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import { legal } from "@/config/legal";
import { A, H2, LegalLayout } from "@/components/legal/LegalLayout";

export default function Contact() {
  return (
    <LegalLayout title="Contact us" dated={false}>
      <p>We're a small team and read every message. We usually reply within 1–2 working days.</p>

      <div className="grid gap-4 sm:grid-cols-2 pt-2">
        <div className="rounded-lg border p-4">
          <Mail className="h-5 w-5 text-primary mb-2" />
          <div className="font-semibold">Support, payments and refunds</div>
          <A href={`mailto:${legal.email}`}>{legal.email}</A>
        </div>
        <div className="rounded-lg border p-4">
          <Phone className="h-5 w-5 text-primary mb-2" />
          <div className="font-semibold">Phone</div>
          <span>{legal.phone}</span>
          <div className="text-sm text-muted-foreground">Mon–Sat, 10am–6pm IST</div>
        </div>
        <div className="rounded-lg border p-4 sm:col-span-2">
          <MapPin className="h-5 w-5 text-primary mb-2" />
          <div className="font-semibold">{legal.operator}</div>
          <span>{legal.address}</span>
          {legal.gstin && <div className="text-sm text-muted-foreground">GSTIN {legal.gstin}</div>}
        </div>
      </div>

      <H2 id="grievance">Grievance Officer</H2>
      <div className="rounded-lg border p-4 flex gap-3">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">{legal.grievanceOfficer}</div>
          <A href={`mailto:${legal.grievanceEmail}`}>{legal.grievanceEmail}</A>
          <p className="text-sm text-muted-foreground mt-1">
            For privacy requests (access, correction, erasure, nomination) and complaints. We acknowledge within 2 working
            days and resolve within 90 days at most, as the DPDP Rules require. You can also download or delete your data
            yourself in <A href="/settings">Settings</A>.
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground pt-4">{legal.brand} is not affiliated with the Union Public Service Commission.</p>
    </LegalLayout>
  );
}
