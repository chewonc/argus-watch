// Argus Watch service worker: show push notifications and acknowledge receipt for latency measurement.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Argus Watch", body: event.data ? event.data.text() : "" }; }
  const ack = data.nid ? fetch("/api/push/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nid: data.nid }) }).catch(() => {}) : Promise.resolve();
  const show = self.registration.showNotification(data.title || "Argus Watch", { body: data.body || "", tag: data.tag, data: { url: data.url || "/" } });
  event.waitUntil(Promise.all([ack, show]));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => { for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); }));
});
