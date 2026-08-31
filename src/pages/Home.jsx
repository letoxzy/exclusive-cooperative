import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FaPlay } from "react-icons/fa";
import request from "../utils/api";
import "../styles/home.css";
import "../styles/gallery.css";

function Home() {
  const [galleryItems, setGalleryItems] = useState([]);

  useEffect(() => {
    const loadGallery = async () => {
      try {
        const data = await request("/gallery");
        setGalleryItems(data.slice(0, 6));
      } catch (err) {
        console.error("Gallery loading error:", err);
      }
    };

    loadGallery();
  }, []);

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">Oshodi/Isolo Cooperative</p>
          <h1>Save together. Grow together.</h1>
          <p className="hero-sub">
            A member-owned cooperative built on discipline, trust, and shared
            benefit. Save consistently, access loans when you need them, and
            grow within a community that grows with you.
          </p>
          <div className="hero-actions">
            <Link to="/membership" className="btn-primary">
              Become a Member
            </Link>
            <Link to="/about" className="btn-secondary">
              Learn More
            </Link>
          </div>
        </div>
      </section>

      <section className="highlight-strip">
        <div className="highlight-item">
          <span className="highlight-number">200</span>
          <span className="highlight-label">
            Founding member intake — fee-exempt
          </span>
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

      <section className="services">
        <h2>What we offer</h2>
        <div className="service-grid">
          <div className="service-card">
            <h3>Savings</h3>
            <p>
              Build consistent savings habits with daily, weekly, or monthly
              contributions, plus optional voluntary savings on top of your
              minimum.
            </p>
            <Link to="/savings">Explore Savings →</Link>
          </div>
          <div className="service-card">
            <h3>Loans</h3>
            <p>
              Active members can access loan facilities to meet personal,
              business, and emergency needs at fair, member-first terms.
            </p>
            <Link to="/loans">Explore Loans →</Link>
          </div>
          <div className="service-card">
            <h3>Membership</h3>
            <p>
              Join a community-governed society where every member has a voice
              and a stake in the cooperative's growth.
            </p>
            <Link to="/membership">Apply Now →</Link>
          </div>
        </div>
      </section>

      {galleryItems.length > 0 && (
        <section className="home-gallery">
          <div className="home-gallery-heading">
            <div>
              <p className="eyebrow">Gallery</p>
              <h2>Moments from Exclusive Cooperative</h2>
            </div>
            <Link to="/gallery" className="gallery-view-all">View Gallery →</Link>
          </div>

          <div className="home-gallery-grid">
            {galleryItems.map((item) => (
              <Link to="/gallery" className="home-gallery-card" key={item._id}>
                <div className="home-gallery-media">
                  {item.mediaType === "video" ? (
                    <>
                      <video src={item.mediaUrl} muted playsInline preload="metadata" />
                      <span className="home-gallery-play"><FaPlay /></span>
                    </>
                  ) : (
                    <img src={item.mediaUrl} alt={item.title} loading="lazy" />
                  )}
                </div>
                <div>
                  <span>{item.category}</span>
                  <h3>{item.title}</h3>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="cta-banner">
        <h2>Ready to start saving with a community that has your back?</h2>
        <Link to="/membership" className="btn-primary">
          Start Your Application
        </Link>
      </section>
    </div>
  );
}

export default Home;
