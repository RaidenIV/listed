// email.js — transactional email via SMTP (nodemailer).
// If SMTP credentials aren't configured, it logs the message (and the
// verification link) to the console instead of sending, so the flow is fully
// testable without a mail provider. Configure SMTP_* env vars to send for real.

const nodemailer = require('nodemailer');

const isConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const FROM = process.env.SMTP_FROM || process.env.SMTP_USER || 'Listed. <no-reply@listed.app>';

let transport = null;
if (isConfigured) {
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587/others use STARTTLS. Override with SMTP_SECURE=true/false.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const emailConfigured = isConfigured;

async function sendMail({ to, subject, html, text }) {
  if (!transport) {
    console.log('\n[email:dev] SMTP not configured — logging instead of sending');
    console.log(`  to:      ${to}`);
    console.log(`  subject: ${subject}`);
    console.log(`  link/text:\n${text}\n`);
    return { dev: true };
  }
  await transport.sendMail({ from: FROM, to, subject, html, text });
  return { dev: false };
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

module.exports = { sendMail, sendVerificationEmail, sendProfileCreatedEmail, emailConfigured };
