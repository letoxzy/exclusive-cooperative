import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import "../styles/about.css";

function About() {
  return (
    <div className="about-page">
      <Helmet>
        <title>
          About Us | Exclusive Cooperative Multipurpose Society Limited
        </title>

        <meta
          name="description"
          content="Learn about Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited, our mission, values, and commitment to helping members build financial security through disciplined savings and fair access to loans."
        />

        <link
          rel="canonical"
          href="https://www.exclusivecooperative.com/about"
        />
      </Helmet>

      <header className="page-hero">
        <p className="eyebrow">About Us</p>

        <h1>A cooperative built on trust, discipline, and shared growth</h1>

        <p className="page-hero-sub">
          Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited
          exists to help members build consistent savings habits and access fair
          financial support when they need it.
        </p>
      </header>

      <section className="about-grid">
        <div className="about-block">
          <h2>Our Mission</h2>

          <p>
            To create a member-owned financial community where every
            contribution — no matter how small — compounds into real security,
            opportunity, and shared prosperity.
          </p>
        </div>

        <div className="about-block">
          <h2>Who We Are</h2>

          <p>
            We are a multipurpose cooperative society registered to serve
            working professionals, self-employed individuals, and business
            owners who want a disciplined, community-backed way to save and
            borrow.
          </p>
        </div>
      </section>

      <section className="values-section">
        <h2>What We Stand For</h2>

        <div className="values-grid">
          <div className="value-card">
            <h3>Transparency</h3>

            <p>Clear rules, clear records, and decisions members can trust.</p>
          </div>

          <div className="value-card">
            <h3>Discipline</h3>

            <p>
              Consistent, structured saving is how real financial security is
              built.
            </p>
          </div>

          <div className="value-card">
            <h3>Community</h3>

            <p>
              Every member has a voice — this cooperative grows the way its
              members shape it.
            </p>
          </div>

          <div className="value-card">
            <h3>Fair Access</h3>

            <p>
              Loans and benefits are structured to be fair and achievable for
              every member.
            </p>
          </div>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Want to be part of it?</h2>

        <Link to="/membership" className="btn-primary">
          Become a Member
        </Link>
      </section>
    </div>
  );
}

export default About;
