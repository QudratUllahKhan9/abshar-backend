
const crypto = require('crypto');

const SECRET =
  process.env.OTP_SECRET ||
  'dev-otp-secret-change-me';

/*
  phone ->
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
   HMAC
===================================================== */

function hmac(
  phone,
  otp,
  expiresAt
) {
  return crypto
    .createHmac(
      'sha256',
      SECRET
    )
    .update(
      `${phone}:${otp}:${expiresAt}`
    )
    .digest('hex');
}

/* =====================================================
   ISSUE OTP
===================================================== */

function issueOtp(
  phone,
  ttlSeconds = 300,
  maxAttempts = 3
) {
  /*
    Generate exactly 4 digits.
  */
  const otp = String(
    crypto.randomInt(
      0,
      10000
    )
  ).padStart(4, '0');

  const expiresAt =
    Date.now() +
    ttlSeconds * 1000;

  const lastSentAt =
    Date.now();

  const hash =
    hmac(
      phone,
      otp,
      expiresAt
    );

  store.set(
    phone,
    {
      /*
        Temporary plain OTP is kept only
        so we can debug the local OTP flow.
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
    'OTP ISSUED'
  );
  console.log(
    '========================================'
  );

  console.log(
    'PHONE:',
    phone
  );

  console.log(
    'OTP:',
    otp
  );

  console.log(
    'EXPIRES:',
    new Date(
      expiresAt
    ).toISOString()
  );

  console.log(
    'STORE SIZE:',
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
  phone,
  cooldownMs = 60000
) {
  const rec =
    store.get(phone);

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

  if (waitMs > 0) {
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
  phone,
  otp
) {
  console.log('');
  console.log(
    '========================================'
  );
  console.log(
    'OTP SERVICE VERIFY'
  );
  console.log(
    '========================================'
  );

  console.log(
    'PHONE:',
    phone
  );

  console.log(
    'OTP RECEIVED:',
    otp
  );

  const rec =
    store.get(phone);

  /*
    No OTP found
  */
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

  /*
    Expired
  */
  if (
    Date.now() >
    rec.expiresAt
  ) {
    console.log(
      '❌ OTP EXPIRED'
    );

    store.delete(phone);

    return {
      ok: false,
      reason: 'expired',
    };
  }

  /*
    Too many attempts
  */
  if (
    rec.attempts >=
    rec.maxAttempts
  ) {
    console.log(
      '❌ OTP LOCKED'
    );

    store.delete(phone);

    return {
      ok: false,
      reason: 'locked',
    };
  }

  /*
    Normalize received OTP
  */
  const receivedOtp =
    String(
      otp || ''
    )
      .trim()
      .replace(
        /[^0-9]/g,
        ''
      );

  /*
    Compare directly first.

    This makes the local OTP flow
    reliable.
  */
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
      phone,
      rec
    );

    return {
      ok: false,
      reason: 'wrong',
      attemptsLeft:
        Math.max(
          0,
          rec.maxAttempts -
            rec.attempts
        ),
    };
  }

  /*
    HMAC verification as an additional
    integrity check.
  */
  const expectedHash =
    hmac(
      phone,
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

    store.delete(phone);

    return {
      ok: false,
      reason: 'wrong',
    };
  }

  /*
    SUCCESS
  */
  console.log(
    '✅ OTP MATCHED'
  );

  console.log(
    '✅ OTP VERIFIED'
  );

  store.delete(phone);

  console.log(
    'OTP RECORD DELETED'
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

