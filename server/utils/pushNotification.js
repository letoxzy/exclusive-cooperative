const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(token) {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["))
  );
}

export async function sendPushNotification(user, { title, body, data = {} }) {
  const tokens = (user?.pushTokens || [])
    .map((item) => item?.token)
    .filter(isExpoPushToken);

  if (!tokens.length) {
    console.warn(`No registered push token for user ${user?._id || user?.email || "unknown"}.`);
    return { sent: 0 };
  }

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title,
    body,
    data,
    channelId: "exclusive-default",
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });

    const resultText = await response.text();

    if (!response.ok) {
      console.error("Expo push notification failed:", response.status, resultText);
      return { sent: 0 };
    }

    return { sent: tokens.length, result: resultText };
  } catch (error) {
    console.error("Expo push notification error:", error);
    return { sent: 0 };
  }
}
