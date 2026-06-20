# Listed Marketplace

## Email delivery

The app sends transactional email for account verification and profile creation.

In production, email is now required to be configured. If no provider is configured, the API returns a visible `503` error instead of pretending the email was sent.

Configure one of these options in Railway Variables:

### Option A: Resend

```env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
EMAIL_FROM=Listed <no-reply@yourdomain.com>
```

Use a verified sender/domain in Resend. For testing, Resend may restrict who can receive email until the domain is verified.

### Option B: SMTP

```env
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=Listed <no-reply@yourdomain.com>
```

For Gmail, use an App Password, not your normal Gmail password.

## Local development

When `NODE_ENV` is not `production` and no email provider is configured, the app returns/logs development email content so you can test without sending real email.
