require('dotenv').config();

const express = require('express');
const cors = require('cors');
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

app.use(cors());

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

  if (
    cached.conn &&
    mongoose.connection.readyState === 1
  ) {
    return cached.conn;
  }

  if (cached.promise) {
    return cached.promise;
  }

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
          process.env.NODE_ENV === 'production'
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

  if (
    s.startsWith('+')
  ) {
    return s;
  }

  if (
    /^0\d{9,10}$/.test(s)
  ) {
    return (
      '+92' +
      s.slice(1)
    );
  }

  if (
    /^92\d{9,10}$/.test(s)
  ) {
    return '+' + s;
  }

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

  if (
    normalized.startsWith('+92')
  ) {

    formats.add(
      '0' +
      normalized.slice(3)
    );
  }

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
        '         REGISTER REQUEST'
      );

      console.log(
        '========================================'
      );

      console.log(
        'Phone:',
        rawPhone
      );

      console.log(
        'Name:',
        req.body.name
      );

      console.log(
        'CNIC:',
        req.body.cnic ||
        req.body.idNo
      );

      console.log(
        'Image URL:',
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
        'Phone Formats:',
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

        return fail(
          res,
          409,
          'Ye number already registered hai'
        );
      }

      /* Password hash */

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      /* New user */

      const newUser = {

        name:
          String(
            req.body.name ||
            'User'
          ),

        idNo:
          String(
            req.body.cnic ||
            req.body.idNo ||
            ''
          ),

        phone:
          normalizePhone(
            rawPhone
          ),

        password:
          hashedPassword,

        userImageUrl:
          String(
            req.body.imageUrl ||
            ''
          ),

        userImagePublicId:
          '',

        iqamaImageUrl:
          String(
            req.body.iqamaImageUrl ||
            ''
          ),

        iqamaImagePublicId:
          String(
            req.body.iqamaImagePublicId ||
            ''
          ),

        qrCode1Url:
          String(
            req.body.qrCode1Url ||
            ''
          ),

        qrCode1PublicId:
          String(
            req.body.qrCode1PublicId ||
            ''
          ),

        drivingLicenseImageUrl:
          String(
            req.body.drivingLicenseImageUrl ||
            ''
          ),

        drivingLicenseImagePublicId:
          String(
            req.body.drivingLicenseImagePublicId ||
            ''
          ),

        qrCode2Url:
          String(
            req.body.qrCode2Url ||
            ''
          ),

        qrCode2PublicId:
          String(
            req.body.qrCode2PublicId ||
            ''
          ),

        cardImageUrl:
          String(
            req.body.cardImageUrl ||
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

      const result =
        await itemsCollection.insertOne(
          newUser
        );

      console.log(
        'USER INSERTED:',
        result.insertedId.toString()
      );

      return res.json({

        success: true,

        message:
          'Successfully registered! Ab login karo.',

        userId:
          String(
            result.insertedId
          ),
      });

    } catch (e) {

      console.error(
        'REGISTER ERROR:',
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

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      const item =
        await itemsCollection.findOne(
          {
            phone: {
              $in:
                phoneFormats,
            },
          }
        );

      if (!item) {

        return fail(
          res,
          401,
          'Invalid mobile number or password'
        );
      }

      /* Password check */

      let passwordCorrect =
        false;

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

        passwordCorrect =
          password ===
          String(
            item.password || ''
          );
      }

      if (!passwordCorrect) {

        return fail(
          res,
          401,
          'Invalid mobile number or password'
        );
      }

      /* OTP cooldown */

      const resend =
        otpService.canResend(
          normalizedPhone,
          COOLDOWN_MS
        );

      if (!resend.ok) {

        return fail(
          res,
          429,
          `Naya OTP lane se pehle ${Math.ceil(
            resend.waitMs / 1000
          )}s ruko`
        );
      }

      /* Issue OTP */

      const otp =
        otpService.issueOtp(
          normalizedPhone,
          OTP_TTL,
          MAX_ATTEMPTS
        );

      console.log(
        `[OTP] ${normalizedPhone}: ${otp}`
      );

      return res.json({

        success: true,

        message:
          'Login successful',

        otp,

        expiresIn:
          OTP_TTL,
      });

    } catch (e) {

      console.error(
        'LOGIN ERROR:',
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

      const result =
        otpService.verifyOtp(
          phone,
          otp
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
            `OTP galat hai. ${result.attemptsLeft} attempts baqi hain.`,
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

      const phoneFormats =
        getPhoneFormats(
          phone
        );

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      const user =
        await itemsCollection.findOne(
          {
            phone: {
              $in:
                phoneFormats,
            },
          }
        );

      if (!user) {

        return fail(
          res,
          404,
          'User MongoDB me nahi mila'
        );
      }

      /* JWT */

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

      return res.json({

        success: true,

        message:
          'OTP verified successfully',

        token,
      });

    } catch (e) {

      console.error(
        'VERIFY OTP ERROR:',
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

   RETURNS:
   name
   idNo
   phone
   userImageUrl
   iqamaImageUrl
   qrCode1Url
   drivingLicenseImageUrl
   qrCode2Url
   cardImageUrl
   all PublicIds
   createdAt
   updatedAt
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
        '              /api/me'
      );

      console.log(
        '========================================'
      );

      const authHeader =
        req.headers.authorization ||
        '';

      /* Authorization */

      if (
        !authHeader.startsWith(
          'Bearer '
        )
      ) {

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

      /* JWT */

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      console.log(
        'JWT USER ID:',
        decoded.userId
      );

      console.log(
        'JWT PHONE:',
        decoded.phone
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

        } catch (idError) {

          console.log(
            'ID LOOKUP ERROR:',
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
         USER NOT FOUND
      ========================================== */

      if (!user) {

        return fail(
          res,
          404,
          'User MongoDB me nahi mila'
        );
      }

      /* ==========================================
         SAFE USER DATA

         Password NEVER returned.

         Baqi required fields returned.
      ========================================== */

      const safeUser = {

        id:
          String(
            user._id
          ),

        name:
          user.name ||
          '',

        idNo:
          user.idNo ||
          '',

        phone:
          user.phone ||
          '',

        /* User image */

        userImageUrl:
          user.userImageUrl ||
          '',

        userImagePublicId:
          user.userImagePublicId ||
          '',

        /* Iqama */

        iqamaImageUrl:
          user.iqamaImageUrl ||
          '',

        iqamaImagePublicId:
          user.iqamaImagePublicId ||
          '',

        /* QR Code 1 */

        qrCode1Url:
          user.qrCode1Url ||
          '',

        qrCode1PublicId:
          user.qrCode1PublicId ||
          '',

        /* Driving License */

        drivingLicenseImageUrl:
          user.drivingLicenseImageUrl ||
          '',

        drivingLicenseImagePublicId:
          user.drivingLicenseImagePublicId ||
          '',

        /* QR Code 2 */

        qrCode2Url:
          user.qrCode2Url ||
          '',

        qrCode2PublicId:
          user.qrCode2PublicId ||
          '',

        /* Card */

        cardImageUrl:
          user.cardImageUrl ||
          '',

        cardImagePublicId:
          user.cardImagePublicId ||
          '',

        /* Dates */

        createdAt:
          user.createdAt ||
          null,

        updatedAt:
          user.updatedAt ||
          null,
      };

      /* ==========================================
         LOG DATA
      ========================================== */

      console.log(
        '========== USER DATA SENT TO APP =========='
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

      /* ==========================================
         RESPONSE
      ========================================== */

      return res.json({

        success:
          true,

        user:
          safeUser,
      });

    } catch (e) {

      console.error(
        'ME ERROR:',
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
   GET ALL DATA
   GET /api/data

   Password excluded.
===================================================== */

app.get(
  '/api/data',
  async (req, res) => {

    try {

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      const docs =
        await itemsCollection
          .find(
            {},
            {
              projection: {
                password: 0,
              },
            }
          )
          .toArray();

      console.log(
        '[DATA] Records fetched:',
        docs.length
      );

      return res.json({

        success:
          true,

        count:
          docs.length,

        data:
          docs,
      });

    } catch (e) {

      console.error(
        'DATA ERROR:',
        e
      );

      return fail(
        res,
        500,
        'Data fetch failed'
      );
    }
  }
);

/* =====================================================
   GET DATA BY ID
   GET /api/data/:id
===================================================== */

app.get(
  '/api/data/:id',
  async (req, res) => {

    try {

      const itemsCollection =
        mongoose.connection.collection(
          'items'
        );

      const doc =
        await itemsCollection.findOne(
          {
            _id:
              new mongoose.Types.ObjectId(
                req.params.id
              ),
          },
          {
            projection: {
              password: 0,
            },
          }
        );

      if (!doc) {

        return fail(
          res,
          404,
          'Record nahi mila'
        );
      }

      return res.json({

        success:
          true,

        data:
          doc,
      });

    } catch (e) {

      console.error(
        'DATA BY ID ERROR:',
        e
      );

      return fail(
        res,
        500,
        'Data fetch failed'
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
