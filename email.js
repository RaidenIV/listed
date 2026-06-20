// email.js — transactional email via SMTP or Resend.
// Configure either SMTP_* variables or RESEND_API_KEY + EMAIL_FROM.
// Email delivery is never silently faked in production. In local development,
// missing email configuration returns a dev flag so verification links can be
// copied from API responses while testing.

const nodemailer = require('nodemailer');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const resendConfigured = !!process.env.RESEND_API_KEY;
const emailConfigured = smtpConfigured || resendConfigured;
const FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || 'Listed <onboarding@resend.dev>';

class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email delivery is not configured. Set SMTP_* variables or RESEND_API_KEY and EMAIL_FROM.');
    this.name = 'EmailNotConfiguredError';
    this.code = 'EMAIL_NOT_CONFIGURED';
    this.status = 503;
  }
}

class EmailDeliveryError extends Error {
  constructor(message) {
    super(message || 'Email delivery failed.');
    this.name = 'EmailDeliveryError';
    this.code = 'EMAIL_DELIVERY_FAILED';
    this.status = 502;
  }
}

let smtpTransport = null;
if (smtpConfigured) {
  const port = Number(process.env.SMTP_PORT) || 587;
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendWithResend({ to, subject, html, text }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = data?.message || data?.error || JSON.stringify(data);
    } catch (_) {
      detail = await response.text();
    }
    throw new EmailDeliveryError(`Resend email failed (${response.status}): ${detail}`);
  }

  return response.json();
}

async function sendMail({ to, subject, html, text }) {
  if (smtpTransport) {
    const info = await smtpTransport.sendMail({ from: FROM, to, subject, html, text });
    return { sent: true, provider: 'smtp', messageId: info.messageId };
  }

  if (resendConfigured) {
    const info = await sendWithResend({ to, subject, html, text });
    return { sent: true, provider: 'resend', messageId: info?.id };
  }

  if (!isProduction) {
    console.warn('\n[email:dev] Email is not configured — returning dev email content instead of sending.');
    console.warn(`  to:      ${to}`);
    console.warn(`  subject: ${subject}`);
    console.warn(`  text:\n${text}\n`);
    return { sent: false, dev: true, provider: 'dev-log' };
  }

  throw new EmailNotConfiguredError();
}

function verificationContent(link) {
  const text =
    `Welcome to Listed!\n\n` +
    `Confirm your email to activate your account:\n${link}\n\n` +
    `This link expires in 24 hours. If you didn't create an account, you can ignore this email.`;

  const html = `
  <div style="margin:0;padding:32px 16px;background:#f0f0f6;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e8e8ee;">
      <div style="padding:28px 28px 8px;">
        <div style="font-size:26px;font-weight:900;letter-spacing:-1px;color:#4b13f0;">Listed</div>
        <div style="font-size:12px;color:#555;margin-top:2px;">Real people. Real listings. Real sales.</div>
      </div>
      <div style="padding:8px 28px 28px;">
        <h1 style="font-size:19px;color:#111;margin:16px 0 8px;">Confirm your email</h1>
        <p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 22px;">
          Tap the button below to activate your account and start buying and selling on Listed.
        </p>
        <a href="${link}"
           style="display:inline-block;background:#4b13f0;color:#fff;text-decoration:none;
                  font-weight:700;font-size:14px;padding:13px 24px;border-radius:10px;">
          Activate my account
        </a>
        <p style="font-size:12px;line-height:1.6;color:#888;margin:22px 0 0;">
          This link expires in 24 hours. If the button doesn't work, paste this URL into your browser:<br>
          <span style="color:#4b13f0;word-break:break-all;">${link}</span>
        </p>
        <p style="font-size:12px;color:#aaa;margin:18px 0 0;">
          If you didn't create a Listed account, you can safely ignore this email.
        </p>
      </div>
    </div>
  </div>`;

  return { subject: 'Confirm your email for Listed.', text, html };
}

async function sendVerificationEmail(to, link) {
  const { subject, text, html } = verificationContent(link);
  return sendMail({ to, subject, text, html });
}

function profileCreatedContent(profile) {
  const name = String(profile?.display_name || 'there').trim() || 'there';
  const safeName = name.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));
  const text =
    `Your Listed profile is ready.\n\n` +
    `Hi ${name}, your profile has been created and you can now access the marketplace.\n\n` +
    `You can update your profile from the Profile link in the app. ` +
    `If you did not create this profile, sign in and change your password.`;

  const html = `
  <div style="margin:0;padding:32px 16px;background:#f0f0f6;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e8e8ee;">
      <div style="padding:28px 28px 8px;">
        <div style="font-size:26px;font-weight:900;letter-spacing:-1px;color:#4b13f0;">Listed</div>
        <div style="font-size:12px;color:#555;margin-top:2px;">Real people. Real listings. Real sales.</div>
      </div>
      <div style="padding:8px 28px 28px;">
        <h1 style="font-size:19px;color:#111;margin:16px 0 8px;">Your profile is ready</h1>
        <p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 22px;">
          Hi ${safeName}, your Listed profile has been created. You can now access the marketplace.
        </p>
        <p style="font-size:12px;line-height:1.6;color:#888;margin:22px 0 0;">
          You can update your profile from the Profile link in the app.
        </p>
        <p style="font-size:12px;color:#aaa;margin:18px 0 0;">
          If you did not create this profile, sign in and change your password.
        </p>
      </div>
    </div>
  </div>`;

  return { subject: 'Your Listed profile is ready.', text, html };
}

async function sendProfileCreatedEmail(to, profile) {
  const { subject, text, html } = profileCreatedContent(profile);
  return sendMail({ to, subject, text, html });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendProfileCreatedEmail,
  emailConfigured,
  smtpConfigured,
  resendConfigured,
  EmailNotConfiguredError,
  EmailDeliveryError,
};
