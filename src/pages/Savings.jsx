import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import "../styles/savings.css";

function Savings() {
  return (
    <div className="savings-page">
      <Helmet>
        <title>Cooperative Savings | Exclusive Cooperative Lagos</title>

        <meta
          name="description"
          content="Learn about savings with Exclusive Cooperative Multipurpose Society Limited. Members can make daily, weekly, or monthly contributions starting from ₦10,000 monthly."
        />

        <link rel="canonical" href="https://exclusivecooperative.com/savings" />
      </Helmet>

      <header className="page-hero">
        <p className="eyebrow">Savings</p>

        <h1>Build a savings habit that actually sticks</h1>

        <p className="page-hero-sub">
          Every member commits to a minimum monthly contribution — the
          foundation that unlocks loan eligibility and long-term financial
          stability.
        </p>
      </header>

      <section className="savings-detail">
        <div className="detail-card featured">
          <h3>Minimum Monthly Savings</h3>

          <p className="big-figure">₦10,000</p>

          <p>
            The baseline every member contributes each month. Your savings
            balance also determines your loan eligibility — members can borrow
            up to 2x what they've saved.
          </p>
        </div>

        <div className="detail-card">
          <h3>Choose Your Frequency</h3>

          <ul>
            <li>Daily contributions</li>
            <li>Weekly contributions</li>
            <li>Monthly contributions</li>
          </ul>

          <p>Pick whichever rhythm fits your income pattern best.</p>
        </div>

        <div className="detail-card">
          <h3>Voluntary Savings</h3>

          <p>
            Want to save beyond the minimum? Members can opt into additional
            voluntary savings on top of their required monthly contribution —
            with no cap on ambition.
          </p>
        </div>
      </section>

      <section className="cta-banner">
        <h2>Start your savings plan today</h2>

        <Link to="/membership" className="btn-primary">
          Apply for Membership
        </Link>
      </section>
    </div>
  );
}

export default Savings;
