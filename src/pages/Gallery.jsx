import { useEffect, useMemo, useState } from "react";
import { FaPlay, FaTimes } from "react-icons/fa";
import request from "../utils/api";
import "../styles/gallery.css";

function Gallery() {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadGallery = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await request("/gallery");
        setItems(data);
      } catch (err) {
        setError(err.message || "Unable to load the gallery.");
      } finally {
        setLoading(false);
      }
    };

    loadGallery();
  }, []);

  const categories = useMemo(
    () => ["All", ...new Set(items.map((item) => item.category).filter(Boolean))],
    [items]
  );

  const filteredItems = useMemo(
    () =>
      category === "All"
        ? items
        : items.filter((item) => item.category === category),
    [items, category]
  );

  return (
    <main className="gallery-page">
      <section className="gallery-hero">
        <p className="eyebrow">Our Gallery</p>
        <h1>Moments from Exclusive Cooperative</h1>
        <p>
          Explore photographs and videos from our meetings, training sessions,
          events, and community activities.
        </p>
      </section>

      <section className="gallery-content">
        {categories.length > 1 && (
          <div className="gallery-filters" aria-label="Gallery categories">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={category === item ? "active" : ""}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        )}

        {loading && <p className="gallery-state">Loading gallery...</p>}
        {!loading && error && <p className="gallery-state gallery-error">{error}</p>}
        {!loading && !error && filteredItems.length === 0 && (
          <p className="gallery-state">No gallery items have been published yet.</p>
        )}

        {!loading && !error && filteredItems.length > 0 && (
          <div className="gallery-grid">
            {filteredItems.map((item) => (
              <button
                key={item._id}
                type="button"
                className="gallery-card"
                onClick={() => setSelected(item)}
              >
                <div className="gallery-media-wrap">
                  {item.mediaType === "video" ? (
                    <>
                      <video src={item.mediaUrl} muted playsInline preload="metadata" />
                      <span className="gallery-play"><FaPlay /></span>
                    </>
                  ) : (
                    <img src={item.mediaUrl} alt={item.title} loading="lazy" />
                  )}
                </div>
                <div className="gallery-card-info">
                  <span>{item.category}</span>
                  <h2>{item.title}</h2>
                  {item.description && <p>{item.description}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <div className="gallery-lightbox" role="dialog" aria-modal="true">
          <button
            type="button"
            className="gallery-lightbox-close"
            onClick={() => setSelected(null)}
            aria-label="Close gallery preview"
          >
            <FaTimes />
          </button>

          <div className="gallery-lightbox-content" onClick={(event) => event.stopPropagation()}>
            {selected.mediaType === "video" ? (
              <video src={selected.mediaUrl} controls autoPlay playsInline />
            ) : (
              <img src={selected.mediaUrl} alt={selected.title} />
            )}
            <div className="gallery-lightbox-caption">
              <span>{selected.category}</span>
              <h2>{selected.title}</h2>
              {selected.description && <p>{selected.description}</p>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default Gallery;
