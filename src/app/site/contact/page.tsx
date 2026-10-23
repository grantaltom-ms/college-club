import { SITE } from "@/site/content";
import { requireSite } from "@/site/guard";
import { pageMetadata } from "@/site/metadata";
import { SitePage } from "../SitePage";

export const generateMetadata = () => pageMetadata("contact");

export default async function ContactPage() {
  await requireSite();
  const { club } = SITE;
  return (
    <SitePage page={SITE.pages.contact}>
      <section className="site-section" aria-label="Contact details" data-testid="contact-details">
        <h2>Membership inquiries</h2>
        <p>
          <a href={`mailto:${club.email}`}>{club.email}</a>
          <br />
          Phone: <a href={`tel:${club.phone.replaceAll("-", "")}`}>{club.phone}</a>
        </p>
        <h2>Club hours</h2>
        <p>
          Club: {club.hours.club}
          <br />
          Office: {club.hours.office}
        </p>
        <h2>Directors</h2>
        <ul className="site-people">
          {club.people.map((person) => (
            <li key={person.name}>
              <strong>{person.name}</strong> ({person.role})
            </li>
          ))}
        </ul>
        <h2>Visit us</h2>
        <p>
          {club.address.map((line) => (
            <span key={line}>
              {line}
              <br />
            </span>
          ))}
        </p>
      </section>
    </SitePage>
  );
}
