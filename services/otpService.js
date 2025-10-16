// src/services/otpService.js
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import dotenv from "dotenv";
import { query, getPool } from "../config/db.js";

import { sendOtpSms } from "../utils/smsProvider.js";
import logger from '../utils/logger.js';
dotenv.config();

const OTP_TTL = Number(process.env.OTP_TTL_SECONDS || 300); // seconds
const OTP_HASH_SALT =
  process.env.OTP_HASH_SALT || process.env.JWT_SECRET || "change_me";

export function generateOtp() {
  // 6-digit OTP
  const n = crypto.randomInt(100000, 1000000);
  return String(n);
}

export function hashOtp(otp, requestId) {
  // Use a SHA256 of salt + requestId + otp to avoid predictable hashes
  const h = crypto.createHash("sha256");
  h.update(String(OTP_HASH_SALT) + "|" + String(requestId) + "|" + String(otp));
  return h.digest("hex");
}

/**
 * Save OTP row into DB. We don't store raw OTP.
 */
export async function createAndSendOtp(phone) {
  const requestId = uuidv4();
  const otp = generateOtp(); // raw OTP only in memory (never logged)
  const otpHash = hashOtp(otp, requestId);
  const expiresAt = new Date(Date.now() + OTP_TTL * 1000);

  // Save in DB
  const sql = `INSERT INTO otps (request_id, phone, otp_hash, expires_at, attempts, consumed, created_at)
               VALUES (?, ?, ?, ?, 0, 0, NOW())`;
  try {
    await query(sql, [requestId, phone, otpHash, expiresAt]);
    logger.info("Creating OTP request", { requestId, phone });
  } catch (err) {
    console.error("Failed to insert OTP row", err);
    throw err;
  }

  // Send SMS via Fast2SMS
  try {
    const smsResult = await sendOtpSms(phone, otp);
    if (smsResult.ok) {
      logger.info("OTP SMS sent successfully", {
        requestId,
        phone,
        messageId: smsResult.messageId,
        credits: smsResult.credits
      });
    } else {
      logger.error("OTP SMS send failed", {
        requestId,
        phone,
        error: smsResult.error
      });
      // SMS failed, but continue with email if available
    }
  } catch (smsErr) {
    logger.error("SMS send error", {
      requestId,
      phone,
      error: smsErr.message
    });
    // SMS failed, but continue with email if available
  }

  // Email removed - only SMS OTP now

  return { requestId, ttl: OTP_TTL };
}

/**
 * Verify OTP against request_id + phone.
 * Returns { ok: true, userProvided:false } or throws error.
 *
 * NOTE: implement verification in Day 3 controller (we'll provide later).
 */
export function verifyOtpHash(otp, requestId, otpHashStored) {
  const h = hashOtp(otp, requestId);
  return h === otpHashStored;
}


