import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import request from "../utils/api";
import "../styles/contact.css";
import "../styles/delete-account.css";

// Public page. Google Play requires a web address where anyone can ask for
// their app account and data to be deleted without opening the app.
function DeleteAccount() {
  const [form, setForm] = useState({ email: "", fullName: "", reason: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const update = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    const email = form.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setError("Enter the email address you used for your account.");
      return;
    }

    setLoading(true);
    try {
      const data = await request("/public/account-deletion-request", {
        method: "POST",
        body: { ...form, email },
      });
      setDone(data.message || "Your request has been received.");
    } catch (err) {
      setError(err.message || "Could not send your request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="contact-page delete-account-page">
      <Helmet>
        <title>Delete your account | Exclusive Cooperative</title>
        <meta
          name="description"
          content="Request deletion of your Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited app account and personal data."
        />
      </Helmet>

      <section className="page-hero">
        <p className="eyebrow">Your data</p>
        <h1>Delete your account</h1>
        <p className="page-hero-sub">
          Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited
          mobile app and website
        </p>
      </section>

      <div className="delete-account-body">
        <section className="delete-account-card">
          <h2>Delete it yourself in the app</h2>
          <p>
            Open the app, go to <strong>Profile → Delete account</strong>,
            enter your password and confirm. If you have no savings, loan or
            pending payment, your account is deleted straight away.
          </p>
        </section>

        <section className="delete-account-card">
          <h2>Or send us a request here</h2>
          <p>
            If you cannot sign in, or you still hold savings or a loan, send a
            request. The cooperative office will contact you on the email you
            give to confirm it is really you, settle your account with you, and
            then delete it.
          </p>

          {done ? (
            <div className="delete-account-done" role="status">
              <strong>Request received</strong>
              <p>{done}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="delete-account-form" noValidate>
              <label htmlFor="da-email">Account email</label>
              <input
                id="da-email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={update("email")}
                placeholder="you@example.com"
                disabled={loading}
                required
              />

              <label htmlFor="da-name">Full name (optional)</label>
              <input
                id="da-name"
                type="text"
                autoComplete="name"
                value={form.fullName}
                onChange={update("fullName")}
                disabled={loading}
                maxLength={120}
              />

              <label htmlFor="da-reason">Reason (optional)</label>
              <textarea
                id="da-reason"
                rows={3}
                value={form.reason}
                onChange={update("reason")}
                disabled={loading}
                maxLength={500}
              />

              {error && <p className="form-error">{error}</p>}

              <button type="submit" disabled={loading}>
                {loading ? "Sending..." : "Request account deletion"}
              </button>
            </form>
          )}
        </section>

        <section className="delete-account-card">
          <h2>What is deleted, and what is kept</h2>
          <ul>
            <li>
              <strong>Deleted:</strong> your login, profile, membership
              details and notifications.
            </li>
            <li>
              <strong>Kept:</strong> records the cooperative must keep for
              accounting and legal reasons, such as past transactions, loan
              records and identity-verification records, for the period the
              law requires. After your account is deleted these records are
              no longer linked to a sign-in.
            </li>
            <li>
              <strong>Before we can delete:</strong> any savings must be
              withdrawn and any loan repaid, so that no money is left in your
              account.
            </li>
          </ul>
          <p>
            Questions? <Link to="/contact">Contact us</Link> or email{" "}
            <a href="mailto:exclusivecooperative@gmail.com">
              exclusivecooperative@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}

export default DeleteAccount;
