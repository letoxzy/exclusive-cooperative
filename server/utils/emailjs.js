/**
 * Minimal EmailJS sender shared by the login-alert email.
 * Uses the same account settings as the login-code email: the EMAILJS_OTP_*
 * values when set (so those two emails can live in a second EmailJS account),
 * otherwise the main EMAILJS_* values.
 */
export async function sendEmailJs(templateId, templateParams) {
  const env = process.env;
  const serviceId = env.EMAILJS_OTP_SERVICE_ID || env.EMAILJS_SERVICE_ID;
  const publicKey = env.EMAILJS_OTP_PUBLIC_KEY || env.EMAILJS_PUBLIC_KEY;
  const privateKey = env.EMAILJS_OTP_PRIVATE_KEY || env.EMAILJS_PRIVATE_KEY;

  if (!serviceId || !publicKey || !templateId) {
    throw new Error("EmailJS is not configured for this email");
  }

  const body = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    template_params: templateParams,
  };
  if (privateKey) body.accessToken = privateKey;

  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || "Unable to send email");
  }
}
