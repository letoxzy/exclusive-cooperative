import { useCallback, useEffect, useState } from "react";
import { FaPlay, FaTrash, FaEdit, FaEye, FaEyeSlash } from "react-icons/fa";
import request from "../../utils/api";
import "../../styles/gallery-management.css";

const DEFAULT_FORM = {
  title: "",
  description: "",
  category: "Events",
  isPublished: true,
};

function GalleryManagement({ token }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [file, setFile] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      const data = await request("/gallery/admin/all", { token });
      setItems(data);
    } catch (err) {
      setError(err.message || "Unable to load gallery.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setFile(null);
    setEditing(null);
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!form.title.trim()) {
      setError("Please enter a title.");
      return;
    }

    try {
      setSaving(true);

      if (editing) {
        const updated = await request(`/gallery/admin/${editing._id}`, {
          method: "PATCH",
          token,
          body: form,
        });
        setItems((current) =>
          current.map((item) => (item._id === updated._id ? updated : item))
        );
        setMessage("Gallery item updated successfully.");
      } else {
        if (!file) {
          setError("Please choose an image or video.");
          return;
        }

        const data = new FormData();
        data.append("title", form.title.trim());
        data.append("description", form.description.trim());
        data.append("category", form.category.trim() || "Events");
        data.append("isPublished", String(form.isPublished));
        data.append("media", file);

        const created = await request("/gallery/admin", {
          method: "POST",
          token,
          body: data,
          isFormData: true,
        });
        setItems((current) => [created, ...current]);
        setMessage("Gallery item uploaded successfully.");
      }

      resetForm();
    } catch (err) {
      setError(err.message || "Unable to save gallery item.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item) => {
    setEditing(item);
    setForm({
      title: item.title || "",
      description: item.description || "",
      category: item.category || "Events",
      isPublished: Boolean(item.isPublished),
    });
    setFile(null);
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const togglePublished = async (item) => {
    try {
      setError("");
      const updated = await request(`/gallery/admin/${item._id}`, {
        method: "PATCH",
        token,
        body: { isPublished: !item.isPublished },
      });
      setItems((current) =>
        current.map((entry) => (entry._id === updated._id ? updated : entry))
      );
    } catch (err) {
      setError(err.message || "Unable to change publish status.");
    }
  };

  const deleteItem = async (item) => {
    const confirmed = window.confirm(
      `Delete “${item.title}”? This will also remove the media from Cloudinary.`
    );
    if (!confirmed) return;

    try {
      setError("");
      await request(`/gallery/admin/${item._id}`, {
        method: "DELETE",
        token,
      });
      setItems((current) => current.filter((entry) => entry._id !== item._id));
      if (editing?._id === item._id) resetForm();
      setMessage("Gallery item deleted successfully.");
    } catch (err) {
      setError(err.message || "Unable to delete gallery item.");
    }
  };

  return (
    <div className="gallery-management">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">Media</p>
          <h1>Gallery</h1>
          <p className="admin-subtitle">
            Upload and manage photos and videos displayed on the cooperative website.
          </p>
        </div>
      </div>

      {error && <div className="form-error gallery-admin-message">{error}</div>}
      {message && <div className="gallery-success">{message}</div>}

      <section className="admin-card gallery-upload-card">
        <div className="gallery-admin-section-title">
          <div>
            <h2>{editing ? "Edit Gallery Item" : "Upload Media"}</h2>
            <p>
              {editing
                ? "Update the title, description, category, or visibility."
                : "Images and videos are securely uploaded to Cloudinary."}
            </p>
          </div>
          {editing && (
            <button type="button" className="admin-secondary-btn" onClick={resetForm}>
              Cancel Edit
            </button>
          )}
        </div>

        <form className="gallery-admin-form" onSubmit={handleSubmit}>
          <div className="gallery-form-grid">
            <label>
              Title *
              <input name="title" value={form.title} onChange={handleChange} required />
            </label>

            <label>
              Category
              <input name="category" value={form.category} onChange={handleChange} />
            </label>

            <label className="gallery-full-field">
              Description
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows="3"
                maxLength="500"
              />
            </label>

            {!editing && (
              <label className="gallery-full-field">
                Media file *
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  required
                />
                <small>Images or videos up to 100 MB.</small>
              </label>
            )}

            <label className="gallery-publish-check">
              <input
                type="checkbox"
                name="isPublished"
                checked={form.isPublished}
                onChange={handleChange}
              />
              <span>Published on website</span>
            </label>
          </div>

          <button type="submit" className="admin-primary-btn" disabled={saving}>
            {saving ? "Saving..." : editing ? "Save Changes" : "Upload Media"}
          </button>
        </form>
      </section>

      <section className="admin-card">
        <div className="gallery-admin-section-title">
          <div>
            <h2>Gallery Items</h2>
            <p>{items.length} total media item{items.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        {loading ? (
          <p className="gallery-empty">Loading gallery...</p>
        ) : items.length === 0 ? (
          <p className="gallery-empty">No gallery items yet.</p>
        ) : (
          <div className="gallery-admin-grid">
            {items.map((item) => (
              <article key={item._id} className="gallery-admin-card">
                <div className="gallery-admin-media">
                  {item.mediaType === "video" ? (
                    <>
                      <video src={item.mediaUrl} muted playsInline preload="metadata" />
                      <span className="gallery-admin-play"><FaPlay /></span>
                    </>
                  ) : (
                    <img src={item.mediaUrl} alt={item.title} />
                  )}
                  <span className={`gallery-published-badge ${item.isPublished ? "published" : "hidden"}`}>
                    {item.isPublished ? "Published" : "Hidden"}
                  </span>
                </div>

                <div className="gallery-admin-card-body">
                  <span className="gallery-admin-type">
                    {item.mediaType === "video" ? "Video" : "Photo"} · {item.category}
                  </span>
                  <h3>{item.title}</h3>
                  {item.description && <p>{item.description}</p>}

                  <div className="gallery-admin-actions">
                    <button type="button" onClick={() => startEdit(item)} title="Edit">
                      <FaEdit /> Edit
                    </button>
                    <button type="button" onClick={() => togglePublished(item)} title="Publish or hide">
                      {item.isPublished ? <FaEyeSlash /> : <FaEye />}
                      {item.isPublished ? "Hide" : "Publish"}
                    </button>
                    <button type="button" className="danger" onClick={() => deleteItem(item)} title="Delete">
                      <FaTrash /> Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default GalleryManagement;
