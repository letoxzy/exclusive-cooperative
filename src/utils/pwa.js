/**
 * Makes the website installable as an app on Android, iPhone and computers
 * (a "progressive web app").
 *
 *  - adds the manifest and the iPhone "Add to Home Screen" tags to the page
 *    (if index.html does not already have them),
 *  - registers the service worker (/sw.js) that also handles push notifications,
 *  - remembers Chrome's "install" offer so a button of ours can trigger it.
 */

// ---- Chrome / Edge / Samsung Internet install offer --------------------------
// Captured at load time because the browser can fire it before React mounts.
let installEvent = null;
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // we show our own button instead of the browser's bar
    installEvent = event;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    installEvent = null;
    notify();
  });
}

export const getInstallEvent = () => installEvent;

export const onInstallChange = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// ---- environment helpers -------------------------------------------------------
/** True when the site is running as an installed app (not in a browser tab). */
export const isInstalledApp = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true);

export const isIos = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS reports itself as a Mac, but has a touch screen.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

// ---- setup -----------------------------------------------------------------------
function ensureTag(selector, tagName, attributes) {
  if (document.head.querySelector(selector)) return;
  const element = document.createElement(tagName);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
  document.head.appendChild(element);
}

export function initPwa() {
  if (typeof document === "undefined") return;

  ensureTag('link[rel="manifest"]', "link", {
    rel: "manifest",
    href: "/manifest.webmanifest",
  });
  ensureTag('meta[name="theme-color"]', "meta", {
    name: "theme-color",
    content: "#075c3b",
  });
  ensureTag('link[rel="apple-touch-icon"]', "link", {
    rel: "apple-touch-icon",
    sizes: "180x180",
    href: "/icons/apple-touch-icon.png",
  });
  ensureTag('meta[name="apple-mobile-web-app-capable"]', "meta", {
    name: "apple-mobile-web-app-capable",
    content: "yes",
  });
  ensureTag('meta[name="mobile-web-app-capable"]', "meta", {
    name: "mobile-web-app-capable",
    content: "yes",
  });
  ensureTag('meta[name="apple-mobile-web-app-title"]', "meta", {
    name: "apple-mobile-web-app-title",
    content: "Exclusive Coop",
  });
  ensureTag('meta[name="apple-mobile-web-app-status-bar-style"]', "meta", {
    name: "apple-mobile-web-app-status-bar-style",
    content: "default",
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }
}
