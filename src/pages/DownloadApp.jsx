import { Link } from "react-router-dom";
import { FaAndroid, FaShieldAlt, FaDownload, FaCircleCheck } from "react-icons/fa";
import "../styles/download-app.css";

// Publish the signed APK as a GitHub Release asset named
// "exclusive-cooperative.apk", then enable this URL for public downloads.
const APK_DOWNLOAD_URL =
  "https://github.com/letoxzy/exclusive-cooperative/releases/latest/download/exclusive-cooperative.apk";

function DownloadApp() {
  const downloadReady = false; // Set to true only after uploading and testing the release APK.

  return (
    <main className="download-page">
      <section className="download-hero">
        <div className="download-kicker">
          <span className="download-kicker-dot" />
          EXCLUSIVE COOPERATIVE MOBILE
        </div>

        <div className="download-hero-grid">
          <div className="download-copy">
            <h1>Cooperative access, right in your pocket.</h1>
            <p className="download-lead">
              Access your Exclusive Cooperative account on your Android phone,
              with membership, savings, loans, and account tools in one place.
            </p>

            {downloadReady ? (
              <a className="download-primary-button" href={APK_DOWNLOAD_URL}>
                <FaDownload aria-hidden="true" />
                Download for Android
              </a>
            ) : (
              <button className="download-primary-button" type="button" disabled>
                <FaDownload aria-hidden="true" />
                Android app coming soon
              </button>
            )}

            <p className="download-version-note">
              Android app · Official cooperative release
            </p>
          </div>

          <div className="download-phone-card" aria-label="App features">
            <div className="download-phone-top">
              <div className="download-app-mark">E</div>
              <div>
                <span className="download-phone-eyebrow">EXCLUSIVE</span>
                <strong>Cooperative</strong>
              </div>
            </div>
            <div className="download-feature-row">
              <span className="download-feature-icon"><FaCircleCheck /></span>
              <div><strong>Membership</strong><span>Keep your account close</span></div>
            </div>
            <div className="download-feature-row">
              <span className="download-feature-icon"><FaCircleCheck /></span>
              <div><strong>Savings & contributions</strong><span>Review your cooperative activity</span></div>
            </div>
            <div className="download-feature-row">
              <span className="download-feature-icon"><FaCircleCheck /></span>
              <div><strong>Loans & verification</strong><span>Follow your application securely</span></div>
            </div>
            <div className="download-phone-footer">
              <FaAndroid aria-hidden="true" />
              <span>Designed for Android</span>
            </div>
          </div>
        </div>
      </section>

      <section className="download-instructions">
        <div className="download-section-heading">
          <span>GET STARTED</span>
          <h2>How to install the app</h2>
          <p>When the official release is available, follow these steps on your Android phone.</p>
        </div>
        <div className="download-steps">
          <article className="download-step">
            <span className="download-step-number">01</span>
            <h3>Download the APK</h3>
            <p>Open this page on your Android phone and tap the official download button.</p>
          </article>
          <article className="download-step">
            <span className="download-step-number">02</span>
            <h3>Allow installation</h3>
            <p>Android may ask you to allow your browser to install apps. Only proceed with the APK linked from this official website.</p>
          </article>
          <article className="download-step">
            <span className="download-step-number">03</span>
            <h3>Open and sign in</h3>
            <p>After installation, open Exclusive Cooperative and sign in with your account.</p>
          </article>
        </div>
      </section>

      <section className="download-safety">
        <div className="download-safety-icon"><FaShieldAlt aria-hidden="true" /></div>
        <div>
          <h2>Download safely</h2>
          <p>
            Install only releases linked from this website. Never share your
            password, PIN, or verification codes with anyone. For help, contact
            the cooperative using the details on our <Link to="/contact">Contact page</Link>.
          </p>
        </div>
      </section>
    </main>
  );
}

export default DownloadApp;
