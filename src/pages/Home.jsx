import { Link } from "react-router-dom";
import "../styles/home.css";
import GallerySlider from "../components/home/GallerySlider";
import { Helmet } from "react-helmet-async";

function Home() {
  return (
    <div className="home-page">
      <Helmet>
        <title>
          Exclusive Cooperative Multipurpose Society Limited | Oshodi-Isolo,
          Lagos
        </title>

        <meta
          name="description"
          content="Exclusive Cooperative Multipurpose Society Limited is an Oshodi-Isolo cooperative focused on disciplined savings, cooperative loans, member services, and shared financial growth."
        />

        <link rel="canonical" href="https://exclusivecooperative.com/" />
      </Helmet>
      {/* =========================
          HERO
      ========================= */}

      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">Oshodi / Isolo Cooperative</p>

          <h1>
            Save together.
            <br />
            Grow together.
          </h1>

          <p className="hero-sub">
            Exclusive Cooperative is built around disciplined savings,
            responsible access to cooperative services, and the shared growth of
            its members.
          </p>

          <div className="hero-actions">
            <Link to="/membership" className="btn-primary">
              Become a Member
            </Link>

            <Link to="/about" className="btn-secondary">
              Learn About Us
            </Link>
          </div>
        </div>
      </section>
      <GallerySlider />
      {/* =========================
          AT A GLANCE
      ========================= */}
      <section className="highlight-strip">
        <div className="highlight-item">
          <span className="highlight-number">200</span>
          <span className="highlight-label">Founding member intake</span>
        </div>

        <div className="highlight-item">
          <span className="highlight-number">₦10,000</span>
          <span className="highlight-label">Minimum monthly savings</span>
        </div>

        <div className="highlight-item">
          <span className="highlight-number">3</span>
          <span className="highlight-label">Flexible savings frequencies</span>
        </div>
      </section>

      {/* =========================
          ABOUT
      ========================= */}
      <section className="home-about">
        <div className="home-about-content">
          <p className="section-eyebrow">WHO WE ARE</p>

          <h2>A cooperative built around its members.</h2>

          <p>
            Exclusive Cooperative Multipurpose Society Limited exists to
            encourage disciplined savings, responsible financial participation,
            and shared economic growth among its members.
          </p>

          <p>
            We believe that when members save consistently, support one another,
            and participate responsibly, the cooperative becomes stronger and
            creates greater opportunities for everyone.
          </p>

          <Link to="/about" className="text-link">
            Discover more about us →
          </Link>
        </div>

        <div className="home-about-side">
          <div className="about-value">
            <span className="value-number">01</span>
            <div>
              <h3>Discipline</h3>
              <p>
                Encouraging consistent saving and responsible financial
                participation.
              </p>
            </div>
          </div>

          <div className="about-value">
            <span className="value-number">02</span>
            <div>
              <h3>Trust</h3>
              <p>
                Building relationships through transparency and responsible
                cooperative management.
              </p>
            </div>
          </div>

          <div className="about-value">
            <span className="value-number">03</span>
            <div>
              <h3>Shared Growth</h3>
              <p>
                Creating opportunities that allow members and the cooperative to
                grow together.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =========================
          SERVICES
      ========================= */}
      <section className="services">
        <div className="section-heading">
          <p className="section-eyebrow">OUR SERVICES</p>

          <h2>Cooperative services designed for members.</h2>

          <p>
            Manage your cooperative activities through one secure member
            experience.
          </p>
        </div>

        <div className="service-grid">
          <div className="service-card">
            <span className="service-number">01</span>

            <h3>Savings</h3>

            <p>
              Build disciplined savings through daily, weekly, or monthly
              contributions, with additional voluntary savings when needed.
            </p>

            <Link to="/savings">Explore Savings →</Link>
          </div>

          <div className="service-card">
            <span className="service-number">02</span>

            <h3>Loans</h3>

            <p>
              Eligible members can apply for cooperative loan facilities to
              support personal, business, and other approved needs.
            </p>

            <Link to="/loans">Explore Loans →</Link>
          </div>

          <div className="service-card">
            <span className="service-number">03</span>

            <h3>Withdrawals</h3>

            <p>
              Submit withdrawal requests securely and monitor their status
              through your member account.
            </p>

            <Link to="/withdrawals">View Withdrawals →</Link>
          </div>

          <div className="service-card">
            <span className="service-number">04</span>

            <h3>Dividends</h3>

            <p>
              Stay informed about cooperative dividend distributions and your
              participation in the society's growth.
            </p>

            <Link to="/dashboard">View Your Account →</Link>
          </div>

          <div className="service-card">
            <span className="service-number">05</span>

            <h3>Membership</h3>

            <p>
              Become part of the cooperative and access your savings,
              transactions, loans, and other member services online.
            </p>

            <Link to="/membership">Become a Member →</Link>
          </div>

          <div className="service-card service-card-account">
            <span className="service-number">06</span>

            <h3>Member Account</h3>

            <p>
              Keep track of your cooperative activity, including balances,
              transactions, deposits, loans, and withdrawals.
            </p>

            <Link to="/dashboard">Member Login →</Link>
          </div>
        </div>
      </section>

      {/* =========================
          HOW IT WORKS
      ========================= */}
      <section className="how-section">
        <div className="section-heading">
          <p className="section-eyebrow">HOW IT WORKS</p>

          <h2>Simple steps. Shared progress.</h2>

          <p>Your cooperative journey starts with disciplined participation.</p>
        </div>

        <div className="steps-grid">
          <div className="step-card">
            <span className="step-number">01</span>

            <h3>Become a Member</h3>

            <p>
              Complete your membership application and join the cooperative
              community.
            </p>
          </div>

          <div className="step-card">
            <span className="step-number">02</span>

            <h3>Build Your Savings</h3>

            <p>
              Make regular contributions and develop a consistent savings habit.
            </p>
          </div>

          <div className="step-card">
            <span className="step-number">03</span>

            <h3>Access Services</h3>

            <p>
              When eligible, access cooperative services such as loans and
              withdrawals.
            </p>
          </div>

          <div className="step-card">
            <span className="step-number">04</span>

            <h3>Grow Together</h3>

            <p>
              Participate responsibly and contribute to the long-term strength
              of the cooperative.
            </p>
          </div>
        </div>
      </section>

      {/* =========================
          WHY EXCLUSIVE
      ========================= */}
      <section className="why-section">
        <div className="why-content">
          <p className="section-eyebrow">WHY EXCLUSIVE</p>

          <h2>Built on participation, responsibility and trust.</h2>

          <p>
            A strong cooperative depends on responsible members, transparent
            management, and a shared commitment to growth.
          </p>
        </div>

        <div className="why-grid">
          <div className="why-item">
            <span>✓</span>
            <div>
              <h3>Member Focused</h3>
              <p>Our services are designed around the needs of members.</p>
            </div>
          </div>

          <div className="why-item">
            <span>✓</span>
            <div>
              <h3>Transparent Records</h3>
              <p>
                Members can monitor their cooperative activity and transactions
                through their account.
              </p>
            </div>
          </div>

          <div className="why-item">
            <span>✓</span>
            <div>
              <h3>Secure Member Access</h3>
              <p>
                Members have their own account for managing their cooperative
                activities.
              </p>
            </div>
          </div>

          <div className="why-item">
            <span>✓</span>
            <div>
              <h3>Responsible Growth</h3>
              <p>
                We encourage disciplined participation and sustainable
                cooperative development.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =========================
          COOPERATIVE VALUES
      ========================= */}
      <section className="values-section">
        <div className="section-heading">
          <p className="section-eyebrow">OUR VALUES</p>

          <h2>What we stand for.</h2>
        </div>

        <div className="values-grid">
          <div className="value-card">
            <span>01</span>
            <h3>Trust</h3>
            <p>
              Building dependable relationships between members and the
              cooperative.
            </p>
          </div>

          <div className="value-card">
            <span>02</span>
            <h3>Discipline</h3>
            <p>Promoting consistent savings and responsible participation.</p>
          </div>

          <div className="value-card">
            <span>03</span>
            <h3>Transparency</h3>
            <p>Keeping cooperative activities clear and accountable.</p>
          </div>

          <div className="value-card">
            <span>04</span>
            <h3>Unity</h3>
            <p>Working together toward shared economic and social goals.</p>
          </div>
        </div>
      </section>

      {/* =========================
          GALLERY
      ========================= */}

      {/* =========================
          CTA
      ========================= */}
      <section className="cta-banner">
        <p className="section-eyebrow">JOIN THE COMMUNITY</p>

        <h2>Ready to start building with Exclusive Cooperative?</h2>

        <p>
          Become a member and take the first step toward disciplined savings and
          shared growth.
        </p>

        <div className="cta-actions">
          <Link to="/membership" className="btn-primary">
            Start Your Application
          </Link>

          <Link to="/contact" className="btn-secondary">
            Contact Us
          </Link>
        </div>
      </section>
    </div>
  );
}

export default Home;
