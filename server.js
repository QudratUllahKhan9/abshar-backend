require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const dns = require("dns");

const otpService = require("./otpService");

const app = express();

/* =====================================================
   CONFIG
===================================================== */

const PORT = process.env.PORT || 4000;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-jwt-secret-change-me";

/* =====================================================
   DNS
===================================================== */

dns.setServers([
  "1.1.1.1",
  "8.8.8.8",
]);

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

/* =====================================================
   CORS
===================================================== */

app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/* =====================================================
   MONGODB
===================================================== */

const MONGODB_URI =
  process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error(
    "MONGODB_URI is missing from environment variables."
  );
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((error) => {
    console.error(
      "MongoDB connection error:",
      error
    );
  });

/* =====================================================
   ITEM MODEL
===================================================== */

const itemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    idNo: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    password: {
      type: String,
      default: "",
    },

    /* =================================================
       PASSPORT
    ================================================= */

    passportNo: {
      type: String,
      default: "",
      trim: true,
    },

    passportType: {
      type: String,
      default: "",
      trim: true,
    },

    passportIssueDate: {
      type: String,
      default: "",
    },

    passportExpiryDate: {
      type: String,
      default: "",
    },

    passportPlaceOfIssue: {
      type: String,
      default: "",
    },

    passportStatus: {
      type: String,
      default: "",
    },

    /* =================================================
       IQAMA
    ================================================= */

    idVersion: {
      type: String,
      default: "",
    },

    iqamaIssueDate: {
      type: String,
      default: "",
    },

    iqamaExpiryDate: {
      type: String,
      default: "",
    },

    /* =================================================
       TRAVEL
    ================================================= */

    travelStatus: {
      type: String,
      default: "",
    },

    lastTravelDestination: {
      type: String,
      default: "",
    },

    lastTravelDate: {
      type: String,
      default: "",
    },

    balance: {
      type: String,
      default: "",
    },

    /* =================================================
       IMAGES
    ================================================= */

    userImageUrl: {
      type: String,
      default: "",
    },

    cardImageUrl: {
      type: String,
      default: "",
    },

    iqamaImageUrl: {
      type: String,
      default: "",
    },

    qrCode1Url: {
      type: String,
      default: "",
    },

    drivingLicenseImageUrl: {
      type: String,
      default: "",
    },

    qrCode2Url: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const Item =
  mongoose.models.Item ||
  mongoose.model("Item", itemSchema);

/* =====================================================
   HEALTH
===================================================== */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Absher backend is running",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
    time: new Date().toISOString(),
  });
});

/* =====================================================
   HELPER
   SAFE USER RESPONSE
===================================================== */

function safeItem(item) {
  if (!item) return null;

  const object =
    typeof item.toObject === "function"
      ? item.toObject()
      : item;

  return {
    id: String(
      object._id ||
      object.id ||
      ""
    ),

    name: object.name || "",

    idNo: object.idNo || "",

    phone: object.phone || "",

    /* ===============================================
       PASSWORD NEVER RETURNED
    =============================================== */

    passportNo:
      object.passportNo || "",

    passportType:
      object.passportType || "",

    passportIssueDate:
      object.passportIssueDate || "",

    passportExpiryDate:
      object.passportExpiryDate || "",

    passportPlaceOfIssue:
      object.passportPlaceOfIssue || "",

    passportStatus:
      object.passportStatus || "",

    idVersion:
      object.idVersion || "",

    iqamaIssueDate:
      object.iqamaIssueDate || "",

    iqamaExpiryDate:
      object.iqamaExpiryDate || "",

    travelStatus:
      object.travelStatus || "",

    lastTravelDestination:
      object.lastTravelDestination || "",

    lastTravelDate:
      object.lastTravelDate || "",

    balance:
      object.balance || "",

    userImageUrl:
      object.userImageUrl ||
      object.images?.userImage ||
      "",

    cardImageUrl:
      object.cardImageUrl ||
      object.images?.cardImage ||
      "",

    iqamaImageUrl:
      object.iqamaImageUrl ||
      object.images?.iqamaImage ||
      "",

    qrCode1Url:
      object.qrCode1Url ||
      object.images?.qrCode1 ||
      "",

    drivingLicenseImageUrl:
      object.drivingLicenseImageUrl ||
      object.images?.drivingLicenseImage ||
      "",

    qrCode2Url:
      object.qrCode2Url ||
      object.images?.qrCode2 ||
      "",

    images: {
      userImage:
        object.userImageUrl ||
        object.images?.userImage ||
        "",

      cardImage:
        object.cardImageUrl ||
        object.images?.cardImage ||
        "",

      iqamaImage:
        object.iqamaImageUrl ||
        object.images?.iqamaImage ||
        "",

      qrCode1:
        object.qrCode1Url ||
        object.images?.qrCode1 ||
        "",

      drivingLicenseImage:
        object.drivingLicenseImageUrl ||
        object.images?.drivingLicenseImage ||
        "",

      qrCode2:
        object.qrCode2Url ||
        object.images?.qrCode2 ||
        "",
    },
  };
}

/* =====================================================
   GET ALL ITEMS
   DASHBOARD
===================================================== */

app.get("/api/items", async (req, res) => {
  try {
    const items = await Item.find({})
      .sort({
        createdAt: -1,
      })
      .lean();

    res.json({
      success: true,
      items: items.map(safeItem),
    });
  } catch (error) {
    console.error(
      "GET ITEMS ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Could not load records",
    });
  }
});

/* =====================================================
   GET SINGLE ITEM
===================================================== */

app.get(
  "/api/items/:id",
  async (req, res) => {
    try {
      const item =
        await Item.findById(
          req.params.id
        );

      if (!item) {
        return res.status(404).json({
          success: false,
          message: "Record not found",
        });
      }

      res.json({
        success: true,
        item: safeItem(item),
      });
    } catch (error) {
      console.error(
        "GET SINGLE ITEM ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not load record",
      });
    }
  }
);

/* =====================================================
   FIND BY IQAMA
===================================================== */

app.get(
  "/api/items/by-idno/:idNo",
  async (req, res) => {
    try {
      const idNo = String(
        req.params.idNo || ""
      ).trim();

      if (!idNo) {
        return res.status(400).json({
          success: false,
          message: "Iqama number is required",
        });
      }

      const item =
        await Item.findOne({
          idNo,
        });

      if (!item) {
        return res.status(404).json({
          success: false,
          message:
            "No record found for this Iqama number",
        });
      }

      res.json({
        success: true,
        item: safeItem(item),
      });
    } catch (error) {
      console.error(
        "FIND BY IDNO ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

/* =====================================================
   REQUEST OTP USING IQAMA
===================================================== */

app.post(
  "/api/login-id",
  async (req, res) => {
    try {
      const idNo = String(
        req.body?.idNo || ""
      ).trim();

      if (!idNo) {
        return res.status(400).json({
          success: false,
          message:
            "Iqama number is required",
        });
      }

      /* =============================================
         FIND PERSON BY IQAMA
      ============================================= */

      const item =
        await Item.findOne({
          idNo,
        });

      if (!item) {
        return res.status(404).json({
          success: false,
          message:
            "Iqama number not found",
        });
      }

      /* =============================================
         PHONE REQUIRED
      ============================================= */

      if (!item.phone) {
        return res.status(400).json({
          success: false,
          message:
            "No phone number is registered for this Iqama",
        });
      }

      /* =============================================
         RESEND COOLDOWN
      ============================================= */

      const resend =
        otpService.canResend(
          item.phone,
          60000
        );

      if (!resend.ok) {
        return res.status(429).json({
          success: false,
          message:
            `Please wait ${Math.ceil(
              resend.waitMs / 1000
            )} seconds before requesting another OTP.`,
          waitMs:
            resend.waitMs,
        });
      }

      /* =============================================
         ISSUE OTP
      ============================================= */

      const otp =
        otpService.issueOtp(
          item.phone,
          300,
          3
        );

      console.log("");
      console.log(
        "LOGIN OTP REQUEST"
      );
      console.log(
        "IQAMA:",
        idNo
      );
      console.log(
        "PHONE:",
        item.phone
      );
      console.log(
        "OTP:",
        otp
      );

      return res.json({
        success: true,

        message:
          "OTP sent successfully",

        idNo,

        /* =========================================
           DEVELOPMENT ONLY
        ========================================= */

        ...(process.env.NODE_ENV !==
          "production" && {
          otp,
        }),

        /* Do not expose full phone */
        phone:
          maskPhone(item.phone),
      });
    } catch (error) {
      console.error(
        "LOGIN ID ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not send OTP",
      });
    }
  }
);

/* =====================================================
   VERIFY IQAMA OTP
===================================================== */

app.post(
  "/api/verify-id-otp",
  async (req, res) => {
    try {
      const idNo = String(
        req.body?.idNo || ""
      ).trim();

      const otp = String(
        req.body?.otp || ""
      )
        .trim()
        .replace(/[^0-9]/g, "");

      if (!idNo) {
        return res.status(400).json({
          success: false,
          message:
            "Iqama number is required",
        });
      }

      if (!otp) {
        return res.status(400).json({
          success: false,
          message:
            "OTP is required",
        });
      }

      /* =============================================
         FIND PERSON
      ============================================= */

      const item =
        await Item.findOne({
          idNo,
        });

      if (!item) {
        return res.status(404).json({
          success: false,
          message:
            "Iqama number not found",
        });
      }

      /* =============================================
         PHONE
      ============================================= */

      if (!item.phone) {
        return res.status(400).json({
          success: false,
          message:
            "Phone number not found",
        });
      }

      /* =============================================
         VERIFY OTP
      ============================================= */

      const result =
        otpService.verifyOtp(
          item.phone,
          otp
        );

      if (!result.ok) {
        let message =
          "Invalid OTP";

        if (
          result.reason ===
          "expired"
        ) {
          message =
            "OTP has expired";
        }

        if (
          result.reason ===
          "locked"
        ) {
          message =
            "Too many OTP attempts";
        }

        if (
          result.reason ===
          "no_otp"
        ) {
          message =
            "No OTP found. Please request a new OTP";
        }

        return res.status(401).json({
          success: false,
          message,

          reason:
            result.reason,

          attemptsLeft:
            result.attemptsLeft,
        });
      }

      /* =============================================
         CREATE LOGIN TOKEN
      ============================================= */

      const token =
        jwt.sign(
          {
            userId: String(
              item._id
            ),

            idNo:
              item.idNo,
          },
          JWT_SECRET,
          {
            expiresIn:
              "7d",
          }
        );

      /* =============================================
         SUCCESS
      ============================================= */

      console.log("");
      console.log(
        "========================================"
      );
      console.log(
        "IQAMA LOGIN SUCCESS"
      );
      console.log(
        "NAME:",
        item.name
      );
      console.log(
        "IQAMA:",
        item.idNo
      );
      console.log(
        "PHONE:",
        item.phone
      );
      console.log(
        "========================================"
      );

      return res.json({
        success: true,

        message:
          "Login successful",

        token,

        user: safeItem(item),
      });
    } catch (error) {
      console.error(
        "VERIFY ID OTP ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not verify OTP",
      });
    }
  }
);

/* =====================================================
   CURRENT USER
   GET /api/me
===================================================== */

app.get(
  "/api/me",
  async (req, res) => {
    try {
      const header =
        req.headers.authorization ||
        "";

      if (!header.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication token required",
        });
      }

      const token =
        header.substring(7);

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        );

      const item =
        await Item.findById(
          decoded.userId
        );

      if (!item) {
        return res.status(404).json({
          success: false,
          message:
            "User record not found",
        });
      }

      return res.json({
        success: true,
        user: safeItem(item),
      });
    } catch (error) {
      console.error(
        "ME ERROR:",
        error
      );

      return res.status(401).json({
        success: false,
        message:
          "Invalid or expired token",
      });
    }
  }
);

/* =====================================================
   CREATE ITEM
===================================================== */

app.post(
  "/api/items",
  async (req, res) => {
    try {
      const body = req.body || {};

      if (
        !body.name ||
        !String(body.name).trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Name is required",
        });
      }

      if (
        !body.idNo ||
        !String(body.idNo).trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Iqama number is required",
        });
      }

      /* =============================================
         CHECK DUPLICATE IQAMA
      ============================================= */

      const existing =
        await Item.findOne({
          idNo: String(
            body.idNo
          ).trim(),
        });

      if (existing) {
        return res.status(409).json({
          success: false,
          message:
            "This Iqama number already exists",
        });
      }

      /* =============================================
         PASSWORD
      ============================================= */

      let password = "";

      if (
        body.password &&
        String(
          body.password
        ).trim()
      ) {
        password =
          await bcrypt.hash(
            String(body.password),
            10
          );
      }

      const item =
        new Item({
          name:
            String(body.name).trim(),

          idNo:
            String(body.idNo).trim(),

          phone:
            String(body.phone || "").trim(),

          password,

          passportNo:
            body.passportNo || "",

          passportType:
            body.passportType || "",

          passportIssueDate:
            body.passportIssueDate || "",

          passportExpiryDate:
            body.passportExpiryDate || "",

          passportPlaceOfIssue:
            body.passportPlaceOfIssue || "",

          passportStatus:
            body.passportStatus || "",

          idVersion:
            body.idVersion || "",

          iqamaIssueDate:
            body.iqamaIssueDate || "",

          iqamaExpiryDate:
            body.iqamaExpiryDate || "",

          travelStatus:
            body.travelStatus || "",

          lastTravelDestination:
            body.lastTravelDestination || "",

          lastTravelDate:
            body.lastTravelDate || "",

          balance:
            body.balance || "",

          userImageUrl:
            body.userImageUrl || "",

          cardImageUrl:
            body.cardImageUrl || "",

          iqamaImageUrl:
            body.iqamaImageUrl || "",

          qrCode1Url:
            body.qrCode1Url || "",

          drivingLicenseImageUrl:
            body.drivingLicenseImageUrl || "",

          qrCode2Url:
            body.qrCode2Url || "",
        });

      await item.save();

      return res.status(201).json({
        success: true,
        message:
          "Record created successfully",
        item: safeItem(item),
      });
    } catch (error) {
      console.error(
        "CREATE ITEM ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not create record",
        error:
          process.env.NODE_ENV !==
          "production"
            ? error.message
            : undefined,
      });
    }
  }
);

/* =====================================================
   UPDATE ITEM
===================================================== */

app.put(
  "/api/items/:id",
  async (req, res) => {
    try {
      const item =
        await Item.findById(
          req.params.id
        );

      if (!item) {
        return res.status(404).json({
          success: false,
          message:
            "Record not found",
        });
      }

      const body =
        req.body || {};

      /* =============================================
         UPDATE BASIC FIELDS
      ============================================= */

      const fields = [
        "name",
        "idNo",
        "phone",

        "passportNo",
        "passportType",
        "passportIssueDate",
        "passportExpiryDate",
        "passportPlaceOfIssue",
        "passportStatus",

        "idVersion",
        "iqamaIssueDate",
        "iqamaExpiryDate",

        "travelStatus",
        "lastTravelDestination",
        "lastTravelDate",
        "balance",

        "userImageUrl",
        "cardImageUrl",
        "iqamaImageUrl",
        "qrCode1Url",
        "drivingLicenseImageUrl",
        "qrCode2Url",
      ];

      for (const field of fields) {
        if (
          body[field] !==
          undefined
        ) {
          item[field] =
            body[field];
        }
      }

      /* =============================================
         PASSWORD UPDATE
      ============================================= */

      if (
        body.password &&
        String(
          body.password
        ).trim()
      ) {
        item.password =
          await bcrypt.hash(
            String(
              body.password
            ),
            10
          );
      }

      await item.save();

      return res.json({
        success: true,
        message:
          "Record updated successfully",
        item: safeItem(item),
      });
    } catch (error) {
      console.error(
        "UPDATE ITEM ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not update record",
      });
    }
  }
);

/* =====================================================
   DELETE ITEM
===================================================== */

app.delete(
  "/api/items/:id",
  async (req, res) => {
    try {
      const item =
        await Item.findByIdAndDelete(
          req.params.id
        );

      if (!item) {
        return res.status(404).json({
          success: false,
          message:
            "Record not found",
        });
      }

      res.json({
        success: true,
        message:
          "Record deleted successfully",
      });
    } catch (error) {
      console.error(
        "DELETE ITEM ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not delete record",
      });
    }
  }
);

/* =====================================================
   MASK PHONE
===================================================== */

function maskPhone(phone) {
  const value = String(
    phone || ""
  );

  if (value.length <= 4) {
    return value;
  }

  return (
    "*".repeat(
      Math.max(
        0,
        value.length - 4
      )
    ) +
    value.slice(-4)
  );
}

/* =====================================================
   ROOT
===================================================== */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message:
      "Absher Dashboard Backend API",
  });
});

/* =====================================================
   ERROR HANDLER
===================================================== */

app.use(
  (error, req, res, next) => {
    console.error(
      "GLOBAL ERROR:",
      error
    );

    if (
      error.type ===
      "entity.too.large"
    ) {
      return res.status(413).json({
        success: false,
        message:
          "Payload too large",
      });
    }

    res.status(500).json({
      success: false,
      message:
        "Internal server error",
    });
  }
);

/* =====================================================
   START SERVER
===================================================== */

if (require.main === module) {
  app.listen(
    PORT,
    () => {
      console.log("");
      console.log(
        "========================================"
      );
      console.log(
        "ABSher BACKEND STARTED"
      );
      console.log(
        "PORT:",
        PORT
      );
      console.log(
        "========================================"
      );
    }
  );
}

module.exports = app;
