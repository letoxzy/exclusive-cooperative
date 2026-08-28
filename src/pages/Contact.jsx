import { useState } from "react";
import emailjs from "@emailjs/browser";
import {
  InstagramIcon,
  TiktokIcon,
  FacebookIcon,
  XIcon,
  MailIcon,
  MapPinIcon,
} from "../components/Icons";
import "../styles/contact.css";

function Contact() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    message: "",
  });

  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const update = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    setLoading(true);
    setError("");

    try {
      await emailjs.send(
        "service_d56cryw",
        "template_6zwpl6a",
        {
          name: form.name,
          email: form.email,
          message: form.message,
        },
        {
          publicKey: "o1rhkAGqd8Lb7jTk5",
        },
      );

      // Only show this after EmailJS successfully sends the email
      setLoading(false);
      setSent(true);
    } catch (err) {
      console.error("Email sending failed:", err);

      setLoading(false);
      setError("We couldn't send your message. Please try again.");
    }
  };

  return (
    <div className="contact-page">
      <header className="page-hero">
        <p className="eyebrow">Contact</p>

        <h1>We're here to help</h1>

        <p className="page-hero-sub">
          Questions about membership, savings, or loans? Reach out — we
          typically respond within 24–48 hours.
        </p>
      </header>

      <section className="contact-grid">
        <div className="contact-info">
          <h2>Get in Touch</h2>

          <div className="info-item">
            <span className="info-label">
              <MailIcon size={15} /> Email
            </span>

            <a href="mailto:exclusivecooperative@gmail.com">
              exclusivecooperative@gmail.com
            </a>
          </div>

          <div className="info-item">
            <span className="info-label">
              <MapPinIcon size={15} /> Location
            </span>

            <span>Oshodi/Isolo, Lagos</span>
          </div>

          <div className="info-item">
            <span className="info-label">Social</span>

            <div className="social-icons dark">
              <a
                href="https://www.instagram.com/exclusive_123ng_"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                title="Instagram"
              >
                <InstagramIcon size={17} />
              </a>

              <a
                href="https://www.tiktok.com/@exclusive_123ng_"
                target="_blank"
                rel="noreferrer"
                aria-label="TikTok"
                title="TikTok"
              >
                <TiktokIcon size={17} />
              </a>

              <a
                href="https://www.facebook.com/profile.php?id=61592838402415"
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                title="Facebook"
              >
                <FacebookIcon size={17} />
              </a>

              <a
                href="https://x.com/ExclusiveCeaan"
                target="_blank"
                rel="noreferrer"
                aria-label="X (Twitter)"
                title="X (Twitter)"
              >
                <XIcon size={17} />
              </a>
            </div>
          </div>
        </div>

        <div className="contact-form-card">
          {sent ? (
            <div className="sent-confirmation">
              <span className="success-mark">✓</span>

              <h3>Message sent</h3>

              <p>
                Thanks, {form.name.split(" ")[0] || "there"} — we'll get back to
                you soon.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="name">Full Name *</label>

                <input
                  id="name"
                  type="text"
                  required
                  value={form.name}
                  onChange={update("name")}
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email Address *</label>

                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={update("email")}
                />
              </div>

              <div className="form-group">
                <label htmlFor="message">Message *</label>

                <textarea
                  id="message"
                  rows={5}
                  required
                  value={form.message}
                  onChange={update("message")}
                />
              </div>

              {error && <p className="form-error">{error}</p>}

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Sending..." : "Send Message"}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

export default Contact;
