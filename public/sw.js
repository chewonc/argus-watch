// SaveBell service worker: show push notifications and acknowledge receipt for latency measurement.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "SaveBell", body: event.data ? event.data.text() : "" }; }
  const ack = data.nid ? fetch("/api/push/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nid: data.nid }) }).catch(() => {}) : Promise.resolve();
  const show = self.registration.showNotification(data.title || "SaveBell", {
    body: data.body || "", tag: data.tag, icon: data.icon || "/icon-192.png", badge: data.badge || "/icon-192.png",
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [], data: { url: data.url || "/" },
  });
  event.waitUntil(Promise.all([ack, show]));
});
// Clicking the notification or its "View alert" action opens (or focuses) the alert page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => { for (const c of list) if ("focus" in c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); }));
});
