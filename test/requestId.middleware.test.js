// test/requestId.middleware.test.js
import { expect } from 'chai';
import requestIdMiddleware from '../middlewares/requestId.js';

describe('requestId middleware', () => {
  it('attaches request id and header when none present', (done) => {
    const req = { headers: {} };
    const res = {
      setHeader: (k, v) => {
        try {
          expect(k).to.equal('X-Request-Id');
          expect(v).to.be.a('string');
        } catch (e) { return done(e); }
      }
    };
    requestIdMiddleware(req, res, () => {
      try {
        expect(req.id).to.be.a('string');
        done();
      } catch (err) { done(err); }
    });
  });

  it('uses incoming x-request-id if present', (done) => {
    const req = { headers: { 'x-request-id': 'abc-123' } };
    const res = { setHeader: (k, v) => {} };
    requestIdMiddleware(req, res, () => {
      try {
        expect(req.id).to.equal('abc-123');
        done();
      } catch (err) { done(err); }
    });
  });
});
