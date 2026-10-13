import { loadCampaigns, mailchimpConfig, sampleEmail, type EmailData } from "@/lib/mailchimp";

const NO_STORE = { "Cache-Control": "no-store" };

/** Public, counts only: campaign names and totals, never subscriber names or addresses. */
export async function GET() {
  const cfg = mailchimpConfig();
  if (cfg) {
    try {
      const campaigns = await loadCampaigns(cfg);
      const data: EmailData = {
        source: "live",
        through: campaigns[campaigns.length - 1]?.sentOn ?? "",
        campaigns,
      };
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load Mailchimp reports", error);
      return Response.json({ error: "Mailchimp could not be reached. Try again in a minute." }, { status: 502, headers: NO_STORE });
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleEmail(), { headers: NO_STORE });
  }
  return Response.json(
    { error: "Mailchimp is not connected yet. Add MAILCHIMP_API_KEY in Vercel, then redeploy." },
    { status: 503, headers: NO_STORE },
  );
}
