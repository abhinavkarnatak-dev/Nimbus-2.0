"use client";

const topic = "nimbus:repositories-updated";

export function notifyRepositoryUpdate() {
  window.dispatchEvent(new Event(topic));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(topic);
    channel.postMessage("updated");
    channel.close();
  }
}

export function subscribeRepositoryUpdates(refresh: () => void) {
  window.addEventListener(topic, refresh);
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(topic)
      : null;
  if (channel) channel.onmessage = refresh;
  return () => {
    window.removeEventListener(topic, refresh);
    channel?.close();
  };
}
