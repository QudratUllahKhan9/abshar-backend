
import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE_URL =
  "https://absher-deshboard-backend.vercel.app/api/items";

const THEME_KEY = "peoplehub_theme";

const IMAGE_FIELDS = [
  { key: "userImage", label: "Profile Photo", icon: "👤" },
  { key: "cardImage", label: "ID Card", icon: "🪪" },
  { key: "iqamaImage", label: "Iqama", icon: "📄" },
  { key: "qrCode1", label: "QR Code 1", icon: "▦" },
  {
    key: "drivingLicenseImage",
    label: "Driving Licence",
    icon: "🚘",
  },
  { key: "qrCode2", label: "QR Code 2", icon: "▦" },
];

const EMPTY_FORM = {
  name: "",
  idNo: "",
  phone: "",
  password: "",

  // Passport Information
  passportNo: "PT4133313",
  passportType: "Regular",
  passportIssueDate: "20/02/2025",
  passportExpiryDate: "21/02/2030",
  passportPlaceOfIssue: "Pakistan",
  passportStatus: "Valid",

  // Resident ID (Iqama) Details
  idVersion: "2",
  iqamaIssueDate: "21/09/2025",
  iqamaExpiryDate: "22/07/2027",

  // Travel Record & Status
  travelStatus: "Inside the Kingdom",
  lastTravelDestination: "Pakistan",
  lastTravelDate: "12/08/2025",
  balance: "0.00 SAR",
};

function normalizeItem(item = {}) {
  return {
    ...item,
    id: String(item._id || item.id || ""),

    userImageUrl:
      item.userImageUrl || item.images?.userImage || "",
    cardImageUrl:
      item.cardImageUrl || item.images?.cardImage || "",
    iqamaImageUrl:
      item.iqamaImageUrl || item.images?.iqamaImage || "",
    qrCode1Url:
      item.qrCode1Url || item.images?.qrCode1 || "",
    drivingLicenseImageUrl:
      item.drivingLicenseImageUrl ||
      item.images?.drivingLicenseImage ||
      "",
    qrCode2Url:
      item.qrCode2Url || item.images?.qrCode2 || "",

    images: {
      userImage:
        item.userImageUrl || item.images?.userImage || "",
      cardImage:
        item.cardImageUrl || item.images?.cardImage || "",
      iqamaImage:
        item.iqamaImageUrl || item.images?.iqamaImage || "",
      qrCode1:
        item.qrCode1Url || item.images?.qrCode1 || "",
      drivingLicenseImage:
        item.drivingLicenseImageUrl ||
        item.images?.drivingLicenseImage ||
        "",
      qrCode2:
        item.qrCode2Url || item.images?.qrCode2 || "",
    },
  };
}

function extractItems(data) {
  const candidates = [
    data?.items,
    data?.data?.items,
    data?.data,
    data?.results,
  ];

  return candidates.find(Array.isArray) || [];
}

function extractItem(data) {
  return (
    data?.item ||
    data?.data?.item ||
    data?.data?.record ||
    data?.record ||
    data?.data ||
    data
  );
}

async function readApiError(response) {
  let data = {};

  try {
    data = await response.json();
  } catch {
    // Response may not contain JSON.
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.message ||
        data.error?.message ||
        `Request failed (${response.status})`
    );
  }

  return data;
}

export default function App() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [images, setImages] = useState({});
  const [imageFiles, setImageFiles] = useState({});
  const [removedImages, setRemovedImages] = useState({});
  const [originalImages, setOriginalImages] = useState({});

  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");

  const [theme, setTheme] = useState(
    () => localStorage.getItem(THEME_KEY) || "light"
  );

  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);

  // Load records from backend.
  useEffect(() => {
    let active = true;

    async function loadItems() {
      try {
        const response = await fetch(API_BASE_URL);
        const data = await readApiError(response);

        if (active) {
          setItems(extractItems(data).map(normalizeItem));
        }
      } catch (error) {
        if (active) {
          notify(`Could not load records: ${error.message}`);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadItems();

    return () => {
      active = false;
    };
  }, []);

  // Theme preference.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setImages({});
    setImageFiles({});
    setRemovedImages({});
    setOriginalImages({});
    setEditingId(null);

    const formElement = document.getElementById("record-form");
    formElement?.reset();
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function handleImage(event, key) {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      notify("Please select an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > 1.5 * 1024 * 1024) {
      notify("Please choose an image smaller than 1.5 MB.");
      event.target.value = "";
      return;
    }

    setImageFiles((previous) => ({
      ...previous,
      [key]: file,
    }));

    setRemovedImages((previous) => ({
      ...previous,
      [key]: false,
    }));

    const reader = new FileReader();

    reader.onload = () => {
      setImages((previous) => ({
        ...previous,
        [key]: reader.result,
      }));
    };

    reader.onerror = () => {
      notify("Could not preview this image.");
    };

    reader.readAsDataURL(file);
  }

  function removeImage(key) {
    setImages((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });

    setImageFiles((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });

    if (editingId && originalImages[key]) {
      setRemovedImages((previous) => ({
        ...previous,
        [key]: true,
      }));
    }

    const input = document.getElementById(`image-${key}`);

    if (input) {
      input.value = "";
    }
  }

  // Create a new record or update an existing record.
  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.name.trim() || !form.idNo.trim()) {
      notify("Please complete all required fields.");
      return;
    }

    const totalImageBytes = Object.values(imageFiles).reduce(
      (total, file) => total + (file?.size || 0),
      0
    );

    if (totalImageBytes > 3.5 * 1024 * 1024) {
      notify(
        "Selected images total more than 3.5 MB. Upload fewer or smaller images."
      );
      return;
    }

    setSaving(true);

    try {
      const payload = new FormData();

      Object.entries(form).forEach(([key, value]) => {
        // Don't overwrite an existing password with a blank value.
        if (
          key === "password" &&
          editingId &&
          !String(value || "").trim()
        ) {
          return;
        }

        payload.append(key, String(value ?? ""));
      });

      Object.entries(imageFiles).forEach(([key, file]) => {
        if (file) {
          payload.append(key, file);
        }
      });

      Object.entries(removedImages).forEach(([key, removed]) => {
        if (removed) {
          payload.append(`remove_${key}`, "true");
        }
      });

      const response = await fetch(
        editingId
          ? `${API_BASE_URL}/${encodeURIComponent(editingId)}`
          : API_BASE_URL,
        {
          method: editingId ? "PUT" : "POST",
          body: payload,
        }
      );

      const data = await readApiError(response);
      const savedItem = normalizeItem(extractItem(data));

      if (!savedItem.id) {
        throw new Error(
          "The API response did not include the saved record ID. Check the backend response format."
        );
      }

      if (editingId) {
        setItems((previous) =>
          previous.map((item) =>
            item.id === editingId ? savedItem : item
          )
        );

        notify("Record updated successfully in database.");
      } else {
        setItems((previous) => [savedItem, ...previous]);

        notify("Record saved successfully to database.");
      }

      resetForm();
    } catch (error) {
      notify(`Save failed: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Fill the form when editing.
  function startEdit(item) {
    setEditingId(item.id);
    setOriginalImages(item.images || {});
    setRemovedImages({});
    setImageFiles({});

    setForm({
      name: item.name || "",
      idNo: item.idNo || "",
      phone: item.phone || "",
      // Password is intentionally not returned by a secure backend.
      password: "",
      passportNo: item.passportNo || "",
      passportType: item.passportType || "",
      passportIssueDate: item.passportIssueDate || "",
      passportExpiryDate: item.passportExpiryDate || "",
      passportPlaceOfIssue: item.passportPlaceOfIssue || "",
      passportStatus: item.passportStatus || "",
      idVersion: item.idVersion || "",
      iqamaIssueDate: item.iqamaIssueDate || "",
      iqamaExpiryDate: item.iqamaExpiryDate || "",
      travelStatus: item.travelStatus || "",
      lastTravelDestination: item.lastTravelDestination || "",
      lastTravelDate: item.lastTravelDate || "",
      balance: item.balance || "",
    });

    setImages(item.images || {});

    document.getElementById("form-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  // Delete a record from the backend.
  async function deleteRecord(item) {
    const confirmed = window.confirm(
      `Delete the record for "${item.name}" from the database?`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/${encodeURIComponent(item.id)}`,
        { method: "DELETE" }
      );

      await readApiError(response);

      setItems((previous) =>
        previous.filter((record) => record.id !== item.id)
      );

      if (editingId === item.id) {
        resetForm();
      }

      notify("Record deleted from database.");
    } catch (error) {
      notify(`Delete failed: ${error.message}`);
    }
  }

  // Search records.
  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term) return items;

    return items.filter((item) =>
      [
        item.name,
        item.idNo,
        item.phone,
        item.passportNo,
      ].some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    );
  }, [items, query]);

  const recordsWithImages = items.filter((item) =>
    IMAGE_FIELDS.some((field) => item.images?.[field.key])
  ).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top">
          <div className="brand-mark">PH</div>

          <div className="brand-copy">
            <strong>PeopleHub</strong>
            <span>People directory</span>
          </div>
        </a>

        <div className="top-actions">
          <label className="search-box">
            <span className="search-icon">⌕</span>

            <input
              type="search"
              aria-label="Search records"
              placeholder="Search name, ID or passport..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <button
            className="icon-btn"
            type="button"
            onClick={() =>
              setTheme((current) =>
                current === "light" ? "dark" : "light"
              )
            }
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
        </div>
      </header>

      <main className="container" id="top">
        <section className="hero">
          <div className="hero-copy">
            <span className="hero-tag">
              <i />
              YOUR PERSONAL DIRECTORY
            </span>

            <h1>
              Every record.
              <br />
              <em>One simple place.</em>
            </h1>

            <p>
              Manage personal info, Passport, Resident ID (Iqama),
              and Travel status.
            </p>

            <a className="hero-link" href="#records">
              Explore records <span>↓</span>
            </a>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />

            <div className="art-card art-card-back">
              <span className="art-document">▦</span>
              <span>DOCUMENTS</span>
            </div>

            <div className="art-card art-card-front">
              <div className="art-avatar">✦</div>

              <div className="art-lines">
                <b />
                <b />
                <b />
              </div>

              <span className="art-status">● YOUR DIRECTORY</span>
            </div>

            <div className="art-dot dot-one" />
            <div className="art-dot dot-two" />
          </div>

          <div className="hero-bottom">
            <span>PEOPLEHUB WORKSPACE</span>
            <span>FRONTEND ONLY · NO LOGIN</span>
          </div>
        </section>

        {/* Statistics */}
        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-icon purple">▤</span>

            <div>
              <p>Total records</p>
              <strong>{items.length}</strong>
            </div>

            <small>All saved records</small>
          </article>

          <article className="stat-card">
            <span className="stat-icon mint">▧</span>

            <div>
              <p>With images</p>
              <strong>{recordsWithImages}</strong>
            </div>

            <small>Records with photos</small>
          </article>

          <article className="stat-card">
            <span className="stat-icon amber">⌕</span>

            <div>
              <p>Search results</p>
              <strong>{filteredItems.length}</strong>
            </div>

            <small>Matching records</small>
          </article>
        </section>

        {/* Record form */}
        <section className="form-card" id="form-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {editingId ? "UPDATE RECORD" : "ADD TO DIRECTORY"}
              </span>

              <h2>
                {editingId
                  ? "Edit person record"
                  : "Create a new record"}
              </h2>

              <p>
                Enter all fields extracted from Absher details below.
              </p>
            </div>

            {editingId && (
              <button
                className="secondary-btn"
                type="button"
                onClick={resetForm}
              >
                Cancel edit ×
              </button>
            )}
          </div>

          <form id="record-form" onSubmit={handleSubmit}>
            {/* Section 1 */}
            <div
              className="upload-heading"
              style={{
                marginTop: 0,
                borderTop: 0,
                paddingTop: 0,
              }}
            >
              <div>
                <span className="eyebrow">SECTION 1</span>
                <h3>Personal &amp; Contact Details</h3>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>
                  Full Name <b>*</b>
                </span>

                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Enter full name"
                  maxLength={120}
                  required
                />
              </label>

              <label className="field">
                <span>Phone Number</span>

                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="Enter phone number"
                  maxLength={30}
                />
              </label>

              <label className="field">
                <span>Password</span>

                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder={
                    editingId
                      ? "Leave blank to keep existing password"
                      : "Enter password"
                  }
                  maxLength={50}
                  autoComplete="new-password"
                />
              </label>
            </div>

            {/* Section 2 */}
            <div className="upload-heading">
              <div>
                <span className="eyebrow">SECTION 2</span>
                <h3>Passport Information</h3>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Passport Number</span>

                <input
                  name="passportNo"
                  value={form.passportNo}
                  onChange={handleChange}
                  placeholder="Passport Number"
                  maxLength={30}
                />
              </label>

              <label className="field">
                <span>Passport Type</span>

                <input
                  name="passportType"
                  value={form.passportType}
                  onChange={handleChange}
                  placeholder="Regular"
                  maxLength={30}
                />
              </label>

              <label className="field">
                <span>Passport Issue Date</span>

                <input
                  name="passportIssueDate"
                  value={form.passportIssueDate}
                  onChange={handleChange}
                  placeholder="DD/MM/YYYY"
                  maxLength={20}
                />
              </label>

              <label className="field">
                <span>Passport Expiry Date</span>

                <input
                  name="passportExpiryDate"
                  value={form.passportExpiryDate}
                  onChange={handleChange}
                  placeholder="DD/MM/YYYY"
                  maxLength={20}
                />
              </label>

              <label className="field">
                <span>Place of Issue</span>

                <input
                  name="passportPlaceOfIssue"
                  value={form.passportPlaceOfIssue}
                  onChange={handleChange}
                  placeholder="Pakistan"
                  maxLength={50}
                />
              </label>

              <label className="field">
                <span>Passport Status</span>

                <input
                  name="passportStatus"
                  value={form.passportStatus}
                  onChange={handleChange}
                  placeholder="Valid"
                  maxLength={30}
                />
              </label>
            </div>

            {/* Section 3 */}
            <div className="upload-heading">
              <div>
                <span className="eyebrow">SECTION 3</span>
                <h3>Resident ID (Iqama) Details</h3>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>
                  Iqama Number <b>*</b>
                </span>

                <input
                  name="idNo"
                  value={form.idNo}
                  onChange={handleChange}
                  placeholder="Iqama Number"
                  maxLength={80}
                  required
                />
              </label>

              <label className="field">
                <span>ID Version</span>

                <input
                  name="idVersion"
                  value={form.idVersion}
                  onChange={handleChange}
                  placeholder="2"
                  maxLength={10}
                />
              </label>

              <label className="field">
                <span>Iqama Issue Date</span>

                <input
                  name="iqamaIssueDate"
                  value={form.iqamaIssueDate}
                  onChange={handleChange}
                  placeholder="DD/MM/YYYY"
                  maxLength={20}
                />
              </label>

              <label className="field">
                <span>Iqama Expiry Date</span>

                <input
                  name="iqamaExpiryDate"
                  value={form.iqamaExpiryDate}
                  onChange={handleChange}
                  placeholder="DD/MM/YYYY"
                  maxLength={20}
                />
              </label>
            </div>

            {/* Section 4 */}
            <div className="upload-heading">
              <div>
                <span className="eyebrow">SECTION 4</span>
                <h3>Travel Record &amp; Status</h3>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Travel Status</span>

                <input
                  name="travelStatus"
                  value={form.travelStatus}
                  onChange={handleChange}
                  placeholder="Inside the Kingdom"
                  maxLength={50}
                />
              </label>

              <label className="field">
                <span>Last Travel Destination</span>

                <input
                  name="lastTravelDestination"
                  value={form.lastTravelDestination}
                  onChange={handleChange}
                  placeholder="Pakistan"
                  maxLength={50}
                />
              </label>

              <label className="field">
                <span>Last Travel Date</span>

                <input
                  name="lastTravelDate"
                  value={form.lastTravelDate}
                  onChange={handleChange}
                  placeholder="DD/MM/YYYY"
                  maxLength={20}
                />
              </label>

              <label className="field">
                <span>Operations Balance</span>

                <input
                  name="balance"
                  value={form.balance}
                  onChange={handleChange}
                  placeholder="0.00 SAR"
                  maxLength={30}
                />
              </label>
            </div>

            {/* Section 5: Images */}
            <div className="upload-heading">
              <div>
                <span className="eyebrow">SECTION 5</span>
                <h3>Photos &amp; Documents</h3>
              </div>

              <span className="file-limit">
                JPG, PNG, WEBP · Max 1.5 MB each · Saved to Cloudinary
              </span>
            </div>

            <div className="upload-grid">
              {IMAGE_FIELDS.map((field) => (
                <div className="upload-field" key={field.key}>
                  <div className="upload-label">
                    <span>{field.icon}</span>
                    <b>{field.label}</b>
                  </div>

                  {images[field.key] ? (
                    <div className="preview-card">
                      <img
                        src={images[field.key]}
                        alt={`${field.label} preview`}
                      />

                      <button
                        className="remove-image"
                        type="button"
                        onClick={() => removeImage(field.key)}
                        aria-label={`Remove ${field.label}`}
                      >
                        ×
                      </button>

                      <label
                        className="replace-link"
                        htmlFor={`image-${field.key}`}
                      >
                        Replace image
                      </label>

                      <input
                        className="hidden-file-input"
                        id={`image-${field.key}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          handleImage(event, field.key)
                        }
                      />
                    </div>
                  ) : (
                    <label className="upload-drop">
                      <input
                        id={`image-${field.key}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          handleImage(event, field.key)
                        }
                      />

                      <span className="upload-plus">＋</span>
                      <b>Upload {field.label.toLowerCase()}</b>
                      <small>Choose an image from your device</small>
                    </label>
                  )}
                </div>
              ))}
            </div>

            <div className="form-footer">
              <span className="required-note">
                <b>*</b> Required fields
              </span>

              <div className="footer-actions">
                {editingId && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={resetForm}
                  >
                    Discard changes
                  </button>
                )}

                <button
                  className="primary-btn"
                  type="submit"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingId
                    ? "Save changes →"
                    : "Save record →"}
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* Records list */}
        <section className="records-section" id="records">
          <div className="section-heading records-heading">
            <div>
              <span className="eyebrow">YOUR DIRECTORY</span>

              <h2>
                People records{" "}
                <span className="count-pill">
                  {filteredItems.length}
                </span>
              </h2>

              <p>View, edit or remove your saved records.</p>
            </div>

            <button
              className="secondary-btn"
              type="button"
              onClick={() => {
                resetForm();

                document
                  .getElementById("form-section")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              ＋ Add record
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <h3>Loading records…</h3>
              <p>Connecting to the Absher database.</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">
              <div>⌕</div>

              <h3>
                {query
                  ? "No matching records"
                  : "Your directory is ready"}
              </h3>

              <p>
                {query
                  ? "Try another name, ID number or passport number."
                  : "Add your first record using the form above."}
              </p>
            </div>
          ) : (
            <div className="records-grid">
              {filteredItems.map((item) => (
                <article className="person-card" key={item.id}>
                  <div className="person-card-head">
                    <div className="person-avatar">
                      {item.images?.userImage ? (
                        <img
                          src={item.images.userImage}
                          alt={item.name}
                        />
                      ) : (
                        <span>
                          {(item.name || "?")
                            .trim()
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="person-title">
                      <h3>{item.name}</h3>
                      <span className="record-id">
                        Iqama · {item.idNo || "—"}
                      </span>
                    </div>

                    <span className="local-chip">● Server</span>
                  </div>

                  <div className="person-meta">
                    <div>
                      <span>PHONE &amp; PASSWORD</span>

                      <b>
                        {item.phone || "—"} /{" "}
                        {item.password ? "••••" : "—"}
                      </b>
                    </div>

                    <div>
                      <span>PASSPORT NO.</span>
                      <b>{item.passportNo || "—"}</b>
                    </div>
                  </div>

                  <div
                    className="person-meta"
                    style={{ marginTop: "8px" }}
                  >
                    <div>
                      <span>IQAMA EXPIRY</span>
                      <b>{item.iqamaExpiryDate || "—"}</b>
                    </div>

                    <div>
                      <span>TRAVEL STATUS</span>
                      <b>{item.travelStatus || "—"}</b>
                    </div>
                  </div>

                  <div
                    className="document-strip"
                    style={{ marginTop: "15px" }}
                  >
                    {IMAGE_FIELDS.map((field) => (
                      <div
                        className={`document-thumb ${
                          item.images?.[field.key] ? "has-image" : ""
                        }`}
                        key={field.key}
                        title={field.label}
                      >
                        {item.images?.[field.key] ? (
                          <img
                            src={item.images[field.key]}
                            alt={field.label}
                          />
                        ) : (
                          <span>{field.icon}</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="person-actions">
                    <button
                      className="edit-action"
                      type="button"
                      onClick={() => startEdit(item)}
                    >
                      ✎ Edit record
                    </button>

                    <button
                      className="delete-action"
                      type="button"
                      onClick={() => deleteRecord(item)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="page-footer">
          <span>PEOPLEHUB · DATABASE EDITION</span>

          <span>
            Records are loaded and saved through the Absher backend API.
          </span>
        </footer>
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
