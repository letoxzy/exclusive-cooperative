const SCRIPT_SRC = "https://widget.dojah.io/widget.js";
let scriptPromise = null;

const config = () => ({
  app_id: import.meta.env.VITE_DOJAH_APP_ID,
  p_key: import.meta.env.VITE_DOJAH_PUBLIC_KEY,
  widget_id: import.meta.env.VITE_DOJAH_WIDGET_ID,
});

export function isDojahConfigured() {
  const { app_id, p_key, widget_id } = config();
  return Boolean(app_id && p_key && widget_id);
}

function loadScript() {
  if (window.Connect) return Promise.resolve();

  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.onload = resolve;
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("Could not load the verification widget."));
      };
      document.body.appendChild(script);
    });
  }

  return scriptPromise;
}

export async function openDojahWidget({
  container,
  referenceId,
  onSuccess,
  onError,
  onClose,
}) {
  if (!isDojahConfigured()) {
    throw new Error("Identity verification is not configured.");
  }

  const { app_id, p_key, widget_id } = config();

  await loadScript();

  const connect = new window.Connect({
    app_id,
    p_key,
    type: "custom",
    embed: true,
    container,
    config: { widget_id },
    reference_id: referenceId,
    onSuccess,
    onError,
    onClose,
  });

  connect.setup();
  connect.open();
}