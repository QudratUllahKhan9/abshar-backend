const crypto = require('crypto');

/* =====================================================
   OTP SERVICE — Vercel / Serverless SAFE

   ROOT FIX:
   Pehle OTP ek in-memory Map me store hota tha.
   Vercel serverless pe har cold start / alag instance
   ka apna alag memory hoti hai, isliye verifyOtp ko
   "no_otp" milta tha even jab OTP sahi ho.

   Ab OTP STATELESS hai:
   OTP khud SECRET + phone + time-window se derive hota
   hai (HMAC-based). Verify ke waqt server wahi OTP
   dobara calculate kar ke compare karta hai — koi store
   ki zaroorat nahi, cold start / naya instance kuch
   nahi bigadta.

   In-memory Map sirf BEST-EFFORT cheezon ke liye hai:
   resend cooldown, wrong attempts count, used-window.
   Ye warm instance me theek chalte hain; instance
   badalne pe reset ho jate hain (security-critical
   nahi — OTP verification khud stateless hai).

   Same exports / same contract as before:
   - issueOtp(phone, ttlSeconds, maxAttempts) -> otp (4 digits)
   - canResend(phone, cooldownMs)             -> { ok, waitMs }
   - verifyOtp(phone, otp)                    -> { ok } | { ok:false, reason, attemptsLeft }
===================================================== */

const SECRET =
  process.env.OTP_SECRET ||
  'dev-otp-secret-change-me';

/* Debug logs sirf jab OTP_DEBUG=true ho
   (Vercel logs me OTP leak na ho) */
const OTP_DEBUG =
  process.env.OTP_DEBUG === 'true';

/* Default window size (ms) — env se, warna 300s */
function defaultWindowMs() {
  const ttl =
    parseInt(
      process.env.OTP_TTL_SECONDS || '300',
      10
    );
  return ttl * 1000;
}

/*
  phone ->
  {
    windowMs,
    issuedWin,
    issuedAt,
    attempts,
    maxAttempts,
    usedWin
  }
*/

/* Warm instances me survive karne ke liye global */
const store =
  global.__OTP_STORE__ ||
  (global.__OTP_STORE__ = new Map());

/* =====================================================
   DEBUG LOG HELPER
===================================================== */

function debugLog(...args) {
  if (OTP_DEBUG) {
    console.log(...args);
  }
}

/* =====================================================
   STATELESS OTP — HMAC of (phone : windowIndex)
   Same instance, naya instance, cold start —
   sab jagah same OTP milega jab tak window chal rahi hai.
===================================================== */

function otpForWindow(
  phone,
  windowMs,
  windowStart
) {
  const windowIndex =
    Math.floor(
      windowStart / windowMs
    );

  const digest =
    crypto
      .createHmac(
        'sha256',
        SECRET
      )
      .update(
        `${phone}:${windowIndex}`
      )
      .digest('hex');

  const num =
    parseInt(
      digest.slice(0, 8),
      16
    ) % 10000;

  return String(num).padStart(4, '0');
}

/* =====================================================
   TIMING-SAFE COMPARE
   (pehle plain !== tha — timing attack possible)
===================================================== */

function safeEqual(a, b) {
  const bufA =
    Buffer.from(String(a));

  const bufB =
    Buffer.from(String(b));

  if (bufA.length !== bufB.length) {
    /* Length alag — dummy compare se
       constant-ish time burn karo */
    crypto.timingSafeEqual(
      bufA,
      Buffer.alloc(bufA.length)
    );
    return false;
  }

  return crypto.timingSafeEqual(
    bufA,
    bufB
  );
}

/* =====================================================
   ISSUE OTP
===================================================== */

function issueOtp(
  phone,
  ttlSeconds = 300,
  maxAttempts = 3
) {
  const windowMs =
    parseInt(ttlSeconds, 10) * 1000 ||
    defaultWindowMs();

  const currentWindow =
    Math.floor(
      Date.now() / windowMs
    ) * windowMs;

  /* Stateless OTP — store me sirf metadata */
  const otp =
    otpForWindow(
      phone,
      windowMs,
      currentWindow
    );

  store.set(
    phone,
    {
      windowMs,

      issuedWin:
        currentWindow,

      issuedAt:
        Date.now(),

      attempts: 0,

      maxAttempts:
        parseInt(maxAttempts, 10) || 3,

      usedWin: null,
    }
  );

  debugLog('');
  debugLog(
    '========================================'
  );
  debugLog(
    'OTP ISSUED (stateless, HMAC window-based)'
  );
  debugLog(
    '========================================'
  );
  debugLog(
    'PHONE:',
    phone
  );

  /* OTP sirf debug mode me log hota hai
     (production Vercel logs me leak nahi hoga) */
  debugLog(
    'OTP:',
    otp
  );

  debugLog(
    'WINDOW_MS:',
    windowMs
  );

  debugLog(
    'VALID UNTIL (window end + grace):',
    new Date(
      currentWindow + windowMs * 2
    ).toISOString()
  );

  debugLog(
    '========================================'
  );

  return otp;
}

/* =====================================================
   CAN RESEND
   (best-effort, in-memory — instance change pe
   cooldown reset ho sakta hai)
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
      rec.issuedAt
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
   Stateless — current + previous window ka
   expected OTP calculate kar ke compare karta hai.
   Store sirf attempts/lock/used ke liye.
===================================================== */

function verifyOtp(
  phone,
  otp
) {
  debugLog('');
  debugLog(
    '========================================'
  );
  debugLog(
    'OTP SERVICE VERIFY (stateless)'
  );
  debugLog(
    '========================================'
  );
  debugLog(
    'PHONE:',
    phone
  );

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

  const rec =
    store.get(phone);

  /*
    Window size — rec se, warna env/default
    (cold start pe rec nahi hoga, tab bhi
    verification chalegi)
  */
  const windowMs =
    (rec && rec.windowMs) ||
    defaultWindowMs();

  const now =
    Date.now();

  const currentWindow =
    Math.floor(
      now / windowMs
    ) * windowMs;

  const previousWindow =
    currentWindow - windowMs;

  /*
    Expiry (jab record maujood ho)
    OTP valid: issued window + next window
    (grace — window boundary pe issue hua
    OTP agle window me bhi verify ho sake)
  */
  if (
    rec &&
    now >
    rec.issuedWin + windowMs * 2
  ) {
    debugLog(
      '❌ OTP EXPIRED'
    );

    store.delete(phone);

    return {
      ok: false,
      reason: 'expired',
    };
  }

  /*
    Too many attempts (best-effort)
  */
  if (
    rec &&
    rec.attempts >=
    rec.maxAttempts
  ) {
    debugLog(
      '❌ OTP LOCKED'
    );

    store.delete(phone);

    return {
      ok: false,
      reason: 'locked',
    };
  }

  /*
    Expected OTPs — current + previous window
    (cold start / naya instance pe bhi same
    calculate honge, kyunki SECRET + phone +
    window se derive hote hain)
  */
  const expectedOtpCurrent =
    otpForWindow(
      phone,
      windowMs,
      currentWindow
    );

  const expectedOtpPrevious =
    otpForWindow(
      phone,
      windowMs,
      previousWindow
    );

  /*
    Timing-safe compare dono windows se
  */
  const matchedCurrent =
    safeEqual(
      receivedOtp,
      expectedOtpCurrent
    );

  const matchedPrevious =
    matchedCurrent
      ? false
      : safeEqual(
          receivedOtp,
          expectedOtpPrevious
        );

  if (
    !matchedCurrent &&
    !matchedPrevious
  ) {
    debugLog(
      '❌ OTP DOES NOT MATCH'
    );

    /*
      Attempts count (best-effort) —
      rec na ho to bhi create karo
    */
    const rec2 =
      rec || {
        windowMs,

        issuedWin:
          currentWindow,

        issuedAt:
          now,

        maxAttempts: 3,

        usedWin: null,
      };

    rec2.attempts =
      (rec2.attempts || 0) + 1;

    store.set(
      phone,
      rec2
    );

    return {
      ok: false,
      reason: 'wrong',

      attemptsLeft:
        Math.max(
          0,
          (rec2.maxAttempts || 3) -
            rec2.attempts
        ),
    };
  }

  const matchedWindow =
    matchedCurrent
      ? currentWindow
      : previousWindow;

  /*
    Replay check (best-effort) —
    same window ka OTP dobara use na ho
  */
  if (
    rec &&
    rec.usedWin ===
    matchedWindow
  ) {
    debugLog(
      '❌ OTP ALREADY USED'
    );

    return {
      ok: false,
      reason: 'no_otp',
    };
  }

  /*
    SUCCESS
  */
  debugLog(
    '✅ OTP VERIFIED (window:',
    matchedCurrent ? 'current' : 'previous',
    ')'
  );

  /* Window used mark karo — replay rokne ke liye */
  store.set(
    phone,
    {
      ...(rec || {}),

      usedWin:
        matchedWindow,
    }
  );

  debugLog(
    '========================================'
  );

  return {
    ok: true,
  };
}

/* =====================================================
   EXPORTS — same as before
===================================================== */

module.exports = {
  issueOtp,
  canResend,
  verifyOtp,
};
