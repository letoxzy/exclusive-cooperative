import { Helmet } from "react-helmet-async";
import "../styles/contact.css";
import "../styles/delete-account.css";

// Shared layout for the Privacy Policy and Terms pages.
export default function LegalPage({ title, intro, sections }) {
  return (
    <div className="contact-page delete-account-page">
      <Helmet>
        <title>{title} | Exclusive Cooperative</title>
      </Helmet>
      <section className="page-hero">
        <p className="eyebrow">Legal</p>
        <h1>{title}</h1>
        <p className="page-hero-sub">{intro}</p>
      </section>
      <div className="delete-account-body">
        {sections.map((s) => (
          <section className="delete-account-card" key={s.h}>
            <h2>{s.h}</h2>
            {s.p.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            {s.ul && (
              <ul>
                {s.ul.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
