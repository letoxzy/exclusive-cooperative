import { useEffect, useState } from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import request from "../../utils/api";
import "./GallerySlider.css";

function GallerySlider() {
  const [images, setImages] = useState([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadGallery = async () => {
      try {
        const data = await request("/gallery");

        // Only use published images on the homepage
        const publishedImages = data.filter(
          (item) => item.isPublished && item.mediaType === "image",
        );

        setImages(publishedImages);
      } catch (error) {
        console.error("Failed to load gallery:", error);
      } finally {
        setLoading(false);
      }
    };

    loadGallery();
  }, []);

  useEffect(() => {
    if (images.length <= 1) return;

    const timer = setInterval(() => {
      setCurrent((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    }, 5000);

    return () => clearInterval(timer);
  }, [images.length]);

  const nextSlide = () => {
    setCurrent((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  const previousSlide = () => {
    setCurrent((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  if (loading) {
    return (
      <section className="gallery-slider-section">
        <div className="gallery-slider-loading">Loading gallery...</div>
      </section>
    );
  }

  if (!images.length) {
    return null;
  }

  return (
    <section className="gallery-slider-section">
      <div className="gallery-slider-container">
        <div className="gallery-slider">
          {images.map((image, index) => (
            <div
              key={image._id}
              className={`gallery-slide ${index === current ? "active" : ""}`}
            >
              <img
                src={image.mediaUrl}
                alt={image.title || "Cooperative gallery"}
              />

              <div className="gallery-slide-overlay">
                <div className="gallery-slide-content">
                  {image.category && (
                    <span className="gallery-slide-category">
                      {image.category}
                    </span>
                  )}

                  <h2>{image.title}</h2>

                  {image.description && <p>{image.description}</p>}
                </div>
              </div>
            </div>
          ))}

          {images.length > 1 && (
            <>
              <button
                type="button"
                className="gallery-slider-arrow gallery-slider-prev"
                onClick={previousSlide}
                aria-label="Previous image"
              >
                <FaChevronLeft />
              </button>

              <button
                type="button"
                className="gallery-slider-arrow gallery-slider-next"
                onClick={nextSlide}
                aria-label="Next image"
              >
                <FaChevronRight />
              </button>

              <div className="gallery-slider-dots">
                {images.map((image, index) => (
                  <button
                    key={image._id}
                    type="button"
                    className={index === current ? "active" : ""}
                    onClick={() => setCurrent(index)}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default GallerySlider;
