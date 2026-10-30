
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
app.use(express.urlencoded({
  extended: true,
  limit: '10mb',
}));

/* =====================================================
   CONFIG
===================================================== */

const PORT = process.env.PORT || 5000;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'change_this_to_a_real_secret';

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
   MONGODB CONNECTION CACHE
===================================================== */

let cached = global.__MONGO_CACHE__;

if (!cached) {
  cached = global.__MONGO_CACHE__ = {
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

  console.log('[DB] Connecting to MongoDB...');

  cached.promise = mongoose.connect(
    process.env.MONGO_URI,
    {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    }
  )
    .then((mongooseInstance) => {
      cached.conn = mongooseInstance.connection;

      console.log('[OK] MongoDB connected');
      console.log('[DB]', cached.conn.name);

      return cached.conn;
    })
    .catch((error) => {
      console.error('[DB ERROR]', error.message);

      cached.promise = null;
      cached.conn = null;

      throw error;
    });

  return cached.promise;
}

/* =====================================================
   DATABASE MIDDLEWARE
===================================================== */

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('[DB ERROR]', err.message);

    return res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error:
        process.env.NODE_ENV === 'production'
          ? undefined
          : err.message,
    });
  }
});

/* =====================================================
   NORMALIZE ID NO
===================================================== */

function normalizeIdNo(value) {
  return String(value || '')
    .trim()
    .replace(/[\s-]/g, '');
}

/* =====================================================
   GET ID NO FORMATS
===================================================== */

function getIdNoFormats(idNo) {
  const raw = String(idNo || '').trim();

  const normalized = normalizeIdNo(raw);

  const formats = new Set();

  if (raw) formats.add(raw);
  if (normalized) formats.add(normalized);

  return [...formats];
}

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
   PHONE VALIDATION
===================================================== */

function isValidMobileNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  return digits.length >= 6;
}

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
    database: mongoose.connection.name || null,
  });
});

/* =====================================================
   REGISTER
   COLLECTION: items
   PHONE IS STILL SAVED
===================================================== */

app.post('/api/register', async (req, res) => {
  try {
    const rawPhone = String(req.body.phone || '').trim();

    const password = String(req.body.password || '');

    const idNo = normalizeIdNo(
      req.body.idNo || req.body.cnic
    );

    console.log('\n========== REGISTER REQUEST ==========');
    console.log('Name:', req.body.name);
    console.log('ID NO:', idNo);
    console.log('Phone:', rawPhone);

    if (!idNo) {
      return fail(res, 400, 'ID No required');
    }

    if (!isValidMobileNumber(rawPhone)) {
      return fail(res, 400, 'Invalid mobile number');
    }

    if (password.length < 6) {
      return fail(
        res,
        400,
        'Password kam se kam 6 characters ka rakho'
      );
    }

    const itemsCollection =
      mongoose.connection.collection('items');

    /* Check duplicate ID */

    const existingId = await itemsCollection.findOne({
      idNo: { $in: getIdNoFormats(idNo) },
    });

    if (existingId) {
      return fail(
        res,
        409,
        'Ye ID No already registered hai'
      );
    }

    /* Check duplicate phone */

    const phoneFormats = getPhoneFormats(rawPhone);

    const existingPhone = await itemsCollection.findOne({
      phone: { $in: phoneFormats },
    });

    if (existingPhone) {
      return fail(
        res,
        409,
        'Ye number already registered hai'
      );
    }

    const hashedPassword = await bcrypt.hash(
      password,
      10
    );

    const newUser = {
      name: String(req.body.name || 'User'),

      idNo,

      phone: normalizePhone(rawPhone),

      password: hashedPassword,

      /* User image */

      userImageUrl: String(
        req.body.userImageUrl ||
        req.body.imageUrl ||
        ''
      ),

      userImagePublicId: String(
        req.body.userImagePublicId || ''
      ),

      /* Iqama */

      iqamaImageUrl: String(
        req.body.iqamaImageUrl || ''
      ),

      iqamaImagePublicId: String(
        req.body.iqamaImagePublicId || ''
      ),

      /* QR Code 1 */

      qrCode1Url: String(
        req.body.qrCode1Url || ''
      ),

      qrCode1PublicId: String(
        req.body.qrCode1PublicId || ''
      ),

      /* Driving License */

      drivingLicenseImageUrl: String(
        req.body.drivingLicenseImageUrl || ''
      ),

      drivingLicenseImagePublicId: String(
        req.body.drivingLicenseImagePublicId || ''
      ),

      /* QR Code 2 */

      qrCode2Url: String(
        req.body.qrCode2Url || ''
      ),

      qrCode2PublicId: String(
        req.body.qrCode2PublicId || ''
      ),

      /* Card */

      cardImageUrl: String(
        req.body.cardImageUrl || ''
      ),

      cardImagePublicId: String(
        req.body.cardImagePublicId || ''
      ),

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    /* Preserve additional registration fields */

    const reservedFields = [
      'name',
      'idNo',
      'cnic',
      'phone',
      'password',
      'userImageUrl',
      'imageUrl',
      'userImagePublicId',
      'iqamaImageUrl',
      'iqamaImagePublicId',
      'qrCode1Url',
      'qrCode1PublicId',
      'drivingLicenseImageUrl',
      'drivingLicenseImagePublicId',
      'qrCode2Url',
      'qrCode2PublicId',
      'cardImageUrl',
      'cardImagePublicId',
    ];

    for (const [key, value] of Object.entries(req.body)) {
      if (!reservedFields.includes(key)) {
        newUser[key] = value;
      }
    }

    console.log('[REGISTER] Saving user...');

    const result = await itemsCollection.insertOne(newUser);

    console.log(
      '[REGISTER] User inserted:',
      result.insertedId.toString()
    );

    return res.status(201).json({
      success: true,
      message: 'Successfully registered! Ab login karo.',
      userId: String(result.insertedId),
    });

  } catch (e) {
    console.error('[REGISTER ERROR]', e);

    return fail(res, 500, 'Registration failed');
  }
});

/* =====================================================
   LOGIN WITH ID NO
   PASSWORD -> OTP
===================================================== */

app.post('/api/login', async (req, res) => {
  try {
    const rawIdNo = String(req.body.idNo || '').trim();

    const idNo = normalizeIdNo(rawIdNo);

    const password = String(req.body.password || '');

    console.log('\n========== LOGIN REQUEST ==========');
    console.log('ID NO:', idNo);
    console.log('Password received:', Boolean(password));

    if (!idNo) {
      return fail(res, 400, 'ID No required');
    }

    if (!password) {
      return fail(res, 400, 'Password required');
    }

    const itemsCollection =
      mongoose.connection.collection('items');

    /* Find user using ID No */

    const item = await itemsCollection.findOne({
      idNo: { $in: getIdNoFormats(idNo) },
    });

    if (!item) {
      console.log('[LOGIN] User not found');

      return fail(
        res,
        401,
        'Invalid ID No or password'
      );
    }

    /* Password verification */

    let passwordCorrect = false;

    if (
      item.password &&
      String(item.password).startsWith('$2')
    ) {
      passwordCorrect = await bcrypt.compare(
        password,
        item.password
      );
    } else {
      // Temporary support for existing plaintext passwords
      passwordCorrect =
        password === String(item.password || '');
    }

    if (!passwordCorrect) {
      console.log('[LOGIN] Incorrect password');

      return fail(
        res,
        401,
        'Invalid ID No or password'
      );
    }

    console.log('[LOGIN] Password correct');

    /* OTP cooldown */

    const resend = otpService.canResend(
      idNo,
      COOLDOWN_MS
    );

    if (!resend.ok) {
      const waitSeconds = Math.ceil(
        (resend.waitMs || COOLDOWN_MS) / 1000
      );

      return fail(
        res,
        429,
        `Naya OTP lane se pehle ${waitSeconds}s ruko`
      );
    }

    /* Generate OTP using ID No */

    const otp = otpService.issueOtp(
      idNo,
      OTP_TTL,
      MAX_ATTEMPTS
    );

    console.log('[LOGIN] OTP generated for ID No');

    return res.json({
      success: true,
      message: 'Password verified. OTP generated successfully.',
      idNo: item.idNo,
      otp,
      expiresIn: OTP_TTL,
    });

  } catch (e) {
    console.error('[LOGIN ERROR]', e);

    return fail(res, 500, 'Login failed');
  }
});

/* =====================================================
   VERIFY OTP WITH ID NO
===================================================== */

app.post('/api/verify-otp', async (req, res) => {
  try {
    const rawIdNo = String(req.body.idNo || '').trim();

    const idNo = normalizeIdNo(rawIdNo);

    const otp = String(req.body.otp || '').trim();

    console.log('\n========== VERIFY OTP REQUEST ==========');
    console.log('ID NO:', idNo);

    if (!idNo) {
      return fail(res, 400, 'ID No required');
    }

    if (!/^\d{4}$/.test(otp)) {
      return fail(
        res,
        400,
        'OTP 4 digits ka hona chahiye'
      );
    }

    /* Verify OTP using same ID No key */

    const result = otpService.verifyOtp(idNo, otp);

    console.log('[OTP RESULT]', result);

    if (!result.ok) {
      const reasons = {
        no_otp: 'Is ID No ke liye koi OTP issue nahi hua',
        no_orphan: 'Is ID No ke liye koi OTP issue nahi hua',
        expired: 'OTP expire ho gaya. Dobara login karo.',
        locked: 'Maximum attempts exceeded. Dobara login karo.',
        wrong: `OTP galat hai. ${result.attemptsLeft ?? 0} attempts baqi hain.`,
      };

      return fail(
        res,
        401,
        reasons[result.reason] ||
        result.message ||
        'OTP verification failed'
      );
    }

    const itemsCollection =
      mongoose.connection.collection('items');

    /* Find user by ID No */

    const user = await itemsCollection.findOne({
      idNo: { $in: getIdNoFormats(idNo) },
    });

    if (!user) {
      return fail(
        res,
        404,
        'User MongoDB me nahi mila'
      );
    }

    /* Create JWT */

    const token = jwt.sign(
      {
        userId: String(user._id),
        idNo: user.idNo,
        phone: user.phone,
      },
      JWT_SECRET,
      {
        expiresIn: '7d',
      }
    );

    console.log('[OTP] Verified successfully');
    console.log('[JWT] Token created');

    return res.json({
      success: true,
      message: 'OTP verified successfully',
      token,
    });

  } catch (e) {
    console.error('[VERIFY OTP ERROR]', e);

    return fail(res, 500, 'OTP verification failed');
  }
});

/* =====================================================
   GET CURRENT USER
   /api/me
===================================================== */

app.get('/api/me', async (req, res) => {
  try {
    console.log('\n========== /api/me REQUEST ==========');

    const authHeader =
      req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      return fail(
        res,
        401,
        'Authorization token required'
      );
    }

    const token = authHeader
      .replace('Bearer ', '')
      .trim();

    /* Verify JWT */

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    console.log('[JWT] Token verified');

    const itemsCollection =
      mongoose.connection.collection('items');

    let user = null;

    /* Find by MongoDB ID */

    if (
      decoded.userId &&
      mongoose.Types.ObjectId.isValid(decoded.userId)
    ) {
      user = await itemsCollection.findOne({
        _id: new mongoose.Types.ObjectId(
          decoded.userId
        ),
      });
    }

    /* Fallback: Find by ID No */

    if (!user && decoded.idNo) {
      user = await itemsCollection.findOne({
        idNo: {
          $in: getIdNoFormats(decoded.idNo),
        },
      });
    }

    /* Backward compatibility with old tokens */

    if (!user && decoded.phone) {
      user = await itemsCollection.findOne({
        phone: {
          $in: getPhoneFormats(decoded.phone),
        },
      });
    }

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
      id: String(user._id),

      /* Basic information */

      name: user.name || '',
      idNo: user.idNo || '',
      phone: user.phone || '',

      /* Passport details */

      passportNo: user.passportNo || '',
      passportType: user.passportType || '',
      passportIssueDate: user.passportIssueDate || '',
      passportExpiryDate: user.passportExpiryDate || '',
      passportPlaceOfIssue: user.passportPlaceOfIssue || '',
      passportStatus: user.passportStatus || '',

      /* ID details */

      idVersion: user.idVersion || '',

      /* Iqama details */

      iqamaIssueDate: user.iqamaIssueDate || '',
      iqamaExpiryDate: user.iqamaExpiryDate || '',

      /* Travel details */

      travelStatus: user.travelStatus || '',
      lastTravelDestination:
        user.lastTravelDestination || '',
      lastTravelDate: user.lastTravelDate || '',

      /* Balance */

      balance: user.balance || '0.00 SAR',

      /* Profile image */

      userImageUrl: user.userImageUrl || '',
      userImagePublicId: user.userImagePublicId || '',

      /* Card image */

      cardImageUrl: user.cardImageUrl || '',
      cardImagePublicId: user.cardImagePublicId || '',

      /* Iqama image */

      iqamaImageUrl: user.iqamaImageUrl || '',
      iqamaImagePublicId: user.iqamaImagePublicId || '',

      /* QR Code 1 */

      qrCode1Url: user.qrCode1Url || '',
      qrCode1PublicId: user.qrCode1PublicId || '',

      /* Driving License */

      drivingLicenseImageUrl:
        user.drivingLicenseImageUrl || '',

      drivingLicenseImagePublicId:
        user.drivingLicenseImagePublicId || '',

      /* QR Code 2 */

      qrCode2Url: user.qrCode2Url || '',
      qrCode2PublicId: user.qrCode2PublicId || '',

      /* Dates */

      createdAt: user.createdAt || null,
      updatedAt: user.updatedAt || null,
    };

    console.log('[ME] User found:', safeUser.id);
    console.log('[ME] ID No:', safeUser.idNo);

    return res.json({
      success: true,
      user: safeUser,
    });

  } catch (e) {
    console.error('[ME ERROR]', e);

    return fail(
      res,
      401,
      'Token invalid ya expired hai'
    );
  }
});

/* =====================================================
   MONGOOSE CONNECTION EVENTS
===================================================== */

mongoose.connection.on('connected', () => {
  console.log('[MONGODB] Connected');
});

mongoose.connection.on('error', (error) => {
  console.error('[MONGODB] Error:', error.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('[MONGODB] Disconnected');
});

/* =====================================================
   SERVERLESS EXPORT
===================================================== */

module.exports = app;

/* =====================================================
   LOCAL DEVELOPMENT
===================================================== */

if (require.main === module) {
  connectDB()
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(
          `[OK] Server running on http://localhost:${PORT}`
        );
        console.log('[OK] /api/login uses ID No');
        console.log('[OK] /api/verify-otp uses ID No');
        console.log('[OK] /api/me ready');
      });
    })
    .catch((err) => {
      console.error(
        '[DB ERROR] Connection failed:',
        err.message
      );

      process.exit(1);
    });
}
