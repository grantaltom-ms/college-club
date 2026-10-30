import Link from "next/link";
import { PAGE_PATHS, phoneHref } from "@/site/content";

/** The dark footer on every public page: an invitation, the address and the club's one public phone number, and three links. */
export function SiteFooter({ heading, address, phone, copyright, memberLoginHref }: { heading: string; address: string[]; phone: string; copyright: string; memberLoginHref: string }) {
  return (
    <footer className="ds-footer ds-dark ds-ui">
      <div className="ds-container ds-footer-inner">
        <h2>{heading}</h2>
        <address>
          {address.join(", ")}
          <br />
          <a href={phoneHref(phone)}>{phone}</a>
        </address>
        <nav aria-label="Footer" className="ds-footer-links">
          <Link href={PAGE_PATHS.contact}>Contact</Link>
          <Link href={PAGE_PATHS.membership}>Membership</Link>
          <a href={memberLoginHref} className="ds-footer-member" data-track="member-login-footer">
            Member login <span aria-hidden="true">→</span>
          </a>
        </nav>
        <p className="ds-footer-fine">{copyright}</p>
      </div>
    </footer>
  );
}
