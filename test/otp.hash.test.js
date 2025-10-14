// test/otp.hash.test.js
import { expect } from 'chai';
import { generateOtp, hashOtp, verifyOtpHash } from '../services/otpService.js';

// Note: If your otpService doesn't export generateOtp/hashOtp, add exports for tests.

describe('OTP hash utilities', () => {
  it('hashes and verifies otp correctly', () => {
    const requestId = 'req-test-123';
    const otp = '123456';
    const h = hashOtp(otp, requestId);
    expect(h).to.be.a('string').and.have.length.greaterThan(10);
    const ok = verifyOtpHash(otp, requestId, h);
    expect(ok).to.equal(true);
    const bad = verifyOtpHash('000000', requestId, h);
    expect(bad).to.equal(false);
  });
});
