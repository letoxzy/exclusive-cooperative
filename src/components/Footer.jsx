import { Link } from "react-router-dom";
import { InstagramIcon, TiktokIcon, FacebookIcon, XIcon } from "./Icons";
import "../styles/footer.css";

function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-brand">
          <span className="footer-logo">EXCLUSIVE</span>
          <p>
            Exclusive (Oshodi/Isolo) Cooperative Multipurpose Society Limited —
            building financial discipline and shared prosperity, together.
          </p>
        </div>

        <div className="footer-col">
          <h4>Quick Links</h4>
          <Link to="/about">About</Link>
          <Link to="/membership">Membership</Link>
          <Link to="/savings">Savings</Link>
          <Link to="/loans">Loans</Link>
          <Link to="/contact">Contact</Link>
        </div>

        <div className="footer-col">
          <h4>Get in Touch</h4>
          <a href="mailto:exclusivecooperative@gmail.com">
            exclusivecooperative@gmail.com
          </a>
          <span>Oshodi/Isolo, Lagos</span>
        </div>

        <div className="footer-col">
          <h4>Follow Us</h4>
          <div className="social-icons">
            <a
              href="https://www.instagram.com/exclusive_123ng_"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              title="Instagram"
            >
              <InstagramIcon size={18} />
            </a>
            <a
              href="https://www.tiktok.com/@exclusive_123ng_"
              target="_blank"
              rel="noreferrer"
              aria-label="TikTok"
              title="TikTok"
            >
              <TiktokIcon size={18} />
            </a>
            <a
              href="https://www.facebook.com/profile.php?id=61592838402415"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook"
              title="Facebook"
            >
              <FacebookIcon size={18} />
            </a>
            <a
              href="https://x.com/ExclusiveCeaan"
              target="_blank"
              rel="noreferrer"
              aria-label="X (Twitter)"
              title="X (Twitter)"
            >
              <XIcon size={18} />
            </a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>
          © {year} Exclusive Cooperative Multipurpose Society Limited. All
          rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default Footer;
