
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

dns.setServers([
  '1.1.1.1',
  '8.8.8.8',
]);

/* =====================================================
   EXPRESS
===================================================== */

app.use(
  express.json({
    limit: '10mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '10mb',
  })
);

/* =====================================================
   CONFIG
===================================================== */

const PORT =
  process.env.PORT || 5000;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'change_this_to_a_real_secret';

const OTP_TTL =
  parseInt(
    process.env.OTP_TTL_SECONDS || '300',
    10
  );

const MAX_ATTEMPTS =
  parseInt(
    process.env.OTP_ATTEMPTS_MAX || '3',
    10
  );

const COOLDOWN_MS =
  parseInt(
    process.env.OTP_RESEND_COOLDOWN_MS || '60000',
    10
  );

/* =====================================================
   MONGODB CONNECTION CACHE
   Vercel / Serverless safe
===================================================== */

let cached =
  global.__MONGO_CACHE__;

if (!cached) {
  cached =
    global.__MONGO_CACHE__ = {
      conn: null,
      promise: null,
    };
}

/* =====================================================
   CONNECT DATABASE
===================================================== */

async function connectDB() {

  /* Already connected */

  if (
    cached.conn &&
    mongoose.connection.readyState === 1
  ) {
    return cached.conn;
  }

  /* Connection currently in progress */

  if (cached.promise) {
    return cached.promise;
  }

  /* MONGO_URI check */

  if (!process.env.MONGO_URI) {
    throw new Error(
      'MONGO_URI environment variable is missing'
    );
  }

  console.log(
    '[DB] Connecting to MongoDB...'
  );

  cached.promise =
    mongoose
      .connect(
        process.env.MONGO_URI,
        {
          serverSelectionTimeoutMS: 10000,
          connectTimeoutMS: 10000,
          socketTimeoutMS: 45000,
        }
      )
      .then(
        (mongooseInstance) => {

          cached.conn =
            mongooseInstance.connection;

          console.log(
            '[OK] MongoDB connected'
          );

          console.log(
            '[DB]',
            cached.conn.name
          );

          return cached.conn;
        }
      )
      .catch(
        (error) => {

          console.error(
            '[DB ERROR]',
            error.message
          );

          cached.promise = null;
          cached.conn = null;

          throw error;
        }
      );

  return cached.promise;
}

/* =====================================================
   DATABASE MIDDLEWARE
===================================================== */

app.use(
  async (req, res, next) => {

    try {

      await connectDB();

      next();

    } catch (err) {

      console.error(
        '[DB ERROR] Connection failed:',
        err.message
      );

      return res.status(500).json({
        success: false,
        message:
          'Database connection failed',
        error:
          process.env.NODE_ENV ===
          'production'
            ? undefined
            : err.message,
      });
    }
  }
);

/* =====================================================
   PHONE NORMALIZE
===================================================== */

function normalizePhone(p) {

  let s =
    String(p || '')
      .trim()
      .replace(
        /[\s-]/g,
        ''
      );

  if (!s) {
    return s;
  }

  /* Already international */

  if (
    s.startsWith('+')
  ) {
    return s;
  }

  /* Pakistan local number */

  if (
    /^0\d{9,10}$/.test(s)
  ) {
    return (
      '+92' +
      s.slice(1)
    );
  }

  /* Pakistan without + */

  if (
    /^92\d{9,10}$/.test(s)
  ) {
    return '+' + s;
  }

  /* Other countries */

  return s;
}

/* =====================================================
   GET ALL PHONE FORMATS
===================================================== */

function getPhoneFormats(phone) {

  const raw =
    String(phone || '')
      .trim()
      .replace(
        /[\s-]/g,
        ''
      );

  const normalized =
    normalizePhone(raw);

  const formats =
    new Set();

  if (raw) {
    formats.add(raw);
  }

  if (normalized) {
    formats.add(normalized);
  }

  /* Pakistan +92 to local 03xx */

  if (
    normalized.startsWith('+92')
  ) {

    formats.add(
      '0' +
      normalized.slice(3)
    );
  }

  /* International without + */

  if (
    normalized.startsWith('+')
  ) {

    formats.add(
      normalized.slice(1)
    );
  }

  return [
    ...formats,
  ];
}

/* =====================================================
   PHONE VALIDATION
   Any country allowed.
   Minimum 6 digits.
===================================================== */

function isValidMobileNumber(phone) {

  const digits =
    String(phone || '')
      .replace(
        /\D/g,
        ''
      );

  return (
    digits.length >= 6
  );
}

/* =====================================================
   ERROR HELPER
===================================================== */

function fail(
  res,
  code,
  message
) {

  return res
    .status(code)
    .json({
      success: false,
      message,
    });
}

/* =====================================================
   HOME
===================================================== */

app.get(
  '/',
  (req, res) => {

    res.json({
      success: true,
      message:
        'Abshar API is running',
    });
  }
);

/* =====================================================
   HEALTH
===================================================== */

app.get(
  '/api/health',
  (req, res) => {

    res.json({
      success: true,
      message:
        'Server is running',

      mongodb:
        mongoose.connection
          .readyState === 1,

      database:
        mongoose.connection.name ||
        null,
    });
  }
);

/* =====================================================
   REGISTER
   COLLECTION: items
===================================================== */

app.post(
  '/api/register',
  async (req, res) => {

    try {

      const rawPhone =
        String(
          req.body.phone || ''
        ).trim();

      const password =
        String(
          req.body.password || ''
        );

      console.log('\n');

      console.log(
        '========================================'
      );

      console.log(
        '         📝 REGISTER REQUEST'
      );

      console.log(
        '========================================'
      );

      console.log(
        '📱 Phone:',
        rawPhone
      );

      console.log(
        '👤 Name:',
        req.body.name
      );

      console.log(
        '🪪 ID NO:',
        req.body.idNo ||
        req.body.cnic
      );

      console.log(
        '🖼️ User Image:',
        req.body.userImageUrl ||
        req.body.imageUrl
      );

      console.log(
        '========================================'
      );

      /* Mobile validation */

      if (
        !isValidMobileNumber(
          rawPhone
        )
      ) {

        return fail(
          res,
          400,
          'Invalid mobile number'
        );
      }

      /* Password validation */

      if (
        password.length < 6
      ) {

        return fail(
          res,
          400,
          'Password kam se kam 6 characters ka rakho'
        );
      }

      const phoneFormats =
        getPhoneFormats(
          rawPhone
        );

      console.log(
        '📱 Phone Formats:',
        phoneFormats
      );

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      const existing =
        await itemsCollection.findOne(
          {
            phone: {
              $in:
                phoneFormats,
            },
          }
        );

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
         PASSWORD HASH
      ========================================== */

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      /* ==========================================
         NEW USER
      ========================================== */

      const newUser = {

        name:
          String(
            req.body.name ||
            'User'
          ),

        idNo:
          String(
            req.body.idNo ||
            req.body.cnic ||
            ''
          ),

        phone:
          normalizePhone(
            rawPhone
          ),

        password:
          hashedPassword,

        /* User profile image */

        userImageUrl:
          String(
            req.body.userImageUrl ||
            req.body.imageUrl ||
            ''
          ),

        /* Iqama image */

        iqamaImageUrl:
          String(
            req.body.iqamaImageUrl ||
            ''
          ),

        /* QR Code 1 */

        qrCode1Url:
          String(
            req.body.qrCode1Url ||
            ''
          ),

        /* Driving License */

        drivingLicenseImageUrl:
          String(
            req.body.drivingLicenseImageUrl ||
            ''
          ),

        /* QR Code 2 */

        qrCode2Url:
          String(
            req.body.qrCode2Url ||
            ''
          ),

        /* Card image */

        cardImageUrl:
          String(
            req.body.cardImageUrl ||
            ''
          ),

        userImagePublicId:
          String(
            req.body.userImagePublicId ||
            ''
          ),

        cardImagePublicId:
          String(
            req.body.cardImagePublicId ||
            ''
          ),

        createdAt:
          new Date(),

        updatedAt:
          new Date(),
      };

      console.log('\n');

      console.log(
        '========== DATA SAVING TO MONGODB =========='
      );

      console.log(
        JSON.stringify(
          {
            ...newUser,
            password:
              '********',
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

      console.log(
        '✅ USER INSERTED'
      );

      console.log(
        '🆔 MongoDB ID:',
        result.insertedId.toString()
      );

      return res.json({

        success:
          true,

        message:
          'Successfully registered! Ab login karo.',

        userId:
          String(
            result.insertedId
          ),
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
  }
);

/* =====================================================
   LOGIN
===================================================== */

app.post(
  '/api/login',
  async (req, res) => {

    try {

      const rawPhone =
        String(
          req.body.phone || ''
        ).trim();

      const password =
        String(
          req.body.password || ''
        );

      console.log('\n');

      console.log(
        '========================================'
      );

      console.log(
        '             🔐 LOGIN REQUEST'
      );

      console.log(
        '========================================'
      );

      console.log(
        '📱 Requested Phone:',
        rawPhone
      );

      console.log(
        '🔑 Password Received:',
        password
          ? 'YES'
          : 'NO'
      );

      /* Mobile validation */

      if (
        !isValidMobileNumber(
          rawPhone
        )
      ) {

        return fail(
          res,
          400,
          'Invalid mobile number'
        );
      }

      /* Password validation */

      if (!password) {

        return fail(
          res,
          400,
          'Password required'
        );
      }

      const normalizedPhone =
        normalizePhone(
          rawPhone
        );

      const phoneFormats =
        getPhoneFormats(
          rawPhone
        );

      console.log(
        '📱 Normalized Phone:',
        normalizedPhone
      );

      console.log(
        '📱 Phone Formats:',
        phoneFormats
      );

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      /* ==========================================
         FIND USER BY PHONE
      ========================================== */

      const item =
        await itemsCollection.findOne(
          {
            phone: {
              $in:
                phoneFormats,
            },
          }
        );

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
              _id:
                item._id,

              name:
                item.name,

              idNo:
                item.idNo,

              phone:
                item.phone,

              userImageUrl:
                item.userImageUrl,

              iqamaImageUrl:
                item.iqamaImageUrl,

              qrCode1Url:
                item.qrCode1Url,

              drivingLicenseImageUrl:
                item.drivingLicenseImageUrl,

              qrCode2Url:
                item.qrCode2Url,

              cardImageUrl:
                item.cardImageUrl,

              userImagePublicId:
                item.userImagePublicId,

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
          'Invalid mobile number or password'
        );
      }

      /* ==========================================
         PASSWORD CHECK
      ========================================== */

      let passwordCorrect =
        false;

      /* New bcrypt password */

      if (
        item.password &&
        String(
          item.password
        ).startsWith('$2')
      ) {

        passwordCorrect =
          await bcrypt.compare(
            password,
            item.password
          );

      } else {

        /*
          Temporary support for old
          plaintext passwords.
        */

        passwordCorrect =
          password ===
          String(
            item.password || ''
          );
      }

      if (!passwordCorrect) {

        console.log(
          '❌ PASSWORD INCORRECT'
        );

        return fail(
          res,
          401,
          'Invalid mobile number or password'
        );
      }

      console.log(
        '✅ PASSWORD CORRECT'
      );

      /* ==========================================
         OTP COOLDOWN
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
            resend.waitMs /
            1000
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

      /* ==========================================
         ISSUE OTP
      ========================================== */

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

        success:
          true,

        message:
          'Login successful',

        otp,

        expiresIn:
          OTP_TTL,
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
  }
);

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

      /* ==========================================
         MOBILE VALIDATION
         Any country
         Minimum 6 digits
      ========================================== */

      if (
        !isValidMobileNumber(
          phone
        )
      ) {

        return fail(
          res,
          400,
          'Invalid mobile number'
        );
      }

      /* ==========================================
         OTP VALIDATION
      ========================================== */

      if (
        !/^\d{4}$/.test(
          otp
        )
      ) {

        return fail(
          res,
          400,
          'OTP 4 digits ka hona chahiye'
        );
      }

      /* ==========================================
         VERIFY OTP
      ========================================== */

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

          no_otp:
            'Is number ke liye koi OTP issue nahi hua',

          no_orphan:
            'Is number ke liye koi OTP issue nahi hua',

          expired:
            'OTP expire ho gaya. Dobara login karo.',

          locked:
            'Bahut zyada galat attempts. Dobara login karke naya OTP lo.',

          wrong:
            `OTP galat hai. ${
              result.attemptsLeft ?? 0
            } attempts baqi hain.`,
        };

        return fail(
          res,
          401,
          reasons[
            result.reason
          ] ||
            'OTP verification failed'
        );
      }

      /* ==========================================
         PHONE FORMATS
      ========================================== */

      const phoneFormats =
        getPhoneFormats(
          phone
        );

      console.log(
        '📱 Phone Formats:',
        phoneFormats
      );

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      /* ==========================================
         FIND USER
      ========================================== */

      const user =
        await itemsCollection.findOne(
          {
            phone: {
              $in:
                phoneFormats,
            },
          }
        );

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
              _id:
                user._id,

              name:
                user.name,

              idNo:
                user.idNo,

              phone:
                user.phone,

              userImageUrl:
                user.userImageUrl,

              iqamaImageUrl:
                user.iqamaImageUrl,

              qrCode1Url:
                user.qrCode1Url,

              drivingLicenseImageUrl:
                user.drivingLicenseImageUrl,

              qrCode2Url:
                user.qrCode2Url,

              cardImageUrl:
                user.cardImageUrl,

              userImagePublicId:
                user.userImagePublicId,

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
              String(
                user._id
              ),

            phone:
              user.phone,
          },

          JWT_SECRET,

          {
            expiresIn:
              '7d',
          }
        );

      console.log(
        '✅ JWT TOKEN CREATED'
      );

      return res.json({

        success:
          true,

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
        req.headers.authorization ||
        '';

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

      /* ==========================================
         VERIFY JWT
      ========================================== */

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

      let user =
        null;

      /* ==========================================
         FIND BY MONGODB ID
      ========================================== */

      if (
        decoded.userId
      ) {

        try {

          user =
            await itemsCollection.findOne(
              {
                _id:
                  new mongoose.Types.ObjectId(
                    decoded.userId
                  ),
              }
            );

          console.log(
            '🔎 MongoDB ID Search:',
            decoded.userId
          );

        } catch (
          idError
        ) {

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
          await itemsCollection.findOne(
            {
              phone: {
                $in:
                  phoneFormats,
              },
            }
          );
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

        /* Profile */

        userImageUrl:
          user.userImageUrl || '',

        /* Iqama */

        iqamaImageUrl:
          user.iqamaImageUrl || '',

        /* QR Code 1 */

        qrCode1Url:
          user.qrCode1Url || '',

        /* Driving License */

        drivingLicenseImageUrl:
          user.drivingLicenseImageUrl || '',

        /* QR Code 2 */

        qrCode2Url:
          user.qrCode2Url || '',

        /* Card */

        cardImageUrl:
          user.cardImageUrl || '',

        /* Cloudinary IDs */

        userImagePublicId:
          user.userImagePublicId || '',

        cardImagePublicId:
          user.cardImagePublicId || '',

        createdAt:
          user.createdAt ||
          null,

        updatedAt:
          user.updatedAt ||
          null,
      };

      /* ==========================================
         DATA SENT TO APP
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
        '🪪 IQAMA IMAGE URL:',
        safeUser.iqamaImageUrl
      );

      console.log(
        '🔳 QR CODE 1 URL:',
        safeUser.qrCode1Url
      );

      console.log(
        '🚗 DRIVING LICENSE URL:',
        safeUser.drivingLicenseImageUrl
      );

      console.log(
        '🔳 QR CODE 2 URL:',
        safeUser.qrCode2Url
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
        '🆔 ID NO:',
        safeUser.idNo
      );

      console.log(
        '📱 PHONE:',
        safeUser.phone
      );

      console.log(
        '========================================\n'
      );

      return res.json({

        success:
          true,

        user:
          safeUser,
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
   MONGOOSE CONNECTION EVENTS
===================================================== */

mongoose.connection.on(
  'connected',
  () => {

    console.log(
      '[MONGODB] Connected'
    );
  }
);

mongoose.connection.on(
  'error',
  (error) => {

    console.error(
      '[MONGODB] Error:',
      error.message
    );
  }
);

mongoose.connection.on(
  'disconnected',
  () => {

    console.log(
      '[MONGODB] Disconnected'
    );
  }
);

/* =====================================================
   SERVERLESS EXPORT
===================================================== */

module.exports = app;

/* =====================================================
   LOCAL DEVELOPMENT
===================================================== */

if (
  require.main === module
) {

  connectDB()

    .then(
      () => {

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

      }
    )

    .catch(
      (err) => {

        console.error(
          '[DB ERROR] Connection failed:',
          err.message
        );

        process.exit(
          1
        );
      }
    );
}

