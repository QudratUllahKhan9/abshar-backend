
const crypto = require('crypto');

const SECRET =
  process.env.OTP_SECRET ||
  'dev-otp-secret-change-me';

/*
  idNo ->
  {
    otp,
    hash,
    expiresAt,
    attempts,
    maxAttempts,
    lastSentAt
  }
*/

const store = new Map();

/* =====================================================
   NORMALIZE ID NO
===================================================== */

function normalizeIdNo(idNo) {

  return String(
    idNo || ''
  )
    .trim()
    .replace(
      /[\s-]/g,
      ''
    )
    .toUpperCase();
}

/* =====================================================
   HMAC
===================================================== */

function hmac(
  idNo,
  otp,
  expiresAt
) {

  return crypto
    .createHmac(
      'sha256',
      SECRET
    )
    .update(
      `${idNo}:${otp}:${expiresAt}`
    )
    .digest('hex');
}

/* =====================================================
   ISSUE OTP
===================================================== */

function issueOtp(
  idNo,
  ttlSeconds = 300,
  maxAttempts = 3
) {

  const key =
    normalizeIdNo(
      idNo
    );

  /*
    Exactly 4 digits
  */

  const otp =
    String(
      crypto.randomInt(
        0,
        10000
      )
    ).padStart(
      4,
      '0'
    );

  const expiresAt =
    Date.now() +
    ttlSeconds * 1000;

  const lastSentAt =
    Date.now();

  const hash =
    hmac(
      key,
      otp,
      expiresAt
    );

  store.set(
    key,
    {

      /*
        Local debugging ke liye
        plain OTP temporarily stored.
      */

      otp,

      hash,

      expiresAt,

      attempts: 0,

      maxAttempts,

      lastSentAt,
    }
  );

  console.log('');
  console.log(
    '========================================'
  );

  console.log(
    '🔐 OTP ISSUED'
  );

  console.log(
    '========================================'
  );

  console.log(
    '🪪 ID NO:',
    key
  );

  console.log(
    '🔢 OTP:',
    otp
  );

  console.log(
    '⏰ EXPIRES:',
    new Date(
      expiresAt
    ).toISOString()
  );

  console.log(
    '📦 STORE SIZE:',
    store.size
  );

  console.log(
    '========================================'
  );

  return otp;
}

/* =====================================================
   CAN RESEND
===================================================== */

function canResend(
  idNo,
  cooldownMs = 60000
) {

  const key =
    normalizeIdNo(
      idNo
    );

  const rec =
    store.get(
      key
    );

  /*
    No previous OTP
  */

  if (!rec) {

    return {
      ok: true,
      waitMs: 0,
    };
  }

  const waitMs =
    cooldownMs -
    (
      Date.now() -
      rec.lastSentAt
    );

  if (
    waitMs > 0
  ) {

    return {
      ok: false,
      waitMs,
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

function verifyOtp(
  idNo,
  otp
) {

  const key =
    normalizeIdNo(
      idNo
    );

  console.log('');
  console.log(
    '========================================'
  );

  console.log(
    '🔐 OTP SERVICE VERIFY'
  );

  console.log(
    '========================================'
  );

  console.log(
    '🪪 ID NO:',
    key
  );

  console.log(
    '🔢 OTP RECEIVED:',
    otp
  );

  const rec =
    store.get(
      key
    );

  /* ==========================================
     NO OTP
  ========================================== */

  if (!rec) {

    console.log(
      '❌ NO OTP RECORD'
    );

    return {
      ok: false,
      reason: 'no_otp',
    };
  }

  console.log(
    'OTP STORED:',
    rec.otp
  );

  console.log(
    'ATTEMPTS:',
    rec.attempts
  );

  console.log(
    'MAX ATTEMPTS:',
    rec.maxAttempts
  );

  console.log(
    'EXPIRES:',
    new Date(
      rec.expiresAt
    ).toISOString()
  );

  /* ==========================================
     EXPIRED
  ========================================== */

  if (
    Date.now() >
    rec.expiresAt
  ) {

    console.log(
      '❌ OTP EXPIRED'
    );

    store.delete(
      key
    );

    return {
      ok: false,
      reason: 'expired',
    };
  }

  /* ==========================================
     LOCKED
  ========================================== */

  if (
    rec.attempts >=
    rec.maxAttempts
  ) {

    console.log(
      '❌ OTP LOCKED'
    );

    store.delete(
      key
    );

    return {
      ok: false,
      reason: 'locked',
    };
  }

  /* ==========================================
     NORMALIZE OTP
  ========================================== */

  const receivedOtp =
    String(
      otp || ''
    )
      .trim()
      .replace(
        /[^0-9]/g,
        ''
      );

  /* ==========================================
     DIRECT OTP CHECK
  ========================================== */

  if (
    receivedOtp !==
    rec.otp
  ) {

    console.log(
      '❌ OTP DOES NOT MATCH'
    );

    console.log(
      'EXPECTED:',
      rec.otp
    );

    console.log(
      'RECEIVED:',
      receivedOtp
    );

    rec.attempts += 1;

    store.set(
      key,
      rec
    );

    return {

      ok: false,

      reason:
        'wrong',

      attemptsLeft:
        Math.max(
          0,
          rec.maxAttempts -
          rec.attempts
        ),
    };
  }

  /* ==========================================
     HMAC CHECK
  ========================================== */

  const expectedHash =
    hmac(
      key,
      rec.otp,
      rec.expiresAt
    );

  if (
    expectedHash !==
    rec.hash
  ) {

    console.log(
      '❌ HMAC CHECK FAILED'
    );

    store.delete(
      key
    );

    return {
      ok: false,
      reason: 'wrong',
    };
  }

  /* ==========================================
     SUCCESS
  ========================================== */

  console.log(
    '✅ OTP MATCHED'
  );

  console.log(
    '✅ OTP VERIFIED'
  );

  store.delete(
    key
  );

  console.log(
    '🗑️ OTP RECORD DELETED'
  );

  console.log(
    '========================================'
  );

  return {
    ok: true,
  };
}

/* =====================================================
   EXPORTS
===================================================== */

module.exports = {

  issueOtp,

  canResend,

  verifyOtp,
};
