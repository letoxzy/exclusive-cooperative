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

        <link
          rel="canonical"
          href="https://www.exclusivecooperative.com/savings"
        />
      </Helmet>

      <header className="page-hero">
        <p className="eyebrow">Savings</p>

        <h1>Build a savings habit that actually sticks</h1>

        <p className="page-hero-sub">
          Members choose a Daily, Weekly, or Monthly contribution frequency,
          with a minimum regular contribution of ₦10,000. Each contribution
          is split between locked savings and the current month's withdrawal pool.
        </p>
      </header>

      <section className="savings-detail">
        <div className="detail-card featured">
          <h3>Minimum Regular Contribution</h3>

          <p className="big-figure">₦10,000</p>

          <p>
            The minimum regular contribution is ₦10,000. 60% of each approved
            contribution is added to locked savings, while 40% contributes to
            the current month's withdrawal pool.
          </p>
        </div>

        <div className="detail-card">
          <h3>Choose Your Frequency</h3>

          <ul>
            <li>Daily contributions</li>
            <li>Weekly contributions</li>
            <li>Monthly contributions</li>
          </ul>

          <p>Choose the frequency that fits your income pattern. Regular contributions
            are limited to once per selected period, while savings withdrawals
            are available once per month for everyone.</p>
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
