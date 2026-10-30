const crypto = require("crypto");

/* =====================================================
   OTP CONFIG
===================================================== */

const SECRET =
  process.env.OTP_SECRET ||
  "dev-otp-secret-change-me";

const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_COOLDOWN_MS = 60000;

const store = new Map();

/* =====================================================
   HMAC
===================================================== */

function hmac(phone, otp, expiresAt) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${phone}:${otp}:${expiresAt}`)
    .digest("hex");
}

/* =====================================================
   GENERATE 6 DIGIT OTP
===================================================== */

function generateOtp() {
  return String(
    crypto.randomInt(0, 1000000)
  ).padStart(6, "0");
}

/* =====================================================
   ISSUE OTP
===================================================== */

function issueOtp(
  phone,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
) {
  const cleanPhone = String(phone || "").trim();

  if (!cleanPhone) {
    throw new Error("Phone number is required to issue OTP");
  }

  const otp = generateOtp();
  const now = Date.now();

  const expiresAt =
    now + Number(ttlSeconds) * 1000;

  const hash = hmac(
    cleanPhone,
    otp,
    expiresAt
  );

  store.set(cleanPhone, {
    otp,
    hash,
    expiresAt,
    attempts: 0,
    maxAttempts: Number(maxAttempts),
    lastSentAt: now,
  });

  console.log("========================================");
  console.log("OTP ISSUED");
  console.log("PHONE:", cleanPhone);
  console.log("OTP:", otp);
  console.log("TTL:", `${ttlSeconds} seconds`);
  console.log("EXPIRES:", new Date(expiresAt).toISOString());
  console.log("MAX ATTEMPTS:", maxAttempts);
  console.log("========================================");

  return otp;
}

/* =====================================================
   GET OTP RECORD
===================================================== */

function getOtpRecord(phone) {
  const cleanPhone = String(phone || "").trim();
  return store.get(cleanPhone);
}

/* =====================================================
   CAN RESEND OTP
===================================================== */

function canResend(
  phone,
  cooldownMs = DEFAULT_COOLDOWN_MS
) {
  const cleanPhone = String(phone || "").trim();

  if (!cleanPhone) {
    return {
      ok: false,
      waitMs: 0,
      reason: "invalid_phone",
    };
  }

  const record = store.get(cleanPhone);

  if (!record) {
    return {
      ok: true,
      waitMs: 0,
    };
  }

  const elapsed =
    Date.now() - record.lastSentAt;

  const waitMs =
    Number(cooldownMs) - elapsed;

  if (waitMs > 0) {
    return {
      ok: false,
      waitMs,
      reason: "cooldown",
    };
  }

  return {
    ok: true,
    waitMs: 0,
  };
}

/* =====================================================
   VERIFY OTP
===================================================== */

function verifyOtp(phone, receivedOtp) {
  const cleanPhone = String(phone || "").trim();
  const otp = String(receivedOtp || "").trim();

  if (!/^\d{6}$/.test(otp)) {
    return {
      success: false,
      message: "OTP must be exactly 6 digits",
    };
  }

  const record = store.get(cleanPhone);

  if (!record) {
    return {
      success: false,
      message: "OTP not found or expired",
    };
  }

  if (Date.now() > record.expiresAt) {
    store.delete(cleanPhone);

    return {
      success: false,
      message: "OTP has expired",
    };
  }

  if (record.attempts >= record.maxAttempts) {
    store.delete(cleanPhone);

    return {
      success: false,
      message: "Maximum OTP attempts exceeded",
    };
  }

  const receivedHash = hmac(
    cleanPhone,
    otp,
    record.expiresAt
  );

  const expectedHash = record.hash;

  const receivedBuffer = Buffer.from(receivedHash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  const isValid =
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(
      receivedBuffer,
      expectedBuffer
    );

  if (!isValid) {
    record.attempts += 1;

    return {
      success: false,
      message: "Invalid OTP",
      attemptsLeft:
        record.maxAttempts - record.attempts,
    };
  }

  store.delete(cleanPhone);

  return {
    success: true,
    message: "OTP verified successfully",
  };
}

/* =====================================================
   DELETE OTP
===================================================== */

function deleteOtp(phone) {
  const cleanPhone = String(phone || "").trim();
  store.delete(cleanPhone);
}

/* =====================================================
   EXPORTS
===================================================== */

module.exports = {
  issueOtp,
  verifyOtp,
  canResend,
  deleteOtp,
  getOtpRecord,
};
