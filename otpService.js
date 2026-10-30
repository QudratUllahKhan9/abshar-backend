const crypto = require("crypto");

/* =====================================================
   OTP CONFIG
===================================================== */

const SECRET =
  process.env.OTP_SECRET ||
  "dev-otp-secret-change-me";

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_COOLDOWN_MS = 60000; // 1 minute

/*
  In-memory OTP store

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

function hmac(phone, otp, expiresAt) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(
      `${phone}:${otp}:${expiresAt}`
    )
    .digest("hex");
}

/* =====================================================
   GENERATE 4 DIGIT OTP
===================================================== */

function generateOtp() {
  return String(
    crypto.randomInt(0, 10000)
  ).padStart(4, "0");
}

/* =====================================================
   ISSUE OTP
===================================================== */

function issueOtp(
  phone,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
) {
  const cleanPhone = String(
    phone || ""
  ).trim();

  if (!cleanPhone) {
    throw new Error(
      "Phone number is required to issue OTP"
    );
  }

  /*
    Generate exactly 4 digits
  */

  const otp = generateOtp();

  /*
    OTP expiry
  */

  const now = Date.now();

  const expiresAt =
    now +
    Number(ttlSeconds) * 1000;

  /*
    Last sent time
  */

  const lastSentAt = now;

  /*
    HMAC hash
  */

  const hash = hmac(
    cleanPhone,
    otp,
    expiresAt
  );

  /*
    Save OTP record
  */

  store.set(
    cleanPhone,
    {
      otp,

      hash,

      expiresAt,

      attempts: 0,

      maxAttempts:
        Number(maxAttempts),

      lastSentAt,
    }
  );

  /*
    Server console
    Useful during development
  */

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "              OTP ISSUED"
  );
  console.log(
    "========================================"
  );

  console.log(
    "PHONE:",
    cleanPhone
  );

  console.log(
    "OTP:",
    otp
  );

  console.log(
    "TTL:",
    `${ttlSeconds} seconds`
  );

  console.log(
    "EXPIRES:",
    new Date(
      expiresAt
    ).toISOString()
  );

  console.log(
    "MAX ATTEMPTS:",
    maxAttempts
  );

  console.log(
    "STORE SIZE:",
    store.size
  );

  console.log(
    "========================================"
  );

  return otp;
}

/* =====================================================
   GET OTP RECORD
   Internal helper
===================================================== */

function getOtpRecord(phone) {
  const cleanPhone = String(
    phone || ""
  ).trim();

  return store.get(cleanPhone);
}

/* =====================================================
   CAN RESEND OTP
===================================================== */

function canResend(
  phone,
  cooldownMs = DEFAULT_COOLDOWN_MS
) {
  const cleanPhone = String(
    phone || ""
  ).trim();

  /*
    No previous OTP
  */

  if (!cleanPhone) {
    return {
      ok: false,
      waitMs: 0,
      reason: "invalid_phone",
    };
  }

  const record =
    store.get(cleanPhone);

  if (!record) {
    return {
      ok: true,
      waitMs: 0,
    };
  }

  /*
    Calculate remaining cooldown
  */

  const elapsed =
    Date.now() -
    record.lastSentAt;

  const waitMs =
    Number(cooldownMs) -
    elapsed;

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

function verifyOtp(
  phone,
  otp
) {
  const cleanPhone = String(
    phone || ""
  ).trim();

  const receivedOtp =
    String(otp || "")
      .trim()
      .replace(
        /[^0-9]/g,
        ""
      );

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "            OTP SERVICE VERIFY"
  );
  console.log(
    "========================================"
  );

  console.log(
    "PHONE:",
    cleanPhone
  );

  console.log(
    "OTP RECEIVED:",
    receivedOtp
  );

  /*
    Phone missing
  */

  if (!cleanPhone) {
    console.log(
      "NO PHONE NUMBER"
    );

    return {
      ok: false,
      reason: "invalid_phone",
    };
  }

  /*
    OTP missing
  */

  if (!receivedOtp) {
    console.log(
      "NO OTP RECEIVED"
    );

    return {
      ok: false,
      reason: "invalid_otp",
    };
  }

  /*
    Get OTP record
  */

  const record =
    store.get(cleanPhone);

  /*
    No OTP record
  */

  if (!record) {
    console.log(
      "NO OTP RECORD"
    );

    console.log(
      "========================================"
    );

    return {
      ok: false,
      reason: "no_otp",
    };
  }

  /*
    Debug information
  */

  console.log(
    "OTP STORED:",
    record.otp
  );

  console.log(
    "ATTEMPTS:",
    record.attempts
  );

  console.log(
    "MAX ATTEMPTS:",
    record.maxAttempts
  );

  console.log(
    "EXPIRES:",
    new Date(
      record.expiresAt
    ).toISOString()
  );

  /* =================================================
     CHECK EXPIRY
  ================================================= */

  if (
    Date.now() >
    record.expiresAt
  ) {
    console.log(
      "OTP EXPIRED"
    );

    store.delete(cleanPhone);

    console.log(
      "OTP RECORD DELETED"
    );

    console.log(
      "========================================"
    );

    return {
      ok: false,
      reason: "expired",
    };
  }

  /* =================================================
     CHECK MAX ATTEMPTS
  ================================================= */

  if (
    record.attempts >=
    record.maxAttempts
  ) {
    console.log(
      "OTP LOCKED"
    );

    store.delete(cleanPhone);

    console.log(
      "OTP RECORD DELETED"
    );

    console.log(
      "========================================"
    );

    return {
      ok: false,
      reason: "locked",
      attemptsLeft: 0,
    };
  }

  /* =================================================
     CHECK OTP LENGTH
  ================================================= */

  if (
    receivedOtp.length !== 4
  ) {
    console.log(
      "INVALID OTP LENGTH"
    );

    record.attempts += 1;

    store.set(
      cleanPhone,
      record
    );

    return {
      ok: false,
      reason: "wrong",

      attemptsLeft:
        Math.max(
          0,
          record.maxAttempts -
            record.attempts
        ),
    };
  }

  /* =================================================
     DIRECT OTP COMPARISON
  ================================================= */

  if (
    receivedOtp !==
    record.otp
  ) {
    console.log(
      "OTP DOES NOT MATCH"
    );

    console.log(
      "EXPECTED:",
      record.otp
    );

    console.log(
      "RECEIVED:",
      receivedOtp
    );

    record.attempts += 1;

    store.set(
      cleanPhone,
      record
    );

    const attemptsLeft =
      Math.max(
        0,
        record.maxAttempts -
          record.attempts
      );

    console.log(
      "ATTEMPTS LEFT:",
      attemptsLeft
    );

    /*
      If attempts are finished,
      delete OTP record.
    */

    if (
      record.attempts >=
      record.maxAttempts
    ) {
      console.log(
        "MAX ATTEMPTS REACHED"
      );

      store.delete(
        cleanPhone
      );

      return {
        ok: false,
        reason: "locked",
        attemptsLeft: 0,
      };
    }

    console.log(
      "========================================"
    );

    return {
      ok: false,
      reason: "wrong",
      attemptsLeft,
    };
  }

  /* =================================================
     HMAC INTEGRITY CHECK
  ================================================= */

  const expectedHash =
    hmac(
      cleanPhone,
      record.otp,
      record.expiresAt
    );

  /*
    Use timingSafeEqual for
    secure hash comparison.
  */

  let hashMatches = false;

  try {
    const expectedBuffer =
      Buffer.from(
        expectedHash,
        "hex"
      );

    const storedBuffer =
      Buffer.from(
        record.hash,
        "hex"
      );

    if (
      expectedBuffer.length ===
      storedBuffer.length
    ) {
      hashMatches =
        crypto.timingSafeEqual(
          expectedBuffer,
          storedBuffer
        );
    }
  } catch (error) {
    console.error(
      "HMAC COMPARE ERROR:",
      error
    );

    hashMatches = false;
  }

  /*
    HMAC failed
  */

  if (!hashMatches) {
    console.log(
      "HMAC CHECK FAILED"
    );

    store.delete(
      cleanPhone
    );

    console.log(
      "OTP RECORD DELETED"
    );

    console.log(
      "========================================"
    );

    return {
      ok: false,
      reason: "integrity_error",
    };
  }

  /* =================================================
     SUCCESS
  ================================================= */

  console.log(
    "OTP MATCHED"
  );

  console.log(
    "OTP VERIFIED"
  );

  /*
    OTP can only be used once.
  */

  store.delete(
    cleanPhone
  );

  console.log(
    "OTP RECORD DELETED"
  );

  console.log(
    "LOGIN OTP SUCCESS"
  );

  console.log(
    "========================================"
  );

  return {
    ok: true,
  };
}

/* =====================================================
   DELETE OTP
===================================================== */

function deleteOtp(phone) {
  const cleanPhone = String(
    phone || ""
  ).trim();

  if (!cleanPhone) {
    return false;
  }

  return store.delete(
    cleanPhone
  );
}

/* =====================================================
   CLEAR ALL OTPs
   Useful for development/server cleanup
===================================================== */

function clearAllOtps() {
  store.clear();

  console.log(
    "All OTP records cleared."
  );
}

/* =====================================================
   CLEAN EXPIRED OTPs
===================================================== */

function cleanupExpiredOtps() {
  const now = Date.now();

  let deleted = 0;

  for (
    const [
      phone,
      record,
    ] of store.entries()
  ) {
    if (
      now >
      record.expiresAt
    ) {
      store.delete(phone);

      deleted += 1;
    }
  }

  if (deleted > 0) {
    console.log(
      `OTP cleanup: ${deleted} expired record(s) removed.`
    );
  }

  return deleted;
}

/* =====================================================
   AUTOMATIC CLEANUP
===================================================== */

/*
  Check expired OTPs every minute.
*/

const cleanupInterval =
  setInterval(
    cleanupExpiredOtps,
    60000
  );

/*
  Don't keep Node process alive
  only because of this timer.
*/

if (
  cleanupInterval.unref
) {
  cleanupInterval.unref();
}

/* =====================================================
   OTP STATUS
   Development/debug helper
===================================================== */

function getStatus(phone) {
  const cleanPhone = String(
    phone || ""
  ).trim();

  const record =
    store.get(cleanPhone);

  if (!record) {
    return {
      exists: false,
    };
  }

  const expired =
    Date.now() >
    record.expiresAt;

  return {
    exists: true,

    expiresAt:
      record.expiresAt,

    expired,

    attempts:
      record.attempts,

    maxAttempts:
      record.maxAttempts,

    lastSentAt:
      record.lastSentAt,

    /*
      OTP included only for development.
    */

    ...(process.env.NODE_ENV !==
      "production" && {
      otp: record.otp,
    }),
  };
}

/* =====================================================
   EXPORTS
===================================================== */

module.exports = {
  issueOtp,

  canResend,

  verifyOtp,

  getOtpRecord,

  deleteOtp,

  clearAllOtps,

  cleanupExpiredOtps,

  getStatus,
};
