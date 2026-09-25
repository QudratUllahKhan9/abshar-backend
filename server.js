require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dns = require('dns');
const otpService = require('./otpService');

const app = express();

/* =====================================================
   DNS
===================================================== */

dns.setServers(['1.1.1.1', '8.8.8.8']);

/* =====================================================
   EXPRESS
===================================================== */

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* =====================================================
   CONFIG
===================================================== */

const PORT = process.env.PORT || 5000;

const JWT_SECRET =
  process.env.JWT_SECRET || 'change_this_to_a_real_secret';

const OTP_TTL = parseInt(
  process.env.OTP_TTL_SECONDS || '300',
  10
);

const MAX_ATTEMPTS = parseInt(
  process.env.OTP_ATTEMPTS_MAX || '3',
  10
);

const COOLDOWN_MS = parseInt(
  process.env.OTP_RESEND_COOLDOWN_MS || '60000',
  10
);

/* =====================================================
   DB MIDDLEWARE
   Har request se pehle MongoDB connection ensure hota hai.
   Local aur Vercel dono par same behaviour.
===================================================== */

app.use((req, res, next) => {

  connectDB()

    .then(() => next())

    .catch((err) => {

      console.error(
        '[DB ERROR] Connection failed:',
        err.message
      );

      res.status(500).json({
        success: false,
        message: 'Database connection failed',
      });
    });
});

/* =====================================================
   PHONE NORMALIZE
===================================================== */

function normalizePhone(p) {
  let s = String(p || '')
    .trim()
    .replace(/[\s-]/g, '');

  if (!s) return s;

  if (s.startsWith('+')) return s;

  if (/^0\d{9,10}$/.test(s)) {
    return '+92' + s.slice(1);
  }

  if (/^92\d{9,10}$/.test(s)) {
    return '+' + s;
  }

  return s;
}

/* =====================================================
   GET ALL PHONE FORMATS
===================================================== */

function getPhoneFormats(phone) {
  const raw = String(phone || '')
    .trim()
    .replace(/[\s-]/g, '');

  const normalized = normalizePhone(raw);

  const formats = new Set();

  if (raw) formats.add(raw);

  if (normalized) formats.add(normalized);

  if (normalized.startsWith('+92')) {
    formats.add('0' + normalized.slice(3));
  }

  if (normalized.startsWith('+')) {
    formats.add(normalized.slice(1));
  }

  return [...formats];
}

/* =====================================================
   PHONE REGEX
===================================================== */

const PHONE_RE = /^\+[1-9]\d{7,14}$/;

/* =====================================================
   ERROR HELPER
===================================================== */

function fail(res, code, message) {
  return res.status(code).json({
    success: false,
    message,
  });
}

/* =====================================================
   HOME
===================================================== */

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Abshar API is running',
  });
});

/* =====================================================
   HEALTH
===================================================== */

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    mongodb: mongoose.connection.readyState === 1,
  });
});

/* =====================================================
   REGISTER
   COLLECTION: items
===================================================== */

app.post('/api/register', async (req, res) => {
  try {
    const rawPhone = String(req.body.phone || '').trim();

    const password = String(
      req.body.password || ''
    );

    console.log('\n');
    console.log('========================================');
    console.log('         📝 REGISTER REQUEST');
    console.log('========================================');
    console.log('📱 Phone:', rawPhone);
    console.log('👤 Name:', req.body.name);
    console.log('🪪 CNIC:', req.body.cnic || req.body.idNo);
    console.log('🖼️ Image URL:', req.body.imageUrl);
    console.log('========================================');

    if (!rawPhone) {
      return fail(
        res,
        400,
        'Mobile number required'
      );
    }

    if (password.length < 6) {
      return fail(
        res,
        400,
        'Password kam se kam 6 characters ka rakho'
      );
    }

    const phoneFormats = getPhoneFormats(rawPhone);

    console.log('📱 Phone Formats:', phoneFormats);

    const itemsCollection =
      mongoose.connection.collection('items');

    const existing =
      await itemsCollection.findOne({
        phone: {
          $in: phoneFormats,
        },
      });

    if (existing) {
      console.log(
        '❌ REGISTER FAILED: Number already exists'
      );

      return fail(
        res,
        409,
        'Ye number already registered hai'
      );
    }

    /* ==========================================
       NEW USER DATA
    ========================================== */

    const newUser = {
      name: String(
        req.body.name || 'User'
      ),

      idNo: String(
        req.body.cnic ||
        req.body.idNo ||
        ''
      ),

      phone: rawPhone,

      password: password,

      userImageUrl: String(
        req.body.imageUrl || ''
      ),

      userImagePublicId: '',

      cardImageUrl: '',

      cardImagePublicId: '',

      createdAt: new Date(),

      updatedAt: new Date(),
    };

    console.log('\n');
    console.log('========== DATA SAVING TO MONGODB ==========');

    console.log(
      JSON.stringify(
        {
          ...newUser,
          password: '********',
        },
        null,
        2
      )
    );

    console.log(
      '============================================='
    );

    const result =
      await itemsCollection.insertOne(
        newUser
      );

    console.log('✅ USER INSERTED');
    console.log(
      '🆔 MongoDB ID:',
      result.insertedId.toString()
    );

    return res.json({
      success: true,
      message:
        'Successfully registered! Ab login karo.',
      userId: String(result.insertedId),
    });

  } catch (e) {
    console.error(
      '❌ REGISTER ERROR:',
      e
    );

    return fail(
      res,
      500,
      'Registration failed'
    );
  }
});

/* =====================================================
   LOGIN
===================================================== */

app.post('/api/login', async (req, res) => {
  try {
    const rawPhone = String(
      req.body.phone || ''
    ).trim();

    const password = String(
      req.body.password || ''
    );

    console.log('\n');
    console.log('========================================');
    console.log('             🔐 LOGIN REQUEST');
    console.log('========================================');

    console.log(
      '📱 Requested Phone:',
      rawPhone
    );

    console.log(
      '🔑 Password Received:',
      password ? 'YES' : 'NO'
    );

    if (!rawPhone) {
      return fail(
        res,
        400,
        'Mobile number required'
      );
    }

    if (!password) {
      return fail(
        res,
        400,
        'Password required'
      );
    }

    const normalizedPhone =
      normalizePhone(rawPhone);

    const phoneFormats =
      getPhoneFormats(rawPhone);

    console.log(
      '📱 Normalized Phone:',
      normalizedPhone
    );

    console.log(
      '📱 Phone Formats:',
      phoneFormats
    );

    const itemsCollection =
      mongoose.connection.collection('items');

    const item =
      await itemsCollection.findOne({
        phone: {
          $in: phoneFormats,
        },

        password: password,
      });

    /* ==========================================
       SHOW MONGODB LOGIN DATA
    ========================================== */

    console.log('\n');
    console.log(
      '========== MONGODB LOGIN RESULT =========='
    );

    if (item) {

      console.log(
        '✅ USER FOUND IN MONGODB'
      );

      console.log(
        JSON.stringify(
          {
            _id: item._id,
            name: item.name,
            idNo: item.idNo,
            phone: item.phone,

            userImageUrl:
              item.userImageUrl,

            userImagePublicId:
              item.userImagePublicId,

            cardImageUrl:
              item.cardImageUrl,

            cardImagePublicId:
              item.cardImagePublicId,

            createdAt:
              item.createdAt,

            updatedAt:
              item.updatedAt,
          },
          null,
          2
        )
      );

    } else {

      console.log(
        '❌ USER NOT FOUND IN MONGODB'
      );

      console.log(
        'Searched Phone Formats:',
        phoneFormats
      );
    }

    console.log(
      '=========================================='
    );

    if (!item) {
      return fail(
        res,
        401,
        'Mobile number ya password galat hai'
      );
    }

    /* ==========================================
       OTP
    ========================================== */

    const resend =
      otpService.canResend(
        normalizedPhone,
        COOLDOWN_MS
      );

    if (!resend.ok) {

      console.log(
        '⏳ OTP COOLDOWN:',
        Math.ceil(
          resend.waitMs / 1000
        ),
        'seconds'
      );

      return fail(
        res,
        429,
        `Naya OTP lane se pehle ${Math.ceil(
          resend.waitMs / 1000
        )}s ruko`
      );
    }

    const otp =
      otpService.issueOtp(
        normalizedPhone,
        OTP_TTL,
        MAX_ATTEMPTS
      );

    console.log(
      `[OTP] ${normalizedPhone}: ${otp}`
    );

    console.log(
      '========================================\n'
    );

    return res.json({
      success: true,
      message: 'Login successful',
      otp,
      expiresIn: OTP_TTL,
    });

  } catch (e) {

    console.error(
      '❌ LOGIN ERROR:',
      e
    );

    return fail(
      res,
      500,
      'Server/MongoDB error'
    );
  }
});

/* =====================================================
   VERIFY OTP
===================================================== */

app.post(
  '/api/verify-otp',
  async (req, res) => {

    try {

      const phone =
        normalizePhone(
          req.body.phone
        );

      const otp =
        String(
          req.body.otp || ''
        ).trim();

      console.log('\n');
      console.log(
        '========================================'
      );
      console.log(
        '          🔢 VERIFY OTP REQUEST'
      );
      console.log(
        '========================================'
      );

      console.log(
        '📱 Phone:',
        phone
      );

      console.log(
        '🔢 OTP:',
        otp
      );

      if (!PHONE_RE.test(phone)) {
        return fail(
          res,
          400,
          'Invalid phone number'
        );
      }

      if (!/^\d{4}$/.test(otp)) {
        return fail(
          res,
          400,
          'OTP 4 digits ka hona chahiye'
        );
      }

      const result =
        otpService.verifyOtp(
          phone,
          otp
        );

      console.log(
        '🔐 OTP Result:',
        result
      );

      if (!result.ok) {

        const reasons = {

          no_orphan:
            'Is number ke liye koi OTP issue nahi hua',

          expired:
            'OTP expire ho gaya. Dobara login karo.',

          locked:
            'Bahut zyada galat attempts. Dobara login karke naya OTP lo.',

          wrong:
            `OTP galat hai. ${result.attemptsLeft} attempts baqi hain.`,
        };

        return fail(
          res,
          401,
          reasons[result.reason] ||
            'OTP verification failed'
        );
      }

      const phoneFormats =
        getPhoneFormats(phone);

      console.log(
        '📱 Phone Formats:',
        phoneFormats
      );

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      const user =
        await itemsCollection.findOne({
          phone: {
            $in: phoneFormats,
          },
        });

      /* ==========================================
         MONGODB USER AFTER OTP
      ========================================== */

      console.log('\n');
      console.log(
        '====== MONGODB USER AFTER OTP ======'
      );

      if (user) {

        console.log(
          '✅ USER FOUND AFTER OTP'
        );

        console.log(
          JSON.stringify(
            {
              _id: user._id,
              name: user.name,
              idNo: user.idNo,
              phone: user.phone,

              userImageUrl:
                user.userImageUrl,

              userImagePublicId:
                user.userImagePublicId,

              cardImageUrl:
                user.cardImageUrl,

              cardImagePublicId:
                user.cardImagePublicId,

              createdAt:
                user.createdAt,

              updatedAt:
                user.updatedAt,
            },
            null,
            2
          )
        );

      } else {

        console.log(
          '❌ USER NOT FOUND AFTER OTP'
        );
      }

      console.log(
        '===================================='
      );

      if (!user) {
        return fail(
          res,
          404,
          'User MongoDB me nahi mila'
        );
      }

      /* ==========================================
         JWT
      ========================================== */

      const token =
        jwt.sign(
          {
            userId:
              String(user._id),

            phone:
              user.phone,
          },

          JWT_SECRET,

          {
            expiresIn: '7d',
          }
        );

      console.log(
        '✅ JWT TOKEN CREATED'
      );

      return res.json({
        success: true,
        message:
          'OTP verified successfully',

        token,
      });

    } catch (e) {

      console.error(
        '❌ VERIFY OTP ERROR:',
        e
      );

      return fail(
        res,
        500,
        'OTP verification failed'
      );
    }
  }
);

/* =====================================================
   GET CURRENT USER
   /api/me
===================================================== */

app.get(
  '/api/me',
  async (req, res) => {

    try {

      console.log('\n');
      console.log(
        '========================================'
      );
      console.log(
        '              👤 /api/me'
      );
      console.log(
        '========================================'
      );

      const authHeader =
        req.headers.authorization || '';

      if (
        !authHeader.startsWith(
          'Bearer '
        )
      ) {

        console.log(
          '❌ Authorization token missing'
        );

        return fail(
          res,
          401,
          'Authorization token required'
        );
      }

      const token =
        authHeader
          .replace(
            'Bearer ',
            ''
          )
          .trim();

      console.log(
        '🔑 Authorization token received'
      );

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      console.log(
        '✅ JWT DECODED:'
      );

      console.log(
        JSON.stringify(
          decoded,
          null,
          2
        )
      );

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      let user = null;

      /* ==========================================
         FIND BY MONGODB ID
      ========================================== */

      if (decoded.userId) {

        try {

          user =
            await itemsCollection.findOne({
              _id:
                new mongoose.Types.ObjectId(
                  decoded.userId
                ),
            });

          console.log(
            '🔎 MongoDB ID Search:',
            decoded.userId
          );

        } catch (idError) {

          console.log(
            '❌ ID LOOKUP ERROR:',
            idError.message
          );
        }
      }

      /* ==========================================
         FALLBACK PHONE SEARCH
      ========================================== */

      if (
        !user &&
        decoded.phone
      ) {

        const phoneFormats =
          getPhoneFormats(
            decoded.phone
          );

        console.log(
          '🔎 Fallback Phone Search:',
          phoneFormats
        );

        user =
          await itemsCollection.findOne({
            phone: {
              $in: phoneFormats,
            },
          });
      }

      /* ==========================================
         SHOW RAW MONGODB DATA
      ========================================== */

      console.log('\n');
      console.log(
        '========== RAW MONGODB USER =========='
      );

      if (user) {

        console.log(
          '✅ USER FOUND IN MONGODB'
        );

        console.log(
          JSON.stringify(
            user,
            null,
            2
          )
        );

      } else {

        console.log(
          '❌ USER NOT FOUND IN MONGODB'
        );
      }

      console.log(
        '======================================='
      );

      if (!user) {

        return fail(
          res,
          404,
          'User MongoDB me nahi mila'
        );
      }

      /* ==========================================
         SAFE USER DATA
         THIS DATA GOES TO APP
      ========================================== */

      const safeUser = {

        id:
          String(
            user._id
          ),

        name:
          user.name || '',

        idNo:
          user.idNo || '',

        phone:
          user.phone || '',

        userImageUrl:
          user.userImageUrl || '',

        userImagePublicId:
          user.userImagePublicId || '',

        cardImageUrl:
          user.cardImageUrl || '',

        cardImagePublicId:
          user.cardImagePublicId || '',

        createdAt:
          user.createdAt || null,

        updatedAt:
          user.updatedAt || null,
      };

      /* ==========================================
         MOST IMPORTANT LOG
         DATA SENT TO REACT NATIVE APP
      ========================================== */

      console.log('\n');
      console.log(
        '========== 📦 DATA SENT TO APP =========='
      );

      console.log(
        JSON.stringify(
          safeUser,
          null,
          2
        )
      );

      console.log(
        '=========================================='
      );

      console.log(
        '🖼️ USER IMAGE URL:',
        safeUser.userImageUrl
      );

      console.log(
        '🪪 CARD IMAGE URL:',
        safeUser.cardImageUrl
      );

      console.log(
        '👤 NAME:',
        safeUser.name
      );

      console.log(
        '📱 PHONE:',
        safeUser.phone
      );

      console.log(
        '========================================\n'
      );

      return res.json({

        success: true,

        user: safeUser,

      });

    } catch (e) {

      console.error(
        '❌ ME ERROR:',
        e
      );

      return fail(
        res,
        401,
        'Token invalid ya expired hai'
      );
    }
  }
);

/* =====================================================
   MONGODB CONNECTION (SERVERLESS-SAFE / VERCEL-READY)
   Vercel serverless functions cold start hoti hain,
   is liye connection cache karna zaroori hai warna
   har request par naya connection banega.
===================================================== */

if (!process.env.MONGO_URI) {

  console.error(
    '❌ MONGO_URI missing hai (Vercel dashboard env vars me daalo)'
  );
}

let cached = global.__MONGO_CACHE__;

if (!cached) {
  cached = global.__MONGO_CACHE__ = {
    conn: null,
    promise: null,
  };
}

async function connectDB() {

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGO_URI)
      .then((m) => m.connection);
  }

  cached.conn = await cached.promise;

  console.log('[OK] MongoDB connected');
  console.log('[DB]', mongoose.connection.name);

  return cached.conn;
}

/* =====================================================
   SERVERLESS EXPORT (VERCEL)
   Vercel app ko import karta hai, listen nahi karta.
===================================================== */

module.exports = app;

/* =====================================================
   LOCAL DEV:
   `node server.js` chalane par pehle MongoDB connect
   hota hai phir listen — local behaviour same rahega.
===================================================== */

if (require.main === module) {

  connectDB()

    .then(() => {

      app.listen(
        PORT,
        '0.0.0.0',
        () => {

          console.log(
            `[OK] Server running on http://0.0.0.0:${PORT}`
          );

          console.log(
            `[OK] API: http://localhost:${PORT}`
          );

          console.log(
            `[OK] /api/me ready`
          );
        }
      );

    })

    .catch((err) => {

      console.error(
        '[DB ERROR] Connection failed:',
        err.message
      );

    });
}

/* =====================================================
   VERCEL:
   Har serverless invocation par connection ensure hota hai.
===================================================== */

if (process.env.VERCEL) {

  connectDB().catch((err) => {

    console.error(
      '[DB ERROR] Connection failed:',
      err.message
    );

  });
}